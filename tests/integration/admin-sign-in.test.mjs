import { describe, test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { testDb } from "../helpers/db.mjs";
import { getAuth } from "../../lib/auth.js";
import { getDbPool } from "../../lib/db.js";
import { getOwnerSession } from "../../lib/admin/guard.js";
import { recentAdminEvents, refusedSignInSummary } from "../../lib/admin/audit-log.js";

const ORIGIN = "https://www.kevinwong.co";
const OWNER_PROFILE = { id: 1741711, login: "dotKevinWong", name: "Kevin Wong", email: null, avatar_url: "https://avatars.githubusercontent.com/u/1741711?v=4" };
const INTRUDER_PROFILE = { id: 999, login: "intruder", name: null, email: null, avatar_url: "https://avatars.githubusercontent.com/u/999?v=4" };
const db = testDb();
const count = async (table) => Number((await db.pool.query(`select count(*) from ${table}`)).rows[0].count);

async function eventually(check, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { return await check(); } catch (error) { if (Date.now() > deadline) throw error; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function stubGitHub(profile) {
  return mock.method(globalThis, "fetch", async (input) => {
    const url = typeof input === "string" ? input : input.url ?? String(input);
    if (url.startsWith("https://github.com/login/oauth/access_token")) return Response.json({ access_token: "gho_test", token_type: "bearer", scope: "" });
    if (url === "https://api.github.com/user") return Response.json(profile);
    if (url === "https://api.github.com/user/emails") return Response.json({ message: "Resource not accessible" }, { status: 403 });
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

async function signIn(profile, ip) {
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
    return await auth.handler(new Request(`${ORIGIN}/api/auth/callback/github?code=test-code&state=${state}`, { headers: { cookie, "x-forwarded-for": ip } }));
  } finally {
    fetchMock.mock.restore();
  }
}

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
  after(async () => { await getDbPool().end(); await db.close(); });

  test("a non-owner GitHub account is refused and leaves no auth rows", async () => {
    const res = await signIn(INTRUDER_PROFILE, "203.0.113.1");
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
    const res = await signIn(OWNER_PROFILE, "203.0.113.2");
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
    assert.equal(owner.name, "Kevin Wong");
    assert.ok(Math.abs(owner.expiresAt.getTime() - (Date.now() + 86_400_000)) < 60_000);
    await eventually(async () => assert.equal(
      (await db.pool.query("select count(*)::int as n from admin_audit_log where event = 'sign_in' and actor = 'github:1741711'")).rows[0].n, 1));
  });

  test("a second owner sign-in reuses the user and adds a session", async () => {
    const res = await signIn(OWNER_PROFILE, "203.0.113.3");
    assert.equal(res.headers.get("location"), "/admin");
    assert.equal(await count("auth_user"), 1);
    assert.equal(await count("auth_account"), 1);
    assert.equal(await count("auth_session"), 2);
  });

  test("Better Auth's own router does not serve get-session (disabledPaths)", async () => {
    const res = await getAuth().handler(new Request(`${ORIGIN}/api/auth/get-session`, { headers: { "x-forwarded-for": "203.0.113.4" } }));
    assert.equal(res.status, 404);
  });
});
