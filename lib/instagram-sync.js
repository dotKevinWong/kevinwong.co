import { getDbPool } from "./db.js";
import {
  ensureFreshToken,
  fetchRecentMedia,
  shortcodeFromPermalink,
  sourceKeyForShortcode,
} from "./instagram.js";
import {
  checkBlobAccess,
  downloadMedia,
  folderFor,
  isBlobConfigured,
  pathnameFor,
  uploadToBlob,
} from "./blob-store.js";
import { probeMedia } from "./media-probe.js";

// Bounds for a single invocation. A daily cron only ever has a handful of new
// posts, but the first run after a long gap could have dozens — and each media
// item is a download plus a Blob upload. Capping uploads keeps any one
// invocation inside the function duration budget and the Hobby plan's 2,000
// Blob uploads a month; whatever is left is simply picked up tomorrow, because
// the sync is driven by "what is missing", not by a cursor.
const DEFAULT_MAX_POSTS = 50;
const DEFAULT_MAX_UPLOADS = 25;

// \p{RGI_Emoji} (needs the `v` flag) matches whole emoji sequences. The obvious
// \p{Extended_Pictographic} does not: it drops variation selectors so "🏖️"
// becomes a monochrome "🏖", splits "👨‍👩‍👧" into three separate people, loses
// skin-tone modifiers, and misses flags entirely.
const EMOJI_PATTERN = /\p{RGI_Emoji}/gv;

export function extractEmojis(caption) {
  if (!caption) return [];
  return [...new Set(String(caption).match(EMOJI_PATTERN) || [])];
}

/** IMAGE|VIDEO -> the media_kind enum. Anything else is not storable. */
function kindFor(mediaType) {
  if (mediaType === "IMAGE") return "image";
  if (mediaType === "VIDEO") return "video";
  return null;
}

/**
 * Flatten one API media object into the rows instagram_media expects.
 *
 * A carousel is a container: its children become positions 0..n. A single image
 * or video is its own sole child at position 0.
 */
function mediaItemsFor(post) {
  if (post.media_type === "CAROUSEL_ALBUM") {
    const children = Array.isArray(post.children?.data) ? post.children.data : [];
    return children.map((child, index) => ({
      position: index,
      raw: child,
      mediaId: child.id,
      kind: kindFor(child.media_type),
      url: child.media_url,
      createdAt: child.timestamp || post.timestamp,
    }));
  }

  return [
    {
      position: 0,
      raw: post,
      mediaId: post.id,
      kind: kindFor(post.media_type),
      url: post.media_url,
      createdAt: post.timestamp,
    },
  ];
}

function normalize(post) {
  const shortcode = shortcodeFromPermalink(post.permalink);
  if (!shortcode) return null;

  return {
    shortcode,
    sourceKey: sourceKeyForShortcode(shortcode),
    permalink: post.permalink,
    // Posts with no caption omit the field entirely rather than returning "".
    caption: typeof post.caption === "string" ? post.caption : "",
    postedAt: post.timestamp ? new Date(post.timestamp) : null,
    raw: post,
    media: mediaItemsFor(post),
  };
}

async function findExistingSourceKeys(sourceKeys) {
  if (sourceKeys.length === 0) return new Set();
  const pool = getDbPool();
  const { rows } = await pool.query(
    `select source_key from instagram_posts where source_key = any($1::text[])`,
    [sourceKeys]
  );
  return new Set(rows.map((r) => r.source_key));
}

/**
 * Oldest post /snapshots shows. Anything the API returns from before this is
 * ignored.
 *
 * The page has always started in 2022 — the original data-export import
 * brought in everything from 2022 onward and deliberately left out the 47
 * posts from 2014–2021. Move this date to change how far back the page goes;
 * the next sync backfills whatever the new window uncovers.
 */
export const SNAPSHOTS_START = new Date("2022-01-01T00:00:00Z");

/**
 * sharp, loaded on first use rather than at import.
 *
 * It is a native binary plus a separate libvips library, and if either were
 * ever missing from a deployment, a top-level import would make this whole
 * module fail to load — taking the Instagram token refresh down with it, which
 * must run every day whatever else is broken. Loaded lazily, a broken sharp only
 * fails the photo posts, and the dry run reports it (checkResizer).
 */
