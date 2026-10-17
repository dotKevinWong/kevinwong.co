# Deploy A runbook

Deploy A is the admin panel's first production deployment, and it changes nothing visible. It:

- applies `sql/005`, which lets `integration_tokens` hold a Spotify refresh token;
- applies `sql/006`, which adds the `sync_runs` and `admin_audit_log` tables;
- ships the code that records every Instagram sync run and stops imports at 1,800 uploads in 30 days.

Follow this file from top to bottom. It is Steps 5–11 of Task 10 in [the admin panel plan](2026-10-16-admin-panel.md),
with the review's additions merged in. Steps 1–4 were the session's: the README and TODO changes, their checks,
and a pre-flight of the branch (tests, lint, build and a clean tree).

**Order matters.** Back up, add the env vars, merge into local `main`, apply `005` and `006`, then push. The new
code reads `005`'s columns and writes `006`'s tables, and without `006` every real sync stands down because it
can't record its run. The old code ignores both, so applying them first is safe.

**Where to run it.** Steps 5–10 run in a terminal in the main checkout, `/Users/Kevin/Git/kevinwong.co`, whose
`.env` holds production's `DATABASE_URL` and `CRON_SECRET`. The terminal steps never type or print a secret:
each snippet that needs one reads it from `.env` by name, none prints a URL, password or token, and
`CRON_SECRET` reaches curl on stdin. The one secret you paste is the Spotify client secret, into Vercel's
dashboard in the browser (Step 6).

**Pasting.** Paste one block at a time and check its output against what follows it before going on. Your zsh
treats a `#` on a pasted line as text, not as a comment, so no command here carries one.

## Step 5: back up production

Either (preferred) a Neon branch: Neon Console → the kevinwong.co project → **Branches** → **New branch** → name
`before-admin-005`, parent: the production branch (marked default), data up to **now** (the current point in
time, not schema-only) → **Create branch**. A compute is not needed for a backup; if the dialog adds one, it
scales to zero. Check: the **Branches** list shows `before-admin-005`.

Or a dump. The direct (non-pooler) URL is worked out from `.env` and passed to Docker by name. The dump holds
the live Instagram token, so `umask 077` makes it readable by you alone; the parentheses keep that umask from
outlasting the command:

```sh
cd /Users/Kevin/Git/kevinwong.co
( umask 077 && mkdir -p ~/Backups &&
  PGURL="$(node --env-file=.env -p 'const u = new URL(process.env.DATABASE_URL); u.hostname = u.hostname.replace(/^([^.]+)-pooler\./, "$1."); u.href')" \
    docker run --rm -e PGURL postgres:18 sh -c 'pg_dump --format=custom --no-owner "$PGURL"' > ~/Backups/kevinwong-before-admin-005.dump )
docker run --rm -i postgres:18 pg_restore --list < ~/Backups/kevinwong-before-admin-005.dump | grep -c "TABLE DATA"
```

The last command prints 4 or more (`integration_tokens`, `job_locks`, `instagram_posts`, `instagram_media`). If
zsh says `file exists`, a dump with that name is already in `~/Backups` and was left as it was: rename the old
one and run the block again. Keep the backup until Deploy B's checks pass.

## Step 6: add the new Spotify credential names to Vercel Production

This is the one step where you paste a secret, in the browser. Vercel dashboard → the kevinwong.co project →
**Settings** → **Environment Variables** → add:

- Key `SPOTIFY_CLIENT_ID`, value: the same as `client_id` (Spotify Developer Dashboard → the app → **Settings** →
  *Client ID*, or `client_id` in `.env` in the main checkout). Environments: **Production** only. **Sensitive**
  on. **Save**.
- Key `SPOTIFY_CLIENT_SECRET`, value: the same as `client_secret` (Spotify dashboard → **View client secret**, or
  `.env`). **Production** only, **Sensitive** on, **Save**.

Leave `client_id`, `client_secret` and `refresh_token` exactly as they are. Env vars reach only new deployments,
so this must come before Step 8. Optionally add the same two lines to `.env` in the main checkout; the lowercase
names keep working locally until the cleanup.

## Step 7: merge into local `main`, then apply `005` and `006` to production

Nothing is pushed in this step, so nothing deploys yet.

```sh
cd /Users/Kevin/Git/kevinwong.co
git switch main
git status --short
```

`git status --short` prints nothing. If it prints anything, stop and tell the session.

Deploy A is the branch `claude/admin-panel-deploy-a`. It stays fixed at the reviewed Deploy A work, while
`claude/admin-panel` keeps moving with Deploy B (Tasks 11–19), so merge the fixed one. Check it first:

