# Admin panel design (v1)

Drafted 2026-09-27, reviewed by Kevin 2026-10-16. The published review copy is
https://claude.ai/artifact/KH6jCjma7JFepSoyhJaYbh. This file is the source of truth; where
the two differ, this file wins, because it records Kevin's decisions.

A private page at `/admin`, reachable only by Kevin's GitHub account (numeric id `1741711`,
login `dotKevinWong`), for the two chores that currently need a terminal: reconnecting
Spotify every six months, and checking on the Instagram sync.

## Decisions

| # | Question | Kevin's answer | What it means for the build |
|---|---|---|---|
| D1 | Which database local development uses | Keep using production; Kevin makes a backup first | No Neon dev branch. The admin and auth routes are disabled outside production: they return 404 unless `VERCEL_ENV === "production"` and the `Host` is `www.kevinwong.co`. So there is no development GitHub OAuth app and no `127.0.0.1:3000` redirect URIs. Migrations are rehearsed on a throwaway local Postgres, and Kevin backs up the production database before they are applied. |
| D2 | Session length | 24 hours | `expiresIn` 86,400 s, fixed: visiting the panel does not extend it. |
| D3 | How Spotify moves into the database | Reconnect from the panel right after it ships | No seeding of the row. Until the first reconnect, `lib/spotify.js` falls back to the `refresh_token` env var. |
| D4 | Limits on panel runs | "Once a day" | **Import** from the panel: at most one per rolling 24 hours. **Check** (dry run): at most one per 10 minutes. The panel refuses imports once uploads over the last 30 days reach 1,000, and the cron stops importing at 1,800, under Blob's 2,000-a-month hard stop. Each Check and Import claims its slot atomically, so a double click can't start two. Uploads are counted as they happen, so a run that crashes still counts. |
| D5 | Activity log | Yes | `admin_audit_log` ships in v1 and is shown at the bottom of the dashboard. Refused sign-ins are logged too, as the design described, but capped at one row per GitHub id per hour and five per hour in total. They are kept out of the activity list and shown as a 24-hour count, so they can't push real events out of view. |

## Scope

In v1:

- **Sign in with GitHub, one account only.** Any other GitHub user is refused before anything
  is written to the auth tables (only a capped `sign_in_rejected` row in the activity log, D5).
- **Reconnect Spotify.** A button that goes to Spotify's Approve page and back. The token is
  stored in Postgres and takes effect within a minute, with no redeploy.
- **Instagram status.** Token expiry, when the daily sync last ran and what it did, recent
  errors, and buttons to check for or import new posts.

Not in v1: blog editing, email or passkey login, browser upload of blog covers, pasting a new
Instagram token, an expiry reminder by GitHub issue. See [Later](#later).

## Signing in

Better Auth, pinned to exactly 1.7.10, database-backed, with GitHub as the only provider. (Re-checked
2026-10-16: 1.7.6, the version researched in September, has three advisories fixed in 1.7.7.)
(Auth.js has been in maintenance mode under the Better Auth team since September 2025.)

Flow: `/admin` with no session redirects to `/admin/sign-in` → "Sign in with GitHub" →
GitHub (no scopes requested; approval remembered after the first time) →
`/api/auth/callback/github` → the profile gate rejects any GitHub id other than `1741711` →
a 24-hour session cookie is set → `/admin`.

Four checks, each sufficient on its own to stop an outsider:

| Check | Where | What it does |
|---|---|---|
| Profile gate | Better Auth user-info validation hook | Runs on every GitHub sign-in before any auth row is written; rejects any id other than `1741711`. |
| No account linking | `account.accountLinking.enabled: false` | No other GitHub account can be attached to the owner later. |
| Path allowlist | `pages/api/auth/[...all]` | Only start sign-in (`POST /sign-in/social`), GitHub's callback (`GET /callback/github`), and sign-out (`POST /sign-out`) are forwarded to Better Auth. Errors redirect to `/admin/sign-in` (`onAPIError.errorURL`), so Better Auth's own error page is never needed and stays 404 (changed 2026-10-16). Everything else returns 404, including `get-session`, which returns the raw session token. `disabledPaths` is kept as a second layer. |
| Per-request owner check | `requireOwner()` | Every admin page and admin API confirms the session's user owns the GitHub account `1741711` (`auth_account` row with `providerId = 'github'` and `accountId = '1741711'`). |

Details:

- No GitHub scopes (`disableDefaultScope: true`). Kevin's public email is empty and Better Auth
  needs one, so the user record gets the placeholder `1741711@github.placeholder.invalid`.
- `BETTER_AUTH_URL = https://www.kevinwong.co`. The apex 308-redirects to `www`, so the base
  URL, trusted origin and every callback use `www`; never the apex, never `*.vercel.app`.
- OAuth state is kept in an encrypted short-lived cookie (`storeStateStrategy: "cookie"`), so
  sign-in attempts leave no rows. OAuth tokens that are stored are encrypted.
- Rate limiting is on, with Better Auth's in-memory store. (Changed 2026-10-16 from a Postgres store:
  that would write a row for every unauthenticated sign-in click, and sign-in itself is delegated to GitHub.)
