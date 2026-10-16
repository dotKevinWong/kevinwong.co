import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { applySqlFiles } from "../../scripts/db-apply.mjs";
import { testDb } from "../helpers/db.mjs";

const db = testDb();
const M005 = fileURLToPath(new URL("../../sql/005_integration_tokens_spotify.sql", import.meta.url));
const M006 = fileURLToPath(new URL("../../sql/006_sync_runs.sql", import.meta.url));
const quiet = { log: () => {} };
const CHECK_FAILED = { code: "23514", constraint: "integration_tokens_has_token" };

describe("migrations 005 and 006", { skip: db.skip }, () => {
  before(async () => {
    await db.resetSchema({ applyMigrations: false });
    await db.pool.query(
      `insert into integration_tokens (provider, access_token, expires_at)
       values ('instagram', 'IGQ-test-token', '2026-12-01T00:00:00Z')`
    );
    await applySqlFiles(process.env.TEST_DATABASE_URL, [M005, M006], quiet);
  });
  after(() => db.close());

  test("apply a second time without error", async () => {
    await assert.doesNotReject(applySqlFiles(process.env.TEST_DATABASE_URL, [M005, M006], quiet));
  });

  test("leave the existing instagram row as it was", async () => {
    const { rows } = await db.pool.query(
      `select provider, access_token, expires_at, expires_at_is_assumed, dead_reason,
              refresh_token, authorized_at, account_id, scopes
         from integration_tokens`
    );
    assert.deepEqual(rows, [
      {
        provider: "instagram",
        access_token: "IGQ-test-token",
        expires_at: new Date("2026-12-01T00:00:00Z"),
        expires_at_is_assumed: false,
        dead_reason: null,
        refresh_token: null,
        authorized_at: null,
        account_id: null,
        scopes: null,
      },
    ]);
  });

  test("make access_token nullable, so a row with only a refresh token fits", async () => {
    const { rows } = await db.pool.query(
      `select is_nullable from information_schema.columns
        where table_name = 'integration_tokens' and column_name = 'access_token'`
    );
    assert.equal(rows[0].is_nullable, "YES");
    await db.pool.query(
      `insert into integration_tokens (provider, refresh_token, expires_at)
       values ('spotify', 'AQ-test-refresh', now() + interval '180 days')`
    );
    await db.pool.query("delete from integration_tokens where provider = 'spotify'");
  });

  test("reject a row with neither token", async () => {
    await assert.rejects(
      db.pool.query("insert into integration_tokens (provider, expires_at) values ('neither', now())"),
      CHECK_FAILED
    );
    await assert.rejects(
      db.pool.query("update integration_tokens set access_token = null where provider = 'instagram'"),
      CHECK_FAILED
    );
  });

  test("give sync_runs its defaults", async () => {
    const { rows } = await db.pool.query(
      `insert into sync_runs (job, trigger, dry_run) values ('instagram', 'cron', false)
       returning status, fetched, imported, uploads, deferred, skipped, error_count,
                 finished_at, error, summary, started_at <= now() as started`
    );
    assert.deepEqual(rows[0], {
      status: "running",
      fetched: 0,
      imported: 0,
      uploads: 0,
      deferred: 0,
      skipped: 0,
      error_count: 0,
      finished_at: null,
      error: null,
      summary: null,
      started: true,
    });
  });

  test("limit sync_runs.trigger and sync_runs.status to the known values", async () => {
    const insert = "insert into sync_runs (job, trigger, dry_run, status) values ('instagram', $1, true, $2)";
    for (const trigger of ["cron", "panel", "cli"]) await db.pool.query(insert, [trigger, "ok"]);
    for (const status of ["running", "ok", "partial", "skipped", "failed", "reauth_required", "abandoned"]) {
      await db.pool.query(insert, ["cli", status]);
    }
    await assert.rejects(db.pool.query(insert, ["web", "ok"]), {
      code: "23514",
      constraint: "sync_runs_trigger_check",
    });
    await assert.rejects(db.pool.query(insert, ["cron", "done"]), {
      code: "23514",
      constraint: "sync_runs_status_check",
    });
  });

  test("generate ids and refuse explicit ones", async () => {
    await assert.rejects(
      db.pool.query("insert into sync_runs (id, job, trigger, dry_run) values (1, 'instagram', 'cron', false)"),
      { code: "428C9" }
    );
    await assert.rejects(
      db.pool.query("insert into admin_audit_log (id, event) values (1, 'sign_in')"),
      { code: "428C9" }
    );
  });

  test("give admin_audit_log its defaults", async () => {
    const { rows } = await db.pool.query(
      "insert into admin_audit_log (event) values ('sign_in') returning actor, details, at <= now() as stamped"
    );
    assert.deepEqual(rows[0], { actor: null, details: {}, stamped: true });
  });

  test("create both indexes", async () => {
    const { rows } = await db.pool.query(
      `select indexname, indexdef from pg_indexes
        where indexname in ('sync_runs_job_started_at_idx', 'admin_audit_log_at_idx')
        order by indexname`
    );
    assert.deepEqual(
      rows.map((row) => row.indexname),
      ["admin_audit_log_at_idx", "sync_runs_job_started_at_idx"]
    );
    assert.match(rows[0].indexdef, /\(at DESC\)/);
    assert.match(rows[1].indexdef, /\(job, started_at DESC\)/);
  });
});
