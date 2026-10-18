import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_AUTH_ENV, NO_STORE, fakeReq, fakeRes, withEnv } from "./helpers/admin-fakes.mjs";
import "./helpers/resolve-extensionless.mjs";

// The real pages/api/auth/[...all].js, with no database, loaded through tests/helpers/resolve-extensionless.mjs.
const route = await import("../pages/api/auth/[...all].js");

const ALLOWLISTED = [
  ["POST", "/api/auth/sign-in/social"],
  ["GET", "/api/auth/callback/github?code=abc&state=xyz"],
  ["POST", "/api/auth/sign-out"],
];

async function call(options) {
  const res = fakeRes();
  await route.default(fakeReq(options), res);
  return res;
}

function assertNotFound(res, label) {
  assert.equal(res.statusCode, 404, label);
  assert.deepEqual(res.body, { error: "not_found" }, label);
  assert.equal(res.getHeader("Cache-Control"), NO_STORE, label);
}

test("the auth route leaves the body to Better Auth", () => {
  assert.deepEqual(route.config, { api: { bodyParser: false } });
});

test("the auth route 404s even the allowlisted routes outside production", (t) =>
  withEnv(NO_AUTH_ENV, async () => {
    const consoleError = t.mock.method(console, "error", () => {});
    for (const vercelEnv of [undefined, "preview", "development"]) {
      if (vercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = vercelEnv;
      for (const [method, url] of ALLOWLISTED) assertNotFound(await call({ method, url }), `${vercelEnv} ${method} ${url}`);
    }
    assert.equal(consoleError.mock.callCount(), 0, "Better Auth was never reached");
  }));

test("the auth route 404s the allowlisted routes in production on any host but www", (t) =>
  withEnv({ ...NO_AUTH_ENV, VERCEL_ENV: "production" }, async () => {
    const consoleError = t.mock.method(console, "error", () => {});
    for (const host of ["kevinwong.co", "kevinwong-co.vercel.app"]) {
      for (const [method, url] of ALLOWLISTED) assertNotFound(await call({ method, url, host }), `${host} ${method} ${url}`);
    }
    assert.equal(consoleError.mock.callCount(), 0, "Better Auth was never reached");
  }));

test("the auth route 404s every other Better Auth route in production on www", (t) =>
  withEnv({ ...NO_AUTH_ENV, VERCEL_ENV: "production" }, async () => {
    const consoleError = t.mock.method(console, "error", () => {});
    for (const [method, url] of [["GET", "/api/auth/get-session"], ["GET", "/api/auth/error"], ["POST", "/api/auth/callback/github"]]) {
      assertNotFound(await call({ method, url }), `${method} ${url}`);
    }
    assert.equal(consoleError.mock.callCount(), 0, "Better Auth was never reached");
  }));

test("the auth route answers 500 with one redacted line when Better Auth can't be built", (t) =>
  withEnv({ ...NO_AUTH_ENV, VERCEL_ENV: "production", NODE_ENV: "production" }, async () => {
    // getAuth() throws here (production with no BETTER_AUTH_URL), so it must run inside forwardAuthRequest.
    const consoleError = t.mock.method(console, "error", () => {});
    const consoleWarn = t.mock.method(console, "warn", () => {});
    const consoleLog = t.mock.method(console, "log", () => {});
    const res = await call({ method: "POST", url: "/api/auth/sign-in/social", origin: "https://www.kevinwong.co" });
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: "server_error" });
    assert.equal(res.getHeader("Cache-Control"), NO_STORE);
    assert.deepEqual(consoleError.mock.calls.map((c) => c.arguments), [["[auth] request failed:", "Error: BETTER_AUTH_URL is not set"]]);
    assert.equal(consoleWarn.mock.callCount() + consoleLog.mock.callCount(), 0, "nothing else was logged");
  }));
