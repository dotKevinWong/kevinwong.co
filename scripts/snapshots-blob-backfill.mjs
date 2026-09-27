#!/usr/bin/env node
/**
 * Copy the /snapshots media that is still on Cloudinary into Vercel Blob.
 *
 *   npm run snapshots:blob                 # dry run: what would be copied, and where
 *   npm run snapshots:blob -- --apply      # copy (resumable: re-run until nothing is left)
 *   npm run snapshots:blob -- --verify     # check every stored object against the database
 *
 * Needs BLOB_READ_WRITE_TOKEN and DATABASE_URL. The Cloudinary originals are
 * public URLs, so no Cloudinary credentials are involved — and nothing on
 * Cloudinary is changed or deleted. The live site keeps reading cloudinary_*
 * until the new code is deployed, so this can run safely beforehand.
 *
 * Costs, against the Hobby plan: one Blob upload ("advanced operation", 2,000 a
 * month) per file for --apply, and two "simple operations" (10,000 a month) per
 * file for --verify.
 */

import { loadEnvFiles } from "./load-env.mjs";

// lib/blob-store.js reads process.env when it loads, so apply the env files first.
const fileEnv = loadEnvFiles();
for (const [key, value] of Object.entries(fileEnv)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const VERIFY = args.includes("--verify");
const CONCURRENCY = 4;

const { getDbPool } = await import("../lib/db.js");
const { downloadMedia, isBlobConfigured, pathnameFor, uploadToBlob } = await import("../lib/blob-store.js");
const { probeMedia } = await import("../lib/media-probe.js");
const { head } = await import("@vercel/blob");

if ((APPLY || VERIFY) && !isBlobConfigured()) {
  console.error("\nBLOB_READ_WRITE_TOKEN is not set. Add it to .env (from the Blob store's settings).\n");
  process.exit(1);
}

const pool = getDbPool();

/** Run fn over items with at most `limit` in flight. */
async function eachLimited(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const { rows } = await pool.query(`
  select m.id, m.position, m.kind, m.cloudinary_url, m.cloudinary_width, m.cloudinary_height,
         m.asset_url, m.asset_pathname, m.asset_bytes, m.asset_content_type,
         p.source_key, p.posted_at
    from instagram_media m
    join instagram_posts p on p.id = m.post_id
   order by p.posted_at, m.position`);

// ------------------------------------------------------------------ verify

if (VERIFY) {
  const problems = [];
  let checked = 0;

  await eachLimited(rows, CONCURRENCY, async (row) => {
    const label = `${row.source_key} #${row.position}`;
    if (!row.asset_url) {
      problems.push(`${label}: not copied yet`);
      return;
    }
    try {
      // The store's own record of the object...
      const meta = await head(row.asset_pathname);
      if (Number(meta.size) !== Number(row.asset_bytes)) {
        problems.push(`${label}: store has ${meta.size} bytes, database says ${row.asset_bytes}`);
      }

      // ...and what a visitor's browser would actually get. Videos are asked for
      // a byte range: Safari will not play a <video> whose source ignores Range.
      const headers = row.kind === "video" ? { Range: "bytes=0-1023" } : {};
      const res = await fetch(row.asset_url, { headers });
      await res.arrayBuffer();
      const want = row.kind === "video" ? 206 : 200;
      if (res.status !== want) problems.push(`${label}: public URL returned ${res.status}, expected ${want}`);
      checked += 1;
    } catch (error) {
      problems.push(`${label}: ${error.name}: ${error.message}`);
    }
  });

  console.log(`\nVerified ${checked}/${rows.length} objects.`);
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems) console.log(`  ${p}`);
    process.exitCode = 1;
  } else {
    console.log("All present in the store, sizes match, and public URLs serve (videos with 206).\n");
  }
  await pool.end();
  process.exit(process.exitCode ?? 0);
}

// ------------------------------------------------------------------ plan

const done = rows.filter((r) => r.asset_url);
const todo = [];
const blocked = [];