```sh
git log --oneline -1 claude/admin-panel-deploy-a
```

It prints one line ending `Point the Deploy A runbook at its own fixed branch`. If it prints anything else, or
`unknown revision`, stop and tell the session.

```sh
git pull --ff-only origin main
git merge --ff-only claude/admin-panel-deploy-a || git merge --no-ff claude/admin-panel-deploy-a -m "Merge branch 'claude/admin-panel-deploy-a' (Deploy A)"
nvm use
```

If `nvm use` says the version is not installed, run `nvm install`. Then install the merged dependencies, which
`db:apply` needs because it loads `lib/db.js`:

```sh
npm ci
```

**Look at the target.** Without `--yes`, `db:apply` prints it and stops:

```sh
npm run db:apply -- sql/005_integration_tokens_spotify.sql sql/006_sync_runs.sql
```

Expected on stdout: `Target: ep-<id>.c-4.us-east-1.aws.neon.tech/<db>`, then
`Files:  sql/005_integration_tokens_spotify.sql, sql/006_sync_runs.sql`. Then, on stderr,
``Not a local database. Re-run with --yes (after `--`) to apply.``, and exit 1. Nothing was applied. The target
must be the Neon host **without** `-pooler`. If it names anything else, stop: a `DATABASE_URL` exported in this
shell wins over `.env`, so `unset DATABASE_URL` and run it again.

**Check `.env.local`.** `db:apply` and `instagram:sync` read `.env` and then `.env.local`, and `.env.local` wins,
but the `node --env-file=.env` checks below read `.env` only:

```sh
ls .env.local
```

Expected: `ls: .env.local: No such file or directory`. If the file is there, run this. It prints only the host
and database that the checks below read, in the same form as `Target:`, and the two must be the same:

```sh
node --env-file=.env -p 'const u = new URL(process.env.DATABASE_URL); u.host.replace(/^([^.]+)-pooler\./, "$1.") + u.pathname'
```

If they differ, `.env.local` names another database: stop and tell the session.

**Pre-flight, read-only.** It prints role and schema facts, never the URL:

```sh
node --env-file=.env --input-type=module -e '
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
const { rows } = await pool.query(`select current_user,
       current_schemas(true) as schemas,
       (select tableowner from pg_tables where schemaname = $$public$$ and tablename = $$integration_tokens$$) as owner,
       has_schema_privilege($$public$$, $$CREATE$$) as can_create,
       (select array_agg(provider order by provider) from integration_tokens) as providers;`);
console.log(rows[0]);
await pool.end();'
```

Expected:

```
{
  current_user: '<the role in .env>',
  schemas: '{pg_catalog,public}',
  owner: '<the same role>',
  can_create: true,
  providers: [ 'instagram' ]
}
```

- `current_user` equals `owner`; `schemas` is `{pg_catalog,public}`; `can_create` is `true`; `providers` is only
  `instagram`.
- **If any differ, stop and tell the session before applying.** A `spotify` provider row would stop Deploy A from
  falling back to the env var.
