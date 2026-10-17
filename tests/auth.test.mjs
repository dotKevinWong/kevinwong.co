import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAuthOptions, githubProfileToUser, validateOwner } from "../lib/auth.js";

const NOT_OWNER = { error: "not_owner", errorDescription: "This GitHub account can't sign in here." };
const quiet = { logRejected: async () => {}, schedule: () => {} };
const oauth = (id, login = "someone", providerId = "github", action = "create-user") =>
  ({ method: "oauth", oauth: { providerId, profile: { id, login } }, action });
const REJECTED = [
  ["another GitHub id", oauth(999)],
  ["a longer id", oauth(17417110)],
  ["a zero-padded id", oauth("01741711")],
  ["an id with a trailing space", oauth("1741711 ")],
  ["another provider", oauth(1741711, "dotKevinWong", "google")],
  ["a non-oauth method", { method: "sso-oidc", sso: { providerId: "github" }, oauth: { providerId: "github", profile: { id: 1741711 } }, action: "create-user" }],
  ["no profile", { method: "oauth", oauth: { providerId: "github" }, action: "create-user" }],
  ["a profile without an id", { method: "oauth", oauth: { providerId: "github", profile: { login: "dotKevinWong" } }, action: "sign-in" }],
  ["no oauth block", { method: "oauth", action: "sign-in" }],
  ["no source", undefined],
];
const VALID_ENV = {
  BETTER_AUTH_URL: "https://www.kevinwong.co", BETTER_AUTH_SECRET: "a".repeat(64),
  GITHUB_CLIENT_ID: "client-id", GITHUB_CLIENT_SECRET: "client-secret",
};
const PROD_ENV = { ...VALID_ENV, NODE_ENV: "production" };

test("validateOwner accepts the owner's GitHub id as a number or a string", () => {
  assert.equal(validateOwner({ source: oauth(1741711, "dotKevinWong") }, null, quiet), undefined);
  assert.equal(validateOwner({ source: oauth(1741711, "dotKevinWong", "github", "sign-in") }, null, quiet), undefined);
  assert.equal(validateOwner({ source: oauth("1741711", "dotKevinWong") }, null, quiet), undefined);
});

test("validateOwner rejects every non-owner source with not_owner", () => {
  for (const [name, source] of REJECTED) assert.deepEqual(validateOwner({ source }, null, quiet), NOT_OWNER, name);
});

test("validateOwner never returns false", () => {
  for (const source of [oauth(1741711), ...REJECTED.map(([, s]) => s)]) {
    const result = validateOwner({ source }, null, quiet);
    assert.notEqual(result, false);
    assert.ok(result === undefined || result.error === "not_owner");
  }
});

test("validateOwner schedules one rejected-sign-in log and does not await it", async () => {
  const scheduled = [];
  const logged = [];
  const deps = { logRejected: async (args) => { logged.push(args); }, schedule: (p) => { scheduled.push(p); } };
  const result = validateOwner({ source: oauth(999, "intruder") }, null, deps);
  assert.equal(result instanceof Promise, false);
  assert.deepEqual(result, NOT_OWNER);
  assert.equal(scheduled.length, 1);
  assert.ok(scheduled[0] instanceof Promise);
  await scheduled[0];
  assert.deepEqual(logged, [{ githubId: "999", login: "intruder" }]);
  validateOwner({ source: oauth(1741711, "dotKevinWong") }, null, deps);
  assert.equal(scheduled.length, 1, "the owner schedules nothing");
});

test("validateOwner still rejects when the rejected-sign-in log fails", async () => {
  const scheduled = [];
  const deps = { logRejected: async () => { throw new Error("database down"); }, schedule: (p) => { scheduled.push(p); } };
  assert.deepEqual(validateOwner({ source: oauth(999, "intruder") }, null, deps), NOT_OWNER);
  await assert.doesNotReject(scheduled[0]);
});

test("githubProfileToUser fills a placeholder email and falls back to the login", () => {
  assert.deepEqual(githubProfileToUser({ id: 1741711, login: "dotKevinWong", name: null, email: null }),
    { email: "1741711@github.placeholder.invalid", name: "dotKevinWong" });
});