for (const row of rows) {
  if (row.asset_url) continue;
  if (!row.source_key.startsWith("ig:")) {
    // Pathnames are built from the post's shortcode; run instagram:repair first.
    blocked.push({ row, reason: "post has no ig: source_key (run npm run instagram:repair)" });
    continue;
  }
  todo.push({ row, shortcode: row.source_key.slice(3) });
}

console.log(`\n${rows.length} media rows: ${done.length} already on Blob, ${todo.length} to copy, ${blocked.length} blocked.`);
for (const { row, reason } of blocked) console.log(`  blocked ${row.id}: ${reason}`);

if (!APPLY) {
  // Sizes come from HEAD requests to Cloudinary: free, and nothing is downloaded.
  let total = 0;
  const unreachable = [];
  await eachLimited(todo, 8, async ({ row }) => {
    const res = await fetch(row.cloudinary_url, { method: "HEAD" }).catch(() => null);
    const len = Number(res?.headers.get("content-length") || 0);
    if (!res?.ok || !len) unreachable.push(row.id);
    else total += len;
  });
  const sample = todo.slice(0, 3).map(({ row, shortcode }) =>
    pathnameFor({ postedAt: row.posted_at, shortcode, position: row.position, ext: row.kind === "video" ? "mp4" : "jpg" })
  );
  console.log(`  total to copy: ${mb(total)}   unreachable on Cloudinary: ${unreachable.length}`);
  if (sample.length) console.log(`  example destinations: ${sample.join(", ")}`);
  console.log("\nDry run. Re-run with --apply to copy.\n");
  await pool.end();
  process.exit(unreachable.length ? 1 : 0);
}

// ------------------------------------------------------------------ apply

let copied = 0;
let bytes = 0;
const failures = [];
const dimensionMismatches = [];

await eachLimited(todo, CONCURRENCY, async ({ row, shortcode }) => {
  const label = `${shortcode} #${row.position}`;
  try {
    const buffer = await downloadMedia(row.cloudinary_url);
    const probe = probeMedia(buffer); // throws on bytes that are not media
    if (probe.kind !== row.kind) throw new Error(`database says ${row.kind}, file is ${probe.format}`);

    // Keep the dimensions the page renders with today, so nothing shifts on the
    // switch; the probe is a cross-check.
    const width = row.cloudinary_width ?? probe.width;
    const height = row.cloudinary_height ?? probe.height;
    if (probe.width && (probe.width !== width || probe.height !== height)) {
      dimensionMismatches.push(`${label}: database ${width}x${height}, file ${probe.width}x${probe.height}`);
    }

    const pathname = pathnameFor({ postedAt: row.posted_at, shortcode, position: row.position, ext: probe.ext });
    const blob = await uploadToBlob(pathname, buffer, probe.mime);

    // `asset_url is null` makes a concurrent or repeated run a no-op here.
    await pool.query(
      `update instagram_media
          set asset_url = $2, asset_pathname = $3, asset_content_type = $4,
              asset_bytes = $5, asset_width = $6, asset_height = $7, updated_at = now()
        where id = $1 and asset_url is null`,
      [row.id, blob.url, blob.pathname, blob.contentType, buffer.length, width, height]
    );
    copied += 1;
    bytes += buffer.length;
    if (copied % 20 === 0) console.log(`  ${copied}/${todo.length} copied (${mb(bytes)})`);
  } catch (error) {
    failures.push(`${label}: ${error.name}: ${error.message}`);
  }
});

console.log(`\nCopied ${copied}/${todo.length} (${mb(bytes)}).`);
if (dimensionMismatches.length) {
  console.log(`\nDimension mismatches (kept the database values):`);
  for (const d of dimensionMismatches) console.log(`  ${d}`);
}
if (failures.length) {
  console.log(`\n${failures.length} failed — re-run --apply to retry just these:`);
  for (const f of failures) console.log(`  ${f}`);
  process.exitCode = 1;
} else {
  console.log("Done. Next: npm run snapshots:blob -- --verify\n");
}

await pool.end();
process.exit(process.exitCode ?? 0);
