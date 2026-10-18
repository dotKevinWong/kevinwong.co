# Deploy B runbook

Deploy B ships the admin panel at https://www.kevinwong.co/admin. It:

- applies `sql/007`, Better Auth's four tables: `auth_user`, `auth_session`, `auth_account` and `auth_verification`;
- ships GitHub sign-in through Better Auth, limited to your account (`1741711`);
- ships the dashboard, the Spotify reconnect, and the Instagram **Check for new posts** and **Import** buttons.

Follow this file from top to bottom. It is Steps 5–14 of Task 18 in [the admin panel plan](2026-10-16-admin-panel.md),
with the review's additions merged in, and the sign-in page and dashboard checklists (Task 16 Step 10 and Task 17
Step 10) folded into Steps 11–14. Steps 1–4 were the session's: the README, a tested undo for `007`, their checks,
and a pre-flight of the branch.

**Order matters.** The gate below comes first. Steps 5–7 (the GitHub OAuth App, the four env vars and the Spotify
redirect URI) can happen any time before Step 9, because nothing reads them until Deploy B ships. Step 8, the
backup, comes right before Step 9. In Step 9, `007` goes on before the push, because Better Auth refuses every
request while its tables are missing. The deployed Deploy A code never reads them, so applying first is safe.

**Where to run it.** The terminal steps run in the main checkout, `/Users/Kevin/Git/kevinwong.co`, whose `.env`
holds production's `DATABASE_URL`. The gate is the exception: it runs in a temporary checkout with no `.env` at all.
No terminal step types or prints a secret: each snippet reads `DATABASE_URL` from `.env` by name, and none prints a
URL, password or token. The two secrets you handle, `BETTER_AUTH_SECRET` and GitHub's client secret, go from the
clipboard straight into Vercel's dashboard in the browser (Step 6). Never paste a secret into chat or onto a command
line.

**Pasting.** Paste one block at a time, and check its output against what follows it before going on. Your zsh
treats a `#` on a pasted line as text, not as a comment, so no command here carries one.

## Before you start

### The Spotify id gate

The panel's reconnect accepts only the Spotify account named in `lib/admin/owner.js`. While that file still holds
the placeholder `<from --whoami>`, every reconnect ends `wrong_account`, and two tests are still marked todo. The
session fills in your account id in its own commit, the newest on the Deploy B branch `claude/admin-panel-deploy-b`.
Check that branch, not your main checkout:

```sh
cd /Users/Kevin/Git/kevinwong.co
git log --oneline -2 claude/admin-panel-deploy-b
```

It prints two lines. The first is the session's commit that fills in your Spotify account id, and the second ends
`Document the admin panel`. If it prints anything else, or `unknown revision`, stop and tell the session.

Then check the branch out on its own, in a temporary folder with no `.env`, so its tests can't reach production:

```sh
git worktree add --detach /tmp/kw-deploy-b-gate claude/admin-panel-deploy-b
cd /tmp/kw-deploy-b-gate
nvm use --silent
npm ci
```

If `git worktree add` says the folder already exists, an earlier gate run left it behind: run the
`git worktree remove` block at the end of this section first. `npm ci` takes a minute. An
`npm warn install-scripts` about `unrs-resolver` is harmless. Then:

```sh
grep -c '<from --whoami>' lib/admin/owner.js
env -u DATABASE_URL npm test 2>&1 | grep '^ℹ'
```

Expected: `grep -c` prints `0`. The test summary shows `ℹ fail 0`, `ℹ cancelled 0` and `ℹ todo 0`. This folder has
no `.env.test.local`, so the integration suites skip themselves, which the `grep` hides. That is expected here,
because the session ran them against its test database.

**If `grep -c` prints `1`, or `todo` is not `0`, stop and tell the session.** The id is not in this branch, and the
deploy would ship a reconnect that always fails.

Either way, remove the temporary folder:

```sh
cd /Users/Kevin/Git/kevinwong.co
git worktree remove /tmp/kw-deploy-b-gate
```