- The auth instance is built lazily on first use (`getAuth()`), so `next build` and preview
  deployments without auth env vars don't fail.
- `/admin` has no link anywhere, sends `noindex, nofollow`, and refuses framing
  (`X-Frame-Options: DENY`, `frame-ancestors 'none'`). It is not listed in `robots.txt`.
- Admin pages and APIs send `Cache-Control: private, no-store`.

## Spotify

Spotify ends every authorization six months after approval, and refreshing doesn't extend it,
so a person must click Approve twice a year. The panel removes everything around that click.

### From an env var to the database

The token moves into `integration_tokens` under provider `spotify`. `lib/spotify.js` reads it
from there:

- **Access token cache.** Each instance keeps its access token until shortly before it
  expires, with a single in-flight refresh shared by concurrent requests.
- **Recovers after a reconnect.** When Spotify rejects the refresh token (`invalid_grant`), the
  row is marked dead in the database. Instances recheck the row at most once a minute while it
  is dead, so a reconnect takes effect everywhere within a minute.
- **Can't clobber a fresh token.** Marking dead and persisting a rotated refresh token are
  compare-and-swap updates on the token value this instance read (`WHERE refresh_token = <it>`;
  not `updated_at`, since a JavaScript date drops the microseconds). The same
  fix applies to Instagram's `markTokenDead`.
- **No secrets in the build.** Client credentials are read at runtime as `SPOTIFY_CLIENT_ID`
  and `SPOTIFY_CLIENT_SECRET`.
- **Gradual switch.** Only when there is no `spotify` row does the code fall back to the
  `refresh_token` env var. A database error never falls back.

### Reconnecting from the panel

1. `POST /api/admin/spotify/authorize`: owner session and same-origin check; 32-byte random
   state in a `__Host-kw_spotify_state` cookie (`HttpOnly; Secure; SameSite=Lax; Path=/;
   Max-Age=600`); 303 to Spotify's authorize URL with `show_dialog=true` and exactly the three
   scopes `user-read-currently-playing user-top-read user-read-recently-played`.
2. `GET /api/admin/spotify/callback`: owner session; constant-time state comparison; clear the
   cookie; exchange the code; require all three scopes; read `/v1/me` and refuse any account
   other than the pinned one; upsert the row with `authorized_at = now()`; reset this
   instance's cache; 303 to `/admin?spotify=connected`. Every failure writes nothing to `integration_tokens`,
   logs one `spotify_connect_failed` event (except a state mismatch with no state cookie, where no reconnect
   was in flight, which logs nothing), and redirects with an error code. With no owner session, both
   routes redirect to `/admin/sign-in`.
3. Redirect URI `https://www.kevinwong.co/api/admin/spotify/callback`. Keep
   `http://127.0.0.1:8888/callback` for the script.

The countdown is an estimate: `expires_at = authorized_at + 180 days`, labelled as such.
`npm run spotify:reauth` keeps working as a fallback, updated to the new env var names and
able to write the row directly.

## Instagram

The daily sync already renews the Instagram token whenever it is within 30 days of expiring.
What's missing is a record: the sync's result lives only in logs that Hobby deletes after an
hour.

The panel shows:

- **Token:** days left, last refresh, and an alert with recovery steps if Meta rejects it.
- **Last run:** when the cron last ran and what it imported, skipped or deferred, with errors.
  A warning appears if there has been no cron run in 36 hours.
- **Library:** post and file counts, storage used against 1 GB (summed from stored file sizes,
  costing no Blob operations), and uploads over the last 30 days against 2,000.
- **Recent runs:** the last 20 runs, from cron, panel or CLI.

A new `sync_runs` table records every run. A run still `running` after 15 minutes whose lease
has expired is shown as `abandoned`.

**Sync now** is two buttons: **Check for new posts** (a dry run: uploads nothing, confirms Blob
and resizing work, says what it would import) and **Import N posts** (shown only when there is
something new, with a confirmation step). The browser can only choose between those two; the
server fixes every other parameter. Panel runs get a 60-second budget and the D4 limits; the
existing lease stops a panel run and the cron overlapping. A check can renew the Instagram
token when due, exactly as the cron would.

## Dashboard

One page in the site's existing `PageShell` (the sidebar's Now Playing stays, so Spotify can be
seen recovering after a reconnect). It polls `/api/admin/status` every 30 seconds while open.

- Header: avatar, `@dotKevinWong`, Sign out.
- Spotify card: status badge, days-left bar (estimated), approval date, account check, scopes
  3 of 3, Reconnect button.
- Instagram card: token days left, last run, result, uploads (30 days), storage, Check button,
  then Import with a confirm dialog.
- Recent runs table and the activity log.

## Security

