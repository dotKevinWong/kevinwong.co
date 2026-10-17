import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, request } from "node:http";
import { registerHooks } from "node:module";
import { testDb } from "../helpers/db.mjs";
import { withEnv } from "../helpers/admin-fakes.mjs";
import { getAuth } from "../../lib/auth.js";
import { getDbPool } from "../../lib/db.js";

// pages/api/* import lib modules without an extension, which Next resolves and plain Node does not. Retry a
// relative specifier that was not found with ".js" added (as in cron-sync-instagram.test.mjs).
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (error?.code !== "ERR_MODULE_NOT_FOUND" || !/^\.\.?\//.test(specifier)) throw error;
      return nextResolve(`${specifier}.js`, context);
    }
  },
});
const route = await import("../../pages/api/auth/[...all].js");

const ORIGIN = "https://www.kevinwong.co";
const db = testDb();

// The real route on a local node:http server (with Next's res.status and res.json added), in front of the real
// Better Auth from lib/auth.js and the test database. Requests go out as raw HTTP, so every header arrives as sent.
function startServer() {
  const server = createServer((req, res) => {
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(body)); return res; };
    route.default(req, res).catch(() => { if (!res.headersSent) res.writeHead(599); res.end(); });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function send(server, { method, path, headers }) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.address().port, method, path, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("the /api/auth route in front of Better Auth", { skip: db.skip }, () => {
  let server;
  before(async () => {
    await db.resetSchema();
    Object.assign(process.env, {
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      BETTER_AUTH_URL: ORIGIN,
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
      GITHUB_CLIENT_ID: "test-client-id",
      GITHUB_CLIENT_SECRET: "test-client-secret",
    });
    server = await startServer();
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await getDbPool().end();
    await db.close();
  });

  test("an injected X-Forwarded-Proto can't send an allowlisted request to another Better Auth route", (t) =>
    withEnv({ VERCEL_ENV: "production" }, async () => {
      // better-call routes on `${X-Forwarded-Proto}://${Host}${req.url}`: this value would turn sign-out into the
      // GitHub callback, a pair the allowlist refuses.
      const auth = getAuth();
      const original = auth.handler;
      const reached = [];
      t.mock.method(auth, "handler", (req) => { reached.push(`${req.method} ${req.url}`); return original(req); });
      const res = await send(server, {
        method: "POST",
        path: "/api/auth/sign-out",
        headers: {
          host: "www.kevinwong.co",
          origin: ORIGIN,
          "x-forwarded-for": "203.0.113.10",
          "x-forwarded-proto": "https://www.kevinwong.co/api/auth/callback/github?code=x&state=y#",
        },
      });
      assert.deepEqual(reached, ["POST https://www.kevinwong.co/api/auth/sign-out"]);
      assert.equal(res.status, 200);
      assert.deepEqual(JSON.parse(res.body), { success: true });
      assert.equal(res.headers["cache-control"], "private, no-store, max-age=0, must-revalidate");
    }));
});