### Deploy A is done

Deploy B needs Deploy A's tables (`sync_runs`, `admin_audit_log`) and is built on its code. Deploy A's fixed branch
ended at `ff9537a`:

```sh
git fetch origin
git merge-base --is-ancestor ff9537a origin/main && echo "Deploy A is on origin/main"
```

It prints `Deploy A is on origin/main`. If it prints nothing, or an error, Deploy A has not been pushed: follow
[the Deploy A runbook](2026-10-17-deploy-a-runbook.md) first.

### What the session checked

On the branch, the session ran:

- `npm test` against its local test database, with `ℹ fail 0`, `ℹ cancelled 0` and no `﹣` line, so every
  integration suite ran. Its count was `todo 2`, because the Spotify id was still the placeholder; the gate above is
  what checks that it is now filled in;
- ESLint;
- a build with no auth env vars;
- `tsc`;
- `npm run audit:prod`. Nothing in Better Auth's tree. It still exits 1 on the advisories that were already on
  `main` (`next` below 16.3.8, `sharp` below 0.35.5 and `source-map-js`), which your advisory task covers;
- `git status --short`, which came back clean.

The undo for `007` (*If something goes wrong*, below) is tested the same way. In those tests it drops the four tables
in one transaction, is safe to run twice, and leaves `007` able to apply again.

## Step 5: create the GitHub OAuth App (any time before Step 9)

1. github.com → your avatar → **Settings** → **Developer settings** (bottom of the left sidebar) → **OAuth Apps** →
   **New OAuth App**.
2. Application name `kevinwong.co admin`; Homepage URL `https://www.kevinwong.co`; Authorization callback URL
   `https://www.kevinwong.co/api/auth/callback/github`. Leave **Enable Device Flow** unticked → **Register
   application**. There is no localhost callback and no second app, because sign-in is production-only (D1).
3. Keep the app's page open for Step 6. You will copy its **Client ID** and use **Generate a new client secret**
   (GitHub shows the secret once).
4. While in Settings: **Password and authentication** should show two-factor authentication on, ideally with a
   passkey. The panel relies on it against a GitHub account takeover.

## Step 6: set the four auth env vars in Vercel (any time before Step 9)

For each variable: Vercel → the kevinwong.co project → **Settings** → **Environment Variables** → add a variable →
set Key and Value → under Environments tick **Production** only (untick Preview and Development) → turn
**Sensitive** on → **Save**.

- `BETTER_AUTH_SECRET`: generate it straight into the clipboard, without printing it:

  ```sh
  openssl rand -hex 32 | tr -d '\n' | pbcopy
  ```

  Paste it into Vercel's Value field and **Save**. Then clear the clipboard:

  ```sh
  pbcopy < /dev/null
  ```

  CLI alternative, if the main checkout is linked with `vercel link` (the value goes through a pipe, never argv):

  ```sh
  openssl rand -hex 32 | tr -d '\n' | vercel env add BETTER_AUTH_SECRET production --sensitive
  ```

- `BETTER_AUTH_URL`: exactly `https://www.kevinwong.co`, with no trailing slash. `lib/auth.js` refuses to start in
  production with any other value.
- `GITHUB_CLIENT_ID`: the OAuth App's Client ID.
- `GITHUB_CLIENT_SECRET`: on the OAuth App page click **Generate a new client secret**, click its copy icon, and
  paste it directly into Vercel's Value field.

**Don't add `BETTER_AUTH_TRUSTED_ORIGINS` or `BETTER_AUTH_SECRETS`**, in any environment. Better Auth reads both
straight from the environment, past the app's own settings, so `lib/auth.js` refuses to start in production while
either is set, and every admin request would answer 500.

Check: the Environment Variables list shows all four names, each with the environment "Production" only and the
Sensitive marker. It does not show `BETTER_AUTH_TRUSTED_ORIGINS` or `BETTER_AUTH_SECRETS`. It still shows
`SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` for Production, added for Deploy A. Don't add the four to `.env`:
local development never signs in (D1).

