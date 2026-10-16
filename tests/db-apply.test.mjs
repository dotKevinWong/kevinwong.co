import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  describeTarget,
  directUrlFrom,
  isPoolerUrl,
  parseArgs,
  resolveTargetUrl,
} from "../scripts/db-apply.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const POOLED =
  "postgresql://kw_owner:npg_SECRETVALUE@ep-quiet-sky-123456-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require";
const DIRECT =
  "postgresql://kw_owner:npg_SECRETVALUE@ep-quiet-sky-123456.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require";
const LOCAL = "postgres://postgres:pw@127.0.0.1:55432/kw_test";

const runCli = (args, env) =>
  spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/db-apply.mjs", ...args],
    { cwd: ROOT, env: { ...process.env, ...env }, encoding: "utf8" }
  );

test("directUrlFrom drops -pooler from the first host label only", () => {
  assert.equal(directUrlFrom(POOLED), DIRECT);
  assert.equal(directUrlFrom(DIRECT), DIRECT);
  assert.equal(directUrlFrom(LOCAL), LOCAL);
  assert.equal(
    directUrlFrom("postgres://u:p@db.example-pooler.test/x"),
    "postgres://u:p@db.example-pooler.test/x"
  );
});

test("isPoolerUrl spots a Neon pooler host", () => {
  assert.equal(isPoolerUrl(POOLED), true);
  assert.equal(isPoolerUrl(DIRECT), false);
  assert.equal(isPoolerUrl(LOCAL), false);
});

test("describeTarget names host, port and database but never the user or password", () => {
  assert.equal(describeTarget(DIRECT), "ep-quiet-sky-123456.c-4.us-east-1.aws.neon.tech/neondb");
  assert.equal(describeTarget(LOCAL), "127.0.0.1:55432/kw_test");
  assert.ok(!describeTarget(DIRECT).includes("npg_SECRETVALUE"));
  assert.ok(!describeTarget(DIRECT).includes("kw_owner"));
});

test("parseArgs reads files, --yes and --url-env", () => {
  assert.deepEqual(parseArgs(["--yes", "sql/005_a.sql", "sql/006_b.sql"]), {
    files: ["sql/005_a.sql", "sql/006_b.sql"],
    urlEnv: null,
    yes: true,
  });
  assert.deepEqual(parseArgs(["--url-env", "TEST_DATABASE_URL", "sql/005_a.sql"]), {
    files: ["sql/005_a.sql"],
    urlEnv: "TEST_DATABASE_URL",
    yes: false,
  });
});

test("parseArgs rejects unknown options, a missing --url-env name, non-SQL files and no files", () => {
  assert.throws(() => parseArgs(["--force", "sql/005_a.sql"]), /Unknown option --force/);
  assert.throws(() => parseArgs(["sql/005_a.sql", "--url-env"]), /--url-env needs a variable name/);
  assert.throws(() => parseArgs(["notes.txt"]), /Not an \.sql file: notes\.txt/);
  assert.throws(() => parseArgs(["--yes"]), /No \.sql files given/);
});

test("resolveTargetUrl derives the direct URL from DATABASE_URL", () => {
  assert.equal(resolveTargetUrl({ urlEnv: null }, { DATABASE_URL: POOLED }), DIRECT);
  assert.equal(
    resolveTargetUrl({ urlEnv: "TEST_DATABASE_URL" }, { TEST_DATABASE_URL: LOCAL }),
    LOCAL
  );
});

test("resolveTargetUrl refuses a missing variable and a pooler host", () => {
  assert.throws(() => resolveTargetUrl({ urlEnv: null }, {}), /DATABASE_URL is not set/);
  assert.throws(
    () => resolveTargetUrl({ urlEnv: "POOLED" }, { POOLED }),
    /Refusing ep-quiet-sky-123456-pooler\.c-4\.us-east-1\.aws\.neon\.tech\/neondb: a -pooler host/
  );
});

test("the CLI prints the target, hides the password and refuses a remote host without --yes", () => {
  const r = runCli(["sql/004_job_locks.sql"], { DATABASE_URL: POOLED });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Target: ep-quiet-sky-123456\.c-4\.us-east-1\.aws\.neon\.tech\/neondb/);
  assert.match(r.stderr, /Re-run with --yes/);
  assert.ok(!(r.stdout + r.stderr).includes("npg_SECRETVALUE"));
});

test("the CLI refuses a pooler URL given with --url-env", () => {
  const r = runCli(["--url-env", "POOLED_URL", "--yes", "sql/004_job_locks.sql"], {
    POOLED_URL: POOLED,
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /a -pooler host runs in transaction mode/);
  assert.ok(!(r.stdout + r.stderr).includes("npg_SECRETVALUE"));
});
