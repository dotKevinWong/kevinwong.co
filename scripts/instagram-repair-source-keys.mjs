#!/usr/bin/env node
/**
 * One-time reconciliation of export-era posts with API-era posts.
 *
 *   npm run instagram:repair            # dry run, shows exactly what would change
 *   npm run instagram:repair -- --apply # perform the rewrite
 *
 * The posts already in the database were ingested from an Instagram "Download
 * Your Information" ZIP, so their source_key looks like
 *
 *     1767050772:media/posts/202512/18121631782527066.jpg
 *
 * a creation timestamp joined to a path inside the archive. The API has no such
 * path — it identifies a post by an opaque media id and a permalink. If the sync
 * started inserting with API-derived keys, every one of these posts would be
 * fetched again, fail the source_key uniqueness check by not matching, and be
 * inserted a second time.
 *
 * The shortcode inside the permalink is the one identifier both sources can
 * produce, and these rows already carry the permalink in instagram_url. This
 * rewrites their source_key to `ig:<shortcode>`, keeping the original value in
 * raw_post_json.legacy_source_key so the change is reversible.
 */

import pg from "pg";
import { loadEnvFiles, requireEnv } from "./load-env.mjs";

const fileEnv = loadEnvFiles();
const apply = process.argv.includes("--apply");
const DATABASE_URL = requireEnv("DATABASE_URL", fileEnv);

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: true },
  max: 1,
});

/** Kept in step with shortcodeFromPermalink in lib/instagram.js. */
function shortcodeFromPermalink(permalink) {
  if (typeof permalink !== "string") return null;
  const match = permalink.match(/instagram\.com\/(?:p|reel|tv)\/([^/?#]+)/i);
  return match ? match[1] : null;
}

const { rows } = await pool.query(
  `select id, source_key, instagram_url, posted_at
     from instagram_posts
    order by posted_at asc`
);

const planned = [];
const blocked = [];
const alreadyDone = [];

for (const row of rows) {
  if (row.source_key.startsWith("ig:")) {
    alreadyDone.push(row);
    continue;
  }

  const shortcode = shortcodeFromPermalink(row.instagram_url);
  if (!shortcode) {
    blocked.push({ row, reason: "no usable permalink in instagram_url" });
    continue;
  }

  planned.push({ row, shortcode, newKey: `ig:${shortcode}` });
}

// Two rows resolving to the same shortcode would violate the unique index and
// means the data is not what we think it is — stop rather than guess.
const byNewKey = new Map();
for (const item of planned) {
  const list = byNewKey.get(item.newKey) || [];
  list.push(item);
  byNewKey.set(item.newKey, list);
}
const collisions = [...byNewKey.entries()].filter(([, list]) => list.length > 1);

console.log(`\n${rows.length} posts total`);
console.log(`  already migrated: ${alreadyDone.length}`);
console.log(`  to rewrite:       ${planned.length}`);
console.log(`  blocked:          ${blocked.length}`);
console.log(`  key collisions:   ${collisions.length}`);

if (planned.length > 0) {
  console.log("\nPlanned rewrites:");
  for (const { row, newKey } of planned) {
    const when = new Date(row.posted_at).toISOString().split("T")[0];
    console.log(`  ${when}  ${row.source_key}`);
    console.log(`         -> ${newKey}`);
  }
}

if (blocked.length > 0) {
  console.log("\nBLOCKED — these keep their existing source_key and WILL duplicate");
  console.log("if the same post is still visible to the API:");
  for (const { row, reason } of blocked) {
    console.log(`  ${row.id}  ${reason}  (instagram_url=${row.instagram_url ?? "null"})`);
  }
}

if (collisions.length > 0) {
  console.log("\nCOLLISIONS — refusing to write, two posts share a shortcode:");
  for (const [key, list] of collisions) {
    console.log(`  ${key}: ${list.map((i) => i.row.id).join(", ")}`);
  }
  await pool.end();
  process.exit(1);
}

if (!apply) {
  console.log("\nDry run. Re-run with --apply to perform the rewrite.\n");
  await pool.end();
  process.exit(0);
}

const client = await pool.connect();
try {
  await client.query("begin");
  for (const { row, newKey } of planned) {
    await client.query(
      `update instagram_posts
          set source_key    = $2,
              raw_post_json = jsonb_set(
                raw_post_json, '{legacy_source_key}', to_jsonb($3::text), true
              ),
              updated_at    = now()
        where id = $1`,
      [row.id, newKey, row.source_key]
    );
  }
  await client.query("commit");
  console.log(`\nRewrote ${planned.length} source_keys. Originals kept in raw_post_json.legacy_source_key.\n`);
} catch (error) {
  await client.query("rollback").catch(() => {});
  console.error(`\nRollback — nothing changed. ${error.message}\n`);
  process.exitCode = 1;
} finally {
  client.release();
}

await pool.end();
