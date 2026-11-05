# AGENTS.md: kevinwong.co

A guide for coding agents working on this repo: how it is put together, and what must not
break. Setup, env vars, migrations and runbooks are in [README.md](README.md). Open work and
dated tasks are in [TODO.md](TODO.md). The latest audit is in [docs/audits/](docs/audits/).
Last remapped 2026-11-05.

## Stack and commands

- Next.js 16 (**pages router**), React 19, Chakra UI v3 + next-themes, SWR. TypeScript for
  pages and components. Plain ESM JavaScript for `lib/`, `pages/api/` and `scripts/` (with
  `checkJs` off).
- Postgres (Neon) through `pg`. Vercel Blob for /snapshots media. Better Auth 1.7.12 (pinned
  exactly) for /admin. Hosted on Vercel Hobby with Fluid compute, plus one daily cron
  (`vercel.json`).
- Node 24 / npm 11 (`.nvmrc`, `engines`).

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests (`node --test tests/**/*.test.mjs`, about 340 unit tests). Integration tests skip themselves when there is no test DB |
| `npm run db:test` and then `npm run test:integration` | Integration tests against a local `kw_test*` Docker Postgres, **never production** |
| `npm run lint`, `npx tsc --noEmit` | ESLint (core-web-vitals and TS rules) and the typecheck. Both must stay clean |
| `npm run dev` | Dev server on :3000 (`.claude/launch.json` "dev") |

Tests are `.mjs` files that import the ESM `lib/` modules directly. `tests/helpers/` has the
fakes (`admin-fakes`, `fetch-stub`, `db`, `github-stub`). `tests/fixtures/prod-schema.sql` is the
dumped production schema that the integration DB is built from.

## Map

```
pages/                 routes (thin: <Meta/> + <PageShell> + a body from components/pages)
  index, stats, bookshelf, snapshots, contact, 404
  blog/index, blog/[id]          SSG from posts/*.mdx (lib/mdx.js, next-mdx-remote)
  projects/index                 the macOS-style desktop (components/desktop), ISR every 12 h
  projects/{cahillclub,dragonbot} one-line wrappers around components/projects/ProjectPage
  sitemap.xml.tsx                getServerSideProps; NAV_ITEMS + PROJECTS + post slugs
  admin/{index,sign-in}.tsx      owner-only dashboard (getServerSideProps gate)
  api/nowplaying, toptracks      Spotify (lib/spotify.js)
  api/bookshelf                  Goodreads RSS (rss-parser)
  api/snapshots/index, [postId]/media            Postgres read side of /snapshots
  api/cron/sync-instagram        daily 05:00 UTC cron → lib/instagram-sync.js
  api/admin/*, api/auth/[...all] thin shims over lib/admin/* and lib/auth.js
components/
  PageShell, Sidebar, Navbar, NavButton, Meta, NowPlaying, TopTracks, GitHubStats, PhotoPost
  hooks.ts    useMediaQuery and useNowPlaying (shared by the sidebar, the shell and the desktop)
  pages/      page bodies (Home, Blog, Bookshelf, Snapshots, Statistics, Contact)
  projects/   data.ts (PROJECTS, the single source of truth), ProjectPage, ProjectDetail
  desktop/    the /projects desktop: Desktop, windowManager, Window, Dock, apps.ts (the one app record), hooks, CSS module
  admin/      dashboard client components (client-safe imports only, see below)
  ui/         Chakra CLI snippets, kept as generated (one ESLint rule relaxed for them)
lib/
  db.js            the pg Pool singleton (max 3, attachDatabasePool) and sslFor
  redact.js        redact / describeError / capJson. Every log of an error or token goes through it
  rate-limit.js    in-memory, per-instance limiter (/api/snapshots only)
  instagram*.js, media-probe.js, image-resize.js, blob-store.js, snapshots.js, sync-runs.js
  job-locks.js     the job_locks names and the one claim query (no imports)
  spotify.js, spotify-token.js, spotify-oauth.js
  auth.js          Better Auth, built lazily
  admin/           guard, owner, status, sync-limits, audit-log, spotify-reconnect,
                   instagram-sync-route (server) + format, messages, client (client-safe)
  mdx.js, formatter.js, fetcher.js, macos.ts
scripts/           CLIs (npm run …). load-env.mjs reads .env/.env.local
sql/               001–007 migrations (idempotent, applied by hand) + undo/
docs/superpowers/  historic plans and specs for the admin panel (read-only history)
```

## Subsystems

### Public site shell
- `_app.tsx` wraps every page in `components/ui/provider` (Chakra `defaultSystem`, next-themes
  class attribute) and `SidebarProvider`.
- `PageShell` renders **both** `Sidebar` (from 64em up) and `Navbar` + Drawer (below 64em), and
  CSS (`hideBelow`/`hideFrom`) picks which one shows. This is deliberate: it keeps the server
  HTML free of a layout flash and of hydration mismatches. Don't switch to JS media queries for
  layout.
