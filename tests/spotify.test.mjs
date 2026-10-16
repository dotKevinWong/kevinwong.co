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

test("(f) with no row the env refresh_token is used; once rejected it is never sent again", async (t) => {
  t.mock.method(console, "error", () => {});
  const s = setup({ row: null, env: { ...ENV, refresh_token: "env-rt" }, token: [tokenOk("AT1"), tokenError(400, "invalid_grant")], apiResponses: [api()] });
  await s.client.getNowPlaying();
  assert.equal(s.calls.token[0].form.get("refresh_token"), "env-rt");
  s.at(3_540_000);
  await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError);
  assert.deepEqual(s.calls.dead, []); // an env token has no row to mark
  s.at(3_600_000);
  await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError);
  assert.equal(s.calls.reads, 3);
  assert.equal(s.calls.token.length, 2);

  const neither = setup({ row: null, env: ENV });
  await assert.rejects(neither.client.getNowPlaying(), SpotifyReauthRequiredError);
  assert.equal(neither.calls.token.length, 0);
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

test("(h3) no rotation write for an env token or for the same token echoed back", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const fromEnv = setup({ row: null, env: { ...ENV, refresh_token: "env-rt" }, token: [tokenOk("AT1", { refresh_token: "env-rt-2" })], apiResponses: [api()] });
  await fromEnv.client.getNowPlaying();
  assert.deepEqual(fromEnv.calls.rotated, []);
  assert.equal(warn.mock.callCount(), 1);
  assert.ok(!warn.mock.calls[0].arguments.join(" ").includes("env-rt-2"));
  const echoed = setup({ row: live("rt-A"), token: [tokenOk("AT1", { refresh_token: "rt-A" })], apiResponses: [api()] });
  await echoed.client.getNowPlaying();
  assert.deepEqual(echoed.calls.rotated, []);
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

test("(k) SPOTIFY_CLIENT_ID/SECRET win over client_id/client_secret in the Basic header", async () => {
  const both = setup({ row: live("rt-A"), env: { SPOTIFY_CLIENT_ID: "new-id", SPOTIFY_CLIENT_SECRET: "new-secret", client_id: "old-id", client_secret: "old-secret" }, token: [tokenOk("AT1")], apiResponses: [api()] });
  await both.client.getNowPlaying();
  assert.equal(both.calls.token[0].init.headers.Authorization, basic("new-id", "new-secret"));
  const legacy = setup({ row: live("rt-A"), env: { client_id: "old-id", client_secret: "old-secret" }, token: [tokenOk("AT1")], apiResponses: [api()] });
  await legacy.client.getNowPlaying();
  assert.equal(legacy.calls.token[0].init.headers.Authorization, basic("old-id", "old-secret"));
  const none = setup({ row: live("rt-A"), env: {} });
  await assert.rejects(none.client.getNowPlaying(), { message: "Spotify client credentials are not set" });
  assert.deepEqual([none.calls.reads, none.calls.token.length], [0, 0]);
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
