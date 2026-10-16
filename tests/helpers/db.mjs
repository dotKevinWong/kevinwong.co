import pg from "pg";
import { sslFor } from "../../lib/db.js";
import { loadTestEnv, resetTestDatabase } from "../../scripts/test-db.mjs";

// lib code's getDbPool() connects to DATABASE_URL, and in a developer's shell that can be production (D1).
// Refuse to load unless it is unset or local, so no integration test can reach a remote database.
const liveUrl = process.env.DATABASE_URL;
if (liveUrl && sslFor(liveUrl) !== false) {
  throw new Error("Refusing to run integration tests: DATABASE_URL points at a remote database");
}

// .env.test.local holds TEST_DATABASE_URL (Task 2). A variable already set wins.
loadTestEnv();

let shared = null;

/**
 * The test database for this process. Never throws, so call it at module top level:
 * describe(name, { skip: db.skip }, ...) skips the suite, hooks included, without
 * TEST_DATABASE_URL.
 */
export function testDb() {
  if (shared) return shared;
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    shared = {
      skip: "TEST_DATABASE_URL is not set",
      pool: null,
      resetSchema: async () => { throw new Error("TEST_DATABASE_URL is not set"); },
      close: async () => {},
    };
    return shared;
  }
  const pool = new pg.Pool({ connectionString: url, ssl: sslFor(url), max: 3 });
  pool.on("error", (err) => console.error("[test db] idle client error:", err.message));
  shared = {
    skip: false,
    pool,
    // Rebuilds `public` in place, so this pool (and any other) stays usable.
    resetSchema: ({ applyMigrations = true } = {}) => resetTestDatabase({ url, applyMigrations }),
    close: () => pool.end(),
  };
  return shared;
}
