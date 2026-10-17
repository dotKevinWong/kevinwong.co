# 👨‍💻 KevinWong.co

💫 A little portfolio built with Next.js and Chakra UI

📋 Open tasks live in [TODO.md](TODO.md): content ideas, retiring Cloudinary, reconnecting Spotify
twice a year, and follow-ups from the last codebase audit.

## 😎 Getting Started

🫡 You are 100% free to copy my site. I just ask that you remove all of my personal information, projects, and writings. 

### 🦾 Prerequisites

- [Node.js](https://nodejs.org/en/) 24 and npm 11. The exact version is pinned in [`.nvmrc`](.nvmrc), so `nvm use` picks it up.
- A Postgres database (production uses Neon) for /snapshots, the Instagram sync and the Spotify
  token, and a [Vercel Blob](https://vercel.com/docs/vercel-blob) store for /snapshots. See
  *Database migrations*, *Spotify token* and *Instagram sync* below.

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
| `DATABASE_URL` | Postgres (the pooled Neon URL): /snapshots, the Instagram sync and its run history, and the Spotify token. Without it the Spotify widgets show their empty states |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob when running locally. In production the connected store supplies credentials |
| `CRON_SECRET` | Authenticates the daily Instagram cron |
| `INSTAGRAM_CLIENT_SECRET` | Only needed for `npm run instagram:token -- --exchange` |

The Instagram access token, and the Spotify refresh token once Spotify has been reconnected,
are deliberately not env vars. They live in Postgres in `integration_tokens`
([`sql/001`](sql/001_integration_tokens.sql), [`sql/005`](sql/005_integration_tokens_spotify.sql)),
where the app can refresh, rotate or replace them without a redeploy.

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

To apply one:

1. **Back up production first.** Local development uses the production database too, so there is no other
   copy. Either make a Neon branch (Neon Console → the project → **Branches** → **New branch**, name it
   `before-<file number>`, parent: the production branch, data up to now → **Create**), or take a dump from the
   project root. Docker's `postgres:18` image can dump any server up to 18. The direct (non-pooler) URL is
   worked out from `.env` and handed to Docker by name, so it is never typed, and it stays out of your shell
   history and your Mac's process list. The dump holds the live Instagram token, so `umask 077` makes it
   readable by you alone; the parentheses keep that umask from outlasting the command:
   ````sh
   ( umask 077 && mkdir -p ~/Backups &&
     PGURL="$(node --env-file=.env -p 'const u = new URL(process.env.DATABASE_URL); u.hostname = u.hostname.replace(/^([^.]+)-pooler\./, "$1."); u.href')" \
       docker run --rm -e PGURL postgres:18 sh -c 'pg_dump --format=custom --no-owner "$PGURL"' > ~/Backups/kevinwong-before-005.dump )
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

**Undoing 005 and 006.** Rolling the code back (Vercel → Deployments → the previous deployment → ⋯ →
**Instant Rollback**) is the planned way back, and the schema normally stays: the code from before these
migrations ignores both files. To remove them as well, back up first (step 1 above).

The SQL is in two files in [`sql/undo/`](sql/undo/): [`delete-spotify-row.sql`](sql/undo/delete-spotify-row.sql)
and [`undo-005-006.sql`](sql/undo/undo-005-006.sql). They are not migrations: setup and
`npm run db:test -- reset` apply only the numbered files in `sql/`. Run them with `db:apply` from the project
root, like the migrations, and not by pasting the SQL into a client: psql, with its default settings, carries
on after a failed statement and would drop the tables anyway. In order:

1. Roll the code back first. Without `sync_runs`, a real sync in the new code stands down and imports
   nothing.
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
once a minute, so a reconnect takes effect everywhere within a minute, with no redeploy. If Spotify hands back
a new refresh token, it replaces the stored one only if the row still holds the token that instance used, so a
slow instance can't overwrite a newer one.

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
script reads `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` from the environment, `.env` or `.env.local`,
and falls back to `client_id` / `client_secret` until the cleanup a week after the first reconnect (see
[TODO.md](TODO.md)).

[spotify-blog]: https://developer.spotify.com/blog/2026-06-18-refresh-token-expiration

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
   rows imported from an Instagram "Download Your Information" ZIP, and it's already done here:
   ````sh
   npm run instagram:repair            # dry run
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
