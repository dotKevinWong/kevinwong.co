import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { testDb } from "../helpers/db.mjs";
import { stubFetch } from "../helpers/fetch-stub.mjs";
import { fakeRes } from "../helpers/admin-fakes.mjs";
import { createInstagramSyncHandler, readJsonBody } from "../../lib/admin/instagram-sync-route.js";
import { checkPanelRunAllowed, claimPanelSlot, releasePanelImportSlot } from "../../lib/admin/sync-limits.js";
import { logAdminEvent } from "../../lib/admin/audit-log.js";
import { buildAdminStatus } from "../../lib/admin/status.js";
import { syncInstagram } from "../../lib/instagram-sync.js";
import { storeToken } from "../../lib/instagram.js";
import { getDbPool } from "../../lib/db.js";

// The panel's Check and Import end to end: the real route (lib/admin/instagram-sync-route.js) with the real body
// reader, the real D4 limits and slot claims, the real syncInstagram writing sync_runs, and the real audit log, all on
// the test database. Only the owner check, Instagram's HTTP (stubFetch) and the Blob upload (syncInstagram's
// `upload` seam) are fakes. The route's unit tests fake the summary; these pin the summary syncInstagram really
// returns, and the slot and ledger rules through real SQL.

// isBlobConfigured() must be true for a real run. If anything reached the real uploadToBlob, the fake token and a
// closed local port (with no retries) would make it fail at once, without leaving the machine.
process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_fake_for_tests";
process.env.VERCEL_BLOB_API_URL = "http://127.0.0.1:9";
process.env.VERCEL_BLOB_RETRIES = "0";
delete process.env.BLOB_STORE_ID;

const db = testDb();
// syncInstagram, storeToken and the audit log use getDbPool(): point it at the test database, which
// tests/helpers/db.mjs has already checked is local.
if (!db.skip) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const ORIGIN = "https://www.kevinwong.co";
const MEDIA = "https://graph.instagram.com/v25.0/me/media";
// A 2x2 baseline JPEG header: probeMedia reads its size, and it is small enough to be stored without a resize.
const JPEG = Buffer.from("ffd8ffc00011080002000203011100021101031101ffd9", "hex");

// Fetch routes that list one new carousel post whose `slides` image slides download from cdn.test.
function carouselRoutes(shortcode, slides) {
  const children = Array.from({ length: slides }, (_, i) =>
    ({ id: `${shortcode}-${i}`, media_type: "IMAGE", media_url: `https://cdn.test/${shortcode}-${i}.jpg` }));
  const item = { id: shortcode, media_type: "CAROUSEL_ALBUM", permalink: `https://www.instagram.com/p/${shortcode}/`,
    timestamp: "2026-10-01T00:00:00Z", caption: "a caption that must never reach the response", children: { data: children } };
  return {
    [MEDIA]: () => Response.json({ data: [item] }),
    ...Object.fromEntries(children.map((c) => [c.media_url, () => new Response(JPEG)])),
  };
}

let uploadDelayMs = 0;
const uploaded = [];
const fakeUpload = async (pathname, _buffer, contentType) => {
  if (uploadDelayMs) await new Promise((resolve) => setTimeout(resolve, uploadDelayMs));
  uploaded.push(pathname);
  return { url: `https://blob.test/${pathname}`, pathname, contentType };
};

const handler = createInstagramSyncHandler({
  requireAdmin: async () => ({ name: "Kevin Wong", image: null }),
  readBody: readJsonBody,
  checkPanelRunAllowed,
  claimPanelSlot,
  releasePanelImportSlot,
  syncInstagram: (options) => syncInstagram({ ...options, upload: fakeUpload }),
  logAdminEvent,
});

// A same-origin POST with a JSON body, as the dashboard sends it.
async function call(dryRun) {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({ dryRun }))]), {
    method: "POST", url: "/api/admin/instagram/sync",
    headers: { host: "www.kevinwong.co", origin: ORIGIN, "content-type": "application/json" },
  });
  const res = fakeRes();
  await handler(req, res);
  return res;
}

