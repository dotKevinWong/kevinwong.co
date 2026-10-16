# 👨‍💻 KevinWong.co

💫 A little portfolio built with Next.js and Chakra UI

📋 Open tasks live in [TODO.md](TODO.md): content ideas, retiring Cloudinary, the Spotify token
rotation that comes round twice a year, and follow-ups from the last codebase audit.

## 😎 Getting Started

🫡 You are 100% free to copy my site. I just ask that you remove all of my personal information, projects, and writings. 

### 🦾 Prerequisites

- [Node.js](https://nodejs.org/en/) 24 and npm 11. The exact version is pinned in [`.nvmrc`](.nvmrc), so `nvm use` picks it up.
- For /snapshots only: a Postgres database (production uses Neon) and a
  [Vercel Blob](https://vercel.com/docs/vercel-blob) store. See *Instagram sync* below.

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
| `client_id`, `client_secret`, `refresh_token` | Spotify: now playing and top tracks (see *Spotify token rotation*). Read on the server only |
| `GOODREADS_RSS_URL` | The Goodreads shelf feed behind /bookshelf. Optional: without it the page says the feed isn't configured. `GOODREADS_MAX_BOOKS` sets how many it returns by default (8) |
| `DATABASE_URL` | Postgres, for /snapshots and the Instagram sync |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob when running locally. In production the connected store supplies credentials |
| `CRON_SECRET` | Authenticates the daily Instagram cron |
| `INSTAGRAM_CLIENT_SECRET` | Only needed for `npm run instagram:token -- --exchange` |

The Instagram access token is deliberately not an env var. It lives in Postgres, where the cron
can refresh it ([`sql/001`](sql/001_integration_tokens.sql)).

### 🎧 Spotify token rotation

Spotify expires user refresh tokens **six months after the original authorization**, and
refreshing an access token does **not** extend that window. So the `refresh_token` env var
has to be replaced roughly twice a year. ([Spotify's announcement][spotify-blog]) When the
next one is due is tracked in [TODO.md](TODO.md).

Each server instance caches the short-lived access token for about an hour, so the token
endpoint isn't hit on every Now Playing poll. When the refresh token expires, the token
endpoint answers `400 invalid_grant`. The app treats that as terminal: each server instance
stops calling Spotify after its first rejected refresh and logs what to do. The Spotify
widgets fall back to their empty states rather than erroring.

To mint a new token:

1. Add `http://127.0.0.1:8888/callback` to the Redirect URIs of the app in the
   [Spotify dashboard](https://developer.spotify.com/dashboard). Spotify rejects
   `localhost`, so the loopback IP is required.
2. Run it and approve access in the browser window that opens:
   ````sh
   npm run spotify:reauth
   ````
3. Put the printed token in `refresh_token` in `.env` (and in `.env.local` too if you have
   one, since that file wins) and in the Vercel project's environment variables. Then
   **redeploy**, because Vercel only picks up env var changes on a new deployment.

The script also prints roughly when the new token will expire. Put the next rotation in
[TODO.md](TODO.md).

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

1. Apply the migrations in [`sql/`](sql/), in filename order, over the unpooled connection
   string (the non-pooler Neon host) rather than the pooled `DATABASE_URL`. They only cover
   changes made since the sync was added. The base `instagram_posts` and `instagram_media`
   tables and the `media_kind` enum are older and aren't in the repo yet (see
   [TODO.md](TODO.md)), so on an empty database create those first.
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
   Look for `"blob":"ok"` and `"resize":"ok (sharp …, libvips …)"`:
   ````sh
   curl -s -H "Authorization: Bearer $CRON_SECRET" "https://kevinwong.co/api/cron/sync-instagram?dryRun=1"
   ````

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
with a second request, so a transient error cannot brick the integration. Recover by
generating a new token and re-seeding it.

Check status any time with `npm run instagram:token` (no arguments). It only reads.

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
