import { getDbPool } from "./db.js";
import {
  ensureFreshToken,
  fetchRecentMedia,
  shortcodeFromPermalink,
  sourceKeyForShortcode,
} from "./instagram.js";
import { extensionFor, isMissingCredentials, mirrorToCloudinary } from "./cloudinary.js";

// Bounds for a single invocation. A daily cron only ever has a handful of new
// posts, but the first run after a long gap could have dozens — and each media
// item is a Cloudinary round trip. Capping uploads keeps any one invocation
// inside the function duration budget; whatever is left is simply picked up
// tomorrow, because the sync is driven by "what is missing", not by a cursor.
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
    // caption is Facebook-Login-only, so it is absent under this token. Keep the
    // handling rather than hardcoding "": if the field ever becomes readable the
    // sync picks it up with no further change.
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
 * Newest post that cannot be matched to an API post.
 *
 * The posts imported from the data-export ZIP are keyed by a path inside that
 * archive, so the only way to recognise them again from the API is the permalink
 * — and 18 of the 21 have `instagram_url = null`, so they cannot be recognised
 * at all. Their dates stop cleanly at 2025-10-25; every post after that does
 * carry a permalink.
 *
 * So anything the API returns at or before this timestamp is assumed to be one
 * of those unmatchable rows and is left alone. Without this the sync would
 * re-import years of posts as duplicates, and the (post_id, position) index
 * would not catch it because they would be genuinely new posts.
 */
async function findLegacyWatermark() {
  const pool = getDbPool();
  const { rows } = await pool.query(
    `select max(posted_at) as watermark
       from instagram_posts
      where source_key not like 'ig:%'`
  );
  const value = rows[0]?.watermark;
  return value ? new Date(value) : null;
}

/**
 * Insert one post and its media atomically.
 *
 * A transaction per post (rather than per run) means a failure partway through a
 * backlog keeps everything already imported and simply leaves the rest for the
 * next invocation — no half-written post with missing slides.
 */
async function insertPost(post, mirrored) {
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

    for (const item of mirrored) {
      await client.query(
        `insert into instagram_media
           (post_id, position, kind,
            cloudinary_public_id, cloudinary_url, cloudinary_version,
            cloudinary_resource_type, cloudinary_format,
            cloudinary_width, cloudinary_height, cloudinary_duration,
            cloudinary_folder, file_ext, source_uri, source_created_at,
            raw_media_json)
         values ($1, $2, $3::media_kind, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
         on conflict (post_id, position) do nothing`,
        [
          postId,
          item.position,
          item.kind,
          item.cloudinary.publicId,
          item.cloudinary.url,
          item.cloudinary.version,
          item.cloudinary.resourceType,
          item.cloudinary.format,
          item.cloudinary.width,
          item.cloudinary.height,
          item.cloudinary.duration,
          item.cloudinary.folder,
          item.fileExt,
          // The Instagram CDN URL. It will expire — it is kept for provenance,
          // mirroring how the export-era rows kept their zip-relative path.
          item.sourceUrl,
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
 * Pull recent Instagram posts, mirror their media to Cloudinary, and insert
 * anything not already present.
 *
 * Idempotent: existing posts are matched by source_key and skipped without any
 * Cloudinary work, so running it repeatedly is cheap and safe.
 */
export async function syncInstagram({
  maxPosts = DEFAULT_MAX_POSTS,
  maxUploads = DEFAULT_MAX_UPLOADS,
  dryRun = false,
  // Escape hatch for once the export-era rows have been given real permalinks.
  ignoreWatermark = false,
} = {}) {
  const summary = {
    dryRun,
    watermark: null,
    fetched: 0,
    alreadyPresent: 0,
    skipped: [],
    inserted: [],
    uploads: 0,
    deferred: 0,
    errors: [],
  };

  // Refresh FIRST, before anything else can throw. This is the only code path
  // that keeps the Instagram token alive, and a refresh resets its full 60 days
  // — so if an unrelated misconfiguration (say a rotated Cloudinary secret)
  // aborted the run before this line, the token would quietly go unrefreshed
  // until it expired, turning a one-line config fix into a permanent outage
  // needing a new token from the Meta dashboard.
  const accessToken = await ensureFreshToken();

  if (!dryRun && isMissingCredentials()) {
    throw new Error(
      "[instagram-sync] Cloudinary credentials missing. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET."
    );
  }

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

  const watermark = ignoreWatermark ? null : await findLegacyWatermark();
  summary.watermark = watermark ? watermark.toISOString() : null;

  const missing = [];
  for (const post of unmatched) {
    if (watermark && post.postedAt <= watermark) {
      summary.skipped.push({
        id: post.shortcode,
        reason: `at or before the legacy watermark (${summary.watermark}) — assumed already imported from the data export`,
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

    if (dryRun) {
      summary.inserted.push({
        shortcode: post.shortcode,
        postedAt: post.postedAt.toISOString(),
        mediaCount: usable.length,
        dryRun: true,
      });
      summary.uploads += usable.length;
      continue;
    }

    try {
      const mirrored = [];
      for (const item of usable) {
        const cloud = await mirrorToCloudinary({
          sourceUrl: item.url,
          kind: item.kind,
          postedAt: post.postedAt,
          mediaId: item.mediaId,
        });
        mirrored.push({
          ...item,
          cloudinary: cloud,
          fileExt: extensionFor(item.url, item.kind),
          sourceUrl: item.url,
        });
        summary.uploads += 1;
      }

      const result = await insertPost(post, mirrored);
      if (result.inserted) {
        summary.inserted.push({
          shortcode: post.shortcode,
          postedAt: post.postedAt.toISOString(),
          mediaCount: mirrored.length,
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
