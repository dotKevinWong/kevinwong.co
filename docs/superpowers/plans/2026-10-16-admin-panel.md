# Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A private `/admin` page on www.kevinwong.co, usable only by Kevin's GitHub account. It reconnects Spotify into the database, and shows the Instagram sync's state with Check and Import buttons.

**Architecture:** It ships in two deploys.
- **Deploy A** changes no visible behaviour:
  - Spotify reads its refresh token from `integration_tokens`, falling back to the env var until the first reconnect.
  - Token writes for both providers become compare-and-swap on the token value.
  - Every Instagram sync records a `sync_runs` row.
- **Deploy B** adds the panel:
  - Better Auth (GitHub, one owner) behind an allowlisted `/api/auth` route.
  - Admin APIs and pages that return 404 anywhere except production on `www.kevinwong.co`.
  - Spotify reconnect routes, a Check / Import route, and a status endpoint read by a Chakra dashboard.

**Tech Stack:** Next.js 16.3 pages router, React 19.3, Chakra UI 3.37, SWR, node-postgres on Neon (PgBouncer pooler), Vercel Hobby with Fluid compute, Vercel Blob, better-auth 1.7.10, `node:test`.

**Spec:** [`docs/superpowers/specs/2026-09-27-admin-panel-design.md`](../specs/2026-09-27-admin-panel-design.md). Kevin's decisions D1–D5 are in its first table. Read the spec and this plan together.

## Before you start

- **This plan is written against the codebase audit.** Another session's uncommitted audit in `.claude/worktrees/codebase-audit-packages-b865c4` rewrites the files this plan touches:
  - `lib/spotify.js`, `lib/db.js`, `lib/instagram.js`
  - `next.config.js`, `package.json`, `README.md`
  - it also adds `TODO.md`

  **Kevin merges that audit into `main` first.** Task 1 then rebases this branch onto it and checks for the audit's code before anything else runs.
- **Admin never runs locally (D1).** Everything outside the browser is proven by unit tests and integration tests against a throwaway local Postgres (Task 2). The pages are checked by lint, types, a build and a local fixture render, then on production after Deploy B.
- **How Kevin deploys.** Production deploys when Kevin pushes `main`. Each deploy goes in this order:
  1. In the main checkout `/Users/Kevin/Git/kevinwong.co`, merge this branch into local `main`.
  2. Apply that deploy's migrations with `npm run db:apply -- --yes <files…>`. The main checkout's `.env` supplies `DATABASE_URL`, so nothing secret is typed, and the script strips `-pooler` itself.
  3. `git push`.
  4. Wait for Vercel → Deployments → Production to show **Ready**.

  Deploy A's steps are in Task 10. Deploy B's are in Task 18.
- **Models.** Each task names the model to run it, following Kevin's table in `~/.claude/CLAUDE.md`:
  - Opus for database, concurrency, security and money-adjacent quota logic.
  - Sonnet for docs and UI.
  - If a Sonnet task fails review twice, the next attempt goes to Opus.

## Conventions for every task

- Run every command from the session worktree, prefixed with `nvm use --silent &&` (each agent shell is new; `.nvmrc` pins Node 24). If Task 1 could not install the `.nvmrc` version, use `nvm use --silent 24.13.1 &&` instead for the whole plan.
- Reading `node --test` output:
  - `ℹ tests 0` is a failure: a glob that matches nothing exits 0.
  - A pass needs both `ℹ fail 0` and `ℹ cancelled 0`. When a `before` hook throws, its tests show as cancelled and `fail` stays 0.
  - A suite skipped at describe level prints `﹣ <suite> # <reason>` and counts 0 tests.
- Each task's own test files run with `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 <files>`, with the expected count for those files. Every task then ends with `npm test` showing `ℹ fail 0` and `ℹ cancelled 0`.
- Test databases:
  - Integration tests use the `kw-test-pg` container from Task 2; run `docker start kw-test-pg` if it is stopped.
  - Never use ports 5432–5434 or 54329, and never touch the containers behind them. They belong to other projects.
  - `tests/helpers/db.mjs` refuses to run while `DATABASE_URL` points at a remote database. So run every test
    command (`node --test …`, `npm test`, `npm run test:integration`) as `env -u DATABASE_URL …`, after
    `nvm use --silent &&`, even where a task's command is written without it. This applies to test commands
    only, never to `npm run db:apply` or `db:test -- dump-schema`.
- Commit after every task, in the repo's message style: sentence case, imperative, no prefix. Since the audit, `next-env.d.ts` is untracked, so builds no longer dirty the tree.

## Global Constraints

- Node 24.x (`nvm use`); npm 11. No new runtime dependency except `better-auth` pinned to exactly `1.7.10`; its CLI is the exact-pinned devDependency `auth@1.7.10`, run as `npx --no-install auth check --config scripts/auth.config.mjs` and never fetched at run time. Tests use `node:test` and `node:assert/strict` only.
- `lib/` and `scripts/` are plain ESM `.js`/`.mjs` with explicit `.js` import extensions. `pages/api/*` are `.js` and import lib modules without extensions. Pages and components are `.tsx`.
- Owner GitHub id `"1741711"`. Canonical origin `https://www.kevinwong.co`, host `www.kevinwong.co`.
- Admin and auth routes return 404 unless `VERCEL_ENV === "production"` and `Host` is `www.kevinwong.co`.
- Sessions: `expiresIn` 86,400 s, `disableSessionRefresh: true`, no cookie cache. GitHub sign-in requests no scopes.
- Better Auth rate limiting uses its in-memory store, so there is no rate-limit table.
- Spotify:
  - Scopes are exactly `user-read-currently-playing user-top-read user-read-recently-played`.
  - The authorization lifetime is estimated at 180 days.
  - Panel redirect URI: `https://www.kevinwong.co/api/admin/spotify/callback`. Keep `http://127.0.0.1:8888/callback` for the script.
- State cookie: `__Host-kw_spotify_state=<state>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`.
- Panel limits (D4):
  - Check: at most one per 10 minutes.
  - Import: at most one per rolling 24 hours.
  - Panel imports are refused once uploads over the last 30 days reach 1,000.
  - Every non-dry run stops at 1,800.
  - Panel runs are fixed at `maxPosts: 50, maxUploads: 25, timeBudgetMs: 60_000`, with route `maxDuration: 300`.
- Admin responses send `Cache-Control: private, no-store, max-age=0, must-revalidate`. `/admin`, `/api/admin` and `/api/auth` also send:
  - `X-Frame-Options: DENY`
  - `Content-Security-Policy: frame-ancestors 'none'`
  - `X-Robots-Tag: noindex, nofollow`
- Compare-and-swap compares token values, never `updated_at`.
- Migrations:
  - Additive and idempotent.
  - Applied with `npm run db:apply` over the direct (non-pooler) URL, after Kevin backs up production.
  - `005` and `006` go before Deploy A; `007` before Deploy B.
- No secret on a command line, in a log line, in an API response, in page props, or in chat. Use env files or `read -rs NAME && export NAME`.

## Review Focus

The spec implies these failure modes, but its own tests don't reach them. They are listed most likely first. Each line names the test that pins it in the owning task.

1. **The production database is unreachable or slow.** The public Spotify widgets must degrade exactly as today: no 500s, no hang longer than the 5-second timeouts, and no fallback to the env token. On `/admin`:
   - When the owner check passes but the status read fails, it shows "Couldn't load the status".
   - An open page keeps its data and shows that it couldn't refresh.
   - When the database is down entirely, the owner check can't pass, so `/admin` fails closed with the 500 page.

   Pinned by:
   - Task 6, `(g) a database error rejects the getter and never falls back to the env token`.
   - Task 6, `(g2) a stalled database read times out and the next call reads again`.
   - Task 15, `buildAdminStatus rejects when the database query fails`.
   - Task 17's error-state check.
2. **A double-clicked Import, or Import from two tabs.** One import runs. The other is refused, because Check and Import each claim their slot atomically in `job_locks` before running. Pinned by Task 14, `a running panel import blocks a second import`, where exactly one of two concurrent claims succeeds.
3. **Kevin's 24-hour session expires while the page is open.** The next poll or button press must send him to `/admin/sign-in`, not leave a broken card. Pinned by:
   - Task 16, `postJson reports 401 as signedOut` in `lib/admin/client.js`, for the buttons.
   - Task 13's redirect to `/admin/sign-in` for the Reconnect form and the Spotify callback.
   - Task 17 Step 8's `?api=401` preview check, for the status poll. The poll uses SWR with `lib/fetcher.js`, whose error carries `.status`, and `onError` sends a 401 to `/admin/sign-in`.
4. **The Spotify countdown passes its estimate while the token still works**, and the 0-day boundary. The card says "past the estimated date", never a negative day count. Pinned by Task 17, `daysLeftLabel` cases for 1, 0 and −3.
5. **Older `/snapshots` rows with `asset_bytes` null.** Library storage counts them as 0 and still counts the files. Pinned by Task 15, `library bytes treat null asset_bytes as zero`.

---

## Deploy A: the Spotify token in the database, and sync history (no visible change)

---

### Task 1: Baseline on the merged audit, the test runner, and `sslFor`

**Model:** Opus
**Files:**
- Modify: `package.json` (scripts `test`, `test:integration`)
- Modify: `lib/db.js` (add `sslFor`, and `getDbPool` uses it)
- Create: `tests/smoke.test.mjs`
- Test: `tests/db.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks. The audit's `getDbPool()` in `lib/db.js` (a lazy `Pool` with `max: 3` and
  `attachDatabasePool(pool)`; TLS hard-coded as `ssl: { rejectUnauthorized: true }`).
- Produces:
  - `export function sslFor(connectionString: string): false | { rejectUnauthorized: true }` in `lib/db.js`.
    It returns `false` for the hosts `localhost`, `127.0.0.1` and `::1`, and `{ rejectUnauthorized: true }` for
    every other host and for anything it cannot parse. `getDbPool()` passes `ssl: sslFor(process.env.DATABASE_URL)`.
  - The npm scripts `test` (every `tests/**/*.test.mjs`) and `test:integration` (`tests/integration/**`), run one
    file at a time.

- [ ] **Step 1: Precondition (Kevin, or the session that owns the audit): the audit is merged into `main`.** The
  audit worktree `codebase-audit-packages-b865c4` holds its work uncommitted. It must be committed and merged into
  `main` before this task starts. Check it from the session worktree:
  ```sh
  git log --oneline -1 main                                   # anything except 4966697
  git show main:lib/spotify.js | grep -c TOKEN_EXPIRY_MARGIN_MS   # 2
  git show main:.nvmrc                                        # v24.21.0
  ```
  If the count is `0`, stop. The audit is not on `main`, and every task in this plan is written against it.

- [ ] **Step 2: Rebase `claude/admin-panel` onto `main`.**
  ```sh
  git status --short     # nothing modified or staged (docs/ is committed in 75db873, so usually nothing at all)
  git rebase main
  git merge-base --is-ancestor main HEAD && echo "based on main"   # based on main
  grep -c TOKEN_EXPIRY_MARGIN_MS lib/spotify.js                    # 2 (the constant and its use)
  grep -c attachDatabasePool lib/db.js                             # 2 (the import and the call)
  cat .nvmrc                                                       # v24.21.0
  git ls-files next-env.d.ts                                       # prints nothing
  ```
  If `git status --short` lists modified files, stop and ask Kevin. Do not stash: the stash stack is shared
  with the other worktrees.

- [ ] **Step 3: Node and dependencies.** After the rebase `.nvmrc` is `v24.21.0`, which is not installed
  (`~/.nvm/versions/node` holds only `v24.13.1` and `v25.6.1`), and `nvm use --silent` exits 3 until it is.
  ```sh
  nvm use     # if it says v24.21.0 is not installed: run `nvm install` once (a download from nodejs.org)
  ```
  If the download isn't possible, Node 24.13.1 is acceptable: it is the same major, and `engines` says `24.x`.
  Then every command in this plan is prefixed with `nvm use --silent 24.13.1 &&` instead of `nvm use --silent &&`.
  Record which version you used in the task report.
  ```sh
  node -v && npm ci
  ```
  Passes when `node -v` prints `v24.x` and `npm ci` ends with `added N packages` and exits 0, with no
  `EBADENGINE` warning.

- [ ] **Step 4: Baseline checks, before any change.** The build comes before `tsc`, because the build writes
  `next-env.d.ts`, which is gitignored since the audit and which `tsc` needs.
  ```sh
  npx eslint .
  npm run build
  npx tsc --noEmit
  ```
  Each one passes like this:
  - ESLint prints nothing and exits 0.
  - The build ends with Next's route table and exits 0.
  - `tsc` prints nothing and exits 0.

  If any of them fails, stop and report the output. The merged audit is the baseline, and this plan does not fix it.

- [ ] **Step 5: Add the test scripts and the smoke test.** In `package.json` `scripts`, directly after `"lint"`:
  ```json
  "test": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 \"tests/**/*.test.mjs\"",
  "test:integration": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 \"tests/integration/**/*.test.mjs\"",
  ```
  Why each piece is there:
  - **The glob is quoted.** Otherwise zsh and bash expand `**` as `*` and miss nested folders.
  - **`--test-concurrency=1`.** From Task 2 on, integration files rebuild one shared test database, and files
    running in parallel would rebuild it under each other.
  - **`--disable-warning`.** The test runner passes it to each test process (checked); the smoke test proves it.

  `tests/smoke.test.mjs`:
  ```js
  import test from "node:test";
  import assert from "node:assert/strict";

  test("npm test passes the warning flag to every test process", () => {
    assert.ok(
      process.execArgv.includes("--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"),
      "run tests with `npm test`, which loads lib/*.js without the MODULE_TYPELESS_PACKAGE_JSON warning"
    );
  });
  ```
  ```sh
  npm test 2>&1 | tail -n 8
  ```
  Expected, since the smoke test is the repo's only test file so far: `ℹ tests 1`, `ℹ pass 1`, `ℹ fail 0`,
  `ℹ cancelled 0`.

- [ ] **Step 6: Write the failing `sslFor` tests.** `tests/db.test.mjs`:
  ```js
  import test from "node:test";
  import assert from "node:assert/strict";
  import { getDbPool, sslFor } from "../lib/db.js";

  const VERIFY = { rejectUnauthorized: true };

  test("sslFor turns TLS off for localhost, 127.0.0.1 and ::1", () => {
    assert.equal(sslFor("postgres://postgres:pw@localhost:55432/kw_test"), false);
    assert.equal(sslFor("postgres://postgres:pw@127.0.0.1:55432/kw_test"), false);
    assert.equal(sslFor("postgres://postgres:pw@[::1]:55432/kw_test"), false);
    assert.equal(sslFor("postgresql://postgres:pw@LOCALHOST/kw_test"), false);
  });

  test("sslFor verifies TLS for every other host", () => {
    assert.deepEqual(
      sslFor("postgresql://kw_owner:pw@ep-x-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require"),
      VERIFY
    );
    assert.deepEqual(sslFor("postgres://u:p@localhost.evil.test/db"), VERIFY);
    assert.deepEqual(sslFor("postgres://u:p@127.0.0.1.nip.io/db"), VERIFY);
    assert.deepEqual(sslFor("postgres://u:p@10.0.0.5/db"), VERIFY);
  });

  test("sslFor fails closed on a string it cannot parse", () => {
    assert.deepEqual(sslFor("not a url"), VERIFY);
    assert.deepEqual(sslFor(""), VERIFY);
  });

  test("getDbPool passes sslFor(DATABASE_URL) to the pool", async () => {
    process.env.DATABASE_URL = "postgres://postgres:pw@127.0.0.1:55432/kw_test";
    const pool = getDbPool();
    assert.equal(pool.options.ssl, false);
    await pool.end();
  });
  ```

- [ ] **Step 7: Run it to verify it fails.**
  ```sh
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/smoke.test.mjs tests/db.test.mjs 2>&1 | grep -E "^(✖|ℹ (tests|pass|fail|cancelled))|SyntaxError"
  ```
  Expected: `SyntaxError: The requested module '../lib/db.js' does not provide an export named 'sslFor'`,
  `✖ tests/db.test.mjs`, then `ℹ tests 2`, `ℹ pass 1`, `ℹ fail 1`, `ℹ cancelled 0`.

- [ ] **Step 8: Implement `sslFor(connectionString)` in `lib/db.js`, and use it in `getDbPool`.**
  - **Parse with `new URL()`.** It keeps the brackets in an IPv6 `hostname` (`[::1]`), and it does not lowercase
    hosts in `postgres:` URLs.
  - **Compare against `localhost`, `127.0.0.1` and `[::1]`.** Lowercase `hostname` first.
  - **Return `{ rejectUnauthorized: true }` when `new URL()` throws (fail closed).**
  - **`getDbPool`:** replace the literal `ssl: { rejectUnauthorized: true }` with `ssl: sslFor(process.env.DATABASE_URL)`.

  Add one comment above `sslFor`: a stock local Postgres (tests, migration rehearsals) has no TLS, and every
  other host must verify.

  Production does not change. Its `DATABASE_URL` carries `sslmode=require`, which pg's connection-string parser
  turns into its own verifying `ssl` setting. In pg 8.23, `ConnectionParameters` merges the parsed URL over the
  config object, so that setting overrides this option.

- [ ] **Step 9: Run the tests to verify they pass.**
  ```sh
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/smoke.test.mjs tests/db.test.mjs 2>&1 | grep -E "^(✖|ℹ (tests|pass|fail|cancelled))"
  npm test 2>&1 | grep -E "^(✖|ℹ (fail|cancelled))|\[MODULE_TYPELESS_PACKAGE_JSON\]"
  npx eslint .
  ```
  Expected:
  - First command: `ℹ tests 5`, `ℹ pass 5`, `ℹ fail 0`, `ℹ cancelled 0`.
  - `npm test`: only `ℹ fail 0` and `ℹ cancelled 0`. No `✖` line and no `[MODULE_TYPELESS_PACKAGE_JSON] Warning` line.
  - ESLint prints nothing.

- [ ] **Step 10: Commit.**
  ```sh
  git add package.json lib/db.js tests/smoke.test.mjs tests/db.test.mjs
  git commit -m "Add a node:test runner and skip TLS for local databases"
  ```

---

### Task 2: Scripts to apply migrations and rebuild a local test database

**Model:** Opus
**Files:**
- Create: `scripts/db-apply.mjs`, `scripts/test-db.mjs`, `tests/helpers/db.mjs`
- Create, generated by Kevin in Step 7: `tests/fixtures/prod-schema.sql`
- Modify: `package.json` (scripts `db:apply`, `db:test`)
- Test: `tests/db-apply.test.mjs`, `tests/test-db.test.mjs`, `tests/integration/test-db.test.mjs`
- Local only, never committed: `.env.test.local` (already ignored by `.env*.local` in `.gitignore`)

**Interfaces:**
- Consumes:
  - `sslFor(connectionString)` from `lib/db.js` (Task 1).
  - `loadEnvFiles()` from `scripts/load-env.mjs` (unchanged by the audit). It returns the merged contents of
    `.env` then `.env.local`, read from `process.cwd()`.
- Produces:
  - `scripts/db-apply.mjs`:
    - `export function directUrlFrom(databaseUrl: string): string`: removes a trailing `-pooler` from the
      first host label and returns `URL#href`. Any other URL comes back unchanged.
    - `export function isPoolerUrl(connectionString: string): boolean`
    - `export function describeTarget(connectionString: string): string`: `host[:port]/database`, never the user
      or the password.
    - `export function parseArgs(argv: string[]): { files: string[], urlEnv: string | null, yes: boolean }`. It
      throws an `Error` whose message is followed by the usage text.
    - `export function resolveTargetUrl({ urlEnv }, env): string`: returns `env[urlEnv]` as given, or else
      `directUrlFrom(env.DATABASE_URL)`. It throws when the variable is unset or when the result is a pooler host.
    - `export async function applySqlFiles(connectionString: string, files: string[], { log = console.log } = {}): Promise<void>`
    - CLI: `npm run db:apply -- [--url-env NAME] [--yes] <file.sql>...`. Every option, `--yes` included, goes
      after the `--`. Without `--url-env` it reads `DATABASE_URL` from the environment, then `.env` and
      `.env.local` in the current directory, strips `-pooler` itself, and prints `Target: <host>/<db>`.
  - `scripts/test-db.mjs`:
    - `export const FIXTURE` (absolute path of `tests/fixtures/prod-schema.sql`), `export const TEST_ENV_FILE`
      (absolute path of `.env.test.local`)
    - `export function majorFromVersionNum(value: string | number): number`
    - `export function cleanDump(sql: string): string`
    - `export function pgEnvFromUrl(connectionString: string): { PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE }`
    - `export function assertResettable(connectionString: string): string`: returns the database name
    - `export function migrationFiles({ from = 5 } = {}): string[]`: absolute paths of `sql/NNN_*.sql` with
      `NNN >= from`, in filename order
    - `export function loadTestEnv(): void`
    - `export async function resetTestDatabase({ url, applyMigrations = true, log = () => {} }): Promise<number>`:
      returns the number of migrations applied
    - `export async function dumpSchema({ env, log = console.log }): Promise<void>`
    - CLI: `npm run db:test -- dump-schema` and `npm run db:test -- reset`
  - `tests/helpers/db.mjs`:
    - `export function testDb(): { skip: false | string, pool: pg.Pool | null, resetSchema({ applyMigrations = true } = {}): Promise<number>, close(): Promise<void> }`.
      It returns one shared object per process and never throws, so call it at module top level. The usage
      pattern for every integration test in this plan:
      ```js
      const db = testDb();
      describe("…", { skip: db.skip }, () => {
        before(() => db.resetSchema());
        after(() => db.close());
        test("…", async () => { await db.pool.query("…"); });
      });
      ```
    - `resetSchema()` rebuilds the `public` schema in place from `tests/fixtures/prod-schema.sql`, then applies
      every `sql/005`-and-later file. It does not drop the database, because that would end every open
      connection, including a `db.pool` a test captured before calling it. The describe-level
      `{ skip: db.skip }` also stops the suite's hooks, which a per-test `t.skip()` would not (checked on Node
      24.13.1).
    - **Production guard.** Importing the module throws
      `Error("Refusing to run integration tests: DATABASE_URL points at a remote database")` when
      `process.env.DATABASE_URL` is set and `sslFor(process.env.DATABASE_URL) !== false`. An integration test
      that reaches lib code's `getDbPool()` sets `process.env.DATABASE_URL = process.env.TEST_DATABASE_URL`
      itself, in its module body after the imports; a local URL passes the guard.

- [ ] **Step 1: Write the failing tests.**

  `tests/db-apply.test.mjs` (pure functions, and the CLI's refusals; no network):
  ```js
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
  ```

  `tests/test-db.test.mjs` (the `scripts/test-db.mjs` helpers and the `tests/helpers/db.mjs` guard; no database):
  ```js
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
  ```

  `tests/integration/test-db.test.mjs`:
  ```js
  import { after, before, describe, test } from "node:test";
  import assert from "node:assert/strict";
  import fs from "node:fs";
  import os from "node:os";
  import path from "node:path";
  import pg from "pg";
  import { applySqlFiles } from "../../scripts/db-apply.mjs";
  import { resetTestDatabase } from "../../scripts/test-db.mjs";
  import { testDb } from "../helpers/db.mjs";

  const db = testDb();
  const quiet = { log: () => {} };

  describe("test database reset", { skip: db.skip }, () => {
    let dir;
    const sqlFile = (name, text) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, text);
      return file;
    };

    before(async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "kw-sql-"));
      await db.resetSchema();
    });
    after(async () => {
      await db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("the fixture creates production's tables and the media_kind enum", async () => {
      const { rows } = await db.pool.query(
        "select table_name from information_schema.tables where table_schema = 'public'"
      );
      const names = rows.map((row) => row.table_name);
      for (const table of ["instagram_media", "instagram_posts", "integration_tokens", "job_locks"]) {
        assert.ok(names.includes(table), table);
      }
      const { rowCount } = await db.pool.query("select 1 from pg_type where typname = 'media_kind'");
      assert.equal(rowCount, 1);
    });

    test("resetSchema empties the tables and leaves the pool usable", async () => {
      await db.pool.query("insert into job_locks (name) values ('reset-check')");
      await db.resetSchema();
      const { rows } = await db.pool.query("select count(*)::int as n from job_locks");
      assert.equal(rows[0].n, 0);
    });

    test("resetTestDatabase creates a missing kw_test database", async () => {
      const url = new URL(process.env.TEST_DATABASE_URL);
      url.pathname = "/kw_test_created";
      const admin = new URL(process.env.TEST_DATABASE_URL);
      admin.pathname = "/postgres";
      const client = new pg.Client({ connectionString: admin.href, ssl: false });
      await client.connect();
      try {
        await client.query('drop database if exists "kw_test_created"');
        await resetTestDatabase({ url: url.href, applyMigrations: false });
        const { rowCount } = await client.query("select 1 from pg_database where datname = 'kw_test_created'");
        assert.equal(rowCount, 1);
      } finally {
        await client.query('drop database if exists "kw_test_created" with (force)');
        await client.end();
      }
    });

    test("each file runs on its own connection, so one file's search_path does not leak", async () => {
      const clear = sqlFile("a.sql", "select pg_catalog.set_config('search_path', '', false);");
      const unqualified = sqlFile("b.sql", "select count(*) from integration_tokens;");
      await assert.doesNotReject(
        applySqlFiles(process.env.TEST_DATABASE_URL, [clear, unqualified], quiet)
      );
    });

    test("a failing file names itself and rolls back", async () => {
      const bad = sqlFile("bad.sql", "create table t_partial (x int);\nselect 1/0;");
      await assert.rejects(
        applySqlFiles(process.env.TEST_DATABASE_URL, [bad], quiet),
        /bad\.sql: division by zero/
      );
      const { rows } = await db.pool.query("select to_regclass('public.t_partial') as t");
      assert.equal(rows[0].t, null);
    });
  });
  ```

- [ ] **Step 2: Run them to verify they fail.**
  ```sh
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/db-apply.test.mjs tests/test-db.test.mjs tests/integration/test-db.test.mjs 2>&1 | grep -E "^(✖|ℹ (tests|pass|fail|cancelled))|ERR_MODULE_NOT_FOUND"
  ```
  Expected: each of the three files fails to load with `ERR_MODULE_NOT_FOUND` for `scripts/db-apply.mjs` or
  `scripts/test-db.mjs`, and the summary shows `ℹ tests 3`, `ℹ pass 0`, `ℹ fail 3`, `ℹ cancelled 0`.

- [ ] **Step 3: Implement `scripts/db-apply.mjs`.** It is plain ESM. It imports `pg`, `sslFor` from `../lib/db.js`
  and `loadEnvFiles` from `./load-env.mjs`. `ROOT` is `fileURLToPath(new URL("..", import.meta.url))`.
  - **The pooler test:** `isPoolerUrl` is `/^[^.]+-pooler\./.test(new URL(s).hostname)`. `directUrlFrom` sets
    `url.hostname = url.hostname.replace(/^([^.]+)-pooler\./, "$1.")` and returns `url.href`.
  - **`describeTarget`:** `${hostname}${port ? ":" + port : ""}/${decodeURIComponent(pathname.slice(1))}`.
  - **`parseArgs` error messages**, each followed by `\n` and `USAGE`, which is these two lines:
    ```text
    Usage: npm run db:apply -- [--url-env NAME] [--yes] <file.sql>...
    Put --yes after the --. npm keeps a --yes placed before it, so the script never sees it.
    ```
    The messages:
    - `Unknown option <arg>`
    - `--url-env needs a variable name` (the next argument is missing or starts with `--`)
    - `Not an .sql file: <arg>`
    - `No .sql files given`
  - **`resolveTargetUrl` error messages:**
    - `<NAME> is not set`
    - ``Refusing <describeTarget>: a -pooler host runs in transaction mode; migrations need the direct host``
  - **`applySqlFiles`.** One fresh client per file, by design:
    - pg_dump's output runs `set_config('search_path', '', false)` for the rest of its session.
    - A failed `begin; … commit;` file leaves its connection in an aborted transaction (`25P02`).

    Both were checked against Postgres 16.
    ```js
    for (const file of files) {
      const sql = fs.readFileSync(file, "utf8");
      const name = path.relative(ROOT, path.resolve(file));
      const client = new pg.Client({ connectionString, ssl: sslFor(connectionString) });
      await client.connect();
      try {
        // No parameters, so pg uses the simple-query protocol: a file's statements run as one implicit
        // transaction (or in the file's own begin/commit) and a failure rolls the file back.
        await client.query(sql);
      } catch (err) {
        throw new Error(`${name}: ${err.message}`, { cause: err });
      } finally {
        await client.end();
      }
      log(`applied ${name}`);
    }
    ```
  - **CLI**, guarded by `if (import.meta.main)` (available since Node 24.2):
    1. `parseArgs(process.argv.slice(2))`. On error, print the message to stderr and exit 1.
    2. `env = { ...loadEnvFiles(), ...process.env }`. The real environment wins, as in `requireEnv`.
    3. `url = resolveTargetUrl(args, env)`. On error, print to stderr and exit 1.
    4. Print to stdout `Target: <describeTarget(url)>`, then `Files:  <files joined by ", ">`.
    5. If `sslFor(url) !== false && !args.yes`: print ``Not a local database. Re-run with --yes (after `--`) to
       apply.`` to stderr and exit 1. npm keeps a `--yes` that comes before the `--` for itself, so the script
       never sees it. Refusing is the safe result of that mistake.
    6. `await applySqlFiles(url, args.files)`. On error, print `err.message` to stderr and exit 1.

- [ ] **Step 4: Implement `scripts/test-db.mjs`.** It imports `pg`, `sslFor`, `loadEnvFiles`, and
  `applySqlFiles`, `describeTarget` and `resolveTargetUrl` from `./db-apply.mjs`.
  - **`majorFromVersionNum`:** `Number(value)` must be an integer of at least 100000; otherwise throw
    `Unexpected server_version_num: <value>`. Return `Math.floor(n / 10000)`.
  - **`cleanDump`:** split on `\n` and drop exactly these lines. Every other line is kept byte for byte.
    - `/^\\(restrict|unrestrict) /`. Current pg_dump releases (checked: 16.14 and 18.6) write these psql
      meta-commands with a random key. `pg` cannot run them, and they would make every dump differ.
    - `/^SET transaction_timeout = /`. pg_dump 17+ writes it, and a 16 server rejects it.
    - The exact line `CREATE SCHEMA public;`. `--schema=public` makes pg_dump emit it (checked), and
      `resetTestDatabase` creates the schema itself.
  - **`pgEnvFromUrl`:** `PGPORT` defaults to `"5432"`. User, password and database name are
    `decodeURIComponent`-decoded.
  - **`assertResettable`:** the URL must be local (`sslFor(url) === false`). Otherwise throw
    `Refusing to reset <describeTarget>: not a local database`. The database name must match
    `/^kw_test[a-z0-9_]*$/`. Otherwise throw `Refusing to reset <describeTarget>: the database name must start
    with kw_test and use only a-z, 0-9 and _`. The pattern also keeps the name safe to quote in `create database`.
  - **`migrationFiles`:** file names that match `/^\d{3}_.+\.sql$/` with a numeric prefix `>= from`, sorted.
  - **`loadTestEnv`:** `if (!process.env.TEST_DATABASE_URL && fs.existsSync(TEST_ENV_FILE))
    process.loadEnvFile(TEST_ENV_FILE)`. `process.loadEnvFile` never overrides a variable that is already set
    (checked).
  - **`resetTestDatabase`:**
    ```js
    const db = assertResettable(url);
    const adminUrl = new URL(url);
    adminUrl.pathname = "/postgres";
    // 1. Create the database if it is missing (a container started without POSTGRES_DB).
    //    admin = new pg.Client({ connectionString: adminUrl.href, ssl: false })
    //    "select 1 from pg_database where datname = $1", [db]  ->  if none: `create database "${db}"`
    // 2. Rebuild public in place on a fresh client to `url` (ssl: false), so open pools stay usable:
    //    "set lock_timeout = '5s'; drop schema if exists public cascade; create schema public;"
    // 3. Load the fixture and the migrations, each file on its own connection:
    const migrations = applyMigrations ? migrationFiles() : [];
    await applySqlFiles(url, [FIXTURE, ...migrations], { log });
    return migrations.length;
    ```
  - **`dumpSchema({ env, log })`:**
    1. `url = resolveTargetUrl({ urlEnv: null }, env)`. This derives the direct host and refuses a pooler.
    2. Read `show server_version_num` over a `pg.Client` with `ssl: sslFor(url)`, and compute
       `major = majorFromVersionNum(num)`.
    3. Log ``Reading the schema of ${describeTarget(url)} (server_version_num ${num}) with postgres:${major}``.
    4. Run pg_dump from the matching image. The URL never appears in any argv: libpq reads its parts from
       environment variables, which `docker -e NAME` copies by name. The postgres images carry no CA bundle, so
       macOS's `/etc/ssl/cert.pem` is mounted for `verify-full`. Checked: the mount works, and the bundle holds
       ISRG Root X1, which signs Neon's certificates. The call:
       ```js
       spawnSync("docker", [
         "run", "--rm",
         "-v", "/etc/ssl/cert.pem:/etc/ssl/certs/host-ca.pem:ro",
         "-e", "PGHOST", "-e", "PGPORT", "-e", "PGUSER", "-e", "PGPASSWORD", "-e", "PGDATABASE",
         "-e", "PGSSLMODE", "-e", "PGSSLROOTCERT",
         `postgres:${major}`,
         "pg_dump", "--schema-only", "--no-owner", "--no-privileges", "--schema=public",
       ], {
         env: { ...process.env, ...pgEnvFromUrl(url), PGSSLMODE: "verify-full", PGSSLROOTCERT: "/etc/ssl/certs/host-ca.pem" },
         encoding: "utf8",
         maxBuffer: 64 * 1024 * 1024,
       });
       ```
       If `result.error` is set, throw it. If `status !== 0`, throw `pg_dump failed:\n<stderr>`. pg_dump's
       stderr never contains the password.
    5. Create the directory first with `fs.mkdirSync(path.dirname(FIXTURE), { recursive: true })`: nothing
       else creates `tests/fixtures/`, and git does not keep an empty folder. Then write `cleanDump(stdout)` to
       `FIXTURE` and log ``wrote tests/fixtures/prod-schema.sql (<n> lines)``.

    `--schema=public` keeps Neon's own schemas and extensions out of the fixture.
  - **CLI**, guarded by `if (import.meta.main)`. Errors print `err.message` to stderr and exit 1.
    - Anything other than exactly one argument, `dump-schema` or `reset`: print
      `Usage: npm run db:test -- dump-schema | reset` and exit 1.
    - `dump-schema`: `dumpSchema({ env: { ...loadEnvFiles(), ...process.env } })`.
    - `reset`:
      1. Call `loadTestEnv()`. If `TEST_DATABASE_URL` is still unset, print
         `TEST_DATABASE_URL is not set (looked in the environment and .env.test.local)` and exit 1.
      2. Call `resetTestDatabase({ url })`.
      3. Print ``reset <describeTarget>: loaded tests/fixtures/prod-schema.sql, applied <n> migrations``.

- [ ] **Step 5: Implement `tests/helpers/db.mjs`.** This is exact copy, because every later integration test relies
  on these semantics:
  ```js
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
  ```

- [ ] **Step 6: Add the npm scripts and run the unit tests.** In `package.json` `scripts`, after
  `"test:integration"`:
  ```json
  "db:apply": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/db-apply.mjs",
  "db:test": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-db.mjs",
  ```
  ```sh
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/db-apply.test.mjs tests/test-db.test.mjs tests/integration/test-db.test.mjs 2>&1 | grep -E "^(✖|﹣|ℹ (tests|pass|fail|cancelled))"
  ```
  Expected: `﹣ test database reset # TEST_DATABASE_URL is not set`, then `ℹ tests 16`, `ℹ pass 16`, `ℹ fail 0`
  and `ℹ cancelled 0`.

- [ ] **Step 7: Kevin: dump production's schema (read-only).** This needs production's `DATABASE_URL`, which only
  the main checkout's `.env` holds. `--env-file` loads it into this one process, so nothing secret is typed,
  pasted or left in the shell. Kevin runs it in his own terminal:
  ```sh
  cd /Users/Kevin/Git/kevinwong.co/.claude/worktrees/spotify-refresh-token-expiry-e0a699
  nvm use --silent
  node --env-file=/Users/Kevin/Git/kevinwong.co/.env --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-db.mjs dump-schema
  ```
  Expected output:
  - pg prints a one-time `Warning: SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are
    treated as aliases for 'verify-full'…`. It is harmless: the connection verifies.
  - `Reading the schema of ep-<id>.c-4.us-east-1.aws.neon.tech/<db> (server_version_num NNNNNN) with
    postgres:<major>`
  - `wrote tests/fixtures/prod-schema.sql (<n> lines)`

  If Docker lacks that image, it first pulls `postgres:<major>` from Docker Hub (about 150 MB).

- [ ] **Step 8: Check the fixture.**
  ```sh
  sed -n 's/^-- Dumped from database version \([0-9]*\).*/\1/p' tests/fixtures/prod-schema.sql   # the major, e.g. 17
  grep -o '^CREATE TABLE public\.[a-z_]*' tests/fixtures/prod-schema.sql   # includes instagram_media, instagram_posts, integration_tokens, job_locks
  grep -c '^CREATE TYPE public\.media_kind' tests/fixtures/prod-schema.sql   # 1
  grep -cE 'sync_runs|admin_audit_log|refresh_token|auth_user' tests/fixtures/prod-schema.sql   # 0: production has none of 005-007 yet
  grep -nE '^\\|^CREATE SCHEMA public;$|transaction_timeout|npg_|postgres(ql)?://|PASSWORD' tests/fixtures/prod-schema.sql   # prints nothing
  ```
  If the last command prints anything, stop: the fixture must hold no secrets and no psql meta-commands.

- [ ] **Step 9: Start the throwaway Postgres and write `.env.test.local`.** First check that the port and the name
  are free. Both commands must print nothing:
  ```sh
  lsof -nP -iTCP:55432 -sTCP:LISTEN 2>/dev/null; docker ps -a --filter name=kw-test-pg --format '{{.Names}}'
  ```
  If `kw-test-pg` already exists, run `docker start kw-test-pg`. If this worktree has no `.env.test.local`, copy
  it from the checkout that created the container (the main checkout or another worktree under
  `.claude/worktrees/`; its password exists nowhere else). If there is no copy, stop and ask Kevin, and never
  read the password from `docker inspect`. Then skip to Step 10. If `.env.test.local` exists
  without the container, delete that file first: it holds the password of a container that is gone. Otherwise,
  in one Bash call, so the generated password never leaves the shell:
  ```sh
  MAJOR=$(sed -n 's/^-- Dumped from database version \([0-9]*\).*/\1/p' tests/fixtures/prod-schema.sql) && \
  test -n "$MAJOR" && \
  export POSTGRES_PASSWORD="$(openssl rand -hex 16)" && \
  printf 'TEST_DATABASE_URL=postgres://postgres:%s@127.0.0.1:55432/kw_test\n' "$POSTGRES_PASSWORD" > .env.test.local && \
  docker run -d --name kw-test-pg -e POSTGRES_PASSWORD -e POSTGRES_DB=kw_test -p 127.0.0.1:55432:5432 "postgres:$MAJOR" -c timezone=UTC && \
  unset POSTGRES_PASSWORD && \
  docker exec kw-test-pg sh -c 'until pg_isready -h 127.0.0.1 -U postgres -q; do sleep 1; done' && \
  git check-ignore .env.test.local
  ```
  Expected: a container id, then `.env.test.local`. A few details:
  - The file is written before the container starts. With zsh's `noclobber`, an existing file stops the chain
    before anything runs.
  - `-e POSTGRES_PASSWORD` with no value copies the variable by name, so the password is in no argv.
  - The port is bound to 127.0.0.1 only.
  - `-c timezone=UTC` makes UTC the server's default, so every test session runs in UTC whatever the container's
    `TZ` (checked on `postgres:16`). The integration tests assume a UTC session: `interval 'N days'` on a
    `timestamptz` is calendar arithmetic in the session zone, so a zone with a DST change inside the window
    shifts Task 14's 30-day limit by an hour. Production (Neon) is UTC too. To check a container, new or
    reused: `docker exec kw-test-pg psql -U postgres -tAc 'show timezone'` prints `UTC`.
  - Never commit `.env.test.local` and never print it.

- [ ] **Step 10: Rebuild the test database and run every test.**
  ```sh
  npm run db:test -- reset && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/db-apply.test.mjs tests/test-db.test.mjs tests/integration/test-db.test.mjs 2>&1 | grep -E "^(✖|﹣|ℹ (tests|pass|fail|cancelled))"
  npm test 2>&1 | grep -E "^(✖|﹣|ℹ (fail|cancelled))"
  ```
  Expected:
  - `reset 127.0.0.1:55432/kw_test: loaded tests/fixtures/prod-schema.sql, applied 0 migrations`
  - `ℹ tests 21`, `ℹ pass 21`, `ℹ fail 0`, `ℹ cancelled 0`, and no `﹣` line
  - `npm test`: only `ℹ fail 0` and `ℹ cancelled 0`

  The helper reads `.env.test.local` itself, so the integration suite now runs.

  If the reset fails with `function … does not exist` or `type … does not exist`, production's tables use an
  extension, and `--schema=public` left it out. Add `"--extension=<name>"` to the pg_dump arguments, and Kevin
  repeats Step 7.

- [ ] **Step 11: Lint and commit.**
  ```sh
  npx eslint .       # prints nothing
  git add package.json scripts/db-apply.mjs scripts/test-db.mjs tests/helpers/db.mjs tests/fixtures/prod-schema.sql \
    tests/db-apply.test.mjs tests/test-db.test.mjs tests/integration/test-db.test.mjs
  git status --short                     # .env.test.local must not appear
  git commit -m "Add scripts to apply migrations and rebuild a local test database"
  ```

---

### Task 3: Migrations 005 and 006, with an apply-twice integration test

**Model:** Opus
**Files:**
- Create: `sql/005_integration_tokens_spotify.sql`, `sql/006_sync_runs.sql`
- Test: `tests/integration/migrations-005-006.test.mjs`, `tests/sql-files.test.mjs`

**Interfaces:**
- Consumes (Task 2):
  - `applySqlFiles(connectionString, files, { log })`
  - `migrationFiles()`
  - `testDb()` → `{ skip, pool, resetSchema({ applyMigrations }), close() }`
  - The `kw-test-pg` container and `.env.test.local`
- Produces (later tasks rely on these exact names):
  - `integration_tokens` gains these columns, all nullable with no default:
    - `refresh_token text`
    - `authorized_at timestamptz`
    - `account_id text`
    - `scopes text` (space-separated)
  - `integration_tokens.access_token` becomes nullable. The CHECK `integration_tokens_has_token` requires
    `access_token is not null or refresh_token is not null`, and a violation is SQLSTATE `23514`.
  - Table `sync_runs`:
    - `id bigint` identity primary key (pg returns it as a string; lib code maps it with `Number()`)
    - `job text not null`
    - `trigger text not null`, constraint `sync_runs_trigger_check`: `cron`, `panel`, `cli`
    - `dry_run boolean not null`
    - `status text not null default 'running'`, constraint `sync_runs_status_check`: `running`, `ok`, `partial`,
      `skipped`, `failed`, `reauth_required`, `abandoned`
    - `started_at timestamptz not null default now()`, `finished_at timestamptz`
    - Counts, each `integer not null default 0`: `fetched`, `imported`, `uploads`, `deferred`, `skipped`,
      `error_count`
    - `error text`, `summary jsonb`
    - Index `sync_runs_job_started_at_idx` on `(job, started_at desc)`
  - Table `admin_audit_log`:
    - `id bigint` identity primary key (a string from pg, like `sync_runs.id`)
    - `at timestamptz not null default now()`
    - `event text not null` (no CHECK on the event names)
    - `actor text`
    - `details jsonb not null default '{}'::jsonb`
    - Index `admin_audit_log_at_idx` on `(at desc)`
  - `trigger`, `at` and `event` are unreserved keywords in Postgres (`kwlist.h`), so they need no quoting.
  - `tests/sql-files.test.mjs` holds every later migration (`007` included) to two rules: the file opens with a
    `-- ` comment, and a file with an `alter table` runs inside `begin;` / `set local lock_timeout = '5s';` /
    `commit;`. `migrationFiles()`, and so `resetSchema()`, picks up each new `sql/NNN_*.sql` file automatically.

- [ ] **Step 1: Write the failing tests.**

  `tests/sql-files.test.mjs` guards 005 and every later migration. It passes trivially until 005 exists:
  ```js
  import test from "node:test";
  import assert from "node:assert/strict";
  import fs from "node:fs";
  import path from "node:path";
  import { migrationFiles } from "../scripts/test-db.mjs";

  test("every migration from 005 that alters a table does it in one transaction with a lock timeout", () => {
    for (const file of migrationFiles()) {
      const sql = fs.readFileSync(file, "utf8");
      if (!/^\s*alter table/im.test(sql)) continue;
      const name = path.basename(file);
      assert.match(sql, /^begin;$/m, name);
      assert.match(sql, /^set local lock_timeout = '5s';$/m, name);
      assert.match(sql, /^commit;$/m, name);
    }
  });

  test("every migration from 005 opens with a comment block", () => {
    for (const file of migrationFiles()) {
      assert.match(fs.readFileSync(file, "utf8"), /^-- /, path.basename(file));
    }
  });
  ```

  `tests/integration/migrations-005-006.test.mjs`:
  ```js
  import { after, before, describe, test } from "node:test";
  import assert from "node:assert/strict";
  import { fileURLToPath } from "node:url";
  import { applySqlFiles } from "../../scripts/db-apply.mjs";
  import { testDb } from "../helpers/db.mjs";

  const db = testDb();
  const M005 = fileURLToPath(new URL("../../sql/005_integration_tokens_spotify.sql", import.meta.url));
  const M006 = fileURLToPath(new URL("../../sql/006_sync_runs.sql", import.meta.url));
  const quiet = { log: () => {} };
  const CHECK_FAILED = { code: "23514", constraint: "integration_tokens_has_token" };

  describe("migrations 005 and 006", { skip: db.skip }, () => {
    before(async () => {
      await db.resetSchema({ applyMigrations: false });
      await db.pool.query(
        `insert into integration_tokens (provider, access_token, expires_at)
         values ('instagram', 'IGQ-test-token', '2026-12-01T00:00:00Z')`
      );
      await applySqlFiles(process.env.TEST_DATABASE_URL, [M005, M006], quiet);
    });
    after(() => db.close());

    test("apply a second time without error", async () => {
      await assert.doesNotReject(applySqlFiles(process.env.TEST_DATABASE_URL, [M005, M006], quiet));
    });

    test("leave the existing instagram row as it was", async () => {
      const { rows } = await db.pool.query(
        `select provider, access_token, expires_at, expires_at_is_assumed, dead_reason,
                refresh_token, authorized_at, account_id, scopes
           from integration_tokens`
      );
      assert.deepEqual(rows, [
        {
          provider: "instagram",
          access_token: "IGQ-test-token",
          expires_at: new Date("2026-12-01T00:00:00Z"),
          expires_at_is_assumed: false,
          dead_reason: null,
          refresh_token: null,
          authorized_at: null,
          account_id: null,
          scopes: null,
        },
      ]);
    });

    test("make access_token nullable, so a row with only a refresh token fits", async () => {
      const { rows } = await db.pool.query(
        `select is_nullable from information_schema.columns
          where table_name = 'integration_tokens' and column_name = 'access_token'`
      );
      assert.equal(rows[0].is_nullable, "YES");
      await db.pool.query(
        `insert into integration_tokens (provider, refresh_token, expires_at)
         values ('spotify', 'AQ-test-refresh', now() + interval '180 days')`
      );
      await db.pool.query("delete from integration_tokens where provider = 'spotify'");
    });

    test("reject a row with neither token", async () => {
      await assert.rejects(
        db.pool.query("insert into integration_tokens (provider, expires_at) values ('neither', now())"),
        CHECK_FAILED
      );
      await assert.rejects(
        db.pool.query("update integration_tokens set access_token = null where provider = 'instagram'"),
        CHECK_FAILED
      );
    });

    test("give sync_runs its defaults", async () => {
      const { rows } = await db.pool.query(
        `insert into sync_runs (job, trigger, dry_run) values ('instagram', 'cron', false)
         returning status, fetched, imported, uploads, deferred, skipped, error_count,
                   finished_at, error, summary, started_at <= now() as started`
      );
      assert.deepEqual(rows[0], {
        status: "running",
        fetched: 0,
        imported: 0,
        uploads: 0,
        deferred: 0,
        skipped: 0,
        error_count: 0,
        finished_at: null,
        error: null,
        summary: null,
        started: true,
      });
    });

    test("limit sync_runs.trigger and sync_runs.status to the known values", async () => {
      const insert = "insert into sync_runs (job, trigger, dry_run, status) values ('instagram', $1, true, $2)";
      for (const trigger of ["cron", "panel", "cli"]) await db.pool.query(insert, [trigger, "ok"]);
      for (const status of ["running", "ok", "partial", "skipped", "failed", "reauth_required", "abandoned"]) {
        await db.pool.query(insert, ["cli", status]);
      }
      await assert.rejects(db.pool.query(insert, ["web", "ok"]), {
        code: "23514",
        constraint: "sync_runs_trigger_check",
      });
      await assert.rejects(db.pool.query(insert, ["cron", "done"]), {
        code: "23514",
        constraint: "sync_runs_status_check",
      });
    });

    test("generate ids and refuse explicit ones", async () => {
      await assert.rejects(
        db.pool.query("insert into sync_runs (id, job, trigger, dry_run) values (1, 'instagram', 'cron', false)"),
        { code: "428C9" }
      );
      await assert.rejects(
        db.pool.query("insert into admin_audit_log (id, event) values (1, 'sign_in')"),
        { code: "428C9" }
      );
    });

    test("give admin_audit_log its defaults", async () => {
      const { rows } = await db.pool.query(
        "insert into admin_audit_log (event) values ('sign_in') returning actor, details, at <= now() as stamped"
      );
      assert.deepEqual(rows[0], { actor: null, details: {}, stamped: true });
    });

    test("create both indexes", async () => {
      const { rows } = await db.pool.query(
        `select indexname, indexdef from pg_indexes
          where indexname in ('sync_runs_job_started_at_idx', 'admin_audit_log_at_idx')
          order by indexname`
      );
      assert.deepEqual(
        rows.map((row) => row.indexname),
        ["admin_audit_log_at_idx", "sync_runs_job_started_at_idx"]
      );
      assert.match(rows[0].indexdef, /\(at DESC\)/);
      assert.match(rows[1].indexdef, /\(job, started_at DESC\)/);
    });
  });
  ```

- [ ] **Step 2: Run them to verify they fail.**
  ```sh
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/sql-files.test.mjs tests/integration/migrations-005-006.test.mjs 2>&1 | grep -E "^(✖|ℹ (tests|pass|fail|cancelled))|ENOENT"
  ```
  Expected:
  - `✖ migrations 005 and 006`, with `ENOENT: no such file or directory, open
    '…/sql/005_integration_tokens_spotify.sql'` from its `before` hook
  - `ℹ tests 11`, `ℹ pass 2`, `ℹ fail 0`, `ℹ cancelled 9`. The two `sql-files` tests pass because no `sql/005`
    exists yet; the cancellations are the failure signal.

- [ ] **Step 3: Write `sql/005_integration_tokens_spotify.sql`** (exact copy):
  ```sql
  -- Spotify's credential moves from the refresh_token env var into this table,
  -- so a reconnect from /admin takes effect without a redeploy (an env var is
  -- fixed for the life of a deployment; see 001).
  --
  -- Spotify's lasting credential is a refresh token. Its access tokens last an
  -- hour and are only cached in memory, so the spotify row has no access_token:
  -- that column becomes nullable, and a CHECK keeps every row holding at least
  -- one of the two tokens. The instagram row is untouched, and every Instagram
  -- reader filters on provider = 'instagram'.
  --
  --   refresh_token  Spotify's refresh token (the instagram row leaves it null).
  --   authorized_at  When the owner last clicked Approve. Spotify ends an
  --                  authorization 180 days after approval and refreshing does
  --                  not extend it, so the spotify row's expires_at is
  --                  authorized_at + 180 days with expires_at_is_assumed = true.
  --   account_id     The Spotify account that approved, checked against the
  --                  pinned owner account.
  --   scopes         The granted scopes, space-separated as Spotify returns them.
  --
  -- ADD CONSTRAINT has no IF NOT EXISTS, so the CHECK is dropped and added again,
  -- which keeps this file safe to run twice. The ALTERs need an ACCESS EXCLUSIVE
  -- lock, so, as in 003, fail fast rather than queue every reader behind them,
  -- with `set local` inside one transaction because of the pooler (see 004).
  --
  -- Safe to apply before the code that uses it: the deployed code only reads and
  -- writes the instagram row, which always has an access_token.
  begin;

  set local lock_timeout = '5s';

  alter table integration_tokens
    add column if not exists refresh_token text,
    add column if not exists authorized_at timestamptz,
    add column if not exists account_id    text,
    add column if not exists scopes        text;

  alter table integration_tokens
    alter column access_token drop not null;

  alter table integration_tokens
    drop constraint if exists integration_tokens_has_token;

  alter table integration_tokens
    add constraint integration_tokens_has_token
    check (access_token is not null or refresh_token is not null);

  commit;
  ```

- [ ] **Step 4: Write `sql/006_sync_runs.sql`** (exact copy):
  ```sql
  -- A record of every Instagram sync run, and of what is done through /admin.
  --
  -- The sync's only record used to be its logs, which the Hobby plan deletes
  -- after an hour. sync_runs keeps one row per run, from the cron, the panel or
  -- the CLI, so /admin can show the last run, recent errors, and the uploads
  -- spent over the last 30 days against Blob's hard monthly cap (uploads counts
  -- real Blob uploads; on a dry run it is what the run would have uploaded). A
  -- run killed mid-way never finishes its row, so the next run marks a 'running'
  -- row older than 15 minutes whose lease has expired as 'abandoned'. summary is
  -- the run's summary after redact() and a size cap (lib/redact.js), so it holds
  -- no tokens.
  --
  -- admin_audit_log records sign-ins, refused sign-ins, Spotify reconnects and
  -- panel runs, with redacted details.
  --
  -- New tables only, so no lock_timeout wrapper (as in 001 and 004). Additive;
  -- safe to apply at any time and to run twice.

  create table if not exists sync_runs (
    id          bigint      generated always as identity primary key,
    job         text        not null,
    trigger     text        not null check (trigger in ('cron', 'panel', 'cli')),
    dry_run     boolean     not null,
    status      text        not null default 'running'
                check (status in ('running', 'ok', 'partial', 'skipped', 'failed',
                                  'reauth_required', 'abandoned')),
    started_at  timestamptz not null default now(),
    finished_at timestamptz,
    fetched     integer     not null default 0,
    imported    integer     not null default 0,
    uploads     integer     not null default 0,
    deferred    integer     not null default 0,
    skipped     integer     not null default 0,
    error_count integer     not null default 0,
    error       text,
    summary     jsonb
  );

  create index if not exists sync_runs_job_started_at_idx
    on sync_runs (job, started_at desc);

  create table if not exists admin_audit_log (
    id      bigint      generated always as identity primary key,
    at      timestamptz not null default now(),
    event   text        not null,
    actor   text,
    details jsonb       not null default '{}'::jsonb
  );

  create index if not exists admin_audit_log_at_idx
    on admin_audit_log (at desc);
  ```

- [ ] **Step 5: Run the tests to verify they pass.**
  ```sh
  npm run db:test -- reset && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/sql-files.test.mjs tests/integration/migrations-005-006.test.mjs 2>&1 | grep -E "^(✖|﹣|ℹ (tests|pass|fail|cancelled))"
  ```
  Expected:
  - `reset 127.0.0.1:55432/kw_test: loaded tests/fixtures/prod-schema.sql, applied 2 migrations`
  - `ℹ tests 11`, `ℹ pass 11`, `ℹ fail 0`, `ℹ cancelled 0`

- [ ] **Step 6: Rehearse through the CLI, twice on the same database.** This is the `db:apply` path Kevin uses on
  production. `--url-env` reads only the real environment, so load `.env.test.local` into this one shell:
  ```sh
  set -a && . ./.env.test.local && set +a && \
  npm run db:test -- reset && \
  npm run db:apply -- --url-env TEST_DATABASE_URL sql/005_integration_tokens_spotify.sql sql/006_sync_runs.sql && \
  npm run db:apply -- --url-env TEST_DATABASE_URL sql/005_integration_tokens_spotify.sql sql/006_sync_runs.sql
  ```
  Expected: the `reset … applied 2 migrations` line. Then, twice, `Target: 127.0.0.1:55432/kw_test`, the
  `Files:` line, `applied sql/005_integration_tokens_spotify.sql` and `applied sql/006_sync_runs.sql`. Exit 0.
  That is three applications in all. Applying these to production is not part of this task: Kevin does it in
  Task 10, after a backup.

- [ ] **Step 7: Run the whole suite, lint and commit.**
  ```sh
  npm test 2>&1 | grep -E "^(✖|﹣|ℹ (fail|cancelled))"   # only ℹ fail 0 and ℹ cancelled 0
  npx eslint .                                          # prints nothing
  git add sql/005_integration_tokens_spotify.sql sql/006_sync_runs.sql tests/sql-files.test.mjs \
    tests/integration/migrations-005-006.test.mjs
  git commit -m "Add Spotify token columns, sync_runs and admin_audit_log"
  ```

---

### Task 4: `lib/redact.js`

**Model:** Opus
**Files:**
- Create: `lib/redact.js`
- Test: `tests/redact.test.mjs`

**Interfaces:**
- Consumes: nothing. The module has no imports.
- Produces:
  - `export function redact(value: unknown): unknown`. It returns a copy and never mutates its input.
    - **Strings:** every match of the four rules below is replaced, then a string longer than 500 characters
      is cut to its first 500 characters followed by `…`, and last any lone surrogate becomes U+FFFD
      (`toWellFormed()`), so every string it returns can be stored in a `jsonb` column.
    - **Query parameters:** every `access_token=`, `refresh_token=`, `client_secret=` and `token=` value is
      redacted. A `code=` value of 1 to 5 digits is kept, because it is a Graph API error code (`code=190`,
      `code=2`), not an OAuth code; any other `code=` value is redacted.
    - **Arrays and plain objects** (prototype `Object.prototype` or `null`) are copied recursively. Keys are kept,
      and an object already on the current path becomes `"[circular]"`.
    - **Every other value is returned as is,** including numbers, booleans, `null`, `undefined`, `Date` and
      `Error` instances. Callers pass `error.message`, not an `Error`.
  - `export function capJson(value: unknown, maxBytes = 16_000): unknown`.
    - It returns `value` itself when `JSON.stringify(value)` is `undefined`, or when the JSON's UTF-8 byte length
      is at most `maxBytes`.
    - Otherwise it returns `{ truncated: true, bytes, preview }`. `bytes` is that byte length, and `preview` is
      the first `Math.floor(maxBytes / 2)` characters of the JSON, passed through `toWellFormed()`.
    - Errors from `JSON.stringify`, such as a `BigInt`, propagate.
  - Used by Task 9 (`finishRun`: `summary = capJson(redact(summary))`, `error = redact(error)`) and Task 11
    (`logAdminEvent` in `lib/admin/audit-log.js` stores `redact(details)`). Task 9's stored error keeps its
    Graph error code, so its `/HTTP 500 code=2/` assertion holds.

- [ ] **Step 1: Write the failing test.** `tests/redact.test.mjs`:
  ```js
  import test from "node:test";
  import assert from "node:assert/strict";
  import { capJson, redact } from "../lib/redact.js";

  const FORTY = "A1b2C3d4E5".repeat(4);

  test("redact replaces the credential after Bearer", () => {
    assert.equal(redact("Authorization: Bearer BQDx-abc.123"), "Authorization: Bearer [redacted]");
    assert.equal(redact('{"authorization":"bearer abc"}'), '{"authorization":"bearer [redacted]"}');
  });

  for (const key of ["access_token", "refresh_token", "code", "client_secret", "token"]) {
    test(`redact replaces the value of the ${key} query parameter`, () => {
      assert.equal(
        redact(`https://example.test/cb?${key}=s3cr3t&state=ok`),
        `https://example.test/cb?${key}=[redacted]&state=ok`
      );
    });
  }

  test("redact handles a form body and leaves look-alike keys alone", () => {
    assert.equal(
      redact("grant_type=refresh_token&refresh_token=AQDshort"),
      "grant_type=refresh_token&refresh_token=[redacted]"
    );
    assert.equal(redact("error_code=190&id_token=abc"), "error_code=190&id_token=abc");
  });

  test("redact keeps short numeric error codes", () => {
    assert.equal(redact("HTTP 500 code=190 type=OAuthException"), "HTTP 500 code=190 type=OAuthException");
    assert.equal(redact("error?code=2&state=ok"), "error?code=2&state=ok");
    assert.equal(redact("x?code=AQDk3j_9xYz"), "x?code=[redacted]");
    assert.equal(redact("x?code=123456"), "x?code=[redacted]");
  });

  test("redact removes postgres and postgresql credentials", () => {
    assert.equal(
      redact("connect failed: postgresql://kw_owner:npg_pw123@db.example.test/neondb"),
      "connect failed: postgresql://[redacted]@db.example.test/neondb"
    );
    assert.equal(
      redact("postgres://postgres:pw@127.0.0.1:55432/kw_test"),
      "postgres://[redacted]@127.0.0.1:55432/kw_test"
    );
  });

  test("redact replaces any run of 40 or more token characters", () => {
    assert.equal(redact(`refreshed with ${FORTY} ok`), "refreshed with [redacted] ok");
    assert.equal(
      redact("Basic QmFzZTY0K3Rva2VuL3dpdGgrc2xhc2hlcy9hbmQ9cGFkZGluZw=="),
      "Basic [redacted]"
    );
  });

  test("redact leaves a 39-character run alone", () => {
    const thirtyNine = FORTY.slice(0, 39);
    assert.equal(redact(`id ${thirtyNine} ok`), `id ${thirtyNine} ok`);
  });

  test("redact also hides a long URL path (accepted over-redaction)", () => {
    assert.equal(
      redact("GET https://api.spotify.com/v1/me/player/currently-playing failed"),
      "GET https:[redacted] failed"
    );
  });

  test("redact copies nested objects and arrays without changing the input", () => {
    const input = { a: [{ b: "Bearer xyz" }, 42, null], c: { d: true } };
    const out = redact(input);
    assert.deepEqual(out, { a: [{ b: "Bearer [redacted]" }, 42, null], c: { d: true } });
    assert.equal(input.a[0].b, "Bearer xyz");
    assert.notEqual(out, input);
    assert.notEqual(out.a, input.a);
  });

  test("redact truncates strings over 500 characters with an ellipsis", () => {
    const exactly500 = "word ".repeat(100);
    assert.equal(redact(exactly500), exactly500);
    const long = "word ".repeat(120);
    const out = redact(long);
    assert.equal(out.length, 501);
    assert.equal(out, `${long.slice(0, 500)}…`);
  });

  test("redact redacts before truncating, so no fragment of a token survives the cut", () => {
    assert.equal(redact("word ".repeat(94) + "s".repeat(60)), "word ".repeat(94) + "[redacted]");
  });

  test("redact returns non-string values untouched", () => {
    const when = new Date(0);
    assert.equal(redact(42), 42);
    assert.equal(redact(true), true);
    assert.equal(redact(null), null);
    assert.equal(redact(undefined), undefined);
    assert.equal(redact(when), when);
    assert.deepEqual(redact({ n: 1, ok: false, when }), { n: 1, ok: false, when });
    assert.equal(redact({ when }).when, when);
  });

  test("redact marks a cycle and copies a shared reference twice", () => {
    const cyclic = { a: "x" };
    cyclic.self = cyclic;
    assert.deepEqual(redact(cyclic), { a: "x", self: "[circular]" });
    const shared = { k: "v" };
    assert.deepEqual(redact({ a: shared, b: shared }), { a: { k: "v" }, b: { k: "v" } });
  });

  test("capJson returns the same value when its JSON fits", () => {
    const value = { a: 1 };
    assert.equal(capJson(value), value);
    assert.equal(capJson("x".repeat(8), 10), "x".repeat(8));
    assert.equal(capJson(undefined), undefined);
  });

  test("capJson replaces an oversized value with a preview", () => {
    assert.deepEqual(capJson("x".repeat(8), 9), { truncated: true, bytes: 10, preview: '"xxx' });
    const out = capJson({ s: "a".repeat(20_000) });
    assert.equal(out.truncated, true);
    assert.equal(out.bytes, 20_008);
    assert.equal(out.preview.length, 8_000);
    assert.ok(out.preview.startsWith('{"s":"aaa'));
  });

  test("capJson measures UTF-8 bytes, not characters", () => {
    assert.deepEqual(capJson("é".repeat(10), 20), {
      truncated: true,
      bytes: 22,
      preview: `"${"é".repeat(9)}`,
    });
  });

  test("redact returns well-formed strings, even when the cut lands inside an emoji", () => {
    const cut = redact(`${"word ".repeat(99)}abcd😀 tail`); // the emoji straddles index 500
    assert.equal(cut.length, 501);
    assert.ok(cut.isWellFormed());
    // A caption sliced by UTF-16 units upstream (runSync's caption.slice(0, 80)) can end in half an emoji.
    assert.equal(redact("abcd\uD83D"), "abcd\uFFFD");
  });

  test("capJson's preview never ends in half an emoji", () => {
    const out = capJson(`${"a".repeat(7_998)}😀${"b".repeat(9_000)}`); // the JSON's 8,000th unit is the emoji's high half
    assert.equal(out.truncated, true);
    assert.ok(out.preview.isWellFormed());
  });
  ```

- [ ] **Step 2: Run it to verify it fails.**
  ```sh
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/redact.test.mjs 2>&1 | grep -E "ERR_MODULE_NOT_FOUND|^ℹ (tests|fail)"
  ```
  Expected: `ERR_MODULE_NOT_FOUND` for `lib/redact.js`, then `ℹ tests 1` and `ℹ fail 1`.

- [ ] **Step 3: Implement `redact(value)` and `capJson(value, maxBytes = 16_000)` in `lib/redact.js`.**

  The rules are exact copy. The order matters: the specific rules run first, so their key or scheme stays
  readable, and the catch-all runs last.
  ```js
  const MAX_STRING_LENGTH = 500;
  const REDACTED = "[redacted]";
  // A code= value of 1-5 digits is a Graph API error code (code=190, code=2), not an OAuth code: keep it.
  const redactParam = (match, key, value) =>
    key.toLowerCase() === "code" && /^\d{1,5}$/.test(value) ? match : `${key}=${REDACTED}`;
  const RULES = [
    [/\b(Bearer\s+)[^\s"',;]+/gi, `$1${REDACTED}`],
    [/\b(postgres(?:ql)?:\/\/)[^@\s/]+@/gi, `$1${REDACTED}@`],
    [/\b(access_token|refresh_token|client_secret|code|token)=([^&\s"']+)/gi, redactParam],
    [/[A-Za-z0-9_\-.~+/=]{40,}/g, REDACTED],
  ];
  ```
  How each part works:
  - **The `\b` before each key** keeps `error_code=` and `id_token=` untouched, because `_` is a word character.
  - **A short numeric `code=` stays.** `sync_runs.error` holds Graph errors like `HTTP 500 code=2 type=…`, and
    the code is what says what went wrong (the README and TODO name `100` and `190`). An OAuth `code` is never 5
    digits or fewer, so `code=AQDk3j_9xYz` and `code=123456` are still redacted. Apply each rule with
    `s.replace(pattern, replacement)`, which accepts the function as well as the strings.
  - **A string goes through every rule, then the truncation.** Redacting first means no fragment of a long token
    can survive the cut as a run shorter than 40 characters.
  - **The walk uses a `WeakSet` of the objects on the current path.** Add the object before recursing and delete
    it after. A shared but acyclic reference is therefore copied twice, not marked `[circular]`.
  - **`redact` keeps its one-parameter public signature;** the walk is an inner function.
  - **`capJson`** measures with `Buffer.byteLength(json, "utf8")`.
  - **Both return well-formed strings.** `redact` returns `s.toWellFormed()` for every string, after the cut, and `capJson`'s `preview` is `json.slice(0, Math.floor(maxBytes / 2)).toWellFormed()`. A cut by UTF-16 units can split an emoji, and so can `runSync`'s own `caption.slice(0, 80)` in the summary. `JSON.stringify` then writes the lone half as `\ud83d`, which Postgres rejects in `jsonb` (22P02), and `finishRun` or `logAdminEvent` would fail.

  Add a short header comment: this redacts what is stored (`sync_runs.error` and `summary`, and
  `admin_audit_log.details`), and it deliberately over-redacts. Any 40-character run of token characters goes,
  long URL paths included.

- [ ] **Step 4: Run the tests to verify they pass.**
  ```sh
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/redact.test.mjs 2>&1 | grep -E "^(✖|ℹ (tests|pass|fail|cancelled))"
  npm test 2>&1 | grep -E "^(✖|﹣|ℹ (fail|cancelled))"
  npx eslint .
  ```
  Expected:
  - First command: `ℹ tests 22`, `ℹ pass 22`, `ℹ fail 0`, `ℹ cancelled 0`.
  - `npm test`: only `ℹ fail 0` and `ℹ cancelled 0`.
  - ESLint prints nothing.

- [ ] **Step 5: Commit.**
  ```sh
  git add lib/redact.js tests/redact.test.mjs
  git commit -m "Add redact() and capJson() for stored errors and summaries"
  ```

---

### Task 5: Spotify token store (`lib/spotify-token.js`)

**Model:** Opus
**Files:**
- Create: `lib/spotify-token.js`
- Test: `tests/spotify-token.test.mjs` (unit tests with a fake `db`; these run without a database)
- Test: `tests/integration/spotify-token.test.mjs` (integration tests against the test database)

**Interfaces:**
- Consumes:
  - `lib/db.js`: `getDbPool()`. Task 1 made its `ssl` come from `sslFor`.
  - Task 3's `sql/005_integration_tokens_spotify.sql`. It adds these columns to `integration_tokens`:
    - `refresh_token text`
    - `authorized_at timestamptz`
    - `account_id text`
    - `scopes text`, space-separated
    It also makes `access_token` nullable and adds a CHECK that `access_token is not null or refresh_token is not null`.
  - Existing columns (from `sql/001` and `sql/002`):
    - `provider text primary key`
    - `expires_at timestamptz not null`
    - `refreshed_at timestamptz not null default now()`
    - `dead_reason text`
    - `created_at` and `updated_at`, both `timestamptz not null default now()`
    - `expires_at_is_assumed boolean not null default false`
  - No trigger maintains `updated_at`, so every UPDATE sets `updated_at = now()` itself.
  - Task 2's `tests/helpers/db.mjs`, which exports only `testDb()`. It returns one shared object per process:
    `{ skip: false | string, pool: pg.Pool | null, resetSchema({ applyMigrations = true } = {}): Promise<number>, close(): Promise<void> }`.
    - Usage: `const db = testDb();` at module top level, then `describe(name, { skip: db.skip }, () => { before(() => db.resetSchema()); after(() => db.close()); ... })`.
    - `resetSchema()` rebuilds `public` from `tests/fixtures/prod-schema.sql` and applies every `sql/005+` file. `db.pool` stays usable across it.
    - The tests pass `db.pool` to every store function as its `db` argument, so they never touch `DATABASE_URL`.
- Produces:
  - Every function takes an optional `db` as its last argument, defaulting to `getDbPool()`.
  - That default is evaluated at call time. A missing `DATABASE_URL` therefore rejects the returned promise; it never throws at import.
  - The exports:
    - `export const SPOTIFY_PROVIDER = "spotify"`
    - `export const SPOTIFY_SCOPES = Object.freeze(["user-read-currently-playing", "user-top-read", "user-read-recently-played"])`
    - `export const AUTHORIZATION_LIFETIME_DAYS = 180`
    - `export async function readSpotifyRow(db?): Promise<null | { refreshToken: string | null, deadReason: string | null, authorizedAt: Date | null, expiresAt: Date, accountId: string | null, scopes: string[] }>`
    - `export async function saveSpotifyAuthorization({ refreshToken, accountId, scopes }, db?): Promise<{ authorizedAt: Date, expiresAt: Date }>`
    - `export async function storeRotatedRefreshToken(previous, next, db?): Promise<boolean>`. It swaps on `previous` only and clears `dead_reason`, because Spotify has just accepted `previous` and issued `next`.
    - `export async function markSpotifyDead(reason, failedRefreshToken, db?): Promise<boolean>`
    - `export async function readSpotifyStatusRow(db?): Promise<null | { deadReason, authorizedAt, expiresAt, accountId, scopes: string[], updatedAt }>`

- [ ] **Step 1: Write the failing tests**

`tests/spotify-token.test.mjs`. These are unit tests: they need no database and pin the SQL's scoping and guards.

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import * as tokens from "../lib/spotify-token.js";

function fakeDb(result = { rows: [], rowCount: 0 }) {
  const calls = [];
  return { calls, query: async (text, params) => { calls.push({ text, params }); return result; } };
}

test("constants", () => {
  assert.equal(tokens.SPOTIFY_PROVIDER, "spotify");
  assert.deepEqual(tokens.SPOTIFY_SCOPES, ["user-read-currently-playing", "user-top-read", "user-read-recently-played"]);
  assert.ok(Object.isFrozen(tokens.SPOTIFY_SCOPES));
  assert.equal(tokens.AUTHORIZATION_LIFETIME_DAYS, 180);
});

test("every statement is scoped to provider spotify", async () => {
  const db = fakeDb({ rows: [{ authorized_at: new Date(0), expires_at: new Date(0) }], rowCount: 1 });
  await tokens.readSpotifyRow(db);
  await tokens.readSpotifyStatusRow(db);
  await tokens.saveSpotifyAuthorization({ refreshToken: "rt", accountId: "acct", scopes: ["a"] }, db);
  await tokens.storeRotatedRefreshToken("rt", "rt-2", db);
  await tokens.markSpotifyDead("invalid_grant", "rt", db);
  assert.equal(db.calls.length, 5);
  for (const { text, params } of db.calls) {
    assert.match(text, /provider/);
    assert.equal(params[0], "spotify");
  }
});

test("readSpotifyStatusRow never selects a token column", async () => {
  const db = fakeDb();
  assert.equal(await tokens.readSpotifyStatusRow(db), null);
  assert.doesNotMatch(db.calls[0].text, /refresh_token|access_token/);
});

test("writes without a token make no query and return false", async () => {
  const db = fakeDb({ rows: [], rowCount: 1 });
  assert.equal(await tokens.markSpotifyDead("invalid_grant", "", db), false);
  assert.equal(await tokens.markSpotifyDead("invalid_grant", undefined, db), false);
  assert.equal(await tokens.storeRotatedRefreshToken("", "next", db), false);
  assert.equal(await tokens.storeRotatedRefreshToken("prev", "", db), false);
  assert.equal(db.calls.length, 0);
});

test("compare-and-swap results come from rowCount", async () => {
  assert.equal(await tokens.markSpotifyDead("invalid_grant", "rt", fakeDb({ rows: [], rowCount: 0 })), false);
  assert.equal(await tokens.markSpotifyDead("invalid_grant", "rt", fakeDb({ rows: [], rowCount: 1 })), true);
  assert.equal(await tokens.storeRotatedRefreshToken("a", "b", fakeDb({ rows: [], rowCount: 0 })), false);
  assert.equal(await tokens.storeRotatedRefreshToken("a", "b", fakeDb({ rows: [], rowCount: 1 })), true);
});

test("saveSpotifyAuthorization refuses a missing refreshToken or accountId", async () => {
  const db = fakeDb();
  const message = "saveSpotifyAuthorization needs a refreshToken and an accountId";
  await assert.rejects(tokens.saveSpotifyAuthorization({ refreshToken: "", accountId: "acct", scopes: [] }, db), { message });
  await assert.rejects(tokens.saveSpotifyAuthorization({ refreshToken: "rt", accountId: "", scopes: [] }, db), { message });
  assert.equal(db.calls.length, 0);
});

test("saveSpotifyAuthorization sends space-joined scopes and the lifetime in days", async () => {
  const db = fakeDb({ rows: [{ authorized_at: new Date(0), expires_at: new Date(1) }], rowCount: 1 });
  assert.deepEqual(
    await tokens.saveSpotifyAuthorization({ refreshToken: "rt", accountId: "acct", scopes: ["a", "b"] }, db),
    { authorizedAt: new Date(0), expiresAt: new Date(1) }
  );
  assert.deepEqual(db.calls[0].params, ["spotify", "rt", "acct", "a b", 180]);
});
```

`tests/integration/spotify-token.test.mjs`:

```js
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "../helpers/db.mjs";
import {
  SPOTIFY_SCOPES, AUTHORIZATION_LIFETIME_DAYS, readSpotifyRow, saveSpotifyAuthorization,
  storeRotatedRefreshToken, markSpotifyDead, readSpotifyStatusRow,
} from "../../lib/spotify-token.js";

const DAY_MS = 86_400_000;
const db = testDb();

describe("lib/spotify-token.js against the test database", { skip: db.skip }, () => {
  const save = (refreshToken) =>
    saveSpotifyAuthorization({ refreshToken, accountId: "owner-1", scopes: SPOTIFY_SCOPES }, db.pool);
  const raw = async () => (await db.pool.query("select * from integration_tokens where provider = 'spotify'")).rows[0];
  const instagram = async () =>
    (await db.pool.query("select to_jsonb(t) as row from integration_tokens t where provider = 'instagram'")).rows[0].row;

  before(() => db.resetSchema());
  after(() => db.close());
  beforeEach(async () => {
    await db.pool.query("delete from integration_tokens");
    await db.pool.query(
      `insert into integration_tokens (provider, access_token, expires_at, refreshed_at, expires_at_is_assumed)
       values ('instagram', 'ig-token', now() + interval '50 days', now() - interval '2 days', false)`
    );
  });

  it("returns null from both readers when there is no spotify row", async () => {
    assert.equal(await readSpotifyRow(db.pool), null);
    assert.equal(await readSpotifyStatusRow(db.pool), null);
  });

  it("saveSpotifyAuthorization then readSpotifyRow returns what was saved", async () => {
    const saved = await save("rt-1");
    assert.ok(saved.authorizedAt instanceof Date && saved.expiresAt instanceof Date);
    assert.equal(saved.expiresAt - saved.authorizedAt, AUTHORIZATION_LIFETIME_DAYS * DAY_MS);
    assert.deepEqual(await readSpotifyRow(db.pool), {
      refreshToken: "rt-1", deadReason: null, authorizedAt: saved.authorizedAt,
      expiresAt: saved.expiresAt, accountId: "owner-1", scopes: [...SPOTIFY_SCOPES],
    });
    const row = await raw();
    assert.equal(row.access_token, null);
    assert.equal(row.scopes, "user-read-currently-playing user-top-read user-read-recently-played");
    assert.equal(row.expires_at_is_assumed, true);
  });

  it("saveSpotifyAuthorization over a dead row stores the new token and clears dead_reason", async () => {
    await save("rt-1");
    assert.equal(await markSpotifyDead("invalid_grant", "rt-1", db.pool), true);
    await save("rt-2");
    const row = await readSpotifyRow(db.pool);
    assert.equal(row.refreshToken, "rt-2");
    assert.equal(row.deadReason, null);
  });

  it("storeRotatedRefreshToken swaps once and refuses a stale previous token", async () => {
    await save("rt-A");
    assert.equal(await storeRotatedRefreshToken("rt-A", "rt-B", db.pool), true);
    assert.equal(await storeRotatedRefreshToken("rt-A", "rt-C", db.pool), false);
    assert.equal((await readSpotifyRow(db.pool)).refreshToken, "rt-B");
  });

  it("a rotation that lands after the old token was marked dead stores the new token and clears dead_reason", async () => {
    await save("rt-A");
    // Another instance re-sent rt-A after Spotify had rotated it, and marked it dead first.
    assert.equal(await markSpotifyDead("invalid_grant", "rt-A", db.pool), true);
    assert.equal(await storeRotatedRefreshToken("rt-A", "rt-B", db.pool), true);
    const row = await readSpotifyRow(db.pool);
    assert.equal(row.refreshToken, "rt-B");
    assert.equal(row.deadReason, null);
  });

  it("storeRotatedRefreshToken keeps authorized_at and expires_at (rotation does not extend the six months)", async () => {
    const saved = await save("rt-A");
    await storeRotatedRefreshToken("rt-A", "rt-B", db.pool);
    const row = await readSpotifyRow(db.pool);
    assert.deepEqual([row.authorizedAt, row.expiresAt], [saved.authorizedAt, saved.expiresAt]);
  });

  it("markSpotifyDead does not latch a newer token written by a reconnect", async () => {
    await save("rt-old");
    await save("rt-new"); // the reconnect
    assert.equal(await markSpotifyDead("invalid_grant", "rt-old", db.pool), false);
    const row = await readSpotifyRow(db.pool);
    assert.equal(row.refreshToken, "rt-new");
    assert.equal(row.deadReason, null);
  });

  it("markSpotifyDead latches the matching token exactly once", async () => {
    await save("rt-A");
    assert.equal(await markSpotifyDead("invalid_grant", "rt-A", db.pool), true);
    assert.equal(await markSpotifyDead("invalid_grant", "rt-A", db.pool), false);
    assert.equal((await readSpotifyRow(db.pool)).deadReason, "invalid_grant");
  });

  it("readSpotifyStatusRow returns no token fields", async () => {
    await save("rt-A");
    const status = await readSpotifyStatusRow(db.pool);
    assert.equal("refreshToken" in status, false);
    assert.equal("accessToken" in status, false);
    assert.deepEqual(Object.keys(status).sort(), ["accountId", "authorizedAt", "deadReason", "expiresAt", "scopes", "updatedAt"]);
    assert.deepEqual(status.scopes, [...SPOTIFY_SCOPES]);
    assert.ok(status.updatedAt instanceof Date);
    assert.ok(!JSON.stringify(status).includes("rt-A"));
  });

  it("no function touches the instagram row", async () => {
    const before = await instagram();
    await save("rt-A");
    await storeRotatedRefreshToken("rt-A", "rt-B", db.pool);
    assert.equal(await storeRotatedRefreshToken("ig-token", "x", db.pool), false);
    assert.equal(await markSpotifyDead("invalid_grant", "ig-token", db.pool), false);
    await markSpotifyDead("invalid_grant", "rt-B", db.pool);
    await readSpotifyRow(db.pool);
    await readSpotifyStatusRow(db.pool);
    await save("rt-C");
    assert.deepEqual(await instagram(), before);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/spotify-token.test.mjs tests/integration/spotify-token.test.mjs
```

Expected: both files fail to load with `ERR_MODULE_NOT_FOUND` naming `lib/spotify-token.js`: `ℹ tests 2`, `ℹ fail 2`.

- [ ] **Step 3: Implement `lib/spotify-token.js`**

Use two-space indentation, like `lib/instagram.js`, and import `getDbPool` from `"./db.js"`. Open the file with a comment that explains:
- Spotify's long-lived secret is the refresh token. It lives in its own column, so the Instagram row (which uses `access_token`) is never touched.
- Every token write is a compare-and-swap on the token value, never on `updated_at`, because a JS `Date` drops the microseconds.

Two guards come before any query:
- `markSpotifyDead` and `storeRotatedRefreshToken` return `false` without querying when a token argument is falsy. With no token there is nothing to compare, so they never latch blind (the same rule Task 8 gives Instagram's `markTokenDead`).
- `saveSpotifyAuthorization` rejects with `Error("saveSpotifyAuthorization needs a refreshToken and an accountId")` when either is falsy.

How results are mapped:
- Row fields become camelCase.
- `scopes` text becomes `text ? text.split(" ").filter(Boolean) : []`.
- An empty result is `null`.
- Each compare-and-swap returns `rowCount === 1`.

The SQL, exactly. Parameters are listed after each statement name.

```sql
-- readSpotifyRow: [SPOTIFY_PROVIDER]
select refresh_token, dead_reason, authorized_at, expires_at, account_id, scopes
  from integration_tokens
 where provider = $1

-- saveSpotifyAuthorization: [SPOTIFY_PROVIDER, refreshToken, accountId, scopes.join(" "), AUTHORIZATION_LIFETIME_DAYS]
insert into integration_tokens
  (provider, access_token, refresh_token, account_id, scopes, authorized_at,
   expires_at, expires_at_is_assumed, dead_reason, refreshed_at, updated_at)
values
  ($1, null, $2, $3, $4, now(),
   now() + $5::int * interval '24 hours', true, null, now(), now())
on conflict (provider) do update
  set access_token          = null,
      refresh_token         = excluded.refresh_token,
      account_id            = excluded.account_id,
      scopes                = excluded.scopes,
      authorized_at         = excluded.authorized_at,
      expires_at            = excluded.expires_at,
      expires_at_is_assumed = true,
      dead_reason           = null,
      refreshed_at          = excluded.refreshed_at,
      updated_at            = excluded.updated_at
returning authorized_at, expires_at

-- storeRotatedRefreshToken: [SPOTIFY_PROVIDER, previous, next]
-- authorized_at and expires_at stay: refreshing never extends Spotify's six months.
-- No dead_reason guard: Spotify has just accepted $2 and issued $3, so $3 is live even if
-- another instance marked $2 dead in the meantime. Clearing dead_reason keeps the only live token.
update integration_tokens
   set refresh_token = $3, dead_reason = null, refreshed_at = now(), updated_at = now()
 where provider = $1 and refresh_token = $2

-- markSpotifyDead: [SPOTIFY_PROVIDER, failedRefreshToken, reason]
update integration_tokens
   set dead_reason = $3, updated_at = now()
 where provider = $1 and refresh_token = $2 and dead_reason is null

-- readSpotifyStatusRow: [SPOTIFY_PROVIDER]  (never a token column)
select dead_reason, authorized_at, expires_at, account_id, scopes, updated_at
  from integration_tokens
 where provider = $1
```

> **Skeleton correction:** The skeleton has `expires_at = now() + interval '180 days'`. A `'1 day'` interval follows the session `TimeZone`, so the stored lifetime is 180 days ± 1 hour whenever one DST change falls inside the window.
> - A Homebrew Postgres on this Mac defaults to `America/New_York`.
> - With `AUTHORIZATION_LIFETIME_DAYS × interval '24 hours'` the lifetime is exactly 15,552,000 s in every zone.
> - The constant is also the single source of truth for the number.
> - Verified on a throwaway Postgres 16 with `TimeZone = America/New_York`: the upsert and the swaps above run as written.

- [ ] **Step 4: Run the tests to verify they pass**

```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/spotify-token.test.mjs tests/integration/spotify-token.test.mjs
```

Expected: `ℹ tests 17`, `ℹ pass 17` (7 unit, 10 integration), and no `﹣` line: the helper reads `TEST_DATABASE_URL` from `.env.test.local`, so the integration suite runs.

Then `npm test` ends with `ℹ fail 0` and `ℹ cancelled 0`, and `npm run lint` exits 0.

- [ ] **Step 5: Commit**

```
git add lib/spotify-token.js tests/spotify-token.test.mjs tests/integration/spotify-token.test.mjs
git commit -m "Add a database store for the Spotify refresh token"
```

---

### Task 6: DB-backed `lib/spotify.js`

**Model:** Opus (concurrency)
**Files:**
- Modify: `lib/spotify.js`. Rewrite the audit's `getAccessToken` and `spotifyFetch`, and the module-level `reauthRequired`, `cachedToken`, `client_id`, `client_secret`, `refresh_token` and `basic`, into `createSpotifyClient`. Keep `SpotifyReauthRequiredError`, the endpoint constants, `REQUEST_TIMEOUT_MS` and `TOKEN_EXPIRY_MARGIN_MS` byte for byte. Keep the file's tab indentation.
- Test: `tests/spotify.test.mjs`
- Unchanged, and checked in Step 4: `pages/api/nowplaying.js`, `pages/api/toptracks.js`, `pages/api/listeningtimeline.js`.

**Interfaces:**
- Consumes, from Task 5's `lib/spotify-token.js`. Each takes an optional trailing `db` defaulting to `getDbPool()`.
  - `readSpotifyRow(): Promise<null | { refreshToken: string | null, deadReason: string | null, authorizedAt, expiresAt, accountId, scopes }>`. It rejects on any database error, including `Error("DATABASE_URL is not set")`.
  - `storeRotatedRefreshToken(previous: string, next: string): Promise<boolean>`
  - `markSpotifyDead(reason: string, failedRefreshToken: string): Promise<boolean>`
- Produces:
  - `export class SpotifyReauthRequiredError extends Error`, unchanged: `name` is `"SpotifyReauthRequiredError"` and the default message is `"Spotify refresh token is expired or revoked"`.
  - `export function createSpotifyClient({ store, fetchImpl = fetch, now = Date.now, env = process.env, recheckMs = 60_000, storeTimeoutMs = REQUEST_TIMEOUT_MS }): { getNowPlaying, getTopTracks, getListeningTimeline, reset }`. Here `store` is `{ readSpotifyRow, storeRotatedRefreshToken, markSpotifyDead }`.
    - Each of the three store calls is bounded by `storeTimeoutMs` (5,000 ms by default) with a `Promise.race` timer that is cleared when the call settles.
    - A call that outlasts it rejects with `Error("[spotify] <label> timed out")`, for example `[spotify] Reading the token row timed out`.
  - `export const getNowPlaying = () => Promise<Response>`. `getTopTracks` and `getListeningTimeline` have the same shape.
    - All three delegate to the default client.
    - Each resolves to Spotify's raw `Response`, with a 204 or a second 401 passed through.
    - Each rejects on any token failure.
  - `export function resetSpotifyTokenCache(): void`. This is the default client's `reset()`; Task 13's callback route calls it after a reconnect.
  - Nothing else is exported.

- [ ] **Step 1: Write the failing tests**

`tests/spotify.test.mjs`. Every test uses a fake store, a fake `fetchImpl` that serves queued responses in order (an unexpected call fails the test), and an injected clock. Test (g2) also passes `storeTimeoutMs: 20` and sets a 2 s test timeout, so without the store timeout it is cancelled instead of hanging.

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import * as spotify from "../lib/spotify.js";
import { createSpotifyClient, SpotifyReauthRequiredError } from "../lib/spotify.js";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const NOW_PLAYING_URL = "https://api.spotify.com/v1/me/player/currently-playing";
const TOP_TRACKS_URL = "https://api.spotify.com/v1/me/top/tracks?time_range=short_term&limit=10&offset=5";
const RECENTLY_PLAYED_URL = "https://api.spotify.com/v1/me/player/recently-played?limit=50";
const ENV = { SPOTIFY_CLIENT_ID: "new-id", SPOTIFY_CLIENT_SECRET: "new-secret" };

const live = (refreshToken) => ({ refreshToken, deadReason: null, authorizedAt: new Date(0), expiresAt: new Date(0), accountId: "owner", scopes: [] });
const tokenOk = (accessToken, extra = {}) => () => Response.json({ access_token: accessToken, token_type: "Bearer", expires_in: 3600, ...extra });
const tokenError = (status, error) => () => Response.json(error ? { error } : {}, { status });
const api = (status = 200) => () => Response.json({ ok: status === 200 }, { status });
const basic = (id, secret) => `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup({ row = null, env = ENV, token = [], apiResponses = [], storeTimeoutMs } = {}) {
  let t = 0;
  const calls = { reads: 0, token: [], api: [], rotated: [], dead: [] };
  const store = {
    row, readError: null, rotateError: null,
    async readSpotifyRow() { calls.reads += 1; if (store.readError) throw store.readError; return store.row; },
    async storeRotatedRefreshToken(previous, next) { calls.rotated.push([previous, next]); if (store.rotateError) throw store.rotateError; return true; },
    async markSpotifyDead(reason, failed) { calls.dead.push([reason, failed]); return true; },
  };
  const queues = { token: [...token], api: [...apiResponses] };
  const fetchImpl = async (url, init = {}) => {
    if (url === TOKEN_URL) {
      calls.token.push({ init, form: new URLSearchParams(String(init.body)) });
      const next = queues.token.shift();
      assert.ok(next, "unexpected token call");
      return next();
    }
    calls.api.push({ url, init });
    const next = queues.api.shift();
    assert.ok(next, `unexpected API call to ${url}`);
    return next();
  };
  const client = createSpotifyClient({ store, fetchImpl, now: () => t, env, storeTimeoutMs });
  return { client, store, calls, at: (ms) => { t = ms; } };
}

test("(a) one token call serves sequential getters, and each returns Spotify's raw Response", async () => {
  const nothingPlaying = new Response(null, { status: 204 });
  const s = setup({ row: live("rt-A"), token: [tokenOk("AT1")], apiResponses: [() => nothingPlaying, api(), api()] });
  assert.equal(await s.client.getNowPlaying(), nothingPlaying);
  await s.client.getTopTracks();
  await s.client.getListeningTimeline();
  assert.equal(s.calls.token.length, 1);
  assert.equal(s.calls.reads, 1);
  assert.deepEqual(s.calls.api.map((c) => c.url), [NOW_PLAYING_URL, TOP_TRACKS_URL, RECENTLY_PLAYED_URL]);
  assert.ok(s.calls.api.every((c) => c.init.headers.Authorization === "Bearer AT1" && c.init.signal instanceof AbortSignal));
  const [{ init, form }] = s.calls.token;
  assert.equal(init.method, "POST");
  assert.equal(init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(Object.fromEntries(form), { grant_type: "refresh_token", refresh_token: "rt-A" });
});

test("(b) five concurrent getters on a cold cache share one refresh", async () => {
  const gate = Promise.withResolvers();
  const s = setup({
    row: live("rt-A"),
    token: [async () => { await gate.promise; return tokenOk("AT1")(); }],
    apiResponses: Array.from({ length: 5 }, () => api()),
  });
  const pending = Array.from({ length: 5 }, () => s.client.getNowPlaying());
  await tick();
  gate.resolve();
  const results = await Promise.all(pending);
  assert.equal(s.calls.token.length, 1);
  assert.equal(s.calls.reads, 1);
  assert.equal(s.calls.api.length, 5);
  assert.ok(results.every((r) => r.status === 200));
});

test("(c) the access token is refreshed 60 s before Spotify's stated expiry", async () => {
  const s = setup({ row: live("rt-A"), token: [tokenOk("AT1"), tokenOk("AT2")], apiResponses: [api(), api(), api()] });
  await s.client.getNowPlaying(); // t = 0, expires_in 3600, so reused until 3_540_000
  s.at(3_539_999);
  await s.client.getNowPlaying();
  assert.equal(s.calls.token.length, 1);
  s.at(3_540_000);
  await s.client.getNowPlaying();
  assert.equal(s.calls.token.length, 2);
  assert.equal(s.calls.api[2].init.headers.Authorization, "Bearer AT2");
});

test("(d) invalid_grant on a stored token marks it dead once, then no I/O at all for 60 s", async (t) => {
  const errors = t.mock.method(console, "error", () => {});
  const s = setup({ row: live("rt-A"), token: [tokenError(400, "invalid_grant")] });
  await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError);
  assert.deepEqual(s.calls.dead, [["invalid_grant", "rt-A"]]);
  s.at(59_999);
  await assert.rejects(s.client.getTopTracks(), SpotifyReauthRequiredError);
  await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError);
  assert.deepEqual([s.calls.reads, s.calls.token.length, s.calls.api.length, s.calls.dead.length], [1, 1, 0, 1]);
  assert.ok(errors.mock.callCount() >= 1);
  assert.ok(errors.mock.calls.every((c) => !c.arguments.join(" ").includes("rt-A")));
});

test("(e) after 60 s a reconnected row is read once and used", async (t) => {
  t.mock.method(console, "error", () => {});
  const s = setup({ row: live("rt-A"), token: [tokenError(400, "invalid_grant"), tokenOk("AT2")], apiResponses: [api()] });
  await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError);
  s.store.row = live("rt-B"); // the panel's reconnect
  s.at(60_000);
  assert.equal((await s.client.getNowPlaying()).status, 200);
  assert.equal(s.calls.reads, 2);
  assert.equal(s.calls.token[1].form.get("refresh_token"), "rt-B");
  assert.equal(s.calls.api[0].init.headers.Authorization, "Bearer AT2");
});

test("(e2) a row still dead at the recheck re-arms the latch for another 60 s", async (t) => {
  t.mock.method(console, "error", () => {});
  const s = setup({ row: live("rt-A"), token: [tokenError(400, "invalid_grant")] });
  await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError);
  s.store.row = { ...live("rt-A"), deadReason: "invalid_grant" };
  for (const [at, reads] of [[60_000, 2], [119_999, 2], [120_000, 3]]) {
    s.at(at);
    await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError);
    assert.equal(s.calls.reads, reads);
  }
  assert.equal(s.calls.token.length, 1);
});

test("(e3) a stored token Spotify rejected is never re-sent, even when markSpotifyDead failed", async (t) => {
  t.mock.method(console, "error", () => {});
  const s = setup({ row: live("rt-A"), token: [tokenError(400, "invalid_grant")] });
  s.store.markSpotifyDead = async () => { throw new Error("db down"); };
  await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError); // not "db down"
  s.at(60_000); // the row still holds rt-A, unmarked
  await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError);
  assert.equal(s.calls.reads, 2);
  assert.equal(s.calls.token.length, 1);
});

test("(f) with no row the env refresh_token is used; once rejected it is never sent again", async (t) => {
  t.mock.method(console, "error", () => {});
  const s = setup({ row: null, env: { ...ENV, refresh_token: "env-rt" }, token: [tokenOk("AT1"), tokenError(400, "invalid_grant")], apiResponses: [api()] });
  await s.client.getNowPlaying();
  assert.equal(s.calls.token[0].form.get("refresh_token"), "env-rt");
  s.at(3_540_000);
  await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError);
  assert.deepEqual(s.calls.dead, []); // an env token has no row to mark
  s.at(3_600_000);
  await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError);
  assert.equal(s.calls.reads, 3);
  assert.equal(s.calls.token.length, 2);

  const neither = setup({ row: null, env: ENV });
  await assert.rejects(neither.client.getNowPlaying(), SpotifyReauthRequiredError);
  assert.equal(neither.calls.token.length, 0);
});

test("(g) a database error rejects the getter and never falls back to the env token", async () => {
  const s = setup({ env: { ...ENV, refresh_token: "env-rt" } });
  s.store.readError = new Error("connect ECONNREFUSED");
  const isDbError = (error) => !(error instanceof SpotifyReauthRequiredError) && error.message === "connect ECONNREFUSED";
  await assert.rejects(s.client.getNowPlaying(), isDbError);
  await assert.rejects(s.client.getNowPlaying(), isDbError); // not latched: the row is read again
  assert.equal(s.calls.reads, 2);
  assert.equal(s.calls.token.length, 0);
});

test("(g2) a stalled database read times out and the next call reads again", { timeout: 2000 }, async () => {
  const s = setup({ row: live("rt-A"), env: { ...ENV, refresh_token: "env-rt" }, storeTimeoutMs: 20 });
  s.store.readSpotifyRow = () => { s.calls.reads += 1; return new Promise(() => {}); }; // a query that never returns
  const isTimeout = (error) => !(error instanceof SpotifyReauthRequiredError) && error.message === "[spotify] Reading the token row timed out";
  await assert.rejects(s.client.getNowPlaying(), isTimeout);
  await assert.rejects(s.client.getNowPlaying(), isTimeout); // not latched, and the stalled read no longer holds the shared refresh
  assert.equal(s.calls.reads, 2);
  assert.equal(s.calls.token.length, 0);
});

test("(h) a rotated refresh token is stored with compare-and-swap on the old one", async () => {
  const s = setup({ row: live("rt-A"), token: [tokenOk("AT1", { refresh_token: "rt-B" })], apiResponses: [api()] });
  await s.client.getNowPlaying();
  assert.deepEqual(s.calls.rotated, [["rt-A", "rt-B"]]);
});

test("(h2) a failed rotation write is logged without the token, and the request still succeeds", async (t) => {
  const errors = t.mock.method(console, "error", () => {});
  const s = setup({ row: live("rt-A"), token: [tokenOk("AT1", { refresh_token: "rt-B" })], apiResponses: [api()] });
  s.store.rotateError = new Error("db down");
  assert.equal((await s.client.getNowPlaying()).status, 200);
  assert.equal(errors.mock.callCount(), 1);
  assert.ok(!/rt-A|rt-B/.test(errors.mock.calls[0].arguments.join(" ")));
});

test("(h3) no rotation write for an env token or for the same token echoed back", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const fromEnv = setup({ row: null, env: { ...ENV, refresh_token: "env-rt" }, token: [tokenOk("AT1", { refresh_token: "env-rt-2" })], apiResponses: [api()] });
  await fromEnv.client.getNowPlaying();
  assert.deepEqual(fromEnv.calls.rotated, []);
  assert.equal(warn.mock.callCount(), 1);
  assert.ok(!warn.mock.calls[0].arguments.join(" ").includes("env-rt-2"));
  const echoed = setup({ row: live("rt-A"), token: [tokenOk("AT1", { refresh_token: "rt-A" })], apiResponses: [api()] });
  await echoed.client.getNowPlaying();
  assert.deepEqual(echoed.calls.rotated, []);
});

test("(i) a 401 from the API retries once with a fresh token", async () => {
  const s = setup({ row: live("rt-A"), token: [tokenOk("AT1"), tokenOk("AT2")], apiResponses: [api(401), api(200)] });
  assert.equal((await s.client.getNowPlaying()).status, 200);
  assert.deepEqual(s.calls.api.map((c) => c.init.headers.Authorization), ["Bearer AT1", "Bearer AT2"]);
  assert.equal(s.calls.token.length, 2);
});

test("(i2) a second 401 is returned to the route, not retried again", async () => {
  const s = setup({ row: live("rt-A"), token: [tokenOk("AT1"), tokenOk("AT2")], apiResponses: [api(401), api(401)] });
  assert.equal((await s.client.getNowPlaying()).status, 401);
  assert.equal(s.calls.api.length, 2);
});

test("(j) other token errors throw a plain Error, are not latched, and mark nothing", async () => {
  const cases = [
    [tokenError(429), "[spotify] Token refresh failed with 429: unknown error"],
    [tokenError(400, "invalid_client"), "[spotify] Token refresh failed with 400: invalid_client"],
    [tokenError(503), "[spotify] Token refresh failed with 503: unknown error"],
    [() => Response.json({ token_type: "Bearer" }), "[spotify] Token refresh returned no access_token"],
  ];
  for (const [response, message] of cases) {
    const s = setup({ row: live("rt-A"), token: [response, tokenOk("AT1")], apiResponses: [api()] });
    await assert.rejects(s.client.getNowPlaying(), (error) => !(error instanceof SpotifyReauthRequiredError) && error.message === message);
    assert.equal((await s.client.getNowPlaying()).status, 200); // the very next call tries Spotify again
    assert.deepEqual(s.calls.dead, []);
  }
});

test("(k) SPOTIFY_CLIENT_ID/SECRET win over client_id/client_secret in the Basic header", async () => {
  const both = setup({ row: live("rt-A"), env: { SPOTIFY_CLIENT_ID: "new-id", SPOTIFY_CLIENT_SECRET: "new-secret", client_id: "old-id", client_secret: "old-secret" }, token: [tokenOk("AT1")], apiResponses: [api()] });
  await both.client.getNowPlaying();
  assert.equal(both.calls.token[0].init.headers.Authorization, basic("new-id", "new-secret"));
  const legacy = setup({ row: live("rt-A"), env: { client_id: "old-id", client_secret: "old-secret" }, token: [tokenOk("AT1")], apiResponses: [api()] });
  await legacy.client.getNowPlaying();
  assert.equal(legacy.calls.token[0].init.headers.Authorization, basic("old-id", "old-secret"));
  const none = setup({ row: live("rt-A"), env: {} });
  await assert.rejects(none.client.getNowPlaying(), { message: "Spotify client credentials are not set" });
  assert.deepEqual([none.calls.reads, none.calls.token.length], [0, 0]);
});

test("(l) reset() during a refresh: the stale result neither latches nor caches", async (t) => {
  t.mock.method(console, "error", () => {});
  const gate = Promise.withResolvers();
  const s = setup({
    row: live("rt-A"),
    token: [async () => { await gate.promise; return tokenError(400, "invalid_grant")(); }, tokenOk("AT2")],
    apiResponses: [api()],
  });
  const first = s.client.getNowPlaying();
  await tick();
  s.client.reset(); // what the callback route does right after saving the new row
  s.store.row = live("rt-B");
  gate.resolve();
  await assert.rejects(first, SpotifyReauthRequiredError);
  assert.equal((await s.client.getNowPlaying()).status, 200); // same instant, yet not latched
  assert.equal(s.calls.token[1].form.get("refresh_token"), "rt-B");
});

test("(m) the module keeps its public names and error class", () => {
  assert.deepEqual(Object.keys(spotify).sort(), [
    "SpotifyReauthRequiredError", "createSpotifyClient", "getListeningTimeline",
    "getNowPlaying", "getTopTracks", "resetSpotifyTokenCache",
  ]);
  const error = new SpotifyReauthRequiredError();
  assert.ok(error instanceof Error);
  assert.equal(error.name, "SpotifyReauthRequiredError");
  assert.equal(error.message, "Spotify refresh token is expired or revoked");
});
```

Do not call the module-level getters in tests. If Kevin's shell exports `DATABASE_URL`, they would query production.

- [ ] **Step 2: Run it to verify it fails**

```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/spotify.test.mjs
```

Expected: a `SyntaxError` saying the requested module `../lib/spotify.js` does not provide an export named `createSpotifyClient`: `ℹ tests 1`, `ℹ fail 1`.

- [ ] **Step 3: Rewrite `lib/spotify.js` around `createSpotifyClient`**

What to change:
- **Imports.** Drop `import querystring`, and add `import { readSpotifyRow, storeRotatedRefreshToken, markSpotifyDead } from "./spotify-token.js";`.
- **Module-load env reads.** Delete them (`client_id`, `client_secret`, `refresh_token`, `basic`). Credentials are now read on every refresh from the client's `env`, through this private helper, which Task 7 replaces with `spotifyCredentials`:

  ```js
  const clientCredentials = (env) => {
  	const clientId = env.SPOTIFY_CLIENT_ID ?? env.client_id;
  	const clientSecret = env.SPOTIFY_CLIENT_SECRET ?? env.client_secret;
  	if (!clientId || !clientSecret) throw new Error("Spotify client credentials are not set");
  	return { clientId, clientSecret };
  };
  ```

- **The old comment blocks.** Replace the latch and cache comments with one comment that says:
  - Postgres holds the refresh token. This instance caches only the access token.
  - Concurrent requests share one refresh.
  - A rejected token is marked dead by compare-and-swap and rechecked at most once a minute, so a reconnect from `/admin` takes effect within a minute with no redeploy.
  - A database error, or a database call slower than `storeTimeoutMs`, fails the request and never falls back to the env token.
  - The hot path (`/api/nowplaying`, polled every 15 s) touches Postgres only on a refresh: about once an hour, or once a minute while dead.
- **Inside `createSpotifyClient`.** This is the state; the tests pin its edges, but the ordering and the generation guard are the decision.

```js
let cached = null;     // { accessToken, expiresAt }
let inFlight = null;   // the one refresh that concurrent callers share
let deadSince = null;  // when this client last found no usable refresh token
let deadToken = null;  // a refresh token Spotify answered invalid_grant for: never sent again
let generation = 0;    // bumped by reset(); a refresh begun before it must not write state after it
```

Implement `refresh(gen)`, `latchDead(gen)` and `getAccessToken()` to tests (a)–(m) and (g2); `reset()` bumps `generation`, and a refresh writes `cached` / `deadSince` / `deadToken` only when its generation is current; store calls go through the timeout.

The rest of the client:
- **The store timeout.** A private `withTimeout(promise, label)` races the store call against a `setTimeout(storeTimeoutMs)` that rejects with ``Error(`[spotify] ${label} timed out`)``, and clears the timer when the store call settles (`promise.finally(() => clearTimeout(timer)).catch(() => {})`), so a fast call leaves no timer behind. The labels are `Reading the token row` (test (g2) pins that message), `Marking the stored token dead` and `Storing the rotated refresh token`. A timed-out mark or rotation write is logged and handled exactly like one that threw.
- **`spotifyFetch`.** It is the audit's function, moved into the closure unchanged except `fetch` → `fetchImpl` and `cachedToken` → `cached`. That keeps the 5 s timeout and the 401 path: drop the cache only if it still holds that token, `response.body?.cancel().catch(() => {})`, retry once with `isRetry: true`.
- **The client's methods:**
  - `getNowPlaying: () => spotifyFetch(NOW_PLAYING_ENDPOINT)`, and the same for the other two getters.
  - `reset()`: `generation += 1; cached = null; inFlight = null; deadSince = null; deadToken = null;`
- **Module level:**
  - `const defaultClient = createSpotifyClient({ store: { readSpotifyRow, storeRotatedRefreshToken, markSpotifyDead } });`
  - The three exports and `resetSpotifyTokenCache` call through to it. Creating it does no I/O.
- **Logging.** No log line may contain a token. The tests check the log lines only for their count and for a leaked token, so use these texts:
  - `invalid_grant`: ``console.error("[spotify] Refresh token rejected (invalid_grant): expired or revoked. Reconnect Spotify from /admin, or run `npm run spotify:reauth -- --save`.")``. For a token from the row (`fromDb`), a failed `markSpotifyDead` then logs `console.error("[spotify] Could not mark the stored token dead:", error.message)`, and the client latches as usual.
  - A rotated token from the row: await `storeRotatedRefreshToken(refreshToken, body.refresh_token)`, not fire-and-forget, because a suspended instance could otherwise drop the write. `true` also clears a `dead_reason` another instance set for the old token (Task 5). `false` logs `console.warn("[spotify] Spotify rotated the refresh token, but the stored one had already changed; keeping the stored one.")`, and a throw logs `console.error("[spotify] Could not store the rotated refresh token:", error.message)`.
  - A rotated env token: `console.warn("[spotify] Spotify rotated the refresh token held in the refresh_token env var. Reconnect from /admin so the new one is stored.")`.

> **Skeleton correction:** The skeleton caches `{ accessToken, expiresAt, refreshToken }`. Every refresh re-reads the row instead, which is what picks up a reconnect and a rotation stored by another instance. Nothing reads a cached refresh token, so the cache is `{ accessToken, expiresAt }`.
>
> The skeleton says "an env token known dead is not re-sent". This plan widens that to any token Spotify answered `invalid_grant` for (`deadToken`). Otherwise, when `markSpotifyDead` fails (the database blips), each instance would re-send the dead stored token every minute. Test (e3) pins it.
>
> `reset()` also bumps a generation counter, so a refresh already in flight cannot re-latch the instance that just reconnected. Test (l) pins it.

- [ ] **Step 4: Run tests and checks to verify they pass**

```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/spotify.test.mjs
```

Expected: `ℹ tests 19`, `ℹ pass 19`, `ℹ fail 0`, `ℹ cancelled 0`.

Then the routes and the rest:
- `git diff --stat -- pages/api/nowplaying.js pages/api/toptracks.js pages/api/listeningtimeline.js` prints nothing.
- `npm test` ends with `ℹ fail 0` and `ℹ cancelled 0`.
- `npm run lint` exits 0.
- `npm run build` exits 0. It proves the three public routes still bundle, now that `pg` is in their import graph.

- [ ] **Step 5: Commit**

```
git add lib/spotify.js tests/spotify.test.mjs
git commit -m "Read the Spotify refresh token from the database"
```

---

### Task 7: Spotify OAuth helpers, `spotify:reauth --whoami/--save`, owner constants

**Model:** Opus
**Files:**
- Create: `lib/spotify-oauth.js`
- Create: `lib/admin/owner.js`
- Modify: `lib/spotify.js`. Replace the private `clientCredentials` with `spotifyCredentials`.
- Modify: `scripts/spotify-reauth.mjs`:
  - the top-level env read and `client_id`/`client_secret` check
  - `SCOPES`, `authorizeUrl`, the local `exchangeCode`
  - the `http.createServer` callback's success branch
  - the doc comment
- Modify: `package.json`. Only the `spotify:reauth` script line changes.
- Test: `tests/spotify-oauth.test.mjs`, `tests/admin-owner.test.mjs`

**Interfaces:**
- Consumes:
  - From Task 5's `lib/spotify-token.js`. Each function takes an optional trailing `db`.
    - `SPOTIFY_SCOPES`
    - `AUTHORIZATION_LIFETIME_DAYS`
    - `readSpotifyRow()`, which resolves to `null | { refreshToken, deadReason, ... }`
    - `saveSpotifyAuthorization({ refreshToken, accountId, scopes })`, which resolves to `{ authorizedAt, expiresAt }`
    - `storeRotatedRefreshToken(previous, next)`, which resolves to a `boolean`
  - `lib/db.js`: `getDbPool()`.
  - `scripts/load-env.mjs` (unchanged by the audit):
    - `ENV_FILES`
    - `loadEnvFiles()`
    - `requireEnv(name, fileEnv)`, which exits 1 with its own message when the variable is missing
- Produces:
  - `lib/spotify-oauth.js`:
    - `export const SPOTIFY_ADMIN_REDIRECT_URI = "https://www.kevinwong.co/api/admin/spotify/callback"`
    - `export function spotifyCredentials(env = process.env): { clientId: string, clientSecret: string }`. It reads `SPOTIFY_CLIENT_ID ?? client_id` and `SPOTIFY_CLIENT_SECRET ?? client_secret`, and throws `Error("Spotify client credentials are not set")` when either is missing.
    - `export function buildAuthorizeUrl({ clientId, redirectUri, state }): string`
    - `export class SpotifyOAuthError extends Error`. Its constructor is `(code, message)`, `name` is `"SpotifyOAuthError"`, and `code` is `"exchange_failed" | "account_lookup_failed"`.
    - `export async function exchangeCode({ code, redirectUri, clientId, clientSecret, fetchImpl = fetch }): Promise<{ refreshToken, accessToken, scopes: string[], expiresIn: number }>`
    - `export async function fetchSpotifyAccountId(accessToken, fetchImpl = fetch): Promise<string>`
    - `export async function fetchSpotifyProfile(accessToken, fetchImpl = fetch): Promise<{ id: string, displayName: string | null }>`
    - `export function missingScopes(granted: string[]): string[]`. It returns the missing scopes in `SPOTIFY_SCOPES` order.
  - `lib/admin/owner.js`, five constants that later tasks consume:
    - `export const OWNER_GITHUB_ID = "1741711"`. Sign-in is decided by this id only.
    - `export const OWNER_GITHUB_LOGIN = "dotKevinWong"`. For display (the dashboard's `@dotKevinWong`); never used to authorize, since a login can be renamed.
    - `export const OWNER_SPOTIFY_ACCOUNT_ID`: filled in during Step 9
    - `export const SITE_ORIGIN = "https://www.kevinwong.co"`
    - `export const SITE_HOST = "www.kevinwong.co"`

> **Skeleton correction:**
> - **`fetchSpotifyProfile` is new.** `--whoami` must print the display name, and `fetchSpotifyAccountId` (kept, used by `--save` and Task 13) returns only the id.
> - **`lib/admin/owner.js` is created here, not in Task 11, and adds `OWNER_GITHUB_LOGIN`.** Tasks 11 onward consume it.
> - **`package.json`'s `spotify:reauth` line gains `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON`.** The script now imports `lib/`, like `instagram:sync`.

- [ ] **Step 1: Write the failing tests**

`tests/spotify-oauth.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SPOTIFY_ADMIN_REDIRECT_URI, SpotifyOAuthError, spotifyCredentials, buildAuthorizeUrl,
  exchangeCode, fetchSpotifyAccountId, fetchSpotifyProfile, missingScopes,
} from "../lib/spotify-oauth.js";

const ALL = ["user-read-currently-playing", "user-top-read", "user-read-recently-played"];
const basic = (id, secret) => `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
const recorder = (respond) => {
  const calls = [];
  return { calls, fetchImpl: async (url, init = {}) => { calls.push({ url, init }); return respond(); } };
};
const exchange = (fetchImpl) =>
  exchangeCode({ code: "code-SECRET", redirectUri: SPOTIFY_ADMIN_REDIRECT_URI, clientId: "cid", clientSecret: "client-SECRET", fetchImpl });
const oauthError = (code) => (error) => {
  assert.ok(error instanceof SpotifyOAuthError);
  assert.equal(error.name, "SpotifyOAuthError");
  assert.equal(error.code, code);
  assert.ok(!error.message.includes("SECRET"));
  return true;
};

test("the admin redirect URI is the www callback", () => {
  assert.equal(SPOTIFY_ADMIN_REDIRECT_URI, "https://www.kevinwong.co/api/admin/spotify/callback");
});

test("spotifyCredentials prefers SPOTIFY_* and falls back to the lowercase names", () => {
  assert.deepEqual(spotifyCredentials({ SPOTIFY_CLIENT_ID: "new-id", SPOTIFY_CLIENT_SECRET: "new-secret", client_id: "old-id", client_secret: "old-secret" }), { clientId: "new-id", clientSecret: "new-secret" });
  assert.deepEqual(spotifyCredentials({ client_id: "old-id", client_secret: "old-secret" }), { clientId: "old-id", clientSecret: "old-secret" });
  assert.deepEqual(spotifyCredentials({ SPOTIFY_CLIENT_ID: "new-id", client_secret: "old-secret" }), { clientId: "new-id", clientSecret: "old-secret" });
});

test("spotifyCredentials throws when either is missing", () => {
  for (const env of [{}, { SPOTIFY_CLIENT_ID: "id" }, { client_secret: "secret" }]) {
    assert.throws(() => spotifyCredentials(env), { message: "Spotify client credentials are not set" });
  }
});

test("buildAuthorizeUrl sends exactly the six parameters", () => {
  const url = new URL(buildAuthorizeUrl({ clientId: "cid", redirectUri: SPOTIFY_ADMIN_REDIRECT_URI, state: "st-123" }));
  assert.equal(`${url.origin}${url.pathname}`, "https://accounts.spotify.com/authorize");
  assert.deepEqual([...url.searchParams.keys()].sort(), ["client_id", "redirect_uri", "response_type", "scope", "show_dialog", "state"]);
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: "cid", response_type: "code",
    redirect_uri: "https://www.kevinwong.co/api/admin/spotify/callback",
    scope: "user-read-currently-playing user-top-read user-read-recently-played",
    state: "st-123", show_dialog: "true",
  });
});

test("exchangeCode posts an authorization_code grant with Basic auth and maps the response", async () => {
  const { calls, fetchImpl } = recorder(() => Response.json({ access_token: "at-1", token_type: "Bearer", scope: "user-top-read user-read-currently-playing", expires_in: 3600, refresh_token: "rt-1" }));
  assert.deepEqual(await exchange(fetchImpl), { refreshToken: "rt-1", accessToken: "at-1", scopes: ["user-top-read", "user-read-currently-playing"], expiresIn: 3600 });
  const [{ url, init }] = calls;
  assert.equal(url, "https://accounts.spotify.com/api/token");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, basic("cid", "client-SECRET"));
  assert.equal(init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(String(init.body))), {
    grant_type: "authorization_code", code: "code-SECRET", redirect_uri: "https://www.kevinwong.co/api/admin/spotify/callback",
  });
  assert.ok(init.signal instanceof AbortSignal);
});

test("exchangeCode maps a missing scope field to []", async () => {
  const { fetchImpl } = recorder(() => Response.json({ access_token: "at-1", expires_in: 3600, refresh_token: "rt-1" }));
  assert.deepEqual((await exchange(fetchImpl)).scopes, []);
});

test("exchangeCode failures are exchange_failed and carry no secret", async () => {
  const responses = [
    () => Response.json({ error: "invalid_grant", error_description: "Invalid authorization code" }, { status: 400 }),
    () => Response.json({ access_token: "at-SECRET", expires_in: 3600 }), // no refresh_token
    () => { throw new TypeError("fetch failed"); },
  ];
  for (const respond of responses) {
    await assert.rejects(exchange(recorder(respond).fetchImpl), oauthError("exchange_failed"));
  }
});

test("fetchSpotifyAccountId reads /v1/me with the access token", async () => {
  const { calls, fetchImpl } = recorder(() => Response.json({ id: "owner-123", display_name: "Kevin" }));
  assert.equal(await fetchSpotifyAccountId("at-1", fetchImpl), "owner-123");
  assert.equal(calls[0].url, "https://api.spotify.com/v1/me");
  assert.equal(calls[0].init.headers.Authorization, "Bearer at-1");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("fetchSpotifyProfile returns the id and the display name", async () => {
  assert.deepEqual(await fetchSpotifyProfile("at-1", recorder(() => Response.json({ id: "owner-123", display_name: "Kevin" })).fetchImpl), { id: "owner-123", displayName: "Kevin" });
  assert.deepEqual(await fetchSpotifyProfile("at-1", recorder(() => Response.json({ id: "owner-123", display_name: null })).fetchImpl), { id: "owner-123", displayName: null });
});

test("account lookup failures are account_lookup_failed", async () => {
  const responses = [
    () => Response.json({ error: { status: 401, message: "Invalid access token" } }, { status: 401 }),
    () => Response.json({ display_name: "Kevin" }), // no id
    () => { throw new TypeError("fetch failed"); },
  ];
  for (const respond of responses) {
    await assert.rejects(fetchSpotifyAccountId("at-SECRET", recorder(respond).fetchImpl), oauthError("account_lookup_failed"));
  }
});

test("missingScopes lists what was not granted, in SPOTIFY_SCOPES order", () => {
  assert.deepEqual(missingScopes(ALL), []);
  assert.deepEqual(missingScopes(["user-read-recently-played", "user-read-email", "user-top-read", "user-read-currently-playing"]), []);
  assert.deepEqual(missingScopes(["user-top-read"]), ["user-read-currently-playing", "user-read-recently-played"]);
  assert.deepEqual(missingScopes([]), ALL);
});

test("SpotifyOAuthError carries its code", () => {
  const error = new SpotifyOAuthError("exchange_failed", "Token exchange failed with 400: invalid_grant");
  assert.ok(error instanceof Error);
  assert.equal(error.name, "SpotifyOAuthError");
  assert.equal(error.code, "exchange_failed");
  assert.equal(error.message, "Token exchange failed with 400: invalid_grant");
});
```

`tests/admin-owner.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import * as owner from "../lib/admin/owner.js";
import {
  OWNER_GITHUB_ID, OWNER_GITHUB_LOGIN, OWNER_SPOTIFY_ACCOUNT_ID, SITE_ORIGIN, SITE_HOST,
} from "../lib/admin/owner.js";

test("owner constants", () => {
  assert.deepEqual(Object.keys(owner).sort(), [
    "OWNER_GITHUB_ID", "OWNER_GITHUB_LOGIN", "OWNER_SPOTIFY_ACCOUNT_ID", "SITE_HOST", "SITE_ORIGIN",
  ]);
  assert.equal(OWNER_GITHUB_ID, "1741711");
  assert.equal(OWNER_GITHUB_LOGIN, "dotKevinWong");
  assert.equal(SITE_ORIGIN, "https://www.kevinwong.co");
  assert.equal(SITE_HOST, "www.kevinwong.co");
});

test("OWNER_SPOTIFY_ACCOUNT_ID has been filled in", () => {
  assert.notEqual(OWNER_SPOTIFY_ACCOUNT_ID, "<from --whoami>");
  assert.match(OWNER_SPOTIFY_ACCOUNT_ID, /^[A-Za-z0-9._-]{1,64}$/);
});
```

- [ ] **Step 2: Run them to verify they fail**

```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/spotify-oauth.test.mjs tests/admin-owner.test.mjs
```

Expected: both files fail with `ERR_MODULE_NOT_FOUND`, for `lib/spotify-oauth.js` and `lib/admin/owner.js`: `ℹ tests 2`, `ℹ fail 2`.

- [ ] **Step 3: Implement `lib/spotify-oauth.js` and create `lib/admin/owner.js`**

`lib/spotify-oauth.js`:
- Two-space indentation. `import { SPOTIFY_SCOPES } from "./spotify-token.js";`.
- No env reads at import time.

`buildAuthorizeUrl` returns `"https://accounts.spotify.com/authorize?" + new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: redirectUri, scope: SPOTIFY_SCOPES.join(" "), state, show_dialog: "true" })`.

`exchangeCode`:
- Sends `POST https://accounts.spotify.com/api/token` with:
  - `Authorization: Basic base64(clientId:clientSecret)`
  - `Content-Type: application/x-www-form-urlencoded`
  - body `new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri })`
  - `signal: AbortSignal.timeout(10_000)`. This is an interactive one-off, so it gets longer than the widgets' 5 s.
- Reads the body with `.json().catch(() => ({}))` and maps it to `{ refreshToken: body.refresh_token, accessToken: body.access_token, scopes: (body.scope ?? "").split(" ").filter(Boolean), expiresIn: Number(body.expires_in) }`.
- Throws `SpotifyOAuthError("exchange_failed", ...)` in three cases:
  - `fetchImpl` throws: the message is ``Token exchange failed: ${error.name}``.
  - The response is not OK: the message is ``Token exchange failed with ${status}: ${body.error_description ?? body.error ?? "unknown error"}``.
  - `refresh_token` or `access_token` is missing: the message is `"Token exchange returned no refresh_token or access_token"`.

`fetchSpotifyProfile`:
- Sends `GET https://api.spotify.com/v1/me` with `Authorization: Bearer <token>` and the same 10 s signal.
- `/v1/me` needs no extra scope for `id` and `display_name`.
- Reads the body with `.json().catch(() => ({}))` and returns `{ id: body.id, displayName: body.display_name ?? null }`.
- Throws `SpotifyOAuthError("account_lookup_failed", ...)` in three cases:
  - `fetchImpl` throws: the message is ``Account lookup failed: ${error.name}``.
  - The response is not OK: the message is ``Account lookup failed with ${status}``.
  - `id` is missing: the message is `"Account lookup returned no id"`.

The rest:
- `fetchSpotifyAccountId` returns `(await fetchSpotifyProfile(accessToken, fetchImpl)).id`.
- `missingScopes(granted)` returns `SPOTIFY_SCOPES.filter((scope) => !granted.includes(scope))`.

`lib/admin/owner.js`:

```js
// The site owner, pinned in code rather than in env vars, so a misconfigured
// deployment cannot widen who gets in. Sign-in checks the numeric id only;
// the login is for display, because a GitHub login can be renamed.
export const OWNER_GITHUB_ID = "1741711";
export const OWNER_GITHUB_LOGIN = "dotKevinWong";
export const OWNER_SPOTIFY_ACCOUNT_ID = "<from --whoami>"; // filled in during Task 7 Step 9
export const SITE_ORIGIN = "https://www.kevinwong.co";
export const SITE_HOST = "www.kevinwong.co";
```

- [ ] **Step 4: Use `spotifyCredentials` in `lib/spotify.js`**

In `lib/spotify.js`:
- delete the private `clientCredentials`
- add `import { spotifyCredentials } from "./spotify-oauth.js";`
- call `spotifyCredentials(env)` at the top of `refresh`

The behaviour and the error message are identical, so tests (k) still pin it. This leaves one place for Task 19 to remove the lowercase fallback.

- [ ] **Step 5: Run the unit tests**

`tests/spotify.test.mjs` is Task 6's, and runs here because this task edits `lib/spotify.js`.

```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/spotify-oauth.test.mjs tests/admin-owner.test.mjs tests/spotify.test.mjs
```

Expected:
- `ℹ tests 33`, `ℹ pass 32`
- `ℹ fail 1`. The one failure is `OWNER_SPOTIFY_ACCOUNT_ID has been filled in`, which stays red until Step 9.

- [ ] **Step 6: Update `scripts/spotify-reauth.mjs` and the npm script**

`package.json`: `"spotify:reauth": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/spotify-reauth.mjs"`.

**What stays.** Keep the tab indentation, `PORT = 8888`, `REDIRECT_URI = http://127.0.0.1:8888/callback`, `reply`, the `/callback`-only server, the `?error=` and `state` checks, the `EADDRINUSE` handler and the browser opener.

**What goes.** Remove `SCOPES` (now from `buildAuthorizeUrl`), the local `exchangeCode` (now the library's) and the 183-day estimate (now `AUTHORIZATION_LIFETIME_DAYS`). Import statically from `../lib/spotify-oauth.js`, `../lib/spotify-token.js`, `../lib/admin/owner.js` and `../lib/db.js`. None of them reads `process.env` at import time.

Rewrite the doc comment for the three modes and the `--` rule. The top-level flow, in order:

1. **Load env files.** Run `const fileEnv = loadEnvFiles();`, then copy every key that is missing from `process.env` into it (the loop from `scripts/instagram-sync.mjs`). The real environment wins, and `getDbPool()`, `spotifyCredentials(process.env)` and `process.env.refresh_token` all see `.env`/`.env.local`.
2. **Parse arguments.**
   - The accepted arguments are exactly `--save`, `--whoami`, `--help` and `-h`.
   - Anything else prints `Unknown argument: <args>` and USAGE, then exits 1.
   - `--save` together with `--whoami` prints `Use --whoami or --save, not both.` and exits 1.
   - `--help` or `-h` prints USAGE and exits 0.
   - USAGE:
     ```
     Usage: npm run spotify:reauth -- [option]

       (no option)  Approve in the browser and print the new refresh token
       --save       Approve in the browser, check the scopes and the account,
                    then store the token in Postgres (integration_tokens)
       --whoami     Print which Spotify account the current token belongs to
                    (database row first, else the refresh_token env var); no browser
       --help       Show this message
     ```
3. **Read the credentials.** Call `spotifyCredentials(process.env)` in a `try`. If it throws, print ``Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET (or the older client_id / client_secret). Set them in ${ENV_FILES.join(" or ")} (looked in ${process.cwd()}) or in the environment.`` and exit 1.
4. **`--whoami`.** No server, no browser.
   - Resolve the token source. This rule is not obvious: production lacks `sql/005` until the rollout applies it, after this task, so the read fails with `42703` until then.
     ```js
     let source; // { token, from: "database" | "env" }
     if (process.env.DATABASE_URL) {
     	try {
     		const row = await readSpotifyRow();
     		if (row?.deadReason) await fail(`The stored Spotify token was marked dead (${row.deadReason}). Run \`npm run spotify:reauth -- --save\` or reconnect from /admin.`);
     		if (row?.refreshToken) source = { token: row.refreshToken, from: "database" };
     	} catch (error) {
     		if (error.code !== "42703") await fail(`Could not read the Spotify row: ${error.message}`);
     		console.log("integration_tokens has no Spotify columns yet (sql/005 is not applied); using the refresh_token env var.");
     	}
     } else {
     	console.log("DATABASE_URL is not set; using the refresh_token env var.");
     }
     source ??= process.env.refresh_token ? { token: process.env.refresh_token, from: "env" } : null;
     if (!source) await fail("No Spotify row and no refresh_token env var: nothing to check.");
     ```
   - Refresh with a local `refreshAccessToken(refreshToken, { clientId, clientSecret })`. It sends the same POST as `lib/spotify.js` with a 10 s signal. The duplication is deliberate: `lib/spotify.js`'s refresh is private to `createSpotifyClient`, whose cache, dead latch and store writes a one-shot check must not share. Do not move it into `lib/spotify-oauth.js`. Keep its failure texts the same as `lib/spotify.js`'s, without the `[spotify]` prefix.
     - `invalid_grant` fails with `Spotify rejected the refresh token (invalid_grant): it has expired or been revoked. Run \`npm run spotify:reauth -- --save\`.`
     - Any other non-OK response, or a missing `access_token`, fails with ``Token refresh failed with ${status}: ${body.error ?? "unknown error"}``.
   - If the response carries a different `refresh_token`:
     - for a `database` source, call `storeRotatedRefreshToken(old, new)` and print `Spotify rotated the refresh token; stored the new one.` or `Spotify rotated the refresh token, but the stored one had already changed.`
     - for an `env` source, print `Spotify rotated the refresh token held in the env var; the env copy may now be stale.`
   - Then `const { id, displayName } = await fetchSpotifyProfile(accessToken)` and print three lines:
     ```
     Token source:       database row | refresh_token env var
     Spotify account id: <id>
     Display name:       <displayName ?? "(none)">
     ```
   - End the pool. Exit 0.
5. **`--save` pre-check, before the browser opens.**
   - `const databaseUrl = requireEnv("DATABASE_URL", fileEnv);`.
   - Print ``--save will write to the database at ${new URL(databaseUrl).hostname}.`` That line is what lets Kevin stop a run pointed at the wrong database.
6. **Loopback flow.** Build the URL with `buildAuthorizeUrl({ clientId, redirectUri: REDIRECT_URI, state })`. In the callback, after the state check, run `const tokens = await exchangeCode({ code, redirectUri: REDIRECT_URI, clientId, clientSecret })`, then `const missing = missingScopes(tokens.scopes)`.
   - **Without `--save`.** Print the token as today. Then print, in order:
     - `Granted scopes: ...`
     - `Missing scopes: ...`, only when `missing` is non-empty
     - `Expires around: <YYYY-MM-DD> (estimated: 180 days)`
     - this closing text:
       ```
       Store it with `npm run spotify:reauth -- --save` next time, or reconnect at https://www.kevinwong.co/admin.
       Until the database has a Spotify row, the site reads the `refresh_token` env var: set it in .env
       (and .env.local, which overrides .env) and in the Vercel project's env vars, then redeploy.
       ```
   - **With `--save`.** The token is never printed. Steps, in order:
     - A non-empty `missing` prints `Spotify did not grant: <missing>. Nothing was saved.` and sets exit code 1.
     - Run `const accountId = await fetchSpotifyAccountId(tokens.accessToken)`. A `SpotifyOAuthError` prints `Could not read the Spotify account (account_lookup_failed). Nothing was saved.` and sets exit 1.
     - If `accountId !== OWNER_SPOTIFY_ACCOUNT_ID`, print `Approved as Spotify account ${accountId}, not the site owner's (${OWNER_SPOTIFY_ACCOUNT_ID}). Nothing was saved.` and set exit 1.
     - Otherwise run `const { expiresAt } = await saveSpotifyAuthorization({ refreshToken: tokens.refreshToken, accountId, scopes: tokens.scopes })`.
       - On success, print `Saved to integration_tokens (provider "spotify"). Estimated expiry: <YYYY-MM-DD>. The site picks it up within a minute; no redeploy needed.`
       - On failure, print ``Could not save: ${error.message}. Nothing was saved.`` and set exit 1.
     - The browser reply is `Done. Check your terminal.` in every case.
   - Any `exchangeCode` failure keeps today's branch: `reply(res, 500, "Token exchange failed — check your terminal.")`, print `error.message`, exit code 1.
7. **Cleanup.** Every path that touched the database ends the pool before exiting: `await getDbPool().end()`, behind a `usedDb` flag. A `fail(message)` helper prints, ends the pool, then calls `process.exit(1)`.

- [ ] **Step 7: Check the script offline**

Run these from the worktree root; npm runs scripts there, and `loadEnvFiles()` reads `.env` and `.env.local` from it. It must have neither (both are git-ignored). If either exists, stop and tell Kevin: the fourth command would load its credentials instead of printing the Missing message.

```
npm run spotify:reauth -- --help
```
Expected: the USAGE text, exit 0, and no `MODULE_TYPELESS_PACKAGE_JSON` warning.

```
npm run spotify:reauth -- --bogus; echo "exit=$?"
```
Expected: `Unknown argument: --bogus`, then `exit=1`.

```
npm run spotify:reauth -- --whoami --save; echo "exit=$?"
```
Expected: `Use --whoami or --save, not both.`, then `exit=1`.

```
env -u SPOTIFY_CLIENT_ID -u SPOTIFY_CLIENT_SECRET -u client_id -u client_secret npm run spotify:reauth -- --whoami; echo "exit=$?"
```
Expected: `Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET (or the older client_id / client_secret)...`, then `exit=1`.

Then `npm run lint` must exit 0.

- [ ] **Step 8: Kevin finds his Spotify account id**

**Kevin:** use either way below, then send the implementer only the account id. An account id is not a secret.

**A. `--whoami`.** It also proves the script and the credentials work. Run it in a terminal, from the root of the worktree the implementer is using (the implementer gives you the path). It reads production once (one `select`) and refreshes an access token. It saves nothing, except a rotated refresh token, which it stores by compare-and-swap. The `.env` link exists only for this one command:

```
test ! -e .env && ln -s /Users/Kevin/Git/kevinwong.co/.env .env && { nvm use --silent; npm run spotify:reauth -- --whoami; }
[ -L .env ] && rm .env
```

The first line does nothing if the worktree already has a `.env` (it should have none; `.env` is git-ignored). The second removes `.env` only when it is a link, so a real `.env` is never deleted.

Expected output, while `sql/005` is not yet applied to production:

```
integration_tokens has no Spotify columns yet (sql/005 is not applied); using the refresh_token env var.
Token source:       refresh_token env var
Spotify account id: <id>
Display name:       <your name>
```

**B. No secrets touched.** In the Spotify app: **Profile** → **⋯** → **Share** → **Copy link to profile**. The link looks like `https://open.spotify.com/user/<id>?si=…`. The id is the path segment after `/user/`, without the `?si=…` part.

- [ ] **Step 9: Fill in the owner's Spotify account id and run the task's tests**

Replace `"<from --whoami>"` in `lib/admin/owner.js` with the id Kevin sent, and delete the trailing comment. Then:

```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/spotify-oauth.test.mjs tests/admin-owner.test.mjs tests/spotify.test.mjs
```

Expected: `ℹ tests 33`, `ℹ pass 33`.

Then `npm test` ends with `ℹ fail 0` and `ℹ cancelled 0`, and `npm run lint` exits 0.

- [ ] **Step 10: Commit**

`ls .env` must fail with `No such file or directory`: a leftover link would point later builds at production. Then run `git status --short`; it must list only the paths below (`docs/` is committed since 75db873).

```
git add lib/spotify-oauth.js lib/admin/owner.js lib/spotify.js scripts/spotify-reauth.mjs package.json tests/spotify-oauth.test.mjs tests/admin-owner.test.mjs
git commit -m "Add Spotify OAuth helpers and let the reauth script save to the database"
```

---

### Task 8: Instagram token compare-and-swap

**Model:** Opus
**Files:**
- Modify: `lib/instagram.js` (`markTokenDead`, `ensureFreshToken`; add `storeRefreshedToken`; `storeToken`
  unchanged)
- Create: `tests/helpers/fetch-stub.mjs`
- Test: `tests/integration/instagram-token.test.mjs`

**Context for Tasks 8–10.** These run on branch `claude/admin-panel`, rebased on the merged audit (Task 1). Paths are repo-relative. `lib/instagram.js`, `pages/api/cron/sync-instagram.js` and `scripts/instagram-sync.mjs` were changed by the audit, so they are cited by function name only. An integration test that reaches code calling `getDbPool()` sets `process.env.DATABASE_URL = process.env.TEST_DATABASE_URL` at module top level, right after `testDb()`. `lib/db.js` opens its pool on the first `getDbPool()` call, inside hooks and tests, so the pool always opens on the local test database. The assignment runs after `tests/helpers/db.mjs` has passed its import-time guard, and every test command runs under `env -u DATABASE_URL`. Graph and the Instagram CDN are stubbed with `t.mock.method(globalThis, "fetch", ...)`, which `node:test` restores after each test.

**Interfaces:**
- Consumes:
  - `getDbPool()` from `lib/db.js`, which uses `sslFor(connectionString)` (Task 1): no TLS for `localhost`,
    `127.0.0.1`, `::1`.
  - `sql/005_integration_tokens_spotify.sql` applied by the test schema (Task 3): `integration_tokens.access_token`
    is nullable and a CHECK requires an access or refresh token. Instagram rows always carry `access_token`.
  - `tests/helpers/db.mjs` (Task 2): `testDb()` returns one shared object per process,
    `{ skip: false | string, pool: pg.Pool | null, resetSchema({ applyMigrations = true } = {}): Promise<number>, close(): Promise<void> }`.
    `skip` is a reason string when `TEST_DATABASE_URL` is unset (the module loads it from `.env.test.local`);
    `pool` is on `TEST_DATABASE_URL`; `resetSchema()` rebuilds `public` from `tests/fixtures/prod-schema.sql` and
    applies every `sql/005+` file. Usage: `describe(name, { skip: db.skip }, () => { before(() => db.resetSchema()); after(() => db.close()); ... })`.
    At import time it throws `Error("Refusing to run integration tests: DATABASE_URL points at a remote database")`
    when `DATABASE_URL` is set and `sslFor(DATABASE_URL) !== false`.
  - Existing exports of `lib/instagram.js`: `PROVIDER = "instagram"`, `InstagramReauthRequiredError`,
    `storeToken({ accessToken, expiresInSeconds, expiryIsAssumed = false })`, `ensureFreshToken()`,
    `fetchRecentMedia({ accessToken, maxPosts = 50 })`.
- Produces:
  - `export async function storeRefreshedToken({ previousToken, accessToken, expiresInSeconds }): Promise<boolean>`
    in `lib/instagram.js`.
  - `markTokenDead(reason, accessToken)` (still private): no token, no write; the write is
    `... where provider = $1 and access_token = $3`; returns `true` only when exactly one row changed.
  - `tests/helpers/fetch-stub.mjs`: `export function stubFetch(t, routes)` where `routes` maps
    `origin + pathname` to `(url: URL) => Response | Promise<Response>`; an unlisted URL throws
    `Error("unexpected fetch: <origin><pathname>")` (no query string, so no token in the message). Returns the
    `mock.method` result, so `stub.mock.callCount()` works.

- [ ] **Step 1: Write the fetch helper and the failing test**

`tests/helpers/fetch-stub.mjs`: `stubFetch(t, routes)` as specified under Produces, built on
`t.mock.method(globalThis, "fetch", async (input) => ...)`, reading the URL from
`input instanceof Request ? input.url : String(input)`.

`tests/integration/instagram-token.test.mjs`. Use a namespace import so the missing `storeRefreshedToken`
fails its own tests in Step 2 instead of failing the whole file at link time:

```js
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as instagram from "../../lib/instagram.js";
import { getDbPool } from "../../lib/db.js";
import { testDb } from "../helpers/db.mjs";
import { stubFetch } from "../helpers/fetch-stub.mjs";

const db = testDb();
// lib/instagram.js uses getDbPool(), whose pool opens on first use (inside the tests): point it at the
// local test database. tests/helpers/db.mjs has already refused a remote DATABASE_URL at import.
if (!db.skip) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const GRAPH = "https://graph.instagram.com";
const REFRESH = `${GRAPH}/refresh_access_token`;
const ME = `${GRAPH}/v25.0/me`;
const MEDIA = `${GRAPH}/v25.0/me/media`;
const DAY = 86_400;
const graph190 = () =>
  Response.json({ error: { code: 190, type: "OAuthException", message: "Error validating access token" } }, { status: 400 });
const refreshed = (token) => Response.json({ access_token: token, token_type: "bearer", expires_in: 5_184_000 });

describe("Instagram token compare-and-swap (integration)", { skip: db.skip }, () => {
  const tokenRow = async () => (await db.pool.query(
    `select access_token, expires_at, refreshed_at, dead_reason, expires_at_is_assumed
       from integration_tokens where provider = 'instagram'`)).rows[0];
  const seed = (accessToken) => instagram.storeToken({ accessToken, expiresInSeconds: 60 * DAY });
  // Due for a refresh: past the 25-hour floor and inside the 30-day window.
  async function seedDue(accessToken) {
    await instagram.storeToken({ accessToken, expiresInSeconds: 10 * DAY });
    await db.pool.query(`update integration_tokens set refreshed_at = now() - interval '26 hours' where provider = 'instagram'`);
  }
  // What `npm run instagram:token` does: an unconditional upsert of a new token.
  const reseed = (accessToken) => instagram.storeToken({ accessToken, expiresInSeconds: 60 * DAY, expiryIsAssumed: true });

  before(() => db.resetSchema());
  beforeEach(() => db.pool.query("delete from integration_tokens"));
  after(async () => { await getDbPool().end(); await db.close(); });

  test("storeRefreshedToken updates the row when it still holds the previous token", async () => {
    await reseed("T1"); // stores expires_at_is_assumed = true, so the final assertion proves the update resets it
    const ok = await instagram.storeRefreshedToken({ previousToken: "T1", accessToken: "T1b", expiresInSeconds: 5_184_000 });
    assert.equal(ok, true);
    const row = await tokenRow();
    assert.equal(row.access_token, "T1b");
    assert.equal(row.expires_at_is_assumed, false);
    assert.ok(Math.abs(row.expires_at.getTime() - (Date.now() + 5_184_000_000)) < 60_000);
  });

  test("storeRefreshedToken returns false and writes nothing when the row holds another token", async () => {
    await seed("T2");
    const original = await tokenRow();
    const ok = await instagram.storeRefreshedToken({ previousToken: "T1", accessToken: "T1b", expiresInSeconds: 5_184_000 });
    assert.equal(ok, false);
    assert.deepEqual(await tokenRow(), original);
  });

  test("storeRefreshedToken returns false and writes nothing when the row is marked dead", async () => {
    await seed("T1");
    await db.pool.query(`update integration_tokens set dead_reason = 'marked by another run' where provider = 'instagram'`);
    const ok = await instagram.storeRefreshedToken({ previousToken: "T1", accessToken: "T1b", expiresInSeconds: 5_184_000 });
    assert.equal(ok, false);
    const row = await tokenRow();
    assert.equal(row.access_token, "T1");
    assert.equal(row.dead_reason, "marked by another run");
  });

  test("a refresh with no race stores the refreshed token", async (t) => {
    await seedDue("T1");
    stubFetch(t, { [REFRESH]: () => refreshed("T1b") });
    t.mock.method(console, "log", () => {});
    assert.equal(await instagram.ensureFreshToken(), "T1b");
    const row = await tokenRow();
    assert.equal(row.access_token, "T1b");
    assert.equal(row.dead_reason, null);
    assert.ok(Date.now() - row.refreshed_at.getTime() < 60_000);
  });

  test("a refresh that races a reseed does not overwrite the reseeded token", async (t) => {
    await seedDue("T1");
    stubFetch(t, { [REFRESH]: async () => { await reseed("T2"); return refreshed("T1b"); } });
    const warn = t.mock.method(console, "warn", () => {});
    assert.equal(await instagram.ensureFreshToken(), "T1b"); // this run still uses its refreshed token
    const row = await tokenRow();
    assert.equal(row.access_token, "T2");
    assert.equal(row.expires_at_is_assumed, true);
    assert.equal(row.dead_reason, null);
    assert.equal(warn.mock.callCount(), 1);
  });

  test("a refresh does not clear a dead flag set while it was in flight", async (t) => {
    await seedDue("T1");
    stubFetch(t, {
      [REFRESH]: async () => {
        await db.pool.query(`update integration_tokens set dead_reason = 'marked by another run' where provider = 'instagram'`);
        return refreshed("T1b");
      },
    });
    t.mock.method(console, "warn", () => {});
    assert.equal(await instagram.ensureFreshToken(), "T1b");
    const row = await tokenRow();
    assert.equal(row.access_token, "T1");
    assert.equal(row.dead_reason, "marked by another run");
  });

  test("a 190 on an old token does not mark a newer token dead", async (t) => {
    await seed("T2");
    const fetchStub = stubFetch(t, { [MEDIA]: graph190, [ME]: graph190 });
    t.mock.method(console, "warn", () => {});
    await assert.rejects(
      instagram.fetchRecentMedia({ accessToken: "T1", maxPosts: 1 }),
      (error) => !(error instanceof instagram.InstagramReauthRequiredError) && /code=190/.test(error.message)
    );
    assert.equal((await tokenRow()).dead_reason, null);
    assert.equal(fetchStub.mock.callCount(), 2); // the media call, then the confirmation
  });

  test("a 190 during a refresh that races a reseed does not mark the reseeded token dead", async (t) => {
    await seedDue("T1");
    stubFetch(t, { [REFRESH]: async () => { await reseed("T2"); return graph190(); }, [ME]: graph190 });
    t.mock.method(console, "warn", () => {});
    assert.equal(await instagram.ensureFreshToken(), "T1"); // not latched: the old token comes back, as today
    const row = await tokenRow();
    assert.equal(row.access_token, "T2");
    assert.equal(row.dead_reason, null);
  });

  test("a confirmed 190 on the stored token still marks it dead", async (t) => {
    await seed("T1");
    stubFetch(t, { [MEDIA]: graph190, [ME]: graph190 });
    t.mock.method(console, "error", () => {});
    await assert.rejects(instagram.fetchRecentMedia({ accessToken: "T1", maxPosts: 1 }), instagram.InstagramReauthRequiredError);
    assert.match((await tokenRow()).dead_reason, /^HTTP 400 code=190 /);
  });

  test("markTokenDead without a token does not latch", async (t) => {
    await seed("T1");
    const fetchStub = stubFetch(t, { [MEDIA]: graph190 });
    t.mock.method(console, "warn", () => {});
    await assert.rejects(
      instagram.fetchRecentMedia({ accessToken: "", maxPosts: 1 }),
      (error) => !(error instanceof instagram.InstagramReauthRequiredError)
    );
    assert.equal(fetchStub.mock.callCount(), 1); // no confirmation request
    assert.equal((await tokenRow()).dead_reason, null);
  });
});
```

`markTokenDead` is private, so the last test reaches it the only way a falsy token can: `graphGet` with an empty
`accessToken`. Today that path skips the confirmation and latches unconditionally.

- [ ] **Step 2: Run it to verify it fails**

```sh
env -u DATABASE_URL node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/integration/instagram-token.test.mjs
```

Expected: `ℹ tests 10`, `ℹ pass 2`, `ℹ fail 8`, `ℹ cancelled 0`. The three `storeRefreshedToken` tests fail with
`TypeError: instagram.storeRefreshedToken is not a function`; "races a reseed" fails on `access_token`
(`'T1b'` vs `'T2'`); "dead flag" fails on `access_token` (`'T1b'` vs `'T1'`); "old token", "during a refresh" and "without
a token" fail because `T2`/`T1` was marked dead (or `InstagramReauthRequiredError` was thrown). The two passing
tests are the no-race refresh and the confirmed 190 on the stored token.

- [ ] **Step 3: Implement the compare-and-swap in `lib/instagram.js`**

`storeRefreshedToken({ previousToken, accessToken, expiresInSeconds })`: computes
`expiresAt = new Date(Date.now() + expiresInSeconds * 1000)` like `storeToken`, runs this statement and returns
`rowCount === 1`:

```sql
update integration_tokens
   set access_token          = $3,
       expires_at            = $4,
       refreshed_at          = now(),
       expires_at_is_assumed = false,
       updated_at            = now()
 where provider = $1
   and access_token = $2
   and dead_reason is null
-- params: [PROVIDER, previousToken, accessToken, expiresAt]
```

`ensureFreshToken()`: replace the `storeToken(...)` call with
`storeRefreshedToken({ previousToken: token.accessToken, accessToken: body.access_token, expiresInSeconds: Number(body.expires_in) })`.
- `false` -> `console.warn("[instagram] The stored token changed while this run was refreshing it (re-seeded or marked dead); kept the stored one and using the refreshed token for this run only.")`, then return `body.access_token`.
- `true` -> keep the existing log line, computing the date locally:
  `` `[instagram] Token refreshed; now expires ${new Date(Date.now() + Number(body.expires_in) * 1000).toISOString()}` ``.

`markTokenDead(reason, accessToken)`:
- First line: if `!accessToken`, `console.warn(\`[instagram] Saw a token error (${reason}) with no token to check; not marking anything dead.\`)` and `return false` (no confirmation request, no write).
- The confirmation request is unchanged.
- The write becomes the statement below; `rowCount !== 1` -> `console.warn("[instagram] Saw a confirmed token error, but the stored token has since been replaced; leaving it alone.")` and `return false`. Only on 1 row: the existing `console.error` with recovery steps, `return true`.

```sql
update integration_tokens
   set dead_reason = $2, updated_at = now()
 where provider = $1
   and access_token = $3
-- params: [PROVIDER, reason, accessToken]
```

Add a comment above both statements: compare the token value, never `updated_at`, because a JS `Date` read from
`timestamptz` drops the microseconds and the comparison would never match. `storeToken` stays an unconditional
upsert: it is the deliberate reseed path. Call sites of `markTokenDead` do not change: `ensureFreshToken`
returns the old token when it is not latched, and `graphGet` throws a plain `Error`.

- [ ] **Step 4: Run tests to verify they pass**

```sh
env -u DATABASE_URL node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/integration/instagram-token.test.mjs
env -u DATABASE_URL npm test
```

Expected: the first prints `ℹ tests 10`, `ℹ pass 10`, `ℹ fail 0`, `ℹ cancelled 0`. `npm test` ends with
`ℹ fail 0` and `ℹ cancelled 0`.

- [ ] **Step 5: Commit**

```sh
git add lib/instagram.js tests/helpers/fetch-stub.mjs tests/integration/instagram-token.test.mjs
git commit -m "Stop Instagram token writes from overwriting a newer token"
```

---

### Task 9: Sync run recording and the 30-day upload ceiling

**Model:** Opus
**Files:**
- Create: `lib/sync-runs.js`
- Modify: `lib/instagram-sync.js` (`syncInstagram`; new private `performSync`, `recordSafely` and
  `UploadNotRecordedError`; `runSync` takes `upload` and `onUpload`; imports),
  `pages/api/cron/sync-instagram.js` (`handler`), `scripts/instagram-sync.mjs` (the `syncInstagram({...})` call
  and the `USAGE` text)
- Test: `tests/sync-runs.test.mjs` (unit), `tests/integration/sync-runs.test.mjs`,
  `tests/integration/instagram-sync-runs.test.mjs`

**Interfaces:**
- Consumes:
  - `redact(value: unknown): unknown` and `capJson(value: unknown, maxBytes = 16_000): unknown` from
    `lib/redact.js` (Task 4). `redact` returns a deep copy; it replaces secrets with `[redacted]`.
  - `sql/006_sync_runs.sql` (Task 3): `sync_runs(id bigint` identity primary key (pg returns it as a string),
    `job text not null`, `trigger text not null` (CHECK in `cron, panel, cli`), `dry_run boolean not null`,
    `status text not null default 'running'` (CHECK in
    `running, ok, partial, skipped, failed, reauth_required, abandoned`), `started_at timestamptz not null default now()`,
    `finished_at timestamptz`, `fetched`, `imported`, `uploads`, `deferred`, `skipped`, `error_count`, all
    `integer not null default 0`, `error text`, `summary jsonb)`. `job_locks(name, locked_until)` from `sql/004`.
  - `getDbPool()` (Task 1); `testDb()` and its import-time guard (Task 2, as listed in Task 8);
    `stubFetch(t, routes)` from `tests/helpers/fetch-stub.mjs` (Task 8).
  - `lib/instagram.js`: `ensureFreshToken()`, `storeToken(...)`, `InstagramReauthRequiredError` (Task 8 version).
  - `lib/blob-store.js` (the audit's): `uploadToBlob(pathname, buffer, contentType)` returns
    `{ url, pathname, contentType }`; it is the default `upload`.
- Produces (later tasks rely on these exact names):
  - `lib/sync-runs.js`: `UPLOAD_CEILING_30D = 1800`; `startRun({ job, trigger, dryRun }, db?) -> Promise<number>`;
    `statusFromSummary(summary) -> "ok" | "partial" | "skipped"` (`"skipped"` when `leaseHeld`, `ceilingReached`
    or `notRecorded` is set);
    `incrementRunUploads(id, n = 1, db?) -> Promise<void>` (`uploads = uploads + n`);
    `finishRun(id, { status, summary, error }, db?) -> Promise<void>` (writes `uploads = greatest(uploads, summary.uploads)`,
    so it never lowers what `incrementRunUploads` recorded);
    `uploadsInLastDays(days, db?) -> Promise<number>`;
    `recentRuns({ job = "instagram", limit = 20 } = {}, db?) -> Run[]`;
    `lastRun({ job = "instagram", trigger, dryRun }, db?) -> Run | null`;
    and one addition the skeleton does not list, used only inside this task:
    `uploadAllowance(maxUploads: number, usedLast30Days: number) -> number`.
  - `Run = { id: number, trigger: "cron" | "panel" | "cli", dryRun: boolean, status: string, startedAt: Date, finishedAt: Date | null, fetched: number, imported: number, uploads: number, deferred: number, skipped: number, errorCount: number, error: string | null }`.
    `id` is mapped with `Number()` before it leaves the module, as is `startRun`'s return value. Dates are
    `Date` objects; `buildAdminStatus` (Task 15) converts them to ISO strings.
  - `syncInstagram({ maxPosts, maxUploads, dryRun, timeBudgetMs, trigger = "cli", upload = uploadToBlob })`:
    `upload` is a test seam with `uploadToBlob`'s signature; production callers never pass it. The summary gains
    `leaseHeld?: true`, `ceilingReached?: true` and `notRecorded?: true`. Every call writes one `sync_runs` row
    (job `"instagram"`) unless recording itself fails. Each successful upload is added to the row's `uploads` as
    it lands. A real run whose `startRun` failed stands down after the token refresh with `notRecorded: true` and
    `skipped: [{ id: "run", reason: "run could not be recorded" }]`, and uploads nothing. A real run whose upload
    count can't be written stops and throws (recorded `failed` if the database allows). The lease is released
    only after the row is final.

- [ ] **Step 1: Write the failing tests for `lib/sync-runs.js`**

`tests/sync-runs.test.mjs` (unit, no database):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { UPLOAD_CEILING_30D, statusFromSummary, uploadAllowance } from "../lib/sync-runs.js";

test("the 30-day upload ceiling is 1,800", () => assert.equal(UPLOAD_CEILING_30D, 1800));
test("statusFromSummary is ok when nothing went wrong", () =>
  assert.equal(statusFromSummary({ errors: [], skipped: [] }), "ok"));
test("statusFromSummary is ok when only individual posts were skipped", () =>
  assert.equal(statusFromSummary({ errors: [], skipped: [{ id: "B", reason: "no usable media" }] }), "ok"));
test("statusFromSummary is partial when any post failed", () =>
  assert.equal(statusFromSummary({ errors: [{ id: "A", error: "Download failed: HTTP 404" }], skipped: [] }), "partial"));
test("statusFromSummary is skipped when the lease was held", () =>
  assert.equal(statusFromSummary({ leaseHeld: true, errors: [], skipped: [{ id: "run", reason: "another sync is already running" }] }), "skipped"));
test("statusFromSummary is skipped when the ceiling was reached, even with errors", () =>
  assert.equal(statusFromSummary({ ceilingReached: true, errors: [{ id: "A", error: "x" }], skipped: [] }), "skipped"));
test("statusFromSummary is skipped when the run could not be recorded", () =>
  assert.equal(statusFromSummary({ notRecorded: true, errors: [], skipped: [{ id: "run", reason: "run could not be recorded" }] }), "skipped"));
test("uploadAllowance caps maxUploads to what is left under the ceiling", () => {
  assert.equal(uploadAllowance(25, 0), 25);
  assert.equal(uploadAllowance(25, 1790), 10);
  assert.equal(uploadAllowance(500, 1799), 1);
  assert.equal(uploadAllowance(25, 1800), 0);
  assert.equal(uploadAllowance(25, 2400), 0);
});
```

`tests/integration/sync-runs.test.mjs` (`db` passed explicitly, so no `DATABASE_URL` is involved):

```js
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "../helpers/db.mjs";
import { finishRun, incrementRunUploads, lastRun, recentRuns, startRun, uploadsInLastDays } from "../../lib/sync-runs.js";

const db = testDb();
const RUN_KEYS = ["deferred", "dryRun", "error", "errorCount", "fetched", "finishedAt", "id", "imported",
  "skipped", "startedAt", "status", "trigger", "uploads"];
const emptySummary = () => ({ fetched: 0, alreadyPresent: 0, inserted: [], uploads: 0, deferred: 0, skipped: [], warnings: [], errors: [] });

describe("sync-runs (integration)", { skip: db.skip }, () => {
  const pool = db.pool;
  const row = async (id) => (await pool.query("select * from sync_runs where id = $1", [id])).rows[0];
  const start = (trigger = "cron", dryRun = false) => startRun({ job: "instagram", trigger, dryRun }, pool);
  async function insertRun({ trigger = "cron", dryRun = false, status = "ok", ago = "1 hour", uploads = 0 } = {}) {
    const { rows } = await pool.query(
      `insert into sync_runs (job, trigger, dry_run, status, started_at, finished_at, uploads)
       values ('instagram', $1, $2, $3, now() - $4::interval,
               case when $3 = 'running' then null else now() - $4::interval end, $5)
       returning id`, [trigger, dryRun, status, ago, uploads]);
    return Number(rows[0].id);
  }
  const setLease = (offset) => pool.query(
    `insert into job_locks (name, locked_until) values ('instagram-sync', now() + $1::interval)
     on conflict (name) do update set locked_until = excluded.locked_until`, [offset]);

  before(() => db.resetSchema());
  beforeEach(async () => { await pool.query("delete from sync_runs"); await pool.query("delete from job_locks"); });
  after(() => db.close());

  test("startRun inserts a running row and returns its numeric id", async () => {
    const id = await start("cron", false);
    assert.equal(typeof id, "number");
    const r = await row(id);
    assert.deepEqual([r.job, r.trigger, r.dry_run, r.status, r.finished_at], ["instagram", "cron", false, "running", null]);
    assert.ok(Date.now() - r.started_at.getTime() < 60_000);
  });

  test("finishRun records the counts from the summary", async () => {
    const id = await start("panel", false);
    const summary = { ...emptySummary(), fetched: 7, alreadyPresent: 4, inserted: [{ shortcode: "A" }, { shortcode: "B" }],
      uploads: 5, deferred: 1, skipped: [{ id: "C", reason: "no usable media" }],
      errors: [{ id: "D", error: "Download failed: HTTP 404" }] };
    await finishRun(id, { status: "partial", summary }, pool);
    const r = await row(id);
    assert.deepEqual(
      [r.status, r.fetched, r.imported, r.uploads, r.deferred, r.skipped, r.error_count, r.error],
      ["partial", 7, 2, 5, 1, 1, 1, null]);
    assert.ok(r.finished_at instanceof Date);
    assert.equal(r.summary.fetched, 7);
    assert.deepEqual(r.summary.errors, [{ id: "D", error: "Download failed: HTTP 404" }]);
  });

  test("incrementRunUploads adds to uploads, and finishRun never lowers the count", async () => {
    const id = await start("cli", false);
    await incrementRunUploads(id, 1, pool);
    await incrementRunUploads(id, 2, pool);
    assert.equal((await row(id)).uploads, 3);
    await finishRun(id, { status: "failed", summary: { ...emptySummary(), uploads: 1 }, error: "stopped" }, pool);
    const r = await row(id);
    assert.deepEqual([r.status, r.uploads], ["failed", 3]);
  });

  test("finishRun redacts the error and the stored summary, and leaves the caller's summary alone", async () => {
    const id = await start("cli", false);
    const summary = { ...emptySummary(), errors: [{ id: "run", error: "GET /me?access_token=IGQVJsecretvalue123 failed" }] };
    const copy = structuredClone(summary);
    await finishRun(id, { status: "failed", summary, error: "Authorization: Bearer abc.def.ghi was rejected" }, pool);
    const r = await row(id);
    assert.ok(!r.error.includes("abc.def.ghi"));
    assert.match(r.error, /\[redacted\]/);
    assert.ok(!JSON.stringify(r.summary).includes("IGQVJsecretvalue123"));
    assert.deepEqual(summary, copy);
  });

  test("finishRun stores a size-capped summary", async () => {
    const id = await start();
    const warnings = Array.from({ length: 1000 }, (_, i) => ({ id: `post ${i} slide 0`, warning: "could not read jpeg dimensions; frame will be square" }));
    await finishRun(id, { status: "ok", summary: { ...emptySummary(), warnings } }, pool);
    assert.equal((await row(id)).summary.truncated, true);
  });

  test("startRun marks a stale running row abandoned when the lease has expired", async () => {
    const stale = await insertRun({ status: "running", ago: "20 minutes" });
    await setLease("-1 minute");
    await start();
    const r = await row(stale);
    assert.equal(r.status, "abandoned");
    assert.ok(r.finished_at instanceof Date);
  });

  test("startRun treats a missing lease row as expired", async () => {
    const stale = await insertRun({ status: "running", ago: "20 minutes" });
    await start();
    assert.equal((await row(stale)).status, "abandoned");
  });

  test("startRun leaves a stale running row alone while the lease is held", async () => {
    const stale = await insertRun({ status: "running", ago: "20 minutes" });
    await setLease("5 minutes");
    await start();
    assert.equal((await row(stale)).status, "running");
  });

  test("startRun leaves a running row younger than 15 minutes alone", async () => {
    const young = await insertRun({ status: "running", ago: "14 minutes" });
    await start();
    assert.equal((await row(young)).status, "running");
  });

  test("a run swept as abandoned still records its real outcome when it finishes", async () => {
    const id = await insertRun({ status: "running", ago: "20 minutes" });
    await start();
    await finishRun(id, { status: "ok", summary: emptySummary() }, pool);
    assert.equal((await row(id)).status, "ok");
  });

  test("uploadsInLastDays sums real runs inside the window and ignores dry runs", async () => {
    assert.equal(await uploadsInLastDays(30, pool), 0);
    await insertRun({ uploads: 100, ago: "1 day" });
    await insertRun({ uploads: 7, ago: "1 minute" });
    await insertRun({ uploads: 500, dryRun: true, ago: "1 day" });
    await insertRun({ uploads: 40, ago: "31 days" });
    assert.equal(await uploadsInLastDays(30, pool), 107);
  });

  test("recentRuns returns newest first, camelCase, without the summary", async () => {
    await insertRun({ trigger: "cron", ago: "3 hours" });
    const middle = await insertRun({ trigger: "panel", dryRun: true, ago: "2 hours" });
    const newest = await insertRun({ trigger: "cli", ago: "1 hour" });
    const runs = await recentRuns({ limit: 2 }, pool);
    assert.deepEqual(runs.map((r) => r.id), [newest, middle]);
    assert.deepEqual(Object.keys(runs[0]).sort(), RUN_KEYS);
    assert.equal(runs[1].dryRun, true);
    assert.ok(runs[0].startedAt instanceof Date);
  });

  test("lastRun filters by trigger and dryRun", async () => {
    const cronReal = await insertRun({ trigger: "cron", ago: "3 hours" });
    const panelDry = await insertRun({ trigger: "panel", dryRun: true, ago: "2 hours" });
    const cronDry = await insertRun({ trigger: "cron", dryRun: true, ago: "1 hour" });
    assert.equal((await lastRun({ trigger: "cron", dryRun: false }, pool)).id, cronReal);
    assert.equal((await lastRun({ trigger: "panel" }, pool)).id, panelDry);
    assert.equal((await lastRun({}, pool)).id, cronDry);
    assert.equal(await lastRun({ trigger: "panel", dryRun: false }, pool), null);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```sh
env -u DATABASE_URL node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/sync-runs.test.mjs tests/integration/sync-runs.test.mjs
```

Expected: both files fail to load with `ERR_MODULE_NOT_FOUND` for `lib/sync-runs.js`, and each counts as one
failed test: `ℹ tests 2`, `ℹ fail 2`.

- [ ] **Step 3: Implement `lib/sync-runs.js`**

Imports `getDbPool` from `./db.js` and `{ redact, capJson }` from `./redact.js`. Every function takes `db`
last, defaulting to `getDbPool()`. `statusFromSummary` (`"skipped"` if `leaseHeld`, `ceilingReached` or
`notRecorded`, else `"partial"` if `errors` is non-empty, else `"ok"`) and `uploadAllowance`
(`Math.max(0, Math.min(maxUploads, UPLOAD_CEILING_30D - usedLast30Days))`) are pure. Row mapping is a private
`toRun(row)` producing exactly the `Run` keys, with `id: Number(row.id)` (`sync_runs.id` is `bigint`, which pg
returns as a string). Exact SQL:

```sql
-- startRun, statement 1 (the sweep). Only the instagram job exists in v1, and its lease is 'instagram-sync'.
update sync_runs
   set status = 'abandoned', finished_at = now()
 where job = $1
   and status = 'running'
   and started_at < now() - interval '15 minutes'
   and not exists (select 1 from job_locks
                    where name = 'instagram-sync' and locked_until >= now())
-- startRun, statement 2; return Number(rows[0].id)
insert into sync_runs (job, trigger, dry_run, status, started_at)
values ($1, $2, $3, 'running', now())
returning id

-- incrementRunUploads. syncInstagram awaits it after every successful upload, so a run that is killed
-- partway (Ctrl-C, OOM, maxDuration) has already counted what it spent.
update sync_runs set uploads = uploads + $2 where id = $1
-- params: [id, n]

-- finishRun. Unconditional on status, so a run the sweep marked abandoned still records its real outcome.
-- greatest() keeps the count incrementRunUploads built up if the summary's is lower.
update sync_runs
   set status = $2, finished_at = now(),
       fetched = $3, imported = $4, uploads = greatest(uploads, $5), deferred = $6, skipped = $7, error_count = $8,
       summary = $9::jsonb, error = $10
 where id = $1
-- params: [id, status, s?.fetched ?? 0, s?.inserted?.length ?? 0, s?.uploads ?? 0, s?.deferred ?? 0,
--          s?.skipped?.length ?? 0, s?.errors?.length ?? 0,
--          s == null ? null : JSON.stringify(capJson(redact(s))),
--          error == null ? null : redact(String(error))]

-- uploadsInLastDays. Every job counts: they all spend the same Blob allowance.
select coalesce(sum(uploads), 0)::integer as total
  from sync_runs
 where dry_run = false
   and started_at >= now() - make_interval(days => $1::integer)

-- recentRuns: ... where job = $1 order by started_at desc, id desc limit $2
-- lastRun
select id, trigger, dry_run, status, started_at, finished_at, fetched, imported, uploads,
       deferred, skipped, error_count, error
  from sync_runs
 where job = $1
   and ($2::text is null or trigger = $2)
   and ($3::boolean is null or dry_run = $3)
 order by started_at desc, id desc
 limit 1
-- params: [job, trigger ?? null, dryRun ?? null]
```

`recentRuns` selects the same column list as `lastRun` (never `summary`).

- [ ] **Step 4: Run them to verify they pass**

```sh
env -u DATABASE_URL node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/sync-runs.test.mjs tests/integration/sync-runs.test.mjs
```

Expected: `ℹ tests 21` (8 unit, 13 integration), `ℹ pass 21`, `ℹ fail 0`, `ℹ cancelled 0`.

- [ ] **Step 5: Commit**

```sh
git add lib/sync-runs.js tests/sync-runs.test.mjs tests/integration/sync-runs.test.mjs
git commit -m "Add helpers that record sync runs in sync_runs"
```

- [ ] **Step 6: Write the failing tests for recording inside `syncInstagram`**

Minimum stubbing, chosen so no path reaches Blob: `globalThis.fetch` for Graph (`/v25.0/me/media`) and the CDN
URLs; a fake `BLOB_READ_WRITE_TOKEN` so `isBlobConfigured()` is true for real runs; a token seeded with
`refreshed_at = now()` so `ensureFreshToken` makes no request. The last three tests pass their own `upload`
(the test seam) and serve a 23-byte 2x2 JPEG header, which `probeMedia` reads and which is small enough to be
stored without a resize. The Blob SDK uses its own `undici` fetch, so `stubFetch` cannot catch a real upload:
`VERCEL_BLOB_API_URL` points at a closed local port with no retries, so before Step 8 (when `upload` is still
ignored) those tests fail locally and at once. The schema-only test database has no
`instagram_media` rows, and none of these tests inserts a post, so a dry run's `checkBlobAccess(null)` returns
without a `head()`.

`tests/integration/instagram-sync-runs.test.mjs`:

```js
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { syncInstagram } from "../../lib/instagram-sync.js";
import { InstagramReauthRequiredError, storeToken } from "../../lib/instagram.js";
import { getDbPool } from "../../lib/db.js";
import { testDb } from "../helpers/db.mjs";
import { stubFetch } from "../helpers/fetch-stub.mjs";

// isBlobConfigured() must be true for a real run. Tests that reach the upload step pass their own
// `upload`. If one ever reached the real uploadToBlob, the fake token and a closed local port (with no
// retries) make it fail at once, without leaving the machine or touching a real store.
process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_fake_for_tests";
process.env.VERCEL_BLOB_API_URL = "http://127.0.0.1:9";
process.env.VERCEL_BLOB_RETRIES = "0";
delete process.env.BLOB_STORE_ID;

const MEDIA = "https://graph.instagram.com/v25.0/me/media";
// A 2x2 baseline JPEG header: probeMedia reads its size, and it is small enough to be stored without a resize.
const JPEG = Buffer.from("ffd8ffc00011080002000203011100021101031101ffd9", "hex");
const db = testDb();
// syncInstagram and storeToken use getDbPool(), whose pool opens on first use: point it at the local
// test database. tests/helpers/db.mjs has already refused a remote DATABASE_URL at import.
if (!db.skip) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

// Fetch routes for one new carousel post whose `slides` image slides download from cdn.test.
function carouselRoutes(shortcode, slides) {
  const children = Array.from({ length: slides }, (_, i) =>
    ({ id: `${shortcode}-${i}`, media_type: "IMAGE", media_url: `https://cdn.test/${shortcode}-${i}.jpg` }));
  const post = { id: shortcode, media_type: "CAROUSEL_ALBUM", permalink: `https://www.instagram.com/p/${shortcode}/`,
    timestamp: "2026-10-01T00:00:00Z", caption: "test", children: { data: children } };
  return {
    [MEDIA]: () => Response.json({ data: [post] }),
    ...Object.fromEntries(children.map((c) => [c.media_url, () => new Response(JPEG)])),
  };
}
// Stands in for uploadToBlob(pathname, buffer, contentType).
const fakeUpload = async (pathname, _buffer, contentType) => ({ url: `https://blob.test/${pathname}`, pathname, contentType });

describe("syncInstagram records its runs (integration)", { skip: db.skip }, () => {
  const lastRow = async () => (await db.pool.query("select * from sync_runs order by id desc limit 1")).rows[0];
  const count = async (sql) => (await db.pool.query(sql)).rows[0].n;
  const leaseHeld = async () =>
    (await count("select count(*)::int as n from job_locks where name = 'instagram-sync' and locked_until > now()")) === 1;
  const seedCeiling = () => db.pool.query(
    `insert into sync_runs (job, trigger, dry_run, status, started_at, finished_at, uploads)
     values ('instagram', 'cron', false, 'ok', now() - interval '2 days', now() - interval '2 days', 1800)`);
  async function hideSyncRuns(t) {
    await db.pool.query("alter table sync_runs rename to sync_runs_hidden");
    t.after(() => db.pool.query("alter table sync_runs_hidden rename to sync_runs"));
  }
  // startRun still works (it never names `uploads`); the 30-day count and finishRun do not.
  async function hideUploadsColumn(t) {
    await db.pool.query("alter table sync_runs rename column uploads to uploads_hidden");
    t.after(() => db.pool.query("alter table sync_runs rename column uploads_hidden to uploads"));
  }

  before(() => db.resetSchema());
  beforeEach(async () => {
    for (const table of ["sync_runs", "job_locks", "integration_tokens"]) await db.pool.query(`delete from ${table}`);
    await storeToken({ accessToken: "T-sync", expiresInSeconds: 60 * 86_400 }); // fresh: no refresh request
  });
  after(async () => { await getDbPool().end(); await db.close(); });

  test("a real run with nothing new records ok and releases the lease", async (t) => {
    const fetchStub = stubFetch(t, { [MEDIA]: () => Response.json({ data: [] }) });
    const summary = await syncInstagram({ trigger: "cron", timeBudgetMs: 150_000 });
    assert.equal(summary.fetched, 0);
    assert.equal(summary.leaseHeld, undefined);
    assert.equal(summary.ceilingReached, undefined);
    assert.equal(fetchStub.mock.callCount(), 1);
    const r = await lastRow();
    assert.deepEqual([r.status, r.trigger, r.dry_run], ["ok", "cron", false]);
    assert.ok(r.finished_at instanceof Date);
    assert.equal(await leaseHeld(), false);
  });

  test("a run where a post fails records partial", async (t) => {
    stubFetch(t, {
      [MEDIA]: () => Response.json({ data: [{ id: "1", media_type: "IMAGE", media_url: "https://cdn.test/a.jpg",
        permalink: "https://www.instagram.com/p/TESTPOST1/", timestamp: "2026-10-01T00:00:00Z", caption: "test" }] }),
      "https://cdn.test/a.jpg": () => new Response("gone", { status: 404 }),
    });
    t.mock.method(console, "error", () => {});
    const summary = await syncInstagram({ trigger: "cron" });
    assert.deepEqual(summary.errors, [{ id: "TESTPOST1", error: "Download failed: HTTP 404" }]);
    const r = await lastRow();
    assert.deepEqual([r.status, r.fetched, r.imported, r.uploads, r.error_count], ["partial", 1, 0, 0, 1]);
  });

  test("a run that finds the lease held records skipped and leaves the other run's lease alone", async (t) => {
    await db.pool.query(`insert into job_locks (name, locked_until) values ('instagram-sync', now() + interval '5 minutes')`);
    const fetchStub = stubFetch(t, {});
    const summary = await syncInstagram({ trigger: "cron" });
    assert.equal(summary.leaseHeld, true);
    assert.deepEqual(summary.skipped, [{ id: "run", reason: "another sync is already running" }]);
    assert.equal(fetchStub.mock.callCount(), 0);
    assert.equal((await lastRow()).status, "skipped");
    assert.equal(await leaseHeld(), true);
  });

  test("a real run stops before the lease once 30-day uploads reach 1,800", async (t) => {
    await seedCeiling();
    const fetchStub = stubFetch(t, {});
    t.mock.method(console, "warn", () => {});
    const summary = await syncInstagram({ trigger: "cron" });
    assert.equal(summary.ceilingReached, true);
    assert.equal(summary.leaseHeld, undefined);
    assert.deepEqual(summary.skipped, [{ id: "run", reason: "30-day upload ceiling reached" }]);
    assert.equal(fetchStub.mock.callCount(), 0);
    const r = await lastRow();
    assert.deepEqual([r.status, r.skipped], ["skipped", 1]);
    assert.equal(await count("select count(*)::int as n from job_locks"), 0);
  });

  test("a dry run ignores the ceiling", async (t) => {
    await seedCeiling();
    stubFetch(t, { [MEDIA]: () => Response.json({ data: [] }) });
    const summary = await syncInstagram({ trigger: "panel", dryRun: true });
    assert.equal(summary.ceilingReached, undefined);
    assert.equal(summary.blob, "configured, nothing stored yet to check against");
    const r = await lastRow();
    assert.deepEqual([r.status, r.trigger, r.dry_run], ["ok", "panel", true]);
  });

  test("a missing token records reauth_required, defaults the trigger to cli, and rethrows", async (t) => {
    await db.pool.query("delete from integration_tokens");
    stubFetch(t, {});
    await assert.rejects(syncInstagram({}), InstagramReauthRequiredError);
    const r = await lastRow();
    assert.deepEqual([r.status, r.trigger], ["reauth_required", "cli"]);
    assert.match(r.error, /No Instagram token stored/);
    assert.ok(r.finished_at instanceof Date);
  });

  test("any other error records failed, releases the lease, and rethrows", async (t) => {
    stubFetch(t, { [MEDIA]: () => Response.json(
      { error: { code: 2, type: "OAuthException", message: "Service temporarily unavailable" } }, { status: 500 }) });
    await assert.rejects(syncInstagram({ trigger: "cron" }), /HTTP 500 code=2/);
    const r = await lastRow();
    assert.equal(r.status, "failed");
    assert.match(r.error, /HTTP 500 code=2/);
    assert.equal(await leaseHeld(), false);
  });

  test("a recording failure does not change a dry run's result", async (t) => {
    await hideSyncRuns(t);
    const errors = t.mock.method(console, "error", () => {});
    stubFetch(t, { [MEDIA]: () => Response.json({ data: [] }) });
    const summary = await syncInstagram({ trigger: "cron", dryRun: true });
    assert.equal(summary.fetched, 0);
    assert.ok(errors.mock.calls.some((c) => String(c.arguments[0]).startsWith("[instagram-sync] Could not record this run")));
  });

  test("a real run fails closed when the 30-day count cannot be read", async (t) => {
    await hideUploadsColumn(t);
    t.mock.method(console, "error", () => {});
    const fetchStub = stubFetch(t, {});
    await assert.rejects(syncInstagram({ trigger: "cron" }), /column "uploads" does not exist/);
    assert.equal(fetchStub.mock.callCount(), 0);
    assert.equal(await count("select count(*)::int as n from job_locks"), 0);
  });

  test("a real run whose row cannot be written stands down and uploads nothing", async (t) => {
    await hideSyncRuns(t);
    const errors = t.mock.method(console, "error", () => {});
    const fetchStub = stubFetch(t, carouselRoutes("TESTPOST2", 1));
    const upload = t.mock.fn(fakeUpload);
    const summary = await syncInstagram({ trigger: "cron", upload });
    assert.equal(summary.notRecorded, true);
    assert.deepEqual(summary.skipped, [{ id: "run", reason: "run could not be recorded" }]);
    assert.equal(fetchStub.mock.callCount(), 0);
    assert.equal(upload.mock.callCount(), 0);
    assert.equal(await count("select count(*)::int as n from job_locks"), 0);
    assert.ok(errors.mock.calls.some((c) => String(c.arguments[0]).startsWith("[instagram-sync] Could not record this run")));
  });

  test("each upload is recorded as it lands, so a run that dies after two uploads has counted them", async (t) => {
    stubFetch(t, carouselRoutes("TESTPOST3", 3));
    t.mock.method(console, "error", () => {});
    let calls = 0;
    let uploadsWhenThirdStarted;
    const upload = async (pathname, buffer, contentType) => {
      calls += 1;
      if (calls === 3) {
        // A process killed here never touches its row again, so this is what it would leave behind.
        uploadsWhenThirdStarted = (await lastRow()).uploads;
        throw new Error("simulated crash");
      }
      return fakeUpload(pathname, buffer, contentType);
    };
    const summary = await syncInstagram({ trigger: "cli", upload });
    assert.equal(uploadsWhenThirdStarted, 2);
    assert.deepEqual(summary.errors, [{ id: "TESTPOST3", error: "simulated crash" }]);
    const r = await lastRow();
    assert.deepEqual([r.status, r.uploads], ["partial", 2]);
  });

  test("an upload that cannot be recorded stops the run at once, releases the lease and rethrows", async (t) => {
    stubFetch(t, carouselRoutes("TESTPOST4", 2));
    t.mock.method(console, "error", () => {});
    let calls = 0;
    const upload = async (pathname, buffer, contentType) => {
      calls += 1;
      if (calls === 1) await hideSyncRuns(t); // so the write that records this upload fails
      return fakeUpload(pathname, buffer, contentType);
    };
    await assert.rejects(syncInstagram({ trigger: "cli", upload }), /relation "sync_runs" does not exist/);
    assert.equal(calls, 1); // the second slide was never uploaded
    assert.equal(await leaseHeld(), false);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

```sh
env -u DATABASE_URL node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/integration/instagram-sync-runs.test.mjs
```

Expected: `ℹ tests 12`, `ℹ pass 0`, `ℹ fail 12`, `ℹ cancelled 0`, within a few seconds (nothing waits on the
network):
- The ok, partial, reauth and failed tests fail with `Cannot read properties of undefined (reading 'status')`,
  because no row is written yet.
- The dry-run test fails on `[r.status, r.trigger, r.dry_run]`: the newest row is the seeded ceiling row
  (`['ok', 'cron', false]` vs `['ok', 'panel', true]`).
- The lease test fails on `summary.leaseHeld`, and the stand-down test on `summary.notRecorded` (`undefined` vs
  `true` in both).
- The ceiling test fails with `unexpected fetch: https://graph.instagram.com/v25.0/me/media`, because the run went
  ahead. The fail-closed test fails because that same error does not match `/column "uploads" does not exist/`.
- The dry-run recording-failure test fails because nothing logs "Could not record this run".
- "dies after two uploads" fails on `uploadsWhenThirdStarted` (`undefined` vs `2`), and "cannot be recorded"
  with `Missing expected rejection`. The old code ignores `upload`, so the real `uploadToBlob` is refused by
  the closed local port and each post is recorded as a post error.

- [ ] **Step 8: Implement recording and the ceiling in `lib/instagram-sync.js`, and set the triggers**

Imports: add `InstagramReauthRequiredError` to the `./instagram.js` import, and `UPLOAD_CEILING_30D`,
`finishRun`, `incrementRunUploads`, `startRun`, `statusFromSummary`, `uploadAllowance` and `uploadsInLastDays`
from `./sync-runs.js`.

Split `syncInstagram` in three:
- `syncInstagram` keeps its options, plus `trigger = "cli"` and `upload = uploadToBlob`. It builds `startedAt` and
  the existing summary literal, unchanged, and does the recording.
- A private `performSync(...)` gets the current body from `ensureFreshToken()` to the end.
- A private `recordSafely(write)` awaits one recording write. If the write throws, it logs
  `console.error("[instagram-sync] Could not record this run:", error.message)` and returns `null`.

The order is the decision here. Implement to the twelve tests above:
1. `syncInstagram` writes the row first: `runId = await recordSafely(() => startRun({ job: "instagram", trigger, dryRun }))`.
   Recording before the token refresh means a dead token still leaves a row. A failure is only logged, because
   it must never stop the refresh that keeps the token alive.
2. `performSync` refreshes the token exactly as today, whatever happened in step 1.
3. A real run (`!dryRun`) with `runId == null` then stands down: set `summary.notRecorded = true`, push
   `{ id: "run", reason: "run could not be recorded" }` to `summary.skipped`, and return. A run that can't
   record its uploads must not spend any, or both ceilings and the panel's daily limit would miss them. A dry
   run carries on unrecorded.
4. The Blob check, unchanged.
5. A real run reads the ceiling after the Blob check and before the lease: `used = await uploadsInLastDays(30)`.
   A read that throws fails the run: the refresh has already happened, and importing without knowing the
   30-day spend risks Blob's hard stop. If `used >= UPLOAD_CEILING_30D`, `console.warn` the count and the
   ceiling, set `summary.ceilingReached = true`, push `{ id: "run", reason: "30-day upload ceiling reached" }`
   and return. Otherwise `maxUploads = uploadAllowance(maxUploads, used)`.
6. The lease, as today, except that a held lease also sets `summary.leaseHeld = true` before the existing skip
   and return. `performSync` no longer releases the lease: its `try { … } finally { releaseLease }` goes. It
   tells `syncInstagram` that it took the lease instead, for example by setting `held` on a `lease` object that
   `syncInstagram` passes in.
7. `runSync` takes `upload` and `onUpload`; `syncInstagram` passes `onUpload = () => incrementRunUploads(runId)`.
   In the real-run loop, `upload(item.pathname, item.buffer, item.contentType)` replaces the direct
   `uploadToBlob` call, and `await onUpload()` follows `summary.uploads += 1`. Each upload is then in the row
   the moment it lands, so a run killed partway has already counted it. If that write throws, rethrow it as a
   private `UploadNotRecordedError` (message `Could not record an upload, so the run stopped: <message>`). The
   per-post `catch` rethrows that class instead of recording it as a post error. The run stops at once, with
   no further upload and no new post, and ends `failed`.
8. Back in `syncInstagram`, on success: `recordSafely(() => finishRun(runId, { status: statusFromSummary(result), summary: result }))`.
   On a throw: `recordSafely(() => finishRun(runId, { status, summary, error: error.message }))`, where `status`
   is `reauth_required` for an `InstagramReauthRequiredError` and `failed` otherwise, then rethrow. Both are
   skipped when `runId == null`.
9. A `finally` after both releases the lease if this run took it (`releaseLease().catch(() => {})`). The row is
   then final before another run can take the lease and read the 30-day count.

Extend the doc comment on `syncInstagram`. Every call writes a `sync_runs` row, and a real run that can't stands
down. Uploads are counted one by one as they land. Non-dry runs stop at 1,800 uploads in 30 days. The ceiling
is soft by at most 19: `runSync`'s head-of-queue rule (`summary.uploads > 0 && ...`) always processes the first
missing post whole, and a carousel has at most 20 slides. Say so in that comment. Beyond `upload` and
`onUpload`, do not change `runSync`.

`pages/api/cron/sync-instagram.js`, in `handler`: `syncInstagram({ dryRun, timeBudgetMs: TIME_BUDGET_MS, trigger: "cron" })`.
Nothing else in the route changes.

`scripts/instagram-sync.mjs`: add `trigger: "cli"` to the `syncInstagram({ ... })` call, and change the
`--max-uploads=N` line of `USAGE` to
`  --max-uploads=N      Cap media uploads this run (default 25; backlogs resume later; never past 1,800 in 30 days)`.

- [ ] **Step 9: Run tests to verify they pass, then lint and build**

```sh
env -u DATABASE_URL node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/integration/instagram-sync-runs.test.mjs
env -u DATABASE_URL npm test
npm run lint
npm run build
grep -n 'trigger: "cron"' pages/api/cron/sync-instagram.js
grep -n 'trigger: "cli"' scripts/instagram-sync.mjs
npm run instagram:sync -- --help
```

Expected: the first prints `ℹ tests 12`, `ℹ pass 12`, `ℹ fail 0`, `ℹ cancelled 0`; `npm test` ends with
`ℹ fail 0` and `ℹ cancelled 0`; lint and build exit 0; each `grep` prints exactly one line; `--help` prints the usage with the new `--max-uploads` text and
exits 0 without touching the database.

- [ ] **Step 10: Commit**

```sh
git add lib/instagram-sync.js pages/api/cron/sync-instagram.js scripts/instagram-sync.mjs tests/integration/instagram-sync-runs.test.mjs
git commit -m "Record every Instagram sync run and stop imports at 1,800 uploads in 30 days"
```

---

### Task 10: Deploy A documentation and checklist

**Model:** Sonnet
**Files:**
- Modify: `README.md` (intro line, *Prerequisites*, *Environment variables*, *Spotify token rotation* (renamed
  *Spotify token*), a new *Database migrations* subsection with a *Local test database* paragraph, *Instagram
  sync* setup steps 1 and 8, *Token lifetime*, a new *Run history and the upload ceiling* subsection)
- Modify: `TODO.md` (*Rotate the Spotify refresh token* (renamed *Reconnect Spotify*), *Remove the Listening
  Timeline?*, *Fence the sync's run lease*, *Blob usage climbs*)
- Test: none (docs); the checks in Step 2

**Interfaces:**
- Consumes (describe these exactly; they are other tasks' code):
  - Task 2: `npm run db:apply -- [--yes] <file.sql>...` reads `DATABASE_URL` from the environment, else from
    `.env` / `.env.local` in the current directory, strips `-pooler` from the host (it refuses a pooler URL),
    prints `Target: <host>/<db>` and `Files:  <files>`, refuses a non-local target without `--yes` (exit 1,
    nothing applied), and otherwise applies each file in the order given on its own connection, printing
    `applied <file>`. `--yes` must come after `--`. The refusal goes to stderr, exactly
    ``Not a local database. Re-run with --yes (after `--`) to apply.``. `npm run db:test -- reset` rebuilds the
    local test database; `npm run test:integration` runs `tests/integration/**/*.test.mjs` serially; `npm test`
    runs everything, integration included. `npm run db:test -- dump-schema` rewrites
    `tests/fixtures/prod-schema.sql` from the schema (no data) of the database in `DATABASE_URL` (environment,
    else `.env` / `.env.local`), using `pg_dump` from Docker's `postgres:<major>` image. Task 2 Step 9's `docker run`
    chain creates the `kw-test-pg` container (`127.0.0.1:55432`, `-c timezone=UTC`) and writes the git-ignored
    `.env.test.local` (`TEST_DATABASE_URL`) in the project root. Without `TEST_DATABASE_URL` the integration
    suites skip and print a `﹣` line.
  - Task 3: `sql/005_integration_tokens_spotify.sql` (Spotify columns: `refresh_token`, `authorized_at`,
    `account_id`, `scopes`; `access_token` nullable), `sql/006_sync_runs.sql` (`sync_runs`, `admin_audit_log`).
  - Tasks 5–7: the `spotify` row of `integration_tokens`; `SPOTIFY_SCOPES` in `lib/spotify-token.js`;
    `lib/spotify.js` behaviour (cache until 60 s before expiry, one shared refresh, `invalid_grant` marks the row
    dead, re-read at most once a minute, rotated token saved by compare-and-swap, `refresh_token` env only when
    there is no row, a database error never falls back); credentials `SPOTIFY_CLIENT_ID ?? client_id`,
    `SPOTIFY_CLIENT_SECRET ?? client_secret`; `npm run spotify:reauth` with `--whoami` (which saves nothing
    except a rotated refresh token, stored by compare-and-swap) and `--save`. Copy the flag
    descriptions from Task 7's `USAGE` text in `scripts/spotify-reauth.mjs`; where the wording below differs,
    Task 7's script is the truth.
  - Tasks 8–9: the Instagram CAS, `sync_runs`, the 1,800 ceiling. Each upload is added to its run's
    `uploads` as it lands (`incrementRunUploads`), and a real run whose row can't be written stands down
    without importing.
- Produces: README sections *Spotify token* (renamed from *Spotify token rotation*) and *Database migrations*
  (Task 18 extends both for the panel and `007`), and the TODO item *Reconnect Spotify* (renamed from *Rotate
  the Spotify refresh token*; Task 19 Step 1 re-dates it after the reconnect). The dated *Remove the Spotify env
  fallback* item is not added here: Task 19 Step 1 adds it on the reconnect day.

- [ ] **Step 1: Edit `README.md` and `TODO.md`**

README, in order. `README.md` wraps its paragraphs at about 95 columns, so a phrase quoted below can span two
lines: match one line at a time, on the line-bounded fragments given, and rewrap the paragraph after an insert.

1. Intro (the `📋 Open tasks` line): replace "the Spotify token rotation that comes round twice a year" with
   "reconnecting Spotify twice a year". The phrase wraps: line 5 ends `the Spotify token` and line 6 starts
   `rotation that comes round twice a year,`. The two lines become:
   ```markdown
   📋 Open tasks live in [TODO.md](TODO.md): content ideas, retiring Cloudinary, reconnecting Spotify
   twice a year, and follow-ups from the last codebase audit.
   ```
2. *Prerequisites*, second bullet becomes:
   `- A Postgres database (production uses Neon) for /snapshots, the Instagram sync and the Spotify token, and a [Vercel Blob](https://vercel.com/docs/vercel-blob) store for /snapshots. See *Database migrations*, *Spotify token* and *Instagram sync* below.`
3. *Environment variables* table: replace the `client_id`, `client_secret`, `refresh_token` row with these two
   rows, and replace the `DATABASE_URL` row:

```markdown
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | Spotify app credentials (now playing, top tracks), read on the server at runtime. Until the cleanup a week after the first reconnect (see [TODO.md](TODO.md)), the old lowercase `client_id` / `client_secret` still work as a fallback |
| `refresh_token` | Spotify's refresh token, **only until Spotify is reconnected**: after that the token lives in Postgres and this is ignored (see *Spotify token*). Removed in the same cleanup |
| `DATABASE_URL` | Postgres (the pooled Neon URL): /snapshots, the Instagram sync and its run history, and the Spotify token. Without it the Spotify widgets show their empty states |
```

4. The paragraph under the table becomes: "The Instagram access token, and the Spotify refresh token once
   Spotify has been reconnected, are deliberately not env vars. They live in Postgres in `integration_tokens`
   ([`sql/001`](sql/001_integration_tokens.sql), [`sql/005`](sql/005_integration_tokens_spotify.sql)), where the
   app can refresh, rotate or replace them without a redeploy."
5. New subsection right after it, before the Spotify section:

`````markdown
### 🗄️ Database migrations

Schema changes live in [`sql/`](sql/), numbered and applied in filename order. Each file only adds things and
is safe to run twice. Nothing records which files have been applied, so each new one is applied by hand, once,
**before** the code that uses it deploys: after merging into `main`, before `git push` (the push deploys). The
currently deployed code ignores what it adds.

| File | Adds | Needed by |
| --- | --- | --- |
| `001`–`004` | The Instagram token table, its assumed-expiry flag, the Blob asset columns, the sync's run lease | The Instagram sync |
| [`005`](sql/005_integration_tokens_spotify.sql) | Spotify columns on `integration_tokens` | `lib/spotify.js` reading the token from Postgres |
| [`006`](sql/006_sync_runs.sql) | `sync_runs` (one row per sync run) and `admin_audit_log` | The sync recording its runs and its upload ceiling |

To apply one:

1. **Back up production first.** Local development uses the production database too, so there is no other
   copy. Either make a Neon branch (Neon Console → the project → **Branches** → **New branch**, name it
   `before-<file number>`, parent: the production branch, data up to now → **Create**), or take a dump from the
   project root. Docker's `postgres:18` image can dump any server up to 18. The direct (non-pooler) URL is
   worked out from `.env` and handed to Docker by name, so it is never typed, and it stays out of your shell
   history and your Mac's process list:
   ````sh
   mkdir -p ~/Backups
   PGURL="$(node --env-file=.env -p 'const u = new URL(process.env.DATABASE_URL); u.hostname = u.hostname.replace(/^([^.]+)-pooler\./, "$1."); u.href')" \
     docker run --rm -e PGURL postgres:18 sh -c 'pg_dump --format=custom --no-owner "$PGURL"' > ~/Backups/kevinwong-before-005.dump
   ````
2. Rehearse on the local test database (see *Local test database* below), which loads production's schema
   and then every migration:
   ````sh
   npm run db:test -- reset
   npm run test:integration
   ````
3. Apply it to production from the project root, where `.env` holds `DATABASE_URL`. `db:apply` reads it from
   there and switches to the direct host, because the pooled one goes through PgBouncer in transaction mode,
   which DDL must avoid. Without `--yes` it prints the target and stops, so look first:
   ````sh
   npm run db:apply -- sql/005_integration_tokens_spotify.sql sql/006_sync_runs.sql         # prints Target: and stops
   npm run db:apply -- --yes sql/005_integration_tokens_spotify.sql sql/006_sync_runs.sql   # applies them, in order
   ````
   `Target:` must name the Neon host without `-pooler`. `--yes` goes after the `--`; npm keeps one that comes
   before it.

**Local test database.** The tests run against a throwaway Postgres in Docker, the `kw-test-pg` container on
`127.0.0.1:55432`. Its generated password lives only in `.env.test.local` in the project root (git-ignored), as
`TEST_DATABASE_URL`. To create both, from the project root:
````sh
MAJOR=$(sed -n 's/^-- Dumped from database version \([0-9]*\).*/\1/p' tests/fixtures/prod-schema.sql) && \
test -n "$MAJOR" && \
export POSTGRES_PASSWORD="$(openssl rand -hex 16)" && \
printf 'TEST_DATABASE_URL=postgres://postgres:%s@127.0.0.1:55432/kw_test\n' "$POSTGRES_PASSWORD" > .env.test.local && \
docker run -d --name kw-test-pg -e POSTGRES_PASSWORD -e POSTGRES_DB=kw_test -p 127.0.0.1:55432:5432 "postgres:$MAJOR" -c timezone=UTC && \
unset POSTGRES_PASSWORD && \
docker exec kw-test-pg sh -c 'until pg_isready -h 127.0.0.1 -U postgres -q; do sleep 1; done' && \
git check-ignore .env.test.local
````
The server's major version matches production's, and its sessions run in UTC like Neon's, which the tests
assume. If the container already exists, run `docker start kw-test-pg` instead, and copy `.env.test.local`
from the checkout that created it. `tests/fixtures/prod-schema.sql` is production's schema, without data; after
production's schema changes, refresh it with `npm run db:test -- dump-schema`, run where `.env` holds
production's `DATABASE_URL` (it only reads production). Without `TEST_DATABASE_URL` the integration suites
skip themselves: a `﹣` line in the test output means they did not run.
`````

6. *Spotify token rotation* becomes this section (keep the `[spotify-blog]` link definition at its end):

`````markdown
### 🎧 Spotify token

Spotify expires user refresh tokens **six months after the original authorization**, and refreshing an
access token does **not** extend that window. So Spotify has to be reconnected roughly twice a year.
([Spotify's announcement][spotify-blog]) When the next one is due is tracked in [TODO.md](TODO.md).

**Where the token lives.** In Postgres, in the `spotify` row of `integration_tokens`
([`sql/005`](sql/005_integration_tokens_spotify.sql)), with the account it belongs to, the granted scopes and
when it was approved. `expires_at` is the approval date plus 180 days, an estimate, because Spotify doesn't
say. Until Spotify is reconnected for the first time there is no row, and [`lib/spotify.js`](lib/spotify.js)
uses the `refresh_token` env var exactly as before. It falls back only when the row is missing: if the
database can't be reached, the Spotify widgets show their empty states instead.

**How the app uses it.** Each server instance caches the short-lived access token until a minute before it
expires, and concurrent requests share one refresh. When the refresh token dies, Spotify answers
`400 invalid_grant`, and the app marks the row dead and stops calling Spotify. Instances look at the row again
at most once a minute, so a reconnect takes effect everywhere within a minute, with no redeploy. If Spotify
hands back a new refresh token, it replaces the stored one only if the row still holds the token that instance
used, so a slow instance can't overwrite a newer one.

**Reconnecting.** The /admin panel's Reconnect button will do this from the browser once it ships. Until then,
and as the fallback afterwards, use the script:

1. Add `http://127.0.0.1:8888/callback` to the Redirect URIs of the app in the
   [Spotify dashboard](https://developer.spotify.com/dashboard). Spotify rejects `localhost`, so the loopback
   IP is required.
2. Run it and approve access in the browser window that opens:
   ````sh
   npm run spotify:reauth -- --save
   ````
   It checks that all three scopes were granted and that the account is the site owner's, then writes the
   token to the database in `DATABASE_URL`. There is no env var to change and nothing to redeploy.

`npm run spotify:reauth -- --whoami` prints which Spotify account the current token belongs to (the database
row first, else the `refresh_token` env var), with no browser. It saves nothing, except a rotated refresh
token, which it stores by compare-and-swap. With no option, the script prints the new refresh token instead of
saving it, for the `refresh_token` fallback. Options go after `--`; npm keeps any that come before it. The
script reads `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` from the
environment, `.env` or `.env.local`, and falls back to `client_id` / `client_secret` until the cleanup a week
after the first reconnect (see [TODO.md](TODO.md)).
`````

7. *Instagram sync → One-time setup*, step 1 becomes: "Apply the migrations in [`sql/`](sql/) as described in
   *Database migrations* above. They only cover changes made since the sync was added. The base
   `instagram_posts` and `instagram_media` tables and the `media_kind` enum are older and aren't in the repo yet
   (see [TODO.md](TODO.md)), so on an empty database create those first."
8. Step 8's command uses `www` (the apex 308-redirects, and curl does not resend the `Authorization` header to
   another host) and keeps the secret off the command line:
   ````sh
   printf 'Authorization: Bearer %s\n' "$CRON_SECRET" | curl -sS -H @- "https://www.kevinwong.co/api/cron/sync-instagram?dryRun=1"
   ````
   Add after it: "Each run, this one included, adds a row to `sync_runs` (see *Run history and the upload
   ceiling*)."
9. *Token lifetime*, second paragraph: after "re-checks the token with a second request, so a transient error
   cannot brick the integration." insert "It also only marks the row dead if the row still holds the token that
   failed, and a refresh only saves its new token if the row still holds the old one, so a run that started
   before a re-seed can't undo it." The anchor wraps: one line ends `the code re-checks the token` and the next
   is `with a second request, so a transient error cannot brick the integration. Recover by`. Insert after
   `cannot brick the integration.` on that second line, before `Recover by`.
10. New subsection after *Token lifetime*, before the `[ig-login]` link definitions:

```markdown
#### Run history and the upload ceiling

Every run, from the cron or `npm run instagram:sync`, adds a row to `sync_runs`
([`sql/006`](sql/006_sync_runs.sql)): what started it, whether it was a dry run, how it ended (`ok`,
`partial` when some posts failed, `skipped`, `failed` or `reauth_required`) and its counts. Errors and the
stored summary are redacted first. A row still `running` after 15 minutes, once the sync's lease has expired,
belongs to a run that was killed; the next run marks it `abandoned`, keeping the uploads it recorded.

Real runs stop importing once the last 30 days of runs have uploaded 1,800 files, which leaves room under
Blob's 2,000-a-month hard stop, and each run caps its uploads to what is left. The ceiling is slightly soft:
the oldest missing post is always processed whole, so one carousel can take a run up to 19 past it. Each
upload is added to its run's row as soon as it lands, so a run killed partway still counts what it uploaded,
and a real run that can't write its row stands down without importing. Dry runs don't count, and neither do
uploads by `npm run blog:image` or `npm run snapshots:blob`.
```

TODO.md:

1. Replace the whole *🎧 Rotate the Spotify refresh token (by ~2026-12-30)* section with:

```markdown
### 🎧 Reconnect Spotify (by ~2026-12-30)

Spotify refresh tokens die six months after they're approved, and refreshing doesn't extend that (the
README's *Spotify token* section has the details). The current token is assumed to have been minted on
**2026-07-30**, alongside commit `8940403` ("Handle Spotify's six-month refresh token expiry"), so it dies
around **2027-01-29**. It is still the `refresh_token` env var: Postgres has no `spotify` row until the first
reconnect.

- [ ] **Reconnect from the admin panel** as soon as it ships: sign in at https://www.kevinwong.co/admin, then
  Spotify card → **Reconnect** → approve on Spotify. That also moves the token into Postgres, and it takes
  effect within a minute, with no redeploy. If the panel isn't live by ~2026-12-30, run
  `npm run spotify:reauth -- --save` instead (README, *Spotify token*). Check that it worked:
  `curl -s https://www.kevinwong.co/api/toptracks` should list tracks, not `{"is_working":false}`.
- [ ] **Re-date this item, and date the env cleanup.** The panel shows the estimated expiry (approval + 180
  days): set this heading's date to a month before it, and set a reminder. Add a *Remove the Spotify env
  fallback* item dated a week after the reconnect (Task 19 of [the admin panel plan](docs/superpowers/plans/2026-10-16-admin-panel.md)).
```

2. *Remove the Listening Timeline?*: replace "drop the scope from `scripts/spotify-reauth.mjs` (and its
   comment)" with "drop `user-read-recently-played` from every list that `grep -rn user-read-recently-played lib
   scripts` finds (`SPOTIFY_SCOPES` in [`lib/spotify-token.js`](lib/spotify-token.js), which the reconnect
   checks granted scopes against)". Name exactly the files the grep prints when you make the edit.
3. *Fence the sync's run lease*: replace "Test against a Neon branch, not production." with "The abandoned-run
   sweep in `lib/sync-runs.js` trusts the lease too. Test with `npm run test:integration` on the local test
   database, never production."
4. *Blob usage climbs*: append "The sync stops itself at 1,800 uploads in 30 days (README, *Run history and the
   upload ceiling*), but `npm run blog:image` and `npm run snapshots:blob` uploads aren't counted."

- [ ] **Step 2: Check the docs**

```sh
grep -n "Spotify token rotation" README.md TODO.md
grep -n "kevinwong.co/api" README.md TODO.md | grep -v "www.kevinwong.co"
grep -n "SPOTIFY_CLIENT_ID" README.md
node -e 'const fs=require("fs");const bad=[];for(const f of ["README.md","TODO.md"]){for(const m of fs.readFileSync(f,"utf8").matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)){const t=m[1];if(/^(https?|mailto):/.test(t))continue;if(!fs.existsSync(t))bad.push(`${f}: ${t}`)}}console.log(bad.length?bad.join("\n"):"links ok");process.exit(bad.length?1:0)'
```

Expected: the first two print nothing; the third prints the env table row and the *Spotify token* paragraph;
the last prints `links ok` (it needs `sql/005`, `sql/006` and `lib/spotify-token.js` from Tasks 3 and 5).

- [ ] **Step 3: Commit**

```sh
git add README.md TODO.md
git commit -m "Document the Spotify token in Postgres, migrations and sync run history"
```

- [ ] **Step 4: Pre-flight for Deploy A (implementer, then hand to Kevin)**

```sh
git log --oneline main..HEAD    # Tasks 1–10's commits, nothing from Tasks 11+
env -u DATABASE_URL npm test    # ℹ fail 0, ℹ cancelled 0, and no ﹣ line (the integration suites ran)
npm run lint && npm run build   # both exit 0
git status --short              # nothing modified or staged
```

Tell Kevin the branch is ready for Deploy A and list Steps 5–11. Order matters: back up, add the env vars,
merge into local `main`, apply `005` and `006`, then push. The new code reads `005`'s columns and writes
`006`'s table, and without `006` every real sync stands down because it can't record its run. The old code
ignores both, so applying them first is safe.

Kevin runs Steps 5–10 in a terminal in the main checkout, `/Users/Kevin/Git/kevinwong.co`. Its `.env` holds
production's `DATABASE_URL` and `CRON_SECRET`, so no secret is typed or pasted.

- [ ] **Step 5: Kevin: back up production**

Either (preferred) a Neon branch: Neon Console → the kevinwong.co project → **Branches** → **New branch** →
name `before-admin-005`, parent: the production branch (marked default), data up to **now** (the current point
in time, not schema-only) → **Create branch**. A compute is not needed for a backup; if the dialog adds one,
it scales to zero. Check: the **Branches** list shows `before-admin-005`.

Or a dump. The direct (non-pooler) URL is worked out from `.env` and passed to Docker by name:

```sh
cd /Users/Kevin/Git/kevinwong.co
mkdir -p ~/Backups
PGURL="$(node --env-file=.env -p 'const u = new URL(process.env.DATABASE_URL); u.hostname = u.hostname.replace(/^([^.]+)-pooler\./, "$1."); u.href')" \
  docker run --rm -e PGURL postgres:18 sh -c 'pg_dump --format=custom --no-owner "$PGURL"' > ~/Backups/kevinwong-before-admin-005.dump
docker run --rm -i postgres:18 pg_restore --list < ~/Backups/kevinwong-before-admin-005.dump | grep -c "TABLE DATA"
```

The last command prints 4 or more (`integration_tokens`, `job_locks`, `instagram_posts`, `instagram_media`).
Keep the backup until Deploy B's checks pass.

- [ ] **Step 6: Kevin: add the new Spotify credential names to Vercel Production**

Vercel dashboard → the kevinwong.co project → **Settings** → **Environment Variables** → add:
- Key `SPOTIFY_CLIENT_ID`, value: the same as `client_id` (Spotify Developer Dashboard → the app →
  **Settings** → *Client ID*, or `client_id` in `.env` in the main checkout). Environments: **Production** only.
  **Sensitive** on. **Save**.
- Key `SPOTIFY_CLIENT_SECRET`, value: the same as `client_secret` (Spotify dashboard → **View client secret**,
  or `.env`). **Production** only, **Sensitive** on, **Save**.

Leave `client_id`, `client_secret` and `refresh_token` exactly as they are. Env vars reach only new
deployments, so this must come before Step 8. Optionally add the same two lines to `.env` in the main checkout;
the lowercase names keep working locally until the cleanup.

- [ ] **Step 7: Kevin: merge into local `main`, then apply `005` and `006` to production**

Nothing is pushed in this step, so nothing deploys yet:

```sh
cd /Users/Kevin/Git/kevinwong.co
git switch main
git status --short               # prints nothing
git pull --ff-only origin main
git merge --ff-only claude/admin-panel || git merge --no-ff claude/admin-panel -m "Merge branch 'claude/admin-panel' (Deploy A)"
nvm use                          # if it says the version is not installed: nvm install
npm ci                           # db:apply loads lib/db.js, which needs the merged dependencies
```

Look at the target first. Without `--yes`, `db:apply` prints it and stops:

```sh
npm run db:apply -- sql/005_integration_tokens_spotify.sql sql/006_sync_runs.sql
```

Expected on stdout: `Target: ep-<id>.c-4.us-east-1.aws.neon.tech/<db>`, then
`Files:  sql/005_integration_tokens_spotify.sql, sql/006_sync_runs.sql`. Then, on stderr,
``Not a local database. Re-run with --yes (after `--`) to apply.``, and exit 1. Nothing was applied. The
target must be the Neon host **without** `-pooler`. If it names anything else, stop: a `DATABASE_URL` exported in this
shell wins over `.env`, so `unset DATABASE_URL` and run it again. Then apply:

```sh
npm run db:apply -- --yes sql/005_integration_tokens_spotify.sql sql/006_sync_runs.sql
```

Expected: the same `Target:` and `Files:` lines, then `applied sql/005_integration_tokens_spotify.sql` and
`applied sql/006_sync_runs.sql`, exit 0. If it fails, stop and tell the session. `main` is not pushed, so
nothing is deployed, and both files are safe to run again. Then confirm, read-only:

```sh
node --env-file=.env --input-type=module -e '
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
const q = async (sql) => (await pool.query(sql)).rows;
console.log(await q(`select column_name, is_nullable from information_schema.columns where table_name = $$integration_tokens$$ and column_name in ($$access_token$$, $$refresh_token$$, $$authorized_at$$, $$account_id$$, $$scopes$$) order by column_name`));
console.log(await q(`select to_regclass($$sync_runs$$) as sync_runs, to_regclass($$admin_audit_log$$) as admin_audit_log`));
await pool.end();'
```

Expected: five rows, `access_token` among them with `is_nullable: 'YES'`, then
`[ { sync_runs: 'sync_runs', admin_audit_log: 'admin_audit_log' } ]` (a `null` there means `006` did not
apply). A `SECURITY WARNING` about `sslmode=require` from `pg`, here and from `db:apply`, is expected and
harmless.

Optional smoke test of the merged code against production before pushing (it refreshes the Instagram token if
one is due, the same as any run, and writes one `sync_runs` row with trigger `cli`):

```sh
npm run instagram:sync -- --dry-run
```

It prints `DRY RUN — nothing was uploaded or inserted` and the summary, and exits 0.

- [ ] **Step 8: Kevin: push, which deploys**

```sh
git push origin main
```

Vercel → **Deployments** → the newest deployment for that commit shows **Production** and **Ready**. If
anything in Steps 9–10 fails: that deployment's predecessor → ⋯ → **Instant Rollback**. The migrations stay;
the old code ignores them.

- [ ] **Step 9: Kevin: check Spotify still works**

Play a song on Spotify, then:

```sh
curl -sS https://www.kevinwong.co/api/nowplaying
curl -sS "https://www.kevinwong.co/api/toptracks?check=$(date +%s)" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(Array.isArray(j.tracks)?`ok: ${j.tracks.length} tracks`:`FAILED: ${s}`)})'
curl -sS "https://www.kevinwong.co/api/listeningtimeline?check=$(date +%s)" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.is_working===false?`FAILED: ${s}`:`ok: ${Object.keys(j).length} days`)})'
```

Expected: the first contains `"isPlaying":true` and the song's `"title"`; the second prints `ok: 10 tracks`;
the third prints `ok: N days`, with N at least 1 (the listening chart, the only route that needs
`user-read-recently-played`). The query strings force fresh responses past the 24-hour CDN cache. Open
https://www.kevinwong.co/stats: the Top Tracks card lists tracks (not "Top tracks are unavailable right now."),
and the sidebar's Now Playing shows the song. Vercel → **Logs** (Hobby keeps an hour), search `spotify`: no `[spotify]` errors.

- [ ] **Step 10: Kevin: check that runs are recorded**

Either wait for the next 05:00 UTC cron, or trigger a dry run now (it uploads nothing; like every run it
refreshes the Instagram token if one is due). `CRON_SECRET` comes from `.env` and reaches curl on stdin, not
in its arguments:

```sh
node --env-file=.env -e 'process.stdout.write(`Authorization: Bearer ${process.env.CRON_SECRET}\n`)' | curl -sS -H @- "https://www.kevinwong.co/api/cron/sync-instagram?dryRun=1"
```

Expected: JSON with `"dryRun":true`, `"blob":"ok"` and `"resize":"ok (sharp …, libvips …)"`. Then read the
newest rows; no token columns are selected and the URL is never printed:

```sh
node --env-file=.env --input-type=module -e '
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
const { rows } = await pool.query(`select id, trigger, dry_run, status, started_at, finished_at, fetched, imported, uploads, deferred, skipped, error_count, error from sync_runs order by started_at desc limit 5`);
console.table(rows);
await pool.end();'
```

Expected: a row with `trigger` `cron`, `status` `ok` (or `partial` with `error_count` above 0, or `skipped`
if a run held the lease) and `finished_at` set; after 05:00 UTC, also a row with `dry_run` `false`. A row that
stays `running` for more than 15 minutes means the function was killed: check Vercel → Logs for
`[cron/sync-instagram]`. Optionally `npm run instagram:token` (read-only status) still shows the token alive.

- [ ] **Step 11: Kevin: tell the session Deploy A is done**

Reply with the date of Step 8 and whether Steps 9–10 passed. Deploy B (Tasks 11–19) continues on
`claude/admin-panel`.

---

## Deploy B: sign-in and the panel

The Better Auth facts these tasks rely on were checked against the published npm packages: `better-auth@1.7.10` (BA),
`@better-auth/core@1.7.10` (CORE), `better-call@1.4.2` (CALL) and `auth@1.7.10` (CLI). To re-check one, run
`npm pack <package>@<version>` in a temporary folder and open the cited file. The facts:

- `user.validateUserInfo` is awaited and rejects only on a returned `{ error }` or a throw (BA
  `dist/utils/validate-user-info.mjs`, `assertValidUserInfo`). It receives `source.oauth.profile`, the raw
  GitHub `/user` JSON with a numeric `id` (BA `dist/api/routes/callback.mjs`; `toOAuthProfileRecord` returns the
  profile unchanged, `dist/oauth2/account-key.mjs`).
- `databaseHooks.session.create.after(session, context)` runs through `queueAfterTransactionHook`, after the
  session row commits (BA `dist/db/with-hooks.mjs`, `createWithHooks`; wired in `dist/context/create-context.mjs`).
- `disabledPaths` is enforced only in the router's `onRequest` (BA `dist/api/index.mjs`); `auth.api.*` ignores it.
- Cookies are serialized as `name=value; Max-Age=…; Path=/; HttpOnly; Secure; SameSite=Lax` in that order
  (CALL `dist/cookies.mjs`, `serializeCookieValue`).
- `@vercel/functions` `waitUntil(p)` is a no-op outside a Vercel request context (the promise still runs), so
  every promise handed to it must carry its own `.catch`.

---

### Task 11: Better Auth dependency, admin audit log, `lib/auth.js`, `sql/007_auth.sql`

**Model:** Opus

**Files:**
- Modify: `package.json` (`dependencies`: add `"better-auth": "1.7.10"`; `devDependencies`: add `"auth": "1.7.10"`, the Better Auth CLI), `package-lock.json`
- Create: `lib/admin/audit-log.js`, `lib/auth.js`, `sql/007_auth.sql`, `scripts/auth.config.mjs`
- Test: `tests/auth.test.mjs`, `tests/integration/admin-audit-log.test.mjs`, `tests/integration/auth-schema.test.mjs`

**Interfaces:**
- Consumes:
  - `lib/db.js` (Task 1): `getDbPool()` (uses `sslFor`, so a `localhost`/`127.0.0.1` test URL connects without TLS).
  - `lib/redact.js` (Task 4): `redact(value: unknown): unknown`.
  - `lib/admin/owner.js` (Task 7): `OWNER_GITHUB_ID = "1741711"`, `SITE_ORIGIN = "https://www.kevinwong.co"`.
  - `sql/006_sync_runs.sql` (Task 3): table `admin_audit_log` with columns `id bigint generated always as identity
    primary key` (pg returns it as a string), `at timestamptz not null default now()`, `event text not null` (no
    CHECK), `actor text` (nullable), `details jsonb not null default '{}'::jsonb`.
  - `tests/helpers/db.mjs` (Task 2): `testDb()` → `{ skip: false | string, pool: pg.Pool | null,
    resetSchema(): Promise<number>, close(): Promise<void> }`, one object per process. `resetSchema()` rebuilds
    `public` from `tests/fixtures/prod-schema.sql` and applies every `sql/005+` file, so 006 (and 007, once it
    exists) are in place. Usage: `describe(name, { skip: db.skip }, () => { before(() => db.resetSchema());
    after(() => db.close()); ... })`.
  - `npm run db:test -- reset` (Task 2): the same rebuild from the command line, reading `.env.test.local`.
- Produces:
  - `lib/admin/audit-log.js`:
    - `export const ADMIN_EVENTS = ["sign_in", "sign_in_rejected", "spotify_connected", "spotify_connect_failed", "instagram_check", "instagram_import", "panel_run_refused"]` (frozen)
    - `export const OWNER_ACTOR = "github:1741711"` (built as `` `github:${OWNER_GITHUB_ID}` ``; the `actor` for every event the owner causes: sign-in, Spotify reconnect, Check, Import and refusals. Never `owner.userId`.)
    - `export async function logAdminEvent(event, { actor = null, details = {} } = {}, db = getDbPool()): Promise<void>` — throws `TypeError` for an event not in `ADMIN_EVENTS`; stores `redact(details)`.
    - `export async function logRejectedSignIn({ githubId, login }, db = getDbPool()): Promise<boolean>` — `actor = "github:<githubId>"`; inserts only when that actor has no `sign_in_rejected` row in the last hour AND there are fewer than 5 `sign_in_rejected` rows in total in the last hour; `true` when a row was written.
    - `export async function recentAdminEvents(limit = 20, db = getDbPool()): Promise<{ id: number, at: Date, event: string, actor: string | null, details: object }[]>` — the newest events EXCLUDING `sign_in_rejected`, newest first; `id` is `Number(row.id)`.
    - `export async function refusedSignInSummary(db = getDbPool()): Promise<{ count24h: number, latestAt: Date | null, latestLogin: string | null }>` — the `sign_in_rejected` rows of the last 24 hours: how many, and the time and `details.login` of the newest (`null`s when there are none). Task 15 reports it as `refusedSignIns`.
  - `lib/auth.js`:
    - `export function validateOwner({ source }, context, { logRejected = logRejectedSignIn, schedule = waitUntil } = {}): undefined | { error: "not_owner", errorDescription: "This GitHub account can't sign in here." }` — synchronous; Better Auth calls it with `(data, context)`, so the third argument exists only for tests.
    - `export function githubProfileToUser(profile): { email: string, name: string }`
    - `export function buildAuthOptions({ env = process.env, db } = {}): BetterAuthOptions` — `db` defaults to `getDbPool()`.
    - `export function getAuth()` — lazy singleton `betterAuth(buildAuthOptions())`.
  - `sql/007_auth.sql`: `auth_user`, `auth_session`, `auth_account`, `auth_verification`, unique index
    `auth_account_provider_account_uidx` on `("providerId", "accountId")`.
  - `scripts/auth.config.mjs`: `export const auth` (for the CLI only).

#### Part A: the dependency

- [ ] **Step 1: Check the version and advisories, then install.**

  ```sh
  npm view better-auth version
  gh api /repos/better-auth/better-auth/security-advisories \
    --jq '.[] | select(.published_at > "2026-10-15T13:29:00Z") | .ghsa_id + " " + .severity + " " + .summary'
  ```

  Expected: `1.7.10`, then no advisory lines. If `npm view` prints a newer version, or any advisory line appears,
  stop and ask Kevin: the pin is his decision, so do not choose another version yourself. Then:

  ```sh
  npm install --save-exact better-auth@1.7.10
  npm install --save-dev --save-exact auth@1.7.10
  ```

  The second line pins the Better Auth CLI (package `auth`, bin `auth`) as a devDependency, so its whole tree is in
  `package-lock.json` with integrity hashes and `npm ci` installs it. Every CLI run in this plan is then
  `npx --no-install auth check --config scripts/auth.config.mjs`, which fails instead of downloading anything. Never
  run it as `npx --yes auth@…`: that installs an unlocked tree at run time, and the CLI loads `.env` and `.env.local`
  into `process.env` before anything else.

- [ ] **Step 2: Verify the pin.**

  ```sh
  node -p 'require("./package.json").dependencies["better-auth"]'   # prints: 1.7.10
  node -p 'require("./package.json").devDependencies.auth'           # prints: 1.7.10
  npm ls better-auth                                                 # shows: better-auth@1.7.10 (no "invalid"; under auth@1.7.10 it shows "better-auth@1.7.10 deduped", the same version)
  npm ls auth                                                        # shows: auth@1.7.10
  npm run audit:prod                                                 # exits 0
  ```

  A lockfile diff that adds or nests `zod` 4.5.x is expected (better-auth needs `zod ^4.5.4`; the tree has 4.3.6). So
  is a nested `jose` 6.x under better-auth (it needs `jose ^6.2.3`; the tree has 5.10.0 at the top level). The CLI
  also adds its own dev-only tree (`@babel/core`, `c12`, `chalk`, `prettier` and others), which `audit:prod` skips.

- [ ] **Step 3: Commit.**

  ```sh
  git add package.json package-lock.json
  git commit -m "Add Better Auth 1.7.10 and its CLI for the admin sign-in"
  ```

#### Part B: `lib/admin/audit-log.js`

- [ ] **Step 4: Write the failing integration test** `tests/integration/admin-audit-log.test.mjs`:

  ```js
  import { describe, test, before, beforeEach, after } from "node:test";
  import assert from "node:assert/strict";
  import { testDb } from "../helpers/db.mjs";
  import { ADMIN_EVENTS, OWNER_ACTOR, logAdminEvent, logRejectedSignIn, recentAdminEvents, refusedSignInSummary } from "../../lib/admin/audit-log.js";
  import { redact } from "../../lib/redact.js";

  const db = testDb();
  const rows = async () => (await db.pool.query("select event, actor, details from admin_audit_log order by id")).rows;

  test("logAdminEvent rejects an unknown event before touching the database", async () => {
    assert.deepEqual([...ADMIN_EVENTS], ["sign_in", "sign_in_rejected", "spotify_connected", "spotify_connect_failed", "instagram_check", "instagram_import", "panel_run_refused"]);
    assert.equal(OWNER_ACTOR, "github:1741711");
    let queries = 0;
    const fake = { async query() { queries += 1; return { rowCount: 1, rows: [] }; } };
    await assert.rejects(logAdminEvent("deleted_everything", {}, fake), TypeError);
    assert.equal(queries, 0);
  });

  describe("admin audit log", { skip: db.skip }, () => {
    before(() => db.resetSchema());
    beforeEach(() => db.pool.query("truncate admin_audit_log restart identity"));
    after(() => db.close());

    test("logAdminEvent stores the event, actor and redacted details", async () => {
      const details = {
        reason: "Bearer abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH",
        url: "https://accounts.spotify.com/api/token?code=AQBsecretcode&state=x",
      };
      await logAdminEvent("spotify_connect_failed", { actor: OWNER_ACTOR, details }, db.pool);
      const [row] = await rows();
      assert.equal(row.event, "spotify_connect_failed");
      assert.equal(row.actor, "github:1741711");
      assert.deepEqual(row.details, redact(details));
      assert.ok(!JSON.stringify(row.details).includes("abcdefghijklmnopqrstuvwxyz"));
      assert.ok(!JSON.stringify(row.details).includes("AQBsecretcode"));
    });

    test("logAdminEvent defaults actor to null and details to {}", async () => {
      await logAdminEvent("sign_in", undefined, db.pool);
      assert.deepEqual(await rows(), [{ event: "sign_in", actor: null, details: {} }]);
    });

    test("logRejectedSignIn writes at most one row per GitHub id per hour", async () => {
      assert.equal(await logRejectedSignIn({ githubId: "999", login: "intruder" }, db.pool), true);
      assert.equal(await logRejectedSignIn({ githubId: "999", login: "intruder" }, db.pool), false);
      assert.equal(await logRejectedSignIn({ githubId: "1000", login: "other" }, db.pool), true);
      assert.deepEqual(await rows(), [
        { event: "sign_in_rejected", actor: "github:999", details: { githubId: "999", login: "intruder" } },
        { event: "sign_in_rejected", actor: "github:1000", details: { githubId: "1000", login: "other" } },
      ]);
    });

    test("logRejectedSignIn writes again once the last row is over an hour old", async () => {
      assert.equal(await logRejectedSignIn({ githubId: "999", login: "intruder" }, db.pool), true);
      await db.pool.query("update admin_audit_log set at = now() - interval '59 minutes'");
      assert.equal(await logRejectedSignIn({ githubId: "999", login: "intruder" }, db.pool), false);
      await db.pool.query("update admin_audit_log set at = now() - interval '61 minutes'");
      assert.equal(await logRejectedSignIn({ githubId: "999", login: "intruder" }, db.pool), true);
      assert.equal((await rows()).length, 2);
    });

    test("logRejectedSignIn writes at most five rows an hour across all GitHub ids", async () => {
      for (let id = 1; id <= 5; id += 1) {
        assert.equal(await logRejectedSignIn({ githubId: String(id), login: `user${id}` }, db.pool), true, `id ${id}`);
      }
      assert.equal(await logRejectedSignIn({ githubId: "6", login: "user6" }, db.pool), false, "the sixth id in the hour");
      await logAdminEvent("sign_in", { actor: OWNER_ACTOR }, db.pool);
      assert.equal((await rows()).filter((r) => r.event === "sign_in_rejected").length, 5);
      await db.pool.query("update admin_audit_log set at = now() - interval '61 minutes' where event = 'sign_in_rejected'");
      assert.equal(await logRejectedSignIn({ githubId: "6", login: "user6" }, db.pool), true);
    });

    test("recentAdminEvents returns newest first, limited, with exactly five fields", async () => {
      await logAdminEvent("sign_in", { actor: OWNER_ACTOR }, db.pool);
      await logAdminEvent("instagram_check", { actor: OWNER_ACTOR, details: { fetched: 3 } }, db.pool);
      await logAdminEvent("instagram_import", { actor: OWNER_ACTOR }, db.pool);
      const events = await recentAdminEvents(2, db.pool);
      assert.deepEqual(events.map((e) => e.event), ["instagram_import", "instagram_check"]);
      assert.deepEqual(Object.keys(events[0]).sort(), ["actor", "at", "details", "event", "id"]);
      assert.equal(typeof events[0].id, "number");
      assert.ok(events[0].at instanceof Date);
      assert.deepEqual(events[1].details, { fetched: 3 });
      assert.equal((await recentAdminEvents(undefined, db.pool)).length, 3);
    });

    test("recentAdminEvents leaves out refused sign-ins", async () => {
      await logAdminEvent("sign_in", { actor: OWNER_ACTOR }, db.pool);
      for (let id = 1; id <= 3; id += 1) await logRejectedSignIn({ githubId: String(id), login: `user${id}` }, db.pool);
      assert.deepEqual((await recentAdminEvents(2, db.pool)).map((e) => e.event), ["sign_in"]);
      assert.deepEqual((await recentAdminEvents(undefined, db.pool)).map((e) => e.event), ["sign_in"]);
    });

    test("refusedSignInSummary counts the last 24 hours and names the newest refusal", async () => {
      assert.deepEqual(await refusedSignInSummary(db.pool), { count24h: 0, latestAt: null, latestLogin: null });
      await logRejectedSignIn({ githubId: "1", login: "old" }, db.pool);
      await db.pool.query("update admin_audit_log set at = now() - interval '25 hours' where actor = 'github:1'");
      await logRejectedSignIn({ githubId: "2", login: "earlier" }, db.pool);
      await db.pool.query("update admin_audit_log set at = now() - interval '2 hours' where actor = 'github:2'");
      await logRejectedSignIn({ githubId: "3", login: "newest" }, db.pool);
      await logAdminEvent("sign_in", { actor: OWNER_ACTOR }, db.pool);
      const summary = await refusedSignInSummary(db.pool);
      assert.deepEqual(Object.keys(summary).sort(), ["count24h", "latestAt", "latestLogin"]);
      assert.equal(summary.count24h, 2);
      assert.equal(summary.latestLogin, "newest");
      assert.ok(summary.latestAt instanceof Date);
      assert.ok(Math.abs(summary.latestAt.getTime() - Date.now()) < 60_000);
    });
  });
  ```

- [ ] **Step 5: Run it to verify it fails.**

  ```sh
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/integration/admin-audit-log.test.mjs
  ```

  Expected: fails with `ERR_MODULE_NOT_FOUND` naming `lib/admin/audit-log.js`.

- [ ] **Step 6: Implement `lib/admin/audit-log.js`.** Imports: `getDbPool` from `"../db.js"`, `redact` from
  `"../redact.js"`, `OWNER_GITHUB_ID` from `"./owner.js"`. Exports and signatures as in Interfaces;
  `recentAdminEvents` maps each row to `{ id: Number(row.id), at, event, actor, details }`, and
  `refusedSignInSummary` returns `{ count24h: row.count24h, latestAt: row.latest_at, latestLogin: row.latest_login }`.
  The SQL:

  ```sql
  -- logAdminEvent: params [event, actor, JSON.stringify(redact(details))]
  insert into admin_audit_log (event, actor, details) values ($1, $2, $3::jsonb)

  -- logRejectedSignIn: params [`github:${String(githubId)}`, JSON.stringify(redact({ githubId: String(githubId), login: login ?? null }))]
  -- returns rowCount === 1
  insert into admin_audit_log (event, actor, details)
  select 'sign_in_rejected', $1::text, $2::jsonb
  where not exists (
    select 1 from admin_audit_log
    where event = 'sign_in_rejected' and actor = $1::text and at > now() - interval '1 hour'
  )
  and (
    select count(*) from admin_audit_log
    where event = 'sign_in_rejected' and at > now() - interval '1 hour'
  ) < 5

  -- recentAdminEvents: params [limit]
  select id, at, event, actor, details from admin_audit_log
  where event <> 'sign_in_rejected'
  order by at desc, id desc limit $1

  -- refusedSignInSummary: no params; one row (count 0 and nulls when there are no refusals)
  select count(*)::int as count24h, max(at) as latest_at,
         (array_agg(details->>'login' order by at desc, id desc))[1] as latest_login
  from admin_audit_log
  where event = 'sign_in_rejected' and at > now() - interval '24 hours'
  ```

  Refused sign-ins are logged because Kevin's D5 answer covered "rejected sign-ins". Any GitHub account can trigger
  one, so the two caps bound what strangers can write (5 rows an hour in total), and `recentAdminEvents` leaves
  refusals out so they can never push real events out of the dashboard's activity list; the dashboard shows
  `refusedSignInSummary` as a separate line instead (Tasks 15 and 17). The `not exists` guard and the 5-an-hour
  cap are best-effort under concurrency (simultaneous rejected sign-ins can each insert). Each attempt needs a full
  GitHub round trip, so that is accepted; say so in a one-line comment.

- [ ] **Step 7: Run it to verify it passes.**

  ```sh
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/integration/admin-audit-log.test.mjs
  ```

  Expected: `ℹ tests 9`, `ℹ pass 9`, `ℹ fail 0`, `ℹ cancelled 0`, and no `﹣ admin audit log` skip line.

- [ ] **Step 8: Commit.**

  ```sh
  git add lib/admin/audit-log.js tests/integration/admin-audit-log.test.mjs
  git commit -m "Add the admin audit log"
  ```

#### Part C: `sql/007_auth.sql`

- [ ] **Step 9: Write the failing integration test** `tests/integration/auth-schema.test.mjs`:

  ```js
  import { describe, test, before, after } from "node:test";
  import assert from "node:assert/strict";
  import { readFileSync } from "node:fs";
  import { testDb } from "../helpers/db.mjs";

  const db = testDb();
  const applySql = (file) => db.pool.query(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"));
  const EXPECTED = {
    auth_user: ["id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt"],
    auth_session: ["id", "expiresAt", "token", "createdAt", "updatedAt", "ipAddress", "userAgent", "userId"],
    auth_account: ["id", "accountId", "providerId", "userId", "accessToken", "refreshToken", "idToken",
      "accessTokenExpiresAt", "refreshTokenExpiresAt", "scope", "password", "createdAt", "updatedAt"],
    auth_verification: ["id", "identifier", "value", "expiresAt", "createdAt", "updatedAt"],
  };

  describe("sql/007_auth.sql", { skip: db.skip }, () => {
    before(() => db.resetSchema());
    after(() => db.close());

    test("007 applies twice", async () => {
      await applySql("sql/007_auth.sql");
      await applySql("sql/007_auth.sql");
    });

    test("007 creates exactly the columns Better Auth 1.7.10 reads and writes", async () => {
      for (const [table, columns] of Object.entries(EXPECTED)) {
        const { rows } = await db.pool.query(
          "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position",
          [table],
        );
        assert.deepEqual(rows.map((r) => r.column_name), columns, table);
      }
    });

    test("auth_account holds one row per (providerId, accountId)", async () => {
      await db.pool.query(`insert into auth_user ("id", "name", "email", "updatedAt") values ('u1', 'Kevin Wong', '1741711@github.placeholder.invalid', now())`);
      const insertAccount = (id) => db.pool.query(
        `insert into auth_account ("id", "accountId", "providerId", "userId", "updatedAt") values ($1, '1741711', 'github', 'u1', now())`,
        [id],
      );
      await insertAccount("a1");
      await assert.rejects(insertAccount("a2"), { code: "23505" });
    });
  });
  ```

  `resetSchema()` already applies 007 once it exists; the first test applies it twice more.

- [ ] **Step 10: Run it to verify it fails.**

  ```sh
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/integration/auth-schema.test.mjs
  ```

  Expected: `007 applies twice` fails with `ENOENT` for `sql/007_auth.sql`; the other two fail with
  `relation "auth_user" does not exist` or an empty column list.

- [ ] **Step 11: Create `sql/007_auth.sql`** (exact copy; the header follows `sql/003`/`sql/004`):

  ```sql
  -- Better Auth 1.7.10 tables for the /admin sign-in (lib/auth.js).
  --
  -- Hand-written from @better-auth/core 1.7.10's schema (src/db/get-tables.ts) with
  -- modelName auth_user / auth_session / auth_account / auth_verification and the
  -- default camelCase column names, so every column is quoted. Confirm with the
  -- read-only `npx --no-install auth check --config scripts/auth.config.mjs`.
  --
  -- Better Auth checks this schema before every request and fails them when a
  -- table or column is missing, so apply this file before the deploy that signs in.
  -- auth_verification stays empty (OAuth state lives in an encrypted cookie), but
  -- the schema check requires it.
  --
  -- The unique index on ("providerId", "accountId") is not generated by Better
  -- Auth; its account lookup assumes one row per GitHub account.
  --
  -- Additive; safe to apply twice. Apply over the direct (non-pooler) URL; see 003
  -- for why the lock timeout is `set local` inside one transaction.
  begin;

  set local lock_timeout = '5s';

  create table if not exists auth_user (
    "id"            text primary key,
    "name"          text not null,
    "email"         text not null unique,
    "emailVerified" boolean not null default false,
    "image"         text,
    "createdAt"     timestamptz not null default current_timestamp,
    "updatedAt"     timestamptz not null default current_timestamp
  );

  create table if not exists auth_session (
    "id"        text primary key,
    "expiresAt" timestamptz not null,
    "token"     text not null unique,
    "createdAt" timestamptz not null default current_timestamp,
    "updatedAt" timestamptz not null,
    "ipAddress" text,
    "userAgent" text,
    "userId"    text not null references auth_user ("id") on delete cascade
  );
  create index if not exists "auth_session_userId_idx" on auth_session ("userId");

  create table if not exists auth_account (
    "id"                    text primary key,
    "accountId"             text not null,
    "providerId"            text not null,
    "userId"                text not null references auth_user ("id") on delete cascade,
    "accessToken"           text,
    "refreshToken"          text,
    "idToken"               text,
    "accessTokenExpiresAt"  timestamptz,
    "refreshTokenExpiresAt" timestamptz,
    "scope"                 text,
    "password"              text,
    "createdAt"             timestamptz not null default current_timestamp,
    "updatedAt"             timestamptz not null
  );
  create index if not exists "auth_account_userId_idx" on auth_account ("userId");
  create unique index if not exists auth_account_provider_account_uidx on auth_account ("providerId", "accountId");

  create table if not exists auth_verification (
    "id"         text primary key,
    "identifier" text not null,
    "value"      text not null,
    "expiresAt"  timestamptz not null,
    "createdAt"  timestamptz not null default current_timestamp,
    "updatedAt"  timestamptz not null default current_timestamp
  );
  create index if not exists "auth_verification_identifier_idx" on auth_verification ("identifier");

  commit;
  ```

- [ ] **Step 12: Run it to verify it passes.**

  ```sh
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/integration/auth-schema.test.mjs
  ```

  Expected: `ℹ tests 3`, `ℹ pass 3`, `ℹ fail 0`, `ℹ cancelled 0`.

- [ ] **Step 13: Commit.**

  ```sh
  git add sql/007_auth.sql tests/integration/auth-schema.test.mjs
  git commit -m "Add the Better Auth tables"
  ```

#### Part D: `lib/auth.js` and the CLI shim

- [ ] **Step 14: Write the failing unit test** `tests/auth.test.mjs`:

  ```js
  import { test } from "node:test";
  import assert from "node:assert/strict";
  import { buildAuthOptions, githubProfileToUser, validateOwner } from "../lib/auth.js";

  const NOT_OWNER = { error: "not_owner", errorDescription: "This GitHub account can't sign in here." };
  const quiet = { logRejected: async () => {}, schedule: () => {} };
  const oauth = (id, login = "someone", providerId = "github", action = "create-user") =>
    ({ method: "oauth", oauth: { providerId, profile: { id, login } }, action });
  const REJECTED = [
    ["another GitHub id", oauth(999)],
    ["a longer id", oauth(17417110)],
    ["a zero-padded id", oauth("01741711")],
    ["an id with a trailing space", oauth("1741711 ")],
    ["another provider", oauth(1741711, "dotKevinWong", "google")],
    ["a non-oauth method", { method: "sso-oidc", sso: { providerId: "github" }, oauth: { providerId: "github", profile: { id: 1741711 } }, action: "create-user" }],
    ["no profile", { method: "oauth", oauth: { providerId: "github" }, action: "create-user" }],
    ["a profile without an id", { method: "oauth", oauth: { providerId: "github", profile: { login: "dotKevinWong" } }, action: "sign-in" }],
    ["no oauth block", { method: "oauth", action: "sign-in" }],
    ["no source", undefined],
  ];
  const VALID_ENV = {
    BETTER_AUTH_URL: "https://www.kevinwong.co", BETTER_AUTH_SECRET: "a".repeat(64),
    GITHUB_CLIENT_ID: "client-id", GITHUB_CLIENT_SECRET: "client-secret",
  };
  const PROD_ENV = { ...VALID_ENV, NODE_ENV: "production" };

  test("validateOwner accepts the owner's GitHub id as a number or a string", () => {
    assert.equal(validateOwner({ source: oauth(1741711, "dotKevinWong") }, null, quiet), undefined);
    assert.equal(validateOwner({ source: oauth(1741711, "dotKevinWong", "github", "sign-in") }, null, quiet), undefined);
    assert.equal(validateOwner({ source: oauth("1741711", "dotKevinWong") }, null, quiet), undefined);
  });

  test("validateOwner rejects every non-owner source with not_owner", () => {
    for (const [name, source] of REJECTED) assert.deepEqual(validateOwner({ source }, null, quiet), NOT_OWNER, name);
  });

  test("validateOwner never returns false", () => {
    for (const source of [oauth(1741711), ...REJECTED.map(([, s]) => s)]) {
      const result = validateOwner({ source }, null, quiet);
      assert.notEqual(result, false);
      assert.ok(result === undefined || result.error === "not_owner");
    }
  });

  test("validateOwner schedules one rejected-sign-in log and does not await it", async () => {
    const scheduled = [];
    const logged = [];
    const deps = { logRejected: async (args) => { logged.push(args); }, schedule: (p) => { scheduled.push(p); } };
    const result = validateOwner({ source: oauth(999, "intruder") }, null, deps);
    assert.equal(result instanceof Promise, false);
    assert.deepEqual(result, NOT_OWNER);
    assert.equal(scheduled.length, 1);
    assert.ok(scheduled[0] instanceof Promise);
    await scheduled[0];
    assert.deepEqual(logged, [{ githubId: "999", login: "intruder" }]);
    validateOwner({ source: oauth(1741711, "dotKevinWong") }, null, deps);
    assert.equal(scheduled.length, 1, "the owner schedules nothing");
  });

  test("validateOwner still rejects when the rejected-sign-in log fails", async () => {
    const scheduled = [];
    const deps = { logRejected: async () => { throw new Error("database down"); }, schedule: (p) => { scheduled.push(p); } };
    assert.deepEqual(validateOwner({ source: oauth(999, "intruder") }, null, deps), NOT_OWNER);
    await assert.doesNotReject(scheduled[0]);
  });

  test("githubProfileToUser fills a placeholder email and falls back to the login", () => {
    assert.deepEqual(githubProfileToUser({ id: 1741711, login: "dotKevinWong", name: null, email: null }),
      { email: "1741711@github.placeholder.invalid", name: "dotKevinWong" });
  });

  test("githubProfileToUser keeps a real email and name", () => {
    assert.deepEqual(githubProfileToUser({ id: 1, login: "a", name: "A Person", email: "a@example.com" }),
      { email: "a@example.com", name: "A Person" });
  });

  test("buildAuthOptions pins the reviewed options", () => {
    const db = { query() {} };
    const o = buildAuthOptions({ env: VALID_ENV, db });
    assert.equal(o.appName, "kevinwong.co admin");
    assert.equal(o.baseURL, "https://www.kevinwong.co");
    assert.equal(o.secret, "a".repeat(64));
    assert.equal(o.database, db);
    assert.deepEqual(o.emailAndPassword, { enabled: false });
    const gh = o.socialProviders.github;
    assert.deepEqual(Object.keys(o.socialProviders), ["github"]);
    assert.equal(gh.clientId, "client-id");
    assert.equal(gh.clientSecret, "client-secret");
    assert.equal(gh.disableDefaultScope, true);
    assert.equal("scope" in gh, false, "no GitHub scopes");
    assert.equal(gh.mapProfileToUser, githubProfileToUser);
    assert.deepEqual(o.user, { modelName: "auth_user", validateUserInfo: validateOwner });
    assert.deepEqual(o.session, { modelName: "auth_session", expiresIn: 86_400, disableSessionRefresh: true, cookieCache: { enabled: false } });
    assert.deepEqual(o.account, { modelName: "auth_account", accountLinking: { enabled: false }, storeStateStrategy: "cookie", encryptOAuthTokens: true });
    assert.deepEqual(o.verification, { modelName: "auth_verification" });
    assert.equal(typeof o.databaseHooks.session.create.after, "function");
    assert.deepEqual(o.onAPIError, { errorURL: "/admin/sign-in" });
    assert.deepEqual(o.rateLimit, { enabled: true, storage: "memory" });
    assert.deepEqual(o.telemetry, { enabled: false });
    assert.equal(o.advanced.useSecureCookies, true);
    assert.equal(typeof o.advanced.backgroundTasks.handler, "function");
    assert.deepEqual(o.disabledPaths, [
      "/get-session", "/list-sessions", "/update-session", "/revoke-session", "/revoke-sessions",
      "/revoke-other-sessions", "/link-social", "/unlink-account", "/get-access-token", "/refresh-token",
      "/list-accounts", "/account-info", "/update-user", "/delete-user", "/change-email", "/change-password",
      "/sign-in/email", "/sign-up/email", "/error",
    ]);
    for (const p of ["/sign-in/social", "/callback/github", "/sign-out"]) assert.ok(!o.disabledPaths.includes(p), p);
  });

  test("buildAuthOptions requires BETTER_AUTH_URL in production only", () => {
    assert.throws(() => buildAuthOptions({ env: { ...PROD_ENV, BETTER_AUTH_URL: undefined }, db: {} }), { message: "BETTER_AUTH_URL is not set" });
    assert.doesNotThrow(() => buildAuthOptions({ env: {}, db: {} }));
    assert.doesNotThrow(() => buildAuthOptions({ env: PROD_ENV, db: {} }));
  });

  test("buildAuthOptions refuses any origin but https://www.kevinwong.co in production", () => {
    for (const url of ["https://kevinwong.co", "https://www.kevinwong.co/", "https://kevinwong-co.vercel.app"]) {
      assert.throws(() => buildAuthOptions({ env: { ...PROD_ENV, BETTER_AUTH_URL: url }, db: {} }),
        { message: "BETTER_AUTH_URL must be https://www.kevinwong.co" }, url);
    }
  });

  test("buildAuthOptions requires a 32-character BETTER_AUTH_SECRET in production", () => {
    for (const secret of [undefined, "", "x".repeat(31)]) {
      assert.throws(() => buildAuthOptions({ env: { ...PROD_ENV, BETTER_AUTH_SECRET: secret }, db: {} }),
        { message: "BETTER_AUTH_SECRET must be set to at least 32 characters" });
    }
  });
  ```

  The brief listed "string vs number id" among the rejections. With the skeleton's `String(...)` comparison, the
  owner id as the string `"1741711"` is accepted, so the test asserts that both forms pass and near-miss ids fail.

- [ ] **Step 15: Run it to verify it fails.**

  ```sh
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/auth.test.mjs
  ```

  Expected: fails with `ERR_MODULE_NOT_FOUND` naming `lib/auth.js`.

- [ ] **Step 16: Implement `lib/auth.js` and `scripts/auth.config.mjs`.** Imports in `lib/auth.js`:
  `betterAuth` from `"better-auth"`, `waitUntil` from `"@vercel/functions"`, `getDbPool` from `"./db.js"`,
  `OWNER_GITHUB_ID` and `SITE_ORIGIN` from `"./admin/owner.js"`, and `OWNER_ACTOR`, `logAdminEvent` and
  `logRejectedSignIn` from `"./admin/audit-log.js"`. Don't import `server-only` (the CLI can't load it), and import
  this module only from `pages/api/**` and `getServerSideProps`.

  - `validateOwner`: owner when `source?.method === "oauth" && source.oauth?.providerId === "github" &&
    String(source.oauth?.profile?.id ?? "") === OWNER_GITHUB_ID`; return `undefined`. Otherwise call
    `schedule(Promise.resolve().then(() => logRejected({ githubId: String(source?.oauth?.profile?.id ?? "unknown"),
    login: source?.oauth?.profile?.login ?? null })).catch((error) => console.error("[auth] could not log a rejected
    sign-in", error)))` and return `NOT_OWNER` (exact object above). It never returns `false`, which would let the
    sign-in through (`dist/utils/validate-user-info.mjs`).
  - `githubProfileToUser = (p) => ({ email: p.email ?? \`${p.id}@github.placeholder.invalid\`, name: p.name ?? p.login })`.
  - `getAuth()`: `instance ??= betterAuth(buildAuthOptions()); return instance;`. Never call `betterAuth()` at
    module level: it validates the secret and starts a database introspection as soon as it runs.
  - `buildAuthOptions`: make the four `buildAuthOptions` tests pass. The first pins every option, including the
    `disabledPaths` list; keep that list in a module-level `DISABLED_PATHS` constant, commented as the second layer
    behind `pages/api/auth/[...all].js`'s allowlist (exact match, router only). The other three pin the production
    checks, which run before the options object is built and only when `env.NODE_ENV === "production"`. `database`
    is `db ?? getDbPool()`. The unit tests check only that the sign-in hook is a function (Task 12's integration
    test waits for its row), so write it as:

  ```js
      databaseHooks: {
        session: {
          create: {
            after: async (session) => {
              waitUntil(
                logAdminEvent("sign_in", {
                  actor: OWNER_ACTOR,
                  details: { ipAddress: session.ipAddress ?? null, userAgent: session.userAgent ?? null },
                }).catch((error) => console.error("[auth] could not log sign_in", error)),
              );
            },
          },
        },
      },
  ```

  `useSecureCookies: true` replaces better-auth.md section 17's `NODE_ENV === "production"`. Sign-in runs only in
  production (D1), and the https `baseURL` already implies the `__Secure-` prefix, so this changes nothing there,
  and the integration tests then see the same cookie names as production.

  `scripts/auth.config.mjs` (exact):

  ```js
  // For the Better Auth CLI only: it needs an exported instance, and lib/auth.js builds one lazily.
  // Read-only check: npx --no-install auth check --config scripts/auth.config.mjs
  import { getAuth } from "../lib/auth.js";

  export const auth = getAuth();
  ```

- [ ] **Step 17: Run the tests to verify they pass.**

  ```sh
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/auth.test.mjs
  npm test
  npm run lint
  ```

  Expected: the focused run shows `ℹ tests 11`, `ℹ pass 11`, `ℹ fail 0`, `ℹ cancelled 0`. One `[auth] could not
  log a rejected sign-in` line on stderr comes from the "log fails" test and is expected. `npm test` shows
  `ℹ fail 0` and `ℹ cancelled 0`; `npm run lint` exits 0.

#### Part E: the CLI schema check against the test database

- [ ] **Step 18: Run the Better Auth CLI check.** Run it in the worktree, which has no `.env` or `.env.local` (the
  CLI loads those two from the current directory; it does not read `.env.test.local`). The subshell loads the test
  URL from `.env.test.local` and points `DATABASE_URL` at it, so both revert afterwards:

  ```sh
  test ! -e .env && test ! -e .env.local && echo "no env files"
  npm run db:test -- reset
  (
    set -a && . ./.env.test.local && set +a
    export DATABASE_URL="$TEST_DATABASE_URL"
    export BETTER_AUTH_URL="https://www.kevinwong.co"
    export BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
    npx --no-install auth check --config scripts/auth.config.mjs; echo "exit=$?"
  )
  ```

  Expected: `no env files`, then `reset 127.0.0.1:55432/kw_test: loaded tests/fixtures/prod-schema.sql, applied 3
  migrations` (005, 006 and 007), then `Schema check passed against the live database.` and `exit=0`. `exit=1`
  prints the mismatch (fix `sql/007_auth.sql`, not the options); `exit=2` means the config didn't load or the
  database didn't connect. A `Social provider github is missing clientId` warning is expected and harmless here.
  If `npx` reports it can't find `auth`, Step 1's devDependency isn't installed: run `npm ci`, never `npx --yes`.

- [ ] **Step 19: Commit.**

  ```sh
  git add lib/auth.js scripts/auth.config.mjs tests/auth.test.mjs
  git commit -m "Add the Better Auth instance with the GitHub owner gate"
  ```

Kevin does the setup for this (the GitHub OAuth App and the four auth env vars) in Task 18, Steps 5 and 6.

---

### Task 12: `lib/admin/guard.js`, the allowlisted auth route, and the admin header rule

**Model:** Opus

**Files:**
- Create: `lib/admin/guard.js`, `pages/api/auth/[...all].js`, `tests/helpers/admin-fakes.mjs`
- Modify: `next.config.js` (`nextConfig.headers()`: add three rules after the generic one)
- Test: `tests/admin-guard.test.mjs`, `tests/next-config.test.mjs`, `tests/integration/admin-sign-in.test.mjs`

**Interfaces:**
- Consumes:
  - `lib/auth.js` (Task 11): `getAuth()`.
  - `lib/admin/audit-log.js` (Task 11), in the integration test only: `recentAdminEvents(limit = 20, db?)` (leaves
    out `sign_in_rejected`) and `refusedSignInSummary(db?)` → `{ count24h, latestAt: Date | null, latestLogin: string | null }`.
  - `lib/db.js`: `getDbPool()`.
  - `lib/admin/owner.js` (Task 7): `OWNER_GITHUB_ID = "1741711"`, `SITE_ORIGIN = "https://www.kevinwong.co"`, `SITE_HOST = "www.kevinwong.co"`.
  - `better-auth/node` (1.7.10): `toNodeHandler(auth)`, `fromNodeHeaders(nodeHeaders): Headers`.
  - `tests/helpers/db.mjs` (Task 2): `testDb()` → `{ skip: false | string, pool: pg.Pool | null,
    resetSchema(): Promise<number>, close(): Promise<void> }`, one object per process. `resetSchema()` rebuilds
    `public` from the production-schema fixture and applies every `sql/005+` file, so `admin_audit_log` (006) and
    the auth tables (007) exist. Usage: `describe(name, { skip: db.skip }, () => { before(() => db.resetSchema());
    after(() => db.close()); ... })`. The helper refuses to load when `DATABASE_URL` points at a remote database,
    so a test that needs lib code's default pool sets `process.env.DATABASE_URL = process.env.TEST_DATABASE_URL`
    itself.
- Produces:
  - `lib/admin/guard.js`:
    - `export function isAdminEnabled(req, env = process.env): boolean` — `env.VERCEL_ENV === "production" && req.headers.host === SITE_HOST`.
    - `export function isSameOrigin(req): boolean` — `req.headers.origin === SITE_ORIGIN`.
    - `export function setNoStore(res): void` — `res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate")`.
    - `export async function getOwnerSession(req, { auth = getAuth(), db = getDbPool() } = {}): Promise<null | { userId: string, name: string, image: string | null, expiresAt: Date }>`
    - `export async function requireAdmin(req, res, { mutation = false, deps = {} } = {}): Promise<null | Owner>` — `deps` is `{ env?, auth?, db? }`; a missing key means the real one. When it returns `null` it has already sent 404, 403 or 401.
    - `export function isAllowedAuthRequest(method: string, url: string): boolean` — the route's allowlist as a pure function. `url` is `req.url`; the pathname is the part before the first `?`, taken without URL parsing.
  - `tests/helpers/admin-fakes.mjs`: `PROD_ENV`, `fakeReq()`, `fakeRes()`, `OWNER_SESSION`, `fakeAuth()`, `fakeDb()` (Task 13 uses them).
  - `pages/api/auth/[...all].js`: `config = { api: { bodyParser: false } }`; 404 `{ error: "not_found" }` unless enabled and allowlisted.
  - `next.config.js`: admin header rules for `/admin/:path*`, `/api/admin/:path*`, `/api/auth/:path*`.

**Better Auth's error page.** As the spec's path allowlist says (changed 2026-10-16), errors redirect to
`/admin/sign-in` through `onAPIError.errorURL` (Task 11), so Better Auth's `/error` is never forwarded. It stays out
of the allowlist and in `disabledPaths`, and `GET /api/auth/error` answers 404 (the `["GET", "/api/auth/error", false]`
case below).

- [ ] **Step 1: Write the shared fakes** `tests/helpers/admin-fakes.mjs` (exact):

  ```js
  // Fake Next.js req/res and injected auth/db for admin route tests (no HTTP server, no module mocks).
  export const PROD_ENV = Object.freeze({ VERCEL_ENV: "production" });

  export function fakeReq({ method = "GET", host = "www.kevinwong.co", origin, cookie, query = {}, url = "/" } = {}) {
    const headers = { host };
    if (origin !== undefined) headers.origin = origin;
    if (cookie !== undefined) headers.cookie = cookie;
    return { method, headers, query, url };
  }

  export function fakeRes() {
    return {
      statusCode: 200, headers: {}, body: undefined, ended: false,
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
      getHeader(name) { return this.headers[name.toLowerCase()]; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; this.ended = true; return this; },
      end() { this.ended = true; return this; },
    };
  }

  export const OWNER_SESSION = Object.freeze({
    user: { id: "user-1", name: "Kevin Wong", email: "1741711@github.placeholder.invalid", image: "https://avatars.githubusercontent.com/u/1741711?v=4" },
    session: { id: "session-1", userId: "user-1", token: "session-token", expiresAt: new Date("2026-10-17T12:00:00.000Z") },
  });

  export function fakeAuth(session = OWNER_SESSION) {
    const calls = [];
    return { calls, api: { async getSession(args) { calls.push(args); return session; } } };
  }

  export function fakeDb(rowCount = 1) {
    const calls = [];
    return {
      calls,
      async query(sql, params) {
        calls.push({ sql, params });
        return { rowCount, rows: Array.from({ length: rowCount }, () => ({ "?column?": 1 })) };
      },
    };
  }
  ```

- [ ] **Step 2: Write the failing unit tests.** `tests/admin-guard.test.mjs`:

  ```js
  import { test } from "node:test";
  import assert from "node:assert/strict";
  import { getOwnerSession, isAdminEnabled, isAllowedAuthRequest, isSameOrigin, requireAdmin, setNoStore } from "../lib/admin/guard.js";
  import { OWNER_SESSION, PROD_ENV, fakeAuth, fakeDb, fakeReq, fakeRes } from "./helpers/admin-fakes.mjs";

  const NO_STORE = "private, no-store, max-age=0, must-revalidate";
  const OWNER = { userId: "user-1", name: "Kevin Wong", image: "https://avatars.githubusercontent.com/u/1741711?v=4", expiresAt: new Date("2026-10-17T12:00:00.000Z") };

  async function guard(reqOptions, { env = PROD_ENV, auth = fakeAuth(), db = fakeDb(1), mutation = false } = {}) {
    const res = fakeRes();
    const owner = await requireAdmin(fakeReq(reqOptions), res, { mutation, deps: { env, auth, db } });
    return { owner, res, auth, db };
  }

  test("isAdminEnabled only in production on www.kevinwong.co", () => {
    const cases = [
      [{ VERCEL_ENV: "production" }, "www.kevinwong.co", true],
      [{ VERCEL_ENV: "preview" }, "www.kevinwong.co", false],
      [{ VERCEL_ENV: "development" }, "www.kevinwong.co", false],
      [{}, "www.kevinwong.co", false],
      [{ VERCEL_ENV: "production" }, "kevinwong.co", false],
      [{ VERCEL_ENV: "production" }, "kevinwong-co.vercel.app", false],
      [{ VERCEL_ENV: "production" }, "WWW.KEVINWONG.CO", false],
      [{ VERCEL_ENV: "production" }, undefined, false],
    ];
    for (const [env, host, expected] of cases) {
      // fakeReq's default would fill in www.kevinwong.co, so the no-Host request is built by hand.
      const req = host === undefined ? { method: "GET", headers: {}, query: {}, url: "/" } : fakeReq({ host });
      assert.equal(isAdminEnabled(req, env), expected, `${env.VERCEL_ENV} ${host}`);
    }
  });

  test("isSameOrigin requires exactly https://www.kevinwong.co", () => {
    assert.equal(isSameOrigin(fakeReq({ origin: "https://www.kevinwong.co" })), true);
    for (const origin of ["https://kevinwong.co", "http://www.kevinwong.co", "https://www.kevinwong.co/", "https://www.kevinwong.co.evil.example", "null", undefined]) {
      assert.equal(isSameOrigin(fakeReq({ origin })), false, String(origin));
    }
  });

  test("setNoStore sets the exact Cache-Control", () => {
    const res = fakeRes();
    setNoStore(res);
    assert.equal(res.getHeader("Cache-Control"), NO_STORE);
  });

  test("getOwnerSession returns null without a session and never queries the database", async () => {
    const db = fakeDb(1);
    assert.equal(await getOwnerSession(fakeReq({ cookie: "x=1" }), { auth: fakeAuth(null), db }), null);
    assert.equal(db.calls.length, 0);
  });

  test("getOwnerSession checks the session user's GitHub 1741711 account and returns four fields", async () => {
    const auth = fakeAuth();
    const db = fakeDb(1);
    const owner = await getOwnerSession(fakeReq({ cookie: "__Secure-better-auth.session_token=abc" }), { auth, db });
    assert.deepEqual(owner, OWNER);
    const [{ headers }] = auth.calls;
    assert.ok(headers instanceof Headers);
    assert.equal(headers.get("cookie"), "__Secure-better-auth.session_token=abc");
    assert.equal(db.calls.length, 1);
    assert.match(db.calls[0].sql, /from auth_account where "userId" = \$1 and "providerId" = 'github' and "accountId" = \$2/);
    assert.deepEqual(db.calls[0].params, ["user-1", "1741711"]);
    const noImage = await getOwnerSession(fakeReq(), { auth: fakeAuth({ ...OWNER_SESSION, user: { ...OWNER_SESSION.user, image: undefined } }), db });
    assert.equal(noImage.image, null);
  });

  test("getOwnerSession returns null when the user has no GitHub 1741711 account", async () => {
    assert.equal(await getOwnerSession(fakeReq(), { auth: fakeAuth(), db: fakeDb(0) }), null);
  });

  test("requireAdmin 404s on a preview deployment without reading the session", async () => {
    const { owner, res, auth } = await guard({}, { env: { VERCEL_ENV: "preview" } });
    assert.equal(owner, null);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { error: "not_found" });
    assert.equal(res.getHeader("Cache-Control"), NO_STORE);
    assert.equal(auth.calls.length, 0);
  });

  test("requireAdmin 404s on the apex host", async () => {
    const { owner, res } = await guard({ host: "kevinwong.co" });
    assert.equal(owner, null);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { error: "not_found" });
  });

  test("requireAdmin 403s a mutation from https://kevinwong.co", async () => {
    const { owner, res, auth } = await guard({ method: "POST", origin: "https://kevinwong.co" }, { mutation: true });
    assert.equal(owner, null);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: "bad_origin" });
    assert.equal(res.getHeader("Cache-Control"), NO_STORE);
    assert.equal(auth.calls.length, 0);
  });

  test("requireAdmin 403s a mutation with no Origin", async () => {
    const { owner, res } = await guard({ method: "POST" }, { mutation: true });
    assert.equal(owner, null);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: "bad_origin" });
  });

  test("requireAdmin 401s without a session", async () => {
    const { owner, res } = await guard({}, { auth: fakeAuth(null) });
    assert.equal(owner, null);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: "unauthorized" });
    assert.equal(res.getHeader("Cache-Control"), NO_STORE);
  });

  test("requireAdmin 401s a session whose user lacks the GitHub 1741711 account", async () => {
    const { owner, res } = await guard({}, { db: fakeDb(0) });
    assert.equal(owner, null);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: "unauthorized" });
  });

  test("requireAdmin returns the owner for a same-origin mutation and writes no response", async () => {
    const { owner, res } = await guard({ method: "POST", origin: "https://www.kevinwong.co" }, { mutation: true });
    assert.deepEqual(owner, OWNER);
    assert.equal(res.getHeader("Cache-Control"), NO_STORE);
    assert.equal(res.ended, false);
    assert.equal(res.statusCode, 200);
  });

  test("requireAdmin lets a non-mutation GET through without an Origin", async () => {
    const { owner } = await guard({ method: "GET" });
    assert.deepEqual(owner, OWNER);
  });

  test("isAllowedAuthRequest allows exactly the three Better Auth routes", () => {
    const cases = [
      ["POST", "/api/auth/sign-in/social", true],
      ["GET", "/api/auth/callback/github?code=abc&state=xyz", true],
      ["GET", "/api/auth/callback/github", true],
      ["POST", "/api/auth/sign-out", true],
      ["GET", "/api/auth/get-session", false],
      ["GET", "/api/auth/sign-in/social", false],
      ["POST", "/api/auth/sign-in/social/", false],
      ["GET", "/api/auth/callback/github/", false],
      ["POST", "/api/auth/callback/github", false],
      ["GET", "/api/auth/callback/google?code=abc", false],
      ["HEAD", "/api/auth/callback/github", false],
      ["GET", "//api/auth/callback/github", false],
      ["GET", "/api/auth/list-sessions", false],
      ["POST", "/api/auth/get-access-token", false],
      ["GET", "/api/auth/error", false],
      ["post", "/api/auth/sign-out", false],
      [undefined, undefined, false],
    ];
    for (const [method, url, expected] of cases) assert.equal(isAllowedAuthRequest(method, url), expected, `${method} ${url}`);
  });
  ```

  `tests/next-config.test.mjs` (it replaces the brief's one-off `node -e` with a test that keeps checking the
  order):

  ```js
  import { test } from "node:test";
  import assert from "node:assert/strict";
  import { createRequire } from "node:module";

  const require = createRequire(import.meta.url);
  const nextConfig = require("../next.config.js");
  const { getPathMatch } = require("next/dist/shared/lib/router/utils/path-match");

  const ADMIN_HEADERS = [
    { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Robots-Tag", value: "noindex, nofollow" },
  ];

  // Next applies every matching rule in array order; for a repeated key the later rule wins.
  function effectiveHeaders(rules, path) {
    const out = new Map();
    for (const rule of rules) if (getPathMatch(rule.source)(path)) for (const { key, value } of rule.headers) out.set(key.toLowerCase(), value);
    return out;
  }

  test("the admin header rules come after the generic rule", async () => {
    const rules = await nextConfig.headers();
    assert.equal(rules[0].source, "/((?!_next/).*)");
    assert.deepEqual(rules.slice(1).map((r) => r.source), ["/admin/:path*", "/api/admin/:path*", "/api/auth/:path*"]);
    for (const rule of rules.slice(1)) assert.deepEqual(rule.headers, ADMIN_HEADERS);
  });

  test("admin header keys use the generic rule's casing and no rule sets Cache-Control", async () => {
    const rules = await nextConfig.headers();
    const genericKeys = new Map(rules[0].headers.map(({ key }) => [key.toLowerCase(), key]));
    for (const { key } of rules.slice(1).flatMap((r) => r.headers)) {
      if (genericKeys.has(key.toLowerCase())) assert.equal(key, genericKeys.get(key.toLowerCase()));
    }
    assert.ok(rules.flatMap((r) => r.headers).every(({ key }) => key.toLowerCase() !== "cache-control"));
  });

  test("admin and auth paths deny framing and indexing; public paths keep 'self'", async () => {
    const rules = await nextConfig.headers();
    for (const path of ["/admin", "/admin/sign-in", "/api/admin/status", "/api/admin/spotify/callback", "/api/auth/callback/github"]) {
      const h = effectiveHeaders(rules, path);
      assert.equal(h.get("content-security-policy"), "frame-ancestors 'none'", path);
      assert.equal(h.get("x-frame-options"), "DENY", path);
      assert.equal(h.get("x-robots-tag"), "noindex, nofollow", path);
      assert.equal(h.get("x-content-type-options"), "nosniff", path);
    }
    for (const path of ["/", "/blog", "/administrator", "/api/nowplaying"]) {
      const h = effectiveHeaders(rules, path);
      assert.equal(h.get("content-security-policy"), "frame-ancestors 'self'", path);
      assert.equal(h.has("x-robots-tag"), false, path);
    }
  });
  ```

- [ ] **Step 3: Write the failing integration test** `tests/integration/admin-sign-in.test.mjs`. It drives the
  real Better Auth handler against the test database, with GitHub's three endpoints stubbed through
  `globalThis.fetch` (Better Auth's `betterFetch` resolves `globalThis.fetch` per call). This is the spec's "a
  second GitHub account is refused with no rows written" check, read as no auth rows: the refusal still writes one
  capped `sign_in_rejected` audit row (Kevin's D5 answer covered rejected sign-ins, Task 11), which the activity list
  leaves out and `refusedSignInSummary` counts:

  ```js
  import { describe, test, before, after, mock } from "node:test";
  import assert from "node:assert/strict";
  import { randomBytes } from "node:crypto";
  import { testDb } from "../helpers/db.mjs";
  import { getAuth } from "../../lib/auth.js";
  import { getDbPool } from "../../lib/db.js";
  import { getOwnerSession } from "../../lib/admin/guard.js";
  import { recentAdminEvents, refusedSignInSummary } from "../../lib/admin/audit-log.js";

  const ORIGIN = "https://www.kevinwong.co";
  const OWNER_PROFILE = { id: 1741711, login: "dotKevinWong", name: "Kevin Wong", email: null, avatar_url: "https://avatars.githubusercontent.com/u/1741711?v=4" };
  const INTRUDER_PROFILE = { id: 999, login: "intruder", name: null, email: null, avatar_url: "https://avatars.githubusercontent.com/u/999?v=4" };
  const db = testDb();
  const count = async (table) => Number((await db.pool.query(`select count(*) from ${table}`)).rows[0].count);

  async function eventually(check, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try { return await check(); } catch (error) { if (Date.now() > deadline) throw error; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  function stubGitHub(profile) {
    return mock.method(globalThis, "fetch", async (input) => {
      const url = typeof input === "string" ? input : input.url ?? String(input);
      if (url.startsWith("https://github.com/login/oauth/access_token")) return Response.json({ access_token: "gho_test", token_type: "bearer", scope: "" });
      if (url === "https://api.github.com/user") return Response.json(profile);
      if (url === "https://api.github.com/user/emails") return Response.json({ message: "Resource not accessible" }, { status: 403 });
      throw new Error(`Unexpected fetch: ${url}`);
    });
  }

  async function signIn(profile, ip) {
    const auth = getAuth();
    const start = await auth.handler(new Request(`${ORIGIN}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": ip },
      body: JSON.stringify({ provider: "github", callbackURL: "/admin" }),
    }));
    assert.equal(start.status, 200);
    const authorize = new URL((await start.json()).url);
    assert.equal(`${authorize.origin}${authorize.pathname}`, "https://github.com/login/oauth/authorize");
    assert.equal(authorize.searchParams.get("scope"), null, "no GitHub scopes requested");
    assert.equal(authorize.searchParams.get("redirect_uri"), `${ORIGIN}/api/auth/callback/github`);
    const cookie = start.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const fetchMock = stubGitHub(profile);
    try {
      const state = encodeURIComponent(authorize.searchParams.get("state"));
      return await auth.handler(new Request(`${ORIGIN}/api/auth/callback/github?code=test-code&state=${state}`, { headers: { cookie, "x-forwarded-for": ip } }));
    } finally {
      fetchMock.mock.restore();
    }
  }

  describe("GitHub sign-in through Better Auth", { skip: db.skip }, () => {
    before(async () => {
      await db.resetSchema();
      Object.assign(process.env, {
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        BETTER_AUTH_URL: ORIGIN,
        BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
        GITHUB_CLIENT_ID: "test-client-id",
        GITHUB_CLIENT_SECRET: "test-client-secret",
      });
    });
    after(async () => { await getDbPool().end(); await db.close(); });

    test("a non-owner GitHub account is refused and leaves no auth rows", async () => {
      const res = await signIn(INTRUDER_PROFILE, "203.0.113.1");
      assert.equal(res.status, 302);
      const location = new URL(res.headers.get("location"), ORIGIN);
      assert.equal(location.pathname, "/admin/sign-in");
      assert.equal(location.searchParams.get("error"), "not_owner");
      assert.ok(!res.headers.getSetCookie().some((c) => c.startsWith("__Secure-better-auth.session_token=")));
      for (const table of ["auth_user", "auth_account", "auth_session", "auth_verification"]) assert.equal(await count(table), 0, table);
      await eventually(async () => assert.deepEqual(
        (await db.pool.query("select event, actor, details from admin_audit_log")).rows,
        [{ event: "sign_in_rejected", actor: "github:999", details: { githubId: "999", login: "intruder" } }],
      ));
      assert.deepEqual(await recentAdminEvents(20, db.pool), [], "the activity list leaves out refusals");
      const refused = await refusedSignInSummary(db.pool);
      assert.equal(refused.count24h, 1);
      assert.equal(refused.latestLogin, "intruder");
      assert.ok(refused.latestAt instanceof Date);
    });

    test("the owner signs in with a 24-hour session cookie that getOwnerSession accepts", async () => {
      const res = await signIn(OWNER_PROFILE, "203.0.113.2");
      assert.equal(res.status, 302);
      assert.equal(res.headers.get("location"), "/admin");
      const sessionCookie = res.headers.getSetCookie().find((c) => c.startsWith("__Secure-better-auth.session_token="));
      assert.match(sessionCookie, /^__Secure-better-auth\.session_token=[^;]+; Max-Age=86400; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
      assert.deepEqual((await db.pool.query(`select "email", "name" from auth_user`)).rows,
        [{ email: "1741711@github.placeholder.invalid", name: "Kevin Wong" }]);
      const { rows: accounts } = await db.pool.query(`select "providerId", "accountId", "accessToken" from auth_account`);
      assert.equal(accounts.length, 1);
      assert.equal(accounts[0].providerId, "github");
      assert.equal(accounts[0].accountId, "1741711");
      assert.notEqual(accounts[0].accessToken, "gho_test", "OAuth tokens are stored encrypted");
      const owner = await getOwnerSession({ headers: { cookie: sessionCookie.split(";")[0] } });
      assert.equal(owner.name, "Kevin Wong");
      assert.ok(Math.abs(owner.expiresAt.getTime() - (Date.now() + 86_400_000)) < 60_000);
      await eventually(async () => assert.equal(
        (await db.pool.query("select count(*)::int as n from admin_audit_log where event = 'sign_in' and actor = 'github:1741711'")).rows[0].n, 1));
    });

    test("a second owner sign-in reuses the user and adds a session", async () => {
      const res = await signIn(OWNER_PROFILE, "203.0.113.3");
      assert.equal(res.headers.get("location"), "/admin");
      assert.equal(await count("auth_user"), 1);
      assert.equal(await count("auth_account"), 1);
      assert.equal(await count("auth_session"), 2);
    });

    test("Better Auth's own router does not serve get-session (disabledPaths)", async () => {
      const res = await getAuth().handler(new Request(`${ORIGIN}/api/auth/get-session`, { headers: { "x-forwarded-for": "203.0.113.4" } }));
      assert.equal(res.status, 404);
    });
  });
  ```

  Each sign-in uses its own `x-forwarded-for`, because Better Auth limits `/sign-in*` to 3 per 10 s per IP.

- [ ] **Step 4: Run them to verify they fail.**

  ```sh
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/admin-guard.test.mjs tests/next-config.test.mjs tests/integration/admin-sign-in.test.mjs
  ```

  Expected: `admin-guard` and `admin-sign-in` fail with `ERR_MODULE_NOT_FOUND` for `lib/admin/guard.js`.
  `next-config` fails two tests: `the admin header rules come after the generic rule` (only one rule exists) and
  `admin and auth paths deny framing and indexing; public paths keep 'self'` (the admin paths still get
  `frame-ancestors 'self'`). The middle one, `admin header keys use the generic rule's casing and no rule sets
  Cache-Control`, already passes: with no admin rules there is nothing to compare, and the generic rule sets no
  `Cache-Control`.

- [ ] **Step 5: Implement `lib/admin/guard.js`.** Imports: `fromNodeHeaders` from `"better-auth/node"`,
  `getAuth` from `"../auth.js"`, `getDbPool` from `"../db.js"`, and `OWNER_GITHUB_ID`, `SITE_HOST`, `SITE_ORIGIN`
  from `"./owner.js"`.
  - `getOwnerSession`: `const s = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })`; when
    `!s?.user?.id` return `null` without a query. Otherwise run exactly
    `select 1 from auth_account where "userId" = $1 and "providerId" = 'github' and "accountId" = $2 limit 1` with
    `[s.user.id, OWNER_GITHUB_ID]`, return `null` when `rowCount !== 1`, else
    `{ userId: s.user.id, name: s.user.name, image: s.user.image ?? null, expiresAt: s.session.expiresAt }`. Never
    return or log `s.session.token`. Errors (database down, Better Auth's `SchemaMismatchError`) propagate: the
    route then fails with a 500, which is closed.
  - `requireAdmin`: `setNoStore(res)` first; `!isAdminEnabled(req, deps.env)` → `res.status(404).json({ error:
    "not_found" })`, return `null`; `mutation && !isSameOrigin(req)` → 403 `{ error: "bad_origin" }`, `null`;
    `getOwnerSession(req, { auth: deps.auth, db: deps.db })` is `null` → 401 `{ error: "unauthorized" }`, `null`;
    else return the owner without writing a response. `getAuth()` is reached only after the enabled check, so
    previews (no auth env vars) never construct Better Auth.
  - `isAllowedAuthRequest`:

  ```js
  const AUTH_ALLOWLIST = new Set([
    "POST /api/auth/sign-in/social",
    "GET /api/auth/callback/github",
    "POST /api/auth/sign-out",
  ]);

  // Exact METHOD + path. No URL parsing: "//x/..." must not turn into a host, and a trailing
  // slash, a different case or an encoded character all fall through to 404.
  export function isAllowedAuthRequest(method, url) {
    const path = String(url ?? "").split("?", 1)[0];
    return AUTH_ALLOWLIST.has(`${method} ${path}`);
  }
  ```

- [ ] **Step 6: Create `pages/api/auth/[...all].js`** (exact):

  ```js
  import { toNodeHandler } from "better-auth/node";
  import { getAuth } from "../../../lib/auth";
  import { isAdminEnabled, isAllowedAuthRequest, setNoStore } from "../../../lib/admin/guard";

  // Better Auth reads the raw body itself.
  export const config = { api: { bodyParser: false } };

  // Only start sign-in, GitHub's callback and sign-out reach Better Auth, and only in production on www.
  // Everything else (get-session returns the raw session token) is a 404 before Better Auth runs.
  export default async function handler(req, res) {
    setNoStore(res);
    if (!isAdminEnabled(req) || !isAllowedAuthRequest(req.method, req.url)) {
      return res.status(404).json({ error: "not_found" });
    }
    return toNodeHandler(getAuth())(req, res);
  }
  ```

- [ ] **Step 7: Modify `next.config.js`, `nextConfig.headers()`.** Keep the generic rule first and unchanged, and
  append three rules after it that share one array (above `nextConfig`):

  ```js
  // Admin and auth routes: no framing at all, no indexing. Listed after the generic rule
  // because Next applies matching rules in order and the later value wins for a repeated key
  // (Content-Security-Policy here). Same key casing as the generic rule. No Cache-Control
  // rule: the handlers send no-store themselves (lib/admin/guard.js setNoStore).
  const ADMIN_HEADERS = [
    { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Robots-Tag", value: "noindex, nofollow" },
  ];
  ```

  and in the returned array, after the generic object:
  `{ source: "/admin/:path*", headers: ADMIN_HEADERS }, { source: "/api/admin/:path*", headers: ADMIN_HEADERS },
  { source: "/api/auth/:path*", headers: ADMIN_HEADERS }`. (`/admin/:path*` also matches `/admin`; checked with
  Next 16.3.6's `getPathMatch`.)

- [ ] **Step 8: Run the tests and the build to verify they pass.** The build comes before `tsc`, because it
  writes the gitignored `next-env.d.ts` that `tsc` needs.

  ```sh
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/admin-guard.test.mjs tests/next-config.test.mjs tests/integration/admin-sign-in.test.mjs
  npm test
  npm run lint
  env -u BETTER_AUTH_URL -u BETTER_AUTH_SECRET -u GITHUB_CLIENT_ID -u GITHUB_CLIENT_SECRET npm run build
  npx tsc --noEmit
  ```

  Expected: the focused run shows `ℹ tests 22`, `ℹ pass 22`, `ℹ fail 0`, `ℹ cancelled 0` (15 + 3 + 4). `npm test`
  shows `ℹ fail 0` and `ℹ cancelled 0`; lint and `tsc` exit 0. The build succeeds without any auth env var
  (`getAuth()` is lazy) and its route list includes `ƒ /api/auth/[...all]`. If the GitHub stub is never called
  (`Unexpected fetch` does not appear, but the callback redirects with `error=invalid_code`), Better Auth bound
  `fetch` at import. Then install the stub before the first `getAuth()` call instead of per sign-in, and don't
  change the assertions.

- [ ] **Step 9: Commit.**

  ```sh
  git add lib/admin/guard.js "pages/api/auth/[...all].js" next.config.js tests/helpers/admin-fakes.mjs tests/admin-guard.test.mjs tests/next-config.test.mjs tests/integration/admin-sign-in.test.mjs
  git commit -m "Add the admin guard, the allowlisted auth route and admin response headers"
  ```

---

### Task 13: Spotify reconnect routes

**Model:** Opus

**Files:**
- Create: `lib/admin/spotify-reconnect.js`, `pages/api/admin/spotify/authorize.js`, `pages/api/admin/spotify/callback.js`
- Test: `tests/admin-spotify-reconnect.test.mjs`

**Interfaces:**
- Consumes:
  - `lib/spotify-oauth.js` (Task 7): `SPOTIFY_ADMIN_REDIRECT_URI = "https://www.kevinwong.co/api/admin/spotify/callback"`,
    `spotifyCredentials(env = process.env): { clientId, clientSecret }` (throws when either is missing),
    `buildAuthorizeUrl({ clientId, redirectUri, state }): string`,
    `exchangeCode({ code, redirectUri, clientId, clientSecret, fetchImpl = fetch }): Promise<{ refreshToken, accessToken, scopes: string[], expiresIn }>`,
    `fetchSpotifyAccountId(accessToken, fetchImpl = fetch): Promise<string>`, `missingScopes(granted: string[]): string[]`.
  - `lib/spotify-token.js` (Task 5): `SPOTIFY_SCOPES` (the three scopes), `saveSpotifyAuthorization({ refreshToken, accountId, scopes }, db?)`.
  - `lib/spotify.js` (Task 6): `resetSpotifyTokenCache(): void`.
  - `lib/admin/owner.js` (Task 7): `OWNER_SPOTIFY_ACCOUNT_ID`.
  - `lib/admin/audit-log.js` (Task 11): `logAdminEvent(event, { actor = null, details = {} } = {}, db?)`,
    `OWNER_ACTOR = "github:1741711"` (the `actor` of every event here).
  - `lib/admin/guard.js` (Task 12): `isAdminEnabled(req, env)`, `isSameOrigin(req)`, `setNoStore(res)`,
    `getOwnerSession(req, { auth, db })` (`null` without an owner session; an `undefined` key means the real one).
    Not `requireAdmin`: its JSON 401 would show as a page after these top-level navigations, so both routes do the
    same checks themselves and redirect to `/admin/sign-in` instead.
  - `tests/helpers/admin-fakes.mjs` (Task 12): `PROD_ENV`, `fakeReq({ method, host, origin, cookie, query, url })`,
    `fakeRes()` (records `statusCode`, lower-cased `headers`, `body`, `ended`), `fakeAuth(session = OWNER_SESSION)`
    (pass `null` for no session), `fakeDb(rowCount = 1)` (`0` means the user lacks the owner's GitHub account).
- Produces (`lib/admin/spotify-reconnect.js`; both `pages/api/admin/spotify/*` files only call into it):
  - `export const STATE_COOKIE_NAME = "__Host-kw_spotify_state"`
  - `export const CLEAR_STATE_COOKIE = "__Host-kw_spotify_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"`
  - `export function stateCookie(state: string): string` → `` `__Host-kw_spotify_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600` ``
  - `export function newState(): string` — `randomBytes(32).toString("base64url")` (43 characters)
  - `export function readStateCookie(cookieHeader: string | undefined): string | null`
  - `export function statesMatch(expected, presented): boolean` — `false` unless both are non-empty strings; then `timingSafeEqual` on their SHA-256 digests.
  - `export async function completeSpotifyReconnect({ query, cookieState, deps = {} }): Promise<{ outcome: Outcome, location: string }>` where
    `deps = { env, exchangeCode, fetchSpotifyAccountId, saveSpotifyAuthorization, resetSpotifyTokenCache, logAdminEvent }` (each defaults to the real one; `env` to `process.env`).
  - `export async function handleSpotifyAuthorize(req, res, deps = {})` and `export async function handleSpotifyCallback(req, res, deps = {})` — the route bodies. `deps.env` goes to `isAdminEnabled`, `deps.auth` and `deps.db` to `getOwnerSession`, and the whole `deps` to `completeSpotifyReconnect`. With no owner session, both answer 303 `/admin/sign-in` (after the enabled, method and, for authorize, same-origin checks).
  - Outcome codes, exactly: `connected` (303 `/admin?spotify=connected`) and the errors `denied`, `state_mismatch`,
    `exchange_failed`, `missing_scopes`, `account_lookup_failed`, `wrong_account`, `not_configured`, `save_failed`
    (303 `/admin?spotify_error=<code>`). Task 17 maps every one to a message. Every failure writes one
    `spotify_connect_failed` row, except a `state_mismatch` with no state cookie (no reconnect was in flight), which
    writes none. `denied` records `{ reason: "access_denied" }` or `{ reason: "other" }`, never Spotify's raw text.

- [ ] **Step 1: Write the failing test** `tests/admin-spotify-reconnect.test.mjs`:

  ```js
  import { test } from "node:test";
  import assert from "node:assert/strict";
  import {
    CLEAR_STATE_COOKIE, completeSpotifyReconnect, handleSpotifyAuthorize, handleSpotifyCallback,
    newState, readStateCookie, stateCookie, statesMatch,
  } from "../lib/admin/spotify-reconnect.js";
  import { SPOTIFY_ADMIN_REDIRECT_URI } from "../lib/spotify-oauth.js";
  import { SPOTIFY_SCOPES } from "../lib/spotify-token.js";
  import { OWNER_SPOTIFY_ACCOUNT_ID } from "../lib/admin/owner.js";
  import { OWNER_ACTOR } from "../lib/admin/audit-log.js";
  import { fakeAuth, fakeDb, fakeReq, fakeRes } from "./helpers/admin-fakes.mjs";

  const NO_STORE = "private, no-store, max-age=0, must-revalidate";
  const CLEAR = "__Host-kw_spotify_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";
  const STATE_COOKIE_RE = /^__Host-kw_spotify_state=([A-Za-z0-9_-]{43}); HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=600$/;
  const SPOTIFY_ENV = { VERCEL_ENV: "production", SPOTIFY_CLIENT_ID: "cid", SPOTIFY_CLIENT_SECRET: "csecret" };
  const STATE = "A".repeat(43);
  const GOOD = { code: "the-code", state: STATE };

  function fakeReconnect(overrides = {}) {
    const calls = { exchange: [], account: [], save: [], reset: 0, log: [] };
    const deps = {
      env: SPOTIFY_ENV,
      exchangeCode: async (args) => { calls.exchange.push(args); return { refreshToken: "new-refresh", accessToken: "new-access", scopes: [...SPOTIFY_SCOPES], expiresIn: 3600 }; },
      fetchSpotifyAccountId: async (accessToken) => { calls.account.push(accessToken); return OWNER_SPOTIFY_ACCOUNT_ID; },
      saveSpotifyAuthorization: async (row) => { calls.save.push(row); return { authorizedAt: new Date(), expiresAt: new Date() }; },
      resetSpotifyTokenCache: () => { calls.reset += 1; },
      logAdminEvent: async (event, options) => { calls.log.push({ event, ...options }); },
      ...overrides,
    };
    return { deps, calls };
  }

  function assertFailed(result, calls, code, { logged = true } = {}) {
    assert.deepEqual(result, { outcome: code, location: `/admin?spotify_error=${code}` });
    assert.equal(calls.save.length, 0, "nothing saved");
    assert.equal(calls.reset, 0, "cache not reset");
    if (!logged) return assert.equal(calls.log.length, 0, "no audit row");
    assert.equal(calls.log.length, 1);
    assert.equal(calls.log[0].event, "spotify_connect_failed");
    assert.equal(calls.log[0].actor, OWNER_ACTOR);
    assert.equal(calls.log[0].details.code, code);
  }

  test("OWNER_SPOTIFY_ACCOUNT_ID is filled in", () => {
    assert.match(OWNER_SPOTIFY_ACCOUNT_ID, /^[^<>\s]+$/);
  });

  test("newState returns 43 base64url characters and differs each call", () => {
    const a = newState();
    assert.match(a, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(newState(), a);
  });

  test("stateCookie and CLEAR_STATE_COOKIE are exact", () => {
    assert.equal(stateCookie(STATE), `__Host-kw_spotify_state=${STATE}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
    assert.equal(CLEAR_STATE_COOKIE, CLEAR);
  });

  test("readStateCookie reads only __Host-kw_spotify_state", () => {
    assert.equal(readStateCookie(`theme=dark; __Host-kw_spotify_state=${STATE}; b=2`), STATE);
    assert.equal(readStateCookie(`__Host-kw_spotify_state=${STATE}`), STATE);
    assert.equal(readStateCookie("__Host-kw_spotify_state="), null);
    assert.equal(readStateCookie(`x__Host-kw_spotify_state=${STATE}`), null);
    assert.equal(readStateCookie(undefined), null);
  });

  test("statesMatch is true only for two equal non-empty strings", () => {
    assert.equal(statesMatch(STATE, STATE), true);
    for (const [a, b] of [[STATE, `${STATE}A`], [STATE, `${"A".repeat(42)}B`], [null, STATE], [STATE, undefined], ["", ""], [STATE, [STATE]]]) {
      assert.equal(statesMatch(a, b), false, `${a} vs ${b}`);
    }
  });

  test("denied: Spotify's error param with a matching state fails without an exchange", async () => {
    const { deps, calls } = fakeReconnect();
    assertFailed(await completeSpotifyReconnect({ query: { error: "access_denied", state: STATE }, cookieState: STATE, deps }), calls, "denied");
    assert.deepEqual(calls.log[0].details, { code: "denied", reason: "access_denied" });
    assert.equal(calls.exchange.length, 0);
  });

  test("denied records only access_denied or other, never Spotify's text", async () => {
    const { deps, calls } = fakeReconnect();
    assertFailed(await completeSpotifyReconnect({ query: { error: "<b>planted text</b>", state: STATE }, cookieState: STATE, deps }), calls, "denied");
    assert.deepEqual(calls.log[0].details, { code: "denied", reason: "other" });
    assert.ok(!JSON.stringify(calls.log).includes("planted"));
  });

  test("the state is checked first: an error param without a state cookie is state_mismatch and writes no audit row", async () => {
    const { deps, calls } = fakeReconnect();
    assertFailed(await completeSpotifyReconnect({ query: { error: "attacker text" }, cookieState: null, deps }), calls, "state_mismatch", { logged: false });
    assert.equal(calls.exchange.length, 0);
  });

  for (const [name, query, cookieState, logged] of [
    ["missing cookie", GOOD, null, false],
    ["missing state param", { code: "the-code" }, STATE, true],
    ["different length", { code: "the-code", state: `${STATE}A` }, STATE, true],
    ["different value", { code: "the-code", state: `${"A".repeat(42)}B` }, STATE, true],
    ["repeated state param", { code: "the-code", state: [STATE, STATE] }, STATE, true],
    ["empty cookie and empty param", { code: "the-code", state: "" }, "", false],
  ]) {
    test(`state_mismatch: ${name}`, async () => {
      const { deps, calls } = fakeReconnect();
      assertFailed(await completeSpotifyReconnect({ query, cookieState, deps }), calls, "state_mismatch", { logged });
      assert.equal(calls.exchange.length, 0);
    });
  }

  test("not_configured: no Spotify client credentials", async () => {
    const { deps, calls } = fakeReconnect({ env: { VERCEL_ENV: "production" } });
    assertFailed(await completeSpotifyReconnect({ query: GOOD, cookieState: STATE, deps }), calls, "not_configured");
    assert.equal(calls.exchange.length, 0);
  });

  test("exchange_failed: no code", async () => {
    const { deps, calls } = fakeReconnect();
    assertFailed(await completeSpotifyReconnect({ query: { state: STATE }, cookieState: STATE, deps }), calls, "exchange_failed");
    assert.equal(calls.exchange.length, 0);
  });

  test("exchange_failed: the code exchange throws", async () => {
    const { deps, calls } = fakeReconnect({ exchangeCode: async () => { throw new Error("Spotify token exchange failed with 400"); } });
    assertFailed(await completeSpotifyReconnect({ query: GOOD, cookieState: STATE, deps }), calls, "exchange_failed");
    assert.equal(calls.account.length, 0);
  });

  test("missing_scopes: a scope was not granted", async () => {
    const granted = SPOTIFY_SCOPES.filter((s) => s !== "user-read-recently-played");
    const { deps, calls } = fakeReconnect({ exchangeCode: async () => ({ refreshToken: "new-refresh", accessToken: "new-access", scopes: granted, expiresIn: 3600 }) });
    assertFailed(await completeSpotifyReconnect({ query: GOOD, cookieState: STATE, deps }), calls, "missing_scopes");
    assert.deepEqual(calls.log[0].details.missing, ["user-read-recently-played"]);
    assert.equal(calls.account.length, 0);
  });

  test("account_lookup_failed: /v1/me fails", async () => {
    const { deps, calls } = fakeReconnect({ fetchSpotifyAccountId: async () => { throw new Error("Spotify /v1/me failed with 503"); } });
    assertFailed(await completeSpotifyReconnect({ query: GOOD, cookieState: STATE, deps }), calls, "account_lookup_failed");
  });

  test("wrong_account: another Spotify account approved", async () => {
    const { deps, calls } = fakeReconnect({ fetchSpotifyAccountId: async () => "someone-else" });
    assertFailed(await completeSpotifyReconnect({ query: GOOD, cookieState: STATE, deps }), calls, "wrong_account");
    assert.equal(calls.log[0].details.accountId, "someone-else");
  });

  test("save_failed: the database write throws and the cache is not reset", async () => {
    const { deps, calls } = fakeReconnect({ saveSpotifyAuthorization: async () => { throw new Error("connection terminated"); } });
    assertFailed(await completeSpotifyReconnect({ query: GOOD, cookieState: STATE, deps }), calls, "save_failed");
  });

  test("connected: saves the authorization, resets the cache and logs spotify_connected", async () => {
    const { deps, calls } = fakeReconnect();
    const result = await completeSpotifyReconnect({ query: GOOD, cookieState: STATE, deps });
    assert.deepEqual(result, { outcome: "connected", location: "/admin?spotify=connected" });
    assert.deepEqual(calls.exchange, [{ code: "the-code", redirectUri: SPOTIFY_ADMIN_REDIRECT_URI, clientId: "cid", clientSecret: "csecret" }]);
    assert.deepEqual(calls.account, ["new-access"]);
    assert.deepEqual(calls.save, [{ refreshToken: "new-refresh", accountId: OWNER_SPOTIFY_ACCOUNT_ID, scopes: [...SPOTIFY_SCOPES] }]);
    assert.equal(calls.reset, 1);
    assert.deepEqual(calls.log, [{ event: "spotify_connected", actor: OWNER_ACTOR, details: { accountId: OWNER_SPOTIFY_ACCOUNT_ID, scopes: [...SPOTIFY_SCOPES] } }]);
    assert.ok(!JSON.stringify(calls.log).includes("new-refresh"));
    assert.ok(!JSON.stringify(calls.log).includes("new-access"));
    assert.ok(!JSON.stringify(calls.log).includes("the-code"));
  });

  test("connected even when the audit log write fails", async () => {
    const { deps, calls } = fakeReconnect({ logAdminEvent: async () => { throw new Error("database down"); } });
    assert.equal((await completeSpotifyReconnect({ query: GOOD, cookieState: STATE, deps })).outcome, "connected");
    assert.equal(calls.save.length, 1);
  });

  const adminDeps = (overrides = {}) => ({ env: SPOTIFY_ENV, auth: fakeAuth(), db: fakeDb(1), ...overrides });

  test("authorize answers GET with 405 and sets no state cookie", async () => {
    const res = fakeRes();
    await handleSpotifyAuthorize(fakeReq({ method: "GET" }), res, adminDeps());
    assert.equal(res.statusCode, 405);
    assert.equal(res.getHeader("Allow"), "POST");
    assert.deepEqual(res.body, { error: "method_not_allowed" });
    assert.equal(res.getHeader("Set-Cookie"), undefined);
    assert.equal(res.getHeader("Cache-Control"), NO_STORE);
  });

  test("authorize 404s on a preview deployment", async () => {
    const res = fakeRes();
    await handleSpotifyAuthorize(fakeReq({ method: "POST", origin: "https://www.kevinwong.co" }), res, adminDeps({ env: { ...SPOTIFY_ENV, VERCEL_ENV: "preview" } }));
    assert.equal(res.statusCode, 404);
    assert.equal(res.getHeader("Set-Cookie"), undefined);
  });

  test("authorize refuses a POST from https://kevinwong.co before reading the session", async () => {
    const res = fakeRes();
    const auth = fakeAuth(null);
    await handleSpotifyAuthorize(fakeReq({ method: "POST", origin: "https://kevinwong.co" }), res, adminDeps({ auth }));
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: "bad_origin" });
    assert.equal(res.getHeader("Set-Cookie"), undefined);
    assert.equal(auth.calls.length, 0);
  });

  test("authorize without a session 303s to /admin/sign-in and sets no state cookie", async () => {
    const res = fakeRes();
    await handleSpotifyAuthorize(fakeReq({ method: "POST", origin: "https://www.kevinwong.co" }), res, adminDeps({ auth: fakeAuth(null) }));
    assert.equal(res.statusCode, 303);
    assert.equal(res.getHeader("Location"), "/admin/sign-in");
    assert.equal(res.getHeader("Set-Cookie"), undefined);
    assert.equal(res.getHeader("Cache-Control"), NO_STORE);
    assert.equal(res.ended, true);
  });

  test("authorize sets the state cookie and 303s to Spotify's approve page", async () => {
    const res = fakeRes();
    await handleSpotifyAuthorize(fakeReq({ method: "POST", origin: "https://www.kevinwong.co" }), res, adminDeps());
    assert.equal(res.statusCode, 303);
    const match = STATE_COOKIE_RE.exec(res.getHeader("Set-Cookie"));
    assert.ok(match, res.getHeader("Set-Cookie"));
    const location = res.getHeader("Location");
    assert.ok(location.startsWith("https://accounts.spotify.com/authorize?"), location);
    const params = new URL(location).searchParams;
    assert.equal(params.get("state"), match[1]);
    assert.equal(params.get("client_id"), "cid");
    assert.equal(params.get("redirect_uri"), SPOTIFY_ADMIN_REDIRECT_URI);
    assert.equal(params.get("response_type"), "code");
    assert.equal(params.get("show_dialog"), "true");
    assert.equal(params.get("scope"), SPOTIFY_SCOPES.join(" "));
    assert.equal(res.getHeader("Cache-Control"), NO_STORE);
    assert.equal(res.ended, true);
  });

  test("authorize without Spotify credentials 303s to not_configured and sets no state", async () => {
    const res = fakeRes();
    await handleSpotifyAuthorize(fakeReq({ method: "POST", origin: "https://www.kevinwong.co" }), res, adminDeps({ env: { VERCEL_ENV: "production" }, logAdminEvent: async () => {} }));
    assert.equal(res.statusCode, 303);
    assert.equal(res.getHeader("Location"), "/admin?spotify_error=not_configured");
    assert.equal(res.getHeader("Set-Cookie"), undefined);
  });

  test("callback clears the state cookie even when admin is disabled", async () => {
    const res = fakeRes();
    await handleSpotifyCallback(fakeReq({ query: GOOD }), res, adminDeps({ env: { ...SPOTIFY_ENV, VERCEL_ENV: "preview" } }));
    assert.equal(res.statusCode, 404);
    assert.equal(res.getHeader("Set-Cookie"), CLEAR);
  });

  test("callback without a session 303s to /admin/sign-in, clears the state cookie and exchanges nothing", async () => {
    const { deps, calls } = fakeReconnect();
    const res = fakeRes();
    await handleSpotifyCallback(fakeReq({ cookie: `__Host-kw_spotify_state=${STATE}`, query: GOOD }), res, { ...deps, auth: fakeAuth(null), db: fakeDb(1) });
    assert.equal(res.statusCode, 303);
    assert.equal(res.getHeader("Location"), "/admin/sign-in");
    assert.equal(res.getHeader("Set-Cookie"), CLEAR);
    assert.equal(res.getHeader("Cache-Control"), NO_STORE);
    assert.equal(calls.exchange.length, 0);
    assert.equal(calls.log.length, 0);
  });

  test("callback answers POST with 405", async () => {
    const res = fakeRes();
    await handleSpotifyCallback(fakeReq({ method: "POST", origin: "https://www.kevinwong.co" }), res, adminDeps());
    assert.equal(res.statusCode, 405);
    assert.equal(res.getHeader("Allow"), "GET");
    assert.equal(res.getHeader("Set-Cookie"), CLEAR);
  });

  test("callback connects with a matching state cookie and 303s to /admin?spotify=connected", async () => {
    const { deps, calls } = fakeReconnect();
    const res = fakeRes();
    await handleSpotifyCallback(
      fakeReq({ cookie: `theme=dark; __Host-kw_spotify_state=${STATE}`, query: GOOD }),
      res, { ...deps, auth: fakeAuth(), db: fakeDb(1) },
    );
    assert.equal(res.statusCode, 303);
    assert.equal(res.getHeader("Location"), "/admin?spotify=connected");
    assert.equal(res.getHeader("Set-Cookie"), CLEAR);
    assert.equal(res.getHeader("Cache-Control"), NO_STORE);
    assert.equal(calls.save.length, 1);
    assert.equal(calls.reset, 1);
  });
  ```

- [ ] **Step 2: Run it to verify it fails.**

  ```sh
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/admin-spotify-reconnect.test.mjs
  ```

  Expected: fails with `ERR_MODULE_NOT_FOUND` naming `lib/admin/spotify-reconnect.js`.

- [ ] **Step 3: Implement `lib/admin/spotify-reconnect.js`.** Imports, all with `.js`: `createHash`,
  `randomBytes`, `timingSafeEqual` from `"node:crypto"`; the Task 7 names from `"../spotify-oauth.js"`;
  `saveSpotifyAuthorization` from `"../spotify-token.js"`; `resetSpotifyTokenCache` from `"../spotify.js"`;
  `OWNER_SPOTIFY_ACCOUNT_ID` from `"./owner.js"`; `OWNER_ACTOR`, `logAdminEvent` from `"./audit-log.js"`;
  `getOwnerSession`, `isAdminEnabled`, `isSameOrigin`, `setNoStore` from `"./guard.js"`.
  - `readStateCookie`: split the header on `;`, trim each part, and return the value of the part whose name before
    the first `=` is exactly `__Host-kw_spotify_state`. Return `null` when it is absent or empty.
  - `completeSpotifyReconnect`. Read `query` values only when they are non-empty strings (an array means missing).
    The checks run in this order, and the first failure returns `fail(code, extra)`. The state comes first, so a
    cross-site link to the callback can't get anything past it:
    1. `!statesMatch(cookieState, query.state)` → `state_mismatch`. When `cookieState` is not a non-empty string, no
       reconnect was in flight, so this one returns the same result without writing an audit row.
    2. `query.error` is present → `denied` with `{ reason: query.error === "access_denied" ? "access_denied" : "other" }`.
       Never echo the raw parameter. Spotify sends `state` back with `error=access_denied`, so a real denial gets here.
    3. `spotifyCredentials(env)` throws → `not_configured`.
    4. `query.code` is missing → `exchange_failed` with `{ reason: "missing code" }`, without calling `exchangeCode`.
    5. `exchangeCode({ code, redirectUri: SPOTIFY_ADMIN_REDIRECT_URI, clientId, clientSecret })` throws →
       `exchange_failed` with `{ reason: error.message }`. Pass exactly those four keys.
    6. `missingScopes(tokens.scopes)` is non-empty → `missing_scopes` with `{ missing }`.
    7. `fetchSpotifyAccountId(tokens.accessToken)` throws → `account_lookup_failed` with `{ reason: error.message }`.
    8. `accountId !== OWNER_SPOTIFY_ACCOUNT_ID` → `wrong_account` with `{ accountId }`.
    9. `saveSpotifyAuthorization({ refreshToken: tokens.refreshToken, accountId, scopes: tokens.scopes })` throws →
       `save_failed` with `{ reason: error.message }`.
    10. `resetSpotifyTokenCache()`, log `spotify_connected` with `{ actor: OWNER_ACTOR, details: { accountId,
        scopes: tokens.scopes } }`, and return `{ outcome: "connected", location: "/admin?spotify=connected" }`.

    `fail(code, extra)` logs `spotify_connect_failed` with `{ actor: OWNER_ACTOR, details: { code, ...extra } }`
    (skipped only for the no-cookie `state_mismatch` above),
    `console.warn`s `[admin/spotify] reconnect failed: <code>`, and returns
    `{ outcome: code, location: \`/admin?spotify_error=${code}\` }`. Every audit write is `await`ed inside a
    `try/catch` that only `console.error`s, so a failed log never changes the outcome. Never put the code, an access
    token or a refresh token in `details`.
  - `handleSpotifyAuthorize(req, res, deps = {})`: `setNoStore(res)` first, then:
    1. `!isAdminEnabled(req, deps.env)` → 404 `{ error: "not_found" }`.
    2. `req.method !== "POST"` → `res.setHeader("Allow", "POST")`, 405 `{ error: "method_not_allowed" }`.
    3. `!isSameOrigin(req)` → 403 `{ error: "bad_origin" }`, before the session is read.
    4. `!(await getOwnerSession(req, { auth: deps.auth, db: deps.db }))` → `res.setHeader("Location", "/admin/sign-in")`,
       `res.status(303).end()`. Reconnect is a top-level form POST, so a JSON 401 would show as a page.
    5. `spotifyCredentials(deps.env ?? process.env)` throws → log `spotify_connect_failed` with `{ actor:
       OWNER_ACTOR, details: { code: "not_configured" } }` (through `deps.logAdminEvent ?? logAdminEvent`, caught),
       then 303 to `/admin?spotify_error=not_configured`.
    6. `const state = newState()`; `res.setHeader("Set-Cookie", stateCookie(state))`;
       `res.setHeader("Location", buildAuthorizeUrl({ clientId, redirectUri: SPOTIFY_ADMIN_REDIRECT_URI, state }))`;
       `res.status(303).end()`.
  - `handleSpotifyCallback(req, res, deps = {})`: `res.setHeader("Set-Cookie", CLEAR_STATE_COOKIE)` and
    `setNoStore(res)` before anything else. Then the enabled check (404), `req.method !== "GET"` → `Allow: GET`, 405
    `{ error: "method_not_allowed" }`. Then, with no owner session (`getOwnerSession(req, { auth: deps.auth, db:
    deps.db })` is `null`), 303 to `/admin/sign-in`: the callback is a top-level GET, and the session can expire
    during the 10-minute Spotify round trip. No same-origin check, because Spotify's redirect is a cross-site
    top-level GET and SameSite=Lax still sends the session cookie. Then
    `const { location } = await completeSpotifyReconnect({ query: req.query, cookieState: readStateCookie(req.headers.cookie), deps })`,
    `res.setHeader("Location", location)`, `res.status(303).end()`.

  Route files (exact; they import without extensions, like every `pages/api` file):

  ```js
  // pages/api/admin/spotify/authorize.js
  import { handleSpotifyAuthorize } from "../../../../lib/admin/spotify-reconnect";

  // Body parser off: nothing may answer before the 404 gate (D1), and this route never reads a body.
  export const config = { api: { bodyParser: false } };

  // POST from the panel's Reconnect form: owner + same-origin check, state cookie, 303 to Spotify.
  export default function handler(req, res) {
    return handleSpotifyAuthorize(req, res);
  }
  ```

  ```js
  // pages/api/admin/spotify/callback.js
  import { handleSpotifyCallback } from "../../../../lib/admin/spotify-reconnect";

  // Body parser off: nothing may answer before the 404 gate (D1), and this route never reads a body.
  export const config = { api: { bodyParser: false } };

  // GET from Spotify's redirect: clears the state cookie, checks it, stores the new token, 303 to /admin.
  export default function handler(req, res) {
    return handleSpotifyCallback(req, res);
  }
  ```

- [ ] **Step 4: Run the tests to verify they pass.** The build comes before `tsc` (it writes `next-env.d.ts`).

  ```sh
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/admin-spotify-reconnect.test.mjs
  npm test
  npm run lint
  npm run build
  npx tsc --noEmit
  ```

  Expected: the focused run shows `ℹ tests 33`, `ℹ pass 33`, `ℹ fail 0`, `ℹ cancelled 0` (`[admin/spotify]
  reconnect failed: …` warnings on stderr are expected). `npm test` shows `ℹ fail 0` and `ℹ cancelled 0`; lint and
  `tsc` exit 0; the build's route list includes `ƒ /api/admin/spotify/authorize` and
  `ƒ /api/admin/spotify/callback`.

- [ ] **Step 5: Commit.**

  ```sh
  git add lib/admin/spotify-reconnect.js pages/api/admin/spotify/authorize.js pages/api/admin/spotify/callback.js tests/admin-spotify-reconnect.test.mjs
  git commit -m "Add the Spotify reconnect routes"
  ```

Kevin does the setup for this (the panel's Spotify redirect URI) in Task 18, Step 7.

---

# Section E: panel limits, status, rollout and cleanup (Tasks 14, 15, 18, 19)

---

### Task 14: Panel run limits and the Check / Import endpoint

**Model:** Opus
**Files:**
- Create: `lib/admin/sync-limits.js`
- Create: `lib/admin/instagram-sync-route.js` (the handler logic, with injected deps; `node --test` cannot import `pages/api/*`)
- Create: `pages/api/admin/instagram/sync.js` (wires the real deps and sets `config`)
- Test: `tests/integration/sync-limits.test.mjs`, `tests/admin-instagram-sync-route.test.mjs`

The daily import limit counts `abandoned` as well as `running`, `ok` and `partial`. A panel import killed by
`maxDuration` never runs `finishRun`, so its row keeps `running`, with only the uploads it recorded as they landed. The next `startRun` marks it `abandoned`; if `abandoned` didn't count, the same crashed run would stop
counting at that moment and Kevin could import again straight away.

The `sync_runs` row the limits read is only written once `syncInstagram` is under way, so two requests at the same
moment (a double-click, two tabs) would both pass a read of it. The route therefore also claims each limit's slot
atomically in `job_locks` before it starts the run. Only one of two concurrent claims can succeed.

**Interfaces:**
- Consumes:
  - `requireAdmin(req, res, { mutation = false, deps = {} } = {}): Promise<null | { userId: string, name: string, image: string | null, expiresAt: Date }>` from `lib/admin/guard.js` (Task 12). When it returns null it has already sent 404, 403 or 401.
  - From `lib/admin/audit-log.js` (Task 11):
    - `logAdminEvent(event, { actor = null, details = {} } = {}, db = getDbPool()): Promise<void>`. It throws `TypeError` for an event not in `ADMIN_EVENTS`. The events used here are `"instagram_check"`, `"instagram_import"` and `"panel_run_refused"`.
    - `OWNER_ACTOR = "github:1741711"`, the `actor` of every event the owner causes.
  - `syncInstagram({ maxPosts, maxUploads, dryRun, timeBudgetMs, trigger = "cli" })` from `lib/instagram-sync.js` (Task 9). Its summary is `{ dryRun, startDate, fetched, alreadyPresent, skipped[], inserted[{ shortcode, postedAt, mediaCount, caption, dryRun? }], uploads, deferred, warnings[], errors[], blob?, resize?, leaseHeld?, ceilingReached?, notRecorded? }`. `notRecorded: true` means a real run stood down because `startRun` failed; it uploaded nothing.
  - `statusFromSummary(summary): "ok" | "partial" | "skipped"` and `uploadsInLastDays(days, db?): Promise<number>` from `lib/sync-runs.js` (Task 9).
  - `InstagramReauthRequiredError` from `lib/instagram.js` (exists in the audit; `new InstagramReauthRequiredError(message?)`).
  - `getDbPool()` from `lib/db.js`.
  - `redact(value)` from `lib/redact.js` (Task 4). Pass it the message string, never an `Error`, which it returns unchanged.
  - `sync_runs` (Task 3, `sql/006_sync_runs.sql`): `id` bigint identity, `job`, `trigger` (CHECK `cron | panel | cli`), `dry_run`, `status` (text, CHECK `running | ok | partial | skipped | failed | reauth_required | abandoned`, default `running`), `started_at` default `now()`, `finished_at` nullable, the counts `fetched`, `imported`, `uploads`, `deferred`, `skipped`, `error_count` (`integer not null default 0`), `error`, `summary`.
  - `job_locks` (the audit's `sql/004_job_locks.sql`, already in production, so no migration): `name text primary key`, `locked_until timestamptz not null default 'epoch'`. The run lease in `lib/instagram-sync.js` (`acquireLease`, `releaseLease`, row `instagram-sync`) is the pattern the slot claims copy.
  - `testDb()` from `tests/helpers/db.mjs` (Task 2): `{ skip: false | string, pool: pg.Pool | null, resetSchema(): Promise<number>, close(): Promise<void> }`. `resetSchema()` rebuilds `public` from the production-schema fixture and applies every `sql/005+` file.
  - `fakeRes()` from `tests/helpers/admin-fakes.mjs` (Task 12): records `statusCode`, `headers` (lower-cased keys) and `body`.
- Produces:
  - `lib/admin/sync-limits.js`:
    - `export const CHECK_MIN_GAP_MINUTES = 10`, `export const IMPORT_WINDOW_HOURS = 24`, `export const PANEL_UPLOAD_CEILING_30D = 1000`.
    - `export async function checkPanelRunAllowed({ dryRun }, db = getDbPool()): Promise<{ allowed: true } | { allowed: false, reason: "too_soon" | "daily_limit" | "upload_ceiling", retryAfterSeconds: number }>`. It reads `sync_runs`; the route uses it for the 1,000 ceiling, and Task 15 for the status hints.
    - `export async function claimPanelSlot({ dryRun }, db = getDbPool()): Promise<{ claimed: true } | { claimed: false, retryAfterSeconds: number }>`. It claims the `job_locks` row `instagram-panel-check` for `10 minutes` (a check) or `instagram-panel-import` for `24 hours` (an import). Task 15 reads both rows for `panel.nextCheckAt` and `panel.nextImportAt`.
    - `export async function releasePanelImportSlot(db = getDbPool()): Promise<void>`, which sets `instagram-panel-import`'s `locked_until` to `'epoch'`.
  - `lib/admin/instagram-sync-route.js`: `export function createInstagramSyncHandler({ requireAdmin, readJsonBody, checkPanelRunAllowed, claimPanelSlot, releasePanelImportSlot, syncInstagram, logAdminEvent }): (req, res) => Promise<void>`, and `export async function readJsonBody(req, limitBytes = 1024): Promise<unknown>`, which returns the parsed body of an `application/json` request of 1 to `limitBytes` bytes and `undefined` for anything else.
  - `POST /api/admin/instagram/sync` (Task 17's `api.ts` relies on this):
    - The request body is `{ dryRun: boolean }`, sent as `application/json` (Task 16's `postJson` does) and at most 1,024 bytes. Other keys are ignored.
    - 200: `{ status, fetched, alreadyPresent, posts: [{ shortcode, postedAt, mediaCount }], uploads, deferred, errorCount, blob?, resize? }`.
    - 400: `{ error: "bad_request" }`.
    - 405: `{ error: "method_not_allowed" }`, with `Allow: POST`.
    - 429: `{ error: reason, retryAfterSeconds }`, with a `Retry-After` header. `reason` is `checkPanelRunAllowed`'s, or, when the slot is already claimed, `too_soon` for a check and `daily_limit` for an import.
    - 503: `{ error: "instagram_reauth_required" }`.
    - 500: `{ error: "sync_failed" }`.
    - 404, 403 and 401 come from `requireAdmin`.

- [ ] **Step 1: Write the failing integration test for the limits**

`tests/integration/sync-limits.test.mjs`. Rows are seeded relative to the database clock (`now() - $n::interval`), because the code under test uses `now()` too.

```js
import { describe, test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "../helpers/db.mjs";
import {
  CHECK_MIN_GAP_MINUTES, IMPORT_WINDOW_HOURS, PANEL_UPLOAD_CEILING_30D, checkPanelRunAllowed,
  claimPanelSlot, releasePanelImportSlot,
} from "../../lib/admin/sync-limits.js";

const db = testDb();

async function seedRun({ trigger = "panel", dryRun, status = "ok", ago, uploads = 0 }) {
  await db.pool.query(
    `insert into sync_runs (job, trigger, dry_run, status, started_at, uploads)
     values ('instagram', $1, $2, $3, now() - $4::interval, $5)`,
    [trigger, dryRun, status, ago, uploads]
  );
}
const between = (v, lo, hi) => assert.ok(v >= lo && v <= hi, `${v} not in [${lo}, ${hi}]`);

describe("panel run limits", { skip: db.skip }, () => {
  before(() => db.resetSchema());
  beforeEach(() => db.pool.query("truncate sync_runs, job_locks restart identity"));
  after(() => db.close());

  test("constants are the D4 values", () => {
    assert.equal(CHECK_MIN_GAP_MINUTES, 10);
    assert.equal(IMPORT_WINDOW_HOURS, 24);
    assert.equal(PANEL_UPLOAD_CEILING_30D, 1000);
  });

  describe("Check (dryRun: true)", () => {
    test("allowed with no runs at all", async () => {
      assert.deepEqual(await checkPanelRunAllowed({ dryRun: true }, db.pool), { allowed: true });
    });
    test("refused 9 minutes after a panel check, retry in about 60 s", async () => {
      await seedRun({ dryRun: true, ago: "9 minutes" });
      const r = await checkPanelRunAllowed({ dryRun: true }, db.pool);
      assert.equal(r.allowed, false);
      assert.equal(r.reason, "too_soon");
      between(r.retryAfterSeconds, 55, 60);
    });
    test("allowed 11 minutes after a panel check", async () => {
      await seedRun({ dryRun: true, ago: "11 minutes" });
      assert.deepEqual(await checkPanelRunAllowed({ dryRun: true }, db.pool), { allowed: true });
    });
    test("a failed panel check still counts", async () => {
      await seedRun({ dryRun: true, status: "failed", ago: "2 minutes" });
      assert.equal((await checkPanelRunAllowed({ dryRun: true }, db.pool)).reason, "too_soon");
    });
    test("cron and CLI dry runs, and panel imports, don't limit checks", async () => {
      await seedRun({ trigger: "cron", dryRun: true, ago: "1 minute" });
      await seedRun({ trigger: "cli", dryRun: true, ago: "1 minute" });
      await seedRun({ trigger: "panel", dryRun: false, ago: "1 minute" });
      assert.deepEqual(await checkPanelRunAllowed({ dryRun: true }, db.pool), { allowed: true });
    });
  });

  describe("Import (dryRun: false)", () => {
    test("refused when a panel ok import started 23 h ago, retry in about 1 h", async () => {
      await seedRun({ dryRun: false, ago: "23 hours", uploads: 4 });
      const r = await checkPanelRunAllowed({ dryRun: false }, db.pool);
      assert.equal(r.allowed, false);
      assert.equal(r.reason, "daily_limit");
      between(r.retryAfterSeconds, 3595, 3600);
    });
    test("allowed when the last panel import started 25 h ago", async () => {
      await seedRun({ dryRun: false, ago: "25 hours", uploads: 4 });
      assert.deepEqual(await checkPanelRunAllowed({ dryRun: false }, db.pool), { allowed: true });
    });
    test("the retry is measured from the most recent counting import", async () => {
      await seedRun({ dryRun: false, ago: "23 hours" });
      await seedRun({ dryRun: false, status: "partial", ago: "2 hours" });
      between((await checkPanelRunAllowed({ dryRun: false }, db.pool)).retryAfterSeconds, 79195, 79200);
    });
    test("a running panel import row counts toward the daily limit", async () => {
      // The first import's row says running, with 0 uploads so far.
      await seedRun({ dryRun: false, status: "running", ago: "5 seconds" });
      const r = await checkPanelRunAllowed({ dryRun: false }, db.pool);
      assert.equal(r.allowed, false);
      assert.equal(r.reason, "daily_limit");
      between(r.retryAfterSeconds, 86_390, 86_400);
    });
    for (const status of ["partial", "abandoned"]) {
      test(`a ${status} panel import with 0 uploads counts`, async () => {
        await seedRun({ dryRun: false, status, ago: "1 hour" });
        assert.equal((await checkPanelRunAllowed({ dryRun: false }, db.pool)).reason, "daily_limit");
      });
    }
    test("a skipped panel import with 0 uploads does not count", async () => {
      await seedRun({ dryRun: false, status: "skipped", ago: "1 hour" });
      assert.deepEqual(await checkPanelRunAllowed({ dryRun: false }, db.pool), { allowed: true });
    });
    test("failed or reauth_required panel imports with 0 uploads do not count", async () => {
      await seedRun({ dryRun: false, status: "failed", ago: "1 hour" });
      await seedRun({ dryRun: false, status: "reauth_required", ago: "2 hours" });
      assert.deepEqual(await checkPanelRunAllowed({ dryRun: false }, db.pool), { allowed: true });
    });
    test("a failed panel import with uploads > 0 counts", async () => {
      await seedRun({ dryRun: false, status: "failed", ago: "1 hour", uploads: 3 });
      assert.equal((await checkPanelRunAllowed({ dryRun: false }, db.pool)).reason, "daily_limit");
    });
    test("cron and CLI imports and panel checks never count toward the daily limit", async () => {
      await seedRun({ trigger: "cron", dryRun: false, ago: "1 hour", uploads: 25 });
      await seedRun({ trigger: "cli", dryRun: false, ago: "1 hour", uploads: 25 });
      await seedRun({ trigger: "panel", dryRun: true, ago: "1 hour", uploads: 25 });
      assert.deepEqual(await checkPanelRunAllowed({ dryRun: false }, db.pool), { allowed: true });
    });
    test("refused at 1,000 real uploads in 30 days from any trigger; retry when the oldest leaves", async () => {
      await seedRun({ trigger: "cron", dryRun: false, ago: "10 days", uploads: 600 });
      await seedRun({ trigger: "cli", dryRun: false, ago: "2 days", uploads: 400 });
      const r = await checkPanelRunAllowed({ dryRun: false }, db.pool);
      assert.equal(r.allowed, false);
      assert.equal(r.reason, "upload_ceiling");
      between(r.retryAfterSeconds, 1_727_995, 1_728_000); // 20 days
    });
    test("allowed at 999 real uploads", async () => {
      await seedRun({ trigger: "cron", dryRun: false, ago: "3 days", uploads: 999 });
      assert.deepEqual(await checkPanelRunAllowed({ dryRun: false }, db.pool), { allowed: true });
    });
    test("the ceiling counts only dry_run = false rows", async () => {
      await seedRun({ trigger: "panel", dryRun: true, ago: "3 days", uploads: 5000 });
      await seedRun({ trigger: "cron", dryRun: false, ago: "3 days", uploads: 999 });
      assert.deepEqual(await checkPanelRunAllowed({ dryRun: false }, db.pool), { allowed: true });
    });
    test("uploads older than 30 days don't count", async () => {
      await seedRun({ trigger: "cron", dryRun: false, ago: "31 days", uploads: 1000 });
      assert.deepEqual(await checkPanelRunAllowed({ dryRun: false }, db.pool), { allowed: true });
    });
    test("daily_limit is reported before upload_ceiling", async () => {
      await seedRun({ trigger: "cron", dryRun: false, ago: "5 days", uploads: 1000 });
      await seedRun({ trigger: "panel", dryRun: false, ago: "1 hour", uploads: 2 });
      assert.equal((await checkPanelRunAllowed({ dryRun: false }, db.pool)).reason, "daily_limit");
    });
  });

  describe("claimPanelSlot (two requests at once)", () => {
    const claimTwice = (dryRun) =>
      Promise.all([claimPanelSlot({ dryRun }, db.pool), claimPanelSlot({ dryRun }, db.pool)]);

    test("two concurrent checks: exactly one claims the 10-minute slot", async () => {
      const results = await claimTwice(true);
      assert.deepEqual(results.filter((r) => r.claimed), [{ claimed: true }]);
      const [lost] = results.filter((r) => !r.claimed);
      assert.deepEqual(Object.keys(lost).sort(), ["claimed", "retryAfterSeconds"]);
      between(lost.retryAfterSeconds, 595, 600);
    });
    test("a running panel import blocks a second import", async () => {
      // A double-click or a second tab: both requests claim before either run has written its sync_runs row.
      const results = await claimTwice(false);
      assert.deepEqual(results.filter((r) => r.claimed), [{ claimed: true }]);
      const [lost] = results.filter((r) => !r.claimed);
      between(lost.retryAfterSeconds, 86_395, 86_400);
    });
    test("the check and import slots are separate, and an expired slot can be claimed again", async () => {
      assert.deepEqual(await claimPanelSlot({ dryRun: true }, db.pool), { claimed: true });
      assert.deepEqual(await claimPanelSlot({ dryRun: false }, db.pool), { claimed: true });
      await db.pool.query(
        "update job_locks set locked_until = now() - interval '1 second' where name = 'instagram-panel-check'");
      assert.deepEqual(await claimPanelSlot({ dryRun: true }, db.pool), { claimed: true });
      assert.equal((await claimPanelSlot({ dryRun: false }, db.pool)).claimed, false);
    });
    test("releasePanelImportSlot frees the import slot only", async () => {
      await claimPanelSlot({ dryRun: true }, db.pool);
      await claimPanelSlot({ dryRun: false }, db.pool);
      await releasePanelImportSlot(db.pool);
      assert.deepEqual(await claimPanelSlot({ dryRun: false }, db.pool), { claimed: true });
      assert.equal((await claimPanelSlot({ dryRun: true }, db.pool)).claimed, false);
      const { rows } = await db.pool.query("select name from job_locks order by name");
      assert.deepEqual(rows.map((r) => r.name), ["instagram-panel-check", "instagram-panel-import"]);
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/integration/sync-limits.test.mjs
```

Expected: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../lib/admin/sync-limits.js'`, and the summary shows `ℹ tests 1` and `ℹ fail 1`.

These tests assume a UTC session time zone, which the `kw-test-pg` container sets (`-c timezone=UTC`, Task 2 Step 9). `interval '30 days'` on a `timestamptz` is calendar arithmetic in the session zone, so in a zone with a DST change inside the window the `upload_ceiling` retry comes out 3,600 s off and that test fails.

- [ ] **Step 3: Implement `checkPanelRunAllowed`, `claimPanelSlot` and `releasePanelImportSlot` in `lib/admin/sync-limits.js`**

Imports: `getDbPool` from `../db.js` and `uploadsInLastDays` from `../sync-runs.js`. All time arithmetic happens in SQL against `now()`, so the database is the only clock. Convert each wait with `retryAfterSeconds = Math.max(1, Math.ceil(waitSeconds))`. Interval parameters follow the lease code's `$n::interval` pattern.

- **Check** (`dryRun === true`). Refused with `"too_soon"` when this query returns a non-null `wait_seconds`. Params: `["10 minutes"]`, built from `CHECK_MIN_GAP_MINUTES`.

```sql
select extract(epoch from max(started_at) + $1::interval - now())::float8 as wait_seconds
  from sync_runs
 where job = 'instagram' and trigger = 'panel' and dry_run
   and started_at > now() - $1::interval
```

- **Import** (`dryRun === false`). There are two checks, in this order.
  1. `"daily_limit"`. Params: `["24 hours"]`, built from `IMPORT_WINDOW_HOURS`.

```sql
select extract(epoch from max(started_at) + $1::interval - now())::float8 as wait_seconds
  from sync_runs
 where job = 'instagram' and trigger = 'panel' and not dry_run
   and started_at > now() - $1::interval
   and (status = any(array['running','ok','partial','abandoned']) or uploads > 0)
```

  2. `"upload_ceiling"`, when `await uploadsInLastDays(30, db) >= PANEL_UPLOAD_CEILING_30D`. The retry is the moment the oldest counted row leaves the 30-day window. That is the earliest the answer can change, so it is a lower bound, because the cron keeps adding uploads. If the query returns null, fall back to 3600.

```sql
select extract(epoch from min(started_at) + interval '30 days' - now())::float8 as wait_seconds
  from sync_runs
 where not dry_run and uploads > 0 and started_at > now() - interval '30 days'
```

- **`claimPanelSlot({ dryRun }, db = getDbPool())`.** `checkPanelRunAllowed` alone is check-then-act: the row it reads is written later, by `startRun` inside `syncInstagram`. The claim copies the run lease's `job_locks` pattern from `lib/instagram-sync.js`, which is safe through the transaction-mode pooler because every statement commits on its own. The slot is `"instagram-panel-check"` with `"10 minutes"` (from `CHECK_MIN_GAP_MINUTES`) when `dryRun` is true, and `"instagram-panel-import"` with `"24 hours"` (from `IMPORT_WINDOW_HOURS`) when it is false. Run these as separate `db.query` calls, with params `[name]` for the first and third and `[name, interval]` for the second:

```sql
insert into job_locks (name) values ($1) on conflict (name) do nothing;

update job_locks set locked_until = now() + $2::interval
 where name = $1 and locked_until < now()
returning locked_until;

-- only when the update returned no row
select extract(epoch from locked_until - now())::float8 as wait_seconds from job_locks where name = $1;
```

  - One row back from the `update` means `{ claimed: true }`.
  - No row means `{ claimed: false, retryAfterSeconds }`, converted from `wait_seconds` with the same `Math.max(1, Math.ceil(...))`.
  - Two concurrent claims queue on the row lock. Under READ COMMITTED the second `update` re-checks `locked_until < now()` against the first one's new value, so exactly one of them gets a row.
- **`releasePanelImportSlot(db = getDbPool())`**: `update job_locks set locked_until = 'epoch' where name = 'instagram-panel-import'`. Nothing releases the check slot, because a failed check still counts, as it does in `sync_runs`.

- [ ] **Step 4: Run the limits test to verify it passes**

Run the Step 2 command again. Expected: `ℹ tests 25`, `ℹ pass 25`, `ℹ fail 0`, `ℹ cancelled 0`, and no `﹣` skip line.

- [ ] **Step 5: Write the failing unit test for the handler**

`tests/admin-instagram-sync-route.test.mjs`. The owner's `userId` differs from `OWNER_ACTOR` on purpose: every audit row must carry `OWNER_ACTOR`, never the Better Auth user id.

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createInstagramSyncHandler, readJsonBody } from "../lib/admin/instagram-sync-route.js";
import { OWNER_ACTOR } from "../lib/admin/audit-log.js";
import { InstagramReauthRequiredError } from "../lib/instagram.js";
import { fakeRes } from "./helpers/admin-fakes.mjs";

const OWNER = { userId: "user-1", name: "Kevin Wong", image: null, expiresAt: new Date("2026-10-17T12:00:00Z") };
const PANEL_OPTIONS = { trigger: "panel", maxPosts: 50, maxUploads: 25, timeBudgetMs: 60_000 };

const summary = (o = {}) => ({ dryRun: true, startDate: "2022-01-01T00:00:00.000Z", fetched: 0, alreadyPresent: 0,
  skipped: [], inserted: [], uploads: 0, deferred: 0, warnings: [], errors: [], ...o });
const post = (body) => ({ method: "POST", headers: { origin: "https://www.kevinwong.co" }, body });
// fakeRes that adds "respond" to calls.order when the handler sends, so a test can check the response goes last.
const trackedRes = (calls) => {
  const res = fakeRes();
  for (const m of ["json", "end"]) {
    const send = res[m];
    res[m] = function (...args) { calls.order.push("respond"); return send.apply(this, args); };
  }
  return res;
};

// `allowed` answers the first checkPanelRunAllowed call; `recheck` answers the one a thrown import makes afterwards.
function setup({ owner = async () => OWNER, allowed = { allowed: true }, recheck = { allowed: true },
  claim = { claimed: true }, sync = async () => summary(), log = async () => {} } = {}) {
  const calls = { requireAdmin: [], read: 0, check: [], claim: [], release: 0, sync: [], log: [] };
  const handler = createInstagramSyncHandler({
    requireAdmin: async (req, res, opts) => { calls.requireAdmin.push(opts); return owner(req, res); },
    readJsonBody: async (req) => { calls.read += 1; return req.body; },
    checkPanelRunAllowed: async (args) => { calls.check.push(args); calls.order.push("check"); return calls.check.length === 1 ? allowed : recheck; },
    claimPanelSlot: async (args) => { calls.claim.push(args); return claim; },
    releasePanelImportSlot: async () => { calls.release += 1; calls.order.push("release"); },
    syncInstagram: async (opts) => { calls.sync.push(opts); return sync(opts); },
    logAdminEvent: async (event, opts) => { calls.log.push([event, opts]); calls.order.push("log"); return log(); },
  });
  calls.order = []; // "check", "log", "release", and "respond" from trackedRes, as they happen
  return { handler, calls };
}

test("asks requireAdmin for the mutation guard", async () => {
  const { handler, calls } = setup();
  await handler(post({ dryRun: true }), fakeRes());
  assert.deepEqual(calls.requireAdmin, [{ mutation: true }]);
});

test("passes requireAdmin's 403 through and does nothing else", async () => {
  const { handler, calls } = setup({ owner: async (req, res) => { res.status(403).json({ error: "bad_origin" }); return null; } });
  const res = fakeRes();
  await handler(post({ dryRun: true }), res);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: "bad_origin" });
  assert.equal(calls.check.length + calls.sync.length + calls.log.length + calls.read, 0); // the body is never read
});

test("405 with Allow: POST for GET", async () => {
  const { handler, calls } = setup();
  const res = fakeRes();
  await handler({ method: "GET", headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, "POST");
  assert.deepEqual(res.body, { error: "method_not_allowed" });
  assert.equal(calls.sync.length + calls.read, 0);
});

for (const body of [undefined, null, {}, { dryRun: "yes" }, { dryRun: 1 }, [true], "dryRun=true"]) {
  test(`400 bad_request for body ${JSON.stringify(body)}`, async () => {
    const { handler, calls } = setup();
    const res = fakeRes();
    await handler(post(body), res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: "bad_request" });
    assert.equal(calls.check.length + calls.claim.length + calls.sync.length, 0);
  });
}

test("readJsonBody parses a small JSON body and gives undefined for anything else", async () => {
  const stream = (text, type = "application/json") =>
    Object.assign(Readable.from([Buffer.from(text)]), { headers: { "content-type": type } });
  assert.deepEqual(await readJsonBody(stream('{"dryRun":true}')), { dryRun: true });
  assert.deepEqual(await readJsonBody(stream('{"dryRun":false}', "application/json; charset=utf-8")), { dryRun: false });
  assert.equal(await readJsonBody(stream("{oops")), undefined);
  assert.equal(await readJsonBody(stream('{"dryRun":true}', "text/plain")), undefined);
  assert.equal(await readJsonBody(stream("")), undefined);
  assert.equal(await readJsonBody(stream(`{"pad":"${"x".repeat(1100)}"}`)), undefined);
});

test("extra keys are ignored: the server fixes every other parameter", async () => {
  const { handler, calls } = setup({ sync: async () => summary({ dryRun: false }) });
  await handler(post({ dryRun: false, maxUploads: 1000, maxPosts: 999, timeBudgetMs: 0, trigger: "cron" }), fakeRes());
  assert.deepEqual(calls.check, [{ dryRun: false }]);
  assert.deepEqual(calls.claim, [{ dryRun: false }]);
  assert.deepEqual(calls.sync, [{ ...PANEL_OPTIONS, dryRun: false }]);
});

test("429 with reason, retryAfterSeconds, Retry-After and a panel_run_refused event", async () => {
  const { handler, calls } = setup({ allowed: { allowed: false, reason: "too_soon", retryAfterSeconds: 120 } });
  const res = fakeRes();
  await handler(post({ dryRun: true }), res);
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body, { error: "too_soon", retryAfterSeconds: 120 });
  assert.equal(res.headers["retry-after"], "120");
  assert.deepEqual(calls.log, [["panel_run_refused",
    { actor: OWNER_ACTOR, details: { dryRun: true, reason: "too_soon", retryAfterSeconds: 120 } }]]);
  assert.equal(calls.claim.length + calls.sync.length, 0); // refused before the slot is claimed
});

for (const [dryRun, reason] of [[true, "too_soon"], [false, "daily_limit"]]) {
  test(`429 ${reason} when another request already holds the ${dryRun ? "check" : "import"} slot`, async () => {
    const { handler, calls } = setup({ claim: { claimed: false, retryAfterSeconds: 42 } });
    const res = fakeRes();
    await handler(post({ dryRun }), res);
    assert.equal(res.statusCode, 429);
    assert.deepEqual(res.body, { error: reason, retryAfterSeconds: 42 });
    assert.equal(res.headers["retry-after"], "42");
    assert.deepEqual(calls.check, [{ dryRun }]);
    assert.deepEqual(calls.claim, [{ dryRun }]);
    assert.deepEqual(calls.log, [["panel_run_refused",
      { actor: OWNER_ACTOR, details: { dryRun, reason, retryAfterSeconds: 42 } }]]);
    assert.equal(calls.sync.length + calls.release, 0);
  });
}

test("200 for a check: posts carry shortcode, postedAt and mediaCount only", async () => {
  const { handler, calls } = setup({ sync: async () => summary({
    fetched: 12, alreadyPresent: 11, uploads: 3, blob: "ok", resize: "ok (sharp 0.35.4, libvips 8.17.2)",
    inserted: [{ shortcode: "DAbc123", postedAt: "2026-10-15T10:00:00.000Z", mediaCount: 3, caption: "secret caption", dryRun: true }],
  }) });
  const res = trackedRes(calls);
  await handler(post({ dryRun: true }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    status: "ok", fetched: 12, alreadyPresent: 11,
    posts: [{ shortcode: "DAbc123", postedAt: "2026-10-15T10:00:00.000Z", mediaCount: 3 }],
    uploads: 3, deferred: 0, errorCount: 0, blob: "ok", resize: "ok (sharp 0.35.4, libvips 8.17.2)",
  });
  assert.ok(!JSON.stringify(res.body).includes("secret caption"));
  assert.deepEqual(calls.sync, [{ ...PANEL_OPTIONS, dryRun: true }]);
  assert.deepEqual(calls.log, [["instagram_check",
    { actor: OWNER_ACTOR, details: { status: "ok", fetched: 12, imported: 1, uploads: 3, deferred: 0, errorCount: 0 } }]]);
  assert.deepEqual(calls.order, ["check", "log", "respond"]); // the response goes last
});

test("200 for an import: partial status, no blob or resize keys", async () => {
  const { handler, calls } = setup({ sync: async () => summary({ dryRun: false, fetched: 5, uploads: 2, deferred: 1,
    inserted: [{ shortcode: "DXyz", postedAt: "2026-10-14T09:00:00.000Z", mediaCount: 2, caption: "hi" }],
    errors: [{ id: "179", error: "upload failed" }] }) });
  const res = fakeRes();
  await handler(post({ dryRun: false }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, "partial");
  assert.equal(res.body.errorCount, 1);
  assert.equal("blob" in res.body, false);
  assert.equal("resize" in res.body, false);
  assert.equal(calls.log[0][0], "instagram_import");
});

test("503 instagram_reauth_required, audited as reauth_required", async (t) => {
  t.mock.method(console, "error", () => {});
  const { handler, calls } = setup({ sync: async () => { throw new InstagramReauthRequiredError("dead"); } });
  const res = fakeRes();
  await handler(post({ dryRun: true }), res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: "instagram_reauth_required" });
  assert.deepEqual(calls.log, [["instagram_check", { actor: OWNER_ACTOR, details: { status: "reauth_required" } }]]);
});

test("500 sync_failed for any other error, message not echoed and logged only redacted", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const { handler, calls } = setup({ sync: async () => { throw new Error("connect postgres://kw:hunter2@db.example failed"); } });
  const res = fakeRes();
  await handler(post({ dryRun: false }), res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: "sync_failed" });
  assert.deepEqual(calls.log, [["instagram_import", { actor: OWNER_ACTOR, details: { status: "failed" } }]]);
  const lines = logged.mock.calls.map((c) => c.arguments.map(String).join(" "));
  assert.ok(lines.some((l) => l.includes("postgres://[redacted]@db.example")), lines.join("\n"));
  assert.ok(lines.every((l) => !l.includes("hunter2")), lines.join("\n"));
});

test("an import that ends skipped with 0 uploads releases the import slot; ok and partial imports keep it", async () => {
  const skipped = setup({ sync: async () => summary({ dryRun: false, leaseHeld: true,
    skipped: [{ id: "run", reason: "another sync is already running" }] }) });
  const res = trackedRes(skipped.calls);
  await skipped.handler(post({ dryRun: false }), res);
  assert.equal(res.body.status, "skipped");
  assert.equal(skipped.calls.release, 1);
  assert.deepEqual(skipped.calls.order, ["check", "log", "release", "respond"]);
  for (const o of [{}, { errors: [{ id: "179", error: "upload failed" }] }]) { // ok with 0 uploads, then partial
    const kept = setup({ sync: async () => summary({ dryRun: false, ...o }) });
    await kept.handler(post({ dryRun: false }), fakeRes());
    assert.equal(kept.calls.release, 0);
  }
});

test("a thrown import frees the import slot only when sync_runs no longer counts it", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const error of [new Error("Graph timeout"), new InstagramReauthRequiredError("dead")]) {
    const fail = async () => { throw error; };
    // Recorded failed or reauth_required with 0 uploads: the second read no longer reports daily_limit.
    for (const recheck of [{ allowed: true }, { allowed: false, reason: "upload_ceiling", retryAfterSeconds: 3600 }]) {
      const freed = setup({ sync: fail, recheck });
      await freed.handler(post({ dryRun: false }), trackedRes(freed.calls));
      assert.deepEqual(freed.calls.check, [{ dryRun: false }, { dryRun: false }]);
      assert.equal(freed.calls.release, 1);
      assert.deepEqual(freed.calls.order, ["check", "log", "check", "release", "respond"]);
    }
    // Uploads before the throw, or a row still marked running, keep the import counted, so the slot stays claimed.
    const kept = setup({ sync: fail, recheck: { allowed: false, reason: "daily_limit", retryAfterSeconds: 86_000 } });
    await kept.handler(post({ dryRun: false }), fakeRes());
    assert.equal(kept.calls.release, 0);
  }
  // A check never releases anything and makes no second read.
  const check = setup({ sync: async () => { throw new Error("Graph timeout"); } });
  await check.handler(post({ dryRun: true }), fakeRes());
  assert.equal(check.calls.check.length, 1);
  assert.equal(check.calls.release, 0);
});

test("a failed audit write does not change the response", async (t) => {
  t.mock.method(console, "error", () => {});
  const { handler } = setup({ log: async () => { throw new Error("db down"); } });
  const res = fakeRes();
  await handler(post({ dryRun: true }), res);
  assert.equal(res.statusCode, 200);
});
```

- [ ] **Step 6: Run it to verify it fails**

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/admin-instagram-sync-route.test.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` for `lib/admin/instagram-sync-route.js`, then `ℹ tests 1` and `ℹ fail 1`.

- [ ] **Step 7: Implement `createInstagramSyncHandler(deps)` in `lib/admin/instagram-sync-route.js` and the route**

The library file imports only `statusFromSummary` from `../sync-runs.js`, `InstagramReauthRequiredError` from `../instagram.js`, `OWNER_ACTOR` from `./audit-log.js` and `redact` from `../redact.js`; `claimPanelSlot`, `releasePanelImportSlot` and `readJsonBody` arrive as deps like the rest. The file also exports `readJsonBody`, exactly:

```js
// Next's body parser is off for this route (config.api.bodyParser = false), so requireAdmin answers 404, 403 or 401
// before any body is read (D1). Returns the parsed body of an application/json request of 1 to limitBytes bytes,
// else undefined. It never stops reading early: ending the iterator early destroys the request and its socket.
export async function readJsonBody(req, limitBytes = 1024) {
  const type = String(req.headers?.["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size <= limitBytes) chunks.push(chunk);
    }
    if (type !== "application/json" || size === 0 || size > limitBytes) return undefined;
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}
```

The handler does these things in order:
1. `const owner = await requireAdmin(req, res, { mutation: true }); if (!owner) return;`. Running it first, with Next's body parser off (the route's `config`), means every method and every body gets 404 outside production (D1). A GET typed into the address bar has no `Origin`, so it gets 403 from the guard. Only a same-origin GET reaches step 2.
2. If `req.method !== "POST"`: `Allow: POST`, then 405 `{ error: "method_not_allowed" }`.
3. `const body = await readJsonBody(req)`. The body must be a plain object (not null, not an array) with `typeof body.dryRun === "boolean"`. Otherwise 400 `{ error: "bad_request" }`. Read nothing else from the body.
4. `const verdict = await checkPanelRunAllowed({ dryRun })`. This covers the 1,000 ceiling, and the `sync_runs` view of the two D4 limits. If it is not allowed:
   - `res.setHeader("Retry-After", String(retryAfterSeconds))`
   - audit `panel_run_refused` with `details: { dryRun, reason, retryAfterSeconds }`
   - 429 `{ error: reason, retryAfterSeconds }`
5. `const claim = await claimPanelSlot({ dryRun })`. If `!claim.claimed`, another request holds the slot, so refuse exactly as in step 4, with `reason = dryRun ? "too_soon" : "daily_limit"` and the claim's `retryAfterSeconds`.
6. Call `syncInstagram({ trigger: "panel", dryRun, maxPosts: 50, maxUploads: 25, timeBudgetMs: 60_000 })`.
7. On success, build the 200 body in the shape given in Interfaces, but don't send it yet:
   - `status` is `statusFromSummary(summary)`.
   - `posts` is `summary.inserted.map(({ shortcode, postedAt, mediaCount }) => ({ shortcode, postedAt, mediaCount }))`.
   - `errorCount` is `summary.errors.length`.
   - `blob` and `resize` are copied only when they are present on the summary.

   Then, in this order: await the audit of `dryRun ? "instagram_check" : "instagram_import"` with `details: { status, fetched, imported: inserted.length, uploads, deferred, errorCount }`; await the release below when it applies; and only then `res.status(200).json(body)`.
   For an import whose `status` is `"skipped"` and whose `summary.uploads` is 0, also await `releasePanelImportSlot()`, before the response. That happens when the cron held the run lease or the 1,800 ceiling stopped the run. It mirrors the counting rule in Step 3: a skipped import with no uploads doesn't use up the day.
8. Error paths:
   - `InstagramReauthRequiredError`: audit `{ status: "reauth_required" }`, then 503 `{ error: "instagram_reauth_required" }`.
   - Anything else: `console.error("[admin/instagram/sync] failed:", redact(error instanceof Error ? error.message : String(error)))` (the message, never the `Error`), audit `{ status: "failed" }`, then 500 `{ error: "sync_failed" }`.
   - For an import, either error then decides whether to release the slot, after the audit and before the 503 or 500 is sent. A throw carries no summary, so the handler can't see `uploads` and asks the ledger instead. `syncInstagram` has already recorded the row as `failed` or `reauth_required`, with every upload counted (Task 9). Call `checkPanelRunAllowed({ dryRun: false })` again, and call `releasePanelImportSlot()` only when its `reason` is not `"daily_limit"`. Step 3's rule counts such a row only when `uploads > 0`, or while it still says `running` because recording failed. So this frees the slot exactly when the run uploaded nothing. A check never releases its slot. On both error paths the response goes last: the audit, then for an import the re-read and any release, then the 503 or 500.

The `actor` of every audit event is `OWNER_ACTOR`. Every audit write is awaited inside `try/catch` that only `console.error`s a redacted message string (as in Step 8), so it never changes the response. Awaiting matters because a Vercel function can freeze once the response is sent, so on every path the response is sent last, after the audit, the ledger re-read and the release have settled (the 429 paths of Steps 4 and 5 already audit first). The release, and the ledger re-read after a throw, are awaited the same way, inside a `try/catch` that only `console.error`s. If either fails, the slot stays claimed, so the limit fails closed.

`pages/api/admin/instagram/sync.js` imports without extensions:
- `createInstagramSyncHandler` and `readJsonBody` from `../../../../lib/admin/instagram-sync-route`
- `requireAdmin` from `../../../../lib/admin/guard`
- `checkPanelRunAllowed`, `claimPanelSlot` and `releasePanelImportSlot` from `../../../../lib/admin/sync-limits`
- `syncInstagram` from `../../../../lib/instagram-sync`
- `logAdminEvent` from `../../../../lib/admin/audit-log`

Its body, exactly:

```js
// Same ceiling as the cron route; the 60 s budget passed by the handler leaves the
// post already in flight room to finish (spec: "Panel runs get a 60-second budget").
// Body parser off: requireAdmin must answer before any body is read (D1); readJsonBody reads it afterwards.
export const config = { maxDuration: 300, api: { bodyParser: false } };

const handler = createInstagramSyncHandler({
  requireAdmin, readJsonBody, checkPanelRunAllowed, claimPanelSlot, releasePanelImportSlot, syncInstagram, logAdminEvent,
});
export default handler;
```

(Use a named const so the handler has a name in stack traces.)

- [ ] **Step 8: Run both tests and lint to verify they pass**

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/admin-instagram-sync-route.test.mjs tests/integration/sync-limits.test.mjs
npx eslint lib/admin/sync-limits.js lib/admin/instagram-sync-route.js pages/api/admin/instagram/sync.js tests/admin-instagram-sync-route.test.mjs tests/integration/sync-limits.test.mjs
grep -n "maxDuration: 300, api: { bodyParser: false }" pages/api/admin/instagram/sync.js
npm test
```

Expected:
- The focused run: `ℹ tests 47` (22 + 25), `ℹ pass 47`, `ℹ fail 0`, `ℹ cancelled 0`, and no `﹣` skip line.
- ESLint prints nothing and exits 0, and grep prints one line.
- `npm test`: `ℹ fail 0` and `ℹ cancelled 0`.

- [ ] **Step 9: Commit**

```sh
git add lib/admin/sync-limits.js lib/admin/instagram-sync-route.js pages/api/admin/instagram/sync.js tests/admin-instagram-sync-route.test.mjs tests/integration/sync-limits.test.mjs
git commit -m "Add the panel's Check and Import endpoint with its daily limits"
```

---

### Task 15: Admin status

**Model:** Opus
**Files:**
- Create: `lib/admin/status.js` (`buildAdminStatus`, plus the route logic `createStatusHandler` with injected deps)
- Create: `pages/api/admin/status.js` (wires the real deps)
- Test: `tests/integration/admin-status.test.mjs`, `tests/admin-status-route.test.mjs`

**Interfaces:**
- Consumes:
  - From `lib/spotify-token.js` (Task 5):
    - `readSpotifyStatusRow(db?): Promise<null | { deadReason, authorizedAt, expiresAt, accountId, scopes: string[], updatedAt }>`. It never selects a token.
    - `SPOTIFY_SCOPES`.
  - `missingScopes(granted: string[]): string[]` from `lib/spotify-oauth.js` (Task 7).
  - `OWNER_SPOTIFY_ACCOUNT_ID` from `lib/admin/owner.js` (Task 7, filled in its Step 9).
  - From `lib/sync-runs.js` (Task 9):
    - `lastRun({ job = "instagram", trigger, dryRun }, db?): Promise<Run | null>`. It filters on `dry_run` when `dryRun` is a boolean.
    - `recentRuns({ job = "instagram", limit = 20 } = {}, db?): Promise<Run[]>`, newest first. `Run` is `{ id: number, trigger, dryRun, status, startedAt: Date, finishedAt: Date | null, fetched, imported, uploads, deferred, skipped, errorCount, error }`.
    - `uploadsInLastDays(days, db?): Promise<number>`.
    - `UPLOAD_CEILING_30D` (1800).
  - `checkPanelRunAllowed({ dryRun }, db?)` and `PANEL_UPLOAD_CEILING_30D` from `lib/admin/sync-limits.js` (Task 14).
  - The `job_locks` rows `instagram-panel-check` and `instagram-panel-import` that Task 14's `claimPanelSlot` claims. A slot is held while `locked_until` is in the future; `releasePanelImportSlot` sets it to `'epoch'`.
  - From `lib/admin/audit-log.js` (Task 11):
    - `recentAdminEvents(limit = 20, db?): Promise<{ id: number, at: Date, event, actor: string | null, details: object }[]>`, newest first. It leaves out `sign_in_rejected` rows.
    - `refusedSignInSummary(db?): Promise<{ count24h: number, latestAt: Date | null, latestLogin: string | null }>`, covering the `sign_in_rejected` rows.
    - `logAdminEvent` and `OWNER_ACTOR` (the tests use them to seed).
  - `requireAdmin(req, res, { mutation = false, deps = {} } = {})` from `lib/admin/guard.js` (Task 12).
  - `redact(value)` from `lib/redact.js` (Task 4), for step 4's log line. Pass it the message string, never an `Error`, which it returns unchanged.
  - `testDb()` from Task 2, and `fakeRes()` from `tests/helpers/admin-fakes.mjs` (Task 12), both as in Task 14.
- Produces:
  - `export async function buildAdminStatus({ db = getDbPool(), env = process.env, now = new Date() } = {})`, which returns the JSON below and rejects when any query fails. Every value is JSON-safe: ISO strings for dates, numbers (never bigint strings) for ids and sums, and `null`, never `undefined`. Task 17's `types.ts` mirrors it.
  - `export function createStatusHandler({ requireAdmin, buildAdminStatus })`.
  - `GET /api/admin/status`, which answers 200 with that JSON. Errors are 405 `{ error: "method_not_allowed" }` (with `Allow: GET`) and 500 `{ error: "status_failed" }`. 404 and 401 come from `requireAdmin`.

```text
{
  generatedAt: ISO,
  spotify: {
    state: "connected" | "dead" | "env" | "missing",
    authorizedAt: ISO | null, expiresAt: ISO | null,
    daysLeft: number | null,              // floored whole days; negative once past expiresAt; null with no row
    accountMatches: boolean | null,
    scopes: string[] | null, missingScopes: string[] | null,   // null when there is no row
    deadReason: string | null
  },
  instagram: {
    token: null | { expiresAt: ISO, daysLeft: number, refreshedAt: ISO, expiresAtIsAssumed: boolean, deadReason: string | null },
    lastCron: Run | null,                 // lastRun({ trigger: "cron", dryRun: false }), shown abandoned when stale (Step 3)
    cronOverdue: boolean,                 // lastCron null, or started > 36 h before now
    lease: { held: boolean, lockedUntil: ISO | null },   // lockedUntil null unless held
    library: { posts: number, files: number, bytes: number },   // null asset_bytes count as 0
    uploads30d: number,
    limits: { panelCeiling: 1000, cronCeiling: 1800, monthlyLimit: 2000, storageLimitBytes: 1000000000 },
    panel: { nextCheckAt: ISO | null, nextImportAt: ISO | null, importBlockedReason: null | "daily_limit" | "upload_ceiling" }
                                          // from checkPanelRunAllowed and the held panel slots in job_locks
  },
  runs: Run[],          // recentRuns({ limit: 20 }), stale running rows shown abandoned (Step 3)
  activity: { id: number, at: ISO, event, actor: string | null, details: object }[],  // recentAdminEvents(20): no sign_in_rejected rows
  refusedSignIns: { count24h: number, latestAt: ISO | null, latestLogin: string | null }   // refusedSignInSummary()
}
Run = { id: number, trigger, dryRun, status, startedAt: ISO, finishedAt: ISO | null, fetched, imported,
        uploads, deferred, skipped, errorCount, error: string | null }
```

- [ ] **Step 1: Write the failing tests**

`tests/integration/admin-status.test.mjs`.

Two clocks are in play:
- Tests about spotify, the token, the cron, the lease, abandoned runs and the library use a fixed injected `NOW` and seed explicit timestamps.
- Tests about `uploads30d`, `panel.*` and `refusedSignIns` go through functions that use the database's `now()`. They seed with `now() ± interval` and inject `now: new Date()`.

The seed SQL for posts and media uses exactly the column lists of `insertPost` in the audit's `lib/instagram-sync.js`. Every NOT NULL column without a default is among those, because production accepts that insert. If `tests/fixtures/prod-schema.sql` shows a difference, follow the fixture and say so in the commit message.

```js
import { describe, test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "../helpers/db.mjs";
import { buildAdminStatus } from "../../lib/admin/status.js";
import { OWNER_ACTOR, logAdminEvent } from "../../lib/admin/audit-log.js";
import { OWNER_SPOTIFY_ACCOUNT_ID } from "../../lib/admin/owner.js";
import { SPOTIFY_SCOPES } from "../../lib/spotify-token.js";

const db = testDb();
const NOW = new Date("2026-10-16T12:00:00Z");
const hoursBefore = (d, h) => new Date(d.getTime() - h * 3_600_000);
const SECRETS = { spotifyRefresh: "spotify-refresh-SECRET-1", spotifyAccess: "spotify-access-SECRET-2",
  instagramAccess: "ig-access-SECRET-3", envRefresh: "env-refresh-SECRET-4" };
const status = (o = {}) => buildAdminStatus({ db: db.pool, env: {}, now: NOW, ...o });
const between = (v, lo, hi) => assert.ok(v >= lo && v <= hi, `${v} not in [${lo}, ${hi}]`);

async function seedSpotify({ authorizedAt = new Date("2026-08-03T00:00:00Z"), expiresAt = new Date("2027-01-30T00:00:00Z"),
  accountId = OWNER_SPOTIFY_ACCOUNT_ID, scopes = SPOTIFY_SCOPES.join(" "), deadReason = null } = {}) {
  await db.pool.query(
    `insert into integration_tokens (provider, access_token, refresh_token, expires_at, expires_at_is_assumed,
       authorized_at, account_id, scopes, dead_reason, refreshed_at)
     values ('spotify', $1, $2, $3, true, $4, $5, $6, $7, $4)`,
    [SECRETS.spotifyAccess, SECRETS.spotifyRefresh, expiresAt, authorizedAt, accountId, scopes, deadReason]);
}
async function seedInstagramToken({ expiresAt, refreshedAt, deadReason = null }) {
  await db.pool.query(
    `insert into integration_tokens (provider, access_token, expires_at, refreshed_at, expires_at_is_assumed, dead_reason)
     values ('instagram', $1, $2, $3, false, $4)`, [SECRETS.instagramAccess, expiresAt, refreshedAt, deadReason]);
}
async function seedRunAt({ trigger, dryRun, status: s = "ok", startedAt, uploads = 0 }) {
  await db.pool.query(`insert into sync_runs (job, trigger, dry_run, status, started_at, finished_at, uploads)
    values ('instagram', $1, $2, $3, $4, $4, $5)`, [trigger, dryRun, s, startedAt, uploads]);
}
async function seedRunAgo({ trigger, dryRun, status: s = "ok", ago, uploads = 0 }) {
  await db.pool.query(`insert into sync_runs (job, trigger, dry_run, status, started_at, uploads)
    values ('instagram', $1, $2, $3, now() - $4::interval, $5)`, [trigger, dryRun, s, ago, uploads]);
}
async function seedPost(shortcode, mediaBytes) {
  const { rows } = await db.pool.query(
    `insert into instagram_posts (source_key, caption, instagram_url, posted_at, raw_post_json, caption_emojis)
     values ($1, '', $2, now(), '{}'::jsonb, '{}'::text[]) returning id`,
    [`ig:${shortcode}`, `https://www.instagram.com/p/${shortcode}/`]);
  for (const [position, bytes] of mediaBytes.entries()) {
    const url = `https://blob.example/snapshots/202610/${shortcode}-${position}.jpg`;
    await db.pool.query(
      `insert into instagram_media (post_id, position, kind, asset_url, asset_pathname, asset_content_type, asset_bytes,
         asset_width, asset_height, cloudinary_url, cloudinary_public_id, cloudinary_folder, cloudinary_width,
         cloudinary_height, file_ext, source_uri, source_created_at, raw_media_json)
       values ($1, $2, 'image'::media_kind, $3, $4, 'image/jpeg', $5, 1440, 1440, $3, $4, '202610', 1440, 1440,
               'jpg', $3, now(), '{}'::jsonb)`,
      [rows[0].id, position, url, `snapshots/202610/${shortcode}-${position}.jpg`, bytes]);
  }
}

describe("buildAdminStatus", { skip: db.skip }, () => {
  before(() => db.resetSchema());
  beforeEach(() => db.pool.query(`truncate sync_runs, admin_audit_log, job_locks, integration_tokens,
    instagram_media, instagram_posts restart identity cascade`));
  after(() => db.close());

  test("spotify: connected when the row has no dead_reason", async () => {
    await seedSpotify();
    const s = (await status()).spotify;
    assert.equal(s.state, "connected");
    assert.equal(s.authorizedAt, "2026-08-03T00:00:00.000Z");
    assert.equal(s.expiresAt, "2027-01-30T00:00:00.000Z");
    assert.equal(s.deadReason, null);
    assert.deepEqual(s.scopes, SPOTIFY_SCOPES);
    assert.deepEqual(s.missingScopes, []);
  });
  test("spotify: dead when dead_reason is set", async () => {
    await seedSpotify({ deadReason: "invalid_grant" });
    const s = (await status()).spotify;
    assert.equal(s.state, "dead");
    assert.equal(s.deadReason, "invalid_grant");
  });
  test("spotify: env when there is no row but env.refresh_token is set", async () => {
    assert.deepEqual((await status({ env: { refresh_token: SECRETS.envRefresh } })).spotify, {
      state: "env", authorizedAt: null, expiresAt: null, daysLeft: null, accountMatches: null,
      scopes: null, missingScopes: null, deadReason: null });
  });
  test("spotify: missing when there is neither", async () => {
    assert.equal((await status()).spotify.state, "missing");
  });
  test("spotify: daysLeft is floored, and negative once expiresAt has passed", async () => {
    await seedSpotify({ expiresAt: new Date("2027-01-30T00:00:00Z") });
    assert.equal((await status({ now: new Date("2026-10-16T12:00:00Z") })).spotify.daysLeft, 105); // 105.5 days
    assert.equal((await status({ now: new Date("2027-02-02T12:00:00Z") })).spotify.daysLeft, -4); // -3.5 days
  });
  test("spotify: accountMatches true, false, null", async () => {
    await seedSpotify();
    assert.equal((await status()).spotify.accountMatches, true);
    await db.pool.query(`update integration_tokens set account_id = 'someone-else' where provider = 'spotify'`);
    assert.equal((await status()).spotify.accountMatches, false);
    await db.pool.query(`update integration_tokens set account_id = null where provider = 'spotify'`);
    assert.equal((await status()).spotify.accountMatches, null);
  });
  test("spotify: missingScopes lists what the row lacks", async () => {
    await seedSpotify({ scopes: "user-read-currently-playing user-top-read" });
    assert.deepEqual((await status()).spotify.missingScopes, ["user-read-recently-played"]);
  });

  test("instagram.token: null without a row, fields and daysLeft with one", async () => {
    assert.equal((await status()).instagram.token, null);
    await seedInstagramToken({ expiresAt: new Date("2026-11-25T12:00:00Z"), refreshedAt: new Date("2026-09-26T05:00:00Z") });
    assert.deepEqual((await status()).instagram.token, { expiresAt: "2026-11-25T12:00:00.000Z", daysLeft: 40,
      refreshedAt: "2026-09-26T05:00:00.000Z", expiresAtIsAssumed: false, deadReason: null });
  });

  test("cronOverdue: true with no cron run, true at 37 h, false at 35 h", async () => {
    let s = await status();
    assert.equal(s.instagram.lastCron, null);
    assert.equal(s.instagram.cronOverdue, true);
    await seedRunAt({ trigger: "cron", dryRun: false, startedAt: hoursBefore(NOW, 37) });
    s = await status();
    assert.equal(s.instagram.lastCron.startedAt, hoursBefore(NOW, 37).toISOString());
    assert.equal(s.instagram.cronOverdue, true);
    await seedRunAt({ trigger: "cron", dryRun: false, startedAt: hoursBefore(NOW, 35) });
    assert.equal((await status()).instagram.cronOverdue, false);
  });
  test("cronOverdue ignores panel and CLI runs and cron dry runs", async () => {
    await seedRunAt({ trigger: "panel", dryRun: false, startedAt: hoursBefore(NOW, 1) });
    await seedRunAt({ trigger: "cli", dryRun: false, startedAt: hoursBefore(NOW, 1) });
    await seedRunAt({ trigger: "cron", dryRun: true, startedAt: hoursBefore(NOW, 1) });
    assert.equal((await status()).instagram.cronOverdue, true);
  });

  test("lease: held before locked_until, not held after it or when released", async () => {
    assert.deepEqual((await status()).instagram.lease, { held: false, lockedUntil: null });
    await db.pool.query(`insert into job_locks (name, locked_until) values ('instagram-sync', $1)`,
      [new Date(NOW.getTime() + 5 * 60_000)]);
    assert.deepEqual((await status()).instagram.lease, { held: true, lockedUntil: "2026-10-16T12:05:00.000Z" });
    await db.pool.query(`update job_locks set locked_until = $1`, [new Date(NOW.getTime() - 60_000)]);
    assert.deepEqual((await status()).instagram.lease, { held: false, lockedUntil: null });
    await db.pool.query(`update job_locks set locked_until = 'epoch'`);
    assert.deepEqual((await status()).instagram.lease, { held: false, lockedUntil: null });
  });

  test("a stale running row with an expired lease is shown as abandoned", async () => {
    const seedRunning = (trigger, minutesAgo) => db.pool.query(
      `insert into sync_runs (job, trigger, dry_run, status, started_at) values ('instagram', $1, false, 'running', $2)`,
      [trigger, new Date(NOW.getTime() - minutesAgo * 60_000)]);
    await seedRunning("cron", 20); // killed at maxDuration, so finishRun never ran; no job_locks row
    let s = await status();
    assert.equal(s.instagram.lastCron.status, "abandoned");
    assert.deepEqual(s.runs.map((r) => r.status), ["abandoned"]);
    assert.equal((await db.pool.query("select status from sync_runs")).rows[0].status, "running"); // read-time only
    await seedRunning("panel", 10); // 10 minutes is not stale yet
    assert.deepEqual((await status()).runs.map((r) => r.status), ["running", "abandoned"]);
    await db.pool.query(`insert into job_locks (name, locked_until) values ('instagram-sync', $1)`,
      [new Date(NOW.getTime() + 5 * 60_000)]);
    s = await status(); // while the run lease is held, a long run is still running
    assert.deepEqual(s.runs.map((r) => r.status), ["running", "running"]);
    assert.equal(s.instagram.lastCron.status, "running");
  });

  test("library bytes treat null asset_bytes as zero", async () => {
    assert.deepEqual((await status()).instagram.library, { posts: 0, files: 0, bytes: 0 });
    await seedPost("BBB", [null]); // an older /snapshots row without asset_bytes
    assert.deepEqual((await status()).instagram.library, { posts: 1, files: 1, bytes: 0 });
    await seedPost("AAA", [1000, 2500]);
    assert.deepEqual((await status()).instagram.library, { posts: 2, files: 3, bytes: 3500 });
  });

  test("uploads30d counts real uploads in 30 days and ignores dry runs", async () => {
    await seedRunAgo({ trigger: "cron", dryRun: false, ago: "1 day", uploads: 7 });
    await seedRunAgo({ trigger: "panel", dryRun: true, ago: "1 hour", uploads: 40 });
    await seedRunAgo({ trigger: "cli", dryRun: false, ago: "31 days", uploads: 3 });
    assert.equal((await status({ now: new Date() })).instagram.uploads30d, 7);
  });

  test("limits are the fixed D4 and Hobby values", async () => {
    assert.deepEqual((await status()).instagram.limits,
      { panelCeiling: 1000, cronCeiling: 1800, monthlyLimit: 2000, storageLimitBytes: 1_000_000_000 });
  });

  test("panel: all null when nothing limits a run", async () => {
    assert.deepEqual((await status({ now: new Date() })).instagram.panel,
      { nextCheckAt: null, nextImportAt: null, importBlockedReason: null });
  });
  test("panel: nextCheckAt and nextImportAt come from the D4 limits", async () => {
    await seedRunAgo({ trigger: "panel", dryRun: true, ago: "9 minutes" });
    await seedRunAgo({ trigger: "panel", dryRun: false, ago: "23 hours", uploads: 2 });
    const now = new Date();
    const p = (await status({ now })).instagram.panel;
    between(Date.parse(p.nextCheckAt) - now.getTime(), 55_000, 61_000);
    between(Date.parse(p.nextImportAt) - now.getTime(), 3_595_000, 3_601_000);
    assert.equal(p.importBlockedReason, "daily_limit");
  });
  test("panel: upload_ceiling when 30-day uploads reach 1,000", async () => {
    await seedRunAgo({ trigger: "cron", dryRun: false, ago: "2 days", uploads: 1000 });
    assert.equal((await status({ now: new Date() })).instagram.panel.importBlockedReason, "upload_ceiling");
  });
  test("panel: a held slot claim sets nextCheckAt and nextImportAt; a released one doesn't", async () => {
    // Claims from Task 14's claimPanelSlot whose runs have not written a sync_runs row yet.
    await db.pool.query(`insert into job_locks (name, locked_until) values
      ('instagram-panel-check', now() + interval '5 minutes'), ('instagram-panel-import', now() + interval '3 hours')`);
    const now = new Date();
    const p = (await status({ now })).instagram.panel;
    between(Date.parse(p.nextCheckAt) - now.getTime(), 295_000, 301_000);
    between(Date.parse(p.nextImportAt) - now.getTime(), 10_795_000, 10_801_000);
    assert.equal(p.importBlockedReason, "daily_limit");
    await db.pool.query(`update job_locks set locked_until = 'epoch' where name = 'instagram-panel-import'`);
    const released = (await status({ now: new Date() })).instagram.panel;
    assert.equal(released.nextImportAt, null);
    assert.equal(released.importBlockedReason, null);
  });

  test("runs and activity are JSON-safe, newest first", async () => {
    await seedSpotify();
    await seedInstagramToken({ expiresAt: new Date("2026-11-25T12:00:00Z"), refreshedAt: new Date("2026-09-26T05:00:00Z") });
    await seedRunAt({ trigger: "cron", dryRun: false, startedAt: hoursBefore(NOW, 30), uploads: 2 });
    await seedRunAt({ trigger: "panel", dryRun: true, startedAt: hoursBefore(NOW, 1) });
    await logAdminEvent("sign_in", { actor: OWNER_ACTOR, details: { note: "seed" } }, db.pool);
    const s = await status();
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s); // no Date objects, no undefined
    assert.equal(s.generatedAt, NOW.toISOString());
    assert.deepEqual(s.runs.map((r) => r.trigger), ["panel", "cron"]);
    assert.equal(s.runs[0].startedAt, hoursBefore(NOW, 1).toISOString());
    assert.equal(typeof s.runs[0].id, "number"); // bigint ids leave lib as numbers
    assert.equal(s.activity[0].event, "sign_in");
    assert.equal(s.activity[0].actor, OWNER_ACTOR);
    assert.equal(typeof s.activity[0].id, "number");
    assert.equal(typeof s.activity[0].at, "string");
  });

  test("refusedSignIns summarises the last 24 hours, and activity leaves refusals out", async () => {
    assert.deepEqual((await status()).refusedSignIns, { count24h: 0, latestAt: null, latestLogin: null });
    await logAdminEvent("sign_in", { actor: OWNER_ACTOR }, db.pool);
    await db.pool.query(`insert into admin_audit_log (event, actor, details, at) values
      ('sign_in_rejected', 'github:999', '{"githubId":"999","login":"intruder"}', now() - interval '2 hours'),
      ('sign_in_rejected', 'github:1000', '{"githubId":"1000","login":"other"}', now() - interval '30 minutes'),
      ('sign_in_rejected', 'github:1001', '{"githubId":"1001","login":"old"}', now() - interval '25 hours')`);
    const s = await status({ now: new Date() });
    assert.equal(s.refusedSignIns.count24h, 2);
    assert.equal(s.refusedSignIns.latestLogin, "other");
    assert.equal(typeof s.refusedSignIns.latestAt, "string");
    between(Date.now() - Date.parse(s.refusedSignIns.latestAt), 29 * 60_000, 31 * 60_000);
    assert.deepEqual(s.activity.map((e) => e.event), ["sign_in"]);
  });

  test("never returns or selects a token", async () => {
    await seedSpotify();
    await seedInstagramToken({ expiresAt: new Date("2026-11-25T12:00:00Z"), refreshedAt: new Date("2026-09-26T05:00:00Z") });
    const texts = [];
    const spy = { query: (q, p) => { texts.push(typeof q === "string" ? q : q.text); return db.pool.query(q, p); } };
    const env = { refresh_token: SECRETS.envRefresh };
    const withRow = JSON.stringify(await buildAdminStatus({ db: spy, env, now: NOW }));
    await db.pool.query(`delete from integration_tokens where provider = 'spotify'`);
    const envState = JSON.stringify(await buildAdminStatus({ db: spy, env, now: NOW }));
    assert.match(envState, /"state":"env"/);
    for (const secret of Object.values(SECRETS)) {
      assert.ok(!withRow.includes(secret) && !envState.includes(secret), `leaked ${secret}`);
    }
    assert.ok(texts.length > 0);
    for (const q of texts) assert.doesNotMatch(q, /access_token|refresh_token/);
  });
});
```

`tests/admin-status-route.test.mjs` (unit tests, no database). The first one pins Review Focus 1: when the database is unreachable, `buildAdminStatus` rejects, so the route answers 500 and `/admin` shows its "couldn't load" state. It must never resolve with a guessed state, such as `"env"` because the Spotify read failed.

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAdminStatus, createStatusHandler } from "../lib/admin/status.js";
import { fakeRes } from "./helpers/admin-fakes.mjs";

const OWNER = { userId: "user-1", name: "Kevin Wong", image: null, expiresAt: new Date() };

test("buildAdminStatus rejects when the database query fails", async () => {
  const down = { query: async () => { throw new Error("connect ECONNREFUSED 10.0.0.1:5432"); } };
  await assert.rejects(
    buildAdminStatus({ db: down, env: { refresh_token: "env-refresh" }, now: new Date("2026-10-16T12:00:00Z") }),
    { message: "connect ECONNREFUSED 10.0.0.1:5432" });
});
test("401 from requireAdmin passes through and status is not built", async () => {
  let built = 0;
  const handler = createStatusHandler({
    requireAdmin: async (req, res, opts) => { assert.equal(opts, undefined); res.status(401).json({ error: "unauthorized" }); return null; },
    buildAdminStatus: async () => { built += 1; return {}; } });
  const res = fakeRes();
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(built, 0);
});
test("405 with Allow: GET for POST", async () => {
  const handler = createStatusHandler({ requireAdmin: async () => OWNER, buildAdminStatus: async () => ({}) });
  const res = fakeRes();
  await handler({ method: "POST", headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, "GET");
  assert.deepEqual(res.body, { error: "method_not_allowed" });
});
test("200 with buildAdminStatus() called with no arguments", async () => {
  const args = [];
  const handler = createStatusHandler({ requireAdmin: async () => OWNER,
    buildAdminStatus: async (...a) => { args.push(a); return { generatedAt: "x" }; } });
  const res = fakeRes();
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { generatedAt: "x" });
  assert.deepEqual(args, [[]]);
});
test("500 status_failed without the error message, logged only redacted", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const handler = createStatusHandler({ requireAdmin: async () => OWNER,
    buildAdminStatus: async () => { throw new Error("connect postgres://kw:hunter2@db.example failed"); } });
  const res = fakeRes();
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: "status_failed" });
  const lines = logged.mock.calls.map((c) => c.arguments.map(String).join(" "));
  assert.ok(lines.some((l) => l.includes("postgres://[redacted]@db.example")), lines.join("\n"));
  assert.ok(lines.every((l) => !l.includes("hunter2")), lines.join("\n"));
});
```

- [ ] **Step 2: Run them to verify they fail**

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/integration/admin-status.test.mjs tests/admin-status-route.test.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` for `lib/admin/status.js` in both files, then `ℹ tests 2` and `ℹ fail 2`.

- [ ] **Step 3: Implement `buildAdminStatus` and `createStatusHandler` in `lib/admin/status.js`, and the route**

All imports use `.js`, as listed under Consumes. Every query, including those inside the consumed functions, gets the injected `db`. Run the independent reads with `Promise.all`, so any failed read rejects the whole status (never `allSettled`); the pool's `max: 3` just queues them.

Local helpers:
- `iso(v) = v == null ? null : new Date(v).toISOString()`, which accepts a `Date` or a string.
- `daysLeft(date, now) = Math.floor((date - now) / 86_400_000)`. It is not clamped, so it goes negative once expired.
- `toRunJson(run)`, which maps the Run fields with `Number(id)`, `iso()` for the two dates and `?? null` for everything else.
- Activity rows map to `{ id: Number(id), at: iso(at), event, actor: actor ?? null, details: details ?? {} }`.

Derivations the tests don't fully pin:
- **Spotify state.**
  - Row with `deadReason` set: `"dead"`. Row without one: `"connected"`.
  - No row and `env.refresh_token` set: `"env"`. Neither: `"missing"`. A failed read is neither: it rejects.
  - With no row, every other Spotify field is `null`.
  - `accountMatches` is `null` when `accountId` is null, otherwise `accountId === OWNER_SPOTIFY_ACCOUNT_ID`.
  - `missingScopes` is `missingScopes(row.scopes)`.
- **Instagram token.** A private query that never names the token column:
  `select expires_at, refreshed_at, expires_at_is_assumed, dead_reason from integration_tokens where provider = 'instagram'`.
- **Cron.**
  - `lastCron = lastRun({ trigger: "cron", dryRun: false }, db)`.
  - `cronOverdue = !lastCron || now - new Date(lastCron.startedAt) > 36 * 3_600_000`.
- **Lease.**
  - Query: `select locked_until from job_locks where name = 'instagram-sync'`.
  - `held = !!row && row.locked_until > now`.
  - `lockedUntil = held ? iso(row.locked_until) : null`.
- **Abandoned runs (read time only).** A run killed at `maxDuration` never reaches `finishRun`, so its row keeps `running` until the next `startRun` marks it `abandoned`. For a cron run that can be about 24 hours later. Until then the spec wants it shown as `abandoned`. In both `runs` and `lastCron`, report `status: "abandoned"` for a run with `status === "running"`, `now - startedAt > 15 * 60_000` and `!lease.held`. Everything else about the run is unchanged. 15 minutes is well past the routes' 300-second `maxDuration`, and a long CLI import renews the lease before every post, so it keeps `lease.held` true. Never write the stored row: Task 14's daily limit counts `running` and `abandoned` alike, and `startRun` keeps doing the real rewrite.
- **Library.** `select (select count(*) from instagram_posts)::int as posts, (select count(*) from instagram_media)::int as files, (select coalesce(sum(asset_bytes), 0) from instagram_media)::bigint as bytes`, then `Number(bytes)`. Postgres returns `bigint` as a string. `sum` skips null `asset_bytes`, and `count(*)` still counts those files.
- **Uploads.** `uploads30d = Number(await uploadsInLastDays(30, db))`.
- **Panel.** Call `checkPanelRunAllowed({ dryRun: true }, db)` and `checkPanelRunAllowed({ dryRun: false }, db)`. Also read Task 14's slot claims with `select name, locked_until from job_locks where name in ('instagram-panel-check', 'instagram-panel-import')`. A slot is held when its `locked_until > now`.
  - From the verdicts alone, `nextCheckAt` is `null` when the check is allowed. Otherwise it is `iso(now + retryAfterSeconds * 1000)`, and `nextImportAt` is worked out the same way.
  - A held slot also blocks its button until its `locked_until`, so each field is the later of the verdict's time and the held slot's `locked_until`. It is `null` only when neither applies. That covers a claim whose run hasn't written its `sync_runs` row yet.
  - `importBlockedReason` is the import verdict's `reason`. When the verdict allows the import but the import slot is held, it is `"daily_limit"`. Otherwise it is `null`.
- **Limits.** `{ panelCeiling: PANEL_UPLOAD_CEILING_30D, cronCeiling: UPLOAD_CEILING_30D, monthlyLimit: 2000, storageLimitBytes: 1_000_000_000 }`.
- **Activity and refused sign-ins.**
  - `activity` is `recentAdminEvents(20, db)`, mapped as above. Task 11 already leaves `sign_in_rejected` rows out, so refusals can't push real events out of the 20 rows.
  - `refusedSignIns` comes from `refusedSignInSummary(db)`: `{ count24h, latestAt: iso(latestAt), latestLogin: latestLogin ?? null }`. Task 17 shows it above the activity table.

`createStatusHandler` does these steps in order:
1. `const owner = await requireAdmin(req, res)`, with no options because this is not a mutation. If it returns null, return.
2. If `req.method !== "GET"`: `Allow: GET`, then 405 `{ error: "method_not_allowed" }`.
3. 200 with `await buildAdminStatus()`.
4. On a throw: `console.error("[admin/status] failed:", redact(error instanceof Error ? error.message : String(error)))` (as Task 17's `getServerSideProps` logs the same failure), then 500 `{ error: "status_failed" }`.

`pages/api/admin/status.js` imports `requireAdmin` from `../../../lib/admin/guard` and `buildAdminStatus, createStatusHandler` from `../../../lib/admin/status`, then `export const config = { api: { bodyParser: false } };` (nothing may answer before the 404 gate, D1, and the route never reads a body) and `const handler = createStatusHandler({ requireAdmin, buildAdminStatus }); export default handler;`.

- [ ] **Step 4: Run tests to verify they pass**

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/integration/admin-status.test.mjs tests/admin-status-route.test.mjs
npx eslint lib/admin/status.js pages/api/admin/status.js tests/integration/admin-status.test.mjs tests/admin-status-route.test.mjs
npm test
```

Expected:
- The focused run: `ℹ tests 27` (22 + 5), `ℹ pass 27`, `ℹ fail 0`, `ℹ cancelled 0`, and no `﹣` skip line.
- ESLint prints nothing.
- `npm test`: `ℹ fail 0` and `ℹ cancelled 0`.

- [ ] **Step 5: Commit**

```sh
git add lib/admin/status.js pages/api/admin/status.js tests/integration/admin-status.test.mjs tests/admin-status-route.test.mjs
git commit -m "Add the admin status endpoint"
```

---

### Task 16: `Meta` noindex and the sign-in page

**Model:** Sonnet
**Files:**
- Modify: `components/Meta.tsx` (`Meta`)
- Create: `lib/admin/client.js`, `lib/admin/messages.js`, `components/admin/api.ts`, `components/admin/AdminCard.tsx`, `components/admin/SignInPage.tsx`, `pages/admin/sign-in.tsx`
- Test: `tests/admin/client.test.mjs`, `tests/admin/messages.test.mjs`
- Temporary, never committed: `pages/sign-in-preview.tsx`

> **Skeleton correction:** the skeleton puts the POST helper in `components/admin/api.ts`. Node tests are `.mjs` and
> cannot import `.ts`, and the plan header pins `postJson reports 401 as signedOut` in `lib/admin/client.js`. So the
> helper lives in `lib/admin/client.js` (plain ESM, unit-tested here) and returns `{ ok, status, body, signedOut }`.
> `components/admin/api.ts` is only a typed wrapper around it. The test is written in this task, not Task 17, because
> the sign-in button is the first caller.

**Interfaces:**
- Consumes:
  - `lib/admin/guard.js` (Task 12): `isAdminEnabled(req, env = process.env): boolean`; `setNoStore(res): void`;
    `getOwnerSession(req, { auth = getAuth(), db = getDbPool() } = {}): Promise<null | { userId: string, name: string, image: string | null, expiresAt: Date }>`.
  - `pages/api/auth/[...all].js` (Task 12): forwards only `POST /api/auth/sign-in/social`, `GET /api/auth/callback/github`
    and `POST /api/auth/sign-out`. Everything else gets 404, and so does every path when `isAdminEnabled` is false.
  - `getAuth()` (Task 11): `onAPIError.errorURL: "/admin/sign-in"`; `validateOwner` rejects with `{ error: "not_owner" }`.
  - Better Auth 1.7.10 behaviour (source: `dist/` in the `better-auth@1.7.10` npm package):
    - `POST /sign-in/social` answers **200 JSON** `{ url, redirect: true }` (`api/routes/sign-in.mjs`, `signInSocial`).
      The `url` starts `https://github.com/login/oauth/authorize?`.
    - Every OAuth failure redirects to `/admin/sign-in?error=<code>&error_description=<text>`
      (`api/routes/callback.mjs` `redirectOnError`). Codes seen there:
      - `not_owner`
      - `access_denied` (GitHub's own cancel, passed straight through)
      - `state_mismatch`, `state_not_found`, `state_invalid` (`oauth2/state.mjs`)
      - `invalid_code`, `unable_to_get_user_info`, `account_not_linked`
- Produces (Task 17 relies on these):
  - `components/Meta.tsx`: `Meta(props: { title: string, ogImage?: string, ogDesc?: string, noindex?: boolean })`.
  - `lib/admin/client.js`:
    - `export async function postJson(url, body, { fetchImpl = fetch } = {}): Promise<{ ok: boolean, status: number, body: unknown, signedOut: boolean }>`
    - `export function githubAuthorizeUrl(body): string | null`
  - `lib/admin/messages.js`:
    - `export function errorCodeFromQuery(value: unknown): string | null`
    - `export function signInErrorMessage(code: string | null | undefined): string | null`
  - `components/admin/api.ts`:
    - `export type PostResult<T> = { ok: boolean; status: number; body: T | null; signedOut: boolean }`
    - `export function postJson<T>(url: string, body: unknown): Promise<PostResult<T>>` (a typed wrapper around
      `lib/admin/client.js`'s `postJson`, which `api.ts` imports as `postJsonRaw`)
    - `export function startGitHubSignIn(): Promise<PostResult<{ url?: unknown }>>`
  - `components/admin/AdminCard.tsx`: `export const AdminCard = (props: BoxProps) => JSX.Element`, the site's card look.
  - `components/admin/SignInPage.tsx`: `export const SignInPage = ({ error }: { error: string | null }) => JSX.Element`.

- [ ] **Step 1: Write the failing tests**

`tests/admin/client.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { githubAuthorizeUrl, postJson } from "../../lib/admin/client.js";

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("postJson sends a same-origin JSON POST", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push([url, init]); return jsonResponse(200, {}); };
  await postJson("/api/admin/instagram/sync", { dryRun: true }, { fetchImpl });
  assert.equal(calls.length, 1);
  const [url, init] = calls[0];
  assert.equal(url, "/api/admin/instagram/sync");
  assert.equal(init.method, "POST");
  assert.equal(init.headers["content-type"], "application/json");
  assert.equal(init.body, '{"dryRun":true}');
  assert.equal(init.credentials, "same-origin");
  assert.equal(init.cache, "no-store");
});

test("postJson returns ok, status and the parsed body", async () => {
  const result = await postJson("/x", {}, { fetchImpl: async () => jsonResponse(200, { status: "ok" }) });
  assert.deepEqual(result, { ok: true, status: 200, body: { status: "ok" }, signedOut: false });
});

test("postJson reports 401 as signedOut", async () => {
  const result = await postJson("/x", {}, { fetchImpl: async () => jsonResponse(401, { error: "unauthorized" }) });
  assert.deepEqual(result, { ok: false, status: 401, body: { error: "unauthorized" }, signedOut: true });
});

test("postJson keeps a 429 body for the refusal message", async () => {
  const body = { error: "too_soon", retryAfterSeconds: 420 };
  const result = await postJson("/x", {}, { fetchImpl: async () => jsonResponse(429, body) });
  assert.deepEqual(result, { ok: false, status: 429, body, signedOut: false });
});

test("postJson returns a null body for a non-JSON response", async () => {
  const fetchImpl = async () => new Response("<!DOCTYPE html>", { status: 404, headers: { "content-type": "text/html" } });
  assert.deepEqual(await postJson("/x", {}, { fetchImpl }), { ok: false, status: 404, body: null, signedOut: false });
});

test("postJson returns a null body when the JSON is malformed", async () => {
  const fetchImpl = async () => new Response("{oops", { status: 500, headers: { "content-type": "application/json" } });
  assert.deepEqual(await postJson("/x", {}, { fetchImpl }), { ok: false, status: 500, body: null, signedOut: false });
});

test("postJson reports a network failure as status 0", async () => {
  const fetchImpl = async () => { throw new TypeError("Failed to fetch"); };
  assert.deepEqual(await postJson("/x", {}, { fetchImpl }), { ok: false, status: 0, body: null, signedOut: false });
});

test("githubAuthorizeUrl accepts only GitHub's authorize endpoint", () => {
  const good = "https://github.com/login/oauth/authorize?response_type=code&client_id=abc&state=xyz";
  assert.equal(githubAuthorizeUrl({ url: good, redirect: true }), good);
  assert.equal(githubAuthorizeUrl({ url: "https://github.com.evil.example/login/oauth/authorize?x=1" }), null);
  assert.equal(githubAuthorizeUrl({ url: "https://evil.example/?u=https://github.com/login/oauth/authorize?" }), null);
  assert.equal(githubAuthorizeUrl({ url: "/admin" }), null);
  assert.equal(githubAuthorizeUrl({ url: 42 }), null);
  assert.equal(githubAuthorizeUrl(null), null);
});
```

`tests/admin/messages.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { errorCodeFromQuery, signInErrorMessage } from "../../lib/admin/messages.js";

test("errorCodeFromQuery keeps only short lowercase codes", () => {
  assert.equal(errorCodeFromQuery("not_owner"), "not_owner");
  assert.equal(errorCodeFromQuery(undefined), null);
  assert.equal(errorCodeFromQuery(""), null);
  assert.equal(errorCodeFromQuery(["not_owner", "x"]), null);
  assert.equal(errorCodeFromQuery("Call 555-0100 to restore access"), null);
  assert.equal(errorCodeFromQuery("a".repeat(65)), null);
});

test("signInErrorMessage maps codes to plain messages", () => {
  assert.equal(signInErrorMessage(null), null);
  assert.equal(signInErrorMessage(undefined), null);
  assert.equal(signInErrorMessage("not_owner"), "That GitHub account can't sign in here.");
  assert.equal(signInErrorMessage("access_denied"), "GitHub sign-in was cancelled.");
  for (const code of ["state_mismatch", "state_not_found", "state_invalid"]) {
    assert.equal(signInErrorMessage(code), "That sign-in attempt expired. Try again.");
  }
  assert.equal(signInErrorMessage("rate_limited"), "Too many sign-in attempts. Wait a minute and try again.");
  assert.equal(signInErrorMessage("start_failed"), "Couldn't start GitHub sign-in. Try again in a minute.");
});

test("signInErrorMessage falls back for other codes and never echoes them", () => {
  assert.equal(signInErrorMessage("invalid_code"), "Sign-in didn't work. Try again.");
  assert.equal(signInErrorMessage("account_not_linked"), "Sign-in didn't work. Try again.");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/admin/client.test.mjs tests/admin/messages.test.mjs`
Expected: both files fail with `ERR_MODULE_NOT_FOUND` for `lib/admin/client.js` and `lib/admin/messages.js`, and `ℹ fail 2`.

- [ ] **Step 3: Implement `lib/admin/client.js` and `lib/admin/messages.js`**

Both files are plain ESM with no imports, so client components can use them. Do not import anything under `lib/`
that reaches `lib/db.js` or `lib/auth.js`. Give every export a JSDoc `@param`/`@returns` with the types in the
Interfaces block. TypeScript reads JSDoc in `.js` files under `allowJs`, which is how the TSX callers get real types.

`postJson(url, body, { fetchImpl = fetch } = {})`:
- Calls `fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin", cache: "no-store" })`.
- Call `fetchImpl` as a plain function, never as a method such as `options.fetchImpl(...)`. A detached `window.fetch`
  called with another `this` throws "Illegal invocation". The default is evaluated per call, so it picks up the
  current global `fetch`.
- Reads the body with `res.json()` only when `content-type` includes `json`; a parse error gives `body: null`.
- A thrown `fetchImpl` gives `{ ok: false, status: 0, body: null, signedOut: false }`.
- Sets `signedOut` to `res.status === 401`.

`githubAuthorizeUrl(body)`: returns `body.url` when it is a string that starts with
`"https://github.com/login/oauth/authorize?"`, else `null`.

`errorCodeFromQuery(value)`: returns `value` when it is a string matching `/^[a-z0-9_]{1,64}$/`, else `null`. It guards
both `?error=` here and `?spotify_error=` in Task 17, so a crafted query never reaches the page as text.

`signInErrorMessage(code)` uses exactly the strings in the tests, from one lookup object plus the fallback
`"Sign-in didn't work. Try again."`. `rate_limited` and `start_failed` are client-side codes for a failed start.
Nothing ever renders the raw code or `error_description`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/admin/client.test.mjs tests/admin/messages.test.mjs`
Expected: `ℹ tests 11`, `ℹ fail 0`.

- [ ] **Step 5: Add `noindex` to `Meta` in `components/Meta.tsx`**

Add `noindex?: boolean` to the props. Keep `useRouter()` unconditional (rules of hooks). When `noindex` is set, the
`<Head>` holds only these, with no canonical, no `og:*` and no `twitter:*`:
- `<title>`
- the description meta (`key="desc"`)
- `<meta name="robots" content="noindex, nofollow" key="robots" />`
- favicon, charset and viewport

When `noindex` is unset, the output is byte-for-byte what it is today. Wrap today's canonical through `twitter:title`
block, in its current order, in a fragment rendered only when `!props.noindex`. `next/head` flattens fragments
(`node_modules/next/dist/shared/lib/head.js`, "Adds support for React.Fragment"), so the `key` de-duplication still
works.

- [ ] **Step 6: Build the sign-in page**

`components/admin/AdminCard.tsx` (exact copy; the values are `TopTracks`'s card):

```tsx
import { Box, type BoxProps } from "@chakra-ui/react";

/** The site's card look (TopTracks, GitHubStats), shared by the admin pages. */
export const AdminCard = (props: BoxProps) => (
    <Box bg={{ base: "gray.100", _dark: "#111111" }} rounded={{ sm: "lg" }} shadow={{ md: "sm" }}
        p={{ base: "6", md: "8" }} height="auto" alignSelf="flex-start" w="full" {...props} />
);
```

`components/admin/api.ts` imports the plain helper under another name. Importing it as `postJson` while also exporting
a function called `postJson` fails `npx tsc --noEmit` with `TS2440` ("Import declaration conflicts with local
declaration"):

```ts
import { postJson as postJsonRaw } from "../../lib/admin/client";

export type PostResult<T> = { ok: boolean; status: number; body: T | null; signedOut: boolean };

export function postJson<T>(url: string, body: unknown): Promise<PostResult<T>> { return postJsonRaw(url, body) as Promise<PostResult<T>>; }
```

Then add:
- `startGitHubSignIn()`: `postJson("/api/auth/sign-in/social", { provider: "github", callbackURL: "/admin" })`.
  `callbackURL` must stay relative. Better Auth checks it against the trusted origins and accepts relative paths.

`components/admin/SignInPage.tsx`, `SignInPage({ error })`:
- Root: `<Box as="section" flex="1" p="6" overflow="auto">`.
  - `<Heading as="h1" size="2xl" mb="4">Admin</Heading>`.
  - `<AdminCard maxW="420px">` containing `<VStack align="stretch" gap="4">`.
- Card contents, in order:
  - `<Text>` with the JSX text `Only the site owner&apos;s GitHub account can sign in.`
  - When there is a message, `<Alert.Root status="error"><Alert.Indicator /><Alert.Title>{message}</Alert.Title></Alert.Root>`.
    The message is `startError ?? signInErrorMessage(error)`.
  - `<Button colorPalette="gray" onClick={start} loading={starting} loadingText="Opening GitHub…">` holding
    `<FiGithub /> Sign in with GitHub`. `FiGithub` comes from `react-icons/fi`.
- State: `starting` (boolean) and `startError` (string or null).
- `start()`:
  1. Set `starting` true and `startError` null.
  2. `const r = await startGitHubSignIn()`, then `const url = r.ok ? githubAuthorizeUrl(r.body) : null`.
  3. If `url` is set: `window.location.assign(url)` and return, leaving the spinner on while the browser leaves.
  4. Otherwise set `starting` false and set `startError` to `signInErrorMessage(r.status === 429 ? "rate_limited" : "start_failed")`.
- The lint rule `@next/next/no-location-assign-relative-destination` flags only static relative strings, so assigning
  the variable `url` is clean. Never write `<a href="/api/...">`, because `@next/next/no-html-link-for-pages` errors on
  API paths.
- Add a `pageshow` listener in a `useEffect` that sets `starting` to false when `event.persisted` is true. Without it,
  pressing Back from GitHub restores the page from the back/forward cache with the spinner still running. The setState
  sits inside the listener, not in the effect body, so `react-hooks/set-state-in-effect` stays quiet.

`pages/admin/sign-in.tsx` (exact gate order):

```tsx
import type { GetServerSideProps } from "next";
import { Meta } from "../../components/Meta";
import { PageShell } from "../../components/PageShell";
import { SignInPage } from "../../components/admin/SignInPage";
import { getOwnerSession, isAdminEnabled, setNoStore } from "../../lib/admin/guard";
import { errorCodeFromQuery } from "../../lib/admin/messages";

type Props = { error: string | null };

export const getServerSideProps = (async ({ req, res, query }) => {
    setNoStore(res);
    if (!isAdminEnabled(req)) return { notFound: true };
    if (await getOwnerSession(req)) return { redirect: { destination: "/admin", permanent: false } };
    return { props: { error: errorCodeFromQuery(query.error) } };
}) satisfies GetServerSideProps<Props>;

export default function AdminSignIn({ error }: Props) {
    return (
        <>
            <Meta title="Sign in • Kevin Wong" noindex />
            <PageShell>
                <SignInPage error={error} />
            </PageShell>
        </>
    );
}
```

`guard` and `errorCodeFromQuery` are used only inside `getServerSideProps`, so Next strips them, along with `pg` and
`better-auth`, from the client bundle. Step 7 checks that.

- [ ] **Step 7: Verify lint, types, build and the client bundle**

Run, in order:
1. `npm test`. Expected: `ℹ fail 0` and `ℹ cancelled 0`.
2. `npx eslint .`. Expected: no output, exit 0. Warnings count as a failure here, because the baseline is silent.
3. `npm run build`. Expected: `✓ Compiled successfully`, and the route list marks `/admin/sign-in` with `ƒ` (Dynamic).
4. `npx tsc --noEmit`. Expected: no output. The build has just regenerated `next-env.d.ts`.
5. `grep -rlE "auth_account|BETTER_AUTH_URL|integration_tokens" .next/static || echo clean`. Expected: `clean`. Any
   hit means server code reached a browser chunk.

- [ ] **Step 8: Look at it locally without enabling admin**

The admin routes return 404 everywhere except production on `www.kevinwong.co` (D1), so `/admin/sign-in` cannot be
viewed locally. Render the component from a temporary page instead. Never commit this file.

`pages/sign-in-preview.tsx`:

```tsx
// TEMPORARY local preview: /admin/* 404s outside production (D1). Delete before committing.
import { useRouter } from "next/router";
import { Meta } from "../components/Meta";
import { PageShell } from "../components/PageShell";
import { SignInPage } from "../components/admin/SignInPage";

export const getServerSideProps = async () => ({ props: {} }); // so `query` is filled on the first render

export default function SignInPreview() {
    const { query } = useRouter();
    return (
        <>
            <Meta title="Sign in preview • Kevin Wong" noindex />
            <PageShell><SignInPage error={typeof query.error === "string" ? query.error : null} /></PageShell>
        </>
    );
}
```

Run `npm run dev`. The worktree has no `.env`, so the dev server never reaches the production database (the sidebar's
Spotify widgets degrade, and the preview needs no env). Then, in a second terminal:
- `curl -s http://localhost:3000/sign-in-preview | grep -c 'name="robots" content="noindex, nofollow"'` → `1`
- `curl -s http://localhost:3000/sign-in-preview | grep -cE 'rel="canonical"|property="og:'` → `0`
- `curl -s http://localhost:3000/stats | grep -c 'rel="canonical"'` → `1` (public pages unchanged)
- `curl -s http://localhost:3000/stats | grep -c 'name="robots"'` → `0`
- `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/admin/sign-in` → `404`

In the browser:
- `http://localhost:3000/sign-in-preview?error=not_owner` shows "That GitHub account can't sign in here."
- `?error=whatever` shows "Sign-in didn't work. Try again."
- Pressing the button with no query: `/api/auth/*` returns 404 locally, so the button spins briefly, then shows
  "Couldn't start GitHub sign-in. Try again in a minute."
- Check light mode, dark mode and a 375 px wide window: no horizontal page scroll.

Then stop the dev server, run `rm pages/sign-in-preview.tsx`, and confirm `git status --short pages` lists only
`pages/admin/`.

- [ ] **Step 9: Commit**

```bash
test ! -e pages/sign-in-preview.tsx
git add components/Meta.tsx lib/admin/client.js lib/admin/messages.js components/admin/api.ts \
  components/admin/AdminCard.tsx components/admin/SignInPage.tsx pages/admin/sign-in.tsx \
  tests/admin/client.test.mjs tests/admin/messages.test.mjs
git commit -m "Add the admin sign-in page and a noindex option for Meta"
```

- [ ] **Step 10: Kevin: sign-in page checks during Task 18's Deploy B checks**

Task 18 owns the Deploy B checks. Do these alongside them:
1. Before signing in, open `https://www.kevinwong.co/admin/sign-in` in a private window. The card and the
   "Sign in with GitHub" button show.
2. Run `curl -s https://www.kevinwong.co/admin/sign-in | grep -cE 'rel="canonical"|property="og:'`. Expect `0`.
3. Run `curl -s https://www.kevinwong.co/admin/sign-in | grep -c 'noindex, nofollow'`. Expect `1`.
4. When Task 18 checks that preview URLs 404, also open `/admin/sign-in` on that preview URL. Expect the 404 page.
5. After Task 18's sign-in as yourself, open `/admin/sign-in`. It redirects to `/admin`.
6. During Task 18's second-account check, the page reads "That GitHub account can't sign in here."

---

### Task 17: Dashboard page and components

**Model:** Sonnet (Opus if it fails review twice)
**Files:**
- Create:
  - `pages/admin/index.tsx`
  - `components/admin/AdminPage.tsx`, `SpotifyCard.tsx`, `InstagramCard.tsx`, `RunsTable.tsx`, `ActivityLog.tsx`
  - `components/admin/types.ts`
  - `lib/admin/format.js`
- Modify:
  - `components/admin/api.ts` (add `runInstagramSync`, `signOut`)
  - `lib/admin/messages.js` (add the dashboard messages)
- Test: `tests/admin/format.test.mjs`, `tests/admin/dashboard-messages.test.mjs`
- Temporary, never committed: `pages/admin-preview.tsx`

> **Skeleton correction:** the brief says `location.assign("/admin/sign-in")` after a 401 and after sign-out.
> `@next/next/no-location-assign-relative-destination` (warn) flags every static relative string passed to
> `location.assign` (`node_modules/@next/eslint-plugin-next/dist/rules/no-location-assign-relative-destination.js`,
> `isRelativeUrl`), and the lint baseline is silent. Use `router.replace("/admin/sign-in")` from `next/router`. It
> runs that page's `getServerSideProps`, so the session check happens on the server either way.

> **Skeleton correction:** `initialStatus` is `AdminStatus | null`. It is null when `buildAdminStatus()` throws, and the
> page then renders a "Couldn't load the status" state instead of a 500. This is the plan header's Review Focus 1.
> A failure in `getOwnerSession` still throws: if ownership can't be confirmed, the page must not render.

**Interfaces:**
- Consumes:
  - Task 12, `lib/admin/guard.js`: `isAdminEnabled(req)`, `setNoStore(res)`, and `getOwnerSession(req)`, which
    resolves to `null | { userId, name, image, expiresAt }`.
  - Task 4: `redact(value: unknown): unknown` from `lib/redact.js`.
  - Task 7, `lib/admin/owner.js`: `OWNER_GITHUB_LOGIN = "dotKevinWong"` (constants only, no imports).
  - Task 11, `lib/admin/audit-log.js`: `ADMIN_EVENTS`, the seven event names `AdminEvent` and `activityLabel` cover.
    `logAdminEvent` stores `redact(details)`, so `activity[].details` arrive redacted.
  - Task 15, `buildAdminStatus({ db, env, now } = {})` from `lib/admin/status.js`. It returns the JSON that `types.ts`
    below mirrors field for field. Every id, `library.bytes` and `uploads30d` is a JSON number.
    - `activity` comes from `recentAdminEvents(20)`, which leaves out `sign_in_rejected` rows.
    - Refusals arrive separately as `refusedSignIns: { count24h: number, latestAt: string | null, latestLogin: string | null }`
      (from Task 11's `refusedSignInSummary`).
  - Task 15, `GET /api/admin/status`: 200 with the same JSON, 401 `{ error: "unauthorized" }`, 404 when not enabled,
    500 `{ error: "status_failed" }`.
  - Task 14, `POST /api/admin/instagram/sync` with body `{ dryRun: boolean }`:
    - 200 `SyncResult`
    - 429 `{ error: "too_soon" | "daily_limit" | "upload_ceiling", retryAfterSeconds }`
    - 503 `{ error: "instagram_reauth_required" }`
    - 500 `{ error: "sync_failed" }`
    - 400 `{ error: "bad_request" }`, 403 `{ error: "bad_origin" }`, 401
  - Task 13, the Spotify reconnect:
    - `POST /api/admin/spotify/authorize` is reached by a form POST. It redirects to Spotify, or straight back to
      `/admin?spotify_error=not_configured`.
    - Spotify then returns to `GET /api/admin/spotify/callback`, which redirects to `/admin?spotify=connected`, or to
      `/admin?spotify_error=` one of `denied`, `state_mismatch`, `not_configured`, `exchange_failed`, `missing_scopes`,
      `account_lookup_failed`, `wrong_account`, `save_failed`.
    - With no owner session (it lapsed before the form posted, or during the Spotify round trip), both reconnect
      routes answer `303` to `/admin/sign-in`, not a JSON 401, because the form POST and Spotify's callback GET are
      top-level navigations. Nothing on the dashboard has to handle that case.
  - Task 16:
    - `Meta` `noindex`, `AdminCard`.
    - `postJson`, `PostResult<T>` (in `api.ts`).
    - `errorCodeFromQuery`.
  - `lib/fetcher.js` (audit): its default export throws an `Error` carrying a numeric `.status` on any non-2xx.
- Produces:
  - `lib/admin/format.js`:
    - `daysLeftLabel(daysLeft, { estimated = false } = {})`
    - `formatBytes(bytes)`, `formatCount(n)`
    - `formatTimestamp(iso)`, `formatDate(iso)`
    - `formatDuration(seconds)`
    - `percentOf(value, max)`, `daysBetween(fromIso, toIso)`
  - `lib/admin/messages.js` gains:
    - `flashFromQuery(query)`, `spotifyFlashMessage(flash)`
    - `spotifyBadge(state)`, `runStatusBadge(status)`
    - `syncErrorMessage(result)`, `checkResultMessage(body)`, `importResultMessage(body)`
    - `importConfirmText(check, instagram)`, `panelAvailability(panel, generatedAt, limits)`
    - `activityLabel(event)`, `detailsSummary(details)`
  - The **Kevin:** dashboard checks (Step 10), done during Task 18's Deploy B checks.

- [ ] **Step 1: Write the failing tests**

`tests/admin/format.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { daysBetween, daysLeftLabel, formatBytes, formatCount, formatDate, formatDuration, formatTimestamp, percentOf }
  from "../../lib/admin/format.js";

test("daysLeftLabel counts down and never shows a negative day count", () => {
  assert.equal(daysLeftLabel(37, { estimated: true }), "37 days left (estimated)");
  assert.equal(daysLeftLabel(1, { estimated: true }), "1 day left (estimated)");
  assert.equal(daysLeftLabel(0, { estimated: true }), "Expires today (estimated)");
  assert.equal(daysLeftLabel(-3, { estimated: true }), "Past the estimated date");
  assert.equal(daysLeftLabel(12), "12 days left");
  assert.equal(daysLeftLabel(-3), "Expired");
  assert.equal(daysLeftLabel(null), "Unknown");
});

test("formatBytes uses decimal units to match the 1 GB store", () => {
  const cases = [[0, "0 B"], [999, "999 B"], [1_500, "1.5 kB"], [1_000_000, "1 MB"], [12_345_678, "12 MB"],
    [734_003_200, "734 MB"], [999_499_999, "999 MB"], [999_999_999, "1 GB"], [1_000_000_000, "1 GB"]];
  for (const [bytes, label] of cases) assert.equal(formatBytes(bytes), label, `formatBytes(${bytes})`);
});

test("formatCount groups thousands", () => {
  assert.equal(formatCount(2000), "2,000");
  assert.equal(formatCount(0), "0");
});

test("formatTimestamp and formatDate render UTC whatever the machine's zone", () => {
  assert.equal(formatTimestamp("2026-10-16T08:27:45.123Z"), "Oct 16, 2026, 08:27 UTC");
  assert.equal(formatTimestamp("2026-01-05T00:03:00.000Z"), "Jan 5, 2026, 00:03 UTC");
  assert.equal(formatTimestamp(null), "Never");
  assert.equal(formatDate("2026-10-16T23:59:59.000Z"), "Oct 16, 2026");
  assert.equal(formatDate(null), "Unknown");
});

test("formatDuration rounds up to minutes, then hours, then days", () => {
  const cases = [[0, "1 minute"], [30, "1 minute"], [61, "2 minutes"], [420, "7 minutes"], [3_600, "1 hour"],
    [5_400, "1 hour 30 minutes"], [50_400, "14 hours"], [86_399, "24 hours"], [172_800, "2 days"], [259_200, "3 days"]];
  for (const [seconds, label] of cases) assert.equal(formatDuration(seconds), label, `formatDuration(${seconds})`);
});

test("percentOf clamps to 0..100 and survives a zero max", () => {
  assert.equal(percentOf(500, 2000), 25);
  assert.equal(percentOf(2500, 2000), 100);
  assert.equal(percentOf(-3, 180), 0);
  assert.equal(percentOf(5, 0), 0);
});

test("daysBetween counts whole days", () => {
  assert.equal(daysBetween("2026-10-16T09:00:00.000Z", "2027-04-14T09:00:00.000Z"), 180);
  assert.equal(daysBetween(null, "2027-04-14T09:00:00.000Z"), null);
});
```

`tests/admin/dashboard-messages.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { activityLabel, checkResultMessage, detailsSummary, flashFromQuery, importConfirmText, importResultMessage,
  panelAvailability, runStatusBadge, spotifyBadge, spotifyFlashMessage, syncErrorMessage } from "../../lib/admin/messages.js";

const limits = { panelCeiling: 1000, cronCeiling: 1800, monthlyLimit: 2000, storageLimitBytes: 1_000_000_000 };
const post = (shortcode, mediaCount) => ({ shortcode, postedAt: "2026-10-15T18:00:00.000Z", mediaCount });
const sync = (over) => ({ status: "ok", fetched: 14, alreadyPresent: 11, posts: [], uploads: 0, deferred: 0, errorCount: 0, ...over });
const failed = (status, body) => ({ ok: false, status, body, signedOut: false });

test("flashFromQuery reads only the two reconnect results", () => {
  assert.deepEqual(flashFromQuery({ spotify: "connected" }), { spotify: "connected", spotifyError: null });
  assert.deepEqual(flashFromQuery({ spotify_error: "wrong_account" }), { spotify: null, spotifyError: "wrong_account" });
  assert.deepEqual(flashFromQuery({ spotify: "yes", spotify_error: "<b>hi</b>" }), { spotify: null, spotifyError: null });
  assert.deepEqual(flashFromQuery({}), { spotify: null, spotifyError: null });
});

test("spotifyFlashMessage explains each reconnect result", () => {
  assert.deepEqual(spotifyFlashMessage({ spotify: "connected", spotifyError: null }),
    { status: "success", title: "Spotify reconnected", description: "The new token takes effect everywhere within a minute." });
  const cases = {
    denied: "Spotify approval was cancelled. Nothing changed.",
    state_mismatch: "The reconnect expired or started in another tab. Nothing changed. Press Reconnect again.",
    not_configured: "The server has no Spotify client credentials. Nothing changed. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in Vercel, redeploy, then reconnect.",
    exchange_failed: "Spotify didn't accept the approval. Nothing changed. Try again.",
    missing_scopes: "Spotify didn't grant all three permissions. Nothing changed. Reconnect and approve every permission.",
    account_lookup_failed: "Couldn't read the Spotify account. Nothing changed. Try again.",
    wrong_account: "That isn't the site's Spotify account. Nothing changed. Sign in to Spotify as the right account, then reconnect.",
    save_failed: "Spotify approved, but saving the new token failed. Nothing changed. Try again.",
    something_new: "Reconnecting failed. Nothing changed. Try again.",
  };
  for (const [code, description] of Object.entries(cases)) {
    assert.deepEqual(spotifyFlashMessage({ spotify: null, spotifyError: code }), { status: "error", title: "Spotify not reconnected", description });
  }
  assert.equal(spotifyFlashMessage({ spotify: null, spotifyError: null }), null);
});

test("spotifyBadge labels each state", () => {
  assert.deepEqual(spotifyBadge("connected"), { label: "Connected", colorPalette: "green" });
  assert.deepEqual(spotifyBadge("dead"), { label: "Needs reconnect", colorPalette: "red" });
  assert.deepEqual(spotifyBadge("env"), { label: "Using env var", colorPalette: "orange" });
  assert.deepEqual(spotifyBadge("missing"), { label: "Not connected", colorPalette: "gray" });
});

test("runStatusBadge colors every sync_runs status", () => {
  const expected = { running: ["Running", "blue"], ok: ["OK", "green"], partial: ["Partial", "orange"], skipped: ["Skipped", "gray"],
    failed: ["Failed", "red"], reauth_required: ["Token rejected", "red"], abandoned: ["Abandoned", "orange"] };
  for (const [status, [label, colorPalette]] of Object.entries(expected)) assert.deepEqual(runStatusBadge(status), { label, colorPalette });
  assert.deepEqual(runStatusBadge("mystery"), { label: "mystery", colorPalette: "gray" });
});

test("syncErrorMessage turns refusals into a reason and a retry time", () => {
  assert.equal(syncErrorMessage(failed(429, { error: "too_soon", retryAfterSeconds: 420 })),
    "A check already ran in the last 10 minutes. Try again in 7 minutes.");
  assert.equal(syncErrorMessage(failed(429, { error: "daily_limit", retryAfterSeconds: 50_400 })),
    "An import already ran in the last 24 hours. Try again in 14 hours.");
  assert.equal(syncErrorMessage(failed(429, { error: "upload_ceiling", retryAfterSeconds: 259_200 })),
    "Uploads in the last 30 days reached the panel's limit of 1,000. Try again in 3 days.");
  assert.equal(syncErrorMessage(failed(429, { error: "upload_ceiling" })),
    "Uploads in the last 30 days reached the panel's limit of 1,000.");
  assert.equal(syncErrorMessage(failed(503, { error: "instagram_reauth_required" })),
    "Instagram rejected the token, so nothing ran. Issue a new token as the README's Instagram section describes.");
  assert.equal(syncErrorMessage(failed(403, { error: "bad_origin" })),
    "The server refused this page's origin. Reload the page and try again.");
  assert.equal(syncErrorMessage(failed(0, null)), "Couldn't reach the server. Check the connection and try again.");
  assert.equal(syncErrorMessage(failed(500, null)), "The run failed (HTTP 500). The runs table has the details.");
});

test("checkResultMessage and importResultMessage summarise a run", () => {
  assert.equal(checkResultMessage(sync({})), "No new posts. Nothing to import.");
  assert.equal(checkResultMessage(sync({ posts: [post("A1", 3), post("B2", 1)], uploads: 4 })),
    "Found 2 new posts with 4 files to upload.");
  assert.equal(checkResultMessage(sync({ posts: [post("A1", 3)], uploads: 3, deferred: 5, errorCount: 1 })),
    "Found 1 new post with 3 files to upload. 5 more posts wait for a later run. 1 error; see the runs table.");
  assert.equal(importResultMessage(sync({ posts: [post("A1", 3), post("B2", 1)], uploads: 4 })), "Imported 2 posts (4 file uploads).");
  assert.equal(importResultMessage(sync({ status: "partial", posts: [post("A1", 3)], uploads: 3, errorCount: 2 })),
    "Imported 1 post (3 file uploads). 2 errors; see the runs table.");
  assert.equal(importResultMessage(sync({ status: "skipped" })),
    "Nothing was imported: another sync held the lease, or the 30-day upload ceiling was reached. The runs table has the details.");
});

test("importConfirmText states the post and upload counts", () => {
  const check = sync({ posts: [post("A1", 3), post("B2", 1)], uploads: 4 });
  assert.equal(importConfirmText(check, { uploads30d: 120, limits }),
    "Import 2 posts and upload 4 files to Blob? That brings uploads in the last 30 days to 124 of 2,000. The panel allows one import per 24 hours.");
});

test("panelAvailability compares the limits with the status's own clock", () => {
  const at = "2026-10-16T12:00:00.000Z";
  const free = { nextCheckAt: null, nextImportAt: null, importBlockedReason: null };
  assert.deepEqual(panelAvailability(free, at, limits), { canCheck: true, checkHint: null, canImport: true, importHint: null });
  assert.deepEqual(panelAvailability({ ...free, nextCheckAt: "2026-10-16T12:07:00.000Z" }, at, limits),
    { canCheck: false, checkHint: "Next check available Oct 16, 2026, 12:07 UTC.", canImport: true, importHint: null });
  assert.equal(panelAvailability({ ...free, nextCheckAt: "2026-10-16T11:59:00.000Z" }, at, limits).canCheck, true);
  assert.deepEqual(panelAvailability({ ...free, importBlockedReason: "daily_limit", nextImportAt: "2026-10-17T09:30:00.000Z" }, at, limits),
    { canCheck: true, checkHint: null, canImport: false,
      importHint: "The panel allows one import per 24 hours. Next import available Oct 17, 2026, 09:30 UTC." });
  assert.deepEqual(panelAvailability({ ...free, importBlockedReason: "upload_ceiling" }, at, limits),
    { canCheck: true, checkHint: null, canImport: false,
      importHint: "Uploads in the last 30 days reached 1,000, the panel's limit. The daily sync keeps importing up to 1,800." });
});

test("activityLabel and detailsSummary describe audit rows", () => {
  const labels = { sign_in: "Signed in", sign_in_rejected: "Sign-in refused", spotify_connected: "Spotify reconnected",
    spotify_connect_failed: "Spotify reconnect failed", instagram_check: "Checked for new posts",
    instagram_import: "Imported posts", panel_run_refused: "Run refused" };
  for (const [event, label] of Object.entries(labels)) assert.equal(activityLabel(event), label);
  assert.equal(activityLabel("unknown_event"), "unknown_event");
  assert.equal(detailsSummary({ code: "wrong_account" }), "code: wrong_account");
  assert.equal(detailsSummary({ login: "someone", githubId: 42, nested: { a: 1 }, list: [1], gone: null, ok: true }),
    "login: someone, githubId: 42, ok: true");
  const long = detailsSummary({ reason: "x".repeat(300) });
  assert.equal(long.length, 120);
  assert.ok(long.endsWith("…"));
  assert.equal(detailsSummary(null), "");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/admin/format.test.mjs tests/admin/dashboard-messages.test.mjs`
Expected: `format.test.mjs` fails with `ERR_MODULE_NOT_FOUND`. `dashboard-messages.test.mjs` fails with
`SyntaxError: The requested module '../../lib/admin/messages.js' does not provide an export named 'activityLabel'`.
The summary shows `ℹ fail 2`.

- [ ] **Step 3: Implement `lib/admin/format.js` and the new exports in `lib/admin/messages.js`**

Both stay import-free apart from `messages.js` importing `./format.js` (with the extension). Every export gets JSDoc
types, as in Task 16. These `@returns` must be literal unions so the TSX type-checks:
- `spotifyBadge` and `runStatusBadge`:
  `@returns {{ label: string, colorPalette: "green" | "red" | "orange" | "gray" | "blue" }}`
- `flashFromQuery`: `@returns {{ spotify: "connected" | null, spotifyError: string | null }}`
- `spotifyFlashMessage`, so the TSX gets `status` as the literal union `"success" | "error"` that Chakra's
  `Alert.Root` `status` prop accepts:

  ```js
  /**
   * @param {{ spotify: "connected" | null, spotifyError: string | null }} flash
   * @returns {{ status: "success" | "error", title: string, description: string } | null}
   */
  ```

  Without it TypeScript infers `status: string`, and Step 7's `npx tsc --noEmit` fails with `TS2322` at the
  `Alert.Root` `status` prop.

`format.js`:
- `formatTimestamp(iso)` uses a module-level
  `new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })`
  plus `" UTC"`. Null gives `"Never"`.
- `formatDate(iso)` uses the same options without hour and minute. Null gives `"Unknown"`.
- The explicit zone and locale keep the Vercel render (UTC) and Kevin's browser (Eastern) identical, so hydration never
  sees a mismatch.
- `formatCount` (`Intl.NumberFormat("en-US")`), `percentOf`, `daysBetween` (rounded whole days) and `daysLeftLabel` are
  pinned by the tests.
- `formatBytes` (the rounding is the part the tests can't pin alone):

```js
const UNITS = ["B", "kB", "MB", "GB", "TB"];
export function formatBytes(bytes) {
  let value = bytes;
  let unit = 0;
  // Step up while the value would *display* as 1000 or more, so 999_999_999 reads "1 GB", not "1000 MB".
  while (unit < UNITS.length - 1 && Math.round(value * 10) / 10 >= 1000) { value /= 1000; unit += 1; }
  const shown = unit > 0 && value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${shown} ${UNITS[unit]}`;
}
```

- `formatDuration(seconds)`:
  1. `minutes = Math.max(1, Math.ceil(seconds / 60))`.
  2. Under 60 minutes: `"N minute(s)"`.
  3. Under 48 hours: `"H hour(s)"`, plus `" M minute(s)"` when M > 0.
  4. Otherwise: `"D day(s)"` with `D = Math.ceil(minutes / 1440)`.

`messages.js`:
- `flashFromQuery(query)`:
  - `spotify` is `"connected"` only when `query.spotify === "connected"`.
  - `spotifyError` is `errorCodeFromQuery(query.spotify_error)`.
- `spotifyFlashMessage(flash)`: one lookup object with a description for each of Task 13's eight error codes, plus the
  fallback for any other code. The code itself is never shown.
- `syncErrorMessage(result)`:
  - Switch on `result.status`, then on `result.body?.error`. An unknown body is never echoed.
  - For a 429, append `" Try again in " + formatDuration(retryAfterSeconds) + "."` only when `retryAfterSeconds > 0`.
  - The numbers 10 minutes, 24 hours and 1,000 mirror the D4 constants in `lib/admin/sync-limits.js`. That module
    imports the database pool, so a client component cannot import it. Say so in a one-line comment.
- `checkResultMessage(body)`, `importResultMessage(body)` and `importConfirmText(check, { uploads30d, limits })` produce
  exactly the test strings. Pluralise with a local `plural(n, word)` helper: `post`/`posts`, `file`/`files`,
  `error`/`errors`, and "1 more post waits" / "5 more posts wait".
- `panelAvailability(panel, generatedAt, limits)`:
  - `canCheck` is `!panel.nextCheckAt || Date.parse(panel.nextCheckAt) <= Date.parse(generatedAt)`.
  - `canImport` is `panel.importBlockedReason === null`.
  - The hints are the test strings. The `daily_limit` hint drops its second sentence when `nextImportAt` is null.
  - It compares against the status's own `generatedAt`, not `Date.now()`. That keeps render pure (`react-hooks/purity`)
    and identical on server and client.
- `detailsSummary` keeps only string, number and boolean values; the tests pin the rest. The details were redacted
  when written (Task 11), and React escapes them, so nothing else is needed.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/admin/format.test.mjs tests/admin/dashboard-messages.test.mjs`
Expected: `ℹ tests 16`, `ℹ fail 0`.

Then `TZ=Pacific/Kiritimati node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/admin/format.test.mjs`.
Expected: `ℹ tests 7`, `ℹ fail 0`. This proves the formatting ignores the machine's zone (UTC+14).

- [ ] **Step 5: Write `components/admin/types.ts` and extend `api.ts`**

`types.ts` is exact copy. It mirrors `buildAdminStatus()` (Task 15) and the Task 14 responses. Everything is JSON:
ISO strings, and `null`, never `undefined`.

```ts
export type SpotifyState = "connected" | "dead" | "env" | "missing";
export type RunStatus = "running" | "ok" | "partial" | "skipped" | "failed" | "reauth_required" | "abandoned";
export type Run = {
    id: number; trigger: "cron" | "panel" | "cli"; dryRun: boolean; status: RunStatus;
    startedAt: string; finishedAt: string | null;
    fetched: number; imported: number; uploads: number; deferred: number; skipped: number; errorCount: number;
    error: string | null;
};
export type AdminEvent = "sign_in" | "sign_in_rejected" | "spotify_connected" | "spotify_connect_failed"
    | "instagram_check" | "instagram_import" | "panel_run_refused";
export type AuditRow = { id: number; at: string; event: AdminEvent; actor: string | null; details: Record<string, unknown> };
export type AdminStatus = {
    generatedAt: string;
    spotify: {
        state: SpotifyState; authorizedAt: string | null; expiresAt: string | null;
        daysLeft: number | null; // floored whole days; negative once past expiresAt
        accountMatches: boolean | null;
        scopes: string[] | null; missingScopes: string[] | null; // null when there is no spotify row (Task 15)
        deadReason: string | null;
    };
    instagram: {
        token: null | { expiresAt: string; daysLeft: number; refreshedAt: string; expiresAtIsAssumed: boolean; deadReason: string | null };
        lastCron: Run | null;
        cronOverdue: boolean;
        lease: { held: boolean; lockedUntil: string | null }; // lockedUntil is null unless held
        library: { posts: number; files: number; bytes: number };
        uploads30d: number;
        limits: { panelCeiling: number; cronCeiling: number; monthlyLimit: number; storageLimitBytes: number };
        panel: { nextCheckAt: string | null; nextImportAt: string | null; importBlockedReason: "daily_limit" | "upload_ceiling" | null };
    };
    runs: Run[];
    activity: AuditRow[]; // the newest 20, never a sign_in_rejected row (those are counted in refusedSignIns)
    refusedSignIns: { count24h: number; latestAt: string | null; latestLogin: string | null };
};
export type SyncPost = { shortcode: string; postedAt: string; mediaCount: number };
export type SyncResult = {
    status: "ok" | "partial" | "skipped"; fetched: number; alreadyPresent: number; posts: SyncPost[];
    uploads: number; deferred: number; errorCount: number; blob?: string; resize?: string;
};
export type AdminOwner = { name: string; image: string | null; login: string };
export type AdminFlash = { spotify: "connected" | null; spotifyError: string | null };
export type AdminPageProps = { owner: AdminOwner; initialStatus: AdminStatus | null; flash: AdminFlash };
export type FetchError = Error & { status?: number };
```

Add to `api.ts`:
- `runInstagramSync(dryRun: boolean): Promise<PostResult<SyncResult>>`, which posts `{ dryRun }` to
  `/api/admin/instagram/sync` through the file's own `postJson<SyncResult>`.
- `signOut(): Promise<PostResult<{ success: boolean }>>`, which posts `{}` to `/api/auth/sign-out` through
  `postJson<{ success: boolean }>`. Better Auth's router
  accepts only `application/json` bodies, and its origin check passes because a same-origin fetch POST sends `Origin`.

- [ ] **Step 6: Build the page and the components**

Shared rules for every component:
- Named exports. `AdminCard` for each card. Muted text uses `color="fg.muted"`; inline errors use `color="red.500"`.
- Status colours go through `Badge colorPalette`.
- Escape `'` as `&apos;` in JSX text. Strings inside `{}` need nothing.
- No `Date.now()` in render, and no `useColorModeValue`.
- No Toaster: every result shows inline as an `Alert` inside its card, so nothing has to be mounted.

The `Progress` pattern (used three times):

```tsx
<Progress.Root value={pct} size="sm" colorPalette={palette}>
    <Progress.Label mb="1">{label}</Progress.Label>
    <Progress.Track><Progress.Range /></Progress.Track>
</Progress.Root>
```

`pages/admin/index.tsx` (exact):

```tsx
export const getServerSideProps = (async ({ req, res, query }) => {
    setNoStore(res);
    if (!isAdminEnabled(req)) return { notFound: true };
    const owner = await getOwnerSession(req);
    if (!owner) return { redirect: { destination: "/admin/sign-in", permanent: false } };
    let initialStatus: AdminStatus | null = null;
    try {
        // The JSON round trip guarantees serialisable props even if a Date slips through.
        initialStatus = JSON.parse(JSON.stringify(await buildAdminStatus()));
    } catch (e) {
        // Render anyway: the dashboard shows "Couldn't load the status" and SWR retries.
        console.error("[admin] buildAdminStatus failed:", redact(e instanceof Error ? e.message : String(e)));
    }
    return { props: {
        owner: { name: owner.name, image: owner.image ?? null, login: OWNER_GITHUB_LOGIN },
        initialStatus, flash: flashFromQuery(query),
    } };
}) satisfies GetServerSideProps<AdminPageProps>;

export default function Admin(props: AdminPageProps) {
    return (<><Meta title="Admin • Kevin Wong" noindex /><PageShell><AdminPage {...props} /></PageShell></>);
}
```

Imports, all extensionless:
- `getOwnerSession`, `isAdminEnabled`, `setNoStore` from `../../lib/admin/guard`
- `buildAdminStatus` from `../../lib/admin/status`
- `OWNER_GITHUB_LOGIN` from `../../lib/admin/owner`
- `redact` from `../../lib/redact`
- `flashFromQuery` from `../../lib/admin/messages`

Only `owner.name`, `owner.image` and the `OWNER_GITHUB_LOGIN` constant reach props, never `userId`, `expiresAt` or
anything else from the session. `auth_user.name` holds the GitHub display name, not the login, so the login comes from
the constant.

`AdminPage({ owner, initialStatus, flash })`:
- `const router = useRouter()` (from `next/router`) and
  `const goToSignIn = () => { void router.replace("/admin/sign-in"); }`, used for every lost-session path.
- Data, with `fetcher` imported from `../../lib/fetcher`:
  ```tsx
  useSWR<AdminStatus, FetchError>("/api/admin/status", fetcher, {
      fallbackData: initialStatus ?? undefined,
      refreshInterval: 30_000,
      revalidateOnMount: initialStatus === null,
      onError: (err) => { if (err.status === 401) goToSignIn(); },
  })
  ```
  `revalidateOnMount: initialStatus === null` means a successful server render isn't fetched a second time; a failed
  one retries at once.
- Root: `<Box as="section" flex="1" p="6" overflow="auto">`.
- Header row: `<Flex justify="space-between" align="center" wrap="wrap" gap="4" mb="6">` containing:
  - `<Heading as="h1" size="2xl">Admin</Heading>`
  - an `HStack` with:
    - `Avatar.Root size="sm"`, holding `Avatar.Image src={owner.image ?? undefined} alt=""` and
      `Avatar.Fallback name={owner.name}`
    - `<Text fontWeight="medium">@{owner.login}</Text>`
    - `<Button size="sm" variant="outline" loading={signingOut}><FiLogOut /> Sign out</Button>`
- Sign out:
  - `const r = await signOut()`.
  - If `r.ok || r.signedOut`, call `goToSignIn()`.
  - Otherwise stop loading and show `<Text color="red.500">Sign-out failed. Try again.</Text>`.
- Flash:
  - When `spotifyFlashMessage(flash)` is non-null and not dismissed, render an `Alert.Root` with that `status`, the
    title and the description, plus a `CloseButton` that sets `flashDismissed`.
  - A `useEffect(..., [router])` calls `router.replace("/admin", undefined, { shallow: true })` when `router.query` has
    `spotify` or `spotify_error`, so a reload does not repeat the flash. Shallow routing keeps the props.
- Status states (the **error-state check**):
  - No data and an error: `Alert status="error"` titled "Couldn't load the status", described "The page keeps
    retrying on its own. Press Try again to retry now.", with a "Try again" `Button size="sm"` that calls `mutate()`.
    (SWR stops its 30-second timer while the cache holds an error and retries on its own back-off, so the text must
    not promise 30 seconds.)
  - No data and no error: `<Flex align="center" gap={3}><Spinner size="sm" /><Text>Loading status...</Text></Flex>`.
  - Data plus an error whose status is not 401: `Alert status="warning"` titled "Couldn't refresh the status",
    described `Showing the status from ${formatTimestamp(data.generatedAt)}.`
- Body when there is data:
  1. `<Flex wrap="wrap" rowGap={4} columnGap={4} mb="4">` holding
     `<SpotifyCard spotify={data.spotify} />` and
     `<InstagramCard instagram={data.instagram} generatedAt={data.generatedAt} onChanged={() => void mutate()} onSignedOut={goToSignIn} />`.
  2. `<RunsTable runs={data.runs} />`.
  3. `<ActivityLog activity={data.activity} refusedSignIns={data.refusedSignIns} />`.
  4. A muted footer: `Status as of {formatTimestamp(data.generatedAt)}. Refreshes every 30 seconds.`

`SpotifyCard({ spotify })`, `<AdminCard maxW="420px">`:
- Header: `Heading` "Spotify" with `Badge colorPalette={b.colorPalette}`, where `b = spotifyBadge(state)`.
- State-specific block:
  - `dead`: `Alert status="error"` titled "Spotify rejected the token", described
    `Reason: ${deadReason}. Now Playing and Top Tracks stay empty until you reconnect.`
  - `env`: `Alert status="info"` titled "Using the env var token", described "The token still comes from the
    refresh_token env var. Reconnect once to move it into the database."
  - `missing`: Text "No Spotify token is stored. Reconnect to connect the account."
- When `authorizedAt` and `expiresAt` are set:
  - The Progress pattern, with `pct = percentOf(Math.max(daysLeft ?? 0, 0), daysBetween(authorizedAt, expiresAt) ?? 180)`
    and `label = daysLeftLabel(daysLeft, { estimated: true })`.
  - Palette: red when `daysLeft` is null or 14 or less, orange at 30 or less, else green.
  - Then the muted text `Approved ${formatDate(authorizedAt)}`.
- Account:
  - `accountMatches === true`: "Account: the site's Spotify account".
  - `false`: red text "Account: a different Spotify account. Reconnect with the site's account."
  - `null`: nothing.
- Scopes, when state is `connected` or `dead` (a row exists, so the lists are non-null; still read them as
  `const missing = spotify.missingScopes ?? []` for the type checker):
  - `Scopes: ${3 - missing.length} of 3`. The 3 mirrors `SPOTIFY_SCOPES` in `lib/spotify-token.js`, which imports
    the database pool.
  - When some are missing, red text `Missing: ${missing.join(", ")}`.
- The reconnect form, which is lint-clean (unlike an `<a>` to `/api/...`) and sends `Origin` for Task 13's check:

  ```tsx
  <form method="post" action="/api/admin/spotify/authorize">
      <Button type="submit" variant={spotify.state === "connected" ? "outline" : "solid"}
          colorPalette={spotify.state === "connected" ? "gray" : "green"}>Reconnect</Button>
  </form>
  ```

  Under it, muted: "Opens Spotify's Approve page, then comes back here."

`InstagramCard({ instagram, generatedAt, onChanged, onSignedOut })`, `<AdminCard maxW="520px">`, `Heading`
"Instagram". Display blocks, in order:
1. Token:
   - Null: "No Instagram token is stored."
   - Otherwise `Token: ${daysLeftLabel(token.daysLeft, { estimated: token.expiresAtIsAssumed })}`, then muted
     `Refreshed ${formatTimestamp(token.refreshedAt)}`.
   - With `token.deadReason`: `Alert status="error"` titled "Instagram rejected the token", described
     `Reason: ${deadReason}. The sync has stopped. Generate a new token and seed it with npm run instagram:token, as the README's Instagram sync section describes.`
2. `cronOverdue`: `Alert status="warning"` titled "No cron run in 36 hours", described "The daily sync has not
   recorded a run in 36 hours. Check the cron job in the Vercel dashboard."
3. Last cron run:
   - `lastCron`: `Last cron run ${formatTimestamp(startedAt)}` plus its `runStatusBadge`, then muted
     `Imported ${imported}, uploads ${uploads}, deferred ${deferred}, skipped ${skipped}, errors ${errorCount}`, then
     `lastCron.error` in red with `lineClamp={2}`.
   - Otherwise: "No cron run recorded yet."
4. `lease.held`: muted `A sync is running now (lease until ${formatTimestamp(lease.lockedUntil)}).`
5. Library: `${formatCount(posts)} posts, ${formatCount(files)} files`.
6. Uploads, using the Progress pattern:
   - Label `Uploads, last 30 days: ${formatCount(uploads30d)} of ${formatCount(limits.monthlyLimit)}`.
   - Palette: red at `cronCeiling` or above, orange at `panelCeiling` or above, else green.
   - Muted line: `Panel imports stop at ${formatCount(panelCeiling)}; the daily sync stops at ${formatCount(cronCeiling)}.`
7. Storage, using the Progress pattern:
   - Label `Storage: ${formatBytes(bytes)} of ${formatBytes(limits.storageLimitBytes)}`.
   - Palette: red at 90 % or above, orange at 75 % or above, else green.

Actions:
- `const a = panelAvailability(instagram.panel, generatedAt, instagram.limits)`.
- State:
  - `busy`: `null | "check" | "import"`
  - `checkResult`: `SyncResult | null`
  - `notice`: `null | { status: "info" | "success" | "warning" | "error", text: string }`
  - `confirmOpen`: boolean
- The one handler (exact):

```tsx
async function run(dryRun: boolean) {
    setBusy(dryRun ? "check" : "import");
    setNotice(null);
    const result = await runInstagramSync(dryRun);
    setBusy(null);
    if (result.signedOut) return onSignedOut();
    if (result.ok && result.body) {
        if (dryRun) { setCheckResult(result.body); setNotice({ status: "info", text: checkResultMessage(result.body) }); }
        else {
            setCheckResult(null); setConfirmOpen(false);
            setNotice({ status: result.body.status === "ok" ? "success" : "warning", text: importResultMessage(result.body) });
        }
    } else {
        if (!dryRun) setConfirmOpen(false);
        setNotice({ status: "error", text: syncErrorMessage(result) });
    }
    onChanged();
}
```

Controls:
- Check: `<Button onClick={() => run(true)} loading={busy === "check"} loadingText="Checking…" disabled={!a.canCheck || busy !== null}>Check for new posts</Button>`,
  with `a.checkHint` muted below it.
- Import hint: under the Check hint, outside every `checkResult` branch, render `a.importHint` (muted) whenever
  `!a.canImport && a.importHint`. A successful import sets `checkResult` to null, and the Import button goes with it,
  so the 24-hour and 1,000-upload hints must not depend on a check having listed posts.
- Then the `notice` as `Alert.Root status={notice.status}` with `Alert.Description`.
- Check result, whenever `checkResult` is non-null (with or without posts), below the notice:
  - Only when `checkResult.posts.length` is above 0, the post list:
    - A `List.Root` of the first 10 posts, each item showing:
      - `formatDate(postedAt)`
      - `${mediaCount} file(s)`
      - the shortcode as an external `Link` to `https://www.instagram.com/p/${shortcode}/` with `target="_blank"`
        and `rel="noopener noreferrer"`
    - `and ${n - 10} more` when there are more than 10.
  - Then, always, muted `Blob: ${blob}` and `Resize: ${resize}`, each when present. Every dry run reports both, whether
    or not it found posts, and Task 18 Step 14 relies on them as the proof that Blob and sharp work in the deployed
    function. Do not nest them in the has-posts branch.
- Import, only when `checkResult?.posts.length` is above 0:
  - `<Button colorPalette="blue" onClick={() => setConfirmOpen(true)} disabled={!a.canImport || busy !== null}>Import {n} post(s)</Button>`.
    Its hint is the `a.importHint` line above.
- Confirm dialog, modelled on the Navbar's `Drawer` (Root, then a `Portal` holding Backdrop and Positioner, then
  Content). Render it inside the same `checkResult` branch as the Import button, so `checkResult` is non-null there for
  the type checker:

```tsx
<Dialog.Root role="alertdialog" open={confirmOpen} onOpenChange={(e) => setConfirmOpen(e.open)}
    closeOnInteractOutside={busy !== "import"} closeOnEscape={busy !== "import"}>
    <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
            <Dialog.Content>
                <Dialog.Header><Dialog.Title>Import {n} post(s)?</Dialog.Title></Dialog.Header>
                <Dialog.Body>{importConfirmText(checkResult, instagram)} …</Dialog.Body>
                <Dialog.Footer>
                    <Dialog.ActionTrigger asChild><Button variant="outline" disabled={busy === "import"}>Cancel</Button></Dialog.ActionTrigger>
                    <Button colorPalette="blue" loading={busy === "import"} loadingText="Importing…" onClick={() => run(false)}>Import</Button>
                </Dialog.Footer>
                <Dialog.CloseTrigger asChild><CloseButton size="sm" /></Dialog.CloseTrigger>
            </Dialog.Content>
        </Dialog.Positioner>
    </Portal>
</Dialog.Root>
```

The `…` in the dialog body is a second paragraph, in JSX text: "Posts that appeared since the check are included, within
the same 25-upload cap."

`RunsTable({ runs })`, `<AdminCard mb="4">`:
- `Heading size="md"` "Recent runs". Empty list: "No runs recorded yet."
- `Table.ScrollArea` wrapping `Table.Root size="sm"`. Give `Table.Root` and every `Table.Row`
  `css={{ backgroundColor: "inherit" }}`, as `TopTracks` does.
- Column headers (`Table.Header` > `Table.Row` > `Table.ColumnHeader`): Started, Trigger, Status, Imported, Uploads,
  Deferred, Skipped, Errors, Error.
- Cells, for `runs.slice(0, 20)` with `key={run.id}`:
  - Started: `formatTimestamp(startedAt)`.
  - Trigger: `dryRun ? \`${trigger} (check)\` : trigger`.
  - Status: a `runStatusBadge` Badge.
  - The four counts and `errorCount`.
  - Error: `error` with `truncate maxW="xs" title={error ?? undefined}`.
- At phone width the table scrolls inside the card, and the page itself does not scroll sideways.

`ActivityLog({ activity, refusedSignIns })`, `<AdminCard>`:
- `Heading size="md"` "Activity".
- When `refusedSignIns.count24h > 0`, directly under the heading and above the rows (and above the empty-list text):
  - `<Text fontWeight="medium">Refused sign-ins in the last 24 hours: {formatCount(count24h)}</Text>`.
  - When `latestAt` is set, muted `Latest: ${latestLogin ?? "unknown"}, ${formatTimestamp(latestAt)}`. That is UTC,
    en-US, like every other timestamp. React escapes the login.
  - The count comes from `refusedSignIns`, not from `activity`: `recentAdminEvents` leaves refusals out, so a burst of
    them cannot push real events out of the 20 rows.
- Empty list: "No activity yet."
- For `activity.slice(0, 20)`, each row is a `Stack direction={{ base: "column", md: "row" }} gap={{ base: 0, md: 3 }}`
  holding:
  - muted `formatTimestamp(at)`
  - `<Text fontWeight="medium">{activityLabel(event)}</Text>`
  - muted `detailsSummary(details)`

- [ ] **Step 7: Verify lint, types, build and the client bundle**

Run, in order:
1. `npm test`. Expected: `ℹ fail 0` and `ℹ cancelled 0`.
2. `npx eslint .`. Expected: no output.
3. `npm run build`. Expected: `✓ Compiled successfully`, with `ƒ /admin` and `ƒ /admin/sign-in` in the route list.
4. `npx tsc --noEmit`. Expected: no output.
5. `grep -rlE "auth_account|integration_tokens|sync_runs|admin_audit_log|BETTER_AUTH_URL" .next/static || echo clean`.
   Expected: `clean`.

- [ ] **Step 8: Render it locally from fixtures (admin itself cannot run locally)**

Admin returns 404 outside production on `www` (D1), and no development OAuth app exists, so `/admin` cannot be signed
into locally. To check the layout, the states and the Check/Import flow anyway, render `AdminPage` from a temporary
page, `pages/admin-preview.tsx`. It sits outside `pages/admin/`, enables nothing, and is **never committed**.

What the page contains:
- `export const getServerSideProps = async () => ({ props: {} })`, so `useRouter().query` is filled on the first render.
- A typed `fixture(v: string | undefined): AdminStatus | null`. TypeScript then checks the fixture against `types.ts`.
  The variants:
  - Default:
    - `generatedAt` is `2026-10-19T12:00:00.000Z`.
    - Spotify is `connected`, `authorizedAt` `2026-05-29T14:00:00.000Z`, `expiresAt` `2026-11-25T14:00:00.000Z`,
      `daysLeft` 37, all three scopes.
    - The Instagram token has 51 days left. `uploads30d` is 120; the library is 412 posts, 1,033 files and
      734,003,200 bytes.
    - Five runs (ok cron, partial cron, failed cli, abandoned cron, running panel check) and four activity rows.
    - `refusedSignIns` is `{ count24h: 2, latestAt: "2026-10-19T09:15:00.000Z", latestLogin: "someone-else" }`. The
      other variants keep it, except `missing`.
  - `dead`: Spotify `dead`, `deadReason` `"invalid_grant"`, `daysLeft` −3. `cronOverdue` true and `lastCron` null.
  - `env`: Spotify `env`, every other Spotify field `null` (as Task 15 returns with no row). The Instagram token's `deadReason` is `"OAuthException 190"`. The panel shows
    `nextCheckAt` 7 minutes after `generatedAt`, and `daily_limit` with `nextImportAt`.
  - `missing`: Spotify `missing` (all other Spotify fields `null`), Instagram token null, no runs or activity, `uploads30d` 1000, `upload_ceiling`,
    and `refusedSignIns` `{ count24h: 0, latestAt: null, latestLogin: null }`.
  - `null`: returns `null`, the server-failure case.
- The page renders `<Meta title="Admin preview • Kevin Wong" noindex />`, then `<PageShell>`, then
  `<AdminPage owner={{ name: "Kevin Wong", image: null, login: "dotKevinWong" }} initialStatus={fixture(query.v)} flash={...} />`.
  - Build `flash` from `?flash=connected` or `?flash=<code>`.
  - Do not use `?spotify=`: `AdminPage` rewrites that query to `/admin`, which 404s locally.
- A module-level fetch shim answers the admin API in the browser, because those routes 404 locally:

```tsx
if (typeof window !== "undefined") {
    const realFetch = window.fetch.bind(window);
    const json = (status: number, body: unknown) =>
        new Promise<Response>((done) => setTimeout(() => done(new Response(JSON.stringify(body),
            { status, headers: { "content-type": "application/json" } })), 600));
    window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const q = new URLSearchParams(window.location.search);
        const api = q.get("api") ?? "ok"; // ok | fail | 401 | 429
        if (api === "401" && url.includes("/api/admin/")) return json(401, { error: "unauthorized" });
        if (url.includes("/api/admin/status")) return api === "fail" ? json(500, { error: "internal" }) : json(200, fixture(q.get("v") ?? undefined) ?? fixture(undefined));
        if (url.includes("/api/admin/instagram/sync")) {
            const { dryRun } = JSON.parse(String(init?.body ?? "{}"));
            if (api === "429") return json(429, { error: dryRun ? "too_soon" : "daily_limit", retryAfterSeconds: dryRun ? 420 : 50_400 });
            const none = q.get("posts") === "0"; // &posts=0: a check that finds nothing new
            return json(200, { status: "ok", fetched: 30, alreadyPresent: none ? 30 : 18, posts: none ? [] : SAMPLE_POSTS,
                uploads: none ? 0 : 25, deferred: 0, errorCount: 0,
                ...(dryRun ? { blob: "ok", resize: "ok (sharp 0.35.4, libvips 8.17.2)" } : {}) });
        }
        if (url.includes("/api/auth/sign-out")) return json(200, { success: true });
        return realFetch(input, init);
    };
}
```

`SAMPLE_POSTS` is 12 posts, so the "and 2 more" line appears.

Run `npm run dev`. With Kevin's Mac on Eastern time, open the browser devtools console and work through each check:
1. `/admin-preview`:
   - The header shows `@dotKevinWong`. Both cards, the runs table and the activity log render.
   - The Activity card starts with "Refused sign-ins in the last 24 hours: 2" and a muted
     "Latest: someone-else, Oct 19, 2026, 09:15 UTC", above the rows.
   - The console shows no hydration warning ("Text content did not match" or "Hydration failed").
2. `/admin-preview?v=dead`, `?v=env` and `?v=missing`: each badge, alert, hint and empty state matches Step 6.
   - The Spotify bar reads "Past the estimated date" for `dead`.
   - Check is disabled with its hint for `env`, and the "The panel allows one import per 24 hours. Next import
     available …" hint shows under it at once, before any check.
   - For `missing`, the 1,000-upload hint shows under the Check button at once, and Import is disabled once a check
     has found posts. The Activity card has no "Refused sign-ins" line.
3. The error-state check:
   - `/admin-preview?v=null&api=fail` shows "Couldn't load the status" and Try again.
   - `/admin-preview?api=fail` shows the "Couldn't refresh the status" warning within 30 seconds, or on refocusing the
     window, while keeping the cards.
4. `/admin-preview?api=401`: within 30 seconds the URL changes to `/admin/sign-in`. That page is the local 404, which is
   expected.
5. The Check and Import flow:
   1. Check shows the spinner, then "Found 12 new posts with 25 files to upload.", 10 listed posts, "and 2 more", and
      the Blob and Resize lines.
   2. Import opens the dialog with the counts.
   3. Cancel and Escape close it.
   4. Import shows the spinner, closes the dialog, and shows "Imported 12 posts (25 file uploads)."
   5. With `&api=429`, Check shows "A check already ran in the last 10 minutes. Try again in 7 minutes."
   6. With `&posts=0` (a check that finds nothing new), Check shows "No new posts. Nothing to import.", no post list
      and no Import button, and still shows the Blob and Resize lines.
6. `?flash=connected`, `?flash=wrong_account` and `?flash=not_configured` show the success and error alerts. The close
   button hides them.
7. Sign out: the button spins, then the URL changes to `/admin/sign-in` (the local 404).
8. Light mode, dark mode, and a 375 px window: no horizontal page scroll, and the runs table scrolls inside its card.

Then stop the dev server, run `rm pages/admin-preview.tsx`, and repeat Step 7's commands 2–4 (the preview must not be
what made them pass).

- [ ] **Step 9: Commit**

```bash
test ! -e pages/admin-preview.tsx
git add pages/admin/index.tsx components/admin/AdminPage.tsx components/admin/SpotifyCard.tsx \
  components/admin/InstagramCard.tsx components/admin/RunsTable.tsx components/admin/ActivityLog.tsx \
  components/admin/api.ts components/admin/types.ts lib/admin/format.js lib/admin/messages.js \
  tests/admin/format.test.mjs tests/admin/dashboard-messages.test.mjs
git commit -m "Add the admin dashboard"
```

- [ ] **Step 10: Kevin: dashboard checks during Task 18's Deploy B checks**

Task 18 owns the Deploy B checks (sign-in, the Spotify reconnect, Check, Sign out). Look for these as you go:
1. After signing in: the header shows your avatar, `@dotKevinWong` and Sign out.
2. Before the reconnect (D3): the Spotify card shows "Using env var" (orange) and the info alert.
3. Right after the reconnect, back on `/admin`:
   - A green "Spotify reconnected" alert shows, and the address bar no longer has `?spotify=connected`.
   - The badge says Connected, with "179 days left (estimated)" (the count is floored) and today's approval date.
   - It shows "Account: the site's Spotify account" and "Scopes: 3 of 3".
4. On the Instagram card:
   - The token days left and the last cron run with its badge appear.
   - There is no 36-hour warning, unless the cron really missed or no real (non-dry) cron run has happened since Deploy A yet. In that second case the card also says "No cron run recorded yet."; look again after the next 05:00 UTC run.
   - Uploads show "N of 2,000" and storage shows "X of 1 GB".
5. When Task 18 presses Check a second time: Check is either disabled with "Next check available …", or refused with
   "A check already ran in the last 10 minutes. Try again in N minutes."
6. Optional, after Task 18's Check step and its query, and only if the check found posts: press Import.
   1. The dialog states the post and file counts. Cancel leaves the runs table unchanged.
   2. Press Import again and confirm. The result alert appears, the Import button goes away, the runs table gains a
      `panel` row, and once the status refreshes, "The panel allows one import per 24 hours. Next import available …"
      shows under the Check button.
7. The runs table and the activity log show the last runs and the sign_in, spotify_connected and instagram_check
   entries. When someone else's GitHub sign-in was refused in the last 24 hours, a "Refused sign-ins in the last 24
   hours: N" line shows above the rows; the rows themselves never list refusals.
8. Dark mode and a phone-width window: no sideways page scroll. View source: `noindex, nofollow`, and no
   `rel="canonical"`.
9. After Task 18 Step 14 item 3's query and before its Sign out (item 4): open `/admin` in a second tab and press Sign out there. Switch back to the first tab. On
   focus, SWR re-fetches (and polls every 30 seconds while visible), gets 401, and moves to `/admin/sign-in`. Sign in
   again, then do Task 18's Sign out. Pressing Back does not show the dashboard.

---

### Task 18: Admin panel docs, final verification and the Deploy B rollout

**Model:** Sonnet
**Files:**
- Modify: `README.md`, as Task 10 left it: a new `### 🔐 Admin panel` section after `### 🎧 Spotify token`, and edits to `Prerequisites`, the `Environment variables` table, the `🗄️ Database migrations` table and `🎧 Spotify token`.

This task is the single source for Deploy B's setup. Kevin's part of Task 11 (the GitHub OAuth App and the four auth env vars) is Steps 5–6, Task 13's (the Spotify redirect URI) is Step 7, and the backup, `007`, the schema check and the deploy are Steps 8–9.

**Interfaces:**
- Consumes (everything here is exercised, not called):
  - The routes and pages from Tasks 11–17, the JSON of `GET /api/admin/status` (Task 15), and the reconnect outcomes (Task 13): `/admin?spotify=connected`, or `/admin?spotify_error=<code>` with `denied`, `state_mismatch`, `exchange_failed`, `missing_scopes`, `account_lookup_failed`, `wrong_account`, `not_configured` or `save_failed`.
  - `npm run db:apply -- [--yes] <file.sql>...` (Task 2). It reads `DATABASE_URL` from `.env` in the current directory (the real environment wins), strips `-pooler` from the host itself, and prints `Target: <host>/<db>` and `Files:  <files>`. Without `--yes` it then refuses a non-local database with ``Not a local database. Re-run with --yes (after `--`) to apply.``; with `--yes` (after the `--`) it prints `applied <file>` for each file.
  - `sql/007_auth.sql` (Task 11): `auth_user`, `auth_session`, `auth_account`, `auth_verification`.
  - `scripts/auth.config.mjs` (Task 11) and the Better Auth CLI, the exact-pinned `auth@1.7.10` devDependency (Task 11) that `npm ci` installs, run as `npx --no-install auth check --config scripts/auth.config.mjs`. It loads `.env`/`.env.local` from the current directory without overriding exported variables. It prints `Schema check passed against the live database.` and exits 0, exits 1 on a mismatch, and exits 2 when it cannot load the config or connect.
  - From Task 10: the README sections `🎧 Spotify token` and `🗄️ Database migrations`, the backup `before-admin-005` (a Neon branch, or `~/Backups/kevinwong-before-admin-005.dump`), and its Step 5 backup method.
  - Kevin's page checklists: Task 16 Step 10 (sign-in page) and Task 17 Step 10 (dashboard).
  - Task 17's `ActivityLog` line `Refused sign-ins in the last 24 hours: N`, shown above the activity table when the status JSON's `refusedSignIns.count24h` (Task 15) is above 0. The table itself never lists `sign_in_rejected` events (Task 11's `recentAdminEvents`).
  - `POST /api/admin/instagram/sync` (Task 14): a check within 10 minutes of the last one answers 429 `{ error: "too_soon", retryAfterSeconds }`, writes a `panel_run_refused` event and no `sync_runs` row.
- Produces: the README text that Task 19 edits, and the reconnect dates (Step 13) that Task 19 Step 1 writes into `TODO.md`.

- [ ] **Step 1: Write the README changes**

Match the README's voice: short declarative sentences, and a heading that starts with an emoji like its siblings. The new `### 🔐 Admin panel` section goes right after `### 🎧 Spotify token` and states these things, in this order:
1. **What it is.** `https://www.kevinwong.co/admin` is a private dashboard with no link anywhere. Only GitHub account `1741711` (`@dotKevinWong`) can sign in. Sessions last 24 hours and do not extend.
2. **What it does.** It reconnects Spotify, shows the Instagram token, the last cron run, the library size, uploads over 30 days and recent runs, offers Check / Import buttons, and shows the activity log (`admin_audit_log`).
3. **Production only.** `/admin`, `/api/admin/*` and `/api/auth/*` return 404 unless `VERCEL_ENV=production` and the host is `www.kevinwong.co`. That includes `next dev` and every preview. Local development shares the production database, so the panel is switched off there instead of getting a second sign-in. `npm test` covers it, with unit tests and integration tests against a throwaway local Postgres.
4. **Limits.** Copy this table exactly:

   | Action | Limit |
   | --- | --- |
   | Check for new posts (dry run) | Once per 10 minutes |
   | Import from the panel | Once per rolling 24 hours. An import that is running, finished, or was killed mid-way counts, and so does any import that uploaded something. One that failed, stood down because another sync was running, or couldn't record its run, before uploading anything doesn't count |
   | Panel imports | Refused once uploads over the last 30 days reach 1,000 |
   | Any real sync (cron, panel, CLI) | Stops at 1,800 uploads in 30 days, under Blob's 2,000-a-month hard stop |

   Panel runs are fixed at 50 posts, 25 uploads and a 60-second budget. The browser only chooses Check or Import.
5. **Signing in.** Explain the four checks in one sentence each: the profile gate, account linking off, the path allowlist (only `POST /api/auth/sign-in/social`, `GET /api/auth/callback/github` and `POST /api/auth/sign-out`), and the per-request owner check. Better Auth is pinned to exactly `1.7.10`, and so is its CLI, the `auth@1.7.10` devDependency. Upgrade the two together.
6. **One-time setup.**
   - The GitHub OAuth App (homepage `https://www.kevinwong.co`, callback `https://www.kevinwong.co/api/auth/callback/github`, no scopes requested) and its four env vars, Production only.
   - The Spotify redirect URI `https://www.kevinwong.co/api/admin/spotify/callback`, keeping `http://127.0.0.1:8888/callback` for the script.
   - `sql/007_auth.sql`, applied as described in *Database migrations* before the deploy that uses it, because Better Auth refuses every request while its tables are missing.
   - Checking the result with `npx --no-install auth check --config scripts/auth.config.mjs`, run in the main checkout after `npm ci` (which installs the pinned CLI) so it reads `DATABASE_URL` from `.env`.
7. **Troubleshooting.**
   - `/admin/sign-in?error=not_owner` means another GitHub account tried.
   - A `SchemaMismatchError` in the logs means `007` is missing or wrong, so run the check.
   - `/admin?spotify_error=<code>` after a reconnect. Nothing was stored in any case:
     - `denied`: Approve was not clicked on Spotify's page.
     - `state_mismatch`: the 10-minute cookie expired or the flow came from elsewhere, so start again.
     - `exchange_failed`: Spotify refused the code. Start again, and check that the redirect URI is registered.
     - `missing_scopes`: a permission was unticked on Spotify's page. Approve all of them.
     - `account_lookup_failed`: Spotify's profile lookup failed. Try again.
     - `wrong_account`: approved with a different Spotify account than the site's.
     - `not_configured`: `SPOTIFY_CLIENT_ID` or `SPOTIFY_CLIENT_SECRET` is missing in Vercel Production.
     - `save_failed`: the database write failed. Try again.

Other edits:
- `Environment variables` table: add these rows, each marked "Production only (Vercel)":
  - `BETTER_AUTH_SECRET`: signs sessions; `openssl rand -hex 32`.
  - `BETTER_AUTH_URL`: exactly `https://www.kevinwong.co`, with no trailing slash.
  - `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`: the admin sign-in OAuth App.

  In Task 10's `DATABASE_URL` row, add "/admin's sign-in, sessions and activity log" to the list. Confirm that Task 10's `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` row is present.
- `Prerequisites`: add /admin to the list of what Task 10's Postgres bullet backs.
- `Database migrations`: add a row to Task 10's table: ``| [`007`](sql/007_auth.sql) | Better Auth's `auth_user`, `auth_session`, `auth_account` and `auth_verification` | Signing in to /admin |``.
- `Spotify token`: replace the **Reconnecting.** paragraph's lead-in, so the panel is the normal way: https://www.kevinwong.co/admin → Spotify → **Reconnect** → approve on Spotify, effective within a minute with no redeploy. `npm run spotify:reauth -- --save` becomes the fallback, keeping its two numbered steps. Keep the six-month explanation. Leave the `refresh_token` fallback sentences alone; Task 19 removes them.

- [ ] **Step 2: Check the docs**

```sh
grep -nE "BETTER_AUTH_SECRET|BETTER_AUTH_URL|GITHUB_CLIENT_ID|/api/admin/spotify/callback|auth@1\.7\.10|npx --no-install auth check|Once per rolling 24 hours|007_auth\.sql|not_configured|save_failed" README.md
grep -n "kevinwong.co/admin" README.md
grep -nE "Spotify token rotation|npx (--yes )?auth@" README.md
```

Expected: each pattern in the first command matches at least one line. The second prints only `https://www.kevinwong.co/...` URLs, never the apex `https://kevinwong.co/admin`. The third prints nothing: the README never runs the CLI as `npx auth@…` or `npx --yes auth@…`, which would fetch it outside the lockfile.

- [ ] **Step 3: Final verification (implementer)**

Run these in order, with `kw-test-pg` running. The build comes before `tsc`, because `next-env.d.ts` is generated and gitignored after the audit.

```sh
npm test
npx eslint .
env -u DATABASE_URL -u BETTER_AUTH_URL -u BETTER_AUTH_SECRET -u GITHUB_CLIENT_ID -u GITHUB_CLIENT_SECRET npm run build
npx tsc --noEmit
npm run audit:prod
git log --oneline main..HEAD
git status --short
```

Expected:
- **`npm test`** ends with `ℹ fail 0` and `ℹ cancelled 0`, and prints no `﹣` line, so every integration suite ran.
- **ESLint** prints nothing and exits 0.
- **The build** exits 0 with no auth env vars. That proves `getAuth()` is lazy. Its route table lists `/admin`, `/admin/sign-in`, `/api/admin/status`, `/api/admin/instagram/sync`, `/api/admin/spotify/authorize`, `/api/admin/spotify/callback` and `/api/auth/[...all]` as dynamic (`ƒ`).
- **`tsc`** prints nothing.
- **`audit:prod`** reports no high or critical advisories. A high advisory in `better-auth` blocks the deploy. Any other advisory goes into TODO.md.
- **`git log`** lists only Tasks 11–17's commits, since Deploy A is already on `main`.
- **`git status --short`** shows ` M README.md`; nothing else.

- [ ] **Step 4: Commit, then hand over to Kevin**

```sh
git add README.md
git commit -m "Document the admin panel"
```

Tell Kevin the branch is ready for Deploy B and list Steps 5–14. Steps 5–7 can happen any time before Step 9, because nothing reads the new env vars or the redirect URI until Deploy B ships. Step 8 comes right before Step 9.

- [ ] **Step 5: Kevin: create the GitHub OAuth App** (any time before Step 9)

Never paste a secret into chat or onto a command line.
1. github.com → your avatar → **Settings** → **Developer settings** (bottom of the left sidebar) → **OAuth Apps** → **New OAuth App**.
2. Application name `kevinwong.co admin`; Homepage URL `https://www.kevinwong.co`; Authorization callback URL `https://www.kevinwong.co/api/auth/callback/github`. Leave **Enable Device Flow** unticked → **Register application**. There is no localhost callback and no second app, because sign-in is production-only (D1).
3. Keep the app's page open for Step 6. You will copy its **Client ID** and use **Generate a new client secret** (GitHub shows the secret once).
4. While in Settings: **Password and authentication** should show two-factor authentication on, ideally with a passkey. The panel relies on it against a GitHub account takeover.

- [ ] **Step 6: Kevin: set the four auth env vars in Vercel** (any time before Step 9)

For each variable: Vercel → the kevinwong.co project → **Settings** → **Environment Variables** → add a variable → set Key and Value → under Environments tick **Production** only (untick Preview and Development) → turn **Sensitive** on → **Save**.
- `BETTER_AUTH_SECRET`: generate it straight into the clipboard without printing it, paste it as the value, then clear the clipboard:
  ```sh
  openssl rand -hex 32 | tr -d '\n' | pbcopy
  # paste into Vercel's Value field, save, then:
  pbcopy < /dev/null
  ```
  CLI alternative, if the main checkout is linked with `vercel link` (the value goes through a pipe, never argv): `openssl rand -hex 32 | vercel env add BETTER_AUTH_SECRET production --sensitive`.
- `BETTER_AUTH_URL`: exactly `https://www.kevinwong.co`, with no trailing slash. `lib/auth.js` refuses to start in production with any other value.
- `GITHUB_CLIENT_ID`: the OAuth App's Client ID.
- `GITHUB_CLIENT_SECRET`: on the OAuth App page click **Generate a new client secret**, click its copy icon, and paste it directly into Vercel's Value field.

Check: the Environment Variables list shows all four names, each with the environment "Production" only and the Sensitive marker, and still shows `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` for Production (added for Deploy A). Don't add the four to `.env`: local development never signs in (D1).

- [ ] **Step 7: Kevin: add the panel's redirect URI to the Spotify app** (any time before Step 9)

https://developer.spotify.com/dashboard → open the site's app → **Settings** → **Edit** → under **Redirect URIs** type `https://www.kevinwong.co/api/admin/spotify/callback` → **Add** → **Save** at the bottom. Leave `http://127.0.0.1:8888/callback` in the list, because `npm run spotify:reauth` still uses it. Check: Settings shows both URIs. Don't touch the client secret.

- [ ] **Step 8: Kevin: back up production** (right before Step 9)

Neon Console → the kevinwong.co project → **Branches** → **New branch** → name `before-admin-007`, parent: the production branch (marked default), data up to **now** (the current point in time, not schema-only) → **Create branch**. Check: the **Branches** list shows `before-admin-007`. If you used Task 10 Step 5's `pg_dump` alternative for Deploy A, use it again here, writing `~/Backups/kevinwong-before-admin-007.dump`.

- [ ] **Step 9: Kevin: merge, apply `007`, check the schema, deploy**

Run everything in one terminal in the main checkout. Its `.env` holds production's pooled `DATABASE_URL`, so nothing secret is typed or pasted.

1. **Merge into local `main`**, and install the new dependencies: `better-auth`, which the schema check loads, and the pinned `auth` CLI that runs it:

   ```sh
   cd /Users/Kevin/Git/kevinwong.co
   nvm use --silent
   git switch main
   git pull --ff-only origin main
   git merge --ff-only claude/admin-panel || git merge --no-ff claude/admin-panel -m "Merge branch 'claude/admin-panel' (Deploy B)"
   npm ci
   ```

2. **Apply `007`.** First without `--yes`, which only prints the target:

   ```sh
   npm run db:apply -- sql/007_auth.sql
   ```

   Expected: `Target: ep-<id>.<region>.aws.neon.tech/<db>`, the Neon host with no `-pooler`, then `Files:  sql/007_auth.sql` and ``Not a local database. Re-run with --yes (after `--`) to apply.`` Nothing was applied. If the host is anything else, stop: a `DATABASE_URL` exported in this shell wins over `.env`, so `unset DATABASE_URL` and run it again. Otherwise:

   ```sh
   npm run db:apply -- --yes sql/007_auth.sql
   ```

   Expected: the same `Target:` line, then `applied sql/007_auth.sql`. A `SECURITY WARNING` from `pg` about `sslmode=require` is harmless: the connection verifies.

3. **Define a read-only query helper** for this step and Steps 12–14. It reads `DATABASE_URL` from `.env`, so the URL is never typed and never appears in any process's arguments. Define it again if you open a new terminal.

   ```sh
   prodsql() { node --env-file=.env --input-type=module -e '
   import pg from "pg";
   const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
   try { console.table((await pool.query(process.argv[1])).rows); } finally { await pool.end(); }' "$1"; }
   prodsql "select table_name from information_schema.tables where table_schema = 'public' and table_name in ('auth_user', 'auth_session', 'auth_account', 'auth_verification') order by 1"
   ```

   Expected: four rows, `auth_account`, `auth_session`, `auth_user` and `auth_verification`.

4. **Run the read-only schema check.** The CLI is the exact-pinned `auth@1.7.10` devDependency that `npm ci` installed in item 1, with its whole tree in `package-lock.json`. `--no-install` makes `npx` run only that copy and never download one. The CLI reads `DATABASE_URL` from `.env`. The subshell keeps the throwaway values out of your shell afterwards:

   ```sh
   (
     export BETTER_AUTH_URL="https://www.kevinwong.co"
     export BETTER_AUTH_SECRET="$(openssl rand -hex 32)"   # throwaway: the check signs nothing
     npx --no-install auth check --config scripts/auth.config.mjs; echo "exit=$?"
   )
   ```

   Expected: `Schema check passed against the live database.` and `exit=0`. A `Social provider github is missing clientId` warning is harmless here.
   - If `npx` printed `npx canceled due to missing packages and no YES option` (also `exit=1`), the CLI isn't installed and nothing was checked: run `npm ci` again, check that `npm ls auth` prints `auth@1.7.10`, and repeat this step.
   - On any other `exit=1`, stop and don't push. Send the session what the check printed. The fix lands on `claude/admin-panel`, and you repeat this step.
   - On `exit=2`, the config didn't load or the database didn't connect. Check that `npm ci` succeeded and that `.env` has `DATABASE_URL`.

5. **Deploy:**

   ```sh
   git push origin main
   ```

   Vercel → **Deployments** → wait until the new **Production** deployment for that commit is **Ready**.

6. **If anything in Steps 10–14 fails badly:** Vercel → **Deployments** → the previous Production deployment (Deploy A's code) → **⋯** → **Instant Rollback**. The auth tables can stay, because Deploy A never reads them.

- [ ] **Step 10: Kevin: checks from outside**

```sh
curl -sI https://www.kevinwong.co/admin | grep -iE '^(HTTP|location|x-frame-options|x-robots-tag|content-security-policy)'
```

Expected (order and casing may vary):

```text
HTTP/2 307
location: /admin/sign-in
content-security-policy: frame-ancestors 'none'
x-frame-options: DENY
x-robots-tag: noindex, nofollow
```

Then each of these lines prints one status code:

```sh
curl -s -o /dev/null -w "%{http_code}\n" https://www.kevinwong.co/api/admin/status                 # 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://www.kevinwong.co/api/admin/instagram/sync  # 403 (no Origin)
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Origin: https://www.kevinwong.co" https://www.kevinwong.co/api/admin/instagram/sync   # 401
curl -s -o /dev/null -w "%{http_code}\n" https://www.kevinwong.co/api/auth/get-session             # 404
curl -s -o /dev/null -w "%{http_code}\n" https://www.kevinwong.co/api/auth/list-sessions           # 404
curl -s -o /dev/null -w "%{http_code}\n" https://kevinwong.co/admin                                # 308 (apex to www)
```

If `/admin` answers 404 on www, the first suspect is the host check: the gate compares `req.headers.host` with exactly `www.kevinwong.co`.

- [ ] **Step 11: Kevin: preview and deployment URLs return 404**

Use a browser where you are signed in to Vercel, because Deployment Protection answers `curl` with Vercel's own 401.
- Vercel → **Deployments** → any **Preview** deployment → **Visit**. Add `/admin` to its URL. Expected: the site's 404 page. `/admin/sign-in` there is a 404 too.
- Do the same with the new Production deployment's own `*.vercel.app` URL. It runs with `VERCEL_ENV=production`, but the host is not `www`. Expected: the site's 404 page.

- [ ] **Step 12: Kevin: sign in, and refuse a second account**

Task 16 Step 10 lists the sign-in page's own checks (its head tags and its messages); do them during this step.
1. **Sign in as yourself.** Open `https://www.kevinwong.co/admin`. It redirects to `/admin/sign-in`. Click **Sign in with GitHub**. GitHub asks once to authorize `kevinwong.co admin`, with no scopes listed. Click **Authorize**. Expected: the dashboard, with your avatar in the header. Then, in the Step 9 terminal:

   ```sh
   prodsql "select (select count(*) from auth_user)::int as users, (select count(*) from auth_account where \"providerId\" = 'github' and \"accountId\" = '1741711')::int as owner_accounts, (select count(*) from auth_session)::int as sessions, (select count(*) from admin_audit_log where event = 'sign_in' and actor = 'github:1741711')::int as sign_ins"
   ```

   Expected: one row, `users 1`, `owner_accounts 1`, `sessions 1`, `sign_ins 1`.
2. **A second GitHub account.** Skip this item if you have none; Task 12's integration test covers it.
   - Open a private window and sign in to github.com as the other account.
   - Open `https://www.kevinwong.co/admin/sign-in` → **Sign in with GitHub** → **Authorize**.

   Expected: you land on `/admin/sign-in?error=not_owner…` and the page shows the refusal. Then:

   ```sh
   prodsql "select (select count(*) from auth_user)::int as users, (select count(*) from auth_account)::int as accounts, (select count(*) from auth_account where \"accountId\" <> '1741711')::int as other_accounts, (select count(*) from auth_session)::int as sessions, (select count(*) from auth_verification)::int as verifications, (select count(*) from admin_audit_log where event = 'sign_in_rejected')::int as rejected"
   ```

   Expected: one row, `users 1`, `accounts 1`, `other_accounts 0`, `sessions 1`, `verifications 0`, `rejected 1`. The refusal wrote nothing to the auth tables and one `sign_in_rejected` row to the activity log, by design (D5).

   Then, back in your own window, reload `/admin`. Expected: above the activity table, the line "Refused sign-ins in the last 24 hours: 1", with the other account's GitHub login and the time (UTC). The activity table itself does not list the refusal.

- [ ] **Step 13: Kevin: reconnect Spotify (D3)**

Task 17 Step 10 lists what each dashboard card should show; work through it during this step and the next.
1. On `/admin`, the Spotify card shows the env-var state. Click **Reconnect**. On Spotify's Approve page (it always appears, because of `show_dialog`), check that it is your account and click **Agree**. Expected:
   - You land on `/admin?spotify=connected`, and a "Spotify reconnected" alert shows.
   - The card shows **Connected**, about 180 days left (179 is right: the count rounds down), the site's account, and scopes 3 of 3.
2. Confirm the row without selecting any token:

   ```sh
   prodsql "select authorized_at, expires_at, expires_at_is_assumed, account_id, scopes, dead_reason, refresh_token is not null as has_refresh_token from integration_tokens where provider = 'spotify'"
   ```

   Expected: `authorized_at` is about now, `expires_at` is 180 days later, `expires_at_is_assumed` is `true`, `dead_reason` is `null`, `has_refresh_token` is `true`, and `scopes` lists the three scopes.
3. Play something on Spotify. `curl -s https://www.kevinwong.co/api/nowplaying` shows `"isPlaying":true`. It keeps working throughout: each server instance switches to the stored token at its next refresh, within an hour. Then check the listening chart, the only caller that needs `user-read-recently-played` (the query string skips the CDN's day-long cache):

   ```sh
   curl -sS "https://www.kevinwong.co/api/listeningtimeline?check=$(date +%s)" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.is_working===false?`FAILED: ${s}`:`ok: ${Object.keys(j).length} days`)})'
   ```

   Expected: `ok: N days`, with N above 0. `FAILED: {"is_working":false}` means the token or a scope is wrong; check the card's scopes.
4. Read the dates that TODO.md needs:

   ```sh
   prodsql "select to_char(authorized_at, 'YYYY-MM-DD') as reconnected_on, to_char(authorized_at + interval '7 days', 'YYYY-MM-DD') as cleanup_from, to_char(expires_at - interval '30 days', 'YYYY-MM-DD') as reconnect_by, to_char(expires_at, 'YYYY-MM-DD') as estimated_expiry from integration_tokens where provider = 'spotify'"
   ```

   Send the four dates to the session, which does Task 19 Step 1 the same day. Put `cleanup_from` (Task 19 Step 2 onwards) and `reconnect_by` in your calendar.

- [ ] **Step 14: Kevin: run Check, see the limit hold, sign out**

1. On `/admin`:
   - The Instagram card shows the last cron run (recorded since Deploy A) and no overdue warning. If no real (non-dry) cron run has happened since Deploy A, because 05:00 UTC hasn't come round yet, it shows "No cron run recorded yet." and the "No cron run in 36 hours" warning instead. That is expected, not a failure: look again after the next 05:00 UTC run.
   - The token's days left match `npm run instagram:token`.
   - Uploads over 30 days and storage are shown.
2. Click **Check for new posts**. Expected:
   - An info alert: "Found N new posts with M files to upload." (plus how many wait for a later run, if any), or "No new posts. Nothing to import."
   - The muted lines `Blob: ok` and `Resize: ok (sharp …, libvips …)`.
   - Any new posts listed by date, file count and shortcode (a link to the post), without captions.
   - Once the status refreshes, the **Recent runs** table's top row reads `panel (check)` with a green **OK** badge.

   Import only if it lists posts, and only after item 3's query; otherwise the 05:00 UTC cron imports them.
3. **See the limit hold.** Once the result shows, the dashboard refreshes its status. Expected: **Check** is disabled, with "Next check available …" under it, about 10 minutes out. A disabled button sends nothing, so prove the server's limit from the browser instead:
   1. On `/admin`, open the browser's developer console (Chrome may ask you to type `allow pasting` before the first paste) and run:

      ```js
      (await fetch("/api/admin/instagram/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dryRun: true }) })).status
      ```

      Expected: `429`. The request is same-origin, so it carries your session cookie and `Origin`, and the server refuses it as too soon.
   2. Then, in the Step 9 terminal:

      ```sh
      prodsql "select trigger, dry_run, status, fetched, imported, uploads from sync_runs order by started_at desc limit 2"
      prodsql "select event, actor from admin_audit_log order by at desc limit 3"
      ```

      Expected: the newest run is `panel`, `dry_run` `true`, status `ok`; the refused request wrote no run. The three latest events are `panel_run_refused` (from the console request), `instagram_check` and `spotify_connected`, each with actor `github:1741711`.

   Do Task 17 Step 10 item 9 (Sign out in a second tab, then sign in again) and item 6 (Import) only after this query, not before: each writes an event that would push these three out of the newest three.
4. Click **Sign out**. Expected: you are on `/admin/sign-in`, and `prodsql "select count(*)::int as sessions from auth_session"` shows `sessions 0`.
5. Once Steps 10–14 have passed, Task 10's backup `before-admin-005` (the Neon branch or `~/Backups/kevinwong-before-admin-005.dump`) can be deleted. Keep `before-admin-007` for a month.

---

### Task 19: Remove the env fallbacks a week after the reconnect

**Model:** Opus for Steps 3–6 (one dispatch; Step 4.1 changes `createSpotifyClient`'s refresh path, which Task 6 ran on Opus for concurrency). Sonnet for Steps 1 and 9, which edit only `TODO.md`.
**Files:**
- Modify: `TODO.md` (Step 1 re-dates Task 10's `Reconnect Spotify` item and adds a dated cleanup item; Step 9 deletes the cleanup item)
- Modify: `lib/spotify.js` (`createSpotifyClient`'s `refresh`: the `env.refresh_token` read and the env-only branches)
- Modify: `lib/spotify-oauth.js` (`spotifyCredentials`: the `?? env.client_id` and `?? env.client_secret` fallbacks)
- Modify: `scripts/spotify-reauth.mjs` (the doc comment at the top, `--whoami`'s env source, its `42703` branch, the USAGE line for `--whoami`, the no-option closing text, the missing-credentials message)
- Modify: `lib/admin/status.js` (`buildAdminStatus` drops the `"env"` state and its `env` option)
- Modify: `components/admin/types.ts` (`SpotifyState`), `components/admin/SpotifyCard.tsx` (the `env` alert), `lib/admin/messages.js` (`spotifyBadge`'s `env` entry)
- Modify: `next.config.js` (only if the comment above `async headers()` still names `client_id`, `client_secret` or `refresh_token`), `README.md`
- Test: `tests/spotify.test.mjs` (Task 6), `tests/spotify-oauth.test.mjs` (Task 7), `tests/integration/admin-status.test.mjs` (Task 15), `tests/admin/dashboard-messages.test.mjs` (Task 17)

**Interfaces:**
- Consumes:
  - `createSpotifyClient({ store, fetchImpl = fetch, now = Date.now, env = process.env, recheckMs = 60_000, storeTimeoutMs = REQUEST_TIMEOUT_MS })` (Task 6); the three store calls are bounded by `storeTimeoutMs`. `env` stays, for the `SPOTIFY_*` credentials. Its test file's helpers: `setup({ row, env, token, apiResponses })` returning `{ client, store, calls: { reads, token, api, rotated, dead }, at(ms) }`, plus `ENV`, `live(refreshToken)`, `tokenOk(accessToken, extra)`, `api()` and `basic(id, secret)`. A token call with nothing queued fails the test.
  - `spotifyCredentials(env = process.env)` (Task 7), which throws `Error("Spotify client credentials are not set")`.
  - `buildAdminStatus({ db, env, now })` (Task 15), and its integration test's `status(o)`, `SECRETS`, `NOW` and `db`.
  - `spotifyBadge(state)` in `lib/admin/messages.js` and `SpotifyState` in `components/admin/types.ts` (Task 17).
  - Task 10's TODO item `### 🎧 Reconnect Spotify (by ~2026-12-30)` under `## 📅 Dated`, and the four dates from Task 18 Step 13: `reconnected_on`, `cleanup_from`, `reconnect_by`, `estimated_expiry`.
- Produces:
  - `buildAdminStatus({ db = getDbPool(), now = new Date() } = {})`. `spotify.state` becomes `"connected" | "dead" | "missing"`. An `env` option is ignored.
  - `spotifyCredentials(env)` reads only `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`.
  - With no `spotify` row, `lib/spotify.js` is dead, like a row with a `deadReason`: it throws `SpotifyReauthRequiredError` without network I/O.

- [ ] **Step 1: Date the reconnect and the cleanup in TODO.md (on the reconnect day, after Task 18 Step 13)**

Use the four dates Kevin sends. Under `## 📅 Dated`:
1. Replace Task 10's whole `### 🎧 Reconnect Spotify (by ~2026-12-30)` section with:

   ```markdown
   ### 🎧 Reconnect Spotify (by ~RECONNECT_BY)

   Spotify refresh tokens die six months after they're approved, and refreshing doesn't extend that (the
   README's *Spotify token* section has the details). The current token was approved from /admin on
   **RECONNECTED_ON**, so it dies around **ESTIMATED_EXPIRY**. The panel's Spotify card counts down to it.

   - [ ] **Reconnect from the admin panel:** https://www.kevinwong.co/admin → Spotify card → **Reconnect** →
     approve on Spotify. It takes effect within a minute, with no redeploy. Fallback:
     `npm run spotify:reauth -- --save` (README, *Spotify token*).
   - [ ] **Update this section's dates** from the panel's new estimate, and set a reminder for about 5 months
     after the reconnect.
   ```

2. Directly after it, add:

   ```markdown
   ### 🧹 Remove the Spotify env fallback (not before CLEANUP_FROM)

   Spotify was reconnected from /admin on RECONNECTED_ON, so its token now lives in Postgres. The code still
   falls back to the old `refresh_token` env var when there is no `spotify` row, and still accepts the
   lowercase `client_id` / `client_secret`. After a week with no trouble:

   - [ ] **Check the week went well.** /admin shows Spotify **Connected** with no dead reason, and Now Playing
     works.
   - [ ] **Remove the fallbacks in code and deploy** (Task 19 of [the admin panel plan](docs/superpowers/plans/2026-10-16-admin-panel.md)).
   - [ ] **Delete `refresh_token`, `client_id` and `client_secret`** from the Vercel project (every
     environment) and from `.env`, then redeploy, since a deployment keeps the env vars it was built with.
   ```

```sh
git add TODO.md
git commit -m "Date the Spotify reconnect and the env cleanup in TODO"
```

It ships with the next deploy and needs no deploy of its own.

- [ ] **Step 2: Kevin: on or after CLEANUP_FROM, confirm the week went well**

In the main checkout, with the `prodsql` helper from Task 18 Step 9, item 3 (define it again in a new terminal):

```sh
cd /Users/Kevin/Git/kevinwong.co
prodsql "select authorized_at, dead_reason, account_id is not null as has_account from integration_tokens where provider = 'spotify'"
curl -s https://www.kevinwong.co/api/nowplaying
```

Expected: `authorized_at` is at least 7 days ago, `dead_reason` is `null`, and `has_account` is `true`. The `curl` output is JSON, with `"isPlaying":true` while something is playing. On `/admin`, the Spotify card shows **Connected**. If anything is wrong, stop: reconnect, or fix the cause, before removing anything.

- [ ] **Step 3: Update the tests to the post-cleanup behaviour (they fail first)**

First record the baseline:

```sh
env -u DATABASE_URL node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/spotify.test.mjs tests/spotify-oauth.test.mjs tests/integration/admin-status.test.mjs tests/admin/dashboard-messages.test.mjs
```

Expected: `ℹ fail 0`, `ℹ cancelled 0` and no `﹣` skip line. Write down its `ℹ tests` count, N. It is above 0.

Then make these edits.

`tests/spotify.test.mjs` (Task 6):
- Replace test (f) with:

  ```js
  test("(f) with no row the client is dead, even with env.refresh_token set, and Spotify is never called", async () => {
    const s = setup({ row: null, env: { ...ENV, refresh_token: "env-rt" } }); // nothing queued: a token call fails the test
    await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError);
    await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError); // latched: no second read within 60 s
    assert.equal(s.calls.reads, 1);
    s.at(60_000);
    await assert.rejects(s.client.getNowPlaying(), SpotifyReauthRequiredError);
    assert.equal(s.calls.reads, 2);
    assert.equal(s.calls.token.length, 0);
  });
  ```

- Replace test (h3), which loses its env half, with:

  ```js
  test("(h3) no rotation write for the same token echoed back", async () => {
    const echoed = setup({ row: live("rt-A"), token: [tokenOk("AT1", { refresh_token: "rt-A" })], apiResponses: [api()] });
    await echoed.client.getNowPlaying();
    assert.deepEqual(echoed.calls.rotated, []);
  });
  ```

- Replace test (k) with:

  ```js
  test("(k) only SPOTIFY_CLIENT_ID/SECRET reach the Basic header; the lowercase names are ignored", async () => {
    const both = setup({ row: live("rt-A"), env: { SPOTIFY_CLIENT_ID: "new-id", SPOTIFY_CLIENT_SECRET: "new-secret", client_id: "old-id", client_secret: "old-secret" }, token: [tokenOk("AT1")], apiResponses: [api()] });
    await both.client.getNowPlaying();
    assert.equal(both.calls.token[0].init.headers.Authorization, basic("new-id", "new-secret"));
    for (const env of [{ client_id: "old-id", client_secret: "old-secret" }, {}]) {
      const s = setup({ row: live("rt-A"), env });
      await assert.rejects(s.client.getNowPlaying(), { message: "Spotify client credentials are not set" });
      assert.deepEqual([s.calls.reads, s.calls.token.length], [0, 0]);
    }
  });
  ```

- Keep `(g) a database error rejects the getter and never falls back to the env token` exactly as it is. The plan header's Review Focus pins its name.

`tests/spotify-oauth.test.mjs` (Task 7): replace `spotifyCredentials prefers SPOTIFY_* and falls back to the lowercase names` with:

```js
test("spotifyCredentials reads only SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET", () => {
  assert.deepEqual(spotifyCredentials({ SPOTIFY_CLIENT_ID: "new-id", SPOTIFY_CLIENT_SECRET: "new-secret", client_id: "old-id", client_secret: "old-secret" }), { clientId: "new-id", clientSecret: "new-secret" });
  for (const env of [{ client_id: "old-id", client_secret: "old-secret" }, { SPOTIFY_CLIENT_ID: "new-id", client_secret: "old-secret" }]) {
    assert.throws(() => spotifyCredentials(env), { message: "Spotify client credentials are not set" });
  }
});
```

`tests/integration/admin-status.test.mjs` (Task 15):
- Replace `spotify: env when there is no row but env.refresh_token is set` with:

  ```js
  test("spotify: missing when there is no row, even with env.refresh_token set", async () => {
    assert.deepEqual((await status({ env: { refresh_token: SECRETS.envRefresh } })).spotify, {
      state: "missing", authorizedAt: null, expiresAt: null, daysLeft: null, accountMatches: null,
      scopes: null, missingScopes: null, deadReason: null });
  });
  ```

- In `never returns or selects a token`, change `assert.match(envState, /"state":"env"/)` to `assert.match(envState, /"state":"missing"/)`.

  Both tests keep passing `env`: the option is now ignored, and the assertions prove the env var no longer matters.

`tests/admin/dashboard-messages.test.mjs` (Task 17): in `spotifyBadge labels each state`, delete the `spotifyBadge("env")` assertion.

Run the baseline command again. Expected: `ℹ tests N` (unchanged), `ℹ fail 5` and `ℹ cancelled 0`. The five are (f), (k), the `spotifyCredentials` test and the two status tests. (h3) and the badge test still pass, because they only lost assertions.

- [ ] **Step 4: Remove the fallbacks**

1. **`lib/spotify.js`.** In `createSpotifyClient`'s `refresh`, a missing row latches dead exactly like a row with a `deadReason`: `const refreshToken = row && !row.deadReason ? row.refreshToken : null;`, then the existing `latchDead` path, with no I/O until `recheckMs` passes. Delete the `env.refresh_token` read, `fromDb`, and the env-only `console.warn` about a rotated env token. The `markSpotifyDead` and `storeRotatedRefreshToken` calls lose their `fromDb` condition. Keep `deadToken`: test (e3) pins it for stored tokens. Update the module's comments so none mentions the env var.
2. **`lib/spotify-oauth.js`.** `spotifyCredentials` reads `env.SPOTIFY_CLIENT_ID` and `env.SPOTIFY_CLIENT_SECRET` only.
3. **`scripts/spotify-reauth.mjs`.**
   - `--whoami` reads only the database row. Delete the `refresh_token` env source, the `42703` branch and the `DATABASE_URL is not set` branch. With no `DATABASE_URL` it fails like `--save` does (`requireEnv("DATABASE_URL", fileEnv)`). With no row it fails with `No Spotify row: nothing to check. Reconnect from /admin or run \`npm run spotify:reauth -- --save\`.` Drop the `Token source:` line, which could now only say `database row`, and the env branch of the rotated-token message.
   - USAGE: the `--whoami` line becomes `Print which Spotify account the stored token belongs to; no browser`.
   - The no-option closing text keeps only its first line (`Store it with ... or reconnect at https://www.kevinwong.co/admin.`).
   - The missing-credentials message drops `(or the older client_id / client_secret)`.
   - The doc comment at the top: describe `--whoami` as reading the stored row only, and drop any mention of the `refresh_token` env var and of the lowercase `client_id` / `client_secret`. Name the credentials `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`, and don't write the words "env var" anywhere in the file: Step 5's grep refuses them.
4. **`lib/admin/status.js`.** Remove the `env` option and the `"env"` state: no row means `"missing"`. **`components/admin/types.ts`:** `SpotifyState = "connected" | "dead" | "missing"`. **`components/admin/SpotifyCard.tsx`:** delete the `env` alert branch. **`lib/admin/messages.js`:** delete `spotifyBadge`'s `env` entry.
5. **`next.config.js`.** If the comment above `async headers()` still names `client_id`, `client_secret` or `refresh_token`, change it to "The Spotify credentials (SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET) are read from process.env at runtime".
6. **`README.md`** (Task 10's and Task 18's text):
   - `Environment variables`: delete the `refresh_token` row, and drop the lowercase-fallback sentence from the `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` row.
   - The paragraph under that table: "the Spotify refresh token once Spotify has been reconnected" becomes "the Spotify refresh token".
   - `Spotify token`: delete the sentences about the `refresh_token` env var (used until the first reconnect; `--whoami`'s "else the `refresh_token` env var"; the no-option mode printing a token "for the `refresh_token` fallback") and about the lowercase `client_id` / `client_secret` fallback. In **Where the token lives**, replace its last two sentences (from `Until Spotify is reconnected for the first time` through `show their empty states instead.`) with: `With no row, or if the database can't be reached, the Spotify widgets show their empty states.`

- [ ] **Step 5: Run tests and the full checks to verify they pass**

```sh
env -u DATABASE_URL node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-concurrency=1 tests/spotify.test.mjs tests/spotify-oauth.test.mjs tests/integration/admin-status.test.mjs tests/admin/dashboard-messages.test.mjs
env -u DATABASE_URL npm test
npx eslint .
env -u DATABASE_URL npm run build
npx tsc --noEmit
grep -rnE "[eE]nv\.(client_id|client_secret|refresh_token)\b" lib scripts pages components next.config.js
grep -nw "env" lib/admin/status.js lib/admin/messages.js components/admin/types.ts components/admin/SpotifyCard.tsx
grep -nE "client_id|client_secret" README.md
grep -nE 'falls back|`refresh_token` (env var|fallback)' README.md
grep -nE "env var|client_id|client_secret" scripts/spotify-reauth.mjs
```

Expected:
- The focused run: `ℹ tests N` (Step 3's count), `ℹ fail 0`, `ℹ cancelled 0`, and no `﹣` skip line.
- `npm test`: `ℹ fail 0` and `ℹ cancelled 0`.
- ESLint and `tsc` print nothing, and the build exits 0.
- The five `grep` commands print nothing. (`refresh_token` still appears legitimately as the database column and as Spotify's grant parameter; the first grep only matches env reads. The script's grep is case-sensitive: the script itself uses `clientId` / `clientSecret`, and `SPOTIFY_CLIENT_ID` does not match `client_id`.)

- [ ] **Step 6: Commit; Kevin deploys**

```sh
git add lib/spotify.js lib/spotify-oauth.js scripts/spotify-reauth.mjs lib/admin/status.js lib/admin/messages.js components/admin/types.ts components/admin/SpotifyCard.tsx next.config.js README.md tests/spotify.test.mjs tests/spotify-oauth.test.mjs tests/integration/admin-status.test.mjs tests/admin/dashboard-messages.test.mjs
git commit -m "Remove the Spotify env var fallbacks"
```

**Kevin:** deploy from the main checkout. This deploy has no migrations, so there is nothing to apply between the merge and the push:

```sh
cd /Users/Kevin/Git/kevinwong.co
nvm use --silent
git switch main
git pull --ff-only origin main
git merge --ff-only claude/admin-panel || git merge --no-ff claude/admin-panel -m "Merge branch 'claude/admin-panel' (Spotify env cleanup)"
git push origin main
```

Vercel → **Deployments** → wait until the new **Production** deployment for that commit is **Ready**. Then:
- `curl -s https://www.kevinwong.co/api/nowplaying` still returns JSON (`"isPlaying":true` while playing).
- `/admin` shows Spotify **Connected**.

If either fails: Vercel → **Deployments** → the previous Production deployment → **⋯** → **Instant Rollback**. The old env vars are still there until Step 7.

- [ ] **Step 7: Kevin: delete the old env vars, then redeploy**

1. Go to Vercel → the project → **Settings** → **Environment Variables**. For each of `refresh_token`, `client_id` and `client_secret`: **⋯** → **Delete**. Repeat for every environment it is listed under (Production, Preview, Development).
2. In the main checkout, remove them from `.env` without printing any values:

```sh
sed -i '' -E '/^(refresh_token|client_id|client_secret)=/d' /Users/Kevin/Git/kevinwong.co/.env
grep -oE '^(refresh_token|client_id|client_secret|SPOTIFY_CLIENT_ID|SPOTIFY_CLIENT_SECRET)=' /Users/Kevin/Git/kevinwong.co/.env
```

   Expected: only `SPOTIFY_CLIENT_ID=` and `SPOTIFY_CLIENT_SECRET=` are printed (names only). If they are missing, add them to `.env` in an editor, because `npm run spotify:reauth` needs them. Also check `.env.local` if it exists.
3. Redeploy, because a deployment keeps the env vars it was built with. Go to Vercel → **Deployments** → the current Production deployment → **⋯** → **Redeploy** → **Redeploy**. Wait for **Ready**.
4. Check: `curl -s https://www.kevinwong.co/api/nowplaying` returns JSON, `/admin` shows Spotify **Connected**, and `npm run spotify:reauth -- --whoami`, run in the main checkout, prints your Spotify account id (if Spotify rotates the token, this stores the new one; that is expected).

- [ ] **Step 8: Kevin: if something broke**

The fix is never to restore the env vars. Use `/admin` → **Reconnect**, or `npm run spotify:reauth -- --save`, which writes the row directly.

- [ ] **Step 9: Remove the TODO item**

Delete the `### 🧹 Remove the Spotify env fallback (not before CLEANUP_FROM)` section that Step 1 added to `TODO.md`. Then:

```sh
git add TODO.md && git commit -m "Remove the done Spotify env cleanup from TODO"
```

It ships with the next deploy.