- If Vercel shows Production `DATABASE_URL`'s value, check only that its username matches the `current_user`
  printed above (that is `.env`'s role). Never look at the password. A Sensitive variable can't be shown; Step
  10's check covers that case.
- A `SECURITY WARNING` about `sslmode=require` from `pg` is expected and harmless, here and below.

**Apply.**

```sh
npm run db:apply -- --yes sql/005_integration_tokens_spotify.sql sql/006_sync_runs.sql
```

Expected: the same `Target:` and `Files:` lines, then `applied sql/005_integration_tokens_spotify.sql` and
`applied sql/006_sync_runs.sql`, exit 0. If it fails, stop and tell the session. `main` is not pushed, so nothing
is deployed, and both files are safe to run again.

**Confirm, read-only:**

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
`[ { sync_runs: 'sync_runs', admin_audit_log: 'admin_audit_log' } ]` (a `null` there means `006` did not apply).

**Optional smoke test** of the merged code against production before pushing. It refreshes the Instagram token
if one is due, the same as any run, and writes one `sync_runs` row with trigger `cli`:

```sh
npm run instagram:sync -- --dry-run
```

It prints `DRY RUN — nothing was uploaded or inserted` and the summary, and exits 0.

## Step 8: push, which deploys

First see what the push will deploy:

```sh
git log --oneline origin/main..main
```

It lists Deploy A's commits: Tasks 1–10, including their fix commits, the plan and spec commits `ed7c01f` and
`817dcc1`, and the merge commit if Step 7 needed `--no-ff`. When this runbook was written, local `main` also
held the codebase audit merge `794f829` and its two commits, `559b171` and `fe00650`, not yet pushed. If they
are listed, this push deploys the audit too: its package updates and the `www.kevinwong.co` canonical-URL
change, alongside Deploy A's own changes. Then:

```sh
git push origin main
```

Vercel → **Deployments** → the newest deployment for that commit shows **Production** and **Ready**. If anything
in Steps 9–10 fails, see *If something goes wrong* below.

## Step 9: check Spotify still works

Play a song on Spotify, then:

```sh
curl -sS https://www.kevinwong.co/api/nowplaying
curl -sS "https://www.kevinwong.co/api/toptracks?check=$(date +%s)" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(Array.isArray(j.tracks)?`ok: ${j.tracks.length} tracks`:`FAILED: ${s}`)})'
curl -sS "https://www.kevinwong.co/api/listeningtimeline?check=$(date +%s)" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.is_working===false?`FAILED: ${s}`:`ok: ${Object.keys(j).length} days`)})'
```

Expected: the first contains `"isPlaying":true` and the song's `"title"`; the second prints `ok: 10 tracks`; the
third prints `ok: N days`, with N at least 1 (the listening chart, the only route that needs
`user-read-recently-played`). The query strings force fresh responses past the 24-hour CDN cache. Open
https://www.kevinwong.co/stats: the Top Tracks card lists tracks (not "Top tracks are unavailable right now."),
and the sidebar's Now Playing shows the song. Vercel → **Logs** (Hobby keeps an hour), search `spotify`: no
`[spotify]` errors.

## Step 10: check that runs are recorded

Either wait for the next 05:00 UTC cron, or trigger a dry run now (it uploads nothing; like every run it
refreshes the Instagram token if one is due). `CRON_SECRET` comes from `.env` and reaches curl on stdin, not in
its arguments:

```sh
node --env-file=.env -e 'process.stdout.write(`Authorization: Bearer ${process.env.CRON_SECRET}\n`)' | curl -sS -H @- "https://www.kevinwong.co/api/cron/sync-instagram?dryRun=1"
```

Expected: JSON with `"dryRun":true`, `"blob":"ok"` and `"resize":"ok (sharp …, libvips …)"`. Then read the newest
rows; no token columns are selected and the URL is never printed:

```sh
node --env-file=.env --input-type=module -e '
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
const { rows } = await pool.query(`select id, trigger, dry_run, status, started_at, finished_at, fetched, imported, uploads, deferred, skipped, error_count, error from sync_runs order by started_at desc limit 5`);
console.table(rows);
await pool.end();'
```

Expected: a new row with `trigger` `cron` and `finished_at` set.

- The dry run's row has `dry_run` `true` and ends `ok`, or `partial` with `error_count` above 0. A dry run never
  takes the sync's lease, so it never ends `skipped`.
- After 05:00 UTC there is also a row with `dry_run` `false`. Only a real run like that one can end `skipped`,
  when another run held the lease or the 1,800 ceiling was reached.
- A row that stays `running` for more than 15 minutes means the function was killed: check Vercel → Logs for
  `[cron/sync-instagram]`.
- **If no new `trigger` `cron` row appears after the dry-run curl**, the Production role probably can't write
  `sync_runs`. Search Vercel → Logs for `[instagram-sync] Could not record this run`, which names the error (a
  permission error is code `42501`, "permission denied for table sync_runs"), and tell the session. Real runs
  stand down (import nothing) until that is fixed; dry runs carry on unrecorded.

Optionally, `npm run instagram:token` (read-only status) still shows the token alive.

## Step 11: tell the session Deploy A is done

Reply with the date of Step 8 and whether Steps 9–10 passed. Deploy B (Tasks 11–19) continues on
`claude/admin-panel`; `claude/admin-panel-deploy-a` can be deleted once Deploy A is merged and pushed.

## If something goes wrong

- **Before Step 8**, nothing is deployed: stop and tell the session. `005` and `006` are safe to run again, and
  the deployed code ignores them.
- **After Step 8**, roll the code back: Vercel → **Deployments** → the Production deployment before Deploy A's →
  **⋯** → **Instant Rollback**. If Step 8 also deployed the audit, the rollback takes it out too. The migrations
  stay, because the old code ignores them. Then tell the session.
- **The schema normally stays.** Removing `005` and `006` is not part of a rollback. It has preconditions (the
  code rolled back first, then the `spotify` row deleted) and its own files,
  [`delete-spotify-row.sql`](../../../sql/undo/delete-spotify-row.sql) and
  [`undo-005-006.sql`](../../../sql/undo/undo-005-006.sql). The steps are in the [README](../../../README.md),
  *Database migrations* → *Undoing 005 and 006*.
