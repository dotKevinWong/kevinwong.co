import pg from "pg";
import { attachDatabasePool } from "@vercel/functions";

const { Pool } = pg;

let pool;

export function getDbPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: true },
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

    pool.on("error", (err) => {
      console.error("[db] Unexpected pool error", err);
    });
  }

  return pool;
}
