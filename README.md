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
media mirrored to Cloudinary. A daily Vercel Cron job pulls new posts from the Instagram
API and fills those tables.

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
2. Set these environment variables locally and in Vercel:
   `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, and
   `CRON_SECRET` (any long random string — the cron endpoint refuses to run without it).
3. In the Meta App Dashboard, go to **Instagram → API setup with Instagram business
   login** and click **Generate token**. No OAuth redirect flow is needed for a single
   account.
4. Store it, which also validates it against the API. Pass it through the
   environment rather than as an argument, so it stays out of your shell history:
   ````sh
   INSTAGRAM_ACCESS_TOKEN=<TOKEN> npm run instagram:token
   ````
5. Reconcile the posts that came from the old data-export import:
   ````sh
   npm run instagram:repair            # dry run
   npm run instagram:repair -- --apply
   ````
6. Dry-run the sync, then let it run for real:
   ````sh
   npm run instagram:sync -- --dry-run
   npm run instagram:sync
   ````

#### How duplicates are prevented

Posts are keyed by `source_key = ig:<shortcode>`, where the shortcode comes from the
permalink. The rows imported from the data-export ZIP are keyed by a path *inside that
archive*, and 18 of them have no `instagram_url` at all, so they cannot be matched to
anything the API returns.

Those 18 all predate **2025-10-25**, and every post after that date does carry a
permalink. The sync therefore ignores anything the API returns at or before the newest
unmatchable post — see `findLegacyWatermark` in
[`lib/instagram-sync.js`](lib/instagram-sync.js). Without that guard, years of posts
would be re-imported as duplicates.

The watermark is derived from `source_key`, not `instagram_url`: it is the newest post
whose key does not start with `ig:`. So to move it, backfill `instagram_url` on those
rows **and then re-run `npm run instagram:repair -- --apply`** to convert their keys.
Backfilling the URL alone changes nothing.

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
