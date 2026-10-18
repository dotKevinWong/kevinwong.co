import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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

// The guard runs once, at import, so each case imports the helper in a fresh process. vars sets (or, with
// undefined, unsets) variables for it; after the import, `then` runs as more of the child's code. envFile, when
// given, is the text the child reads in place of .env.test.local, from a temporary file: the real one is never
// read or changed.
const importHelper = (databaseUrl, { vars = {}, then = "", envFile } = {}) => {
  let preamble = "";
  if (envFile !== undefined) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kw-test-env-"));
    const file = path.join(dir, ".env.test.local");
    fs.writeFileSync(file, envFile);
    preamble = `import fs from "node:fs";
const isTestEnv = (p) => String(p).endsWith(".env.test.local");
const existsSync = fs.existsSync;
fs.existsSync = (p) => isTestEnv(p) || existsSync(p);
const loadEnvFile = process.loadEnvFile;
process.loadEnvFile = (p) => loadEnvFile.call(process, isTestEnv(p) ? ${JSON.stringify(file)} : p);
`;
    process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
  }
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.REQUIRE_TEST_DB;
  if (databaseUrl !== undefined) env.DATABASE_URL = databaseUrl;
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return spawnSync(
    process.execPath,
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "--input-type=module",
      "--eval",
      `${preamble}const helper = await import(${JSON.stringify(HELPER)});\n${then}`,
    ],
    { env, encoding: "utf8" }
  );
};
const OTHER_PORTS = "ports 5432, 5433, 5434 and 54329 belong to other projects";

test("tests/helpers/db.mjs refuses to load while DATABASE_URL points at a remote database", () => {
  const r = importHelper(REMOTE);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Refusing to run integration tests: DATABASE_URL points at a remote database/);
  assert.ok(!r.stderr.includes("npg_SECRETVALUE"));
});

test("tests/helpers/db.mjs refuses a local DATABASE_URL whose host parameter points elsewhere", () => {
  const r = importHelper("postgres://postgres:pw@127.0.0.1:55432/kw_test?host=ep-x.neon.tech");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Refusing to run integration tests: DATABASE_URL points at a remote database/);
});

test("tests/helpers/db.mjs loads with a loopback DATABASE_URL on port 55432, or none", () => {
  for (const databaseUrl of [undefined, "postgres://postgres:pw@127.0.0.1:55432/kw_test",
    "postgres://postgres:pw@localhost:55432/kw_test", "postgres://postgres:pw@[::1]:55432/kw_test"]) {
    const r = importHelper(databaseUrl);
    assert.equal(r.status, 0, r.stderr);
  }
});

// The callback tests' audit writes and every lib module go through getDbPool(), which reads DATABASE_URL.
test("tests/helpers/db.mjs refuses a loopback DATABASE_URL on any port but 55432", () => {
  for (const [databaseUrl, port] of [
    ["postgres://postgres:pw@127.0.0.1:5432/kw_test", 5432],
    ["postgres://postgres:pw@localhost/kw_test", 5432],
    ["postgres://postgres:pw@127.0.0.1:5433/kw_test", 5433],
    ["postgres://postgres:pw@127.0.0.1:5434/kw_test", 5434],
    ["postgres://postgres:pw@127.0.0.1:54329/kw_test", 54329],
    ["postgres://postgres:pw@127.0.0.1:55433/kw_test", 55433],
  ]) {
    const r = importHelper(databaseUrl);
    assert.equal(r.status, 1, databaseUrl);
    assert.ok(r.stderr.includes(
      `Refusing to run integration tests: DATABASE_URL uses port ${port}, not the test database's 55432 (${OTHER_PORTS})`), r.stderr);
    assert.ok(!r.stderr.includes("pw@"), "no password");
  }
});

test("tests/helpers/db.mjs refuses a TEST_DATABASE_URL that isn't a loopback database on port 55432", () => {
  const wrongPort = importHelper(undefined, { vars: { TEST_DATABASE_URL: "postgres://postgres:pw@127.0.0.1:5433/kw_test" } });
  assert.equal(wrongPort.status, 1);
  assert.ok(wrongPort.stderr.includes(
    `Refusing to run integration tests: TEST_DATABASE_URL uses port 5433, not the test database's 55432 (${OTHER_PORTS})`), wrongPort.stderr);
  const remote = importHelper(undefined, { vars: { TEST_DATABASE_URL: REMOTE } });
  assert.equal(remote.status, 1);
  assert.match(remote.stderr, /Refusing to run integration tests: TEST_DATABASE_URL points at a remote database/);
  assert.ok(!remote.stderr.includes("npg_SECRETVALUE"));
});

