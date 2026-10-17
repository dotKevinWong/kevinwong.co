import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { syncInstagram } from "../../lib/instagram-sync.js";
import { InstagramReauthRequiredError, storeToken } from "../../lib/instagram.js";
import { getDbPool } from "../../lib/db.js";
import { testDb } from "../helpers/db.mjs";
import { stubFetch } from "../helpers/fetch-stub.mjs";

// isBlobConfigured() must be true for a real run. Tests that reach the upload step pass their own
// `upload`. If one ever reached the real uploadToBlob, the fake token and a closed local port (with no
// retries) make it fail at once, without leaving the machine or touching a real store.
process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_fake_for_tests";
process.env.VERCEL_BLOB_API_URL = "http://127.0.0.1:9";
process.env.VERCEL_BLOB_RETRIES = "0";
delete process.env.BLOB_STORE_ID;

const MEDIA = "https://graph.instagram.com/v25.0/me/media";
// A 2x2 baseline JPEG header: probeMedia reads its size, and it is small enough to be stored without a resize.
const JPEG = Buffer.from("ffd8ffc00011080002000203011100021101031101ffd9", "hex");
const db = testDb();
// syncInstagram and storeToken use getDbPool(), whose pool opens on first use: point it at the local
// test database. tests/helpers/db.mjs has already refused a remote DATABASE_URL at import.
if (!db.skip) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

// Fetch routes for one new carousel post whose `slides` image slides download from cdn.test.
function carouselRoutes(shortcode, slides) {
  const children = Array.from({ length: slides }, (_, i) =>
    ({ id: `${shortcode}-${i}`, media_type: "IMAGE", media_url: `https://cdn.test/${shortcode}-${i}.jpg` }));
  const post = { id: shortcode, media_type: "CAROUSEL_ALBUM", permalink: `https://www.instagram.com/p/${shortcode}/`,
    timestamp: "2026-10-01T00:00:00Z", caption: "test", children: { data: children } };
  return {
    [MEDIA]: () => Response.json({ data: [post] }),
    ...Object.fromEntries(children.map((c) => [c.media_url, () => new Response(JPEG)])),
  };
}
// Stands in for uploadToBlob(pathname, buffer, contentType).
const fakeUpload = async (pathname, _buffer, contentType) => ({ url: `https://blob.test/${pathname}`, pathname, contentType });