- `lib/site.js` (no imports) holds `SITE_ORIGIN` and `DEFAULT_OG_IMAGE`. `lib/admin/owner.js`
  re-exports `SITE_ORIGIN`. `Meta` emits the OG width and height only when the image equals
  `DEFAULT_OG_IMAGE`, which is also `lib/mdx.js`'s default `og_image`.
- `components/navItems.ts` (`NAV_ITEMS`) is the one list of pages for the Sidebar and the
  sitemap. Post slugs come from `getPostSlugs()` in `lib/mdx.js`.

### /projects desktop (`components/desktop/`)
- `Desktop.tsx` orchestrates. It holds the `useReducer(wmReducer)` window state, a
  ResizeObserver for the bounds, the tip banner (localStorage `projects:tip-dismissed`) and the
  focus hand-off. It runs in two modes, chosen by `useMediaQuery('(min-width: 64em)')`:
  - **Windowed:** Finder, Spotify and Terminal windows, plus the Dock.
  - **Small screens:** a full-screen `AppScreen` kept in `?app=` with a shallow push, so the
    browser's Back button closes it.
- `windowManager.ts` is a pure reducer plus the geometry. A window's `phase` drives the Web
  Animations in `Window.tsx`.
- `Dock.tsx` deep-clones window DOM for the minimized previews. Minimized windows must stay
  laid out (`.windowHidden`, never `display:none`).
- Data attributes are a cross-file contract: `data-window-id`, `data-window-phase`,
  `data-dock-drop`, `data-dock-thumb`, `data-dock-preview`, `data-drag-region`, `data-no-drag`
  and `data-focus-handoff`.
- JS constants mirror CSS values: `MENUBAR_H` = `--mac-menubar-h`, the Dock
  ICON/SLOT/SEPARATOR/PADDING values = the Dock CSS, and `ICON_W` = `.icon` width. Change both
  sides together.
- `lib/macos.ts` (server only, getStaticProps) reads the Apple RSS feed and SOFA, and never goes
  below `FALLBACK_MACOS`. A background ISR refresh throws when SOFA fails, so the last good
  page stays live.
- **No automated tests.** After any change, check /projects by hand at both breakpoints, with
  reduced motion, and in dark mode.

### Spotify
- `lib/spotify-token.js` owns the `integration_tokens` row where `provider='spotify'`. Every
  write is a **compare-and-swap on the token value**. The refresh-path queries use a
  `query_timeout` of 4,500 ms, under the client's 5 s timeout.
- `lib/spotify.js` `createSpotifyClient` provides:
  - an access-token cache with a 60 s margin
  - a single-flight refresh
  - a dead latch (`deadSince` rechecks every 60 s, and `deadToken` is never resent)
  - a `generation` guard against a refresh that started before `reset()`
  - one retry on a 401

  Postgres is touched only on a refresh.
- `lib/spotify-oauth.js` is the stateless authorization-code side. The refresh grant stays
  private to `lib/spotify.js`, and `scripts/spotify-reauth.mjs` keeps a deliberate copy of it.
- The now-playing UI exists twice, both on `useNowPlaying` in `components/hooks.ts`:
  - `components/NowPlaying.tsx` in the sidebar, which resets its progress only when the track
    changes (`resetOnChangeOf: "track"`)
  - SpotifyApp in the desktop, which resets on any new data

  They share the SWR key `/api/nowplaying`, which gives them **one cache entry and one poller**.
  `/api/nowplaying` is `no-store` on purpose.
- `SPOTIFY_SCOPES` (`lib/spotify-token.js`) is the one scope list: the reconnect checks against
  it, and the status JSON sends its length as `spotify.requiredScopeCount` for the admin card.
- Reconnect by 2027-03-21 (TODO.md). Recovery is /admin → Reconnect, or
  `npm run spotify:reauth -- --save`. Never put the token back in env vars.

### Instagram → /snapshots
- **Write side:**
  - The entry points are the cron (`CRON_SECRET` bearer, constant-time compare, 150 s
    budget), the admin panel (`lib/admin/instagram-sync-route.js`, 60 s, panel limits in
    `lib/admin/sync-limits.js`) and the CLI `scripts/instagram-sync.mjs`.
  - All three call `syncInstagram` in `lib/instagram-sync.js`, which runs this sequence:
    1. Record the run in `sync_runs`.
    2. Refresh the token **first**, before anything that can throw, on every run including dry
       runs.
    3. Apply the 1,800-uploads-per-30-days ceiling and take the `job_locks` lease
       `instagram-sync`.
    4. Fetch the media and pick the missing posts (`ig:<shortcode>`, oldest first, from
       2022-01-01).
    5. For each post: download and probe every slide, all or nothing (`lib/media-probe.js`),
       resize with sharp to fit 1440×1920 (`lib/image-resize.js`), and upload to Blob
       (`lib/blob-store.js`). Count each upload the moment it lands.
    6. Insert the post in one transaction.
  - A partial carousel is never inserted.