let resizer;
function loadResizer() {
  // Forget a failed load so the next call retries instead of replaying it.
  resizer ??= import("./image-resize.js").catch((error) => {
    resizer = undefined;
    throw error;
  });
  return resizer;
}

async function checkResizer() {
  try {
    await loadResizer();
    const { default: sharp } = await import("sharp");
    return `ok (sharp ${sharp.versions.sharp}, libvips ${sharp.versions.vips})`;
  } catch (error) {
    return `${error.name}: ${error.message}`;
  }
}

/**
 * Download and measure every media item of a post, before anything is uploaded.
 *
 * All-or-nothing on purpose. If slide 3 of 5 were rejected after slides 1–2 had
 * been uploaded, the post would be retried tomorrow and slides 1–2 uploaded
 * again, every day, each time spending two of the Hobby plan's 2,000 monthly
 * Blob uploads — and running out locks the store for 30 days, blanking every
 * image on /snapshots.
 */
async function prepareMedia(post, items, warnings) {
  const prepared = [];

  for (const item of items) {
    const label = `${post.shortcode} slide ${item.position}`;
    const buffer = await downloadMedia(item.url);

    let probe;
    try {
      probe = probeMedia(buffer);
    } catch (error) {
      // Typically an expired signed URL answering with an HTML error page.
      throw new Error(`${label}: downloaded bytes are not an image or video (${error.message})`);
    }

    if (probe.kind !== item.kind) {
      throw new Error(`${label}: Instagram says ${item.kind} but the file is ${probe.format}`);
    }
    if (probe.format === "heic") {
      // Chrome and Firefox cannot render HEIC in an <img>; storing it would
      // publish a broken slide.
      throw new Error(`${label}: HEIC images do not display in most browsers`);
    }
    // Photos arrive as full-resolution originals (up to 4096px, ~1.4 MB); shrink
    // them to what the older posts are (1440px wide, ~290 KB). Videos are stored
    // as they come — re-encoding video needs ffmpeg, which a function lacks.
    let output = { buffer, width: probe.width, height: probe.height, ext: probe.ext, mime: probe.mime };
    if (probe.kind === "image") {
      const { needsResize, resizeForWeb } = await loadResizer();
      if (needsResize(probe)) output = await resizeForWeb(buffer);
    }

    if (!output.width || !output.height) {
      // Not fatal: PhotoPost.tsx falls back to a square frame.
      warnings.push({ id: label, warning: `could not read ${probe.format} dimensions; frame will be square` });
    }

    prepared.push({
      ...item,
      buffer: output.buffer,
      bytes: output.buffer.length,
      width: output.width,
      height: output.height,
      ext: output.ext,
      contentType: output.mime,
      folder: folderFor(post.postedAt),
      pathname: pathnameFor({
        postedAt: post.postedAt,
        shortcode: post.shortcode,
        position: item.position,
        ext: output.ext,
      }),
    });
  }

  return prepared;
}

const LOCK_NAME = "instagram-sync";

// Longer than the cron's 300s maxDuration, so a live run never loses its lease;
// renewed before every post, so a long local backfill keeps it too. If the
// process dies, the lease simply expires.
const LEASE = "10 minutes";

/** Take the run lease. Returns false if another run holds it. */
async function acquireLease() {
  const pool = getDbPool();
  await pool.query(
    `insert into job_locks (name) values ($1) on conflict (name) do nothing`,
    [LOCK_NAME]
  );
  const { rows } = await pool.query(
    `update job_locks set locked_until = now() + $2::interval
      where name = $1 and locked_until < now()
      returning name`,
    [LOCK_NAME, LEASE]
  );
  return rows.length === 1;
}

async function renewLease() {
  await getDbPool().query(
    `update job_locks set locked_until = now() + $2::interval where name = $1`,
    [LOCK_NAME, LEASE]
  );
}

async function releaseLease() {
  await getDbPool().query(
    `update job_locks set locked_until = 'epoch' where name = $1`,
    [LOCK_NAME]
  );
}

/** Any stored object, for a credentials check that does not upload anything. */
async function findAnyStoredPathname() {
  const pool = getDbPool();
  const { rows } = await pool.query(
    `select asset_pathname from instagram_media where asset_pathname is not null limit 1`
  );
  return rows[0]?.asset_pathname ?? null;
}

/**
 * Insert one post and its media atomically.
 *
 * A transaction per post (rather than per run) means a failure partway through a
 * backlog keeps everything already imported and simply leaves the rest for the
 * next invocation — no half-written post with missing slides.
 */
