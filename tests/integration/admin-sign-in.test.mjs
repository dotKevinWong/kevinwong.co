import { describe, test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { testDb } from "../helpers/db.mjs";
import { INTRUDER_PROFILE, OWNER_PROFILE, stubGitHub } from "../helpers/github-stub.mjs";
import { getAuth } from "../../lib/auth.js";
import { getDbPool } from "../../lib/db.js";
import { getOwnerSession } from "../../lib/admin/guard.js";
import { recentAdminEvents, refusedSignInSummary } from "../../lib/admin/audit-log.js";

const ORIGIN = "https://www.kevinwong.co";
const USER_AGENT = "kw-integration-test/1.0";
const db = testDb();
const count = async (table) => Number((await db.pool.query(`select count(*) from ${table}`)).rows[0].count);

// Each request comes from its own address, so Better Auth's in-memory sign-in rate limit never trips.
let address = 0;
const nextAddress = () => `203.0.113.${(address += 1)}`;

async function eventually(check, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { return await check(); } catch (error) { if (Date.now() > deadline) throw error; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// The whole GitHub sign-in through the real Better Auth handler: the sign-in page's request, then GitHub's
// callback with the state cookie it set. Returns the callback's response and the address both came from.
async function signIn(profile) {
  const ip = nextAddress();
  const auth = getAuth();
  const start = await auth.handler(new Request(`${ORIGIN}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": ip },
    body: JSON.stringify({ provider: "github", callbackURL: "/admin" }),
  }));
  assert.equal(start.status, 200);
  const authorize = new URL((await start.json()).url);
  assert.equal(`${authorize.origin}${authorize.pathname}`, "https://github.com/login/oauth/authorize");
  assert.equal(authorize.searchParams.get("scope"), null, "no GitHub scopes requested");
  assert.equal(authorize.searchParams.get("redirect_uri"), `${ORIGIN}/api/auth/callback/github`);
  const cookie = start.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const fetchMock = stubGitHub(profile);
  try {
    const state = encodeURIComponent(authorize.searchParams.get("state"));
    const res = await auth.handler(new Request(`${ORIGIN}/api/auth/callback/github?code=test-code&state=${state}`,
      { headers: { cookie, "x-forwarded-for": ip, "user-agent": USER_AGENT } }));
    return { res, ip };
  } finally {
    fetchMock.mock.restore();
  }
}

const signInRows = async () =>
  Number((await db.pool.query("select count(*) from admin_audit_log where event = 'sign_in'")).rows[0].count);

/**
 * The owner signed in: the session cookie as a request's Cookie header. It waits for the sign_in row that is
 * written in the background, so no write outlasts the test that started it.
 */
async function ownerCookie() {
  const before = await signInRows();
  const { res } = await signIn(OWNER_PROFILE);
  assert.equal(res.headers.get("location"), "/admin");
  const sessionCookie = res.headers.getSetCookie().find((c) => c.startsWith("__Secure-better-auth.session_token="));
  assert.ok(sessionCookie, "a session cookie");
  await eventually(async () => assert.equal(await signInRows(), before + 1));
  return sessionCookie.split(";")[0];
}

const sessionExpiries = async () =>
  (await db.pool.query(`select "expiresAt" from auth_session order by "createdAt"`)).rows.map((r) => r.expiresAt.getTime());

describe("GitHub sign-in through Better Auth", { skip: db.skip }, () => {
  before(async () => {
    await db.resetSchema();
    Object.assign(process.env, {
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      BETTER_AUTH_URL: ORIGIN,
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
      GITHUB_CLIENT_ID: "test-client-id",
      GITHUB_CLIENT_SECRET: "test-client-secret",
    });
  });
  // Every test starts with no auth rows and an empty activity log, so each one can run on its own, in any order.
  beforeEach(() => db.pool.query("truncate auth_session, auth_account, auth_verification, auth_user, admin_audit_log"));
  after(async () => { await getDbPool().end(); await db.close(); });

  test("a non-owner GitHub account is refused and leaves no auth rows", async () => {
    const { res } = await signIn(INTRUDER_PROFILE);
    assert.equal(res.status, 302);
    const location = new URL(res.headers.get("location"), ORIGIN);
    assert.equal(location.pathname, "/admin/sign-in");
    assert.equal(location.searchParams.get("error"), "not_owner");
    assert.ok(!res.headers.getSetCookie().some((c) => c.startsWith("__Secure-better-auth.session_token=")));
    for (const table of ["auth_user", "auth_account", "auth_session", "auth_verification"]) assert.equal(await count(table), 0, table);
    await eventually(async () => assert.deepEqual(
      (await db.pool.query("select event, actor, details from admin_audit_log")).rows,
      [{ event: "sign_in_rejected", actor: "github:999", details: { githubId: "999", login: "intruder" } }],
    ));
    assert.deepEqual(await recentAdminEvents(20, db.pool), [], "the activity list leaves out refusals");
    const refused = await refusedSignInSummary(db.pool);
    assert.equal(refused.count24h, 1);
    assert.equal(refused.latestLogin, "intruder");
    assert.ok(refused.latestAt instanceof Date);
  });

  test("the owner signs in with a 24-hour session cookie that getOwnerSession accepts", async () => {
    const { res, ip } = await signIn(OWNER_PROFILE);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/admin");
    const sessionCookie = res.headers.getSetCookie().find((c) => c.startsWith("__Secure-better-auth.session_token="));
    assert.match(sessionCookie, /^__Secure-better-auth\.session_token=[^;]+; Max-Age=86400; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    assert.deepEqual((await db.pool.query(`select "email", "name" from auth_user`)).rows,
      [{ email: "1741711@github.placeholder.invalid", name: "Kevin Wong" }]);
    const { rows: accounts } = await db.pool.query(`select "providerId", "accountId", "accessToken" from auth_account`);
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].providerId, "github");
    assert.equal(accounts[0].accountId, "1741711");
    assert.notEqual(accounts[0].accessToken, "gho_test", "OAuth tokens are stored encrypted");
    const owner = await getOwnerSession({ headers: { cookie: sessionCookie.split(";")[0] } });
    assert.deepEqual(owner, { name: "Kevin Wong", image: OWNER_PROFILE.avatar_url });
    const [expiresAt] = await sessionExpiries();
    assert.ok(Math.abs(expiresAt - (Date.now() + 86_400_000)) < 60_000);
    // The sign_in row records where the sign-in came from, and nothing else.
    await eventually(async () => assert.deepEqual(
      (await db.pool.query("select actor, details from admin_audit_log where event = 'sign_in'")).rows,
      [{ actor: "github:1741711", details: { ipAddress: ip, userAgent: USER_AGENT } }]));
  });

  test("a second owner sign-in reuses the user and adds a session", async () => {
    await ownerCookie();
    await ownerCookie();
    assert.equal(await count("auth_user"), 1);
    assert.equal(await count("auth_account"), 1);
    assert.equal(await count("auth_session"), 2);
  });

  test("Better Auth's own router does not serve get-session (disabledPaths)", async () => {
    const res = await getAuth().handler(new Request(`${ORIGIN}/api/auth/get-session`, { headers: { "x-forwarded-for": nextAddress() } }));
    assert.equal(res.status, 404);
  });

  // D2: a session lasts 24 hours from sign-in, and reading it never extends it.
  test("an expired session is refused", async () => {
    const cookie = await ownerCookie();
    assert.notEqual(await getOwnerSession({ headers: { cookie } }), null);
    await db.pool.query(`update auth_session set "expiresAt" = now() - interval '1 second'`);
    assert.equal(await getOwnerSession({ headers: { cookie } }), null);
  });

  test("reading the session doesn't extend it", async () => {
    const cookie = await ownerCookie();
    const before = await sessionExpiries();
    for (let i = 0; i < 2; i += 1) assert.notEqual(await getOwnerSession({ headers: { cookie } }), null);
    assert.deepEqual(await sessionExpiries(), before);
  });

  test("a POST from another site that carries the session cookie is refused, and the session survives", async (t) => {
    t.mock.method(console, "error", () => {});
    const cookie = await ownerCookie();
    const post = (path, origin, body) => getAuth().handler(new Request(`${ORIGIN}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie, "x-forwarded-for": nextAddress() },
      body: JSON.stringify(body),
    }));
    const signOut = await post("/sign-out", "https://evil.example", {});
    assert.equal(signOut.status, 403);
    assert.ok(!signOut.headers.getSetCookie().some((c) => c.startsWith("__Secure-better-auth.session_token=")),
      "the session cookie isn't cleared");
    const signInAgain = await post("/sign-in/social", "https://evil.example", { provider: "github", callbackURL: "/admin" });
    assert.equal(signInAgain.status, 403);
    assert.ok(!(await signInAgain.text()).includes("github.com"));
    assert.equal(await count("auth_session"), 1);
    assert.notEqual(await getOwnerSession({ headers: { cookie } }), null);

    // The same sign-out from the site itself ends the session.
    assert.equal((await post("/sign-out", ORIGIN, {})).status, 200);
    assert.equal(await count("auth_session"), 0);
  });

  // The audit writes run in the background (waitUntil), after the response: a failed one logs one line and
  // changes nothing about the sign-in. Hiding the table makes both writes fail.
  test("a failed audit write logs one redacted line, and the sign-in still succeeds or is still refused", async (t) => {
    const consoleError = t.mock.method(console, "error", () => {});
    await db.pool.query("alter table admin_audit_log rename to admin_audit_log_hidden");
    t.after(() => db.pool.query("alter table admin_audit_log_hidden rename to admin_audit_log"));

    const owner = await signIn(OWNER_PROFILE);
    assert.equal(owner.res.status, 302);
    assert.equal(owner.res.headers.get("location"), "/admin");
    assert.ok(owner.res.headers.getSetCookie().some((c) => c.startsWith("__Secure-better-auth.session_token=")));
    assert.equal(await count("auth_session"), 1);

    const intruder = await signIn(INTRUDER_PROFILE);
    assert.equal(new URL(intruder.res.headers.get("location"), ORIGIN).searchParams.get("error"), "not_owner");

    await eventually(async () => assert.equal(consoleError.mock.callCount(), 2));
    const lines = consoleError.mock.calls.map((c) => c.arguments);
    for (const args of lines) assert.ok(args.every((arg) => typeof arg === "string"), "only strings are logged");
    assert.deepEqual(lines.map((args) => args[0]).sort(),
      ["[auth] could not log a rejected sign-in:", "[auth] could not log sign_in:"]);
    for (const [, described] of lines) assert.match(described, /^error \[42P01\]: /, "pg's name and code, from describeError");
  });
});