## Step 7: add the panel's redirect URI to the Spotify app (any time before Step 9)

https://developer.spotify.com/dashboard → open the site's app → **Settings** → **Edit** → under **Redirect URIs** type
`https://www.kevinwong.co/api/admin/spotify/callback` → **Add** → **Save** at the bottom. Leave
`http://127.0.0.1:8888/callback` in the list, because `npm run spotify:reauth` still uses it. Check: Settings shows
both URIs. Don't touch the client secret.

## Step 8: back up production (right before Step 9)

Either (preferred) a Neon branch: Neon Console → the kevinwong.co project → **Branches** → **New branch** → name
`before-admin-007`, parent: the production branch (marked default), data up to **now** (the current point in time,
not schema-only) → **Create branch**. A compute is not needed for a backup; if the dialog adds one, it scales to
zero. Check: the **Branches** list shows `before-admin-007`.

Or, if you used the dump for Deploy A, a dump again. The direct (non-pooler) URL is worked out from `.env` and passed
to Docker by name. The dump holds the live tokens, so `umask 077` makes it readable by you alone; the parentheses keep
that umask from outlasting the command:

```sh
cd /Users/Kevin/Git/kevinwong.co
( umask 077 && mkdir -p ~/Backups &&
  PGURL="$(node --env-file=.env -p 'const u = new URL(process.env.DATABASE_URL); u.hostname = u.hostname.replace(/^([^.]+)-pooler\./, "$1."); u.href')" \
    docker run --rm -e PGURL postgres:18 sh -c 'pg_dump --format=custom --no-owner "$PGURL"' > ~/Backups/kevinwong-before-admin-007.dump )
docker run --rm -i postgres:18 pg_restore --list < ~/Backups/kevinwong-before-admin-007.dump | grep -c "TABLE DATA"
```