test("githubProfileToUser keeps a real email and name", () => {
  assert.deepEqual(githubProfileToUser({ id: 1, login: "a", name: "A Person", email: "a@example.com" }),
    { email: "a@example.com", name: "A Person" });
});

test("buildAuthOptions pins the reviewed options", () => {
  const db = { query() {} };
  const o = buildAuthOptions({ env: VALID_ENV, db });
  assert.equal(o.appName, "kevinwong.co admin");
  assert.equal(o.baseURL, "https://www.kevinwong.co");
  assert.equal(o.secret, "a".repeat(64));
  assert.equal(o.database, db);
  assert.deepEqual(o.emailAndPassword, { enabled: false });
  const gh = o.socialProviders.github;
  assert.deepEqual(Object.keys(o.socialProviders), ["github"]);
  assert.equal(gh.clientId, "client-id");
  assert.equal(gh.clientSecret, "client-secret");
  assert.equal(gh.disableDefaultScope, true);
  assert.equal("scope" in gh, false, "no GitHub scopes");
  assert.equal(gh.mapProfileToUser, githubProfileToUser);
  assert.deepEqual(o.user, { modelName: "auth_user", validateUserInfo: validateOwner });
  assert.deepEqual(o.session, { modelName: "auth_session", expiresIn: 86_400, disableSessionRefresh: true, cookieCache: { enabled: false } });
  assert.deepEqual(o.account, { modelName: "auth_account", accountLinking: { enabled: false }, storeStateStrategy: "cookie", encryptOAuthTokens: true });
  assert.deepEqual(o.verification, { modelName: "auth_verification" });
  assert.equal(typeof o.databaseHooks.session.create.after, "function");
  assert.deepEqual(o.onAPIError, { errorURL: "/admin/sign-in" });
  assert.deepEqual(o.rateLimit, { enabled: true, storage: "memory" });
  assert.deepEqual(o.telemetry, { enabled: false });
  assert.equal(o.advanced.useSecureCookies, true);
  assert.equal(typeof o.advanced.backgroundTasks.handler, "function");
  assert.deepEqual(o.disabledPaths, [
    "/get-session", "/list-sessions", "/update-session", "/revoke-session", "/revoke-sessions",
    "/revoke-other-sessions", "/link-social", "/unlink-account", "/get-access-token", "/refresh-token",
    "/list-accounts", "/account-info", "/update-user", "/delete-user", "/change-email", "/change-password",
    "/sign-in/email", "/sign-up/email", "/error",
  ]);
  for (const p of ["/sign-in/social", "/callback/github", "/sign-out"]) assert.ok(!o.disabledPaths.includes(p), p);
});

test("buildAuthOptions requires BETTER_AUTH_URL in production only", () => {
  assert.throws(() => buildAuthOptions({ env: { ...PROD_ENV, BETTER_AUTH_URL: undefined }, db: {} }), { message: "BETTER_AUTH_URL is not set" });
  assert.doesNotThrow(() => buildAuthOptions({ env: {}, db: {} }));
  assert.doesNotThrow(() => buildAuthOptions({ env: PROD_ENV, db: {} }));
});

test("buildAuthOptions refuses any origin but https://www.kevinwong.co in production", () => {
  for (const url of ["https://kevinwong.co", "https://www.kevinwong.co/", "https://kevinwong-co.vercel.app"]) {
    assert.throws(() => buildAuthOptions({ env: { ...PROD_ENV, BETTER_AUTH_URL: url }, db: {} }),
      { message: "BETTER_AUTH_URL must be https://www.kevinwong.co" }, url);
  }
});

test("buildAuthOptions requires a 32-character BETTER_AUTH_SECRET in production", () => {
  for (const secret of [undefined, "", "x".repeat(31)]) {
    assert.throws(() => buildAuthOptions({ env: { ...PROD_ENV, BETTER_AUTH_SECRET: secret }, db: {} }),
      { message: "BETTER_AUTH_SECRET must be set to at least 32 characters" });
  }
});
