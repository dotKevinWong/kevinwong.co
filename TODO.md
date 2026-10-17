# ✅ To-Do

These are tasks that I ~~want~~ need to complete in the future 🤪 Dated ones are at the top.
How everything works, and how to set it up from scratch, stays in the [README](README.md).

## 📅 Dated

### ☁️ Retire Cloudinary (not before 2026-10-27)

The /snapshots media moved to Vercel Blob on 2026-09-26. The copy was done that day, and the
switch (commit `bf9932f`) landed on `main` the same night. Wait **at least 30 days after the
switch is deployed and working**, because until then rolling back to the old code still needs
the Cloudinary files. The 2026-10-27 date assumes production deployed the switch on
2026-09-26/27. If Vercel → Deployments shows a later date, count 30 days from that instead.

Then do the steps in this order. Each one leaves every deployment that could still be serving
(including the Instant Rollback target) working. Run the SQL over the unpooled connection
string (the non-pooler Neon host), not the pooled `DATABASE_URL`.

- [ ] **0. Make sure nothing can roll back to pre-switch code.** Both the current production
  deployment and its Instant Rollback target (on Hobby, the deployment just before it) must
  include the switch. The code deployed from 2026-09-05 until the switch ran its own daily
  sync, which inserts `instagram_media` rows with only the `cloudinary_*` columns. Once step 1
  makes `asset_*` `not null`, those inserts would fail.
- [ ] **1. Relax the schema.** This is safe for every deployment that includes the switch,
  because that code already writes `asset_*` on every insert. First confirm nothing is
  missing. This must return 0:
  ````sql
  select count(*) from instagram_media where asset_url is null or asset_pathname is null;
  ````
  then (if the lock timeout trips, the transaction rolls back and can simply be re-run):
  ````sql
  begin;
  set local lock_timeout = '5s';
  alter table instagram_media
    alter column asset_url set not null,
    alter column asset_pathname set not null,
    alter column cloudinary_url drop not null,
    alter column cloudinary_public_id drop not null,
    alter column cloudinary_folder drop not null;
  commit;
  ````
- [ ] **2. Stop using the old columns in code.** In [`lib/instagram-sync.js`](lib/instagram-sync.js),
  stop `insertPost` writing `cloudinary_*` (and drop the now-unused `folder` / `folderFor`
  plumbing that only feeds them). In both `pages/api/snapshots` routes, remove the
  `coalesce(..., m.cloudinary_*)` fallbacks and select the `asset_*` columns directly. Delete
  `scripts/snapshots-blob-backfill.mjs` and its `snapshots:blob` npm script, which reads
  `cloudinary_*`. Deploy, then **Redeploy once more** (Vercel → Deployments → Redeploy). On
  Hobby, Instant Rollback can only go to the immediately previous deployment, and the extra
  deploy makes sure that target no longer reads the columns step 3 removes.
- [ ] **3. Drop the columns.** This is deliberately **not** a file in `sql/`. Setup applies
  that folder in order, and running this early would break the old code:
  ````sql
  begin;
  set local lock_timeout = '5s';
  alter table instagram_media
    drop column cloudinary_public_id, drop column cloudinary_url,
    drop column cloudinary_version, drop column cloudinary_resource_type,
    drop column cloudinary_format, drop column cloudinary_width,
    drop column cloudinary_height, drop column cloudinary_duration,
    drop column cloudinary_folder;
  commit;
  ````
- [ ] **4. Close the Cloudinary account.** The blog covers moved to Blob on 2026-09-27, so once
  steps 1–3 are done nothing on the site uses Cloudinary. Keep an offline copy of its files
  first, because Blob has no versioning.
  - If `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` are still in
    the Vercel project or `.env`, remove them. Nothing in the code reads them.
  - Delete the *Moving from Cloudinary* and *Retiring Cloudinary* notes from the README, and
    the pointers to them in `sql/003_asset_columns.sql` and `lib/instagram-sync.js`.

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

## 👀 Only if something happens

