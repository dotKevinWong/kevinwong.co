import pg from "pg";
import { sslFor } from "../../lib/db.js";
import { loadTestEnv, queryOverride, resetTestDatabase } from "../../scripts/test-db.mjs";

// The test database is the kw-test-pg container on 127.0.0.1:55432. Kevin's other projects run Postgres on the
// loopback too, on these ports, and a test must never write to them.
const TEST_DB_PORT = 55432;
const OTHER_PROJECT_PORTS = "ports 5432, 5433, 5434 and 54329 belong to other projects";

/** Why a connection string can't be the test database, or null when it is a loopback host on port 55432. */
function notTheTestDatabase(connectionString) {
  // A repeated host, hostaddr, port or service parameter, or any port parameter: pg might not go where the URL says.
  const override = queryOverride(connectionString);
  if (override) return override;
  if (sslFor(connectionString) !== false) return "points at a remote database";
  const port = Number(new URL(connectionString).port || 5432);
  if (port !== TEST_DB_PORT) return `uses port ${port}, not the test database's ${TEST_DB_PORT} (${OTHER_PROJECT_PORTS})`;
  return null;
}

function refuseUnlessTestDatabase(name) {
  const value = process.env[name];
  const problem = value ? notTheTestDatabase(value) : null;
  if (problem) throw new Error(`Refusing to run integration tests: ${name} ${problem}`);
}

// .env.test.local holds TEST_DATABASE_URL (README, Local test database). A variable already set wins. It is loaded
// first, so the checks below also see anything it sets.
loadTestEnv();

// lib code's getDbPool() connects to DATABASE_URL, and in a developer's shell (or a stray line in .env.test.local)
// that can be production (D1) or another project's container. Refuse to load unless it is unset or the test
// database, so no test can write anywhere else.
refuseUnlessTestDatabase("DATABASE_URL");
refuseUnlessTestDatabase("TEST_DATABASE_URL");

let shared = null;

/**
 * The test database for this process. Call it at module top level: describe(name, { skip: db.skip }, ...) skips
 * the suite, hooks included, without TEST_DATABASE_URL. Under npm run test:integration, which sets
 * REQUIRE_TEST_DB=1, a missing TEST_DATABASE_URL throws instead, so the run fails rather than passing with every
 * suite skipped.
 */
export function testDb() {
  if (shared) return shared;
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    if (process.env.REQUIRE_TEST_DB === "1") {
      throw new Error(
        "TEST_DATABASE_URL is not set, and REQUIRE_TEST_DB=1 (npm run test:integration) needs the test database: " +
          "start kw-test-pg and keep .env.test.local in the project root (README, Local test database)"
      );
    }
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
