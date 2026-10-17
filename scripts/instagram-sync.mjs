#!/usr/bin/env node
/**
 * Run the Instagram sync locally — for the initial backfill and for testing
 * before the cron is enabled.
 *
 *   npm run instagram:sync -- --dry-run           # fetch and report, upload/insert nothing
 *   npm run instagram:sync                        # normal run (same bounds as cron)
 *   npm run instagram:sync -- --max-uploads=200   # drain a backlog in one go
 *   npm run instagram:sync -- --probe-caption     # re-test whether caption is readable
 *
 * A dry run still calls the Instagram API (and so needs a valid stored token)
 * and reads the database, but downloads no media and writes nothing to Blob or
 * the posts tables. It makes one Blob head() request to confirm the store is
 * reachable. Like every run, though, it refreshes the stored Instagram token
 * when one is due, or marks it dead on a confirmed error 190 — that refresh is
 * what keeps the token alive, so no run skips it (see syncInstagram).
 */

import { loadEnvFiles } from "./load-env.mjs";

// lib/blob-store.js reads process.env at import time, so the env files have to
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

const USAGE = `
Usage: npm run instagram:sync -- [options]

  --dry-run            Fetch and report without uploading to Blob or inserting
                       posts (the stored token is still refreshed if one is due)
  --max-posts=N        How many recent posts to read from the API (default 50)
  --max-uploads=N      Cap media uploads this run (default 25; backlogs resume later; never past 1,800 in 30 days)
  --probe-caption      Test whether this token can read the caption field
  --help               Show this message
`;

// A mistyped option after the `--` (--dryrun, say) must not quietly fall
// through to a real run against production, so anything unrecognised stops here.
const unknown = args.filter(
  (a) => !/^--(dry-run|probe-caption|help|h|max-posts=.*|max-uploads=.*)$/.test(a)
);
if (unknown.length > 0) {
  console.error(`Unknown argument: ${unknown.join(" ")}\n${USAGE}`);
  process.exit(1);
}

// Forget the `--` and npm keeps every option for itself: argv stays empty, npm
// only warns "Unknown cli config", and each option lands in the env instead as
// npm_config_<name> (dashes become underscores). The check above never sees
// those, so --probe-caption or --dryrun would otherwise become a real,
// uploading sync. Refuse this script's options (and their undashed spellings)
// when they arrive that way. The correctly spelled --dry-run is the exception,
// honoured below; --help and -h never get this far, as npm answers them itself.
const swallowed = Object.keys(process.env).filter((key) =>
  /^npm_config_(dryrun|probe_?caption|max_?posts|max_?uploads)$/.test(key)
);
if (swallowed.length > 0) {
  const options = swallowed.map((key) => {
    const name = `--${key.slice("npm_config_".length).replaceAll("_", "-")}`;
    const setting = process.env[key];
    return setting === "true" || setting === "" ? name : `${name}=${setting}`;
  });
  console.error(
    `Put \`--\` before script options; npm kept these for itself: ${options.join(" ")}\n${USAGE}`
  );
  process.exit(1);
}

// `npm run instagram:sync --dry-run`, without the `--`, never reaches argv: npm
// takes --dry-run as its own config and only sets npm_config_dry_run. Honour
// that too, since the alternative is a real run the caller did not ask for.
const npmDryRun = process.env.npm_config_dry_run === "true" && !flag("dry-run");
const dryRun = flag("dry-run") || npmDryRun;

if (flag("help") || flag("h")) {
  console.log(USAGE);
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

if (npmDryRun) {
  console.log("npm took --dry-run as its own flag (no `--` before it); treating this as a dry run.");
}

const { syncInstagram } = await import("../lib/instagram-sync.js");

const summary = await syncInstagram({
  dryRun,
  maxPosts: value("max-posts", 50),
  maxUploads: value("max-uploads", dryRun ? 1000 : 25),
  trigger: "cli",
});

console.log(`\n${dryRun ? "DRY RUN — nothing was uploaded or inserted" : "Sync complete"}`);
console.log(`  start date:        ${summary.startDate.slice(0, 10)} (older posts are ignored)`);
console.log(`  fetched from API:  ${summary.fetched}`);
console.log(`  already in db:     ${summary.alreadyPresent}`);
console.log(`  ${dryRun ? "would insert" : "inserted"}:      ${summary.inserted.length}`);
console.log(`  media ${dryRun ? "to upload" : "uploaded"}:   ${summary.uploads}`);
console.log(`  deferred to later: ${summary.deferred}`);
console.log(`  skipped:           ${summary.skipped.length}`);
console.log(`  warnings:          ${summary.warnings.length}`);
console.log(`  errors:            ${summary.errors.length}`);
if (summary.blob) console.log(`  blob store:        ${summary.blob}`);
if (summary.resize) console.log(`  image resizing:    ${summary.resize}`);

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

if (summary.warnings.length > 0) {
  console.log("\nWarnings:");
  for (const w of summary.warnings) console.log(`  ${w.id}: ${w.warning}`);
}

if (summary.errors.length > 0) {
  console.log("\nErrors:");
  for (const e of summary.errors) console.log(`  ${e.id}: ${e.error}`);
  process.exitCode = 1;
}

console.log("");
process.exit(process.exitCode ?? 0);
