import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
const REFRESH = "https://graph.instagram.com/refresh_access_token";
// A 2x2 baseline JPEG header: probeMedia reads its size, and it is small enough to be stored without a resize.
const JPEG = Buffer.from("ffd8ffc00011080002000203011100021101031101ffd9", "hex");
const db = testDb();
// syncInstagram and storeToken use getDbPool(), whose pool opens on first use: point it at the local
// test database. tests/helpers/db.mjs has already refused a remote DATABASE_URL at import.
if (!db.skip) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

// One carousel post (the API's `item`) whose `slides` image slides download from cdn.test.
function carouselPost(shortcode, slides, timestamp = "2026-10-01T00:00:00Z") {
  const children = Array.from({ length: slides }, (_, i) =>
    ({ id: `${shortcode}-${i}`, media_type: "IMAGE", media_url: `https://cdn.test/${shortcode}-${i}.jpg` }));
  const item = { id: shortcode, media_type: "CAROUSEL_ALBUM", permalink: `https://www.instagram.com/p/${shortcode}/`,
    timestamp, caption: "test", children: { data: children } };
  return { item, children };
}
// Fetch routes that list the posts, in the order given, and serve every slide as the JPEG.
function mediaRoutes(...posts) {
  return {
    [MEDIA]: () => Response.json({ data: posts.map((p) => p.item) }),
    ...Object.fromEntries(posts.flatMap((p) => p.children).map((c) => [c.media_url, () => new Response(JPEG)])),
  };
}
// Fetch routes for one new carousel post whose `slides` image slides download from cdn.test.
const carouselRoutes = (shortcode, slides) => mediaRoutes(carouselPost(shortcode, slides));
// Stands in for uploadToBlob(pathname, buffer, contentType).
const fakeUpload = async (pathname, _buffer, contentType) => ({ url: `https://blob.test/${pathname}`, pathname, contentType });

