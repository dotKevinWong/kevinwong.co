# 👨‍💻 KevinWong.co

💫 A little portfolio built with Next.js and ChakraUI

## ✅ To-Do
These are tasks that I ~~want~~ need to complete in the future 🤪
- [ ] Add blog posts
- [ ] Add more projects
- [ ] Add more statistics

## 😎 Getting Started

🫡 You are 100% free to copy my site. I just ask that you remove all of my personal information, projects, and writings. 

### 🦾 Prerequisites

- [Node.js](https://nodejs.org/en/)
- [Next.js](https://nextjs.org/)

### 👨‍💻 Installation

1. Clone the repo
   ````sh
   git clone https://github.com/dotKevinWong/kevinwong.co.git
   ````
2. Install NPM packages
   ````sh
    npm install .
   ````
3. Run the development server
   ````sh
   npm run dev
   ````

### 🎧 Spotify token rotation

Spotify expires user refresh tokens **six months after the original authorization**, and
refreshing an access token does **not** extend that window — so the `refresh_token` env var
has to be replaced roughly twice a year. ([Spotify's announcement][spotify-blog])

When it expires the token endpoint answers `400 invalid_grant`. The app treats that as
terminal: it stops calling Spotify, logs what to do, and the Spotify widgets fall back to
their empty states rather than erroring.

To mint a new token:

1. Add `http://127.0.0.1:8888/callback` to the Redirect URIs of the app in the
   [Spotify dashboard](https://developer.spotify.com/dashboard). Spotify rejects
   `localhost`, so the loopback IP is required.
2. Run it and approve access in the browser window that opens:
   ````sh
   npm run spotify:reauth
   ````
3. Put the printed token in `refresh_token` — both in `.env` and in the Vercel project's
   environment variables — then **redeploy**. Vercel only picks up env var changes on a
   new deployment.

Set a reminder for ~5 months out so this happens before the token dies rather than after.

[spotify-blog]: https://developer.spotify.com/blog/2026-06-18-refresh-token-expiration

### 📸 Instagram sync

`/snapshots` is served from Postgres (`instagram_posts` / `instagram_media`) with the
media stored in [Vercel Blob](https://vercel.com/docs/vercel-blob). A daily Vercel Cron
job pulls new posts from the Instagram API, downloads each photo and video, measures it,
uploads it to Blob, and fills those tables.

**Account requirement.** The Instagram Basic Display API was shut down on 2024-12-04 and
personal accounts now have no API access at all. The account must be an Instagram
**professional** account (Creator or Business), used through
[Instagram API with Instagram Login][ig-login]. No App Review is needed to read your own
account — keep the Meta app in Development mode with your account on it.

**Captions.** Meta's docs badge the `caption` field "Available for Instagram API with
Facebook Login only", but an Instagram Login token reads it fine in practice (verified
2026-09-26), so the sync requests it. If Meta ever starts enforcing that badge, every
sync will fail with error code `100`. Check with:

````sh
npm run instagram:sync -- --probe-caption
````

and if it reports captions as unsupported, remove `caption` from `MEDIA_FIELDS` in
[`lib/instagram.js`](lib/instagram.js).

#### One-time setup

1. Apply the migrations in [`sql/`](sql/), in filename order.
2. Create a **Public** Blob store (Vercel dashboard → Storage → Create → Blob) and
   connect it to the project, which gives production its credentials. Locally, put the
   store's `BLOB_READ_WRITE_TOKEN` in `.env`. The store must be Public: /snapshots serves
   the files straight into `<img>` and `<video>`.
3. Set `CRON_SECRET` in Vercel (any long random string — the cron endpoint refuses to
   run without it). Generate one with `openssl rand -hex 32`.
4. In the Meta App Dashboard, go to **Instagram → API setup with Instagram business
   login** and click **Generate token**. No OAuth redirect flow is needed for a single
   account.
5. Store it, which also validates it against the API. Pass it through the
   environment rather than as an argument, so it stays out of your shell history:
   ````sh
   INSTAGRAM_ACCESS_TOKEN=<TOKEN> npm run instagram:token
   ````
6. Reconcile the posts that came from the old data-export import:
   ````sh
   npm run instagram:repair            # dry run
   npm run instagram:repair -- --apply
   ````
7. Dry-run the sync, then let it run for real:
   ````sh
   npm run instagram:sync -- --dry-run
   npm run instagram:sync
   ````

#### Blob storage and the Hobby plan

Each file lives at `snapshots/<YYYYMM>/<shortcode>-<slide>.<ext>` — the shortcode is the
post's Instagram URL, so the store's file browser maps straight back to Instagram.

The Hobby plan includes 1 GB of Blob storage, 2,000 uploads a month, 10,000 "simple
operations" (a cache miss when someone views a file counts as one) and 10 GB of Blob data
transfer. **Going over any of these is a hard stop, not a bill: Blob is locked for up to
30 days and every image on /snapshots goes blank.** Today's ~80 MB and a few uploads a
day are far inside that; the thing to watch is transfer if the page ever gets heavy
traffic or hotlinking. Usage is under the store's **Usage** tab.

#### Moving from Cloudinary

The media was originally mirrored to Cloudinary. It moves to Blob in two stages, so the
live site keeps working throughout:

1. **Copy (done 2026-09-26).** `sql/003` added nullable `asset_*` columns, and the
   backfill copied all 133 files into Blob and filled them in. `cloudinary_*` was not
   touched, so the code already deployed kept reading Cloudinary.
   ````sh
   npm run snapshots:blob               # dry run
   npm run snapshots:blob -- --apply    # copy (resumable)
   npm run snapshots:blob -- --verify   # every object present, sizes match, videos serve 206
   ````
2. **Switch.** Deploying this code makes the read path prefer `asset_*` (falling back to
   `cloudinary_*` for any row not yet copied), and new posts go straight to Blob.

#### Retiring Cloudinary

Wait at least 30 days after the switch is deployed and working: until then, rolling back
to the old code still needs the Cloudinary files. Then, in this order — each step leaves
every deployment that could still be serving (including the Instant Rollback target)
working:

1. **Relax the schema.** Safe for every version of the code, because the switch-era code
   already writes `asset_*` on every insert and the old code only reads. First confirm
   nothing is missing — this must return 0:
   ````sql
   select count(*) from instagram_media where asset_url is null or asset_pathname is null;
   ````
   then:
   ````sql
   set lock_timeout = '5s';
   alter table instagram_media
     alter column asset_url set not null,
     alter column asset_pathname set not null,
     alter column cloudinary_url drop not null,
     alter column cloudinary_public_id drop not null,
     alter column cloudinary_folder drop not null;
   ````
2. **Stop using the old columns in code.** In [`lib/instagram-sync.js`](lib/instagram-sync.js)
   stop `insertPost` writing `cloudinary_*`; in both `pages/api/snapshots` routes remove the
   `coalesce(..., m.cloudinary_*)` fallbacks; delete `scripts/snapshots-blob-backfill.mjs` and
   its `snapshots:blob` npm script (it reads `cloudinary_*`). Deploy, then **Redeploy once
   more** (Vercel → Deployments → Redeploy). On Hobby, Instant Rollback can only go to the
   immediately previous deployment; the extra deploy makes sure that target no longer reads
   the columns step 3 removes.
3. **Drop the columns.** This is deliberately **not** a file in `sql/`, because the setup
   steps apply that folder in order and running it early would break the old code:
   ````sql
   set lock_timeout = '5s';
   alter table instagram_media
     drop column cloudinary_public_id, drop column cloudinary_url,
     drop column cloudinary_version, drop column cloudinary_resource_type,
     drop column cloudinary_format, drop column cloudinary_width,
     drop column cloudinary_height, drop column cloudinary_duration,
     drop column cloudinary_folder;
   ````
4. **Keep the Cloudinary account, or move the blog first.** The cover images of four blog
   posts (`posts/*.mdx`) are also hosted on Cloudinary. Either move those into `public/` or
   Blob and update the posts, or delete only the `kevinwong/` snapshot folder and keep the
   account. Keep an offline copy of the snapshot files before deleting them — Blob has no
   versioning.

#### How duplicates are prevented

Posts are keyed by `source_key = ig:<shortcode>`, where the shortcode comes from the
permalink, so a post already in the table is recognised and skipped.

The first 21 posts came from an Instagram "Download Your Information" ZIP and were keyed
by paths *inside that archive*, which the API can never match. `npm run instagram:repair`
converted them to the same `ig:` form: posts with a permalink used it directly, and the
18 without one were matched to their real post by timestamp (to within 5 seconds, and
only when exactly one post matched), which also filled in their missing Instagram link.
Each original key is kept in `raw_post_json.legacy_source_key`.

#### How far back the page goes

`SNAPSHOTS_START` in [`lib/instagram-sync.js`](lib/instagram-sync.js) is the oldest post
the page shows — currently **2022-01-01**. The 47 posts from 2014–2021 are ignored.

To go further back, move that date earlier. The daily sync will backfill at 25 uploads
per run, or do it in one go locally — raise `--max-posts` too, since each run only reads
the newest 50 posts:

````sh
npm run instagram:sync -- --max-posts=200 --max-uploads=500
````

#### Token lifetime

Long-lived Instagram tokens last 60 days, but **refreshing resets the full window**, so
the daily cron keeps the token alive indefinitely — unlike Spotify, where the six-month
clock cannot be extended. The cron refreshes once the token is within 30 days of expiry,
which leaves ~30 days of slack because [Vercel cron delivery is best effort][cron-limits].

A token left unrefreshed for 60 days is dead permanently. When that happens the API
returns error code `190`; the sync records it in `integration_tokens.dead_reason`, stops
calling the API, and logs what to do. Before setting that flag the code re-checks the token with a second request, so a
transient error cannot brick the integration. Recover by generating a new token and
re-seeding it.

Check status any time with `npm run instagram:token` (no arguments).

[ig-login]: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
[cron-limits]: https://vercel.com/docs/cron-jobs/usage-and-pricing

## 📝 License
This project is licensed under the MIT License. See the [LICENSE](LICENSE.md) file for more information.

🗣️ All images, personal information, projects, and writings are not to be used without my permission and are not covered under the MIT License. You must remove all of my images, personal information, projects, and writings before using this project.
