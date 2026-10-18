import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

const CLI = path.join(ROOT, "scripts", "db-apply.mjs");
const SQL_004 = path.join(ROOT, "sql", "004_job_locks.sql");

// The CLI reads .env and .env.local from its working directory, and the main checkout's .env holds production's
// DATABASE_URL. So it runs in an empty folder of its own, with only the variables each case passes (env), never
// an inherited DATABASE_URL, and with absolute paths to the script and the SQL. files writes files into that
// folder first.
function runCli(t, args, env = {}, files = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kw-db-apply-cli-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(cwd, name), text);
  const childEnv = { ...process.env, ...env };
  if (!("DATABASE_URL" in env)) delete childEnv.DATABASE_URL;
  return spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", CLI, ...args],
    { cwd, env: childEnv, encoding: "utf8" });
}

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

test("the CLI prints the target, hides the password and refuses a remote host without --yes", (t) => {
  const r = runCli(t, [SQL_004], { DATABASE_URL: POOLED });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Target: ep-quiet-sky-123456\.c-4\.us-east-1\.aws\.neon\.tech\/neondb/);
  assert.match(r.stderr, /Re-run with --yes/);
  assert.ok(!(r.stdout + r.stderr).includes("npg_SECRETVALUE"));
});

test("the CLI refuses a pooler URL given with --url-env", (t) => {
  const r = runCli(t, ["--url-env", "POOLED_URL", "--yes", SQL_004], {
    POOLED_URL: POOLED,
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /a -pooler host runs in transaction mode/);
  assert.ok(!(r.stdout + r.stderr).includes("npg_SECRETVALUE"));
});

// With no DATABASE_URL in its environment, the CLI could only find one in a .env. It finds none, so the
// repository root's .env (production's, in the main checkout) is never read. The file named doesn't exist, so
// even a CLI that did find a URL would stop before connecting.
test("the CLI test never reads the repository's .env: without DATABASE_URL the CLI finds none", (t) => {
  const r = runCli(t, [path.join(ROOT, "sql", "undo", "never-applied.sql")]);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "", "no Target: line, so no URL was found");
  assert.match(r.stderr, /^DATABASE_URL is not set\n$/);
});

// The case above means something only because the CLI does read a .env in its working directory.
test("the CLI reads a .env in its working directory", (t) => {
  const r = runCli(t, [path.join(ROOT, "sql", "undo", "never-applied.sql")], {},
    { ".env": "DATABASE_URL=postgresql://kw_owner:npg_SECRETVALUE@env-file-sentinel.invalid/neondb\n" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^Target: env-file-sentinel\.invalid\/neondb$/m);
  assert.ok(!(r.stdout + r.stderr).includes("npg_SECRETVALUE"));
});
