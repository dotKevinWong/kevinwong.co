import pg from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { describeError } from "./redact.js";

const { Pool } = pg;

let pool;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const HOST_REDIRECT_PARAMS = ["host", "hostaddr", "service"];

// A stock local Postgres (tests, migration rehearsals) has no TLS, so TLS is
// off for a loopback host. Every other host, any connection string that
// cannot be parsed, and any URL with a host, hostaddr or service query
// parameter (any value; pg and libpq let it replace the URL's host) must
// verify the server's certificate.
export function sslFor(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    return { rejectUnauthorized: true };
  }
  if (HOST_REDIRECT_PARAMS.some((name) => url.searchParams.has(name))) {
    return { rejectUnauthorized: true };
  }
  return LOCAL_HOSTS.has(url.hostname.toLowerCase()) ? false : { rejectUnauthorized: true };
}

export function getDbPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslFor(process.env.DATABASE_URL),
      max: 3,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
    });

    // Fluid compute suspends an instance between requests, and a suspended
    // instance never runs the idle timer above, so its connections would sit
    // open on Neon's pooler until the server side closed them and the next
    // request tripped over a dead socket. After each query this holds the
    // instance open (via waitUntil) for idleTimeoutMillis, long enough for the
    // pool to close its idle clients itself. It does nothing unless VERCEL_URL
    // and VERCEL_REGION are both set, so the scripts in scripts/ are unaffected.
    attachDatabasePool(pool);

    // One redacted line, never the Error object, its stack or pg's err.detail.
    pool.on("error", (err) => {
      console.error("[db] Unexpected pool error:", describeError(err));
    });
  }

  return pool;
}
