import { test } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import {
  CLEAR_STATE_COOKIE, completeSpotifyReconnect, handleSpotifyAuthorize, handleSpotifyCallback,
  newState, readStateCookie, stateCookie, statesMatch,
} from "../lib/admin/spotify-reconnect.js";
import { SPOTIFY_ADMIN_REDIRECT_URI } from "../lib/spotify-oauth.js";
import { SPOTIFY_SCOPES } from "../lib/spotify-token.js";
import { OWNER_SPOTIFY_ACCOUNT_ID } from "../lib/admin/owner.js";
import { OWNER_ACTOR } from "../lib/admin/audit-log.js";
import { fakeAuth, fakeDb, fakeReq, fakeRes, withEnv } from "./helpers/admin-fakes.mjs";
import "./helpers/resolve-extensionless.mjs";

const NO_STORE = "private, no-store, max-age=0, must-revalidate";
const CLEAR = "__Host-kw_spotify_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";
const STATE_COOKIE_RE = /^__Host-kw_spotify_state=([A-Za-z0-9_-]{43}); HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=600$/;
const SPOTIFY_ENV = { VERCEL_ENV: "production", SPOTIFY_CLIENT_ID: "cid", SPOTIFY_CLIENT_SECRET: "csecret" };
const STATE = "A".repeat(43);
const GOOD = { code: "the-code", state: STATE };

function fakeReconnect(overrides = {}) {
  const calls = { exchange: [], account: [], save: [], reset: 0, log: [] };
  const deps = {
    env: SPOTIFY_ENV,
    exchangeCode: async (args) => { calls.exchange.push(args); return { refreshToken: "new-refresh", accessToken: "new-access", scopes: [...SPOTIFY_SCOPES], expiresIn: 3600 }; },
    fetchSpotifyAccountId: async (accessToken) => { calls.account.push(accessToken); return OWNER_SPOTIFY_ACCOUNT_ID; },
    saveSpotifyAuthorization: async (row) => { calls.save.push(row); return { authorizedAt: new Date(), expiresAt: new Date() }; },
    resetSpotifyTokenCache: () => { calls.reset += 1; },
    logAdminEvent: async (event, options) => { calls.log.push({ event, ...options }); },
    ...overrides,
  };
  return { deps, calls };
}

// logs is muteConsole(t): a failure prints exactly its one fixed warn line. details is the whole object, so no
// extra key (the code, a state, a token, an Error) can ride along in the audit row.
function assertFailed(result, calls, code, { logged = true, details = { code }, logs } = {}) {
  assert.deepEqual(result, { outcome: code, location: `/admin?spotify_error=${code}` });
  assert.equal(calls.save.length, 0, "nothing saved");
  assert.equal(calls.reset, 0, "cache not reset");
  if (logs) {
    assert.deepEqual(logs.consoleWarn.mock.calls.map((c) => c.arguments), [[`[admin/spotify] reconnect failed: ${code}`]]);
    assert.equal(logs.consoleError.mock.callCount(), 0, "no error line");
  }
  if (!logged) return assert.equal(calls.log.length, 0, "no audit row");
  assert.deepEqual(calls.log, [{ event: "spotify_connect_failed", actor: OWNER_ACTOR, details }]);
}

const LEAKY_MESSAGE = "password authentication failed for postgresql://kw_owner:npg_hunter2@db.example.test/neondb";
const REDACTED_LINE = "Error [28P01]: password authentication failed for postgresql://[redacted]@db.example.test/neondb";

function leakyError() {
  return Object.assign(new Error(LEAKY_MESSAGE), { code: "28P01", detail: "Key (refresh_token)=(detail-secret)" });
}

function rejectingDb() {
  const calls = [];
  return { calls, async query(sql, params) { calls.push({ sql, params }); throw leakyError(); } };
}

function assertOneRedactedLine({ consoleError, consoleWarn }, prefix) {
  assert.equal(consoleError.mock.callCount(), 1, "one error line");
  const args = consoleError.mock.calls[0].arguments;
  assert.ok(args.every((arg) => typeof arg === "string"), "only strings are logged");
  assert.deepEqual(args, [prefix, REDACTED_LINE]);
  assert.ok(!args.join(" ").includes("npg_hunter2"), "no credential");
  assert.ok(!args.join(" ").includes("detail-secret"), "no pg detail");
  assert.equal(consoleWarn.mock.callCount(), 0, "nothing else was logged");
}

