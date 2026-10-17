import { describe, test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "../helpers/db.mjs";
import { buildAdminStatus } from "../../lib/admin/status.js";
import { OWNER_ACTOR, logAdminEvent } from "../../lib/admin/audit-log.js";
import { OWNER_SPOTIFY_ACCOUNT_ID } from "../../lib/admin/owner.js";
import { SPOTIFY_SCOPES } from "../../lib/spotify-token.js";

const db = testDb();
const NOW = new Date("2026-10-16T12:00:00Z");
const hoursBefore = (d, h) => new Date(d.getTime() - h * 3_600_000);
const SECRETS = { spotifyRefresh: "spotify-refresh-SECRET-1", spotifyAccess: "spotify-access-SECRET-2",
  instagramAccess: "ig-access-SECRET-3", envRefresh: "env-refresh-SECRET-4" };
const status = (o = {}) => buildAdminStatus({ db: db.pool, env: {}, now: NOW, ...o });
const between = (v, lo, hi) => assert.ok(v >= lo && v <= hi, `${v} not in [${lo}, ${hi}]`);
const textOf = (q) => (typeof q === "string" ? q : q.text);

async function seedSpotify({ authorizedAt = new Date("2026-08-03T00:00:00Z"), expiresAt = new Date("2027-01-30T00:00:00Z"),
  accountId = OWNER_SPOTIFY_ACCOUNT_ID, scopes = SPOTIFY_SCOPES.join(" "), deadReason = null } = {}) {
  await db.pool.query(
    `insert into integration_tokens (provider, access_token, refresh_token, expires_at, expires_at_is_assumed,
       authorized_at, account_id, scopes, dead_reason, refreshed_at)
     values ('spotify', $1, $2, $3, true, $4, $5, $6, $7, $4)`,
    [SECRETS.spotifyAccess, SECRETS.spotifyRefresh, expiresAt, authorizedAt, accountId, scopes, deadReason]);
}
async function seedInstagramToken({ expiresAt, refreshedAt, deadReason = null }) {
  await db.pool.query(
    `insert into integration_tokens (provider, access_token, expires_at, refreshed_at, expires_at_is_assumed, dead_reason)
     values ('instagram', $1, $2, $3, false, $4)`, [SECRETS.instagramAccess, expiresAt, refreshedAt, deadReason]);
}
async function seedRunAt({ trigger, dryRun, status: s = "ok", startedAt, uploads = 0 }) {
  await db.pool.query(`insert into sync_runs (job, trigger, dry_run, status, started_at, finished_at, uploads)
    values ('instagram', $1, $2, $3, $4, $4, $5)`, [trigger, dryRun, s, startedAt, uploads]);
}
async function seedRunAgo({ trigger, dryRun, status: s = "ok", ago, uploads = 0 }) {
  await db.pool.query(`insert into sync_runs (job, trigger, dry_run, status, started_at, uploads)
    values ('instagram', $1, $2, $3, now() - $4::interval, $5)`, [trigger, dryRun, s, ago, uploads]);
}
async function seedPost(shortcode, mediaBytes) {
  const { rows } = await db.pool.query(
    `insert into instagram_posts (source_key, caption, instagram_url, posted_at, raw_post_json, caption_emojis)
     values ($1, '', $2, now(), '{}'::jsonb, '{}'::text[]) returning id`,
    [`ig:${shortcode}`, `https://www.instagram.com/p/${shortcode}/`]);
  for (const [position, bytes] of mediaBytes.entries()) {
    const url = `https://blob.example/snapshots/202610/${shortcode}-${position}.jpg`;
    await db.pool.query(
      `insert into instagram_media (post_id, position, kind, asset_url, asset_pathname, asset_content_type, asset_bytes,
         asset_width, asset_height, cloudinary_url, cloudinary_public_id, cloudinary_folder, cloudinary_width,
         cloudinary_height, file_ext, source_uri, source_created_at, raw_media_json)
       values ($1, $2, 'image'::media_kind, $3, $4, 'image/jpeg', $5, 1440, 1440, $3, $4, '202610', 1440, 1440,
               'jpg', $3, now(), '{}'::jsonb)`,
      [rows[0].id, position, url, `snapshots/202610/${shortcode}-${position}.jpg`, bytes]);
  }
}

describe("buildAdminStatus", { skip: db.skip }, () => {
  before(() => db.resetSchema());
  beforeEach(() => db.pool.query(`truncate sync_runs, admin_audit_log, job_locks, integration_tokens,
    instagram_media, instagram_posts restart identity cascade`));
  after(() => db.close());

  test("spotify: connected when the row has no dead_reason", async () => {
    await seedSpotify();
    const s = (await status()).spotify;
    assert.equal(s.state, "connected");
    assert.equal(s.authorizedAt, "2026-08-03T00:00:00.000Z");
    assert.equal(s.expiresAt, "2027-01-30T00:00:00.000Z");
    assert.equal(s.deadReason, null);
    assert.deepEqual(s.scopes, SPOTIFY_SCOPES);
    assert.deepEqual(s.missingScopes, []);
  });
  test("spotify: dead when dead_reason is set", async () => {
    await seedSpotify({ deadReason: "invalid_grant" });
    const s = (await status()).spotify;
    assert.equal(s.state, "dead");
    assert.equal(s.deadReason, "invalid_grant");
  });
  test("spotify: env when there is no row but env.refresh_token is set", async () => {
    assert.deepEqual((await status({ env: { refresh_token: SECRETS.envRefresh } })).spotify, {
      state: "env", authorizedAt: null, expiresAt: null, daysLeft: null, accountMatches: null,
      scopes: null, missingScopes: null, deadReason: null });
  });
  test("spotify: missing when there is neither", async () => {
    assert.equal((await status()).spotify.state, "missing");
  });
  test("spotify: daysLeft is floored, and negative once expiresAt has passed", async () => {
    await seedSpotify({ expiresAt: new Date("2027-01-30T00:00:00Z") });
    assert.equal((await status({ now: new Date("2026-10-16T12:00:00Z") })).spotify.daysLeft, 105); // 105.5 days
    assert.equal((await status({ now: new Date("2027-02-02T12:00:00Z") })).spotify.daysLeft, -4); // -3.5 days
  });
  test("spotify: accountMatches true, false, null", async () => {
    await seedSpotify();
    assert.equal((await status()).spotify.accountMatches, true);
    await db.pool.query(`update integration_tokens set account_id = 'someone-else' where provider = 'spotify'`);
    assert.equal((await status()).spotify.accountMatches, false);
    await db.pool.query(`update integration_tokens set account_id = null where provider = 'spotify'`);
    assert.equal((await status()).spotify.accountMatches, null);
  });
  test("spotify: missingScopes lists what the row lacks", async () => {
    await seedSpotify({ scopes: "user-read-currently-playing user-top-read" });
    assert.deepEqual((await status()).spotify.missingScopes, ["user-read-recently-played"]);
  });

  test("instagram.token: null without a row, fields and daysLeft with one", async () => {
    assert.equal((await status()).instagram.token, null);
    await seedInstagramToken({ expiresAt: new Date("2026-11-25T12:00:00Z"), refreshedAt: new Date("2026-09-26T05:00:00Z") });
    assert.deepEqual((await status()).instagram.token, { expiresAt: "2026-11-25T12:00:00.000Z", daysLeft: 40,
      refreshedAt: "2026-09-26T05:00:00.000Z", expiresAtIsAssumed: false, deadReason: null });
  });

  test("cronOverdue: true with no cron run, true at 37 h, false at 35 h", async () => {
    let s = await status();
    assert.equal(s.instagram.lastCron, null);
    assert.equal(s.instagram.cronOverdue, true);
    await seedRunAt({ trigger: "cron", dryRun: false, startedAt: hoursBefore(NOW, 37) });
    s = await status();
    assert.equal(s.instagram.lastCron.startedAt, hoursBefore(NOW, 37).toISOString());
    assert.equal(s.instagram.cronOverdue, true);
    await seedRunAt({ trigger: "cron", dryRun: false, startedAt: hoursBefore(NOW, 35) });
    assert.equal((await status()).instagram.cronOverdue, false);
  });
  test("cronOverdue ignores panel and CLI runs and cron dry runs", async () => {
    await seedRunAt({ trigger: "panel", dryRun: false, startedAt: hoursBefore(NOW, 1) });
    await seedRunAt({ trigger: "cli", dryRun: false, startedAt: hoursBefore(NOW, 1) });
    await seedRunAt({ trigger: "cron", dryRun: true, startedAt: hoursBefore(NOW, 1) });
    assert.equal((await status()).instagram.cronOverdue, true);
  });

  test("lease: held before locked_until, not held after it or when released", async () => {
    assert.deepEqual((await status()).instagram.lease, { held: false, lockedUntil: null });
    await db.pool.query(`insert into job_locks (name, locked_until) values ('instagram-sync', $1)`,
      [new Date(NOW.getTime() + 5 * 60_000)]);
    assert.deepEqual((await status()).instagram.lease, { held: true, lockedUntil: "2026-10-16T12:05:00.000Z" });
    await db.pool.query(`update job_locks set locked_until = $1`, [new Date(NOW.getTime() - 60_000)]);
    assert.deepEqual((await status()).instagram.lease, { held: false, lockedUntil: null });
    await db.pool.query(`update job_locks set locked_until = 'epoch'`);
    assert.deepEqual((await status()).instagram.lease, { held: false, lockedUntil: null });
  });

  test("a stale running row with an expired lease is shown as abandoned", async () => {
    const seedRunning = (trigger, minutesAgo) => db.pool.query(
      `insert into sync_runs (job, trigger, dry_run, status, started_at) values ('instagram', $1, false, 'running', $2)`,
      [trigger, new Date(NOW.getTime() - minutesAgo * 60_000)]);
    await seedRunning("cron", 20); // killed at maxDuration, so finishRun never ran; no job_locks row
    let s = await status();
    assert.equal(s.instagram.lastCron.status, "abandoned");
    assert.deepEqual(s.runs.map((r) => r.status), ["abandoned"]);
    assert.equal((await db.pool.query("select status from sync_runs")).rows[0].status, "running"); // read-time only
    await seedRunning("panel", 10); // 10 minutes is not stale yet
    assert.deepEqual((await status()).runs.map((r) => r.status), ["running", "abandoned"]);
    await db.pool.query(`insert into job_locks (name, locked_until) values ('instagram-sync', $1)`,
      [new Date(NOW.getTime() + 5 * 60_000)]);
    s = await status(); // while the run lease is held, a long run is still running
    assert.deepEqual(s.runs.map((r) => r.status), ["running", "running"]);
    assert.equal(s.instagram.lastCron.status, "running");
  });

  test("library bytes treat null asset_bytes as zero", async () => {
    assert.deepEqual((await status()).instagram.library, { posts: 0, files: 0, bytes: 0 });
    await seedPost("BBB", [null]); // an older /snapshots row without asset_bytes
    assert.deepEqual((await status()).instagram.library, { posts: 1, files: 1, bytes: 0 });
    await seedPost("AAA", [1000, 2500]);
    assert.deepEqual((await status()).instagram.library, { posts: 2, files: 3, bytes: 3500 });
  });

  test("uploads30d counts real uploads in 30 days and ignores dry runs", async () => {
    await seedRunAgo({ trigger: "cron", dryRun: false, ago: "1 day", uploads: 7 });
    await seedRunAgo({ trigger: "panel", dryRun: true, ago: "1 hour", uploads: 40 });
    await seedRunAgo({ trigger: "cli", dryRun: false, ago: "31 days", uploads: 3 });
    assert.equal((await status({ now: new Date() })).instagram.uploads30d, 7);
  });

  test("limits are the fixed D4 and Hobby values", async () => {
    assert.deepEqual((await status()).instagram.limits,
      { panelCeiling: 1000, cronCeiling: 1800, monthlyLimit: 2000, storageLimitBytes: 1_000_000_000 });
  });

  test("panel: all null when nothing limits a run", async () => {
    assert.deepEqual((await status({ now: new Date() })).instagram.panel,
      { nextCheckAt: null, nextImportAt: null, importBlockedReason: null });
  });
  test("panel: nextCheckAt and nextImportAt come from the D4 limits", async () => {
    await seedRunAgo({ trigger: "panel", dryRun: true, ago: "9 minutes" });
    await seedRunAgo({ trigger: "panel", dryRun: false, ago: "23 hours", uploads: 2 });
    const now = new Date();
    const p = (await status({ now })).instagram.panel;
    between(Date.parse(p.nextCheckAt) - now.getTime(), 55_000, 61_000);
    between(Date.parse(p.nextImportAt) - now.getTime(), 3_595_000, 3_601_000);
    assert.equal(p.importBlockedReason, "daily_limit");
  });
  test("panel: upload_ceiling when 30-day uploads reach 1,000", async () => {
    await seedRunAgo({ trigger: "cron", dryRun: false, ago: "2 days", uploads: 1000 });
    assert.equal((await status({ now: new Date() })).instagram.panel.importBlockedReason, "upload_ceiling");
  });
  test("panel: a held slot claim sets nextCheckAt and nextImportAt; a released one doesn't", async () => {
    // Claims from Task 14's claimPanelSlot whose runs have not written a sync_runs row yet.
    await db.pool.query(`insert into job_locks (name, locked_until) values
      ('instagram-panel-check', now() + interval '5 minutes'), ('instagram-panel-import', now() + interval '3 hours')`);
    const now = new Date();
    const p = (await status({ now })).instagram.panel;
    between(Date.parse(p.nextCheckAt) - now.getTime(), 295_000, 301_000);
    between(Date.parse(p.nextImportAt) - now.getTime(), 10_795_000, 10_801_000);
    assert.equal(p.importBlockedReason, "daily_limit");
    await db.pool.query(`update job_locks set locked_until = 'epoch' where name = 'instagram-panel-import'`);
    const released = (await status({ now: new Date() })).instagram.panel;
    assert.equal(released.nextImportAt, null);
    assert.equal(released.importBlockedReason, null);
  });

  test("runs and activity are JSON-safe, newest first", async () => {
    await seedSpotify();
    await seedInstagramToken({ expiresAt: new Date("2026-11-25T12:00:00Z"), refreshedAt: new Date("2026-09-26T05:00:00Z") });
    await seedRunAt({ trigger: "cron", dryRun: false, startedAt: hoursBefore(NOW, 30), uploads: 2 });
    await seedRunAt({ trigger: "panel", dryRun: true, startedAt: hoursBefore(NOW, 1) });
    await logAdminEvent("sign_in", { actor: OWNER_ACTOR, details: { note: "seed" } }, db.pool);
    const s = await status();
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s); // no Date objects, no undefined
    assert.equal(s.generatedAt, NOW.toISOString());
    assert.deepEqual(s.runs.map((r) => r.trigger), ["panel", "cron"]);
    assert.equal(s.runs[0].startedAt, hoursBefore(NOW, 1).toISOString());
    assert.equal(typeof s.runs[0].id, "number"); // bigint ids leave lib as numbers
    assert.equal(s.activity[0].event, "sign_in");
    assert.equal(s.activity[0].actor, OWNER_ACTOR);
    assert.equal(typeof s.activity[0].id, "number");
    assert.equal(typeof s.activity[0].at, "string");
  });

  test("refusedSignIns summarises the last 24 hours, and activity leaves refusals out", async () => {
    assert.deepEqual((await status()).refusedSignIns, { count24h: 0, latestAt: null, latestLogin: null });
    await logAdminEvent("sign_in", { actor: OWNER_ACTOR }, db.pool);
    await db.pool.query(`insert into admin_audit_log (event, actor, details, at) values
      ('sign_in_rejected', 'github:999', '{"githubId":"999","login":"intruder"}', now() - interval '2 hours'),
      ('sign_in_rejected', 'github:1000', '{"githubId":"1000","login":"other"}', now() - interval '30 minutes'),
      ('sign_in_rejected', 'github:1001', '{"githubId":"1001","login":"old"}', now() - interval '25 hours')`);
    const s = await status({ now: new Date() });
    assert.equal(s.refusedSignIns.count24h, 2);
    assert.equal(s.refusedSignIns.latestLogin, "other");
    assert.equal(typeof s.refusedSignIns.latestAt, "string");
    between(Date.now() - Date.parse(s.refusedSignIns.latestAt), 29 * 60_000, 31 * 60_000);
    assert.deepEqual(s.activity.map((e) => e.event), ["sign_in"]);
  });

  // Controller notes (Task 15), 4: dead_reason can hold text from a provider error, so it leaves redacted.
  test("dead_reason comes back redacted for both providers, and the stored value is unchanged", async () => {
    const leaky = "HTTP 400 code=190 type=OAuthException: refresh_token=AQD-leaky-5 rejected for " +
      "postgresql://kw_owner:npg_hunter2@db.example.test with Bearer ig-bearer-6";
    const redacted = "HTTP 400 code=190 type=OAuthException: refresh_token=[redacted] rejected for " +
      "postgresql://[redacted]@db.example.test with Bearer [redacted]";
    await seedSpotify({ deadReason: leaky });
    await seedInstagramToken({ expiresAt: new Date("2026-11-25T12:00:00Z"), refreshedAt: new Date("2026-09-26T05:00:00Z"),
      deadReason: leaky });
    const s = await status();
    assert.equal(s.spotify.state, "dead");
    assert.equal(s.spotify.deadReason, redacted);
    assert.equal(s.instagram.token.deadReason, redacted);
    const { rows } = await db.pool.query("select dead_reason from integration_tokens order by provider");
    assert.deepEqual(rows.map((r) => r.dead_reason), [leaky, leaky]);
  });

  test("never returns or selects a token", async () => {
    await seedSpotify();
    await seedInstagramToken({ expiresAt: new Date("2026-11-25T12:00:00Z"), refreshedAt: new Date("2026-09-26T05:00:00Z") });
    const texts = [];
    const spy = { query: (q, p) => { texts.push(typeof q === "string" ? q : q.text); return db.pool.query(q, p); } };
    const env = { refresh_token: SECRETS.envRefresh };
    const withRow = JSON.stringify(await buildAdminStatus({ db: spy, env, now: NOW }));
    await db.pool.query(`delete from integration_tokens where provider = 'spotify'`);
    const envState = JSON.stringify(await buildAdminStatus({ db: spy, env, now: NOW }));
    assert.match(envState, /"state":"env"/);
    for (const secret of Object.values(SECRETS)) {
      assert.ok(!withRow.includes(secret) && !envState.includes(secret), `leaked ${secret}`);
    }
    assert.ok(texts.length > 0);
    for (const q of texts) assert.doesNotMatch(q, /access_token|refresh_token/);
  });

  // Fix round 1 (X1, R2): every mapped field of a Run, in runs and in lastCron. A finished run older than 15 minutes
  // with no lease keeps its status; only the stale running row is shown abandoned.
  test("runs and lastCron come back field for field, and only a stale running row is shown abandoned", async () => {
    await db.pool.query(`insert into sync_runs (job, trigger, dry_run, status, started_at, finished_at, fetched, imported,
        uploads, deferred, skipped, error_count, error) values
      ('instagram', 'cron', false, 'failed', '2026-10-16T10:00:00Z', '2026-10-16T10:03:20Z', 9, 4, 6, 2, 1, 3,
       'Graph API 500 for post 7'),
      ('instagram', 'panel', true, 'partial', '2026-10-16T09:00:00Z', '2026-10-16T09:00:45Z', 12, 11, 5, 7, 8, 10,
       'resize failed for post 3'),
      ('instagram', 'cli', false, 'running', '2026-10-16T07:00:00Z', null, 0, 0, 0, 0, 0, 0, null)`);
    const cron = { id: 1, trigger: "cron", dryRun: false, status: "failed", startedAt: "2026-10-16T10:00:00.000Z",
      finishedAt: "2026-10-16T10:03:20.000Z", fetched: 9, imported: 4, uploads: 6, deferred: 2, skipped: 1, errorCount: 3,
      error: "Graph API 500 for post 7" };
    const panel = { id: 2, trigger: "panel", dryRun: true, status: "partial", startedAt: "2026-10-16T09:00:00.000Z",
      finishedAt: "2026-10-16T09:00:45.000Z", fetched: 12, imported: 11, uploads: 5, deferred: 7, skipped: 8,
      errorCount: 10, error: "resize failed for post 3" };
    const cli = { id: 3, trigger: "cli", dryRun: false, status: "abandoned", startedAt: "2026-10-16T07:00:00.000Z",
      finishedAt: null, fetched: 0, imported: 0, uploads: 0, deferred: 0, skipped: 0, errorCount: 0, error: null };
    const s = await status();
    assert.deepEqual(s.runs, [cron, panel, cli]);
    assert.deepEqual(s.instagram.lastCron, cron);
  });

  // Fix round 1 (X1): every mapped field of an activity row.
  test("activity rows come back field for field, newest first", async () => {
    await db.pool.query(`insert into admin_audit_log (event, actor, details, at) values
      ('instagram_check', $1, '{"status":"ok","fetched":12,"uploads":0}', '2026-10-16T09:30:00Z'),
      ('spotify_connect_failed', null, '{"code":"denied"}', '2026-10-16T11:15:00Z')`, [OWNER_ACTOR]);
    assert.deepEqual((await status()).activity, [
      { id: 2, at: "2026-10-16T11:15:00.000Z", event: "spotify_connect_failed", actor: null, details: { code: "denied" } },
      { id: 1, at: "2026-10-16T09:30:00.000Z", event: "instagram_check", actor: OWNER_ACTOR,
        details: { status: "ok", fetched: 12, uploads: 0 } },
    ]);
  });

  // Fix round 1: the whole connected Spotify object, so no extra field (the account id, updated_at) joins the JSON.
  test("spotify: a connected row comes back as exactly the status fields", async () => {
    await seedSpotify();
    assert.deepEqual((await status()).spotify, { state: "connected", authorizedAt: "2026-08-03T00:00:00.000Z",
      expiresAt: "2027-01-30T00:00:00.000Z", daysLeft: 105, accountMatches: true, scopes: [...SPOTIFY_SCOPES],
      missingScopes: [], deadReason: null });
  });

  // Fix round 1 (X3): an assumed Instagram expiry, and daysLeft floored at fractional instants either side of it.
  test("instagram.token: expiresAtIsAssumed true, and daysLeft floored at fractional instants", async () => {
    await db.pool.query(`insert into integration_tokens (provider, access_token, expires_at, refreshed_at, expires_at_is_assumed)
      values ('instagram', $1, '2026-10-27T06:00:00Z', '2026-08-28T06:00:00Z', true)`, [SECRETS.instagramAccess]);
    assert.deepEqual((await status()).instagram.token, { expiresAt: "2026-10-27T06:00:00.000Z", daysLeft: 10, // 10.75 days
      refreshedAt: "2026-08-28T06:00:00.000Z", expiresAtIsAssumed: true, deadReason: null });
    assert.equal((await status({ now: new Date("2026-10-29T18:00:00Z") })).instagram.token.daysLeft, -3); // -2.5 days
  });

  // Fix round 1 (X2, R1): each read failing alone rejects the whole status; none is swallowed into a guessed value.
  test("any one failed read rejects the whole status", async () => {
    // A connected row and the panel's 1,000-upload ceiling, so the ceiling's own read runs too.
    await seedSpotify();
    await seedRunAgo({ trigger: "cron", dryRun: false, ago: "2 days", uploads: 1000 });
    const texts = new Set();
    const spy = { query: (q, p) => { texts.add(textOf(q)); return db.pool.query(q, p); } };
    await buildAdminStatus({ db: spy, env: { refresh_token: "x" }, now: new Date() });
    assert.ok(texts.size >= 10, `only ${texts.size} distinct reads`);
    for (const target of texts) {
      const failing = { query: (q, p) =>
        (textOf(q) === target ? Promise.reject(new Error("one read failed")) : db.pool.query(q, p)) };
      await assert.rejects(buildAdminStatus({ db: failing, env: { refresh_token: "x" }, now: new Date() }),
        { message: "one read failed" }, target.replace(/\s+/g, " ").slice(0, 90));
    }
  });
  // The same, call by call: the 30-day uploads read runs twice with one text (directly, and inside the import verdict),
  // so failing a text fails both and can't show that the direct read isn't swallowed.
  test("any one failed query call rejects the whole status", async () => {
    await seedSpotify();
    await seedRunAgo({ trigger: "cron", dryRun: false, ago: "2 days", uploads: 1000 });
    let calls = 0;
    const counting = { query: (q, p) => { calls += 1; return db.pool.query(q, p); } };
    await buildAdminStatus({ db: counting, env: { refresh_token: "x" }, now: new Date() });
    assert.ok(calls >= 12, `only ${calls} query calls`);
    for (let i = 0; i < calls; i++) {
      let n = 0;
      let failedText = "";
      const failing = { query: (q, p) => {
        if (n++ !== i) return db.pool.query(q, p);
        failedText = textOf(q).replace(/\s+/g, " ").slice(0, 90);
        return Promise.reject(new Error("one read failed"));
      } };
      const outcome = await buildAdminStatus({ db: failing, env: { refresh_token: "x" }, now: new Date() })
        .then(() => "resolved", (error) => error.message);
      assert.equal(outcome, "one read failed", `call ${i}: ${failedText}`);
    }
  });
  test("a failed Spotify read alone rejects, and is never shown as the env token", async () => {
    await seedSpotify();
    let matched = 0;
    // The Spotify statement is the only one with `provider = $1`; the Instagram token read names its provider.
    const failing = { query: (q, p) => {
      if (!/where provider = \$1/.test(textOf(q))) return db.pool.query(q, p);
      matched += 1;
      return Promise.reject(new Error("statement timeout"));
    } };
    await assert.rejects(buildAdminStatus({ db: failing, env: { refresh_token: "x" }, now: new Date() }),
      { message: "statement timeout" });
    assert.equal(matched, 1);
  });

  // Fix round 1 (R3, X4): with both a verdict and a held slot, each time is the later of the two.
  test("panel: with both a verdict and a held slot, each time is the later one", async () => {
    // Check: a check 1 minute ago (verdict: about 9 minutes) outlasts a check slot held for 2 more minutes.
    await seedRunAgo({ trigger: "panel", dryRun: true, ago: "1 minute" });
    // Import: an import slot held for 3 more hours outlasts an import 23 hours ago (verdict: about 1 hour).
    await seedRunAgo({ trigger: "panel", dryRun: false, ago: "23 hours", uploads: 2 });
    await db.pool.query(`insert into job_locks (name, locked_until) values
      ('instagram-panel-check', now() + interval '2 minutes'), ('instagram-panel-import', now() + interval '3 hours')`);
    const now = new Date();
    const p = (await status({ now })).instagram.panel;
    between(Date.parse(p.nextCheckAt) - now.getTime(), 535_000, 541_000);
    between(Date.parse(p.nextImportAt) - now.getTime(), 10_795_000, 10_801_000);
    assert.equal(p.importBlockedReason, "daily_limit");
  });

  // Fix round 1 (R4, X5): the newest 20 runs and activity rows, and a 30-day window that ends at 30 days.
  test("runs and activity are the newest 20", async () => {
    await db.pool.query(`insert into sync_runs (job, trigger, dry_run, status, started_at, finished_at)
      select 'instagram', 'cli', true, 'ok', $1::timestamptz - make_interval(hours => i),
             $1::timestamptz - make_interval(hours => i)
        from generate_series(0, 21) as i`, [NOW]);
    await db.pool.query(`insert into admin_audit_log (event, actor, details, at)
      select 'instagram_check', $2, '{}'::jsonb, $1::timestamptz - make_interval(hours => i)
        from generate_series(0, 21) as i`, [NOW, OWNER_ACTOR]);
    const newest20 = Array.from({ length: 20 }, (_, i) => hoursBefore(NOW, i).toISOString());
    const s = await status();
    assert.deepEqual(s.runs.map((r) => r.startedAt), newest20);
    assert.deepEqual(s.activity.map((e) => e.at), newest20);
  });
  test("uploads30d ends at 30 days, not 31", async () => {
    await seedRunAgo({ trigger: "cron", dryRun: false, ago: "29 days 18 hours", uploads: 4 });
    await seedRunAgo({ trigger: "cli", dryRun: false, ago: "30 days 6 hours", uploads: 5 });
    assert.equal((await status({ now: new Date() })).instagram.uploads30d, 4);
  });
});
