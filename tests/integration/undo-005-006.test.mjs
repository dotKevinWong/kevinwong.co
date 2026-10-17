import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { testDb } from "../helpers/db.mjs";

const db = testDb();
const sqlFile = (name) => fileURLToPath(new URL(`../../sql/${name}`, import.meta.url));
const DELETE_SPOTIFY = sqlFile("undo/delete-spotify-row.sql");
const UNDO = sqlFile("undo/undo-005-006.sql");
const M005 = sqlFile("005_integration_tokens_spotify.sql");
const M006 = sqlFile("006_sync_runs.sql");

// The way db:apply sends a file: all of it as one parameterless query, so pg uses the simple-query
// protocol and Postgres stops at the first failing statement.
const apply = async (file) => db.pool.query(await fs.readFile(file, "utf8"));

const SPOTIFY_COLUMNS = ["account_id", "authorized_at", "refresh_token", "scopes"];
// The columns integration_tokens had before 005, as in tests/fixtures/prod-schema.sql.
const INSTAGRAM_ROW = `select provider, access_token, expires_at, refreshed_at, dead_reason, created_at, updated_at,
                              expires_at_is_assumed
                         from integration_tokens where provider = 'instagram'`;

/** The parts of `public` that 005 and 006 change. */
async function schema() {
  const q = async (sql) => (await db.pool.query(sql)).rows;
  return {
    columns: await q(
      `select column_name, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = 'integration_tokens' order by column_name`
    ),
    constraints: (await q(
      "select conname from pg_constraint where conrelid = 'public.integration_tokens'::regclass order by conname"
    )).map((row) => row.conname),
    relations: (await q(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' order by c.relname`
    )).map((row) => row.relname),
  };
}

const tables = async () =>
  (await db.pool.query("select to_regclass('sync_runs') as sync_runs, to_regclass('admin_audit_log') as admin_audit_log"))
    .rows[0];

async function seed({ spotify }) {
  await db.pool.query(
    `insert into integration_tokens (provider, access_token, expires_at, refreshed_at, created_at, updated_at)
     values ('instagram', 'IGQ-test-token', '2026-12-01T00:00:00Z', '2026-10-01T00:00:00Z',
             '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z')`
  );
  if (spotify) {
    await db.pool.query(
      `insert into integration_tokens (provider, refresh_token, expires_at, expires_at_is_assumed, authorized_at,
                                       account_id, scopes)
       values ('spotify', 'AQ-test-refresh', '2027-04-15T00:00:00Z', true, '2026-10-17T00:00:00Z', 'owner',
               'user-read-currently-playing user-top-read user-read-recently-played')`
    );
  }
  await db.pool.query("insert into sync_runs (job, trigger, dry_run, status, uploads) values ('instagram', 'cron', false, 'ok', 3)");
}

describe("undoing 005 and 006 (sql/undo)", { skip: db.skip }, () => {
  let beforeMigrations;

  before(async () => {
    await db.resetSchema({ applyMigrations: false });
    beforeMigrations = await schema();
  });
  after(() => db.close());

  test("with a spotify row present, the undo fails with 23502 and changes nothing", async () => {
    await db.resetSchema();
    await seed({ spotify: true });
    const migrated = await schema();

    await assert.rejects(apply(UNDO), {
      code: "23502",
      message: /^column "access_token" of relation "integration_tokens" contains null values$/,
    });

    assert.deepEqual(await tables(), { sync_runs: "sync_runs", admin_audit_log: "admin_audit_log" });
    const unchanged = await schema();
    assert.ok(unchanged.columns.some((column) => column.column_name === "refresh_token"));
    assert.deepEqual(unchanged, migrated);
    const { rows } = await db.pool.query("select provider from integration_tokens order by provider");
    assert.deepEqual(rows.map((row) => row.provider), ["instagram", "spotify"]);
    const runs = await db.pool.query("select uploads from sync_runs");
    assert.deepEqual(runs.rows, [{ uploads: 3 }]);
  });

  test("after the spotify row is deleted, the undo returns the schema to before 005 and 006", async () => {
    await db.resetSchema();
    await seed({ spotify: true });
    const instagram = (await db.pool.query(INSTAGRAM_ROW)).rows;

    await apply(DELETE_SPOTIFY);
    await apply(UNDO);

    const undone = await schema();
    const names = undone.columns.map((column) => column.column_name);
    for (const column of SPOTIFY_COLUMNS) assert.ok(!names.includes(column), `${column} is gone`);
    assert.equal(undone.columns.find((column) => column.column_name === "access_token").is_nullable, "NO");
    assert.ok(!undone.constraints.includes("integration_tokens_has_token"));
    assert.deepEqual(await tables(), { sync_runs: null, admin_audit_log: null });
    assert.deepEqual(undone, beforeMigrations);
    assert.deepEqual((await db.pool.query(INSTAGRAM_ROW)).rows, instagram);
    assert.equal(instagram.length, 1);
    const { rows } = await db.pool.query("select provider from integration_tokens");
    assert.deepEqual(rows, [{ provider: "instagram" }]);

    // Safe to run twice.
    await apply(UNDO);
    assert.deepEqual(await schema(), beforeMigrations);
  });

  test("005 and 006 apply again after the undo, and the schema comes back", async () => {
    await db.resetSchema();
    const migrated = await schema();
    await seed({ spotify: false });

    await apply(DELETE_SPOTIFY);
    await apply(UNDO);
    await apply(M005);
    await apply(M006);

    assert.deepEqual(await schema(), migrated);
    assert.deepEqual(await tables(), { sync_runs: "sync_runs", admin_audit_log: "admin_audit_log" });
  });
});
