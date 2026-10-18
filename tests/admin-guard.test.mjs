import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTH_ALLOWLIST, forwardAuthRequest, getOwnerSession, isAdminEnabled, isAllowedAuthRequest, isSameOrigin, requireAdmin, setNoStore } from "../lib/admin/guard.js";
import { buildAuthOptions } from "../lib/auth.js";
import { OWNER_SESSION, PROD_ENV, fakeAuth, fakeDb, fakeReq, fakeRes, withEnv } from "./helpers/admin-fakes.mjs";

const NO_STORE = "private, no-store, max-age=0, must-revalidate";
const OWNER = { name: "Kevin Wong", image: "https://avatars.githubusercontent.com/u/1741711?v=4" };

// A database outage as pg reports it: a credential in the message and a `detail`, neither of which may be logged.
const dbDownError = () => Object.assign(new Error("connect ECONNREFUSED for postgres://kevin:hunter2@db.example/neondb"), {
  code: "ECONNREFUSED",
  detail: "Key (token)=(detail-secret) already exists.",
});
const downDb = () => ({ calls: [], async query() { throw dbDownError(); } });
const downAuth = () => ({ calls: [], api: { async getSession() { throw new Error("session read failed"); } } });

async function guard(reqOptions, { env = PROD_ENV, auth = fakeAuth(), db = fakeDb(1), mutation = false } = {}) {
  const res = fakeRes();
  const owner = await requireAdmin(fakeReq(reqOptions), res, { mutation, deps: { env, auth, db } });
  return { owner, res, auth, db };
}

test("isAdminEnabled only in production on www.kevinwong.co", () => {
  const cases = [
    [{ VERCEL_ENV: "production" }, "www.kevinwong.co", true],
    [{ VERCEL_ENV: "preview" }, "www.kevinwong.co", false],
    [{ VERCEL_ENV: "development" }, "www.kevinwong.co", false],
    [{}, "www.kevinwong.co", false],
    [{ VERCEL_ENV: "production" }, "kevinwong.co", false],
    [{ VERCEL_ENV: "production" }, "kevinwong-co.vercel.app", false],
    [{ VERCEL_ENV: "production" }, "WWW.KEVINWONG.CO", false],
    [{ VERCEL_ENV: "production" }, undefined, false],
  ];
  for (const [env, host, expected] of cases) {
    // fakeReq's default would fill in www.kevinwong.co, so the no-Host request is built by hand.
    const req = host === undefined ? { method: "GET", headers: {}, query: {}, url: "/" } : fakeReq({ host });
    assert.equal(isAdminEnabled(req, env), expected, `${env.VERCEL_ENV} ${host}`);
  }
});

test("NODE_ENV=production never enables admin without VERCEL_ENV=production", () => {
  // NODE_ENV is "production" on every Vercel preview and under `next start`.
  for (const env of [{ NODE_ENV: "production" }, { VERCEL_ENV: "preview", NODE_ENV: "production" }]) {
    assert.equal(isAdminEnabled(fakeReq(), env), false, JSON.stringify(env));
  }
});

test("isAdminEnabled reads Host only, never X-Forwarded-Host", () => {
  const req = { method: "GET", headers: { host: "kevinwong-co.vercel.app", "x-forwarded-host": "www.kevinwong.co" }, query: {}, url: "/" };
  assert.equal(isAdminEnabled(req, PROD_ENV), false);
});

test("isAdminEnabled and requireAdmin read process.env when no env is passed", () =>
  withEnv({ VERCEL_ENV: undefined }, async () => {
    // Every real caller passes no env: the route, the admin API routes and the pages.
    assert.equal(isAdminEnabled(fakeReq()), false);
    const auth = fakeAuth();
    const res = fakeRes();
    assert.equal(await requireAdmin(fakeReq(), res, { deps: { auth, db: fakeDb(1) } }), null);
    assert.equal(res.statusCode, 404);
    assert.equal(auth.calls.length, 0);
    process.env.VERCEL_ENV = "preview";
    assert.equal(isAdminEnabled(fakeReq()), false);
    process.env.VERCEL_ENV = "production";
    assert.equal(isAdminEnabled(fakeReq()), true);
    assert.deepEqual(await requireAdmin(fakeReq(), fakeRes(), { deps: { auth, db: fakeDb(1) } }), OWNER);
  }));

