import pg from "pg";

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

    pool.on("error", (err) => {
      console.error("[db] Unexpected pool error", err);
    });
  }

  return pool;
}
