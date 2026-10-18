# 👨‍💻 KevinWong.co

💫 A little portfolio built with Next.js and Chakra UI

📋 Open tasks live in [TODO.md](TODO.md): content ideas, retiring Cloudinary, reconnecting Spotify
twice a year, and follow-ups from the last codebase audit.

## 😎 Getting Started

🫡 You are 100% free to copy my site. I just ask that you remove all of my personal information, projects, and writings. 

### 🦾 Prerequisites

- [Node.js](https://nodejs.org/en/) 24 and npm 11. The exact version is pinned in [`.nvmrc`](.nvmrc), so `nvm use` picks it up.
- A Postgres database (production uses Neon) for /snapshots, the Instagram sync, the Spotify
  token and /admin, and a [Vercel Blob](https://vercel.com/docs/vercel-blob) store for /snapshots. See
  *Database migrations*, *Spotify token*, *Admin panel* and *Instagram sync* below.

### 👨‍💻 Installation

1. Clone the repo
   ````sh
   git clone https://github.com/dotKevinWong/kevinwong.co.git
   ````
2. Install NPM packages
   ````sh
   npm install
   ````
3. Put your environment variables in `.env` (see below)
4. Run the development server
   ````sh
   npm run dev
   ````

`npm run lint` runs ESLint (Next's core-web-vitals and TypeScript rules), and
`npm run audit:prod` checks the production dependencies for high-severity advisories.

### 🔑 Environment variables

Next.js reads `.env` and `.env.local`, and so do the scripts in `scripts/`. If a variable is in
both, `.env.local` wins. Both files are git-ignored.

| Variable | What it's for |
| --- | --- |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | Spotify app credentials (now playing, top tracks), read on the server at runtime. Until the cleanup a week after the first reconnect (see [TODO.md](TODO.md)), the old lowercase `client_id` / `client_secret` still work as a fallback |
| `refresh_token` | Spotify's refresh token, **only until Spotify is reconnected**: after that the token lives in Postgres and this is ignored (see *Spotify token*). Removed in the same cleanup |
| `GOODREADS_RSS_URL` | The Goodreads shelf feed behind /bookshelf. Optional: without it the page says the feed isn't configured. `GOODREADS_MAX_BOOKS` sets how many it returns by default (8) |
| `DATABASE_URL` | Postgres (the pooled Neon URL): /snapshots, the Instagram sync and its run history, the Spotify token, and /admin's sign-in, sessions and activity log. Without it the Spotify widgets show their empty states |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob when running locally. In production the connected store supplies credentials |
| `CRON_SECRET` | Authenticates the daily Instagram cron |
| `INSTAGRAM_CLIENT_SECRET` | Only needed for `npm run instagram:token -- --exchange` |
| `BETTER_AUTH_SECRET` | Production only (Vercel). Signs /admin's sessions. Generate it with `openssl rand -hex 32` |
| `BETTER_AUTH_URL` | Production only (Vercel). Exactly `https://www.kevinwong.co`, with no trailing slash |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Production only (Vercel). The GitHub OAuth App behind /admin's sign-in |

The Instagram access token, and the Spotify refresh token once Spotify has been reconnected,
are deliberately not env vars. They live in Postgres in `integration_tokens`
([`sql/001`](sql/001_integration_tokens.sql), [`sql/005`](sql/005_integration_tokens_spotify.sql)),
where the app can refresh, rotate or replace them without a redeploy.

The four auth variables stay out of `.env`, because the panel is switched off everywhere except production
(see *Admin panel*). Don't set `BETTER_AUTH_TRUSTED_ORIGINS`, `BETTER_AUTH_SECRETS` or `TEST` anywhere.
Better Auth reads all three straight from the environment, past the app's own settings: the first two widen its
trusted origins and replace its secret, and a set `TEST` puts it in test mode. So in production
[`lib/auth.js`](lib/auth.js) throws while any of them is set, whatever its value. Better Auth is built on first
use, so the build and the deploy still succeed, and then every admin request answers 500.

### 🗄️ Database migrations

Schema changes live in [`sql/`](sql/), numbered and applied in filename order. Each file is safe to run twice.
Nothing records which files have been applied, so each new one is applied by hand, once, **before** the code
that uses it deploys: after merging into `main`, before `git push` (the push deploys). The currently deployed
code ignores what it adds.

| File | Adds | Needed by |
| --- | --- | --- |
| `001`–`004` | The Instagram token table, its assumed-expiry flag, the Blob asset columns, the sync's run lease | The Instagram sync |
| [`005`](sql/005_integration_tokens_spotify.sql) | Spotify columns on `integration_tokens` | `lib/spotify.js` reading the token from Postgres |
| [`006`](sql/006_sync_runs.sql) | `sync_runs` (one row per sync run) and `admin_audit_log` | The sync recording its runs and its upload ceiling |
| [`007`](sql/007_auth.sql) | Better Auth's `auth_user`, `auth_session`, `auth_account` and `auth_verification` | Signing in to /admin |

To apply one:

1. **Back up production first.** Local development uses the production database too, so there is no other
   copy. Either make a Neon branch (Neon Console → the project → **Branches** → **New branch**, name it
   `before-<file number>`, parent: the production branch, data up to now → **Create**), or take a dump from the
   project root. Docker's `postgres:18` image can dump any server up to 18. Node splits `.env`'s
   `DATABASE_URL` into the `PG*` variables that `pg_dump` reads, switched to the direct (non-pooler) host, and
   Docker passes each to the container by name. So the URL and password are never typed and never appear on a
   command line, on your Mac or in the container. The postgres image has no CA bundle, so macOS's is mounted
   for `verify-full`. The dump holds the live tokens, so `umask 077` and the file's own mode make it readable
   by you alone. A `DATABASE_URL` exported in this shell would win over `.env`, so the block unsets one first,
   and it prints the target it reads before dumping. The parentheses keep the `unset` and the umask from
   outlasting the command:
   ````sh
   ( unset DATABASE_URL && umask 077 && mkdir -p ~/Backups && node --env-file=.env --input-type=module -e '
   import { spawnSync } from "node:child_process";
   import fs from "node:fs";
   const file = process.argv[1];
   let pgEnv, target;
   try {
     const u = new URL(process.env.DATABASE_URL);
     if (u.username === "" || u.password === "") throw 0;
     pgEnv = { PGHOST: u.hostname.replace(/^([^.]+)-pooler\./, "$1."), PGPORT: u.port || "5432", PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: decodeURIComponent(u.pathname.slice(1)) };
     target = `${pgEnv.PGHOST}${u.port ? ":" + u.port : ""}/${pgEnv.PGDATABASE}`;
   } catch { console.error("DATABASE_URL in .env is missing or not a valid URL."); process.exit(1); }
   console.log(`Target: ${target}`);
   const env = { ...process.env, ...pgEnv, PGSSLMODE: "verify-full", PGSSLROOTCERT: "/etc/ssl/certs/host-ca.pem" };
   delete env.DATABASE_URL;
   let out;
   try { out = fs.openSync(file, "wx", 0o600); } catch (e) { console.error(e.code === "EEXIST" ? `${file} already exists, so nothing was written: rename an earlier backup, or delete the empty or partial file of a failed run, then run this block again.` : `Could not create ${file} (${e.code}).`); process.exit(1); }
   let r;
   try { r = spawnSync("docker", ["run", "--rm", "-v", "/etc/ssl/cert.pem:/etc/ssl/certs/host-ca.pem:ro", "-e", "PGHOST", "-e", "PGPORT", "-e", "PGUSER", "-e", "PGPASSWORD", "-e", "PGDATABASE", "-e", "PGSSLMODE", "-e", "PGSSLROOTCERT", "postgres:18", "pg_dump", "--format=custom", "--no-owner"], { env, stdio: ["ignore", out, "inherit"] }); }
   catch (e) { console.error(`docker could not start (${e.code ?? "unknown error"}); no user or password was printed.`); process.exit(1); }
   if (r.error) console.error(`Could not run docker (${r.error.code}).`);
   process.exit(r.status ?? 1);' ~/Backups/kevinwong-before-005.dump ); echo "exit=$?"
   ````
   Expected: `Target: ep-<id>.<region>.aws.neon.tech/<db>`, the Neon host with no `-pooler`, then `exit=0`
   and nothing else. The target never shows the user or the password.
   - **If `Target:` names any other host, the dump read the wrong database:** delete the file it wrote, and
     don't apply anything until `.env` names production.
   - If it says the file already exists, nothing was written, and the file there was left as it was. If that
     file is an earlier backup, rename it. If it is the empty or partial file of a failed run of this block
     (`ls -l ~/Backups` shows its size), delete it. Then run the block again.
   - If it says `docker could not start`, a value from `.env` can't be passed to Docker, and no user or
     password was printed. It also left an empty file: delete the file this block wrote, and fix `.env`
     before trying again.

   Then count what it holds:
   ````sh
   docker run --rm -i postgres:18 pg_restore --list < ~/Backups/kevinwong-before-005.dump | grep -c "TABLE DATA"
   ````
   It prints one line per table, so 4 or more (`integration_tokens`, `job_locks`, `instagram_posts` and
   `instagram_media`, plus `sync_runs` and `admin_audit_log` once `006` is on). **If the dump block printed
   an error or `exit=1`, or the count is lower, the dump failed: don't apply anything.** A failed dump leaves
   an empty or partial file behind under the block's file name, so delete that file before trying again. Or
   make the Neon branch instead.
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
   npm run db:apply -- sql/005_integration_tokens_spotify.sql sql/006_sync_runs.sql
   ````
   `Target:` must name the Neon host without `-pooler`. Then apply them, in order:
   ````sh
   npm run db:apply -- --yes sql/005_integration_tokens_spotify.sql sql/006_sync_runs.sql
   ````
   `--yes` goes after the `--`; npm keeps one that comes before it.

**Undoing 005 and 006.** Rolling the code back (Vercel → Deployments → the previous deployment → ⋯ →
**Instant Rollback**) is the planned way back, and the schema normally stays. After an Instant Rollback, pushes
to `main` don't go live until you undo it with **Undo Rollback** on the project's Production Deployment tile (see
*If something goes wrong* in the [Deploy B runbook](docs/superpowers/plans/2026-10-17-deploy-b-runbook.md)).
Only the code from before Deploy A ignores both files, and once Deploy B is live, Instant Rollback can't reach
it: on Hobby it goes back one deployment only, to Deploy A, whose Spotify code reads `005`'s columns and whose
sync records its runs in `006`'s `sync_runs`. To remove the two migrations as well, back up first (step 1
above).

The SQL is in two files in [`sql/undo/`](sql/undo/): [`delete-spotify-row.sql`](sql/undo/delete-spotify-row.sql)
and [`undo-005-006.sql`](sql/undo/undo-005-006.sql). They are not migrations: setup and
`npm run db:test -- reset` apply only the numbered files in `sql/`. Run them with `db:apply` from the project
root, like the migrations, and not by pasting the SQL into a client: psql, with its default settings, carries
on after a failed statement and would drop the tables anyway. In order:

1. Put the code from before Deploy A live first, in this order:
   1. If Deploy B is live, undo it: roll back to Deploy A, which takes the panel down at once. Remove `007` too
      if you want it gone (*Undoing 007* below).
   2. Revert everything Deploy B and Deploy A brought into `main`, newest first, and push. If a rollback is
      active, the push builds but doesn't go live: promote its deployment with **Undo Rollback**.

   Only then go on. While Deploy A's code is live, removing `005` makes every Spotify refresh fail, so Now
   Playing and Top Tracks stay empty, and without `sync_runs` a real sync stands down and imports nothing.
2. Look at the target. Without `--yes`, `db:apply` prints it and stops, and it must name the Neon host
   without `-pooler`:
   ````sh
   npm run db:apply -- sql/undo/undo-005-006.sql
   ````
3. Then delete the `spotify` row, because `access_token` can't go back to `not null` while that row holds
   none. This throws away the refresh token stored in Postgres, so once the `refresh_token` env var is gone,
   Spotify needs reconnecting once more. There is a `spotify` row only once Spotify has been reconnected, so
   skip this step if it never has been:
   ````sh
   npm run db:apply -- --yes sql/undo/delete-spotify-row.sql
   ````
4. Then undo the schema. This also drops the run history, including the uploads that the 1,800 ceiling
   counts: if `006` goes back on within 30 days, the ceiling starts again from zero (see *Run history and the
   upload ceiling*):
   ````sh
   npm run db:apply -- --yes sql/undo/undo-005-006.sql
   ````
   It prints `applied sql/undo/undo-005-006.sql`. If it prints
   `sql/undo/undo-005-006.sql: column "access_token" of relation "integration_tokens" contains null values`
   instead (Postgres error `23502`) and exits 1, the `spotify` row is still there, and nothing was changed:
   `db:apply` sends each file as one simple query, so Postgres stops at the failing statement and the
   `drop table` after `commit;` never runs. Do step 3, then this step again.

Both migrations are safe to apply again afterwards.

**Undoing 007.** Here too the planned way back is rolling the code back, and the auth tables can stay: the
code from before the admin panel never reads them. Removing them signs everyone out and deletes the owner's
GitHub sign-in record, which the next sign-in creates again. The activity log in `admin_audit_log` keeps
its history. Back up first (step 1 above), naming the backup `before-undo-007`, because the one taken before
`007` went on may still be kept. For the dump, that means changing `kevinwong-before-005.dump` to
`kevinwong-before-undo-007.dump` in two places: the last line of the dump block and the count line. Then:

1. Roll the code back first. While the panel's code is live, Better Auth fails every request without its
   tables.
2. Look at the target. Without `--yes`, `db:apply` prints it and stops, and it must name the Neon host
   without `-pooler`:
   ````sh
   npm run db:apply -- sql/undo/undo-007.sql
   ````
3. Drop the four tables with [`undo-007.sql`](sql/undo/undo-007.sql):
   ````sh
   npm run db:apply -- --yes sql/undo/undo-007.sql
   ````
   It prints `applied sql/undo/undo-007.sql`. The drops run in one transaction, so if it prints
   `sql/undo/undo-007.sql: canceling statement due to lock timeout` instead and exits 1, another session held
   one of the tables for more than 5 seconds, and nothing was dropped. Run it again. If it prints
   `sql/undo/undo-007.sql: cannot drop table <name> because other objects depend on it` (Postgres error
   `2BP01`) instead, something else in the database depends on that auth table, and the undo refused to drop
   it along with the table. Nothing was dropped: find out what depends on it before going further.

It is safe to run twice, and `007` applies again afterwards.

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
production's `DATABASE_URL` (it only reads production). Without `TEST_DATABASE_URL`, `npm test` skips the
integration suites (a `﹣` line in its output means they did not run), and `npm run test:integration` fails
instead, so it can't pass without running them.

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
`400 invalid_grant`, and the app stops calling Spotify and, once a `spotify` row exists, marks it dead
(until the first reconnect, a failed env token has no row to mark). Instances look at the row again at most
once a minute, so once the old token has died, a reconnect takes effect everywhere within a minute, with no
redeploy (see *Reconnecting* for when it still works). If Spotify hands back
a new refresh token, it replaces the stored one only if the row still holds the token that instance used, so a
slow instance can't overwrite a newer one.

**Reconnecting.** Use the admin panel: https://www.kevinwong.co/admin → the Spotify card → **Reconnect** →
approve on Spotify. There is nothing to redeploy (see *Admin panel*). In the usual case, where Spotify has
already rejected the old token, the new one takes effect everywhere within a minute, because instances recheck
a dead row once a minute. If the old token still works, the instance that handled the reconnect switches at
once, and each other instance keeps its cached access token until its next refresh, within an hour. Spotify
keeps working throughout. The fallback is the script:

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
script reads `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` from the environment, `.env` or `.env.local`,
and falls back to `client_id` / `client_secret` until the cleanup a week after the first reconnect (see
[TODO.md](TODO.md)).

[spotify-blog]: https://developer.spotify.com/blog/2026-06-18-refresh-token-expiration

### 🔐 Admin panel

https://www.kevinwong.co/admin is a private dashboard, and nothing on the site links to it. Only GitHub
account `1741711` (`@dotKevinWong`) can sign in. Sessions last 24 hours and do not extend.

It reconnects Spotify. It shows the Instagram token, the last cron run, the library's size, the uploads over
the last 30 days and the recent runs, with **Check for new posts** and **Import** buttons. It also shows the
activity log (`admin_audit_log`).

**Production only.** `/admin`, `/api/admin/*` and `/api/auth/*` return 404 unless `VERCEL_ENV=production` and
the host is `www.kevinwong.co`. That includes `next dev`, every preview, and the production deployment's own
`*.vercel.app` URL. Local development shares the production database, so the panel is switched off there
instead of getting a second sign-in. `npm test` covers it, with unit tests and integration tests against a
throwaway local Postgres.

**Limits.**

| Action | Limit |
| --- | --- |
| Check for new posts (dry run) | Once per 10 minutes |
| Import from the panel | Once per rolling 24 hours. An import that is running, finished (`ok` or `partial`, even with 0 uploads), or was killed mid-way counts, and so does any import that uploaded something. One that failed, stood down because another sync was running, or couldn't record its run, before uploading anything doesn't count |
| Panel imports | Refused once uploads over the last 30 days reach 1,000 |
| Any real sync (cron, panel, CLI) | Stops at 1,800 uploads in 30 days, under Blob's 2,000-a-month hard stop |

Panel runs are fixed at 50 posts, 25 uploads and a 60-second budget. The browser only chooses Check or Import.
A refused run answers 429 with the wait in seconds, and the activity log records it as `panel_run_refused`.

**Signing in.** Four checks keep everyone else out:

- **The profile gate.** Better Auth's `validateUserInfo` hook lets through only the GitHub profile with id
  `1741711`, and sends any other account back to `/admin/sign-in?error=not_owner` before a user, account or
  session is written.
- **Account linking is off**, so no second GitHub account can be attached to the owner's user.
- **The path allowlist.** The `/api/auth/*` route passes only `POST /api/auth/sign-in/social`,
  `GET /api/auth/callback/github` and `POST /api/auth/sign-out` to Better Auth, and answers 404 to every other
  path, `get-session` included.
- **The per-request owner check.** Every admin page and API request reads the session, then checks that its
  user holds the GitHub account `1741711` in `auth_account`, so a session on its own isn't enough.

Better Auth is pinned to exactly `1.7.10`, and so is its CLI, the `auth@1.7.10` devDependency. Upgrade the two
together, and check the disabled paths in [`lib/auth.js`](lib/auth.js) against the new version's routes. Don't
add Better Auth's organization plugin: advisory GHSA-fmh4-wcc4-5jm3 applies only with it. GitHub's Dependabot
alerts are meant to flag new advisories in it; turning them on is in [TODO.md](TODO.md).

**One-time setup.**

1. Create a GitHub OAuth App (GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth
   App**) with homepage `https://www.kevinwong.co` and callback `https://www.kevinwong.co/api/auth/callback/github`.
   Sign-in requests no scopes. Set the four env vars from *Environment variables*, `BETTER_AUTH_SECRET`,
   `BETTER_AUTH_URL`, `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`, in Vercel for **Production** only, each
   with **Type** set to **Secret** (older dashboards: **Sensitive** turned on).
2. In the [Spotify dashboard](https://developer.spotify.com/dashboard), add
   `https://www.kevinwong.co/api/admin/spotify/callback` to the app's Redirect URIs. Keep
   `http://127.0.0.1:8888/callback` there too, for `npm run spotify:reauth`.
3. Apply [`sql/007_auth.sql`](sql/007_auth.sql) as described in *Database migrations*, before the deploy that
   uses it, because Better Auth refuses every request while its tables are missing.
4. Check the result. Run this in the main checkout after `npm ci`, which installs the pinned CLI, so that it
   reads `DATABASE_URL` from `.env`. It only reads:
   ````sh
   npx --no-install auth check --config scripts/auth.config.mjs
   ````
   It prints `Schema check passed against the live database.` and exits 0. It exits 1 on a mismatch and 2 when
   it can't load the config or reach the database. Warnings that the base URL isn't set and that the GitHub
   provider has no client id are harmless here. So is a `◇ injected env (N) from .env` line from dotenv, if one
   appears: it prints a count, not values, and shows only when `DOTENV_CONFIG_QUIET=false` or
   `DOTENV_CONFIG_DEBUG` is set. `--no-install` runs only the pinned copy, and never downloads one.

**Troubleshooting.** The checks below use `prodsql`, a helper for read-only queries. Define it in a terminal
in the main checkout. It reads `DATABASE_URL` from `.env`, so the URL is never typed and never appears in any
process's arguments:

````sh
prodsql() { node --env-file=.env --input-type=module -e '
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
try { console.table((await pool.query(process.argv[1])).rows); } finally { await pool.end(); }' "$1"; }
````

- **`/admin/sign-in?error=not_owner`** means another GitHub account tried to sign in. The dashboard counts
  these above the activity table ("Refused sign-ins in the last 24 hours"), and the table itself never lists
  them.
- **`Database schema mismatch` in the logs** (Better Auth's `SCHEMA_MISMATCH`) means `007` is missing or wrong,
  so run the check above. Ignore its hint to run `npx auth migrate`: the schema comes only from `sql/`. Once
  `007` is fixed and the check passes, redeploy (Vercel → **Deployments** → the newest Production deployment of
  the panel's code → **⋯** → **Redeploy**), because each running instance keeps the mismatch it found until it
  restarts. After an Instant Rollback, the new deployment doesn't go live until **Undo Rollback** promotes it.
- **A 500 from the panel** writes one redacted line to Vercel → **Logs**, never a token. The two admin pages
  (`/admin`, `/admin/sign-in`) then also log Next's own `Error: Admin page unavailable`, whose stack trace holds
  nothing secret, and render Next's built-in 500 page.
  - `[admin] owner check failed:` (`[admin/spotify] owner check failed:` on the Spotify routes): the owner
    check itself failed. The cause is the database, Better Auth's schema check, or one of the production checks
    on the env vars in `lib/auth.js`, which reads `Error: BETTER_AUTH_URL is not set`,
    `Error: BETTER_AUTH_URL must be https://www.kevinwong.co`,
    `Error: BETTER_AUTH_SECRET must be set to at least 32 characters`,
    `Error: BETTER_AUTH_TRUSTED_ORIGINS must not be set`, `Error: BETTER_AUTH_SECRETS must not be set` or
    `Error: TEST must not be set`. The API routes answer `{"error":"server_error"}`. Fixing an env var takes a
    redeploy, because a deployment keeps the env vars it was built with: correct it in Vercel, then
    **Deployments** → the newest Production
    deployment of the panel's code → **⋯** → **Redeploy**. After an Instant Rollback, that isn't the current
    Production deployment, and the new one doesn't go live until **Undo Rollback** promotes it (see the
    Deploy B runbook's *If something goes wrong*).
  - `[auth] request failed:`: Better Auth failed during sign-in, its callback or sign-out, including on the
    env-var checks above, and `/api/auth/*` answers `{"error":"server_error"}`.
  - `[admin/status] status read failed:`: `/api/admin/status` answers `{"error":"status_failed"}`, and the
    dashboard says it couldn't load the status.
  - `[admin/instagram] sync failed:`: the Check or Import run itself threw, answered with
    `{"error":"sync_failed"}`. `[admin/instagram] request failed:`: the limits read or the slot claim failed,
    answered with `{"error":"server_error"}`.
- **`/admin?spotify_error=<code>`** after a reconnect. Nothing was stored in any case:
  - `denied`: Approve was not clicked on Spotify's page.
  - `state_mismatch`: the 10-minute cookie expired or the flow came from elsewhere, so start again.
  - `exchange_failed`: Spotify refused the code. Start again, and check that the redirect URI is registered.
  - `missing_scopes`: a permission was unticked on Spotify's page. Approve all of them.
  - `account_lookup_failed`: Spotify's profile lookup failed. Try again.
  - `wrong_account`: approved with a different Spotify account than the site's.
  - `not_configured`: `SPOTIFY_CLIENT_ID` or `SPOTIFY_CLIENT_SECRET` is missing in Vercel Production.
  - `save_failed`: the database write failed. Try again.
- **Import stays disabled after an import that failed.** Each Import claims a 24-hour slot, the `job_locks`
  row `instagram-panel-import`, before it runs. Only an import that failed or stood down before uploading
  anything gives the slot back, because such an import doesn't count. One that finished, `ok` or `partial`, uses
  up the 24 hours even with 0 uploads, for example when every new post failed or the cron had already imported
  them (D4: one import per rolling 24 hours). If giving the slot back fails (the logs show
  `[admin/instagram] limit re-read failed:` or `import slot release failed:`), or the request fails some other
  way after the claim (`[admin/instagram] request failed:`, or the function stopped before the run was
  recorded), Import stays disabled for up to 24 hours, though **Recent runs** shows no import that counts.
  Look first:
  ````sh
  prodsql "select locked_until, locked_until > now() as held from job_locks where name = 'instagram-panel-import'"
  prodsql "select status, uploads, started_at from sync_runs where job = 'instagram' and trigger = 'panel' and not dry_run order by started_at desc limit 1"
  ````
  Clear the slot only when `held` is `true` and the second query shows no `running` import: its row's
  `status` is not `running`, or it prints no row at all, because the import that claimed the slot never
  recorded a run. A `running` import is either still going or was killed, and a killed one counts anyway. To
  clear it:
  ````sh
  node --env-file=.env --input-type=module -e '
  import pg from "pg";
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
  try { console.log({ updated: (await pool.query(process.argv[1])).rowCount }); } finally { await pool.end(); }' "update job_locks set locked_until = 'epoch' where name = 'instagram-panel-import'"
  ````
  It prints `{ updated: 1 }`. This never lifts the daily limit itself: each Import is checked against
  `sync_runs` first, so an import that really counts still blocks the next one for 24 hours.

### 📸 Instagram sync

`/snapshots` is served from Postgres (`instagram_posts` / `instagram_media`) with the
media stored in [Vercel Blob](https://vercel.com/docs/vercel-blob). A daily Vercel Cron
job (05:00 UTC, set in [`vercel.json`](vercel.json)) pulls new posts from the Instagram API.
It downloads each photo and video, measures it, uploads it to Blob, and fills those tables.

**Account requirement.** The Instagram Basic Display API was shut down on 2024-12-04, and
personal accounts now have no API access at all. The account must be an Instagram
**professional** account (Creator or Business), used through
[Instagram API with Instagram Login][ig-login]. No App Review is needed to read your own
account: keep the Meta app in Development mode with your account on it.

**Captions.** Meta's docs badge the `caption` field "Available for Instagram API with
Facebook Login only". In practice an Instagram Login token reads it fine (verified
2026-09-26), so the sync requests it. If Meta ever starts enforcing that badge, every
sync will fail with error code `100`. Re-check any time with:

````sh
npm run instagram:sync -- --probe-caption
````

[TODO.md](TODO.md) says what to do if it reports captions as unsupported.

#### One-time setup

1. Apply the migrations in [`sql/`](sql/) as described in *Database migrations* above. They
   only cover changes made since the sync was added. The base `instagram_posts` and
   `instagram_media` tables and the `media_kind` enum are older and aren't in the repo yet
   (see [TODO.md](TODO.md)), so on an empty database create those first.
2. Create a **Public** Blob store (Vercel dashboard → Storage → Create → Blob) and
   connect it to the project, which gives production its credentials. Locally, put the
   store's `BLOB_READ_WRITE_TOKEN` in `.env`. The store must be Public, because /snapshots
   serves the files straight into `<img>` and `<video>`.
3. Set `CRON_SECRET` in Vercel. Any long random string works, and the cron endpoint refuses
   to run without it. Generate one with `openssl rand -hex 32`.
4. In the Meta App Dashboard, go to **Instagram → API setup with Instagram business
   login** and click **Generate token**. No OAuth redirect flow is needed for a single
   account.
5. Store the token, which also validates it against the API. Pass it through the
   environment rather than as an argument, so it stays out of your shell history:
   ````sh
   INSTAGRAM_ACCESS_TOKEN=<TOKEN> npm run instagram:token
   ````
   Don't keep `INSTAGRAM_ACCESS_TOKEN` in a `.env` file: the token lives in Postgres, and the
   script only reads it from the command line's environment.
6. Reconcile the posts that came from the old data-export import. This is only needed for
   rows imported from an Instagram "Download Your Information" ZIP, and it's already done here. The first
   command is a dry run; the second applies it:
   ````sh
   npm run instagram:repair
   npm run instagram:repair -- --apply
   ````
7. Dry-run the sync, then let it run for real:
   ````sh
   npm run instagram:sync -- --dry-run
   npm run instagram:sync
   ````
   The script rejects arguments it doesn't know. If the `--` is forgotten
   (`npm run instagram:sync --dry-run`), it still does a dry run and says so.
8. After deploying, check the deployed function from outside. A dry run uploads nothing to
   Blob and writes nothing to the posts tables. Like every run, though, it refreshes the
   stored Instagram token when one is due, or marks it dead on a confirmed error `190`.
   Look for `"blob":"ok"` and `"resize":"ok (sharp …, libvips …)"`. `printf` is a shell builtin and curl
   reads the header on stdin, so the secret never appears in a process's arguments. `read -rs` waits for you
   to paste it and press Return, and doesn't echo it. Run that line on its own, then the `printf` line:
   ````sh
   read -rs CRON_SECRET && export CRON_SECRET
   printf 'Authorization: Bearer %s\n' "$CRON_SECRET" | curl -sS -H @- "https://www.kevinwong.co/api/cron/sync-instagram?dryRun=1"
   ````
   Or, from a checkout whose `.env` holds `CRON_SECRET`, skip the `read` and let node write the header:
   ````sh
   node --env-file=.env -e 'process.stdout.write(`Authorization: Bearer ${process.env.CRON_SECRET}\n`)' | curl -sS -H @- "https://www.kevinwong.co/api/cron/sync-instagram?dryRun=1"
   ````
   Each run, this one included, adds a row to `sync_runs` (see *Run history and the upload
   ceiling*).

`vercel.json` sets `"fluid": true`. This project predates Fluid compute being the default
(April 2025). Without it, Hobby functions stop at 60 seconds, and the sync is written to use
up to 300. [`lib/db.js`](lib/db.js) registers its Postgres pool with `attachDatabasePool`
from `@vercel/functions`, so idle connections are closed before a Fluid instance suspends.

#### Blob storage and the Hobby plan

Each file lives at `snapshots/<YYYYMM>/<shortcode>-<slide>.<ext>`. The shortcode is the
post's Instagram URL, so the store's file browser maps straight back to Instagram.

The API hands out full-resolution photos (up to 4096px, ~1.4 MB). The sync uses sharp to
shrink them to 1440 wide, like the export-era photos, and at most 1920 tall, which is
Instagram's tallest (3:4) format. They are saved as mozjpeg quality 80, which averages
~290 KB and matches the export-era average ([`lib/image-resize.js`](lib/image-resize.js)).
JPEGs already within that size are stored untouched, and /snapshots shows 3:4 portraits
uncropped.

sharp is loaded lazily, on the first photo a run processes rather than when the module
loads. If it ever failed to load on Vercel, the token refresh and video posts would carry
on, and the dry run would say so. Videos are stored as they come: re-encoding video needs
ffmpeg, which a function doesn't have. The page only downloads a video's metadata until
someone presses play.

The Hobby plan includes 1 GB of Blob storage, 2,000 uploads a month, 10,000 "simple
operations" a month (a cache miss when someone views a file counts as one) and 10 GB of Blob
data transfer a month. **Going over any of these is a hard stop, not a bill: Blob is locked
for up to 30 days and every image on /snapshots goes blank.** About 80 MB (as of 2026-09-26)
and a few uploads a day are far inside that. The thing to watch is transfer, if the page
ever gets heavy traffic or hotlinking. Usage is under the store's **Usage** tab.

#### Moving from Cloudinary

The media used to be mirrored to Cloudinary. On 2026-09-26:

- [`sql/003`](sql/003_asset_columns.sql) added nullable `asset_*` columns next to `cloudinary_*`.
- `npm run snapshots:blob -- --apply` copied all 133 files (79.4 MB) into Blob, and
  `-- --verify` passed: every object is present, sizes match, and videos serve 206.
- The switch deploy made the read path prefer `asset_*`, falling back to `cloudinary_*`.

New posts go straight to Blob. They are also mirrored into `cloudinary_*` until those columns
are dropped, so an Instant Rollback to the pre-switch code still renders them.

#### Retiring Cloudinary

This is still to do, not before 2026-10-27. The ordered steps and their SQL are in
[TODO.md](TODO.md). The column drop is deliberately **not** a file in `sql/`. Setup applies
that folder in order, and running it early would break the old code.

#### How duplicates are prevented

Posts are keyed by `source_key = ig:<shortcode>`, where the shortcode comes from the
permalink, so a post already in the table is recognised and skipped.

The first 21 posts came from an Instagram "Download Your Information" ZIP. They were keyed
by paths *inside that archive*, which the API can never match. `npm run instagram:repair`
converted them to the same `ig:` form:

- Posts with a permalink used it directly.
- The 18 without one were matched to their real post by timestamp (to within 5 seconds,
  and only when exactly one post matched). This also filled in their missing Instagram link.

Each original key is kept in `raw_post_json.legacy_source_key`.

#### How far back the page goes

`SNAPSHOTS_START` in [`lib/instagram-sync.js`](lib/instagram-sync.js) is the oldest post
the page shows, currently **2022-01-01**. The 47 posts from 2014–2021 are ignored.

To go further back, move that date earlier. The daily sync only reads the newest 50 posts,
so it only backfills older posts that fall inside those, at 25 uploads per run. For anything
older, do it in one go locally with a higher `--max-posts`:

````sh
npm run instagram:sync -- --max-posts=200 --max-uploads=500
````

A backfill spends the same 1,800-in-30-days ceiling as the daily sync: `--max-uploads` is cut to what is left
(see [*Run history and the upload ceiling*](#run-history-and-the-upload-ceiling)).

#### Token lifetime

Long-lived Instagram tokens last 60 days, but **refreshing resets the full window**. So the
daily cron keeps the token alive indefinitely, unlike Spotify, where the six-month clock
cannot be extended. The cron refreshes once the token is within 30 days of expiry. That
leaves ~30 days of slack, because [Vercel cron delivery is best effort][cron-limits]. If a
refresh fails on a network error, a timeout or a 5xx, the run logs a warning, carries on with
the still-valid token, and tries again the next day.

A token left unrefreshed for 60 days is dead permanently. When that happens, the API
returns error code `190`. The sync records it in `integration_tokens.dead_reason`, stops
calling the API, and logs what to do. Before setting that flag, the code re-checks the token
with a second request, so a transient error cannot brick the integration. It also only marks
the row dead if the row still holds the token that failed, and a refresh only saves its new
token if the row still holds the old one, so a run that started before a re-seed can't undo
it. Recover by generating a new token and re-seeding it.

Check status any time with `npm run instagram:token` (no arguments). It only reads.

#### Run history and the upload ceiling

Every run, from the cron, `npm run instagram:sync` or the panel, adds a row to `sync_runs`
([`sql/006`](sql/006_sync_runs.sql)): what started it, whether it was a dry run, how it ended (`ok`,
`partial` when some posts failed, `skipped`, `failed` or `reauth_required`) and its counts. On a dry run,
`imported` and `uploads` are what the run would have done. Errors and the stored summary are redacted
first. A row still `running` after 15 minutes, once the sync's lease has expired,
belongs to a run that was killed; the next run marks it `abandoned`, keeping the uploads it recorded.

Real runs stop importing once the last 30 days of runs have uploaded 1,800 files, which leaves room under
Blob's 2,000-a-month hard stop, and each run caps its uploads to what is left. The ceiling is slightly soft:
the oldest missing post is always processed whole, so one carousel can take a run up to 19 past it. Each
upload is added to its run's row as soon as it lands, so a run killed partway still counts what it uploaded,
and a real run that can't write its row stands down without importing. Dry runs don't count, and neither do
uploads by `npm run blog:image` or `npm run snapshots:blob`. The count is of uploads that completed. Blob also
meters the SDK's retries and puts cut off by a timeout, which is what the 200-file margin absorbs.

When the ceiling stops `npm run instagram:sync`, its headline reads
`Stopped — 1,800 uploads in the last 30 days reached`, and `30-day upload ceiling reached` is listed under
*Skipped*. When a real run can't write its row, the headline reads
`Not run — the run could not be recorded (database error)` and the command exits 1. The log line
`[instagram-sync] Could not record this run:` names the error.

[ig-login]: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
[cron-limits]: https://vercel.com/docs/cron-jobs/usage-and-pricing

### 🖼️ Blog cover images

Each post's `og_image` is its link-preview image and its thumbnail on /blog. It lives in the
same Blob store as /snapshots. To add or replace one:

````sh
npm run blog:image -- path/to/cover.jpg my-post-slug --update
````

It takes a local file or a URL and shrinks it to fit 1440×1920 as a JPEG, because link-preview
crawlers do not all accept WebP. A JPEG that already fits and carries no EXIF, XMP or IPTC
metadata is uploaded as-is; anything else is re-encoded, which strips metadata such as a
phone photo's GPS location. The file goes to `blog/<slug>-<hash>.jpg`, and `--update` writes
the URL into `posts/<slug>.mdx`.

The hash means a replacement cover gets a new URL. Blob files are cached by browsers for a
year, so reusing a URL would keep showing the old image. The previous file is left in the store.

## 📝 License
This project is licensed under the MIT License. See the [LICENSE](LICENSE.md) file for more information.

🗣️ All images, personal information, projects, and writings are not to be used without my permission and are not covered under the MIT License. You must remove all of my images, personal information, projects, and writings before using this project.
