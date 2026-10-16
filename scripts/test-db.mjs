#!/usr/bin/env node
/**
 * The throwaway local Postgres behind the integration tests.
 *
 *   npm run db:test -- dump-schema   # read production's schema into tests/fixtures/prod-schema.sql
 *   npm run db:test -- reset         # rebuild TEST_DATABASE_URL from the fixture and sql/005 onwards
 *
 * dump-schema is read-only. It needs production's DATABASE_URL (from the
 * environment, then .env and .env.local), derives the direct host, and runs
 * pg_dump from the postgres image whose major matches the server's. The URL
 * never appears in any argv: libpq reads its parts from environment variables
 * that `docker -e NAME` copies by name.
 *
 * reset reads TEST_DATABASE_URL from the environment, then .env.test.local, and
 * refuses anything but a local database whose name starts with kw_test.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { sslFor } from "../lib/db.js";
import { applySqlFiles, describeTarget, resolveTargetUrl } from "./db-apply.mjs";
import { loadEnvFiles } from "./load-env.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SQL_DIR = path.join(ROOT, "sql");

export const FIXTURE = path.join(ROOT, "tests", "fixtures", "prod-schema.sql");
export const TEST_ENV_FILE = path.join(ROOT, ".env.test.local");

const USAGE = "Usage: npm run db:test -- dump-schema | reset";

// Local Postgres containers of Kevin's other projects listen on these ports.
const OTHER_PROJECT_PORTS = new Set([5432, 5433, 5434, 54329]);

export function majorFromVersionNum(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 100000) throw new Error(`Unexpected server_version_num: ${value}`);
  return Math.floor(n / 10000);
}

// Lines of pg_dump output that cannot, or must not, be replayed into the test database:
// - \restrict and \unrestrict: psql meta-commands with a random key, written by current pg_dump
//   releases (checked: 16.14 and 18.6). pg cannot run them, and they would make every dump differ.
// - SET transaction_timeout: written by pg_dump 17+, and rejected by a 16 server.
// - CREATE SCHEMA public: emitted because of --schema=public; resetTestDatabase creates it itself.
const isDroppedLine = (line) =>
  /^\\(restrict|unrestrict) /.test(line) ||
  /^SET transaction_timeout = /.test(line) ||
  line === "CREATE SCHEMA public;";

/** The dump without the lines above. Every other line is kept byte for byte. */
export function cleanDump(sql) {
  return sql
    .split("\n")
    .filter((line) => !isDroppedLine(line))
    .join("\n");
}

/** libpq's environment variables for a URL, with user, password and database decoded. */
export function pgEnvFromUrl(connectionString) {
  const url = new URL(connectionString);
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
  };
}

/** The database name, once the URL is known to be a local kw_test* database on a port no other project uses. */
export function assertResettable(connectionString) {
  if (sslFor(connectionString) !== false) {
    throw new Error(`Refusing to reset ${describeTarget(connectionString)}: not a local database`);
  }
  const url = new URL(connectionString);
  // pg lets a port query parameter replace the URL's port, so it is read first.
  const port = Number(url.searchParams.get("port") || url.port || 5432);
  if (OTHER_PROJECT_PORTS.has(port)) {
    throw new Error(`Refusing to reset ${describeTarget(connectionString)}: port ${port} belongs to another project`);
  }
  const name = decodeURIComponent(url.pathname.slice(1));
  // The pattern also keeps the name safe to quote in `create database`.
  if (!/^kw_test[a-z0-9_]*$/.test(name)) {
    throw new Error(
      `Refusing to reset ${describeTarget(connectionString)}: the database name must start with kw_test and use only a-z, 0-9 and _`
    );
  }
  return name;
}

/** Absolute paths of sql/NNN_*.sql with NNN >= from, in filename order. */
export function migrationFiles({ from = 5 } = {}) {
  return fs
    .readdirSync(SQL_DIR)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name) && Number(name.slice(0, 3)) >= from)
    .sort()
    .map((name) => path.join(SQL_DIR, name));
}

/** Load .env.test.local unless TEST_DATABASE_URL is already set. A variable already set wins. */
export function loadTestEnv() {
  if (!process.env.TEST_DATABASE_URL && fs.existsSync(TEST_ENV_FILE)) {
    process.loadEnvFile(TEST_ENV_FILE);
  }
}

