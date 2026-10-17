import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { getDbPool } from "../../lib/db.js";
import { storeToken } from "../../lib/instagram.js";
import { testDb } from "../helpers/db.mjs";
import { stubFetch } from "../helpers/fetch-stub.mjs";

process.env.CRON_SECRET = "cron-secret-for-tests";
process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_fake_for_tests";
process.env.VERCEL_BLOB_API_URL = "http://127.0.0.1:9";
process.env.VERCEL_BLOB_RETRIES = "0";
delete process.env.BLOB_STORE_ID;

const db = testDb();
// The route's sync uses getDbPool(), whose pool opens on first use: point it at the local test database.
// tests/helpers/db.mjs has already refused a remote DATABASE_URL at import.
if (!db.skip) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

// pages/api/* import lib modules without an extension, which Next resolves and plain Node does not. Retry a
// relative specifier that was not found with ".js" added, so the route loads here as it is.
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
const { default: handler } = await import("../../pages/api/cron/sync-instagram.js");

const MEDIA = "https://graph.instagram.com/v25.0/me/media";

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

describe("the Instagram sync cron route (integration)", { skip: db.skip }, () => {
  before(() => db.resetSchema());
  beforeEach(async () => {
    for (const table of ["sync_runs", "job_locks", "integration_tokens"]) await db.pool.query(`delete from ${table}`);
    await storeToken({ accessToken: "T-cron", expiresInSeconds: 60 * 86_400 }); // fresh: no refresh request
  });
  after(async () => { await getDbPool().end(); await db.close(); });

  test("a failed sync is logged as its redacted message, never the Error object", async (t) => {
    stubFetch(t, { [MEDIA]: () => Response.json(
      { error: { code: 2, type: "OAuthException", message: "Bad request for access_token=IGQVJsecretvalue123" } },
      { status: 500 }) });
    const errors = t.mock.method(console, "error", () => {});
    const res = fakeRes();
    await handler({ method: "GET", headers: { authorization: "Bearer cron-secret-for-tests" }, query: {} }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, "Sync failed"); // the response body is unchanged
    const routeLines = errors.mock.calls.filter((c) => String(c.arguments[0]).startsWith("[cron/sync-instagram]"));
    assert.deepEqual(routeLines.map((c) => c.arguments), [[
      "[cron/sync-instagram] failed:",
      "[instagram] HTTP 500 code=2 type=OAuthException: Bad request for access_token=[redacted]",
    ]]);
  });
});