| Threat | What stops it |
|---|---|
| Another GitHub user signs in | Profile gate before any auth write, linking off, per-request owner check. |
| A site you visit triggers an admin action | Every change is a POST whose `Origin` must be `https://www.kevinwong.co`; Better Auth's endpoints have their own origin check. |
| The panel framed by another site | `X-Frame-Options: DENY`, `frame-ancestors 'none'`. |
| A stolen session cookie | 24-hour fixed session, `HttpOnly`, sign-out immediate; Spotify accepts only the pinned account; imports capped by the server. |
| Unused auth endpoints | Allowlist; everything else 404. |
| Preview deployment as a side door | Admin and auth routes 404 anywhere except production on `www`; previews get no admin secrets. |
| Burning the Blob allowance | Server-fixed limits (D4) and the run lease. |
| Tokens leaking into logs or responses | The status endpoint never selects token columns; stored errors and summaries pass through `redact()`; admin responses are `no-store`. |
| A Better Auth bug | Exact version pin, no plugins, `npm run audit:prod` and Dependabot. |
| GitHub account takeover | Keep GitHub 2FA on, ideally a passkey. |

Deferred: token encryption at rest with a separate key, a fresh-login requirement before
reconnecting Spotify, a new-session notification, a restricted database role, a sessions list
with "sign out everywhere", a full CSP.

## Database changes

All additive; each file safe to run twice; applied over the direct (non-pooler) connection.
The live site reads none of the new tables or columns until the code that needs them deploys.

| File | Adds |
|---|---|
| `sql/005_integration_tokens_spotify.sql` | `refresh_token`, `authorized_at`, `account_id`, `scopes` on `integration_tokens`; `access_token` becomes nullable; a CHECK that every row has an access or refresh token (added via DROP/ADD or a `DO` block, since `ADD CONSTRAINT` has no `IF NOT EXISTS`). |
| `sql/006_sync_runs.sql` | `sync_runs` (job, trigger, dry_run, started_at, finished_at, status in running/ok/partial/skipped/failed/reauth_required/abandoned, counts, error, size-capped summary jsonb) and `admin_audit_log`. |
| `sql/007_auth.sql` | `auth_user`, `auth_session`, `auth_account`, `auth_verification`, hand-written from Better Auth 1.7.10's schema and confirmed with `npx auth@1.7.10 check`, plus a unique index on (`providerId`, `accountId`). |

Better Auth validates its schema at startup, so `007` must be applied before the deploy that
uses it.

## One-time setup

- GitHub OAuth App: homepage `https://www.kevinwong.co`, callback
  `https://www.kevinwong.co/api/auth/callback/github`.
- Spotify dashboard: add `https://www.kevinwong.co/api/admin/spotify/callback`; keep
  `http://127.0.0.1:8888/callback`.
- Vercel, Production environment only: `BETTER_AUTH_SECRET` (`openssl rand -hex 32`),
  `BETTER_AUTH_URL=https://www.kevinwong.co`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
  `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, all secrets marked Sensitive. Preview
  deployments then show empty Spotify cards, which the components already handle.

## Rollout

1. Rehearse the three migrations twice on a throwaway local Postgres with production's schema.
2. Kevin backs up the production database, then the migrations are applied to production.
3. **Deploy A:** DB-aware `lib/spotify.js` and run recording, no panel. With no Spotify row, it
   uses the env var exactly as today. Check: Now Playing, Top Tracks and the listening chart
   work, and the next cron run appears in `sync_runs`.
4. **Deploy B:** sign-in, dashboard, admin actions. Check: `/admin` redirects to sign-in when
   signed out, admin APIs return 401, a second GitHub account is refused and leaves no row,
   and Kevin reaches the dashboard.
5. Kevin reconnects Spotify from the panel (D3).
6. After a week with the database as the source and no errors: remove the env fallback and
   deploy; then delete `refresh_token`, `client_id` and `client_secret` from Vercel and `.env`
   and redeploy, since a deployment keeps the env vars it was built with.

## Testing

- Unit tests with Node's built-in runner (`node --test "tests/**/*.test.mjs"`), no new
  dependency.
- Spotify: cache reuse; concurrent requests share one refresh; a rejected token stops calls; a
  reconnect recovers within a minute; a stale instance can't overwrite a new token.
- Reconnect callback: missing or wrong state, denied approval, missing scope, or wrong account
  each write nothing.
- Owner check: every non-owner case is refused.
- Against a local Postgres: migrations apply twice; a second GitHub account is refused with no
  auth rows written; the D4 limits; overlap with the cron.
- After each deploy, the rollout checks against `www.kevinwong.co`.

## Later

| Feature | What it would take |
|---|---|
| Expiry reminder by GitHub issue | A token limited to creating issues on this repo, and a cron check that opens one 14 days before Spotify expires. |
| Paste a new Instagram token | A form that validates the token against Instagram and stores it. |
| Blog cover upload | Drag and drop onto the `npm run blog:image` pipeline. |
| Editing blog posts | A separate GitHub App with write access to this repo only; saving commits the `.mdx` and Vercel redeploys. |
| Passkeys | A Better Auth plugin alongside GitHub. |