test("isSameOrigin requires exactly https://www.kevinwong.co", () => {
  assert.equal(isSameOrigin(fakeReq({ origin: "https://www.kevinwong.co" })), true);
  for (const origin of ["https://kevinwong.co", "http://www.kevinwong.co", "https://www.kevinwong.co/", "https://www.kevinwong.co.evil.example", "null", undefined]) {
    assert.equal(isSameOrigin(fakeReq({ origin })), false, String(origin));
  }
});

test("setNoStore sets the exact Cache-Control", () => {
  const res = fakeRes();
  setNoStore(res);
  assert.equal(res.getHeader("Cache-Control"), NO_STORE);
});

test("getOwnerSession returns null without a session and never queries the database", async () => {
  const db = fakeDb(1);
  assert.equal(await getOwnerSession(fakeReq({ cookie: "x=1" }), { auth: fakeAuth(null), db }), null);
  assert.equal(db.calls.length, 0);
});

test("getOwnerSession checks the session user's GitHub 1741711 account and returns only the name and image", async () => {
  const auth = fakeAuth();
  const db = fakeDb(1);
  const owner = await getOwnerSession(fakeReq({ cookie: "__Secure-better-auth.session_token=abc" }), { auth, db });
  assert.deepEqual(owner, OWNER);
  const [{ headers }] = auth.calls;
  assert.ok(headers instanceof Headers);
  assert.equal(headers.get("cookie"), "__Secure-better-auth.session_token=abc");
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /from auth_account where "userId" = \$1 and "providerId" = 'github' and "accountId" = \$2/);
  assert.deepEqual(db.calls[0].params, ["user-1", "1741711"]);
  const noImage = await getOwnerSession(fakeReq(), { auth: fakeAuth({ ...OWNER_SESSION, user: { ...OWNER_SESSION.user, image: undefined } }), db });
  assert.equal(noImage.image, null);
});

test("getOwnerSession returns null when the user has no GitHub 1741711 account", async () => {
  assert.equal(await getOwnerSession(fakeReq(), { auth: fakeAuth(), db: fakeDb(0) }), null);
});

test("getOwnerSession rejects when the session or account read fails", async () => {
  // The admin pages rely on this to fail closed: no owner is ever resolved from a failed read.
  await assert.rejects(getOwnerSession(fakeReq(), { auth: fakeAuth(), db: downDb() }), { code: "ECONNREFUSED" });
  await assert.rejects(getOwnerSession(fakeReq(), { auth: downAuth(), db: fakeDb(1) }), /session read failed/);
});

test("requireAdmin 404s on a preview deployment without reading the session", async () => {
  const { owner, res, auth } = await guard({}, { env: { VERCEL_ENV: "preview" } });
  assert.equal(owner, null);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: "not_found" });
  assert.equal(res.getHeader("Cache-Control"), NO_STORE);
  assert.equal(auth.calls.length, 0);
});

test("requireAdmin 404s on the apex host", async () => {
  const { owner, res } = await guard({ host: "kevinwong.co" });
  assert.equal(owner, null);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: "not_found" });
});

test("requireAdmin 403s a mutation from https://kevinwong.co", async () => {
  const { owner, res, auth } = await guard({ method: "POST", origin: "https://kevinwong.co" }, { mutation: true });
  assert.equal(owner, null);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: "bad_origin" });
  assert.equal(res.getHeader("Cache-Control"), NO_STORE);
  assert.equal(auth.calls.length, 0);
});

test("requireAdmin 403s a mutation with no Origin", async () => {
  const { owner, res } = await guard({ method: "POST" }, { mutation: true });
  assert.equal(owner, null);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: "bad_origin" });
});

