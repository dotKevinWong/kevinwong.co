#!/usr/bin/env node
/**
 * Run the Instagram sync locally — for the initial backfill and for testing
 * before the cron is enabled.
 *
 *   npm run instagram:sync -- --dry-run           # fetch and report, write nothing
 *   npm run instagram:sync                        # normal run (same bounds as cron)
 *   npm run instagram:sync -- --max-uploads=200   # drain a backlog in one go
 *   npm run instagram:sync -- --probe-caption     # re-test whether caption is readable
 *
 * A dry run still calls the Instagram API (and so needs a valid stored token),
 * but touches neither Cloudinary nor the database.
 */

import { loadEnvFiles } from "./load-env.mjs";

// lib/cloudinary.js reads process.env at import time, so the env files have to
// be applied before any lib module is loaded — hence the dynamic imports below.
const fileEnv = loadEnvFiles();
for (const [key, value] of Object.entries(fileEnv)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  // A typo like --max-uploads=all would otherwise become NaN, and every
  // comparison against NaN is false — silently removing the upload cap or
  // fetching nothing at all, with no error to explain it.
  const parsed = Number(hit.split("=")[1]);
  if (!Number.isFinite(parsed) || parsed < 1) {
    console.error(`Invalid --${name}: expected a positive number, got "${hit.split("=")[1]}"`);
    process.exit(1);
  }
  return Math.floor(parsed);
};

const dryRun = flag("dry-run");

if (flag("help") || flag("h")) {
  console.log(`
Usage: npm run instagram:sync -- [options]

  --dry-run            Fetch and report without writing to Cloudinary or Postgres
  --max-posts=N        How many recent posts to read from the API (default 50)
  --max-uploads=N      Cap media uploads this run (default 25; backlogs resume later)
  --probe-caption      Test whether this token can read the caption field
  --help               Show this message
`);
  process.exit(0);
}

if (flag("probe-caption")) {
  const { ensureFreshToken, probeCaptionSupport } = await import("../lib/instagram.js");
  const token = await ensureFreshToken();
  const result = await probeCaptionSupport(token);
  console.log("\ncaption field probe:");
  console.log(`  supported: ${result.supported}`);
  if (result.supported) {
    console.log(`  sample:    ${JSON.stringify(result.sample)}`);
    console.log(
      "\n  Readable, as expected. (Meta's docs badge caption as Facebook-Login-only,\n" +
        "  but Instagram Login tokens have been able to read it in practice.)\n"
    );
  } else {
    console.log(`  reason:    ${result.reason}`);
    console.log(
      "\n  Meta is now enforcing the Facebook-Login-only badge on caption. Remove\n" +
        "  \"caption\" from MEDIA_FIELDS in lib/instagram.js or every sync will fail.\n"
    );
  }
  process.exit(0);
}

const { syncInstagram } = await import("../lib/instagram-sync.js");

const summary = await syncInstagram({
  dryRun,
  maxPosts: value("max-posts", 50),
  maxUploads: value("max-uploads", dryRun ? 1000 : 25),
});

console.log(`\n${dryRun ? "DRY RUN — nothing was written" : "Sync complete"}`);
console.log(`  start date:        ${summary.startDate.slice(0, 10)} (older posts are ignored)`);
console.log(`  fetched from API:  ${summary.fetched}`);
console.log(`  already in db:     ${summary.alreadyPresent}`);
console.log(`  ${dryRun ? "would insert" : "inserted"}:      ${summary.inserted.length}`);
console.log(`  media ${dryRun ? "to upload" : "uploaded"}:   ${summary.uploads}`);
console.log(`  deferred to later: ${summary.deferred}`);
console.log(`  skipped:           ${summary.skipped.length}`);
console.log(`  errors:            ${summary.errors.length}`);

if (summary.inserted.length > 0) {
  console.log(`\n${dryRun ? "Would insert" : "Inserted"}:`);
  for (const p of summary.inserted) {
    console.log(`  ${p.postedAt.split("T")[0]}  ${p.shortcode}  (${p.mediaCount} media)`);
    console.log(`      caption: ${p.caption ? JSON.stringify(p.caption) : "(none)"}`);
  }
}

if (summary.skipped.length > 0) {
  console.log("\nSkipped:");
  for (const s of summary.skipped) console.log(`  ${s.id}: ${s.reason}`);
}

if (summary.errors.length > 0) {
  console.log("\nErrors:");
  for (const e of summary.errors) console.log(`  ${e.id}: ${e.error}`);
  process.exitCode = 1;
}

console.log("");
process.exit(process.exitCode ?? 0);
