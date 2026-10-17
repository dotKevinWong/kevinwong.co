import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "../helpers/db.mjs";
import { finishRun, incrementRunUploads, lastRun, recentRuns, startRun, uploadsInLastDays } from "../../lib/sync-runs.js";

const db = testDb();
const RUN_KEYS = ["deferred", "dryRun", "error", "errorCount", "fetched", "finishedAt", "id", "imported",
  "skipped", "startedAt", "status", "trigger", "uploads"];
const emptySummary = () => ({ fetched: 0, alreadyPresent: 0, inserted: [], uploads: 0, deferred: 0, skipped: [], warnings: [], errors: [] });

describe("sync-runs (integration)", { skip: db.skip }, () => {
  const pool = db.pool;
  const row = async (id) => (await pool.query("select * from sync_runs where id = $1", [id])).rows[0];
  const start = (trigger = "cron", dryRun = false) => startRun({ job: "instagram", trigger, dryRun }, pool);
  async function insertRun({ trigger = "cron", dryRun = false, status = "ok", ago = "1 hour", uploads = 0 } = {}) {
    const { rows } = await pool.query(
      `insert into sync_runs (job, trigger, dry_run, status, started_at, finished_at, uploads)
       values ('instagram', $1, $2, $3, now() - $4::interval,
               case when $3 = 'running' then null else now() - $4::interval end, $5)
       returning id`, [trigger, dryRun, status, ago, uploads]);
    return Number(rows[0].id);
  }
  const setLease = (offset) => pool.query(
    `insert into job_locks (name, locked_until) values ('instagram-sync', now() + $1::interval)
     on conflict (name) do update set locked_until = excluded.locked_until`, [offset]);

  before(() => db.resetSchema());
  beforeEach(async () => { await pool.query("delete from sync_runs"); await pool.query("delete from job_locks"); });
  after(() => db.close());

  test("startRun inserts a running row and returns its numeric id", async () => {
    const id = await start("cron", false);
    assert.equal(typeof id, "number");
    const r = await row(id);
    assert.deepEqual([r.job, r.trigger, r.dry_run, r.status, r.finished_at], ["instagram", "cron", false, "running", null]);
    assert.ok(Date.now() - r.started_at.getTime() < 60_000);
  });

  test("finishRun records the counts from the summary", async () => {
    const id = await start("panel", false);
    const summary = { ...emptySummary(), fetched: 7, alreadyPresent: 4, inserted: [{ shortcode: "A" }, { shortcode: "B" }],
      uploads: 5, deferred: 1, skipped: [{ id: "C", reason: "no usable media" }],
      errors: [{ id: "D", error: "Download failed: HTTP 404" }] };
    await finishRun(id, { status: "partial", summary }, pool);
    const r = await row(id);
    assert.deepEqual(
      [r.status, r.fetched, r.imported, r.uploads, r.deferred, r.skipped, r.error_count, r.error],
      ["partial", 7, 2, 5, 1, 1, 1, null]);
    assert.ok(r.finished_at instanceof Date);
    assert.equal(r.summary.fetched, 7);
    assert.deepEqual(r.summary.errors, [{ id: "D", error: "Download failed: HTTP 404" }]);
  });

  test("incrementRunUploads adds to uploads, and finishRun never lowers the count", async () => {
    const id = await start("cli", false);
    await incrementRunUploads(id, 1, pool);
    await incrementRunUploads(id, 2, pool);
    assert.equal((await row(id)).uploads, 3);
    await finishRun(id, { status: "failed", summary: { ...emptySummary(), uploads: 1 }, error: "stopped" }, pool);
    const r = await row(id);
    assert.deepEqual([r.status, r.uploads], ["failed", 3]);
  });

  test("incrementRunUploads counts whatever the row's status, so a run swept as abandoned keeps counting", async () => {
    const id = await start("cron", false);
    await pool.query("update sync_runs set status = 'abandoned', finished_at = now() where id = $1", [id]);
    await incrementRunUploads(id, 1, pool);
    const r = await row(id);
    assert.deepEqual([r.status, r.uploads], ["abandoned", 1]);
  });

  test("incrementRunUploads rejects when no row has that id, so the upload cannot go uncounted", async () => {
    const id = await start("cli", false);
    await assert.rejects(incrementRunUploads(id + 1_000_000, 1, pool), /no sync_runs row with id/);
    assert.equal((await row(id)).uploads, 0);
  });

  test("finishRun redacts the error and the stored summary, and leaves the caller's summary alone", async () => {
    const id = await start("cli", false);
    const summary = { ...emptySummary(), errors: [{ id: "run", error: "GET /me?access_token=IGQVJsecretvalue123 failed" }] };
    const copy = structuredClone(summary);
    await finishRun(id, { status: "failed", summary, error: "Authorization: Bearer abc.def.ghi was rejected" }, pool);
    const r = await row(id);
    assert.ok(!r.error.includes("abc.def.ghi"));
    assert.match(r.error, /\[redacted\]/);
    assert.ok(!JSON.stringify(r.summary).includes("IGQVJsecretvalue123"));
    assert.deepEqual(summary, copy);
  });

  test("finishRun stores a size-capped summary", async () => {
    const id = await start();
    const warnings = Array.from({ length: 1000 }, (_, i) => ({ id: `post ${i} slide 0`, warning: "could not read jpeg dimensions; frame will be square" }));
    await finishRun(id, { status: "ok", summary: { ...emptySummary(), warnings } }, pool);
    assert.equal((await row(id)).summary.truncated, true);
  });

  test("startRun marks a stale running row abandoned when the lease has expired", async () => {
    const stale = await insertRun({ status: "running", ago: "20 minutes" });
    await setLease("-1 minute");
    await start();
    const r = await row(stale);
    assert.equal(r.status, "abandoned");
    assert.ok(r.finished_at instanceof Date);
  });

  test("startRun treats a missing lease row as expired", async () => {
    const stale = await insertRun({ status: "running", ago: "20 minutes" });
    await start();
    assert.equal((await row(stale)).status, "abandoned");
  });

  test("startRun leaves a stale running row alone while the lease is held", async () => {
    const stale = await insertRun({ status: "running", ago: "20 minutes" });
    await setLease("5 minutes");
    await start();
    assert.equal((await row(stale)).status, "running");
  });

  test("startRun leaves a running row younger than 15 minutes alone", async () => {
    const young = await insertRun({ status: "running", ago: "14 minutes" });
    await start();
    assert.equal((await row(young)).status, "running");
  });

  test("startRun marks a running row just over 15 minutes old abandoned", async () => {
    const stale = await insertRun({ status: "running", ago: "16 minutes" });
    await start();
    assert.equal((await row(stale)).status, "abandoned");
  });

  test("startRun leaves finished rows older than 15 minutes alone", async () => {
    const before = [];
    for (const status of ["ok", "partial", "failed", "reauth_required", "skipped"]) {
      const id = await insertRun({ status, ago: "20 minutes" });
      before.push({ id, status, finishedAt: (await row(id)).finished_at.getTime() });
    }
    await start();
    for (const { id, status, finishedAt } of before) {
      const r = await row(id);
      assert.equal(r.status, status);
      assert.equal(r.finished_at.getTime(), finishedAt);
    }
  });

  test("a run swept as abandoned still records its real outcome when it finishes", async () => {
    const id = await insertRun({ status: "running", ago: "20 minutes" });
    await start();
    await finishRun(id, { status: "ok", summary: emptySummary() }, pool);
    assert.equal((await row(id)).status, "ok");
  });

  test("uploadsInLastDays sums real runs inside the window and ignores dry runs", async () => {
    assert.equal(await uploadsInLastDays(30, pool), 0);
    await insertRun({ uploads: 100, ago: "1 day" });
    await insertRun({ uploads: 7, ago: "1 minute" });
    await insertRun({ uploads: 500, dryRun: true, ago: "1 day" });
    await insertRun({ uploads: 40, ago: "31 days" });
    assert.equal(await uploadsInLastDays(30, pool), 107);
  });

  test("uploadsInLastDays counts a run 29 days old", async () => {
    await insertRun({ uploads: 5, ago: "29 days" });
    await insertRun({ uploads: 7, ago: "31 days" });
    assert.equal(await uploadsInLastDays(30, pool), 5);
  });

  test("uploadsInLastDays counts a real run whatever its status, so a crashed run still counts", async () => {
    await insertRun({ status: "running", uploads: 10 }); // killed mid-run, never finished
    await insertRun({ status: "abandoned", uploads: 20 }); // swept by startRun
    await insertRun({ status: "failed", uploads: 30 }); // e.g. UploadNotRecordedError
    await insertRun({ status: "ok", uploads: 40 });
    assert.equal(await uploadsInLastDays(30, pool), 100);
  });

  test("recentRuns returns newest first, camelCase, without the summary", async () => {
    await insertRun({ trigger: "cron", ago: "3 hours" });
    const middle = await insertRun({ trigger: "panel", dryRun: true, ago: "2 hours" });
    const newest = await insertRun({ trigger: "cli", ago: "1 hour" });
    const runs = await recentRuns({ limit: 2 }, pool);
    assert.deepEqual(runs.map((r) => r.id), [newest, middle]);
    assert.deepEqual(Object.keys(runs[0]).sort(), RUN_KEYS);
    assert.equal(runs[1].dryRun, true);
    assert.ok(runs[0].startedAt instanceof Date);
  });

  test("lastRun filters by trigger and dryRun", async () => {
    const cronReal = await insertRun({ trigger: "cron", ago: "3 hours" });
    const panelDry = await insertRun({ trigger: "panel", dryRun: true, ago: "2 hours" });
    const cronDry = await insertRun({ trigger: "cron", dryRun: true, ago: "1 hour" });
    assert.equal((await lastRun({ trigger: "cron", dryRun: false }, pool)).id, cronReal);
    assert.equal((await lastRun({ trigger: "panel" }, pool)).id, panelDry);
    assert.equal((await lastRun({}, pool)).id, cronDry);
    assert.equal(await lastRun({ trigger: "panel", dryRun: false }, pool), null);
  });
});
