import test from "node:test";
import assert from "node:assert/strict";
import { getDbPool, sslFor } from "../lib/db.js";

const VERIFY = { rejectUnauthorized: true };

test("sslFor turns TLS off for localhost, 127.0.0.1 and ::1", () => {
  assert.equal(sslFor("postgres://postgres:pw@localhost:55432/kw_test"), false);
  assert.equal(sslFor("postgres://postgres:pw@127.0.0.1:55432/kw_test"), false);
  assert.equal(sslFor("postgres://postgres:pw@[::1]:55432/kw_test"), false);
  assert.equal(sslFor("postgresql://postgres:pw@LOCALHOST/kw_test"), false);
});

test("sslFor verifies TLS for every other host", () => {
  assert.deepEqual(
    sslFor("postgresql://kw_owner:pw@ep-x-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require"),
    VERIFY
  );
  assert.deepEqual(sslFor("postgres://u:p@localhost.evil.test/db"), VERIFY);
  assert.deepEqual(sslFor("postgres://u:p@127.0.0.1.nip.io/db"), VERIFY);
  assert.deepEqual(sslFor("postgres://u:p@10.0.0.5/db"), VERIFY);
});

test("sslFor fails closed on a string it cannot parse", () => {
  assert.deepEqual(sslFor("not a url"), VERIFY);
  assert.deepEqual(sslFor(""), VERIFY);
});

test("sslFor verifies TLS when a query parameter can redirect the host", () => {
  assert.deepEqual(sslFor("postgres://postgres:pw@127.0.0.1:55432/kw_test?host=ep-x.neon.tech"), VERIFY);
  assert.deepEqual(sslFor("postgres://postgres:pw@localhost/kw_test?hostaddr=10.0.0.5"), VERIFY);
  assert.deepEqual(sslFor("postgres://postgres:pw@localhost/kw_test?service=prod"), VERIFY);
  assert.equal(sslFor("postgres://postgres:pw@127.0.0.1:55432/kw_test?sslmode=disable"), false);
});

test("getDbPool passes sslFor(DATABASE_URL) to the pool", async () => {
  process.env.DATABASE_URL = "postgres://postgres:pw@127.0.0.1:55432/kw_test";
  const pool = getDbPool();
  assert.equal(pool.options.ssl, false);
  await pool.end();
});

test("the pool's error listener logs one describeError line, never the Error object", async (t) => {
  const consoleError = t.mock.method(console, "error", () => {});
  process.env.DATABASE_URL = "postgres://postgres:pw@127.0.0.1:55432/kw_test";
  const pool = getDbPool();
  const idleError = Object.assign(new Error("terminating connection for postgres://kw:hunter2@db.example/kw"), {
    code: "57P01", detail: "Failing row contains (detail-secret).",
  });
  pool.emit("error", idleError);
  assert.deepEqual(consoleError.mock.calls.map((call) => call.arguments), [
    ["[db] Unexpected pool error:", "Error [57P01]: terminating connection for postgres://[redacted]@db.example/kw"],
  ]);
  await pool.end().catch(() => {});
});