- [ ] **Captions stop working.** *If every Instagram sync starts failing with error code
  `100`* (`code=100` in the cron's `detail` and in the `[cron/sync-instagram] failed:` log).
  Meta's docs badge `caption` as Facebook-Login-only, but it read fine with Instagram Login on
  2026-09-26. Re-check with `npm run instagram:sync -- --probe-caption`. If it reports captions
  as unsupported, remove `caption` from `MEDIA_FIELDS` in [`lib/instagram.js`](lib/instagram.js)
  and deploy. The token refresh runs before the fetch that fails, so the token stays alive in
  the meantime.
- [ ] **The Instagram token dies.** *If the cron answers `503 Instagram re-authorization
  required`, or `npm run instagram:token` shows `DEAD`.* Generate a new token (Meta App
  Dashboard → Instagram → API setup with Instagram business login → Generate token) and
  re-seed it with `INSTAGRAM_ACCESS_TOKEN=<TOKEN> npm run instagram:token`. Starting the line
  with a space keeps the token out of most shells' history.
- [ ] **Blob usage climbs.** *If /snapshots ever gets heavy traffic or hotlinking*, check the
  store's **Usage** tab. On Hobby, going over 1 GB of storage, or over 2,000 uploads, 10,000
  simple operations or 10 GB of transfer in a month, locks Blob for up to 30 days and every
  image on /snapshots goes blank. The sync stops itself at 1,800 uploads in 30 days (README, *Run
  history and the upload ceiling*), but `npm run blog:image` and `npm run snapshots:blob` uploads
  aren't counted.

## ✍️ Content

- [ ] Add blog posts. For the cover, run `npm run blog:image -- path/to/cover.jpg my-post-slug --update`.
- [ ] Add more projects
- [ ] Add more statistics
- [ ] Write a meta description for each page. Everything except the home page and blog posts
  still shares "Developer, Creator, and Entrepreneur".

## 🙋 Needs a decision

Found in the 2026-09-27 codebase audit. Each needs something only I know.

- [ ] **Renew the PGP key.** /contact asks people to encrypt to key `0x10062475CF2EDFB7`,
  whose only encryption subkey expired on 2025-12-30, and the pgp.mit.edu link it points to
  hangs. Extend or replace the subkey, upload it to a keyserver that works (e.g.
  keys.openpgp.org), and update the text and link in
  [`components/pages/Contact.tsx`](components/pages/Contact.tsx).
- [ ] **Fix the DragonBot GitHub link.** It points to a GitHub account that doesn't exist (404).
  Fix or remove it in [`components/projects/data.ts`](components/projects/data.ts).
- [ ] **Top Tracks skips my top 5.** The endpoint in [`lib/spotify.js`](lib/spotify.js) uses
  `offset=5`, so the card titled "my current top tracks" shows ranks 6–15. It has been that way
  since the first commit. Remove `&offset=5`, or keep it and change the card's wording.
- [ ] **Remove the Listening Timeline?** The chart was taken off /stats in `22f5cae`, but
  `/api/listeningtimeline` is still live and public, and `components/ListeningTimeline.tsx`,
  `chart.js` and the `user-read-recently-played` Spotify scope only exist for it. To remove
  it: delete the route and component, remove `getListeningTimeline` / `RECENTLY_PLAYED_ENDPOINT`
  from `lib/spotify.js`, `npm uninstall chart.js`, drop `user-read-recently-played` from every
  list that `grep -rn user-read-recently-played lib scripts` finds (`SPOTIFY_SCOPES` in
  [`lib/spotify-token.js`](lib/spotify-token.js), which the reconnect checks granted scopes
  against), and mention it in the README's env var table. The narrower scope takes effect at the
  next Spotify re-auth.
- [ ] **Is `public/kw.jpg` linked from anywhere?** It's a byte-identical copy of `me.jpg` and
  nothing in the repo uses it. Delete it once I've checked nothing outside the site hotlinks it.

## 🧹 Housekeeping

### Files to delete or shrink

All unused or oversized, found in the audit. Everything is in git history if needed.

- [ ] Delete unused code: `components/Footer.tsx`, `components/ui/toaster.tsx`,
  `styles/globals.css`, `styles/Home.module.css`.
- [ ] Retire `npm run instagram:repair`: the export-era keys were all converted (`99b8266`).
  Delete `scripts/instagram-repair-source-keys.mjs` and its npm script, remove README setup
  step 6, and in `scripts/snapshots-blob-backfill.mjs` reword the comment that says to run it
  first.
- [ ] Delete unreferenced files in `public/` (≈1.8 MB, all still publicly served):
  `finder.png`, `spotify.png`, `terminal.png` (replaced by the `*-dock.png` icons),
  `cahillclub_folder.png`, `dragonbot_folder.png`, `gray_folder.png`, `yellow_folder.png`
  (folders are drawn by `FolderGlyph` now), `vercel.svg`, `emojis/books.png`.
- [ ] Shrink oversized images: `me.jpg` (699 KB at 1000², shown at 400px) → 800² mozjpeg q80;
  `emojis/*.png` (160², shown at 16–24px) → 48²; `cahillclub.png` (1650², shown ≤64px) → 128²;
  `album.png` (1448²) → 256², since it's also the full-width book-cover fallback on /bookshelf.

### Upgrades waiting on upstream

- [ ] **ESLint 10.** `eslint-config-next` 16.3.6 still depends on `eslint-plugin-react` 7.x,
  which crashes on ESLint 10 (`contextOrFilename.getFilename is not a function`). Tracked in
  jsx-eslint/eslint-plugin-react#4018 and vercel/next.js#89764. Held at 9.39.5 until a
  compatible `eslint-config-next` ships.
- [ ] **TypeScript 7.** Next 16.3.6 builds with it, but `typescript-eslint` (via
  `eslint-config-next`) only supports `<6.1.0` (typescript-eslint#10940). Held at 6.0.3; once
  that's fixed, bumping `typescript` is the only change needed.
- [ ] **sharp 0.35.5.** An RC is out; move to the stable release when it lands. Keep the
  `^0.35.4` floor: 0.35.4 bundles libheif 1.23.2, which fixes a heap overflow on crafted
  AVIF/HEIF files, and the Instagram sync runs sharp on downloaded images.
- [ ] **Node 26.** Production runs Node 24 (`engines`, `.nvmrc`, `@types/node` all say 24).
  Move all three together once Node 26 is LTS and Vercel offers it.

### Code follow-ups

- [ ] **Add a baseline migration for the /snapshots tables.** Nothing in `sql/` creates
  `instagram_posts`, `instagram_media` or the `media_kind` enum, and `003_asset_columns.sql`
  only alters `instagram_media`, so the README's "apply `sql/` in filename order" fails on an
  empty database. Best done after step 3 of *Retire Cloudinary*, so the baseline doesn't include
  the `cloudinary_*` columns. Dump the live tables into a `sql/000_…` file over the unpooled
  connection string:
  ````sh
  pg_dump --schema-only --no-owner --table=instagram_posts --table=instagram_media "<unpooled connection string>"
  ````
  `--table` doesn't include the `media_kind` type, so add its `create type` by hand
  (`\dT+ media_kind` in psql lists the values).
- [ ] **Fence the sync's run lease.** `renewLease` / `releaseLease` in `lib/instagram-sync.js`
  don't check that the run still owns the lease. A local backfill where one post takes over 10
  minutes could lose its lease to the cron, then take it back and later clear the cron's lease,
  so two runs overlap and double-count Blob uploads. Fix: return `locked_until::text` from
  `acquireLease`, add `and locked_until = $3::timestamptz` to renew/release, and abort the run
  when a renew updates 0 rows. The abandoned-run sweep in `lib/sync-runs.js` trusts the lease
  too. Test with `npm run test:integration` on the local test database, never production.
- [ ] **Headings.** Blog posts and the main pages have an `<h1>` now; the 404 page and Home
  still don't, and the Sidebar/Navbar name renders as an `<h2>` above every page's `<h1>`.
- [ ] **Trim Chakra's theme (maybe).** `components/ui/provider.tsx` ships the full
  `defaultSystem`. A minimal system with only the ~15 recipes in use would save roughly
  15–25 KB gzip per page. Measure `route-bundle-stats.json` before and after, and check every
  page, including drawers and close buttons.
- [ ] **Go fully ESM.** Every `lib/*.js` is ESM now. Converting `next.config.js` to
  `next.config.mjs` would allow `"type": "module"` in `package.json` and dropping the
  `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON` flags from the npm scripts.
- [ ] **`scripts/load-env.mjs` vs Next's loader.** It parses `.env` files more simply than Next
  does (no `export` prefix, inline comments, `$VAR` expansion). Consider `@next/env`'s
  `loadEnvConfig` so the scripts see exactly what the app sees.
- [ ] **De-duplicate the Instagram token SQL.** `scripts/instagram-token.mjs` copies
  `storeToken`'s upsert and hard-codes the Graph API version instead of importing both from
  `lib/instagram.js`.
- [ ] **Rate-limit the public API routes at the edge (maybe).** `lib/rate-limit.js` is
  per-instance and runs inside the billed function. If abuse ever shows up in the logs, a
  Vercel Firewall rate-limit rule on `/api/*` stops it before it costs anything.