const CLI = fileURLToPath(new URL("../../scripts/instagram-sync.mjs", import.meta.url));
const CLI_FETCH_STUB = new URL("../helpers/cli-fetch-stub.mjs", import.meta.url).href;
// Runs scripts/instagram-sync.mjs with node directly (what `npm run instagram:sync -- <args>` runs) against the
// test database (DATABASE_URL is inherited). It runs in an empty directory, so the script's .env loading finds
// nothing, with cli-fetch-stub.mjs preloaded, so it reaches no real API, and without any npm_config_* variables
// inherited from an npm-run test command, which the script would read as its options.
function runCli(t, args = []) {
  const cwd = mkdtempSync(join(tmpdir(), "kw-instagram-sync-cli-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("npm_config_")));
  return spawnSync(process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", `--import=${CLI_FETCH_STUB}`, CLI, ...args],
    { cwd, env, encoding: "utf8", timeout: 60_000 });
}

describe("syncInstagram records its runs (integration)", { skip: db.skip }, () => {
  const lastRow = async () => (await db.pool.query("select * from sync_runs order by id desc limit 1")).rows[0];
  const count = async (sql) => (await db.pool.query(sql)).rows[0].n;
  const leaseHeld = async () =>
    (await count("select count(*)::int as n from job_locks where name = 'instagram-sync' and locked_until > now()")) === 1;
  // One finished real run that spent n uploads, `ago` before now.
  const seedUploads = (n = 1800, ago = "2 days") => db.pool.query(
    `insert into sync_runs (job, trigger, dry_run, status, started_at, finished_at, uploads)
     values ('instagram', 'cron', false, 'ok', now() - $2::interval, now() - $2::interval, $1)`, [n, ago]);
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
    // instagram_media before instagram_posts. Clearing them keeps a test that imports a post from changing
    // what a later dry run's Blob check finds.
    for (const table of ["instagram_media", "instagram_posts", "sync_runs", "job_locks", "integration_tokens"]) {
      await db.pool.query(`delete from ${table}`);
    }
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
    await seedUploads();
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

  test("a ceiling spent 29 days ago still stops a real run", async (t) => {
    await seedUploads(1800, "29 days");
    const fetchStub = stubFetch(t, {});
    t.mock.method(console, "warn", () => {});
    const summary = await syncInstagram({ trigger: "cron" });
    assert.equal(summary.ceilingReached, true);
    assert.equal(fetchStub.mock.callCount(), 0);
  });

  test("a real run near the ceiling uploads only what is left under 1,800", async (t) => {
    await seedUploads(1798);
    const a = carouselPost("TESTPOST5", 1, "2026-10-01T00:00:00Z"); // older, so it goes first
    const b = carouselPost("TESTPOST6", 2, "2026-10-02T00:00:00Z");
    stubFetch(t, mediaRoutes(b, a));
    const upload = t.mock.fn(fakeUpload);
    const summary = await syncInstagram({ trigger: "cron", upload });
    assert.equal(upload.mock.callCount(), 1);
    assert.deepEqual([summary.uploads, summary.deferred], [1, 1]);
    assert.equal((await lastRow()).uploads, 1);
  });

  test("a dry run ignores the ceiling", async (t) => {
    await seedUploads();
    stubFetch(t, { [MEDIA]: () => Response.json({ data: [] }) });
    const summary = await syncInstagram({ trigger: "panel", dryRun: true });
    assert.equal(summary.ceilingReached, undefined);
    assert.equal(summary.blob, "configured, nothing stored yet to check against");
    const r = await lastRow();
    assert.deepEqual([r.status, r.trigger, r.dry_run], ["ok", "panel", true]);
  });

  test("a truthy dryRun that is not a boolean runs as a dry run and is recorded as one", async (t) => {
    const fetchStub = stubFetch(t, { [MEDIA]: () => Response.json({ data: [] }) });
    const summary = await syncInstagram({ trigger: "cli", dryRun: "false" });
    assert.equal(summary.dryRun, true);
    assert.equal(summary.blob, "configured, nothing stored yet to check against");
    assert.equal(fetchStub.mock.callCount(), 1);
    assert.equal((await lastRow()).dry_run, true);
    assert.equal(await count("select count(*)::int as n from job_locks"), 0);
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
    const fetchStub = stubFetch(t, { [MEDIA]: () => Response.json({ data: [] }) });
    const summary = await syncInstagram({ trigger: "cron", dryRun: true });
    assert.equal(summary.fetched, 0);
    // It carried on past the point where an unrecorded real run stands down.
    assert.equal(summary.notRecorded, undefined);
    assert.equal(summary.blob, "configured, nothing stored yet to check against");
    assert.equal(typeof summary.resize, "string");
    assert.equal(fetchStub.mock.callCount(), 1);
    assert.ok(errors.mock.calls.some((c) => String(c.arguments[0]).startsWith("[instagram-sync] Could not record this run")));
    // describeError: the line names pg's error code, not just its message.
    assert.ok(errors.mock.calls.some((c) => c.arguments[0] === "[instagram-sync] Could not record this run:" &&
      /\[42P01\]: relation "sync_runs" does not exist$/.test(c.arguments[1])));
  });

  test("a real run fails closed when the 30-day count cannot be read", async (t) => {
    await hideUploadsColumn(t);
    t.mock.method(console, "error", () => {});
    const fetchStub = stubFetch(t, {});
    await assert.rejects(syncInstagram({ trigger: "cron" }), /column "uploads" does not exist/);
    assert.equal(fetchStub.mock.callCount(), 0);
    assert.equal(await count("select count(*)::int as n from job_locks"), 0);
  });

  test("a real run whose row cannot be written refreshes the token, then stands down and uploads nothing", async (t) => {
    // Due for a refresh: past the 25-hour floor and inside the 30-day window. Upserts over the beforeEach token.
    await storeToken({ accessToken: "T-old", expiresInSeconds: 10 * 86_400 });
    await db.pool.query("update integration_tokens set refreshed_at = now() - interval '2 days' where provider = 'instagram'");
    await hideSyncRuns(t);
    const errors = t.mock.method(console, "error", () => {});
    t.mock.method(console, "log", () => {}); // "[instagram] Token refreshed; now expires …"
    const refresh = t.mock.fn(() => Response.json({ access_token: "T-new", expires_in: 5_184_000 }));
    const fetchStub = stubFetch(t, { ...carouselRoutes("TESTPOST2", 1), [REFRESH]: refresh });
    const upload = t.mock.fn(fakeUpload);
    const summary = await syncInstagram({ trigger: "cron", upload });
    assert.equal(summary.notRecorded, true);
    assert.deepEqual(summary.skipped, [{ id: "run", reason: "run could not be recorded" }]);
    assert.equal(refresh.mock.callCount(), 1); // the refresh still happened
    assert.equal(fetchStub.mock.callCount(), 1); // and nothing else (no media fetch)
    assert.equal((await db.pool.query("select access_token from integration_tokens")).rows[0].access_token, "T-new");
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

  // Records in lease_probe, as a row leaves 'running', whether the lease is still held. Returns a reader for it.
  async function installLeaseProbe(t) {
    await db.pool.query("create table lease_probe (held boolean)");
    await db.pool.query(`create function lease_probe_fn() returns trigger language plpgsql as $$
      begin
        if old.status = 'running' and new.status <> 'running' then
          insert into lease_probe values (exists (select 1 from job_locks
            where name = 'instagram-sync' and locked_until >= clock_timestamp()));
        end if;
        return new;
      end $$`);
    await db.pool.query("create trigger lease_probe_trg before update on sync_runs for each row execute function lease_probe_fn()");
    t.after(async () => {
      await db.pool.query("drop trigger if exists lease_probe_trg on sync_runs");
      await db.pool.query("drop function if exists lease_probe_fn()");
      await db.pool.query("drop table if exists lease_probe");
    });
    return async () => (await db.pool.query("select held from lease_probe")).rows;
  }

  test("a run's row is final before its lease is released", async (t) => {
    const probed = await installLeaseProbe(t);
    stubFetch(t, { [MEDIA]: () => Response.json({ data: [] }) });
    await syncInstagram({ trigger: "cron" });
    assert.deepEqual(await probed(), [{ held: true }]);
    assert.equal(await leaseHeld(), false);
  });

  test("a run that throws also has its row final before its lease is released", async (t) => {
    const probed = await installLeaseProbe(t);
    stubFetch(t, { [MEDIA]: () => Response.json(
      { error: { code: 2, type: "OAuthException", message: "Service temporarily unavailable" } }, { status: 500 }) });
    await assert.rejects(syncInstagram({ trigger: "cron" }), /HTTP 500 code=2/);
    assert.equal((await lastRow()).status, "failed");
    assert.deepEqual(await probed(), [{ held: true }]);
    assert.equal(await leaseHeld(), false);
  });

  test("the CLI says a run that could not be recorded did not run, and exits 1", async (t) => {
    await hideSyncRuns(t);
    const cli = runCli(t);
    assert.equal(cli.status, 1, cli.stderr);
    assert.match(cli.stdout, /^Not run — the run could not be recorded \(database error\)$/m);
    assert.doesNotMatch(cli.stdout, /Sync complete/);
  });

  test("the CLI says a run stopped at the 30-day ceiling", async (t) => {
    await seedUploads();
    const cli = runCli(t);
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /^Stopped — 1,800 uploads in the last 30 days reached$/m);
    assert.doesNotMatch(cli.stdout, /Sync complete/);
  });

  test("the CLI says a run that found the lease held did not run", async (t) => {
    await db.pool.query(`insert into job_locks (name, locked_until) values ('instagram-sync', now() + interval '5 minutes')`);
    const cli = runCli(t);
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /^Not run — another sync holds the lease$/m);
    assert.doesNotMatch(cli.stdout, /Sync complete/);
  });

  test("the CLI help says the ceiling stops new uploads at 1,800, not that a run never passes it", (t) => {
    const cli = runCli(t, ["--help"]);
    assert.equal(cli.status, 0, cli.stderr);
    assert.ok(cli.stdout.includes(
      "  --max-uploads=N      Cap media uploads this run (default 25; backlogs resume later; stops new uploads at 1,800 in 30 days)\n"));
  });

  test("the CLI keeps its headlines for a run that went ahead, real or dry", async (t) => {
    const real = runCli(t);
    assert.equal(real.status, 0, real.stderr);
    assert.match(real.stdout, /^Sync complete$/m);
    const dry = runCli(t, ["--dry-run"]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /^DRY RUN — nothing was uploaded or inserted$/m);
  });
});
