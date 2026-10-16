import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  assertResettable,
  cleanDump,
  majorFromVersionNum,
  migrationFiles,
  pgEnvFromUrl,
} from "../scripts/test-db.mjs";

const HELPER = new URL("./helpers/db.mjs", import.meta.url).href;
const REMOTE =
  "postgresql://kw_owner:npg_SECRETVALUE@ep-quiet-sky-123456-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require";

// The guard runs once, at import, so each case imports the helper in a fresh process.
const importHelper = (databaseUrl) => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  if (databaseUrl !== undefined) env.DATABASE_URL = databaseUrl;
  return spawnSync(
    process.execPath,
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(HELPER)});`,
    ],
    { env, encoding: "utf8" }
  );
};

test("tests/helpers/db.mjs refuses to load while DATABASE_URL points at a remote database", () => {
  const r = importHelper(REMOTE);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Refusing to run integration tests: DATABASE_URL points at a remote database/);
  assert.ok(!r.stderr.includes("npg_SECRETVALUE"));
});

test("tests/helpers/db.mjs loads with a local DATABASE_URL or none", () => {
  for (const databaseUrl of [undefined, "postgres://postgres:pw@127.0.0.1:55432/kw_test"]) {
    const r = importHelper(databaseUrl);
    assert.equal(r.status, 0, r.stderr);
  }
});

test("majorFromVersionNum reads the major version", () => {
  assert.equal(majorFromVersionNum("170005"), 17);
  assert.equal(majorFromVersionNum("160010"), 16);
  assert.equal(majorFromVersionNum(180000), 18);
  assert.throws(() => majorFromVersionNum("abc"), /Unexpected server_version_num: abc/);
});

test("cleanDump strips psql meta-commands, transaction_timeout and CREATE SCHEMA public", () => {
  const raw = [
    "--",
    "\\restrict AbC123",
    "SET statement_timeout = 0;",
    "SET transaction_timeout = 0;",
    "SELECT pg_catalog.set_config('search_path', '', false);",
    "CREATE SCHEMA public;",
    "COMMENT ON SCHEMA public IS 'standard public schema';",
    "CREATE TABLE public.job_locks (",
    "    name text NOT NULL",
    ");",
    "\\unrestrict AbC123",
    "",
  ].join("\n");
  assert.equal(
    cleanDump(raw),
    [
      "--",
      "SET statement_timeout = 0;",
      "SELECT pg_catalog.set_config('search_path', '', false);",
      "COMMENT ON SCHEMA public IS 'standard public schema';",
      "CREATE TABLE public.job_locks (",
      "    name text NOT NULL",
      ");",
      "",
    ].join("\n")
  );
});

test("pgEnvFromUrl splits a URL into libpq variables, decoding the password", () => {
  assert.deepEqual(
    pgEnvFromUrl("postgresql://kw_owner:p%40ss@ep-x.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require"),
    {
      PGHOST: "ep-x.c-4.us-east-1.aws.neon.tech",
      PGPORT: "5432",
      PGUSER: "kw_owner",
      PGPASSWORD: "p@ss",
      PGDATABASE: "neondb",
    }
  );
});

test("assertResettable allows only a local database whose name starts with kw_test", () => {
  assert.equal(assertResettable("postgres://postgres:pw@127.0.0.1:55432/kw_test"), "kw_test");
  assert.throws(
    () => assertResettable("postgresql://u:p@ep-x.c-4.us-east-1.aws.neon.tech/kw_test"),
    /not a local database/
  );
  assert.throws(
    () => assertResettable("postgres://postgres:pw@127.0.0.1:55432/postgres"),
    /must start with kw_test/
  );
  assert.throws(
    () => assertResettable("postgres://postgres:pw@127.0.0.1:55432/neondb"),
    /must start with kw_test/
  );
});

test("migrationFiles lists sql/005 and later in filename order", () => {
  const names = migrationFiles().map((file) => path.basename(file));
  assert.deepEqual(names, [...names].sort());
  for (const name of names) assert.ok(Number(name.slice(0, 3)) >= 5, name);
});