describe("syncInstagram records its runs (integration)", { skip: db.skip }, () => {
  const lastRow = async () => (await db.pool.query("select * from sync_runs order by id desc limit 1")).rows[0];
  const count = async (sql) => (await db.pool.query(sql)).rows[0].n;
  const leaseHeld = async () =>
    (await count("select count(*)::int as n from job_locks where name = 'instagram-sync' and locked_until > now()")) === 1;
  const seedCeiling = () => db.pool.query(
    `insert into sync_runs (job, trigger, dry_run, status, started_at, finished_at, uploads)
     values ('instagram', 'cron', false, 'ok', now() - interval '2 days', now() - interval '2 days', 1800)`);
  async function hideSyncRuns(t) {
    await db.pool.query("alter table sync_runs rename to sync_runs_hidden");
    t.after(() => db.pool.query("alter table sync_runs_hidden rename to sync_runs"));
  }
  // startRun still works (it never names `uploads`); the 30-day count and finishRun do not.
  async function hideUploadsColumn(t) {
    await db.pool.query("alter table sync_runs rename column uploads to uploads_hidden");
    t.after(() => db.pool.query("alter table sync_runs rename column uploads_hidden to uploads"));
  }

  before(() => db.resetSchema());
  beforeEach(async () => {
    for (const table of ["sync_runs", "job_locks", "integration_tokens"]) await db.pool.query(`delete from ${table}`);
    await storeToken({ accessToken: "T-sync", expiresInSeconds: 60 * 86_400 }); // fresh: no refresh request
  });
  after(async () => { await getDbPool().end(); await db.close(); });

  test("a real run with nothing new records ok and releases the lease", async (t) => {
    const fetchStub = stubFetch(t, { [MEDIA]: () => Response.json({ data: [] }) });
    const summary = await syncInstagram({ trigger: "cron", timeBudgetMs: 150_000 });
    assert.equal(summary.fetched, 0);
    assert.equal(summary.leaseHeld, undefined);
    assert.equal(summary.ceilingReached, undefined);
    assert.equal(fetchStub.mock.callCount(), 1);
    const r = await lastRow();
    assert.deepEqual([r.status, r.trigger, r.dry_run], ["ok", "cron", false]);
    assert.ok(r.finished_at instanceof Date);
    assert.equal(await leaseHeld(), false);
  });

  test("a run where a post fails records partial", async (t) => {
    stubFetch(t, {
      [MEDIA]: () => Response.json({ data: [{ id: "1", media_type: "IMAGE", media_url: "https://cdn.test/a.jpg",
        permalink: "https://www.instagram.com/p/TESTPOST1/", timestamp: "2026-10-01T00:00:00Z", caption: "test" }] }),
      "https://cdn.test/a.jpg": () => new Response("gone", { status: 404 }),
    });
    t.mock.method(console, "error", () => {});
    const summary = await syncInstagram({ trigger: "cron" });
    assert.deepEqual(summary.errors, [{ id: "TESTPOST1", error: "Download failed: HTTP 404" }]);
    const r = await lastRow();
    assert.deepEqual([r.status, r.fetched, r.imported, r.uploads, r.error_count], ["partial", 1, 0, 0, 1]);
  });

  test("a run that finds the lease held records skipped and leaves the other run's lease alone", async (t) => {
    await db.pool.query(`insert into job_locks (name, locked_until) values ('instagram-sync', now() + interval '5 minutes')`);
    const fetchStub = stubFetch(t, {});
    const summary = await syncInstagram({ trigger: "cron" });
    assert.equal(summary.leaseHeld, true);
    assert.deepEqual(summary.skipped, [{ id: "run", reason: "another sync is already running" }]);
    assert.equal(fetchStub.mock.callCount(), 0);
    assert.equal((await lastRow()).status, "skipped");
    assert.equal(await leaseHeld(), true);
  });

  test("a real run stops before the lease once 30-day uploads reach 1,800", async (t) => {
    await seedCeiling();
    const fetchStub = stubFetch(t, {});
    t.mock.method(console, "warn", () => {});
    const summary = await syncInstagram({ trigger: "cron" });
    assert.equal(summary.ceilingReached, true);
    assert.equal(summary.leaseHeld, undefined);
    assert.deepEqual(summary.skipped, [{ id: "run", reason: "30-day upload ceiling reached" }]);
    assert.equal(fetchStub.mock.callCount(), 0);
    const r = await lastRow();
    assert.deepEqual([r.status, r.skipped], ["skipped", 1]);
    assert.equal(await count("select count(*)::int as n from job_locks"), 0);
  });

  test("a dry run ignores the ceiling", async (t) => {
    await seedCeiling();
    stubFetch(t, { [MEDIA]: () => Response.json({ data: [] }) });
    const summary = await syncInstagram({ trigger: "panel", dryRun: true });
    assert.equal(summary.ceilingReached, undefined);
    assert.equal(summary.blob, "configured, nothing stored yet to check against");
    const r = await lastRow();
    assert.deepEqual([r.status, r.trigger, r.dry_run], ["ok", "panel", true]);
  });

  test("a missing token records reauth_required, defaults the trigger to cli, and rethrows", async (t) => {
    await db.pool.query("delete from integration_tokens");
    stubFetch(t, {});
    await assert.rejects(syncInstagram({}), InstagramReauthRequiredError);
    const r = await lastRow();
    assert.deepEqual([r.status, r.trigger], ["reauth_required", "cli"]);
    assert.match(r.error, /No Instagram token stored/);
    assert.ok(r.finished_at instanceof Date);
  });

  test("any other error records failed, releases the lease, and rethrows", async (t) => {
    stubFetch(t, { [MEDIA]: () => Response.json(
      { error: { code: 2, type: "OAuthException", message: "Service temporarily unavailable" } }, { status: 500 }) });
    await assert.rejects(syncInstagram({ trigger: "cron" }), /HTTP 500 code=2/);
    const r = await lastRow();
    assert.equal(r.status, "failed");
    assert.match(r.error, /HTTP 500 code=2/);
    assert.equal(await leaseHeld(), false);
  });

  test("a recording failure does not change a dry run's result", async (t) => {
    await hideSyncRuns(t);
    const errors = t.mock.method(console, "error", () => {});
    stubFetch(t, { [MEDIA]: () => Response.json({ data: [] }) });
    const summary = await syncInstagram({ trigger: "cron", dryRun: true });
    assert.equal(summary.fetched, 0);
    assert.ok(errors.mock.calls.some((c) => String(c.arguments[0]).startsWith("[instagram-sync] Could not record this run")));
  });

  test("a real run fails closed when the 30-day count cannot be read", async (t) => {
    await hideUploadsColumn(t);
    t.mock.method(console, "error", () => {});
    const fetchStub = stubFetch(t, {});
    await assert.rejects(syncInstagram({ trigger: "cron" }), /column "uploads" does not exist/);
    assert.equal(fetchStub.mock.callCount(), 0);
    assert.equal(await count("select count(*)::int as n from job_locks"), 0);
  });

  test("a real run whose row cannot be written stands down and uploads nothing", async (t) => {
    await hideSyncRuns(t);
    const errors = t.mock.method(console, "error", () => {});
    const fetchStub = stubFetch(t, carouselRoutes("TESTPOST2", 1));
    const upload = t.mock.fn(fakeUpload);
    const summary = await syncInstagram({ trigger: "cron", upload });
    assert.equal(summary.notRecorded, true);
    assert.deepEqual(summary.skipped, [{ id: "run", reason: "run could not be recorded" }]);
    assert.equal(fetchStub.mock.callCount(), 0);
    assert.equal(upload.mock.callCount(), 0);
    assert.equal(await count("select count(*)::int as n from job_locks"), 0);
    assert.ok(errors.mock.calls.some((c) => String(c.arguments[0]).startsWith("[instagram-sync] Could not record this run")));
  });

  test("each upload is recorded as it lands, so a run that dies after two uploads has counted them", async (t) => {
    stubFetch(t, carouselRoutes("TESTPOST3", 3));
    t.mock.method(console, "error", () => {});
    let calls = 0;
    let uploadsWhenThirdStarted;
    const upload = async (pathname, buffer, contentType) => {
      calls += 1;
      if (calls === 3) {
        // A process killed here never touches its row again, so this is what it would leave behind.
        uploadsWhenThirdStarted = (await lastRow()).uploads;
        throw new Error("simulated crash");
      }
      return fakeUpload(pathname, buffer, contentType);
    };
    const summary = await syncInstagram({ trigger: "cli", upload });
    assert.equal(uploadsWhenThirdStarted, 2);
    assert.deepEqual(summary.errors, [{ id: "TESTPOST3", error: "simulated crash" }]);
    const r = await lastRow();
    assert.deepEqual([r.status, r.uploads], ["partial", 2]);
  });

  test("an upload that cannot be recorded stops the run at once, releases the lease and rethrows", async (t) => {
    stubFetch(t, carouselRoutes("TESTPOST4", 2));
    t.mock.method(console, "error", () => {});
    let calls = 0;
    const upload = async (pathname, buffer, contentType) => {
      calls += 1;
      if (calls === 1) await hideSyncRuns(t); // so the write that records this upload fails
      return fakeUpload(pathname, buffer, contentType);
    };
    await assert.rejects(syncInstagram({ trigger: "cli", upload }), /relation "sync_runs" does not exist/);
    assert.equal(calls, 1); // the second slide was never uploaded
    assert.equal(await leaseHeld(), false);
  });
});
