import { test } from "node:test";
import assert from "node:assert/strict";
import * as spotify from "../lib/spotify.js";
import { createSpotifyClient, SpotifyReauthRequiredError } from "../lib/spotify.js";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const NOW_PLAYING_URL = "https://api.spotify.com/v1/me/player/currently-playing";
const TOP_TRACKS_URL = "https://api.spotify.com/v1/me/top/tracks?time_range=short_term&limit=10&offset=5";
const RECENTLY_PLAYED_URL = "https://api.spotify.com/v1/me/player/recently-played?limit=50";
const ENV = { SPOTIFY_CLIENT_ID: "new-id", SPOTIFY_CLIENT_SECRET: "new-secret" };

const live = (refreshToken) => ({ refreshToken, deadReason: null, authorizedAt: new Date(0), expiresAt: new Date(0), accountId: "owner", scopes: [] });
const tokenOk = (accessToken, extra = {}) => () => Response.json({ access_token: accessToken, token_type: "Bearer", expires_in: 3600, ...extra });
const tokenError = (status, error) => () => Response.json(error ? { error } : {}, { status });
const api = (status = 200) => () => Response.json({ ok: status === 200 }, { status });
const basic = (id, secret) => `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup({ row = null, env = ENV, token = [], apiResponses = [], storeTimeoutMs } = {}) {
  let t = 0;
  const calls = { reads: 0, token: [], api: [], rotated: [], dead: [] };
  const store = {
    row, readError: null, rotateError: null,
    async readSpotifyRow() { calls.reads += 1; if (store.readError) throw store.readError; return store.row; },
    async storeRotatedRefreshToken(previous, next) { calls.rotated.push([previous, next]); if (store.rotateError) throw store.rotateError; return true; },
    async markSpotifyDead(reason, failed) { calls.dead.push([reason, failed]); return true; },
  };
  const queues = { token: [...token], api: [...apiResponses] };
  const fetchImpl = async (url, init = {}) => {
    if (url === TOKEN_URL) {
      calls.token.push({ init, form: new URLSearchParams(String(init.body)) });
      const next = queues.token.shift();
      assert.ok(next, "unexpected token call");
      return next();
    }
    calls.api.push({ url, init });
    const next = queues.api.shift();
    assert.ok(next, `unexpected API call to ${url}`);
    return next();
  };
  const client = createSpotifyClient({ store, fetchImpl, now: () => t, env, storeTimeoutMs });
  return { client, store, calls, at: (ms) => { t = ms; } };
}

test("(a) one token call serves sequential getters, and each returns Spotify's raw Response", async () => {
  const nothingPlaying = new Response(null, { status: 204 });
  const s = setup({ row: live("rt-A"), token: [tokenOk("AT1")], apiResponses: [() => nothingPlaying, api(), api()] });
  assert.equal(await s.client.getNowPlaying(), nothingPlaying);
  await s.client.getTopTracks();
  await s.client.getListeningTimeline();
  assert.equal(s.calls.token.length, 1);
  assert.equal(s.calls.reads, 1);
  assert.deepEqual(s.calls.api.map((c) => c.url), [NOW_PLAYING_URL, TOP_TRACKS_URL, RECENTLY_PLAYED_URL]);
  assert.ok(s.calls.api.every((c) => c.init.headers.Authorization === "Bearer AT1" && c.init.signal instanceof AbortSignal));
  const [{ init, form }] = s.calls.token;
  assert.equal(init.method, "POST");
  assert.equal(init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(Object.fromEntries(form), { grant_type: "refresh_token", refresh_token: "rt-A" });
});

test("(b) five concurrent getters on a cold cache share one refresh", async () => {
  const gate = Promise.withResolvers();
  const s = setup({
    row: live("rt-A"),
    token: [async () => { await gate.promise; return tokenOk("AT1")(); }],
    apiResponses: Array.from({ length: 5 }, () => api()),
  });
  const pending = Array.from({ length: 5 }, () => s.client.getNowPlaying());
  await tick();
  gate.resolve();
  const results = await Promise.all(pending);
  assert.equal(s.calls.token.length, 1);
  assert.equal(s.calls.reads, 1);
  assert.equal(s.calls.api.length, 5);
  assert.ok(results.every((r) => r.status === 200));
});

test("(c) the access token is refreshed 60 s before Spotify's stated expiry", async () => {
  const s = setup({ row: live("rt-A"), token: [tokenOk("AT1"), tokenOk("AT2")], apiResponses: [api(), api(), api()] });
  await s.client.getNowPlaying(); // t = 0, expires_in 3600, so reused until 3_540_000
  s.at(3_539_999);
  await s.client.getNowPlaying();
  assert.equal(s.calls.token.length, 1);
  s.at(3_540_000);
  await s.client.getNowPlaying();
  assert.equal(s.calls.token.length, 2);
  assert.equal(s.calls.api[2].init.headers.Authorization, "Bearer AT2");
});

test("(d) invalid_grant on a stored token marks it dead once, then no I/O at all for 60 s", async (t) => {
  const errors = t.mock.method(console, "error", () => {});
  const s = setup({ row: live("rt-A"), token: [tokenError(400, "invalid_grant")] });
  await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError);
  assert.deepEqual(s.calls.dead, [["invalid_grant", "rt-A"]]);
  s.at(59_999);
  await assert.rejects(s.client.getTopTracks(), SpotifyReauthRequiredError);
  await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError);
  assert.deepEqual([s.calls.reads, s.calls.token.length, s.calls.api.length, s.calls.dead.length], [1, 1, 0, 1]);
  assert.ok(errors.mock.callCount() >= 1);
  assert.ok(errors.mock.calls.every((c) => !c.arguments.join(" ").includes("rt-A")));
});

test("(e) after 60 s a reconnected row is read once and used", async (t) => {
  t.mock.method(console, "error", () => {});
  const s = setup({ row: live("rt-A"), token: [tokenError(400, "invalid_grant"), tokenOk("AT2")], apiResponses: [api()] });
  await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError);
  s.store.row = live("rt-B"); // the panel's reconnect
  s.at(60_000);
  assert.equal((await s.client.getNowPlaying()).status, 200);
  assert.equal(s.calls.reads, 2);
  assert.equal(s.calls.token[1].form.get("refresh_token"), "rt-B");
  assert.equal(s.calls.api[0].init.headers.Authorization, "Bearer AT2");
});

test("(e2) a row still dead at the recheck re-arms the latch for another 60 s", async (t) => {
  t.mock.method(console, "error", () => {});
  const s = setup({ row: live("rt-A"), token: [tokenError(400, "invalid_grant")] });
  await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError);
  s.store.row = { ...live("rt-A"), deadReason: "invalid_grant" };
  for (const [at, reads] of [[60_000, 2], [119_999, 2], [120_000, 3]]) {
    s.at(at);
    await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError);
    assert.equal(s.calls.reads, reads);
  }
  assert.equal(s.calls.token.length, 1);
});

test("(e3) a stored token Spotify rejected is never re-sent, even when markSpotifyDead failed", async (t) => {
  t.mock.method(console, "error", () => {});
  const s = setup({ row: live("rt-A"), token: [tokenError(400, "invalid_grant")] });
  s.store.markSpotifyDead = async () => { throw new Error("db down"); };
  await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError); // not "db down"
  s.at(60_000); // the row still holds rt-A, unmarked
  await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError);
  assert.equal(s.calls.reads, 2);
  assert.equal(s.calls.token.length, 1);
});

test("(f) with no row the client is dead, even with env.refresh_token set, and Spotify is never called", async () => {
  const s = setup({ row: null, env: { ...ENV, refresh_token: "env-rt" } }); // nothing queued: a token call fails the test
  await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError);
  await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError); // latched: no second read within 60 s
  assert.equal(s.calls.reads, 1);
  s.at(60_000);
  await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError);
  assert.equal(s.calls.reads, 2);
  assert.equal(s.calls.token.length, 0);
});

test("(f2) a row with no refresh token, or one another instance marked dead, sends nothing: no env fallback, no dead token", async () => {
  const env = { ...ENV, refresh_token: "env-rt" };
  for (const row of [live(null), { ...live("rt-X"), deadReason: "invalid_grant" }]) {
    const s = setup({ row, env }); // a cold instance: it has never seen rt-X rejected itself
    await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError);
    assert.deepEqual([s.calls.reads, s.calls.token.length, s.calls.api.length], [1, 0, 0]);
  }
});

test("(g) a database error rejects the getter and never falls back to the env token", async () => {
  const s = setup({ env: { ...ENV, refresh_token: "env-rt" } });
  s.store.readError = new Error("connect ECONNREFUSED");
  const isDbError = (error) => !(error instanceof SpotifyReauthRequiredError) && error.message === "connect ECONNREFUSED";
  await assert.rejects(s.client.getNowPlaying(), isDbError);
  await assert.rejects(s.client.getNowPlaying(), isDbError); // not latched: the row is read again
  assert.equal(s.calls.reads, 2);
  assert.equal(s.calls.token.length, 0);
});

test("(g2) a stalled database read times out and the next call reads again", { timeout: 2000 }, async () => {
  const s = setup({ row: live("rt-A"), env: { ...ENV, refresh_token: "env-rt" }, storeTimeoutMs: 20 });
  s.store.readSpotifyRow = () => { s.calls.reads += 1; return new Promise(() => {}); }; // a query that never returns
  const isTimeout = (error) => !(error instanceof SpotifyReauthRequiredError) && error.message === "[spotify] Reading the token row timed out";
  await assert.rejects(s.client.getNowPlaying(), isTimeout);
  await assert.rejects(s.client.getNowPlaying(), isTimeout); // not latched, and the stalled read no longer holds the shared refresh
  assert.equal(s.calls.reads, 2);
  assert.equal(s.calls.token.length, 0);
});

test("(g3) by default a store call is bounded at 5 s, the same as the Spotify calls", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = setup({ row: live("rt-A") }); // no storeTimeoutMs: the default applies
  s.store.readSpotifyRow = () => { s.calls.reads += 1; return new Promise(() => {}); };
  let outcome = null;
  s.client.getNowPlaying().catch((error) => { outcome = error; });
  await tick();
  t.mock.timers.tick(4_999);
  await tick();
  assert.equal(outcome, null);
  t.mock.timers.tick(1);
  await tick();
  assert.equal(outcome?.message, "[spotify] Reading the token row timed out");
});

test("(g4) a stalled markSpotifyDead is bounded by storeTimeoutMs, logged, and the client still latches", { timeout: 2000 }, async (t) => {
  const errors = t.mock.method(console, "error", () => {});
  const s = setup({ row: live("rt-A"), token: [tokenError(400, "invalid_grant")], storeTimeoutMs: 20 });
  s.store.markSpotifyDead = (reason, failed) => { s.calls.dead.push([reason, failed]); return new Promise(() => {}); };
  await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError);
  assert.deepEqual(s.calls.dead, [["invalid_grant", "rt-A"]]);
  assert.equal(errors.mock.callCount(), 2); // the invalid_grant line, then this one
  assert.deepEqual(errors.mock.calls[1].arguments, ["[spotify] Could not mark the stored token dead:", "[spotify] Marking the stored token dead timed out"]);
  await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError); // latched
  assert.deepEqual([s.calls.reads, s.calls.token.length], [1, 1]);
});

test("(g5) a stalled rotation write is bounded by storeTimeoutMs, and every waiting getter still gets its response", { timeout: 2000 }, async (t) => {
  const errors = t.mock.method(console, "error", () => {});
  const s = setup({ row: live("rt-A"), token: [tokenOk("AT1", { refresh_token: "rt-B" })], apiResponses: [api(), api()], storeTimeoutMs: 20 });
  s.store.storeRotatedRefreshToken = (previous, next) => { s.calls.rotated.push([previous, next]); return new Promise(() => {}); };
  const results = await Promise.all([s.client.getNowPlaying(), s.client.getTopTracks()]); // the second shares the refresh
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
  assert.deepEqual(s.calls.rotated, [["rt-A", "rt-B"]]);
  assert.equal(s.calls.token.length, 1);
  assert.equal(errors.mock.callCount(), 1);
  assert.deepEqual(errors.mock.calls[0].arguments, ["[spotify] Could not store the rotated refresh token:", "[spotify] Storing the rotated refresh token timed out"]);
});

test("(g6) the token call and each API call are aborted after 5 s", async (t) => {
  const timeouts = t.mock.method(AbortSignal, "timeout"); // records each call, and still makes a real signal
  const s = setup({ row: live("rt-A"), token: [tokenOk("AT1"), tokenOk("AT2")], apiResponses: [api(401), api()] });
  await s.client.getNowPlaying(); // the 401 retry makes a second token call and a second API call
  const msFor = (signal) => timeouts.mock.calls.find((call) => call.result === signal)?.arguments[0];
  assert.deepEqual(s.calls.token.map((call) => msFor(call.init.signal)), [5_000, 5_000]);
  assert.deepEqual(s.calls.api.map((call) => msFor(call.init.signal)), [5_000, 5_000]);
});

test("(h) a rotated refresh token is stored with compare-and-swap on the old one", async () => {
  const s = setup({ row: live("rt-A"), token: [tokenOk("AT1", { refresh_token: "rt-B" })], apiResponses: [api()] });
  await s.client.getNowPlaying();
  assert.deepEqual(s.calls.rotated, [["rt-A", "rt-B"]]);
});

test("(h2) a failed rotation write is logged without the token, and the request still succeeds", async (t) => {
  const errors = t.mock.method(console, "error", () => {});
  const s = setup({ row: live("rt-A"), token: [tokenOk("AT1", { refresh_token: "rt-B" })], apiResponses: [api()] });
  s.store.rotateError = new Error("db down");
  assert.equal((await s.client.getNowPlaying()).status, 200);
  assert.equal(errors.mock.callCount(), 1);
  assert.ok(!/rt-A|rt-B/.test(errors.mock.calls[0].arguments.join(" ")));
});

test("(h3) no rotation write for the same token echoed back", async () => {
  const echoed = setup({ row: live("rt-A"), token: [tokenOk("AT1", { refresh_token: "rt-A" })], apiResponses: [api()] });
  await echoed.client.getNowPlaying();
  assert.deepEqual(echoed.calls.rotated, []);
});

test("(h4) the rotation write has finished before the getter resolves", async () => {
  const s = setup({ row: live("rt-A"), token: [tokenOk("AT1", { refresh_token: "rt-B" })], apiResponses: [api()] });
  let stored = false;
  s.store.storeRotatedRefreshToken = async (previous, next) => {
    s.calls.rotated.push([previous, next]);
    await new Promise((resolve) => setTimeout(resolve, 10)); // a write that lands on a later turn of the event loop
    stored = true;
    return true;
  };
  assert.equal((await s.client.getNowPlaying()).status, 200);
  assert.equal(stored, true);
  assert.deepEqual(s.calls.rotated, [["rt-A", "rt-B"]]);
});

test("(i) a 401 from the API retries once with a fresh token", async () => {
  const s = setup({ row: live("rt-A"), token: [tokenOk("AT1"), tokenOk("AT2")], apiResponses: [api(401), api(200)] });
  assert.equal((await s.client.getNowPlaying()).status, 200);
  assert.deepEqual(s.calls.api.map((c) => c.init.headers.Authorization), ["Bearer AT1", "Bearer AT2"]);
  assert.equal(s.calls.token.length, 2);
});

test("(i2) a second 401 is returned to the route, not retried again", async () => {
  const s = setup({ row: live("rt-A"), token: [tokenOk("AT1"), tokenOk("AT2")], apiResponses: [api(401), api(401)] });
  assert.equal((await s.client.getNowPlaying()).status, 401);
  assert.equal(s.calls.api.length, 2);
});

test("(j) other token errors throw a plain Error, are not latched, and mark nothing", async () => {
  const cases = [
    [tokenError(429), "[spotify] Token refresh failed with 429: unknown error"],
    [tokenError(400, "invalid_client"), "[spotify] Token refresh failed with 400: invalid_client"],
    [tokenError(503), "[spotify] Token refresh failed with 503: unknown error"],
    [() => Response.json({ token_type: "Bearer" }), "[spotify] Token refresh returned no access_token"],
  ];
  for (const [response, message] of cases) {
    const s = setup({ row: live("rt-A"), token: [response, tokenOk("AT1")], apiResponses: [api()] });
    await assert.rejects(s.client.getNowPlaying(), (error) => !(error instanceof SpotifyReauthRequiredError) && error.message === message);
    assert.equal((await s.client.getNowPlaying()).status, 200); // the very next call tries Spotify again
    assert.deepEqual(s.calls.dead, []);
  }
});

test("(k) only SPOTIFY_CLIENT_ID/SECRET reach the Basic header; the lowercase names are ignored", async () => {
  const both = setup({ row: live("rt-A"), env: { SPOTIFY_CLIENT_ID: "new-id", SPOTIFY_CLIENT_SECRET: "new-secret", client_id: "old-id", client_secret: "old-secret" }, token: [tokenOk("AT1")], apiResponses: [api()] });
  await both.client.getNowPlaying();
  assert.equal(both.calls.token[0].init.headers.Authorization, basic("new-id", "new-secret"));
  for (const env of [{ client_id: "old-id", client_secret: "old-secret" }, {}]) {
    const s = setup({ row: live("rt-A"), env });
    await assert.rejects(s.client.getNowPlaying(), { message: "Spotify client credentials are not set" });
    assert.deepEqual([s.calls.reads, s.calls.token.length], [0, 0]);
  }
});

test("(l) reset() during a refresh: the stale result neither latches nor caches", async (t) => {
  t.mock.method(console, "error", () => {});
  const gate = Promise.withResolvers();
  const s = setup({
    row: live("rt-A"),
    token: [async () => { await gate.promise; return tokenError(400, "invalid_grant")(); }, tokenOk("AT2")],
    apiResponses: [api()],
  });
  const first = s.client.getNowPlaying();
  await tick();
  s.client.reset(); // what the callback route does right after saving the new row
  s.store.row = live("rt-B");
  gate.resolve();
  await assert.rejects(first, SpotifyReauthRequiredError);
  assert.equal((await s.client.getNowPlaying()).status, 200); // same instant, yet not latched
  assert.equal(s.calls.token[1].form.get("refresh_token"), "rt-B");

  // The cache half: a stale refresh that succeeds serves its own caller, but its token is not cached.
  const gate2 = Promise.withResolvers();
  const c = setup({
    row: live("rt-A"),
    token: [async () => { await gate2.promise; return tokenOk("AT-old")(); }, tokenOk("AT-new")],
    apiResponses: [api(), api()],
  });
  const stale = c.client.getNowPlaying();
  await tick();
  c.client.reset();
  c.store.row = live("rt-B");
  gate2.resolve();
  assert.equal((await stale).status, 200);
  assert.equal((await c.client.getNowPlaying()).status, 200);
  assert.equal(c.calls.token.length, 2);
  assert.equal(c.calls.token[1].form.get("refresh_token"), "rt-B");
  assert.deepEqual(c.calls.api.map((call) => call.init.headers.Authorization), ["Bearer AT-old", "Bearer AT-new"]);
});

test("(l2) reset() forgets the cached token, the latch and the dead token", async (t) => {
  t.mock.method(console, "error", () => {});
  // A cached access token from the old authorization is not served after a reconnect.
  const cachedOld = setup({ row: live("rt-A"), token: [tokenOk("AT1"), tokenOk("AT2")], apiResponses: [api(), api()] });
  await cachedOld.client.getNowPlaying();
  cachedOld.client.reset();
  cachedOld.store.row = live("rt-B");
  await cachedOld.client.getNowPlaying();
  assert.equal(cachedOld.calls.token[1]?.form.get("refresh_token"), "rt-B");
  assert.equal(cachedOld.calls.api[1].init.headers.Authorization, "Bearer AT2");

  // An instance latched dead serves the reconnected row at once, not 60 s later.
  const latched = setup({ row: live("rt-A"), token: [tokenError(400, "invalid_grant"), tokenOk("AT2")], apiResponses: [api()] });
  await assert.rejects(latched.client.getNowPlaying(), SpotifyReauthRequiredError);
  latched.client.reset();
  latched.store.row = live("rt-B");
  assert.equal((await latched.client.getNowPlaying()).status, 200); // the same instant
  assert.equal(latched.calls.token[1].form.get("refresh_token"), "rt-B");

  // After reset() even a token string it saw rejected is tried again, as a reconnect would hand it back.
  const sameString = setup({ row: live("rt-A"), token: [tokenError(400, "invalid_grant"), tokenOk("AT2")], apiResponses: [api()] });
  await assert.rejects(sameString.client.getNowPlaying(), SpotifyReauthRequiredError);
  sameString.client.reset();
  sameString.at(60_000); // past the latch, so only deadToken could stop it
  assert.equal((await sameString.client.getNowPlaying()).status, 200);
  assert.equal(sameString.calls.token[1].form.get("refresh_token"), "rt-A");
});

test("(l3) after reset() a call neither joins nor is cut off by the refresh begun before it", async () => {
  const before = Promise.withResolvers();
  const after = Promise.withResolvers();
  const s = setup({
    row: live("rt-A"),
    token: [
      async () => { await before.promise; return tokenOk("AT-old")(); },
      async () => { await after.promise; return tokenOk("AT-new")(); },
    ],
    apiResponses: [api(), api(), api()],
  });
  const stale = s.client.getNowPlaying();
  await tick();
  s.client.reset();
  s.store.row = live("rt-B");
  const fresh = s.client.getNowPlaying();
  await tick();
  assert.equal(s.calls.token.length, 2); // its own refresh, not the stale one
  assert.equal(s.calls.token[1].form.get("refresh_token"), "rt-B");
  before.resolve();
  assert.equal((await stale).status, 200);
  const third = s.client.getNowPlaying(); // the stale refresh has settled; the fresh one is still running
  await tick();
  assert.equal(s.calls.token.length, 2); // it joins the fresh refresh
  after.resolve();
  assert.deepEqual((await Promise.all([fresh, third])).map((r) => r.status), [200, 200]);
  assert.deepEqual(s.calls.api.map((call) => call.init.headers.Authorization), ["Bearer AT-old", "Bearer AT-new", "Bearer AT-new"]);
});

test("(m) the module keeps its public names and error class", () => {
  assert.deepEqual(Object.keys(spotify).sort(), [
    "SpotifyReauthRequiredError", "createSpotifyClient", "getListeningTimeline",
    "getNowPlaying", "getTopTracks", "resetSpotifyTokenCache",
  ]);
  const error = new SpotifyReauthRequiredError();
  assert.ok(error instanceof Error);
  assert.equal(error.name, "SpotifyReauthRequiredError");
  assert.equal(error.message, "Spotify refresh token is expired or revoked");
});