// Mutes the warn and error lines the failure paths print, and returns the mocks so a test can assert them.
function muteConsole(t) {
  return { consoleError: t.mock.method(console, "error", () => {}), consoleWarn: t.mock.method(console, "warn", () => {}) };
}

// A todo, like tests/admin-owner.test.mjs's: the id is still the placeholder until Kevin fills it in.
test("OWNER_SPOTIFY_ACCOUNT_ID is filled in", { todo: "Kevin's Spotify account id pending (Task 7 Step 8)" }, () => {
  assert.match(OWNER_SPOTIFY_ACCOUNT_ID, /^[^<>\s]+$/);
});

test("newState returns 43 base64url characters and differs each call", () => {
  const a = newState();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(newState(), a);
});

test("stateCookie and CLEAR_STATE_COOKIE are exact", () => {
  assert.equal(stateCookie(STATE), `__Host-kw_spotify_state=${STATE}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
  assert.equal(CLEAR_STATE_COOKIE, CLEAR);
});

test("readStateCookie ignores an encoded or differently-cased cookie name", () => {
  // A sibling host can set __%48ost-… without the browser's __Host- rules: the name is never decoded or folded.
  for (const name of ["__%48ost-kw_spotify_state", "__host-kw_spotify_state", "__HOST-KW_SPOTIFY_STATE", "__Host-kw%5Fspotify_state"]) {
    assert.equal(readStateCookie(`${name}=${STATE}`), null, name);
  }
});

test("readStateCookie reads only __Host-kw_spotify_state", () => {
  assert.equal(readStateCookie(`theme=dark; __Host-kw_spotify_state=${STATE}; b=2`), STATE);
  assert.equal(readStateCookie(`__Host-kw_spotify_state=${STATE}`), STATE);
  assert.equal(readStateCookie("__Host-kw_spotify_state="), null);
  assert.equal(readStateCookie(`x__Host-kw_spotify_state=${STATE}`), null);
  assert.equal(readStateCookie(undefined), null);
});

test("statesMatch is true only for two equal non-empty strings", () => {
  assert.equal(statesMatch(STATE, STATE), true);
  for (const [a, b] of [[STATE, `${STATE}A`], [STATE, `${"A".repeat(42)}B`], [null, STATE], [STATE, undefined], ["", ""], [STATE, [STATE]]]) {
    assert.equal(statesMatch(a, b), false, `${a} vs ${b}`);
  }
});

test("denied: Spotify's error param with a matching state fails without an exchange", async (t) => {
  const logs = muteConsole(t);
  const { deps, calls } = fakeReconnect();
  assertFailed(await completeSpotifyReconnect({ query: { error: "access_denied", state: STATE }, cookieState: STATE, deps }), calls, "denied",
    { details: { code: "denied", reason: "access_denied" }, logs });
  assert.equal(calls.exchange.length, 0);
});

test("denied records only access_denied or other, never Spotify's text", async (t) => {
  const logs = muteConsole(t);
  const { deps, calls } = fakeReconnect();
  assertFailed(await completeSpotifyReconnect({ query: { error: "<b>planted text</b>", state: STATE }, cookieState: STATE, deps }), calls, "denied",
    { details: { code: "denied", reason: "other" }, logs });
  assert.ok(!JSON.stringify(calls.log).includes("planted"));
});

test("the state is checked first: an error param without a state cookie is state_mismatch and writes no audit row", async (t) => {
  const logs = muteConsole(t);
  const { deps, calls } = fakeReconnect();
  assertFailed(await completeSpotifyReconnect({ query: { error: "attacker text" }, cookieState: null, deps }), calls, "state_mismatch", { logged: false, logs });
  assert.equal(calls.exchange.length, 0);
});

for (const [name, query, cookieState, logged] of [
  ["missing cookie", GOOD, null, false],
  ["missing state param", { code: "the-code" }, STATE, true],
  ["different length", { code: "the-code", state: `${STATE}A` }, STATE, true],
  ["different value", { code: "the-code", state: `${"A".repeat(42)}B` }, STATE, true],
  ["repeated state param", { code: "the-code", state: [STATE, STATE] }, STATE, true],
  ["empty cookie and empty param", { code: "the-code", state: "" }, "", false],
]) {
  test(`state_mismatch: ${name}`, async (t) => {
    const logs = muteConsole(t);
    const { deps, calls } = fakeReconnect();
    assertFailed(await completeSpotifyReconnect({ query, cookieState, deps }), calls, "state_mismatch", { logged, logs });
    assert.equal(calls.exchange.length, 0);
  });
}

test("not_configured: no Spotify client credentials", async (t) => {
  const logs = muteConsole(t);
  const { deps, calls } = fakeReconnect({ env: { VERCEL_ENV: "production" } });
  assertFailed(await completeSpotifyReconnect({ query: GOOD, cookieState: STATE, deps }), calls, "not_configured", { logs });
  assert.equal(calls.exchange.length, 0);
});

test("exchange_failed: no code", async (t) => {
  const logs = muteConsole(t);
  const { deps, calls } = fakeReconnect();
  assertFailed(await completeSpotifyReconnect({ query: { state: STATE }, cookieState: STATE, deps }), calls, "exchange_failed",
    { details: { code: "exchange_failed", reason: "missing code" }, logs });
  assert.equal(calls.exchange.length, 0);
});

test("exchange_failed: the code exchange throws", async (t) => {
  const logs = muteConsole(t);
  const { deps, calls } = fakeReconnect({ exchangeCode: async () => { throw new Error("Spotify token exchange failed with 400"); } });
  assertFailed(await completeSpotifyReconnect({ query: GOOD, cookieState: STATE, deps }), calls, "exchange_failed",
    { details: { code: "exchange_failed", reason: "Spotify token exchange failed with 400" }, logs });
  assert.equal(calls.account.length, 0);
});

test("missing_scopes: a scope was not granted", async (t) => {
  const logs = muteConsole(t);
  const granted = SPOTIFY_SCOPES.filter((s) => s !== "user-read-recently-played");
  const { deps, calls } = fakeReconnect({ exchangeCode: async () => ({ refreshToken: "new-refresh", accessToken: "new-access", scopes: granted, expiresIn: 3600 }) });
  assertFailed(await completeSpotifyReconnect({ query: GOOD, cookieState: STATE, deps }), calls, "missing_scopes",
    { details: { code: "missing_scopes", missing: ["user-read-recently-played"] }, logs });
  assert.equal(calls.account.length, 0);
});

test("missing_scopes: three scopes granted, but one is the wrong one", async (t) => {
  const logs = muteConsole(t);
  const granted = ["user-read-currently-playing", "user-top-read", "user-library-read"];
  const { deps, calls } = fakeReconnect({ exchangeCode: async () => ({ refreshToken: "new-refresh", accessToken: "new-access", scopes: granted, expiresIn: 3600 }) });
  assertFailed(await completeSpotifyReconnect({ query: GOOD, cookieState: STATE, deps }), calls, "missing_scopes",
    { details: { code: "missing_scopes", missing: ["user-read-recently-played"] }, logs });
  assert.equal(calls.account.length, 0);
});

test("account_lookup_failed: /v1/me fails", async (t) => {
  const logs = muteConsole(t);
  const { deps, calls } = fakeReconnect({ fetchSpotifyAccountId: async () => { throw new Error("Spotify /v1/me failed with 503"); } });
  assertFailed(await completeSpotifyReconnect({ query: GOOD, cookieState: STATE, deps }), calls, "account_lookup_failed",
    { details: { code: "account_lookup_failed", reason: "Spotify /v1/me failed with 503" }, logs });
});

test("wrong_account: another Spotify account approved", async (t) => {
  const logs = muteConsole(t);
  const { deps, calls } = fakeReconnect({ fetchSpotifyAccountId: async () => "someone-else" });
  assertFailed(await completeSpotifyReconnect({ query: GOOD, cookieState: STATE, deps }), calls, "wrong_account",
    { details: { code: "wrong_account", accountId: "someone-else" }, logs });
});

test("save_failed: the database write throws and the cache is not reset", async (t) => {
  const logs = muteConsole(t);
  const { deps, calls } = fakeReconnect({ saveSpotifyAuthorization: async () => { throw new Error("connection terminated"); } });
  assertFailed(await completeSpotifyReconnect({ query: GOOD, cookieState: STATE, deps }), calls, "save_failed",
    { details: { code: "save_failed", reason: "connection terminated" }, logs });
});

test("save_failed keeps only the message of a pg-shaped error, never its detail", async (t) => {
  // pg's DatabaseError carries the failing row, token included, as an own enumerable `detail`.
  const logs = muteConsole(t);
  const pgError = Object.assign(new Error('new row for relation "integration_tokens" violates check constraint "integration_tokens_has_token"'), {
    code: "23514",
    detail: "Failing row contains (spotify, null, new-refresh, …).",
  });
  const { deps, calls } = fakeReconnect({ saveSpotifyAuthorization: async () => { throw pgError; } });
  assertFailed(await completeSpotifyReconnect({ query: GOOD, cookieState: STATE, deps }), calls, "save_failed",
    { details: { code: "save_failed", reason: pgError.message }, logs });
  assert.ok(!JSON.stringify(calls.log).includes("new-refresh"));
});

test("no failure outcome puts the code, a state, a token or the client secret in a log line or an audit row", async (t) => {
  const channels = ["log", "info", "warn", "error", "debug"].map((name) => t.mock.method(console, name, () => {}));
  const OTHER_STATE = `${"A".repeat(42)}B`;
  const SECRETS = ["the-code", STATE, OTHER_STATE, "new-refresh", "new-access", "csecret"];
  for (const [code, overrides, query] of [
    ["state_mismatch", {}, { code: "the-code", state: OTHER_STATE }],
    ["exchange_failed", { exchangeCode: async () => { throw new Error("Token exchange failed with 400: invalid_grant"); } }, GOOD],
    ["missing_scopes", { exchangeCode: async () => ({ refreshToken: "new-refresh", accessToken: "new-access", scopes: ["user-top-read"], expiresIn: 3600 }) }, GOOD],
    ["account_lookup_failed", { fetchSpotifyAccountId: async () => { throw new Error("Account lookup failed with 503"); } }, GOOD],
    ["wrong_account", { fetchSpotifyAccountId: async () => "someone-else" }, GOOD],
    ["save_failed", { saveSpotifyAuthorization: async () => { throw new Error("connection terminated"); } }, GOOD],
  ]) {
    for (const channel of channels) channel.mock.resetCalls();
    const { deps, calls } = fakeReconnect(overrides);
    assert.equal((await completeSpotifyReconnect({ query, cookieState: STATE, deps })).outcome, code);
    // inspect, not String: an object logged whole would show its own properties here.
    const lines = channels.flatMap((channel) => channel.mock.calls.map((c) => c.arguments.map((arg) => (typeof arg === "string" ? arg : inspect(arg))).join(" ")));
    assert.ok(lines.length > 0, `${code}: the failure was logged`);
    const text = `${JSON.stringify(calls.log)}\n${lines.join("\n")}`;
    for (const secret of SECRETS) assert.ok(!text.includes(secret), `${code}: ${secret} leaked`);
  }
});

test("connected: saves the authorization, resets the cache and logs spotify_connected", async () => {
  const { deps, calls } = fakeReconnect();
  const result = await completeSpotifyReconnect({ query: GOOD, cookieState: STATE, deps });
  assert.deepEqual(result, { outcome: "connected", location: "/admin?spotify=connected" });
  assert.deepEqual(calls.exchange, [{ code: "the-code", redirectUri: SPOTIFY_ADMIN_REDIRECT_URI, clientId: "cid", clientSecret: "csecret" }]);
  assert.deepEqual(calls.account, ["new-access"]);
  assert.deepEqual(calls.save, [{ refreshToken: "new-refresh", accountId: OWNER_SPOTIFY_ACCOUNT_ID, scopes: [...SPOTIFY_SCOPES] }]);
  assert.equal(calls.reset, 1);
  assert.deepEqual(calls.log, [{ event: "spotify_connected", actor: OWNER_ACTOR, details: { accountId: OWNER_SPOTIFY_ACCOUNT_ID, scopes: [...SPOTIFY_SCOPES] } }]);
  assert.ok(!JSON.stringify(calls.log).includes("new-refresh"));
  assert.ok(!JSON.stringify(calls.log).includes("new-access"));
  assert.ok(!JSON.stringify(calls.log).includes("the-code"));
});

test("connected even when the audit log write fails", async (t) => {
  const logs = muteConsole(t);
  const { deps, calls } = fakeReconnect({ logAdminEvent: async () => { throw new Error("database down"); } });
  assert.equal((await completeSpotifyReconnect({ query: GOOD, cookieState: STATE, deps })).outcome, "connected");
  assert.equal(calls.save.length, 1);
  assert.deepEqual(logs.consoleError.mock.calls.map((c) => c.arguments), [["[admin/spotify] audit log write failed:", "Error: database down"]]);
});

test("a failed audit write logs one redacted string line, never the Error object", async (t) => {
  const logs = muteConsole(t);
  const { deps, calls } = fakeReconnect({ logAdminEvent: async () => { throw leakyError(); } });
  assert.equal((await completeSpotifyReconnect({ query: GOOD, cookieState: STATE, deps })).outcome, "connected");
  assert.equal(calls.save.length, 1);
  assertOneRedactedLine(logs, "[admin/spotify] audit log write failed:");
});

const adminDeps = (overrides = {}) => ({ env: SPOTIFY_ENV, auth: fakeAuth(), db: fakeDb(1), ...overrides });

test("authorize answers GET with 405 and sets no state cookie", async () => {
  const res = fakeRes();
  await handleSpotifyAuthorize(fakeReq({ method: "GET" }), res, adminDeps());
  assert.equal(res.statusCode, 405);
  assert.equal(res.getHeader("Allow"), "POST");
  assert.deepEqual(res.body, { error: "method_not_allowed" });
  assert.equal(res.getHeader("Set-Cookie"), undefined);
  assert.equal(res.getHeader("Cache-Control"), NO_STORE);
});

test("authorize 404s on a preview deployment", async () => {
  const res = fakeRes();
  await handleSpotifyAuthorize(fakeReq({ method: "POST", origin: "https://www.kevinwong.co" }), res, adminDeps({ env: { ...SPOTIFY_ENV, VERCEL_ENV: "preview" } }));
  assert.equal(res.statusCode, 404);
  assert.equal(res.getHeader("Set-Cookie"), undefined);
});

test("authorize refuses a POST from https://kevinwong.co before reading the session", async () => {
  const res = fakeRes();
  const auth = fakeAuth(null);
  await handleSpotifyAuthorize(fakeReq({ method: "POST", origin: "https://kevinwong.co" }), res, adminDeps({ auth }));
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: "bad_origin" });
  assert.equal(res.getHeader("Set-Cookie"), undefined);
  assert.equal(auth.calls.length, 0);
});

test("authorize without a session 303s to /admin/sign-in and sets no state cookie", async () => {
  const res = fakeRes();
  await handleSpotifyAuthorize(fakeReq({ method: "POST", origin: "https://www.kevinwong.co" }), res, adminDeps({ auth: fakeAuth(null) }));
  assert.equal(res.statusCode, 303);
  assert.equal(res.getHeader("Location"), "/admin/sign-in");
  assert.equal(res.getHeader("Set-Cookie"), undefined);
  assert.equal(res.getHeader("Cache-Control"), NO_STORE);
  assert.equal(res.ended, true);
});

test("authorize sets the state cookie and 303s to Spotify's approve page", async () => {
  const res = fakeRes();
  await handleSpotifyAuthorize(fakeReq({ method: "POST", origin: "https://www.kevinwong.co" }), res, adminDeps());
  assert.equal(res.statusCode, 303);
  const match = STATE_COOKIE_RE.exec(res.getHeader("Set-Cookie"));
  assert.ok(match, res.getHeader("Set-Cookie"));
  const location = res.getHeader("Location");
  assert.ok(location.startsWith("https://accounts.spotify.com/authorize?"), location);
  const params = new URL(location).searchParams;
  assert.equal(params.get("state"), match[1]);
  assert.equal(params.get("client_id"), "cid");
  assert.equal(params.get("redirect_uri"), SPOTIFY_ADMIN_REDIRECT_URI);
  assert.equal(params.get("response_type"), "code");
  assert.equal(params.get("show_dialog"), "true");
  assert.equal(params.get("scope"), SPOTIFY_SCOPES.join(" "));
  assert.equal(res.getHeader("Cache-Control"), NO_STORE);
  assert.equal(res.ended, true);
});

test("authorize without Spotify credentials 303s to not_configured and sets no state", async (t) => {
  const logs = muteConsole(t);
  const log = [];
  const res = fakeRes();
  await handleSpotifyAuthorize(fakeReq({ method: "POST", origin: "https://www.kevinwong.co" }), res,
    adminDeps({ env: { VERCEL_ENV: "production" }, logAdminEvent: async (event, options) => { log.push({ event, ...options }); } }));
  assert.equal(res.statusCode, 303);
  assert.equal(res.getHeader("Location"), "/admin?spotify_error=not_configured");
  assert.equal(res.getHeader("Set-Cookie"), undefined);
  assert.equal(res.getHeader("Cache-Control"), NO_STORE);
  assert.deepEqual(log, [{ event: "spotify_connect_failed", actor: OWNER_ACTOR, details: { code: "not_configured" } }]);
  assert.deepEqual(logs.consoleWarn.mock.calls.map((c) => c.arguments), [["[admin/spotify] reconnect failed: not_configured"]]);
});

test("callback clears the state cookie even when admin is disabled", async () => {
  const res = fakeRes();
  await handleSpotifyCallback(fakeReq({ query: GOOD }), res, adminDeps({ env: { ...SPOTIFY_ENV, VERCEL_ENV: "preview" } }));
  assert.equal(res.statusCode, 404);
  assert.equal(res.getHeader("Set-Cookie"), CLEAR);
});

test("callback without a session 303s to /admin/sign-in, clears the state cookie and exchanges nothing", async () => {
  const { deps, calls } = fakeReconnect();
  const res = fakeRes();
  await handleSpotifyCallback(fakeReq({ cookie: `__Host-kw_spotify_state=${STATE}`, query: GOOD }), res, { ...deps, auth: fakeAuth(null), db: fakeDb(1) });
  assert.equal(res.statusCode, 303);
  assert.equal(res.getHeader("Location"), "/admin/sign-in");
  assert.equal(res.getHeader("Set-Cookie"), CLEAR);
  assert.equal(res.getHeader("Cache-Control"), NO_STORE);
  assert.equal(calls.exchange.length, 0);
  assert.equal(calls.log.length, 0);
});

test("callback answers POST with 405", async () => {
  const res = fakeRes();
  await handleSpotifyCallback(fakeReq({ method: "POST", origin: "https://www.kevinwong.co" }), res, adminDeps());
  assert.equal(res.statusCode, 405);
  assert.equal(res.getHeader("Allow"), "GET");
  assert.equal(res.getHeader("Set-Cookie"), CLEAR);
});

test("callback connects with a matching state cookie and 303s to /admin?spotify=connected", async () => {
  const { deps, calls } = fakeReconnect();
  const res = fakeRes();
  await handleSpotifyCallback(
    fakeReq({ cookie: `theme=dark; __Host-kw_spotify_state=${STATE}`, query: GOOD }),
    res, { ...deps, auth: fakeAuth(), db: fakeDb(1) },
  );
  assert.equal(res.statusCode, 303);
  assert.equal(res.getHeader("Location"), "/admin?spotify=connected");
  assert.equal(res.getHeader("Set-Cookie"), CLEAR);
  assert.equal(res.getHeader("Cache-Control"), NO_STORE);
  assert.equal(calls.save.length, 1);
  assert.equal(calls.reset, 1);
});

function assertCallbackFailed(res, calls, code) {
  assert.equal(res.statusCode, 303);
  assert.equal(res.getHeader("Location"), `/admin?spotify_error=${code}`);
  assert.equal(res.getHeader("Set-Cookie"), CLEAR);
  assert.equal(res.getHeader("Cache-Control"), NO_STORE);
  assert.equal(res.ended, true);
  assert.equal(calls.exchange.length, 0, "nothing exchanged");
  assert.equal(calls.save.length, 0, "nothing saved");
}

test("callback without a state cookie 303s to state_mismatch, clears the cookie and exchanges nothing", async (t) => {
  const logs = muteConsole(t);
  const { deps, calls } = fakeReconnect();
  const res = fakeRes();
  await handleSpotifyCallback(fakeReq({ query: GOOD }), res, { ...deps, auth: fakeAuth(), db: fakeDb(1) });
  assertCallbackFailed(res, calls, "state_mismatch");
  assert.equal(calls.log.length, 0, "no reconnect was in flight, so no audit row");
  assert.equal(logs.consoleWarn.mock.callCount(), 1);
});

test("callback with a state param that doesn't match the cookie 303s to state_mismatch and clears the cookie", async (t) => {
  muteConsole(t);
  const { deps, calls } = fakeReconnect();
  const res = fakeRes();
  await handleSpotifyCallback(
    fakeReq({ cookie: `__Host-kw_spotify_state=${STATE}`, query: { code: "the-code", state: `${"A".repeat(42)}B` } }),
    res, { ...deps, auth: fakeAuth(), db: fakeDb(1) },
  );
  assertCallbackFailed(res, calls, "state_mismatch");
  assert.deepEqual(calls.log, [{ event: "spotify_connect_failed", actor: OWNER_ACTOR, details: { code: "state_mismatch" } }]);
});

test("callback with Spotify's access_denied and a matching state 303s to denied and clears the cookie", async (t) => {
  muteConsole(t);
  const { deps, calls } = fakeReconnect();
  const res = fakeRes();
  await handleSpotifyCallback(
    fakeReq({ cookie: `__Host-kw_spotify_state=${STATE}`, query: { error: "access_denied", state: STATE } }),
    res, { ...deps, auth: fakeAuth(), db: fakeDb(1) },
  );
  assertCallbackFailed(res, calls, "denied");
  assert.deepEqual(calls.log, [{ event: "spotify_connect_failed", actor: OWNER_ACTOR, details: { code: "denied", reason: "access_denied" } }]);
});

test("callback ignores redirect-looking query parameters", async (t) => {
  muteConsole(t);
  const REDIRECTS = { next: "https://evil.example/", redirect: "//evil.example", redirect_uri: "https://evil.example/cb", return_to: "//evil.example" };
  const cookie = `__Host-kw_spotify_state=${STATE}`;
  for (const [query, location] of [
    [{ ...GOOD, ...REDIRECTS }, "/admin?spotify=connected"],
    [{ code: "the-code", state: `${"A".repeat(42)}B`, ...REDIRECTS }, "/admin?spotify_error=state_mismatch"],
  ]) {
    const { deps } = fakeReconnect();
    const res = fakeRes();
    await handleSpotifyCallback(fakeReq({ cookie, query }), res, { ...deps, auth: fakeAuth(), db: fakeDb(1) });
    assert.equal(res.getHeader("Location"), location);
  }
});

// A failed owner check (database down, Better Auth's schema check) or any other rejection the handlers don't
// turn into a redirect: one redacted string line and a 500, never the Error object, its stack or pg's detail.
test("authorize answers a failed owner check with one redacted line and a 500", async (t) => {
  const logs = muteConsole(t);
  const db = rejectingDb();
  const res = fakeRes();
  await handleSpotifyAuthorize(fakeReq({ method: "POST", origin: "https://www.kevinwong.co" }), res, adminDeps({ db }));
  assert.equal(db.calls.length, 1, "the owner check reached the database");
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: "server_error" });
  assert.equal(res.getHeader("Cache-Control"), NO_STORE);
  assert.equal(res.getHeader("Set-Cookie"), undefined);
  assert.equal(res.getHeader("Location"), undefined);
  assertOneRedactedLine(logs, "[admin/spotify] owner check failed:");
});

test("callback answers a failed owner check with one redacted line and a 500, and exchanges nothing", async (t) => {
  const logs = muteConsole(t);
  const { deps, calls } = fakeReconnect();
  const db = rejectingDb();
  const res = fakeRes();
  await handleSpotifyCallback(fakeReq({ cookie: `__Host-kw_spotify_state=${STATE}`, query: GOOD }), res, { ...deps, auth: fakeAuth(), db });
  assert.equal(db.calls.length, 1, "the owner check reached the database");
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: "server_error" });
  assert.equal(res.getHeader("Cache-Control"), NO_STORE);
  assert.equal(res.getHeader("Set-Cookie"), CLEAR);
  assert.equal(res.getHeader("Location"), undefined);
  assert.equal(calls.exchange.length, 0);
  assert.equal(calls.log.length, 0);
  assertOneRedactedLine(logs, "[admin/spotify] owner check failed:");
});

test("callback answers a rejection the reconnect doesn't handle with one redacted line and a 500", async (t) => {
  const logs = muteConsole(t);
  const { deps } = fakeReconnect({ resetSpotifyTokenCache: () => { throw leakyError(); } });
  const res = fakeRes();
  await handleSpotifyCallback(fakeReq({ cookie: `__Host-kw_spotify_state=${STATE}`, query: GOOD }), res, { ...deps, auth: fakeAuth(), db: fakeDb(1) });
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: "server_error" });
  assert.equal(res.getHeader("Set-Cookie"), CLEAR);
  assert.equal(res.getHeader("Location"), undefined);
  assertOneRedactedLine(logs, "[admin/spotify] reconnect failed unexpectedly:");
});

// The real pages/api/admin/spotify/* files, loaded through tests/helpers/resolve-extensionless.mjs, with no
// injected deps, no auth configuration and no database.
const authorizeRoute = await import("../pages/api/admin/spotify/authorize.js");
const callbackRoute = await import("../pages/api/admin/spotify/callback.js");
const NO_AUTH_ENV = {
  VERCEL_ENV: undefined, NODE_ENV: undefined, DATABASE_URL: undefined,
  BETTER_AUTH_URL: undefined, BETTER_AUTH_SECRET: undefined, GITHUB_CLIENT_ID: undefined, GITHUB_CLIENT_SECRET: undefined,
};

test("both Spotify routes turn the body parser off", () => {
  assert.deepEqual(authorizeRoute.config, { api: { bodyParser: false } });
  assert.deepEqual(callbackRoute.config, { api: { bodyParser: false } });
});

test("both Spotify routes 404 outside production, and the callback still clears the state cookie", (t) =>
  withEnv(NO_AUTH_ENV, async () => {
    const logs = muteConsole(t);
    const authorize = fakeRes();
    await authorizeRoute.default(fakeReq({ method: "POST", origin: "https://www.kevinwong.co" }), authorize);
    assert.equal(authorize.statusCode, 404);
    assert.deepEqual(authorize.body, { error: "not_found" });
    assert.equal(authorize.getHeader("Set-Cookie"), undefined);
    assert.equal(authorize.getHeader("Cache-Control"), NO_STORE);
    const callback = fakeRes();
    await callbackRoute.default(fakeReq({ cookie: `__Host-kw_spotify_state=${STATE}`, query: GOOD }), callback);
    assert.equal(callback.statusCode, 404);
    assert.deepEqual(callback.body, { error: "not_found" });
    assert.equal(callback.getHeader("Set-Cookie"), CLEAR);
    assert.equal(callback.getHeader("Cache-Control"), NO_STORE);
    assert.equal(logs.consoleError.mock.callCount() + logs.consoleWarn.mock.callCount(), 0, "nothing was logged");
  }));

test("both Spotify routes answer 500 with one redacted line when Better Auth can't be built", (t) =>
  withEnv({ ...NO_AUTH_ENV, VERCEL_ENV: "production", NODE_ENV: "production" }, async () => {
    // getAuth() throws here (production with no BETTER_AUTH_URL), inside the owner check.
    const { consoleError, consoleWarn } = muteConsole(t);
    const authorize = fakeRes();
    await authorizeRoute.default(fakeReq({ method: "POST", origin: "https://www.kevinwong.co" }), authorize);
    assert.equal(authorize.statusCode, 500);
    assert.deepEqual(authorize.body, { error: "server_error" });
    assert.equal(authorize.getHeader("Set-Cookie"), undefined);
    const callback = fakeRes();
    await callbackRoute.default(fakeReq({ cookie: `__Host-kw_spotify_state=${STATE}`, query: GOOD }), callback);
    assert.equal(callback.statusCode, 500);
    assert.deepEqual(callback.body, { error: "server_error" });
    assert.equal(callback.getHeader("Set-Cookie"), CLEAR);
    assert.deepEqual(consoleError.mock.calls.map((c) => c.arguments), [
      ["[admin/spotify] owner check failed:", "Error: BETTER_AUTH_URL is not set"],
      ["[admin/spotify] owner check failed:", "Error: BETTER_AUTH_URL is not set"],
    ]);
    assert.equal(consoleWarn.mock.callCount(), 0, "nothing else was logged");
  }));