test("requireAdmin 401s without a session", async () => {
  const { owner, res } = await guard({}, { auth: fakeAuth(null) });
  assert.equal(owner, null);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: "unauthorized" });
  assert.equal(res.getHeader("Cache-Control"), NO_STORE);
});

test("requireAdmin 401s a session whose user lacks the GitHub 1741711 account", async () => {
  const { owner, res } = await guard({}, { db: fakeDb(0) });
  assert.equal(owner, null);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: "unauthorized" });
});

test("requireAdmin returns the owner for a same-origin mutation and writes no response", async () => {
  const { owner, res } = await guard({ method: "POST", origin: "https://www.kevinwong.co" }, { mutation: true });
  assert.deepEqual(owner, OWNER);
  assert.equal(res.getHeader("Cache-Control"), NO_STORE);
  assert.equal(res.ended, false);
  assert.equal(res.statusCode, 200);
});

test("requireAdmin lets a non-mutation GET through without an Origin", async () => {
  const { owner } = await guard({ method: "GET" });
  assert.deepEqual(owner, OWNER);
});

test("requireAdmin answers 500 with one redacted line when the owner check fails", async (t) => {
  const consoleError = t.mock.method(console, "error", () => {});
  const consoleWarn = t.mock.method(console, "warn", () => {});
  const consoleLog = t.mock.method(console, "log", () => {});
  for (const deps of [{ auth: fakeAuth(), db: downDb() }, { auth: downAuth(), db: fakeDb(1) }]) {
    const { owner, res } = await guard({ method: "POST", origin: "https://www.kevinwong.co" }, { ...deps, mutation: true });
    assert.equal(owner, null);
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: "server_error" });
    assert.equal(res.ended, true);
    assert.equal(res.getHeader("Cache-Control"), NO_STORE);
  }
  assert.deepEqual(consoleError.mock.calls.map((call) => call.arguments), [
    ["[admin] owner check failed:", "Error [ECONNREFUSED]: connect ECONNREFUSED for postgres://[redacted]@db.example/neondb"],
    ["[admin] owner check failed:", "Error: session read failed"],
  ]);
  assert.equal(consoleWarn.mock.callCount() + consoleLog.mock.callCount(), 0, "nothing else was logged");
  const written = consoleError.mock.calls.flatMap((call) => call.arguments).join("\n");
  assert.ok(!written.includes("hunter2") && !written.includes("detail-secret") && !written.includes("    at "));
});

test("AUTH_ALLOWLIST is frozen and is exactly the three Better Auth routes", () => {
  assert.ok(Object.isFrozen(AUTH_ALLOWLIST));
  assert.deepEqual([...AUTH_ALLOWLIST].sort(), ["GET /api/auth/callback/github", "POST /api/auth/sign-in/social", "POST /api/auth/sign-out"]);
  // Across every router path lib/auth.js disables, the three it serves and a few others, crossed with every
  // method, isAllowedAuthRequest admits exactly the listed pairs. (Routes outside this list are covered by
  // the list being closed, not by this loop.)
  const paths = [...buildAuthOptions({ env: {}, db: {} }).disabledPaths,
    "/sign-in/social", "/callback/github", "/callback/google", "/sign-out", "/reset-password/abc", "/sign-in/oauth2"];
  const allowed = [];
  for (const path of paths) for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    if (isAllowedAuthRequest(method, `/api/auth${path}`)) allowed.push(`${method} /api/auth${path}`);
  }
  assert.deepEqual(allowed.sort(), [...AUTH_ALLOWLIST].sort());
});

test("isAllowedAuthRequest admits the three routes and refuses near misses", () => {
  const cases = [
    ["POST", "/api/auth/sign-in/social", true],
    ["GET", "/api/auth/callback/github?code=abc&state=xyz", true],
    ["GET", "/api/auth/callback/github", true],
    ["POST", "/api/auth/sign-out", true],
    ["GET", "/api/auth/get-session", false],
    ["GET", "/api/auth/sign-in/social", false],
    ["POST", "/api/auth/sign-in/social/", false],
    ["GET", "/api/auth/callback/github/", false],
    ["POST", "/api/auth/callback/github", false],
    ["GET", "/api/auth/callback/google?code=abc", false],
    ["HEAD", "/api/auth/callback/github", false],
    ["GET", "//api/auth/callback/github", false],
    ["GET", "/api/auth/list-sessions", false],
    ["POST", "/api/auth/get-access-token", false],
    ["GET", "/api/auth/error", false],
    ["post", "/api/auth/sign-out", false],
    [undefined, undefined, false],
  ];
  for (const [method, url, expected] of cases) assert.equal(isAllowedAuthRequest(method, url), expected, `${method} ${url}`);
});

