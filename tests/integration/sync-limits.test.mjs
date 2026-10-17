import { describe, test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "../helpers/db.mjs";
import {
  CHECK_MIN_GAP_MINUTES, IMPORT_WINDOW_HOURS, PANEL_UPLOAD_CEILING_30D, checkPanelRunAllowed,
  claimPanelSlot, releasePanelImportSlot,
} from "../../lib/admin/sync-limits.js";

const db = testDb();

// `on` is the pool, or the client of an atOneInstant transaction.
async function seedRun({ trigger = "panel", dryRun, status = "ok", ago, uploads = 0 }, on = db.pool) {
  await on.query(
    `insert into sync_runs (job, trigger, dry_run, status, started_at, uploads)
     values ('instagram', $1, $2, $3, now() - $4::interval, $5)`,
    [trigger, dryRun, status, ago, uploads]
  );
}
// A whole number of seconds, n or n - 1: each wait is n seconds less the few milliseconds since the seed's now().
const near = (v, n) => assert.ok(Number.isInteger(v) && v >= n - 1 && v <= n, `${v} not in [${n - 1}, ${n}]`);

// Runs fn(client) in one transaction, then rolls it back. now() is the transaction's start in every statement, so
// a wait comes out exact and a boundary can be hit to the microsecond.
async function atOneInstant(fn) {
  const client = await db.pool.connect();
  try {
    await client.query("begin");
    return await fn(client);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

describe("panel run limits", { skip: db.skip }, () => {
  before(() => db.resetSchema());
  beforeEach(() => db.pool.query("truncate sync_runs, job_locks restart identity"));
  after(() => db.close());

  test("constants are the D4 values", () => {
    assert.equal(CHECK_MIN_GAP_MINUTES, 10);
    assert.equal(IMPORT_WINDOW_HOURS, 24);
    assert.equal(PANEL_UPLOAD_CEILING_30D, 1000);
  });

  describe("Check (dryRun: true)", () => {
    test("allowed with no runs at all", async () => {
      assert.deepEqual(await checkPanelRunAllowed({ dryRun: true }, db.pool), { allowed: true });
    });
    test("refused 9 minutes after a panel check, retry in about 60 s", async () => {
      await seedRun({ dryRun: true, ago: "9 minutes" });
      const r = await checkPanelRunAllowed({ dryRun: true }, db.pool);
      assert.equal(r.allowed, false);
      assert.equal(r.reason, "too_soon");
      near(r.retryAfterSeconds, 60);
    });
    test("allowed 11 minutes after a panel check", async () => {
      await seedRun({ dryRun: true, ago: "11 minutes" });
      assert.deepEqual(await checkPanelRunAllowed({ dryRun: true }, db.pool), { allowed: true });
    });
    test("a failed panel check still counts", async () => {
      await seedRun({ dryRun: true, status: "failed", ago: "2 minutes" });
      assert.equal((await checkPanelRunAllowed({ dryRun: true }, db.pool)).reason, "too_soon");
    });
    test("cron and CLI dry runs, and panel imports, don't limit checks", async () => {
      await seedRun({ trigger: "cron", dryRun: true, ago: "1 minute" });
      await seedRun({ trigger: "cli", dryRun: true, ago: "1 minute" });
      await seedRun({ trigger: "panel", dryRun: false, ago: "1 minute" });
      assert.deepEqual(await checkPanelRunAllowed({ dryRun: true }, db.pool), { allowed: true });
    });
  });

  describe("Import (dryRun: false)", () => {
    test("refused when a panel ok import started 23 h ago, retry in about 1 h", async () => {
      await seedRun({ dryRun: false, ago: "23 hours", uploads: 4 });
      const r = await checkPanelRunAllowed({ dryRun: false }, db.pool);
      assert.equal(r.allowed, false);
      assert.equal(r.reason, "daily_limit");
      near(r.retryAfterSeconds, 3600);
    });
    test("allowed when the last panel import started 25 h ago", async () => {
      await seedRun({ dryRun: false, ago: "25 hours", uploads: 4 });
      assert.deepEqual(await checkPanelRunAllowed({ dryRun: false }, db.pool), { allowed: true });
    });
    test("the retry is measured from the most recent counting import", async () => {
      await seedRun({ dryRun: false, ago: "23 hours" });
      await seedRun({ dryRun: false, status: "partial", ago: "2 hours" });
      near((await checkPanelRunAllowed({ dryRun: false }, db.pool)).retryAfterSeconds, 79200);
    });
    test("a running panel import row counts toward the daily limit", async () => {
      // The first import's row says running, with 0 uploads so far.
      await seedRun({ dryRun: false, status: "running", ago: "5 seconds" });
      const r = await checkPanelRunAllowed({ dryRun: false }, db.pool);
      assert.equal(r.allowed, false);
      assert.equal(r.reason, "daily_limit");
      near(r.retryAfterSeconds, 86_395);
    });
    for (const status of ["partial", "abandoned"]) {
      test(`a ${status} panel import with 0 uploads counts`, async () => {
        await seedRun({ dryRun: false, status, ago: "1 hour" });
        assert.equal((await checkPanelRunAllowed({ dryRun: false }, db.pool)).reason, "daily_limit");
      });
    }
    test("a skipped panel import with 0 uploads does not count", async () => {
      await seedRun({ dryRun: false, status: "skipped", ago: "1 hour" });
      assert.deepEqual(await checkPanelRunAllowed({ dryRun: false }, db.pool), { allowed: true });
    });
    test("failed or reauth_required panel imports with 0 uploads do not count", async () => {
      await seedRun({ dryRun: false, status: "failed", ago: "1 hour" });
      await seedRun({ dryRun: false, status: "reauth_required", ago: "2 hours" });
      assert.deepEqual(await checkPanelRunAllowed({ dryRun: false }, db.pool), { allowed: true });
    });
    test("a failed panel import with uploads > 0 counts", async () => {
      await seedRun({ dryRun: false, status: "failed", ago: "1 hour", uploads: 3 });
      assert.equal((await checkPanelRunAllowed({ dryRun: false }, db.pool)).reason, "daily_limit");
    });
    test("cron and CLI imports and panel checks never count toward the daily limit", async () => {
      await seedRun({ trigger: "cron", dryRun: false, ago: "1 hour", uploads: 25 });
      await seedRun({ trigger: "cli", dryRun: false, ago: "1 hour", uploads: 25 });
      await seedRun({ trigger: "panel", dryRun: true, ago: "1 hour", uploads: 25 });
      assert.deepEqual(await checkPanelRunAllowed({ dryRun: false }, db.pool), { allowed: true });
    });
    test("refused at 1,000 real uploads in 30 days from any trigger; retry when the oldest leaves", async () => {
      // A dry run records would-be uploads; this older one must not move the retry (20 days, not 5).
      await seedRun({ trigger: "panel", dryRun: true, ago: "25 days", uploads: 3 });
      await seedRun({ trigger: "cron", dryRun: false, ago: "10 days", uploads: 600 });
      await seedRun({ trigger: "cli", dryRun: false, ago: "2 days", uploads: 400 });
      const r = await checkPanelRunAllowed({ dryRun: false }, db.pool);
      assert.equal(r.allowed, false);
      assert.equal(r.reason, "upload_ceiling");
      near(r.retryAfterSeconds, 1_728_000); // 20 days
    });
    test("allowed at 999 real uploads", async () => {
      await seedRun({ trigger: "cron", dryRun: false, ago: "3 days", uploads: 999 });
      assert.deepEqual(await checkPanelRunAllowed({ dryRun: false }, db.pool), { allowed: true });
    });
    test("the ceiling counts only dry_run = false rows", async () => {
      await seedRun({ trigger: "panel", dryRun: true, ago: "3 days", uploads: 5000 });
      await seedRun({ trigger: "cron", dryRun: false, ago: "3 days", uploads: 999 });
      assert.deepEqual(await checkPanelRunAllowed({ dryRun: false }, db.pool), { allowed: true });
    });
    test("uploads older than 30 days don't count", async () => {
      await seedRun({ trigger: "cron", dryRun: false, ago: "31 days", uploads: 1000 });
      assert.deepEqual(await checkPanelRunAllowed({ dryRun: false }, db.pool), { allowed: true });
    });
    test("daily_limit is reported before upload_ceiling", async () => {
      await seedRun({ trigger: "cron", dryRun: false, ago: "5 days", uploads: 1000 });
      await seedRun({ trigger: "panel", dryRun: false, ago: "1 hour", uploads: 2 });
      assert.equal((await checkPanelRunAllowed({ dryRun: false }, db.pool)).reason, "daily_limit");
    });
  });

  describe("claimPanelSlot (two requests at once)", () => {
    const claimTwice = (dryRun) =>
      Promise.all([claimPanelSlot({ dryRun }, db.pool), claimPanelSlot({ dryRun }, db.pool)]);

    test("two concurrent checks: exactly one claims the 10-minute slot", async () => {
      const results = await claimTwice(true);
      assert.deepEqual(results.filter((r) => r.claimed), [{ claimed: true }]);
      const [lost] = results.filter((r) => !r.claimed);
      assert.deepEqual(Object.keys(lost).sort(), ["claimed", "retryAfterSeconds"]);
      near(lost.retryAfterSeconds, 600);
    });
    test("a running panel import blocks a second import", async () => {
      // A double-click or a second tab: both requests claim before either run has written its sync_runs row.
      const results = await claimTwice(false);
      assert.deepEqual(results.filter((r) => r.claimed), [{ claimed: true }]);
      const [lost] = results.filter((r) => !r.claimed);
      near(lost.retryAfterSeconds, 86_400);
    });
    test("the check and import slots are separate, and an expired slot can be claimed again", async () => {
      assert.deepEqual(await claimPanelSlot({ dryRun: true }, db.pool), { claimed: true });
      assert.deepEqual(await claimPanelSlot({ dryRun: false }, db.pool), { claimed: true });
      await db.pool.query(
        "update job_locks set locked_until = now() - interval '1 second' where name = 'instagram-panel-check'");
      assert.deepEqual(await claimPanelSlot({ dryRun: true }, db.pool), { claimed: true });
      assert.equal((await claimPanelSlot({ dryRun: false }, db.pool)).claimed, false);
    });
    test("releasePanelImportSlot frees the import slot only", async () => {
      await claimPanelSlot({ dryRun: true }, db.pool);
      await claimPanelSlot({ dryRun: false }, db.pool);
      await releasePanelImportSlot(db.pool);
      assert.deepEqual(await claimPanelSlot({ dryRun: false }, db.pool), { claimed: true });
      assert.equal((await claimPanelSlot({ dryRun: true }, db.pool)).claimed, false);
      const { rows } = await db.pool.query("select name from job_locks order by name");
      assert.deepEqual(rows.map((r) => r.name), ["instagram-panel-check", "instagram-panel-import"]);
    });
  });

  describe("retry arithmetic at one instant", () => {
    test("each retry is its wait rounded up to the next whole second", async () => {
      for (const [seed, dryRun, retryAfterSeconds] of [
        [{ dryRun: true, ago: "9 minutes 0.5 seconds" }, true, 60], // a wait of 59.5 s
        [{ dryRun: false, ago: "23 hours 0.25 seconds" }, false, 3600], // 3,599.75 s
        [{ trigger: "cron", dryRun: false, ago: "10 days 0.5 seconds", uploads: 1000 }, false, 1_728_000], // 20 days less 0.5 s
      ]) {
        const r = await atOneInstant(async (client) => {
          await seedRun(seed, client);
          return checkPanelRunAllowed({ dryRun }, client);
        });
        assert.equal(r.retryAfterSeconds, retryAfterSeconds, JSON.stringify(seed));
      }
    });
    test("a slot that expires at this instant is still held, and its retry is 1 s, never 0", async () => {
      for (const [dryRun, name] of [[true, "instagram-panel-check"], [false, "instagram-panel-import"]]) {
        const r = await atOneInstant(async (client) => {
          await client.query("insert into job_locks (name, locked_until) values ($1, now())", [name]);
          return claimPanelSlot({ dryRun }, client);
        });
        assert.deepEqual(r, { claimed: false, retryAfterSeconds: 1 }, name);
      }
    });
    test("the ceiling's retry falls back to an hour when its oldest counted row is exactly 30 days old", async () => {
      // uploadsInLastDays counts started_at >= now() - 30 days; the retry query only rows after it, so it finds none.
      const r = await atOneInstant(async (client) => {
        await seedRun({ trigger: "cron", dryRun: false, ago: "30 days", uploads: 1000 }, client);
        return checkPanelRunAllowed({ dryRun: false }, client);
      });
      assert.deepEqual(r, { allowed: false, reason: "upload_ceiling", retryAfterSeconds: 3600 });
    });
  });
});