const rows = async (sql) => (await db.pool.query(sql)).rows;
const panelRuns = () => rows(`select dry_run, status, imported, uploads from sync_runs
  where job = 'instagram' and trigger = 'panel' order by id`);
const postCount = async () => (await rows("select count(*)::int as n from instagram_posts"))[0].n;
const slotHeld = async (name) =>
  (await rows(`select coalesce(bool_or(locked_until > now()), false) as held from job_locks where name = '${name}'`))[0].held;
const events = async () => (await rows("select event, details from admin_audit_log order by id"));

// syncInstagram and the route print progress and failure lines; the tests check the response and the rows instead.
function mute(t) {
  for (const method of ["log", "warn", "error"]) t.mock.method(console, method, () => {});
}

describe("the panel's Check and Import through the real limits and syncInstagram", { skip: db.skip }, () => {
  before(() => db.resetSchema());
  beforeEach(async () => {
    await db.pool.query(`truncate instagram_media, instagram_posts, sync_runs, job_locks, integration_tokens,
      admin_audit_log restart identity cascade`);
    // Fresh, so no run refreshes it.
    await storeToken({ accessToken: "T-panel", expiresInSeconds: 60 * 86_400 });
    uploadDelayMs = 0;
    uploaded.length = 0;
  });
  after(async () => { await getDbPool().end(); await db.close(); });

  test("a Check answers with the summary's fields, records a panel dry run, and a second Check is too soon", async (t) => {
    mute(t);
    stubFetch(t, carouselRoutes("CHECK1", 2));

    const res = await call(true);
    assert.equal(res.statusCode, 200);
    const { blob, resize, ...rest } = res.body;
    assert.deepEqual(rest, {
      status: "ok", fetched: 1, alreadyPresent: 0,
      posts: [{ shortcode: "CHECK1", postedAt: "2026-10-01T00:00:00.000Z", mediaCount: 2 }],
      uploads: 2, deferred: 0, errorCount: 0,
    });
    assert.equal(blob, "configured, nothing stored yet to check against");
    assert.match(resize, /^ok /);
    assert.ok(!JSON.stringify(res.body).includes("caption"), "no caption leaves the route");
    assert.deepEqual(uploaded, [], "a Check uploads nothing");
    assert.equal(await postCount(), 0);
    assert.deepEqual(await panelRuns(), [{ dry_run: true, status: "ok", imported: 1, uploads: 2 }]);

    const again = await call(true);
    assert.equal(again.statusCode, 429);
    assert.equal(again.body.error, "too_soon");
    assert.ok(again.body.retryAfterSeconds > 590 && again.body.retryAfterSeconds <= 600, String(again.body.retryAfterSeconds));
    assert.equal(again.getHeader("Retry-After"), String(again.body.retryAfterSeconds));
    assert.deepEqual((await events()).map((e) => e.event), ["instagram_check", "panel_run_refused"]);
    assert.equal((await panelRuns()).length, 1, "the refused Check ran nothing");
  });

  test("an Import stores the post, answers with the summary's fields, and uses up the day", async (t) => {
    mute(t);
    stubFetch(t, carouselRoutes("IMPORT1", 2));

    const res = await call(false);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      status: "ok", fetched: 1, alreadyPresent: 0,
      posts: [{ shortcode: "IMPORT1", postedAt: "2026-10-01T00:00:00.000Z", mediaCount: 2 }],
      uploads: 2, deferred: 0, errorCount: 0,
    });
    assert.equal(uploaded.length, 2);
    assert.equal(await postCount(), 1);
    assert.deepEqual(await panelRuns(), [{ dry_run: false, status: "ok", imported: 1, uploads: 2 }]);
    assert.equal(await slotHeld("instagram-panel-import"), true);

    const again = await call(false);
    assert.equal(again.statusCode, 429);
    assert.equal(again.body.error, "daily_limit");
  });

  test("a double-clicked Import starts one run: the second request is refused while the first is still running", async (t) => {
    mute(t);
    stubFetch(t, carouselRoutes("DOUBLE1", 2));
    uploadDelayMs = 200; // so the two requests overlap the whole run

    const responses = await Promise.all([call(false), call(false)]);
    assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 429]);
    assert.equal(responses.find((r) => r.statusCode === 429).body.error, "daily_limit");
    assert.equal(responses.find((r) => r.statusCode === 200).body.status, "ok");
    assert.deepEqual(await panelRuns(), [{ dry_run: false, status: "ok", imported: 1, uploads: 2 }]);
    assert.equal(await postCount(), 1);
    assert.equal(uploaded.length, 2);
  });

  test("an Import while the cron holds the lease is skipped, gives the slot back, and the next Import runs", async (t) => {
    mute(t);
    stubFetch(t, carouselRoutes("LEASE1", 1));
    await db.pool.query("insert into job_locks (name, locked_until) values ('instagram-sync', now() + interval '5 minutes')");

    const skipped = await call(false);
    assert.equal(skipped.statusCode, 200);
    assert.deepEqual(skipped.body, {
      status: "skipped", fetched: 0, alreadyPresent: 0, posts: [], uploads: 0, deferred: 0, errorCount: 0,
    });
    assert.deepEqual(uploaded, []);
    assert.equal(await slotHeld("instagram-panel-import"), false, "the import slot was given back");
    assert.equal(await slotHeld("instagram-sync"), true, "the cron's lease is untouched");
    assert.deepEqual(await checkPanelRunAllowed({ dryRun: false }, db.pool), { allowed: true });
    assert.equal((await buildAdminStatus({ db: db.pool, env: {} })).instagram.panel.importBlockedReason, null);

    // Once the cron's run is over, the next Import runs.
    await db.pool.query("update job_locks set locked_until = 'epoch' where name = 'instagram-sync'");
    const next = await call(false);
    assert.equal(next.statusCode, 200);
    assert.equal(next.body.status, "ok");
    assert.deepEqual(next.body.posts.map((p) => p.shortcode), ["LEASE1"]);
    assert.deepEqual(await panelRuns(), [
      { dry_run: false, status: "skipped", imported: 0, uploads: 0 },
      { dry_run: false, status: "ok", imported: 1, uploads: 1 },
    ]);
  });

  test("an Import whose every post fails before its upload ends partial and still uses up the day", async (t) => {
    mute(t);
    stubFetch(t, { ...carouselRoutes("GONE1", 1), "https://cdn.test/GONE1-0.jpg": () => new Response("gone", { status: 404 }) });

    const res = await call(false);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      status: "partial", fetched: 1, alreadyPresent: 0, posts: [], uploads: 0, deferred: 0, errorCount: 1,
    });
    assert.deepEqual(await panelRuns(), [{ dry_run: false, status: "partial", imported: 0, uploads: 0 }]);
    assert.equal(await slotHeld("instagram-panel-import"), true, "a finished import keeps its slot");
    assert.equal((await call(false)).body.error, "daily_limit");
  });

  test("an Import that throws before any upload answers 500, is recorded as failed, and gives the slot back", async (t) => {
    mute(t);
    stubFetch(t, { [MEDIA]: () => Response.json({ error: { message: "temporarily unavailable", code: 2 } }, { status: 500 }) });

    const res = await call(false);
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: "sync_failed" });
    assert.deepEqual(await panelRuns(), [{ dry_run: false, status: "failed", imported: 0, uploads: 0 }]);
    assert.equal(await slotHeld("instagram-panel-import"), false);
    assert.deepEqual(await checkPanelRunAllowed({ dryRun: false }, db.pool), { allowed: true });
    assert.deepEqual((await events()).map((e) => [e.event, e.details.status]), [["instagram_import", "failed"]]);
  });
});