// pg-connection-string copies every query parameter in order, so the last of a repeated one wins, and a port
// parameter replaces the URL's port. The guard refuses both rather than guess which port pg will use.
test("tests/helpers/db.mjs refuses a port query parameter, and a repeated host, hostaddr, port or service", () => {
  const base = "postgres://postgres:pw@127.0.0.1:55432/kw_test";
  for (const [query, problem] of [
    ["?port=5432", "has a port query parameter"],
    ["?port=55432", "has a port query parameter"],
    ["?port=55432&port=5433", "repeats the port query parameter"],
    ["?host=127.0.0.1&host=ep-x.neon.tech", "repeats the host query parameter"],
    ["?hostaddr=127.0.0.1&hostaddr=10.0.0.9", "repeats the hostaddr query parameter"],
    ["?service=a&service=b", "repeats the service query parameter"],
  ]) {
    for (const name of ["DATABASE_URL", "TEST_DATABASE_URL"]) {
      const r = name === "DATABASE_URL"
        ? importHelper(base + query)
        : importHelper(undefined, { vars: { TEST_DATABASE_URL: base + query } });
      assert.equal(r.status, 1, `${name}${query}`);
      assert.ok(r.stderr.includes(`Refusing to run integration tests: ${name} ${problem}`), r.stderr);
      assert.ok(!r.stderr.includes("pw@"), "no password");
    }
  }
});

// .env.test.local is loaded before the checks, so a DATABASE_URL in it is checked as well.
test("tests/helpers/db.mjs checks a DATABASE_URL that .env.test.local sets", () => {
  const r = importHelper(undefined, {
    vars: { TEST_DATABASE_URL: undefined },
    envFile: "TEST_DATABASE_URL=postgres://postgres:pw@127.0.0.1:55432/kw_test\n" +
      "DATABASE_URL=postgres://postgres:pw@127.0.0.1:5433/otherproject\n",
    then: "console.log(process.env.DATABASE_URL);",
  });
  assert.equal(r.status, 1, r.stdout);
  assert.ok(r.stderr.includes(
    `Refusing to run integration tests: DATABASE_URL uses port 5433, not the test database's 55432 (${OTHER_PORTS})`), r.stderr);
  // The same file without the stray DATABASE_URL loads, which shows the file was read.
  const ok = importHelper(undefined, {
    vars: { TEST_DATABASE_URL: undefined },
    envFile: "TEST_DATABASE_URL=postgres://postgres:pw@127.0.0.1:55432/kw_from_file\n",
    then: "console.log(new URL(process.env.TEST_DATABASE_URL).pathname);",
  });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout.trim(), "/kw_from_file");
});

// npm run test:integration sets REQUIRE_TEST_DB=1, so a missing test database fails the run instead of skipping
// every suite. Plain npm test still skips them (the Deploy B gate's throwaway checkout relies on that).
test("testDb() skips without TEST_DATABASE_URL, and throws instead when REQUIRE_TEST_DB=1", () => {
  // .env.test.local is read at import, so the variable is removed after it.
  const then = "delete process.env.TEST_DATABASE_URL; console.log(JSON.stringify(helper.testDb().skip));";
  const skipped = importHelper(undefined, { then });
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.equal(skipped.stdout.trim(), '"TEST_DATABASE_URL is not set"');
  const required = importHelper(undefined, { vars: { REQUIRE_TEST_DB: "1" }, then });
  assert.equal(required.status, 1);
  assert.match(required.stderr, /TEST_DATABASE_URL is not set, and REQUIRE_TEST_DB=1 \(npm run test:integration\) needs the test database/);
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

test("assertResettable refuses a local URL whose host parameter points elsewhere", () => {
  assert.throws(
    () => assertResettable("postgres://postgres:pw@127.0.0.1:55432/kw_test?host=ep-x.neon.tech"),
    /Refusing to reset .*: not a local database/
  );
});

test("assertResettable refuses the ports that belong to other projects", () => {
  assert.throws(
    () => assertResettable("postgres://postgres:pw@127.0.0.1:5432/kw_test"),
    /Refusing to reset 127\.0\.0\.1:5432\/kw_test: port 5432 belongs to another project/
  );
  assert.throws(
    () => assertResettable("postgres://postgres:pw@localhost/kw_test"),
    /Refusing to reset localhost\/kw_test: port 5432 belongs to another project/
  );
  for (const port of [5433, 5434, 54329]) {
    assert.throws(
      () => assertResettable(`postgres://postgres:pw@127.0.0.1:${port}/kw_test`),
      new RegExp(`port ${port} belongs to another project`)
    );
  }
  assert.equal(assertResettable("postgres://postgres:pw@127.0.0.1:55432/kw_test"), "kw_test");
});

test("assertResettable refuses a port query parameter, and a repeated host, hostaddr, port or service", () => {
  const base = "postgres://postgres:pw@127.0.0.1:55432/kw_test";
  for (const [query, problem] of [
    ["?port=5432", "has a port query parameter"],
    ["?port=55432&port=5433", "repeats the port query parameter"],
    ["?host=127.0.0.1&host=ep-x.neon.tech", "repeats the host query parameter"],
    ["?hostaddr=127.0.0.1&hostaddr=10.0.0.9", "repeats the hostaddr query parameter"],
    ["?service=a&service=b", "repeats the service query parameter"],
  ]) {
    assert.throws(() => assertResettable(base + query), (error) => {
      assert.ok(error.message.startsWith("Refusing to reset "), error.message);
      assert.ok(error.message.includes(`: the URL ${problem}`), error.message);
      assert.ok(!error.message.includes("pw@"), "no password");
      return true;
    }, query);
  }
});

test("migrationFiles lists sql/005 and later in filename order", () => {
  const names = migrationFiles().map((file) => path.basename(file));
  assert.deepEqual(names, [...names].sort());
  for (const name of names) assert.ok(Number(name.slice(0, 3)) >= 5, name);
});
