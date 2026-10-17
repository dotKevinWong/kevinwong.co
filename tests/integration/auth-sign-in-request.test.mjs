import { describe, test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { testDb } from "../helpers/db.mjs";
import { buildAuthOptions } from "../../lib/auth.js";

// The real Better Auth handler, built from lib/auth.js's options against the test database (its
// router checks the schema before every request). Nothing here reaches GitHub: /sign-in/social only
// builds the authorize URL, and the callback tests stub GitHub's three endpoints.
const db = testDb();
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

const OWNER_PROFILE = { id: 1741711, login: "dotKevinWong", name: "Kevin Wong", email: null, avatar_url: null };
const INTRUDER_PROFILE = { id: 999, login: "intruder", name: null, email: null, avatar_url: null };

function stubGitHub(profile) {
  return mock.method(globalThis, "fetch", async (input) => {
    const url = typeof input === "string" ? input : input.url ?? String(input);
    if (url.startsWith("https://github.com/login/oauth/access_token")) {
      return Response.json({ access_token: "gho_test", token_type: "bearer", scope: "" });
    }
    if (url === "https://api.github.com/user") return Response.json(profile);
    if (url === "https://api.github.com/user/emails") return Response.json({ message: "Resource not accessible" }, { status: 403 });
    throw new Error(`Unexpected fetch: ${url}`);
  });
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
  after(() => db.close());

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

  test("an off-site callbackURL is refused with 403", async (t) => {
    const consoleError = t.mock.method(console, "error", () => {});
    const res = await signIn({ provider: "github", callbackURL: "https://evil.example/x" });
    assert.equal(res.status, 403);
    assert.ok(!(await res.text()).includes("github.com"));
    assertOnlyStrings(consoleError);
  });

  async function callback(profile, t) {
    const start = await signIn({ provider: "github", callbackURL: "/admin" });
    assert.equal(start.status, 200);
    const state = new URL((await start.json()).url).searchParams.get("state");
    const cookie = start.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const fetchMock = stubGitHub(profile);
    // The audit-log writes use getDbPool(), and DATABASE_URL is unset here, so they log one string each.
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
  });

  test("the owner's callback still redirects to /admin with a session cookie", async (t) => {
    const res = await callback(OWNER_PROFILE, t);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/admin");
    assert.ok(res.headers.getSetCookie().some((c) => c.startsWith("__Secure-better-auth.session_token=")));
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