The last command prints 6 or more (`integration_tokens`, `job_locks`, `instagram_posts`, `instagram_media`, and
Deploy A's `sync_runs` and `admin_audit_log`). If zsh says `file exists`, a dump with that name is already in
`~/Backups` and was left as it was: rename the old one and run the block again.

## Step 9: merge, apply `007`, check the schema, deploy

Run everything in one terminal in the main checkout. Its `.env` holds production's pooled `DATABASE_URL`, so nothing
secret is typed or pasted. Nothing is deployed until item 7's push.

1. **Merge into local `main`**, and install the new dependencies: `better-auth`, which the schema check loads, and
   the pinned `auth` CLI that runs it.

   ```sh
   cd /Users/Kevin/Git/kevinwong.co
   nvm use --silent
   node -v
   git switch main
   git status --short
   ```

   `node -v` prints `v24.21.0`. `git status --short` prints nothing. If it prints anything, stop and tell the
   session. Then check the branch once more, because the merge must take exactly what the gate checked:

   ```sh
   git log --oneline -2 claude/admin-panel-deploy-b
   ```

   The same two lines as in the gate. If not, stop and tell the session.

   ```sh
   git pull --ff-only origin main
   git merge --ff-only claude/admin-panel-deploy-b || git merge --no-ff claude/admin-panel-deploy-b -m "Merge branch 'claude/admin-panel-deploy-b' (Deploy B)"
   npm ci
   ```

2. **Look at the target.** Without `--yes`, `db:apply` only prints it:

   ```sh
   npm run db:apply -- sql/007_auth.sql
   ```

   Expected: `Target: ep-<id>.<region>.aws.neon.tech/<db>`, the Neon host with no `-pooler`, then
   `Files:  sql/007_auth.sql` and ``Not a local database. Re-run with --yes (after `--`) to apply.``, and exit 1.
   Nothing was applied. If the host is anything else, stop: a `DATABASE_URL` exported in this shell wins over
   `.env`, so `unset DATABASE_URL` and run it again.

3. **Define a read-only query helper** for this step and Steps 12–14. It reads `DATABASE_URL` from `.env`, so the
   URL is never typed and never appears in any process's arguments. Define it again if you open a new terminal.

   ```sh
   prodsql() { node --env-file=.env --input-type=module -e '
   import pg from "pg";
   const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
   try { console.table((await pool.query(process.argv[1])).rows); } finally { await pool.end(); }' "$1"; }
   ```

   **Check `.env.local`.** `db:apply` reads `.env` and then `.env.local`, and `.env.local` wins. The schema check
   reads both too. `prodsql` reads `.env` only:

   ```sh
   ls .env.local
   ```

   Expected: `ls: .env.local: No such file or directory`. If the file is there, run this. It prints only the host
   and database that `prodsql` reads, in the same form as `Target:`, and the two must be the same:

   ```sh
   node --env-file=.env -p 'const u = new URL(process.env.DATABASE_URL); u.host.replace(/^([^.]+)-pooler\./, "$1.") + u.pathname'
   ```

   If they differ, `.env.local` names another database: stop and tell the session.

   **Pre-flight, read-only.** It prints role and schema facts, never the URL:

   ```sh
   prodsql "select current_user, current_schemas(true) as schemas, has_schema_privilege('public', 'CREATE') as can_create, (select tableowner from pg_tables where schemaname = 'public' and tablename = 'sync_runs') as sync_runs_owner, (select tableowner from pg_tables where schemaname = 'public' and tablename = 'admin_audit_log') as audit_log_owner, (select count(*) from pg_tables where schemaname = 'public' and tablename in ('auth_user', 'auth_session', 'auth_account', 'auth_verification'))::int as auth_tables"
   ```

   Expected: one row.
   - `current_user` equals `sync_runs_owner` and `audit_log_owner`. Deploy A applied those tables as this role, and
     its Step 10 showed production writing them, so the four tables `007` creates, owned by this role, will be
     writable by production too.
   - `schemas` is `{pg_catalog,public}`, `can_create` is `true`, and `auth_tables` is `0`.
   - **If any differ, stop and tell the session before applying.** An empty owner means Deploy A's `006` is missing.
     `auth_tables` above `0` means an earlier attempt left tables behind, and `007` would keep them as they are.
   - A `SECURITY WARNING` about `sslmode=require` from `pg` is expected and harmless, here and below: the connection
     verifies.

4. **Apply `007`:**

   ```sh
   npm run db:apply -- --yes sql/007_auth.sql
   ```

   Expected: the same `Target:` and `Files:` lines, then `applied sql/007_auth.sql`, exit 0. If it fails, stop and
   tell the session. `main` is not pushed, so nothing is deployed, and the file is safe to run again.

5. **Confirm the tables:**

   ```sh
   prodsql "select table_name from information_schema.tables where table_schema = 'public' and table_name in ('auth_user', 'auth_session', 'auth_account', 'auth_verification') order by 1"
   ```

   Expected: four rows, `auth_account`, `auth_session`, `auth_user` and `auth_verification`.

6. **Run the read-only schema check.** The CLI is the exact-pinned `auth@1.7.10` devDependency that `npm ci`
   installed in item 1, with its whole tree in `package-lock.json`. `--no-install` makes `npx` run only that copy and
   never download one. The CLI reads `DATABASE_URL` from `.env`. The check signs nothing, so the secret is a
   throwaway, and the parentheses keep both values out of your shell afterwards:

   ```sh
   (
     export BETTER_AUTH_URL="https://www.kevinwong.co"
     export BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
     npx --no-install auth check --config scripts/auth.config.mjs; echo "exit=$?"
   )
   ```

   Expected: `Schema check passed against the live database.` and `exit=0`. A
   `[better-auth] warn: Social provider github is missing clientId or clientSecret` line and a
   `MODULE_TYPELESS_PACKAGE_JSON` warning are harmless here.
   - If `npx` printed `npx canceled due to missing packages and no YES option` (also `exit=1`), the CLI isn't
     installed and nothing was checked: run `npm ci` again, check that `npm ls auth` prints `auth@1.7.10`, and repeat
     this item.
   - On any other `exit=1` (it prints `Database schema mismatch` and the missing tables or columns), stop and don't
     push. Ignore its hint to run `npx auth migrate`: the schema comes only from `sql/`. Send the session what the
     check printed; it names tables and columns, nothing secret. The fix lands on the branch, and you repeat this
     item.
   - On `exit=2`, the config didn't load or the database didn't connect. Check that `npm ci` succeeded and that
     `.env` has `DATABASE_URL`.

7. **Deploy.** First see what the push will deploy:

   ```sh
   git log --oneline origin/main..main
   ```

   It lists Deploy B's commits: Tasks 11–17, this runbook's two commits (`Add a tested undo for 007` and
   `Document the admin panel`), the session's Spotify id commit, any review fix commits, and the merge commit if
   item 1 needed `--no-ff`. Nothing from Deploy A, which is already on `origin/main`. Then:

   ```sh
   git push origin main
   ```

   Vercel → **Deployments** → wait until the new **Production** deployment for that commit is **Ready**. The fixed
   branch is merged now, so you can delete it:

   ```sh
   git branch -d claude/admin-panel-deploy-b
   ```

8. **If anything in Steps 10–14 fails badly:** Vercel → **Deployments** → the previous Production deployment (Deploy
   A's code) → **⋯** → **Instant Rollback**. The auth tables can stay, because Deploy A never reads them. See *If
   something goes wrong* below.

## Step 10: checks from outside

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
curl -s -o /dev/null -w "%{http_code}\n" https://www.kevinwong.co/api/admin/status
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://www.kevinwong.co/api/admin/instagram/sync
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Origin: https://www.kevinwong.co" https://www.kevinwong.co/api/admin/instagram/sync
curl -s -o /dev/null -w "%{http_code}\n" https://www.kevinwong.co/api/auth/get-session
curl -s -o /dev/null -w "%{http_code}\n" https://www.kevinwong.co/api/auth/list-sessions
curl -s -o /dev/null -w "%{http_code}\n" https://kevinwong.co/admin
```

Expected, in this order:
1. `401`: no session.
2. `403`: a POST without an `Origin` header.
3. `401`: the right `Origin`, but no session.
4. `404`: `get-session` is not on the auth route's allowlist.
5. `404`: nor is `list-sessions`.
6. `308`: the apex redirects to www.

If `/admin` answers 404 on www, the first suspect is the host check: the gate compares `req.headers.host` with
exactly `www.kevinwong.co`.

The sign-in page's head tags:

```sh
curl -s https://www.kevinwong.co/admin/sign-in | grep -cE 'rel="canonical"|property="og:'
curl -s https://www.kevinwong.co/admin/sign-in | grep -c 'noindex, nofollow'
```

Expected: `0`, then `1`.

## Step 11: preview and deployment URLs return 404

Use a browser where you are signed in to Vercel, because Deployment Protection answers `curl` with Vercel's own 401.
- Vercel → **Deployments** → any **Preview** deployment → **Visit**. Add `/admin` to its URL. Expected: the site's
  404 page. `/admin/sign-in` there is a 404 too.
- Do the same with the new Production deployment's own `*.vercel.app` URL. It runs with `VERCEL_ENV=production`, but
  the host is not `www`. Expected: the site's 404 page.

## Step 12: sign in, and refuse a second account

1. **Look at the sign-in page first.** Open `https://www.kevinwong.co/admin/sign-in` in a private window. The card
   and the **Sign in with GitHub** button show. Close the private window.
2. **Sign in as yourself.** Open `https://www.kevinwong.co/admin`. It redirects to `/admin/sign-in`. Click **Sign in
   with GitHub**. GitHub asks once to authorize `kevinwong.co admin`, with no scopes listed. Click **Authorize**.
   Expected: the dashboard. The header shows your avatar, `@dotKevinWong` and **Sign out**. Then, in the Step 9
   terminal:

   ```sh
   prodsql "select (select count(*) from auth_user)::int as users, (select count(*) from auth_account where \"providerId\" = 'github' and \"accountId\" = '1741711')::int as owner_accounts, (select count(*) from auth_session)::int as sessions, (select count(*) from admin_audit_log where event = 'sign_in' and actor = 'github:1741711')::int as sign_ins"
   ```

   Expected: one row, `users 1`, `owner_accounts 1`, `sessions 1`, `sign_ins 1`.

   Now open `/admin/sign-in` in the same window. It redirects to `/admin`.
3. **A second GitHub account.** Skip this item if you have none; Task 12's integration test covers it.
   - Open a private window and sign in to github.com as the other account.
   - Open `https://www.kevinwong.co/admin/sign-in` → **Sign in with GitHub** → **Authorize**.

   Expected: you land on `/admin/sign-in?error=not_owner…`, and the page reads "That GitHub account can't sign in
   here." Then:

   ```sh
   prodsql "select (select count(*) from auth_user)::int as users, (select count(*) from auth_account)::int as accounts, (select count(*) from auth_account where \"accountId\" <> '1741711')::int as other_accounts, (select count(*) from auth_session)::int as sessions, (select count(*) from auth_verification)::int as verifications, (select count(*) from admin_audit_log where event = 'sign_in_rejected')::int as rejected"
   ```

   Expected: one row, `users 1`, `accounts 1`, `other_accounts 0`, `sessions 1`, `verifications 0`, `rejected 1`.
   The refusal wrote nothing to the auth tables and one `sign_in_rejected` row to the activity log, by design (D5).

   Then, back in your own window, reload `/admin`. Expected: above the activity table, the line "Refused sign-ins in
   the last 24 hours: 1", with the other account's GitHub login and the time (UTC). The activity table itself does
   not list the refusal.

## Step 13: reconnect Spotify (D3)

1. On `/admin`, the Spotify card shows the env-var state: the orange **Using env var** badge and an info alert.
   Click **Reconnect**. On Spotify's Approve page (it always appears, because of `show_dialog`), check that it is
   your account and click **Agree**. Expected:
   - You land on `/admin?spotify=connected`, a green "Spotify reconnected" alert shows, and then the address bar no
     longer has `?spotify=connected`.
   - The card shows **Connected**, "179 days left (estimated)" (179 is right: the count rounds down from 180), today
     as the approval date, "Account: the site's Spotify account" and "Scopes: 3 of 3".
   - If you land on `/admin?spotify_error=wrong_account`, the id in `lib/admin/owner.js` is not this account's: stop
     and tell the session. The README's *Admin panel* → *Troubleshooting* lists every other code. Nothing was stored
     in any case.
2. Confirm the row without selecting any token:

   ```sh
   prodsql "select authorized_at, expires_at, expires_at_is_assumed, account_id, scopes, dead_reason, refresh_token is not null as has_refresh_token from integration_tokens where provider = 'spotify'"
   ```

   Expected: `authorized_at` is about now, `expires_at` is 180 days later, `expires_at_is_assumed` is `true`,
   `dead_reason` is `null`, `has_refresh_token` is `true`, and `scopes` lists the three scopes.
3. Play something on Spotify. `curl -s https://www.kevinwong.co/api/nowplaying` shows `"isPlaying":true`. It keeps
   working throughout: each server instance switches to the stored token at its next refresh, within an hour. Then
   check the listening chart, the only caller that needs `user-read-recently-played` (the query string skips the
   CDN's day-long cache):

   ```sh
   curl -sS "https://www.kevinwong.co/api/listeningtimeline?check=$(date +%s)" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.is_working===false?`FAILED: ${s}`:`ok: ${Object.keys(j).length} days`)})'
   ```

   Expected: `ok: N days`, with N above 0. `FAILED: {"is_working":false}` means the token or a scope is wrong; check
   the card's scopes.
4. Read the dates that TODO.md needs:

   ```sh
   prodsql "select to_char(authorized_at, 'YYYY-MM-DD') as reconnected_on, to_char(authorized_at + interval '7 days', 'YYYY-MM-DD') as cleanup_from, to_char(expires_at - interval '30 days', 'YYYY-MM-DD') as reconnect_by, to_char(expires_at, 'YYYY-MM-DD') as estimated_expiry from integration_tokens where provider = 'spotify'"
   ```

   Send the four dates to the session, which does Task 19 Step 1 the same day. Put `cleanup_from` (Task 19 Step 2
   onwards) and `reconnect_by` in your calendar.

## Step 14: run Check, see the limit hold, sign out

1. On `/admin`:
   - The Instagram card shows the token's days left and the last cron run (recorded since Deploy A) with its badge,
     and no overdue warning. If no real (non-dry) cron run has happened since Deploy A, because 05:00 UTC hasn't come
     round yet, it shows "No cron run recorded yet." and the "No cron run in 36 hours" warning instead. That is
     expected, not a failure: look again after the next 05:00 UTC run.
   - The token's days left match `npm run instagram:token`.
   - Uploads show "N of 2,000" and storage shows "X of 1 GB".
   - Dark mode and a phone-width window: no sideways page scroll. View source: `noindex, nofollow`, and no
     `rel="canonical"`.
2. Click **Check for new posts**. Expected:
   - An info alert: "Found N new posts with M files to upload." (plus how many wait for a later run, if any), or "No
     new posts. Nothing to import."
   - The muted lines `Blob: ok` and `Resize: ok (sharp …, libvips …)`.
   - Any new posts listed by date, file count and shortcode (a link to the post), without captions.
   - Once the status refreshes, the **Recent runs** table's top row reads `panel (check)` with a green **OK** badge.
     The activity log lists the `sign_in`, `spotify_connected` and `instagram_check` entries.

   Import only if it lists posts, and only after item 3's query; otherwise the 05:00 UTC cron imports them.
3. **See the limit hold.** Once the result shows, the dashboard refreshes its status. Expected: **Check** is
   disabled, with "Next check available …" under it, about 10 minutes out. A disabled button sends nothing, so prove
   the server's limit from the browser instead:
   1. On `/admin`, open the browser's developer console (Chrome may ask you to type `allow pasting` before the first
      paste) and run:

      ```js
      (await fetch("/api/admin/instagram/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dryRun: true }) })).status
      ```

      Expected: `429`. The request is same-origin, so it carries your session cookie and `Origin`, and the server
      refuses it as too soon.
   2. Then, in the Step 9 terminal:

      ```sh
      prodsql "select trigger, dry_run, status, fetched, imported, uploads from sync_runs order by started_at desc limit 2"
      prodsql "select event, actor from admin_audit_log order by at desc limit 3"
      ```

      Expected: the newest run is `panel`, `dry_run` `true`, status `ok`; the refused request wrote no run. The three
      latest events are `panel_run_refused` (from the console request), `instagram_check` and `spotify_connected`,
      each with actor `github:1741711`.

   Do the next two only after this query, not before: each writes an event that would push these three out of the
   newest three.
   - **Import (optional, only if the check found posts).** Press **Import**. The dialog states the post and file
     counts, and **Cancel** leaves the runs table unchanged. Press **Import** again and confirm. The result alert
     appears, the Import button goes away, the runs table gains a `panel` row, and once the status refreshes, "The
     panel allows one import per 24 hours. Next import available …" shows under the Check button.
   - **Sign out from a second tab.** Open `/admin` in a second tab and press **Sign out** there. Switch back to the
     first tab. On focus the dashboard fetches its status again, gets 401, and moves to `/admin/sign-in`. Sign in
     again.
4. Click **Sign out**. Expected: you are on `/admin/sign-in`, and pressing Back does not show the dashboard. Then:

   ```sh
   prodsql "select count(*)::int as sessions from auth_session"
   ```

   Expected: `sessions 0`.
5. Once Steps 10–14 have passed, Deploy A's backup `before-admin-005` (the Neon branch or
   `~/Backups/kevinwong-before-admin-005.dump`) can be deleted. Keep `before-admin-007` for a month.
6. **Tell the session Deploy B is done.** Reply with the date of Step 9's push, whether Steps 10–14 passed, and the
   four dates from Step 13 if you haven't sent them yet.

## If something goes wrong

- **Before Step 9's push**, nothing is deployed: stop and tell the session. `007` is additive and safe to run again,
  and the deployed Deploy A code ignores it.
- **After the push**, roll the code back: Vercel → **Deployments** → the Production deployment before Deploy B's →
  **⋯** → **Instant Rollback**. The auth tables stay, because Deploy A's code never reads them. Then tell the session.
- **A 500 from the panel** writes one redacted line to Vercel → **Logs** (Hobby keeps an hour), never a stack trace
  or a token:
  - `[admin] owner check failed:` (`[admin/spotify] owner check failed:` on the Spotify routes): the database, or
    Better Auth's schema check, failed. The API routes answer `{"error":"server_error"}`, and `/admin` shows the
    site's 500 page. A `Database schema mismatch` there means `007` is missing or wrong: run Step 9 item 6's check.
  - `[auth] request failed:`: Better Auth failed during sign-in, its callback or sign-out, and `/api/auth/*` answers
    `{"error":"server_error"}`.
  - `[admin/status] status read failed:`: `/api/admin/status` answers `{"error":"status_failed"}`, and the dashboard
    says it couldn't load the status.
  - `[admin/instagram] sync failed:` answers `{"error":"sync_failed"}`, and `[admin/instagram] request failed:`
    answers `{"error":"server_error"}`.
- **Import stays disabled after an import that failed.** Each Import claims a 24-hour slot, the `job_locks` row
  `instagram-panel-import`, before it runs, and gives the slot back when it uploaded nothing. If that fails too (the
  logs show `[admin/instagram] limit re-read failed:` or `import slot release failed:`), Import stays disabled for up
  to 24 hours, though **Recent runs** shows no import that counts. Look first, with `prodsql` from Step 9 item 3:

  ```sh
  prodsql "select locked_until, locked_until > now() as held from job_locks where name = 'instagram-panel-import'"
  prodsql "select status, uploads, started_at from sync_runs where job = 'instagram' and trigger = 'panel' and not dry_run order by started_at desc limit 1"
  ```

  Clear the slot only when `held` is `true` and the newest panel import's `status` is not `running`. A `running`
  import is either still going or was killed, and a killed one counts anyway. To clear it:

  ```sh
  node --env-file=.env --input-type=module -e '
  import pg from "pg";
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
  try { console.log({ updated: (await pool.query(process.argv[1])).rowCount }); } finally { await pool.end(); }' "update job_locks set locked_until = 'epoch' where name = 'instagram-panel-import'"
  ```

  It prints `{ updated: 1 }`. This never lifts the daily limit itself: each Import is checked against `sync_runs`
  first, so an import that really counts still blocks the next one for 24 hours.
- **The schema normally stays.** Removing `007` is not part of a rollback. If you do want it gone, roll the code back
  first, because Deploy B's Better Auth fails every request without its tables, and back up (Step 8). Then, in the
  main checkout:

  ```sh
  npm run db:apply -- sql/undo/undo-007.sql
  ```

  It prints the target and stops, as in Step 9 item 2; the target must be the Neon host without `-pooler`. Then:

  ```sh
  npm run db:apply -- --yes sql/undo/undo-007.sql
  ```

  It prints `applied sql/undo/undo-007.sql`. That drops the four auth tables in one transaction, which signs everyone
  out and deletes your GitHub sign-in record; the next sign-in after `007` goes back on creates it again. The activity
  log keeps its history. If it prints `sql/undo/undo-007.sql: canceling statement due to lock timeout` instead and
  exits 1, another session held one of the tables for more than 5 seconds, and nothing was dropped: run it again.
  The same steps are in the [README](../../../README.md), *Database migrations* → *Undoing 007*, and
  [`undo-007.sql`](../../../sql/undo/undo-007.sql) is safe to run twice.
