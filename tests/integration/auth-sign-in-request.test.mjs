import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { testDb } from "../helpers/db.mjs";
import { INTRUDER_PROFILE, OWNER_PROFILE, stubGitHub } from "../helpers/github-stub.mjs";
import { buildAuthOptions } from "../../lib/auth.js";
import { getDbPool } from "../../lib/db.js";

// The real Better Auth handler, built from lib/auth.js's options against the test database (its
// router checks the schema before every request). Nothing here reaches GitHub: /sign-in/social only
// builds the authorize URL, and the callback tests stub GitHub's three endpoints.
const db = testDb();
// The sign-in hooks' audit writes go through getDbPool(): point it at the test database, which tests/helpers/db.mjs
// has already checked is a loopback database on port 55432.
if (!db.skip) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const ORIGIN = "https://www.kevinwong.co";
const ENV = {
  BETTER_AUTH_URL: ORIGIN,
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  GITHUB_CLIENT_ID: "test-client-id",
  GITHUB_CLIENT_SECRET: "test-client-secret",
};

// Each request comes from its own address, so the sign-in rate limit never trips.
let address = 0;
const nextAddress = () => `203.0.113.${(address += 1)}`;

const REFUSED = [
  ["scopes", { provider: "github", callbackURL: "/admin", scopes: ["user:email"] }],
  ["an idToken", { provider: "github", idToken: { token: "header.payload.signature" } }],
  ["a loginHint", { provider: "github", callbackURL: "/admin", loginHint: "dotKevinWong" }],
  ["requestSignUp", { provider: "github", callbackURL: "/admin", requestSignUp: true }],
  ["additionalData", { provider: "github", callbackURL: "/admin", additionalData: { role: "admin" } }],
  ["additionalParams", { provider: "github", callbackURL: "/admin", additionalParams: { login: "dotKevinWong" } }],
  ["an unknown key", { provider: "github", callbackURL: "/admin", foo: 1 }],
  ["another provider", { provider: "google", callbackURL: "/admin" }],
  ["no provider", { callbackURL: "/admin" }],
  ["an array body", ["github"]],
  ["a JSON null body", null],
];

// Waits for the audit row a callback writes in the background, so no write outlasts the test that started it.
async function auditRowWritten(event) {
  for (let i = 0; i < 40; i += 1) {
    const { rows } = await db.pool.query("select count(*)::int as n from admin_audit_log where event = $1", [event]);
    if (rows[0].n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`no ${event} row was written`);
}

// Every console.error argument must be a string: an Error object would print its stack and pg's err.detail.
const assertOnlyStrings = (consoleError) => {
  for (const call of consoleError.mock.calls) {
    assert.ok(call.arguments.every((a) => typeof a === "string"), "no Error object printed");
  }
};

describe("the Better Auth handler's request checks", { skip: db.skip }, () => {
  let auth;
  before(async () => {
    await db.resetSchema();
    auth = betterAuth(buildAuthOptions({ env: ENV, db: db.pool }));
  });
  after(async () => { await getDbPool().end(); await db.close(); });

  const signIn = (body) => auth.handler(new Request(`${ORIGIN}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": nextAddress() },
    body: JSON.stringify(body),
  }));

  test("the sign-in page's request gets GitHub's authorize URL with no scope", async () => {
    const res = await signIn({ provider: "github", callbackURL: "/admin" });
    assert.equal(res.status, 200);
    const authorize = new URL((await res.json()).url);
    assert.equal(`${authorize.origin}${authorize.pathname}`, "https://github.com/login/oauth/authorize");
    assert.equal(authorize.searchParams.get("scope"), null, "no GitHub scopes requested");
    assert.ok(res.headers.getSetCookie().some((c) => c.startsWith("__Secure-better-auth.oauth_state=")));
  });

  test("every allowed key is accepted", async () => {
    const res = await signIn({
      provider: "github", callbackURL: "/admin", errorCallbackURL: "/admin/sign-in", newUserCallbackURL: "/admin",
      disableRedirect: true,
    });
    assert.equal(res.status, 200);
    assert.equal(new URL((await res.json()).url).searchParams.get("scope"), null);
  });

  for (const [name, body] of REFUSED) {
    test(`a sign-in request with ${name} is refused with 400 and no GitHub URL`, async () => {
      const res = await signIn(body);
      assert.equal(res.status, 400);
      assert.equal(res.headers.get("location"), null);
      assert.ok(!(await res.text()).includes("github.com"));
      assert.ok(!res.headers.getSetCookie().some((c) => c.includes("oauth_state")), "no state cookie");
    });
  }

  for (const key of ["callbackURL", "errorCallbackURL", "newUserCallbackURL"]) {
    test(`an off-site ${key} is refused with 403`, async (t) => {
      const consoleError = t.mock.method(console, "error", () => {});
      const res = await signIn({ provider: "github", callbackURL: "/admin", [key]: "https://evil.example/x" });
      assert.equal(res.status, 403);
      assert.ok(!(await res.text()).includes("github.com"));
      assert.ok(!res.headers.getSetCookie().some((c) => c.includes("oauth_state")), "no state cookie");
      assertOnlyStrings(consoleError);
    });
  }

  async function callback(profile, t) {
    const start = await signIn({ provider: "github", callbackURL: "/admin" });
    assert.equal(start.status, 200);
    const state = new URL((await start.json()).url).searchParams.get("state");
    const cookie = start.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const fetchMock = stubGitHub(profile);
    const consoleError = t.mock.method(console, "error", () => {});
    try {
      const res = await auth.handler(new Request(
        `${ORIGIN}/api/auth/callback/github?code=test-code&state=${encodeURIComponent(state)}`,
        { headers: { cookie, "x-forwarded-for": nextAddress() } },
      ));
      assertOnlyStrings(consoleError);
      return res;
    } finally {
      fetchMock.mock.restore();
    }
  }

  test("a non-owner's callback still redirects to the sign-in page with not_owner", async (t) => {
    const res = await callback(INTRUDER_PROFILE, t);
    assert.equal(res.status, 302);
    const location = new URL(res.headers.get("location"), ORIGIN);
    assert.equal(location.pathname, "/admin/sign-in");
    assert.equal(location.searchParams.get("error"), "not_owner");
    assert.ok(!res.headers.getSetCookie().some((c) => c.startsWith("__Secure-better-auth.session_token=")));
    await auditRowWritten("sign_in_rejected");
  });

  test("the owner's callback still redirects to /admin with a session cookie", async (t) => {
    const res = await callback(OWNER_PROFILE, t);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/admin");
    assert.ok(res.headers.getSetCookie().some((c) => c.startsWith("__Secure-better-auth.session_token=")));
    await auditRowWritten("sign_in");
  });

  test("a body Better Auth cannot parse rejects and prints no Error object", async (t) => {
    // better-call's router would otherwise print a non-APIError raw: console.error("# SERVER_ERROR: ", error).
    const consoleError = t.mock.method(console, "error", () => {});
    await assert.rejects(auth.handler(new Request(`${ORIGIN}/api/auth/sign-in/social`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded, application/json", origin: ORIGIN, "x-forwarded-for": nextAddress(),
      },
      body: "provider=github",
    })), TypeError);
    assertOnlyStrings(consoleError);
  });

  test("/verify-email, which mints a session without the owner gate, is disabled", async () => {
    const res = await auth.handler(new Request(`${ORIGIN}/api/auth/verify-email?token=x`, {
      headers: { "x-forwarded-for": nextAddress() },
    }));
    assert.equal(res.status, 404);
  });
});
