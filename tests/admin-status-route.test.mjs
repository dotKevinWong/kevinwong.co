import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAdminStatus, createStatusHandler } from "../lib/admin/status.js";
import { NO_AUTH_ENV, NO_STORE, OWNER, REDACTED_LINE, fakeReq, fakeRes, leakyError, withEnv } from "./helpers/admin-fakes.mjs";
import "./helpers/resolve-extensionless.mjs";

test("buildAdminStatus rejects when the database query fails", async () => {
  const down = { query: async () => { throw new Error("connect ECONNREFUSED 10.0.0.1:5432"); } };
  await assert.rejects(
    buildAdminStatus({ db: down, env: { refresh_token: "env-refresh" }, now: new Date("2026-10-16T12:00:00Z") }),
    { message: "connect ECONNREFUSED 10.0.0.1:5432" });
});
test("401 from requireAdmin passes through and status is not built", async () => {
  let built = 0;
  const handler = createStatusHandler({
    requireAdmin: async (req, res, opts) => { assert.equal(opts, undefined); res.status(401).json({ error: "unauthorized" }); return null; },
    buildAdminStatus: async () => { built += 1; return {}; } });
  const res = fakeRes();
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(built, 0);
});
test("405 with Allow: GET for POST", async () => {
  const handler = createStatusHandler({ requireAdmin: async () => OWNER, buildAdminStatus: async () => ({}) });
  const res = fakeRes();
  await handler({ method: "POST", headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, "GET");
  assert.deepEqual(res.body, { error: "method_not_allowed" });
});
test("200 with buildAdminStatus() called with no arguments", async () => {
  const args = [];
  const handler = createStatusHandler({ requireAdmin: async () => OWNER,
    buildAdminStatus: async (...a) => { args.push(a); return { generatedAt: "x" }; } });
  const res = fakeRes();
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { generatedAt: "x" });
  assert.deepEqual(args, [[]]);
});
test("500 status_failed without the error message, logged only redacted", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const handler = createStatusHandler({ requireAdmin: async () => OWNER,
    buildAdminStatus: async () => { throw new Error("connect postgres://kw:hunter2@db.example failed"); } });
  const res = fakeRes();
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: "status_failed" });
  const lines = logged.mock.calls.map((c) => c.arguments.map(String).join(" "));
  assert.ok(lines.some((l) => l.includes("postgres://[redacted]@db.example")), lines.join("\n"));
  assert.ok(lines.every((l) => !l.includes("hunter2")), lines.join("\n"));
});

// Fix round 1 (R6): requireAdmin's other answers pass through too. It has sent the one response, nothing is logged
// here, and the status is never built.
test("404 and 500 server_error from requireAdmin pass through and status is not built", async (t) => {
  const consoleError = t.mock.method(console, "error", () => {});
  for (const [code, body] of [[404, { error: "not_found" }], [500, { error: "server_error" }]]) {
    let built = 0;
    let sends = 0;
    const handler = createStatusHandler({
      requireAdmin: async (req, res) => { res.status(code).json(body); return null; },
      buildAdminStatus: async () => { built += 1; return { generatedAt: "x" }; } });
    const res = fakeRes();
    const json = res.json;
    res.json = function (b) { sends += 1; return json.call(this, b); };
    await handler({ method: "GET", headers: {} }, res);
    assert.deepEqual([res.statusCode, res.body, sends, built], [code, body, 1, 0], String(code));
  }
  assert.equal(consoleError.mock.callCount(), 0);
});

// Controller notes (Task 15), 3: a failure is logged as one describeError line, never the Error object, its stack
// or pg's err.detail, and a rejection outside the status read is answered the same way while nothing has been sent.

test("a failed status read is one describeError line and a 500 status_failed", async (t) => {
  const consoleError = t.mock.method(console, "error", () => {});
  const handler = createStatusHandler({ requireAdmin: async () => OWNER,
    buildAdminStatus: async () => { throw leakyError(); } });
  const res = fakeRes();
  await handler({ method: "GET", headers: {} }, res);
  assert.deepEqual([res.statusCode, res.body], [500, { error: "status_failed" }]);
  assert.deepEqual(consoleError.mock.calls.map((c) => c.arguments), [["[admin/status] status read failed:", REDACTED_LINE]]);
});
test("a rejecting requireAdmin is one describeError line and a 500 status_failed, and status is not built", async (t) => {
  const consoleError = t.mock.method(console, "error", () => {});
  let built = 0;
  const handler = createStatusHandler({ requireAdmin: async () => { throw leakyError(); },
    buildAdminStatus: async () => { built += 1; return {}; } });
  const res = fakeRes();
  await handler({ method: "GET", headers: {} }, res);
  assert.deepEqual([res.statusCode, res.body], [500, { error: "status_failed" }]);
  assert.equal(built, 0);
  assert.deepEqual(consoleError.mock.calls.map((c) => c.arguments), [["[admin/status] request failed:", REDACTED_LINE]]);
});
test("a rejection after the response has gone out is logged and nothing more is sent", async (t) => {
  const consoleError = t.mock.method(console, "error", () => {});
  const handler = createStatusHandler({ requireAdmin: async () => { throw leakyError(); },
    buildAdminStatus: async () => ({}) });
  const res = Object.assign(fakeRes(), { headersSent: true });
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.ended, false);
  assert.equal(res.body, undefined);
  assert.deepEqual(consoleError.mock.calls.map((c) => c.arguments), [["[admin/status] request failed:", REDACTED_LINE]]);
});

// Controller notes (Task 15), 1: the real pages/api/admin/status.js, loaded through
// tests/helpers/resolve-extensionless.mjs, with no injected deps, no auth configuration and no database.
const route = await import("../pages/api/admin/status.js");

test("the status route turns the body parser off", () => {
  assert.deepEqual(route.config, { api: { bodyParser: false } });
});

test("the status route 404s outside production or off www, without reaching the database or Better Auth", (t) =>
  withEnv(NO_AUTH_ENV, async () => {
    const consoleError = t.mock.method(console, "error", () => {});
    const consoleWarn = t.mock.method(console, "warn", () => {});
    for (const [vercelEnv, host] of [[undefined, "www.kevinwong.co"], ["preview", "www.kevinwong.co"],
      ["development", "www.kevinwong.co"], ["production", "kevinwong.co"], ["production", "kevinwong-co.vercel.app"]]) {
      if (vercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = vercelEnv;
      for (const method of ["GET", "POST"]) {
        const label = `${vercelEnv} ${host} ${method}`;
        const res = fakeRes();
        await route.default(fakeReq({ method, host, url: "/api/admin/status" }), res);
        assert.equal(res.statusCode, 404, label);
        assert.deepEqual(res.body, { error: "not_found" }, label);
        assert.equal(res.getHeader("Cache-Control"), NO_STORE, label);
      }
    }
    // Reaching Better Auth or the pool here would throw (no configuration, no DATABASE_URL) and log a line.
    assert.equal(consoleError.mock.callCount() + consoleWarn.mock.callCount(), 0, "nothing was logged");
  }));
