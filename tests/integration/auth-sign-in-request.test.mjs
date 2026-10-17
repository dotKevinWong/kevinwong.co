import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { testDb } from "../helpers/db.mjs";
import { buildAuthOptions } from "../../lib/auth.js";

// The real Better Auth handler, built from lib/auth.js's options against the test database (its
// router checks the schema before every request). Nothing here reaches GitHub: /sign-in/social only
// builds the authorize URL.
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
  ["another provider", { provider: "google", callbackURL: "/admin" }],
  ["no provider", { callbackURL: "/admin" }],
  ["an array body", ["github"]],
];

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

  test("/verify-email, which mints a session without the owner gate, is disabled", async () => {
    const res = await auth.handler(new Request(`${ORIGIN}/api/auth/verify-email?token=x`, {
      headers: { "x-forwarded-for": nextAddress() },
    }));
    assert.equal(res.status, 404);
  });
});