- **Read side:** `/api/snapshots` uses keyset pagination on (posted_at, id) and returns
  `mediaCount`, `slides` (every slide) and `media` (slide 0, for bundles from before 2026-11-05).
  `PhotoPost` indexes the slides from props, with no request per slide. `/api/snapshots/[postId]/media`
  is no longer called by the current page and stays for the rollback target (TODO.md). Both routes take their cache header and GET-only/rate-limit
  guard (`SNAPSHOTS_CACHE_HEADER`, `rejectUnlessGet`) from `lib/snapshots.js`.
- **Cloudinary retirement** is in progress (TODO.md). Since 2026-11-05 production has `asset_*`
  NOT NULL and `cloudinary_*` nullable, and the code neither writes nor reads `cloudinary_*`.
  The columns stay until TODO.md's step 3, which waits for two deploys of that code. Follow
  TODO.md's step order.
- The run lease is fenced on its `locked_until` value: renew and release only touch the row
  if it still holds this run's value, and a run that lost its lease stops with `LeaseLostError`
  (recorded `failed`). The lock names and the claim query live in `lib/job-locks.js`.
- `caption_emojis` is no longer written (it defaults to `{}`), and nothing reads it.
- Blob is on the Hobby plan: going over its quota blanks every image for up to 30 days.
  `blog:image` uploads are not counted against the ceiling.

### Admin panel and auth (production only)
- **Identity** is pinned in code in `lib/admin/owner.js` (GitHub id and login, the Spotify
  account, `SITE_ORIGIN`), never in env vars.
- `lib/admin/guard.js`:
  - `isAdminEnabled` requires `VERCEL_ENV=production` and the Host `www.kevinwong.co`. Admin is
    a 404 everywhere else, local dev included.
  - `requireAdmin` runs its checks in this order: no-store, then 404, then 403 (mutations
    must come from the same origin), then 500 or 401. **Tests pin the order of the checks.**
  - `AUTH_ALLOWLIST` passes exactly three METHOD+path pairs to Better Auth.
- `lib/auth.js` (Better Auth, built lazily):
  - GitHub sign-in only, with no scopes. `validateOwner` refuses any GitHub account but the
    owner's.
  - Sessions last 24 h and are never refreshed.
  - In production it throws if `BETTER_AUTH_TRUSTED_ORIGINS`, `BETTER_AUTH_SECRETS` or `TEST` is
    set.
- `lib/admin/status.js` `buildAdminStatus` runs 12–14 queries in parallel. Its output is
  JSON-safe and never includes a token. `lib/admin/audit-log.js` writes `admin_audit_log`,
  accepting only the `ADMIN_EVENTS` allowlist, and caps the refusal rows in SQL.
- **Client/server split:** components in `components/admin/` may import only
  `lib/admin/{format,messages,client}.js`. Never import `sync-limits`, `spotify-token`,
  `audit-log` or `db` there, because each pulls `pg` into the client bundle. Numbers the client
  needs live in import-free modules: the panel limits are in `lib/admin/limits.js`, which
  `sync-limits.js` re-exports.
- Route handlers are factories that take injected `deps` (`createStatusHandler` and similar),
  so they can be unit-tested without a DB.

### Database and migrations
- `sql/001`–`007` are idempotent and applied **by hand**, in order, before the code that needs
  them (`npm run db:apply`, which needs `--yes` for a non-local target). ALTERs use
  `set local lock_timeout` inside `begin`/`commit` because of the transaction-mode pooler. Run
  DDL over the **unpooled** URL.
- Nothing in `sql/` creates `instagram_posts`, `instagram_media` or `media_kind`. A baseline
  `sql/000` is planned (TODO.md).
- `sql/undo/*` are the tested manual rollbacks.

## Rules for changes

- **Production is Kevin's.** Never run anything against the production DB, Blob or Vercel. Give
  him one read-only script or one command instead (see the memory notes).
- Never log tokens, secrets or raw errors. Use `redact` and `describeError`.
- Keep the security headers in `next.config.js` and the admin gate order exactly as they are.
  Tests assert them.
- Many comments record a constraint (Hobby limits, rollback safety, client-bundle size). Read
  the comment and TODO.md before deleting something that looks redundant.
- A refactor must not change behaviour: HTTP status, headers and body, DB writes, rendered
  output and CLI output stay the same. Run `npm test`, `npm run lint` and `npx tsc --noEmit`.
  Areas with **no tests**: `components/desktop`, `media-probe`, `image-resize`, `blob-store`,
  the public API routes other than the `/api/snapshots` list, `PhotoPost`, `lib/mdx.js`
  (`lib/macos.ts` has tests for its pure parsers only). For those, write a
  characterization test first, or check by hand in the browser in light and dark mode, below
  and above 64em.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