async function insertPost(post, stored) {
  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const { rows } = await client.query(
      `insert into instagram_posts
         (source_key, caption, instagram_url, posted_at, raw_post_json, caption_emojis)
       values ($1, $2, $3, $4, $5::jsonb, $6::text[])
       on conflict (source_key) do nothing
       returning id`,
      [
        post.sourceKey,
        post.caption,
        post.permalink,
        post.postedAt,
        JSON.stringify(post.raw),
        extractEmojis(post.caption),
      ]
    );

    // Lost a race with a concurrent run, or the post arrived between the
    // existence check and now. Either way it is already there.
    if (rows.length === 0) {
      await client.query("rollback");
      return { inserted: false };
    }

    const postId = rows[0].id;

    for (const item of stored) {
      await client.query(
        `insert into instagram_media
           (post_id, position, kind,
            asset_url, asset_pathname, asset_content_type, asset_bytes,
            asset_width, asset_height,
            cloudinary_url, cloudinary_public_id, cloudinary_folder,
            cloudinary_width, cloudinary_height,
            file_ext, source_uri, source_created_at, raw_media_json)
         values ($1, $2, $3::media_kind, $4, $5, $6, $7, $8, $9,
                 $4, $5, $10, $8, $9,
                 $11, $12, $13, $14::jsonb)
         on conflict (post_id, position) do nothing`,
        [
          postId,
          item.position,
          item.kind,
          item.blob.url,
          item.blob.pathname,
          item.blob.contentType,
          item.bytes,
          item.width,
          item.height,
          // cloudinary_* is written too, with the same Blob values, only while
          // the move from Cloudinary is in progress. The code currently in
          // production — and any Instant Rollback to it — reads nothing but
          // cloudinary_url/width/height, so without this a post synced now would
          // render as a broken image there. Stop writing these when the
          // cloudinary_* columns are dropped ("Retiring Cloudinary", README).
          item.folder,
          item.ext,
          // The Instagram CDN URL. It will expire — it is kept for provenance,
          // mirroring how the export-era rows kept their zip-relative path.
          item.url,
          item.createdAt,
          JSON.stringify(item.raw),
        ]
      );
    }

    await client.query("commit");
    return { inserted: true, postId };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Pull recent Instagram posts, copy their media into Vercel Blob, and insert
 * anything not already present.
 *
 * Idempotent: existing posts are matched by source_key and skipped without any
 * download or upload, so running it repeatedly is cheap and safe.
 *
 * timeBudgetMs stops the run from starting another post once that much time
 * has passed, so a deployed function returns its summary before maxDuration
 * kills it. Whatever is left over is picked up by the next run.
 */
export async function syncInstagram({
  maxPosts = DEFAULT_MAX_POSTS,
  maxUploads = DEFAULT_MAX_UPLOADS,
  dryRun = false,
  timeBudgetMs = Infinity,
} = {}) {
  const startedAt = Date.now();
  const summary = {
    dryRun,
    startDate: SNAPSHOTS_START.toISOString(),
    fetched: 0,
    alreadyPresent: 0,
    skipped: [],
    inserted: [],
    uploads: 0,
    deferred: 0,
    warnings: [],
    errors: [],
  };

  // Refresh FIRST, before anything else can throw. This is the only code path
  // that keeps the Instagram token alive, and a refresh resets its full 60 days
  // — so if an unrelated misconfiguration (say a missing Blob token)
  // aborted the run before this line, the token would quietly go unrefreshed
  // until it expired, turning a one-line config fix into a permanent outage
  // needing a new token from the Meta dashboard.
  const accessToken = await ensureFreshToken();

  if (dryRun) {
    // Proves the deployed function can reach the store and load sharp, without
    // uploading or resizing anything.
    summary.blob = await checkBlobAccess(await findAnyStoredPathname());
    summary.resize = await checkResizer();
  } else if (!isBlobConfigured()) {
    throw new Error(
      "[instagram-sync] Vercel Blob is not configured. Connect a Blob store to the project, or set BLOB_READ_WRITE_TOKEN."
    );
  }

  // Only one uploading run at a time. Taken after the token refresh on purpose:
  // that refresh must happen on every run, even one that then stands down.
  if (!dryRun) {
    if (!(await acquireLease())) {
      summary.skipped.push({ id: "run", reason: "another sync is already running" });
      return summary;
    }
  }

  try {
    return await runSync({ accessToken, maxPosts, maxUploads, dryRun, timeBudgetMs, startedAt, summary });
  } finally {
    if (!dryRun) await releaseLease().catch(() => {});
  }
}

async function runSync({ accessToken, maxPosts, maxUploads, dryRun, timeBudgetMs, startedAt, summary }) {
  const raw = await fetchRecentMedia({ accessToken, maxPosts });
  summary.fetched = raw.length;

  const posts = [];
  for (const item of raw) {
    const normalized = normalize(item);
    if (!normalized) {
      summary.skipped.push({ id: item.id, reason: "no permalink/shortcode" });
      continue;
    }
    if (!normalized.postedAt || Number.isNaN(normalized.postedAt.getTime())) {
      summary.skipped.push({ id: item.id, reason: "missing timestamp" });
      continue;
    }
    posts.push(normalized);
  }

  const existing = await findExistingSourceKeys(posts.map((p) => p.sourceKey));
  const unmatched = posts.filter((p) => !existing.has(p.sourceKey));
  summary.alreadyPresent = posts.length - unmatched.length;

  const missing = [];
  for (const post of unmatched) {
    if (post.postedAt < SNAPSHOTS_START) {
      summary.skipped.push({
        id: post.shortcode,
        reason: `before the /snapshots start date (${summary.startDate.slice(0, 10)})`,
      });
      continue;
    }
    missing.push(post);
  }

  // Oldest first, so an interrupted backlog fills in chronologically and the
  // page never shows a gap in the middle.
  missing.sort((a, b) => a.postedAt - b.postedAt);

  for (const [index, post] of missing.entries()) {
    const usable = post.media.filter((m) => m.kind && m.url);
    const unusable = post.media.length - usable.length;

    if (usable.length === 0) {
      summary.skipped.push({ id: post.shortcode, reason: "no usable media" });
      continue;
    }
    if (unusable > 0) {
      // Never insert a partial carousel — position numbering would be wrong and
      // the unique (post_id, position) index would cement the mistake.
      summary.skipped.push({
        id: post.shortcode,
        reason: `${unusable} of ${post.media.length} media items unusable`,
      });
      continue;
    }

    // Out of upload budget. Everything from here on is simply left for the next
    // run — count it from the loop position, not from the skipped/inserted
    // tallies, which also include posts that never entered this loop.
    //
    // `summary.uploads > 0` guarantees the head of the queue always gets
    // processed. Without it, a post with more slides than maxUploads would trip
    // this check at index 0 with nothing uploaded, break immediately, and — since
    // the queue is sorted deterministically oldest-first — do exactly the same on
    // every future run, wedging the sync forever while still reporting a
    // healthy-looking deferral. Letting one oversized post exceed the cap is
    // bounded: Instagram allows at most 20 slides per carousel.
    if (summary.uploads > 0 && summary.uploads + usable.length > maxUploads) {
      summary.deferred = missing.length - index;
      break;
    }
    if (Date.now() - startedAt > timeBudgetMs) {
      summary.deferred = missing.length - index;
      break;
    }

    if (dryRun) {
      summary.inserted.push({
        shortcode: post.shortcode,
        postedAt: post.postedAt.toISOString(),
        mediaCount: usable.length,
        caption: post.caption.slice(0, 80),
        dryRun: true,
      });
      summary.uploads += usable.length;
      continue;
    }

    try {
      await renewLease();
      const prepared = await prepareMedia(post, usable, summary.warnings);

      const stored = [];
      for (const item of prepared) {
        const blob = await uploadToBlob(item.pathname, item.buffer, item.contentType);
        summary.uploads += 1;
        stored.push({ ...item, buffer: undefined, blob });
      }

      const result = await insertPost(post, stored);
      if (result.inserted) {
        summary.inserted.push({
          shortcode: post.shortcode,
          postedAt: post.postedAt.toISOString(),
          mediaCount: stored.length,
          caption: post.caption.slice(0, 80),
        });
      } else {
        summary.alreadyPresent += 1;
      }
    } catch (error) {
      // One bad post must not abort the run — the rest are independent.
      console.error(`[instagram-sync] ${post.shortcode} failed:`, error.message);
      summary.errors.push({ id: post.shortcode, error: error.message });
    }
  }

  return summary;
}
