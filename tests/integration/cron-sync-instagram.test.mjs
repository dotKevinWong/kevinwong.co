import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { getDbPool } from "../../lib/db.js";
import { storeToken } from "../../lib/instagram.js";
import { testDb } from "../helpers/db.mjs";
import { stubFetch } from "../helpers/fetch-stub.mjs";
import { fakeRes } from "../helpers/admin-fakes.mjs";
import "../helpers/resolve-extensionless.mjs";

process.env.CRON_SECRET = "cron-secret-for-tests";
process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_fake_for_tests";
process.env.VERCEL_BLOB_API_URL = "http://127.0.0.1:9";
process.env.VERCEL_BLOB_RETRIES = "0";
delete process.env.BLOB_STORE_ID;

const db = testDb();
// The route's sync uses getDbPool(), whose pool opens on first use: point it at the local test database.
// tests/helpers/db.mjs has already refused, at import, any DATABASE_URL but the test database.
if (!db.skip) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

// The real route, loaded through tests/helpers/resolve-extensionless.mjs.
const { default: handler } = await import("../../pages/api/cron/sync-instagram.js");

const MEDIA = "https://graph.instagram.com/v25.0/me/media";

describe("the Instagram sync cron route (integration)", { skip: db.skip }, () => {
  before(() => db.resetSchema());
  beforeEach(async () => {
    for (const table of ["sync_runs", "job_locks", "integration_tokens"]) await db.pool.query(`delete from ${table}`);
    await storeToken({ accessToken: "T-cron", expiresInSeconds: 60 * 86_400 }); // fresh: no refresh request
  });
  after(async () => { await getDbPool().end(); await db.close(); });

  const runCron = async () => {
    const res = fakeRes();
    await handler({ method: "GET", headers: { authorization: "Bearer cron-secret-for-tests" }, query: {} }, res);
    return res;
  };
  const routeLines = (errors) =>
    errors.mock.calls.filter((c) => String(c.arguments[0]).startsWith("[cron/sync-instagram]")).map((c) => c.arguments);

  test("a failed sync is logged as its redacted message, never the Error object", async (t) => {
    stubFetch(t, { [MEDIA]: () => Response.json(
      { error: { code: 2, type: "OAuthException", message: "Bad request for access_token=IGQVJsecretvalue123" } },
      { status: 500 }) });
    const errors = t.mock.method(console, "error", () => {});
    const res = await runCron();
    assert.equal(res.statusCode, 500);
    // The response body is unchanged: its detail is still the raw message.
    assert.deepEqual(res.body, { error: "Sync failed",
      detail: "[instagram] HTTP 500 code=2 type=OAuthException: Bad request for access_token=IGQVJsecretvalue123" });
    assert.deepEqual(routeLines(errors), [[
      "[cron/sync-instagram] failed:",
      "Error: [instagram] HTTP 500 code=2 type=OAuthException: Bad request for access_token=[redacted]",
    ]]);
  });

  test("a failed sync whose error has an empty message is still logged by name and code", async (t) => {
    // What pg (and undici) throw when every address of a host refuses the connection.
    stubFetch(t, { [MEDIA]: () => {
      throw Object.assign(new AggregateError([new Error("connect ECONNREFUSED 127.0.0.1:9")], ""), { code: "ECONNREFUSED" });
    } });
    const errors = t.mock.method(console, "error", () => {});
    const res = await runCron();
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: "Sync failed", detail: "" }); // unchanged: the raw, empty message
    assert.deepEqual(routeLines(errors), [["[cron/sync-instagram] failed:", "AggregateError [ECONNREFUSED]: AggregateError"]]);
  });
});
