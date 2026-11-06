# ✅ To-Do

These are tasks that I ~~want~~ need to complete in the future 🤪 Dated ones are at the top.
How everything works, and how to set it up from scratch, stays in the [README](README.md).

## 📅 Dated

### ☁️ Close the Cloudinary account

The /snapshots media moved to Vercel Blob on 2026-09-26, and on 2026-11-05 the code stopped using
Cloudinary and the `cloudinary_*` columns were dropped from production. A copy of every row's old
values is in `~/Downloads/kevinwong-instagram_media-cloudinary-columns-2026-11-06T01-52-02-109Z.json`.
Nothing on the site uses Cloudinary any more (the blog covers moved to Blob on 2026-09-27).

- [ ] Keep an offline copy of the Cloudinary files first, because Blob has no versioning.
- [ ] If `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` are still in
  the Vercel project or `.env`, remove them. Nothing in the code reads them.
- [ ] Close the account.

### 🎧 Reconnect Spotify (by ~2027-03-21)

Spotify refresh tokens die six months after they're approved, and refreshing doesn't extend that (the
README's *Spotify token* section has the details). The current token was approved from /admin on
**2026-10-22**, so it dies around **2027-04-20**. The panel's Spotify card counts down to it.

- [ ] **Reconnect from the admin panel:** https://www.kevinwong.co/admin → Spotify card → **Reconnect** →
  approve on Spotify. It takes effect within a minute, with no redeploy. Fallback:
  `npm run spotify:reauth -- --save` (README, *Spotify token*).
- [ ] The reconnect asks for two permissions now, not three: `user-read-recently-played` went with the
  Listening Timeline on 2026-11-05. Until then the stored token keeps the extra one, which does no harm.
- [ ] **Update this section's dates** from the panel's new estimate, and set a reminder for about 5 months
  after the reconnect.

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
  history and the upload ceiling*), but `npm run blog:image` uploads aren't counted.

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
- [ ] **Is `public/kw.jpg` linked from anywhere?** It's a byte-identical copy of `me.jpg` and
  nothing in the repo uses it. Delete it once I've checked nothing outside the site hotlinks it.

## 🧹 Housekeeping

### GitHub settings

- [ ] **Turn on Dependabot alerts.** GitHub → the repository → **Settings** → **Code security** →
  **Dependabot alerts** → **Enable**, and **Dependabot security updates** too if I want GitHub to open
  the fix PRs. The admin panel's spec counts on these alerts to flag a new Better Auth advisory (its
  Security table: "Exact version pin, no plugins, `npm run audit:prod` and Dependabot"). They are a
  repository setting, and nothing in the repo turns them on, so check they are on even if I think
  they are.

### Files to delete or shrink

All unused or oversized, found in the audit. Everything is in git history if needed.

- [ ] Delete unreferenced files in `public/` (≈1.8 MB, all still publicly served):
  `finder.png`, `spotify.png`, `terminal.png` (replaced by the `*-dock.png` icons),
  `cahillclub_folder.png`, `dragonbot_folder.png`, `gray_folder.png`, `yellow_folder.png`
  (folders are drawn by `FolderGlyph` now), `vercel.svg`, `emojis/books.png`.
- [ ] Shrink oversized images: `me.jpg` (699 KB at 1000², shown at 400px) → 800² mozjpeg q80;
  `emojis/*.png` (160², shown at 16–24px) → 48²; `cahillclub.png` (1650², shown ≤64px) → 128²;
  `album.png` (1448²) → 256², since it's also the full-width book-cover fallback on /bookshelf.

### Upgrades waiting on upstream

- [ ] **ESLint 10.** `eslint-config-next` 16.4.2 still depends on `eslint-plugin-react` 7.x,
  which crashes on ESLint 10 (`contextOrFilename.getFilename is not a function`). Tracked in
  jsx-eslint/eslint-plugin-react#4018 and vercel/next.js#89764. Held at 9.39.5 until a
  compatible `eslint-config-next` ships.
- [ ] **TypeScript 7.** Next 16.3.6 builds with it, but `typescript-eslint` (via
  `eslint-config-next`) only supports `<6.1.0` (typescript-eslint#10940). Held at 6.0.3; once
  that's fixed, bumping `typescript` is the only change needed.
- [ ] **braces.** No release fixes GHSA-vfj7-8cjw-p6xm (high), so `npm audit` still lists it.
  It comes in only through `eslint-config-next`, a dev tool, so `npm run audit:prod` passes.
  Update it once a patched version ships.
- [ ] **The `argparse` override.** No release fixes GHSA-hp3w-g68c-fv3c (sprintf-js, moderate),
  which came in through `gray-matter` → `js-yaml` 3 → `argparse` 1. The `overrides` entry in
  `package.json` gives that `js-yaml` `argparse` 2.0.1 instead, which has no dependencies. js-yaml
  3 loads `argparse` only for its command-line tool, which nothing here runs. Remove the override
  if `gray-matter` moves to `js-yaml` 4, or is replaced.
- [ ] **Node 26.** Production runs Node 24 (`engines`, `.nvmrc`, `@types/node` all say 24).
  Move all three together once Node 26 is LTS and Vercel offers it.

### Code follow-ups

- [ ] **Add a baseline migration for the /snapshots tables.** Nothing in `sql/` creates
  `instagram_posts`, `instagram_media` or the `media_kind` enum, and `003_asset_columns.sql`
  only alters `instagram_media`, so the README's "apply `sql/` in filename order" fails on an
  empty database. The `cloudinary_*` columns are gone since 2026-11-05, so the baseline won't
  include them. Dump the live tables into a `sql/000_…` file over the unpooled
  connection string:
  ````sh
  pg_dump --schema-only --no-owner --table=instagram_posts --table=instagram_media "<unpooled connection string>"
  ````
  `--table` doesn't include the `media_kind` type, so add its `create type` by hand
  (`\dT+ media_kind` in psql lists the values).
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
- [ ] **Rate-limit the public API routes at the edge (maybe).** `lib/rate-limit.js` is
  per-instance and runs inside the billed function. If abuse ever shows up in the logs, a
  Vercel Firewall rate-limit rule on `/api/*` stops it before it costs anything.