test("forwardAuthRequest logs one redacted line and answers 500 when Better Auth's handler throws", async (t) => {
  const consoleError = t.mock.method(console, "error", () => {});
  const consoleWarn = t.mock.method(console, "warn", () => {});
  const consoleLog = t.mock.method(console, "log", () => {});
  const req = fakeReq({ method: "POST", url: "/api/auth/sign-in/social" });

  // A handler that answers gets the route's own req and res, and nothing is logged.
  const answered = fakeRes();
  await forwardAuthRequest(req, answered, async (r, s) => { assert.equal(r, req); s.status(302).end(); });
  assert.equal(answered.statusCode, 302);
  assert.equal(consoleError.mock.callCount(), 0);

  // lib/auth.js sets onAPIError.throw, so a non-APIError (here pg's) rejects out of Better Auth's handler.
  const error = Object.assign(new Error("connect failed for postgres://kevin:hunter2@db.example/neondb"), {
    code: "ECONNREFUSED",
    detail: "Key (token)=(detail-secret) already exists.",
  });
  const res = fakeRes();
  await forwardAuthRequest(req, res, async () => { throw error; });
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: "server_error" });
  assert.deepEqual(consoleError.mock.calls.map((call) => call.arguments), [
    ["[auth] request failed:", "Error [ECONNREFUSED]: connect failed for postgres://[redacted]@db.example/neondb"],
  ]);

  // getAuth() throws before any handler exists (a misconfigured deployment): caught the same way.
  const unbuilt = fakeRes();
  await forwardAuthRequest(req, unbuilt, () => { throw new Error("BETTER_AUTH_URL is not set"); });
  assert.equal(unbuilt.statusCode, 500);
  assert.deepEqual(unbuilt.body, { error: "server_error" });
  assert.deepEqual(consoleError.mock.calls[1].arguments, ["[auth] request failed:", "Error: BETTER_AUTH_URL is not set"]);

  assert.equal(consoleError.mock.callCount(), 2);
  assert.equal(consoleWarn.mock.callCount() + consoleLog.mock.callCount(), 0, "nothing else was logged");
  const written = consoleError.mock.calls.flatMap((call) => call.arguments);
  assert.ok(written.every((a) => typeof a === "string"), "no Error object printed");
  assert.ok(!written.join("\n").includes("hunter2") && !written.join("\n").includes("detail-secret") && !written.join("\n").includes("    at "));
});

test("forwardAuthRequest pins the forwarded protocol before Better Auth builds its URL", async () => {
  // better-call builds the Request URL from X-Forwarded-Proto (else the socket), :authority (else Host) and
  // req.url. The caller has checked Host and req.url; a client can send the other two.
  const req = fakeReq({ method: "POST", url: "/api/auth/sign-out" });
  req.headers["x-forwarded-proto"] = "https://www.kevinwong.co/api/auth/callback/github?code=x&state=y#";
  req.headers[":authority"] = "evil.example";
  let seen;
  await forwardAuthRequest(req, fakeRes(), async (r) => { seen = { ...r.headers }; });
  assert.equal(seen["x-forwarded-proto"], "https");
  assert.equal(":authority" in seen, false);
  assert.equal(seen.host, "www.kevinwong.co");
  const plain = fakeReq({ method: "POST", url: "/api/auth/sign-out" });
  await forwardAuthRequest(plain, fakeRes(), async (r) => { seen = { ...r.headers }; });
  assert.equal(seen["x-forwarded-proto"], "https");
});