/**
 * Rebuild the public schema of a local kw_test* database from the fixture, then
 * apply sql/005 onwards. Returns the number of migrations applied.
 */
export async function resetTestDatabase({ url, applyMigrations = true, log = () => {} }) {
  const db = assertResettable(url);

  // 1. Create the database if it is missing (a container started without POSTGRES_DB).
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.href, ssl: false });
  await admin.connect();
  try {
    const { rowCount } = await admin.query("select 1 from pg_database where datname = $1", [db]);
    if (rowCount === 0) await admin.query(`create database "${db}"`);
  } finally {
    await admin.end();
  }

  // 2. Rebuild public in place rather than dropping the database, so open pools stay usable.
  const client = new pg.Client({ connectionString: url, ssl: false });
  await client.connect();
  try {
    await client.query("set lock_timeout = '5s'; drop schema if exists public cascade; create schema public;");
  } finally {
    await client.end();
  }

  // 3. Load the fixture and the migrations, each file on its own connection.
  const migrations = applyMigrations ? migrationFiles() : [];
  await applySqlFiles(url, [FIXTURE, ...migrations], { log });
  return migrations.length;
}

const lineCount = (text) => text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

/** Read production's public schema (read-only) into tests/fixtures/prod-schema.sql. */
export async function dumpSchema({ env, log = console.log }) {
  // Derives the direct host and refuses a pooler.
  const url = resolveTargetUrl({ urlEnv: null }, env);

  const client = new pg.Client({ connectionString: url, ssl: sslFor(url) });
  await client.connect();
  let num;
  try {
    const { rows } = await client.query("show server_version_num");
    num = rows[0].server_version_num;
  } finally {
    await client.end();
  }
  const major = majorFromVersionNum(num);
  log(`Reading the schema of ${describeTarget(url)} (server_version_num ${num}) with postgres:${major}`);

  // The postgres images carry no CA bundle, so macOS's is mounted for verify-full.
  // --schema=public keeps Neon's own schemas and extensions out of the fixture.
  const result = spawnSync(
    "docker",
    [
      "run", "--rm",
      "-v", "/etc/ssl/cert.pem:/etc/ssl/certs/host-ca.pem:ro",
      "-e", "PGHOST", "-e", "PGPORT", "-e", "PGUSER", "-e", "PGPASSWORD", "-e", "PGDATABASE",
      "-e", "PGSSLMODE", "-e", "PGSSLROOTCERT",
      `postgres:${major}`,
      "pg_dump", "--schema-only", "--no-owner", "--no-privileges", "--schema=public",
    ],
    {
      env: {
        ...process.env,
        ...pgEnvFromUrl(url),
        PGSSLMODE: "verify-full",
        PGSSLROOTCERT: "/etc/ssl/certs/host-ca.pem",
      },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }
  );
  if (result.error) throw result.error;
  // pg_dump's stderr never contains the password.
  if (result.status !== 0) throw new Error(`pg_dump failed:\n${result.stderr}`);

  // Nothing else creates tests/fixtures/, and git does not keep an empty folder.
  fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
  const cleaned = cleanDump(result.stdout);
  fs.writeFileSync(FIXTURE, cleaned);
  log(`wrote tests/fixtures/prod-schema.sql (${lineCount(cleaned)} lines)`);
}

async function main(argv) {
  if (argv.length !== 1 || !["dump-schema", "reset"].includes(argv[0])) {
    console.error(USAGE);
    return 1;
  }

  try {
    if (argv[0] === "dump-schema") {
      await dumpSchema({ env: { ...loadEnvFiles(), ...process.env } });
      return 0;
    }

    loadTestEnv();
    const url = process.env.TEST_DATABASE_URL;
    if (!url) {
      console.error("TEST_DATABASE_URL is not set (looked in the environment and .env.test.local)");
      return 1;
    }
    const applied = await resetTestDatabase({ url });
    console.log(
      `reset ${describeTarget(url)}: loaded tests/fixtures/prod-schema.sql, applied ${applied} migrations`
    );
    return 0;
  } catch (err) {
    console.error(err.message);
    return 1;
  }
}

// process.exitCode rather than process.exit(), so output written to a pipe is
// flushed before the process ends.
if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
