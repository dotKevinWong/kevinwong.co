# Codebase audit, 2026-11-05

## How this audit was run

The audit covered four kinds of problem: **duplicated logic, dead code, performance
bottlenecks and overly complex modules**. Security was out of scope, because the previous
branch covered it.

- **Finding.** Seven Opus auditors read the code. Five each covered one subsystem: Instagram,
  Spotify, admin/auth/DB, the desktop UI and the public pages. Two swept the whole repo, one for
  duplication and one for dead code.
- **Checking.** Every finding then went to an Opus skeptic, whose job was to refute it and to
  confirm whether the fix keeps behaviour identical.
- **Raw results.** 74 findings: 25 confirmed, 47 corrected (ratings, locations or the fix
  itself) and 2 refuted. Duplicates found by more than one auditor are merged below, which
  leaves **4 medium and 41 low** (45 in total).
- **Not changed.** Nothing in the code was changed. Every item below needs Kevin's approval.

**Baseline before any change:** `npm test` passes all 320 tests, and `npm run lint` and
`npx tsc --noEmit` are clean.

**Headline:** there are **no high-impact issues**. The codebase is small (about 7,800 lines
outside the tests) and heavily commented, and most of the constraints that look like
duplication are documented on purpose. Examples are the client-bundle split, rollback safety,
and the deliberate copy of the refresh grant in the CLI. The biggest wins are finishing work
already tracked in TODO.md (Cloudinary, Listening Timeline, dead files) and one real
user-facing latency on /snapshots.

## Status: the zero-change batch has been applied (2026-11-05)

Kevin approved the zero-change batch, and it has been applied. It is not committed yet.

**Items applied:** L2, L4 (all except `lib/macos.ts`, kept as is), L5, L6, L8, L13, L14, L15,
L16, L18, L19, L21, L26, L27, L28, L33, L34, and M3's zero-change step.

**How:** five agents each worked on their own set of files, and a reviewer checked each set.
An Opus reviewer then checked the whole diff. All of them approved on the first round.

**Verification:**

| Check | Result |
| --- | --- |
| Unit tests | 313 of 313 pass. That is 316 on HEAD, minus 4 duplicate tests deleted and plus 1 moved |
| Integration tests | 206 of 206 pass on the local Docker test DB |
| `npm run lint`, `npx tsc --noEmit` | Clean |
| 22 routes on the dev server (pages, sitemap, API, admin 404s, cron 401) | Headers, and the HTML with scripts and asset hashes removed, are byte-identical to before |
| /projects Spotify window | The visualizer renders and the console shows no errors |

**Differences the reviewers noted:**
- **L33:** the dashboard makes one fewer query per poll. The ceiling verdict now uses the same
  upload count as the bar.
- **M3:** the title marquee re-measures when the title changes or the window resizes, instead of
  every second. (Artist and album pass plain strings, so they already behaved this way.)
- **L28:** only `.mdx` files count as posts. That was already the only kind `getPost` could
  read.
- **L5:** an MP4 whose `mvhd` box is truncated, placed after its `trak`, now gets its
  dimensions instead of null. No valid file is affected.

**Not covered by the checks:** the happy path of `/api/snapshots` with data (the dev server
has no `DATABASE_URL`) and the sidebar with a song playing. The code for both was reviewed
line by line.

## Status: the remaining items have been applied (2026-11-05)

Kevin then said "Fix everything". Nothing is committed yet.

**Applied:** M2, the rest of M3, M4, L1, L3, L7, L12 together with the lease fencing from TODO.md,
L22, L24, L29, L30, L31, L35, L36, L38, L39, L40, L41, and tests for `lib/macos.ts` (from L4).

**Left, and why:**

| Item | Why |
| --- | --- |
| M1 Cloudinary | In progress. Step 1 ran on production 2026-11-05 and step 2's code is made (reviewed, tests pass). Left: deploy step 2 twice, then step 3 (drop the columns) and step 4 (close the account), per TODO.md |
| L9 duplicate index | Done on production 2026-11-05 (Kevin ran it); the schema fixture no longer has it |
| L10, L11, L37 | The recommendation was no change |
| L32 | Deferred until a third project |
| L17, L20, L23, L25 | Optional, and the copies differ on purpose or the saving is a line or two |
| L21's `@next/env` part | It would change how the scripts parse `.env` files |

**How:** six groups of agents, each on its own files. Each group had a reviewer, or two Opus
reviewers for the carousel and the sync. An Opus reviewer then checked the whole diff. Two groups
needed a second round. A reviewer for group D mistook the batch-1 marquee fix for an unrequested
change and reverted it, so it was restored by hand afterwards.

**Verification:**

| Check | Result |
| --- | --- |
| `npm test` | 558 of 558 pass (343 unit tests, plus the integration suites when the test DB is up) |
| `npm run test:integration` | 215 of 215 pass on the local Docker test DB, 9 more than before |
| `npm run lint`, `npx tsc --noEmit` | Clean |
| 22 routes on the dev server | Headers are identical. The HTML differs only where L39 removed no-op `flex: 1` and `maxW` styles, and where L29 reordered the card CSS. Layout is unchanged |
| /snapshots with 15 seeded posts (scratch local DB) | Slides change with no request. The dots behave as before, wrap-around works both ways, and infinite scroll loaded all 15 posts. Checked at phone width and in dark mode |
| /projects | Windows open and take focus, the tip banner shows, `?app=` opens on small screens and Back closes it. No console errors |

**Deliberate behaviour changes (all approved by "Fix everything"):**
- `/api/listeningtimeline` is gone. The Spotify scope list is two permissions, which takes effect at the
  next reconnect, and the admin card counts scopes from the status JSON.
- `/api/snapshots` also returns `slides` for each post, and "Loading media…" can no longer appear.
- New posts leave `caption_emojis` at its default `{}`.
- A sync run that lost its lease to another run stops and is recorded `failed`.
- The snapshots backfill's "blocked" reason no longer mentions `instagram:repair`.

### Legend

- **Impact:** H = users or operations are hurt now. M = visible latency, a stale-data trap, or
  a lot of dead weight. L = tidiness and maintainability.
- **Effort:** S = under 1 h. M = half a day. L = a day or more.
- **Zero-change** means the fix as written keeps HTTP responses, headers, DB writes, rendered
  output and CLI output identical.
- **⚠ behaviour** means the fix changes something observable and needs a deliberate yes.
- **Tracked** means TODO.md already lists the item.

## Medium impact

### M1. Cloudinary retirement is overdue (dead code + extra work in the hot read query)

Dead code, effort M, **Tracked**, needs production steps.

- **What's left:** `lib/instagram-sync.js` still writes `cloudinary_*` (around lines 207 and
  310–334). Both snapshots routes still `coalesce(asset_*, cloudinary_*)` (`index.js:101-106`,
  `[postId]/media.js:44-49`). `scripts/snapshots-blob-backfill.mjs` is still there with its npm
  script.
- **When:** TODO.md dated the work "not before 2026-10-27", and that date has passed.
- **Correction from verification:** `folderFor` in `lib/blob-store.js` must **stay**, because
  `pathnameFor` uses it for every Blob path. Only the `folder:` field in instagram-sync is
  Cloudinary-only.
- **Fix:** TODO.md steps 0–4, in order. Step 0 is checking the rollback target in Vercel. Steps
  1 and 3 are production SQL, which Kevin runs.

### M2. Carousel slides load one API round trip at a time

Performance, effort M, **⚠ behaviour**.

- **The problem:** `/api/snapshots` returns only slide 0 (`index.js:109`
  `filter (where m.position = 0)`). `PhotoPost.goToPosition` then *awaits*
  `/api/snapshots/[postId]/media?position=N` before advancing. So every first "next" shows
  "Loading media…" while a serverless function and possibly a cold DB connection respond, and
  each slide costs a billed invocation per 5-minute cache window.
- **Fix:** return every slide in the list query. That's at most 12 posts × 20 slides, a few KB.
  Index slides from `props.media`, then delete about 60 lines of fetch, pending and prefetch
  state. Keep `[postId]/media.js` for one more deploy, so cached bundles and the rollback
  target keep working.
- **Behaviour:** the "loaded" dots (opacity 0.6 → 1) and the spinner would disappear. To keep
  the visuals identical, keep a "seen" set. No tests cover either route or PhotoPost, so check
  by hand: wrap-around, dot clicks, video, single-image posts and infinite scroll.

### M3. Now-playing is implemented twice

Duplication, effort S for the zero-change step and M for the full merge.

- **Where:** `components/NowPlaying.tsx:75-148` (sidebar) and `components/desktop/hooks.ts:50-106`
  (`useNowPlaying`, used by SpotifyApp).
- **What they share:** the same 10-field type, the same `formatDuration`, the same SWR key and
  error masking, and a 1-second progress ticker.
- **How they differ:** the sidebar resets progress only when the song, duration or title
  changes. The hook resets on any new data.
- **Also:** `MarqueeText` gets a new `children` array on each 1-second tick, so the title
  marquee re-binds a resize listener and re-measures every second while a song plays
  (`NowPlaying.tsx:42-54, 201`).
- **Zero-change fix:** export `NowPlayingData` and `formatDuration` from one module (ideally
  outside `desktop/`) and delete the sidebar's copies. Give `MarqueeText` a stable string
  dependency.
- **Optional ⚠ behaviour:** make the sidebar call `useNowPlaying({ poll: true })`. This changes
  the reset timing slightly.

### M4. The Spotify scope count is hard-coded in client copy, and the planned removal will miss it

Duplication and a stale-data trap, effort S.

- **Where:** `components/admin/SpotifyCard.tsx:8` has `SCOPE_COUNT = 3`, rendered as "Scopes: N
  of 3". `lib/admin/messages.js:77` says "all **three** permissions". Both mirror
  `SPOTIFY_SCOPES`.
- **The trap:** TODO.md's Listening Timeline removal says to use
  `grep -rn user-read-recently-played lib scripts`, which finds neither copy. After the removal
  the card would show "2 of 3" when nothing is wrong.
- **Fix, zero-change today:** send the required count in the status JSON
  (`SPOTIFY_SCOPES.length` from `lib/admin/status.js`) and word the message without a number.
  At minimum, add both files to the TODO item.

## Low impact

### Dead code

| # | Finding | Effort | Notes |
| --- | --- | --- | --- |
| L1 | **Listening Timeline chain is unreachable.** Covers `components/ListeningTimeline.tsx`, `/api/listeningtimeline`, `getListeningTimeline`, the `chart.js` dependency and the `user-read-recently-played` scope | S | **Tracked**. ⚠ behaviour: removes a public route and narrows the OAuth scope. Also update M4 and `tests/spotify.test.mjs:9,50-53,397` |
| L2 | `components/Footer.tsx`, `components/ui/toaster.tsx`, `styles/globals.css` and `styles/Home.module.css` have no importers | S | **Tracked**, zero-change |
| L3 | `scripts/instagram-repair-source-keys.mjs` and `npm run instagram:repair` are a finished one-off | S | **Tracked**. Also reword README step 6 and line 571, and the backfill's `blocked` message |
| L4 | About 20 exports are used only inside their own module: `lib/macos.ts` (6), `image-resize` `MAX_WIDTH/HEIGHT`, `extractEmojis`, `SNAPSHOTS_START`, `sniff`, `PROVIDER`, `loadToken`, `STATE_COOKIE_NAME`, `DOCK_RESERVE`, `TrafficLights`, `ProjectLogo` | S | Zero-change. For `lib/macos.ts`, **better: add tests** that import them, because it has none |
| L5 | `lib/media-probe.js:79-100, 225-243` parses the MP4 `mvhd` for a `duration` no caller reads | S | Zero-change |
| L6 | `lib/instagram-sync.js:367-368` re-exports `describeError` for one route. `tests/instagram-sync.test.mjs` mostly repeats `tests/redact.test.mjs` | S | Zero-change. Move its one unique case (AggregateError with code) into `redact.test.mjs` |
| L7 | `caption_emojis` is written on every insert and never read | S | ⚠ data decision. Un-exporting `extractEmojis` is the only zero-change part |
| L8 | `tsconfig.json:26-29` explicitly includes four `lib/*.js` files, which does nothing with `checkJs` off | S | Zero-change for the build. Alternatively, add `// @ts-check` on purpose |
| L9 | Redundant index `instagram_media_post_id_position_idx` duplicates the UNIQUE (post_id, position) constraint (seen in `tests/fixtures/prod-schema.sql:137,183`) | S | Check in production with `\d instagram_media` first. Then `drop index concurrently` (Kevin runs it) and leave it out of the planned `sql/000` |
| L10 | Unused MDX component-map entries (`pages/blog/[id].tsx:33-51`) and Chakra snippet exports (`useColorModeValue`, `LightMode`, `DarkMode`) | S | Recommend **no change**: the map works as an allowlist, and the snippets are vendored |
| L11 | `.gitignore` keeps yarn/pnpm/coverage/out entries from the create-next-app template | S | Recommend no change (harmless safety net) |

### Duplication

| # | Finding | Effort | Notes |
| --- | --- | --- | --- |
| L12 | `job_locks` claim and release SQL is duplicated between `acquireLease` (`instagram-sync.js:220-255`) and `claimPanelSlot` (`sync-limits.js:84-108`). The lock-name literals appear in 4 files, and `sync-limits.js:107` re-types `IMPORT_SLOT` | S | Zero-change if the strings stay identical. **Best done together with the tracked "Fence the sync's run lease"** |
| L13 | The 15-minute abandoned-run rule exists as SQL (`sync-runs.js:70`) and as ms (`status.js:21`), and `toRunJson` re-normalises fields that are already normalised | S | Zero-change: export `ABANDONED_AFTER_MINUTES` |
| L14 | Panel limits ("10 minutes", "24 hours", 1,000) are mirrored as literals in `messages.js:148-153, 281, 299` | S | Zero-change: a dependency-free `lib/admin/limits.js` that both files import, keeping `pg` out of the client |
| L15 | The Spotify token endpoint and Basic auth header are built 3 times (`spotify.js:8,101`, `spotify-oauth.js:18,66`, `spotify-reauth.mjs:57,140`) | S | Zero-change. Share **only** the constant and the header helper. The refresh grants stay separate on purpose |
| L16 | `readSpotifyRow` and `readSpotifyStatusRow` repeat the row mapping (`spotify-token.js:59-68, 153-161`) | S | Zero-change: a private mapper. Keep both SELECTs and the `query_timeout` on the first only (tests assert it) |
| L17 | The spotify-reauth CLI repeats the callback's scopes → account → owner → save sequence (about 15 lines) | S | Optional. The copies differ on purpose (exit codes, audit, cache reset) |
| L18 | The two snapshots routes share a byte-identical `CACHE_HEADER` and its comment, the 405 block and the 429 guard. `SnapshotMedia` is declared in both Snapshots.tsx and PhotoPost.tsx. Snapshots.tsx re-implements `lib/fetcher` | S | Zero-change. The error message of the local fetcher is never shown |
| L19 | `/admin` and `/admin/sign-in` `getServerSideProps` repeat the same gate (`pages/admin/index.tsx:13-21`, `sign-in.tsx:12-19`) | S | Zero-change: an `ownerForPage()` helper in guard.js. **Leave** the spotify-reconnect gates alone, because they differ on purpose (303 status, order, cookie) |
| L20 | The outer try/catch-500 boundary appears in 3 admin handlers, and the 405 JSON block in 4 | S | Optional. Worth doing only if more admin routes are added |
| L21 | Four scripts copy the "apply env files to process.env" loop | S | Zero-change: `applyEnvFiles()` in `load-env.mjs`. **Don't** fold in `db-apply`, `test-db` or `instagram-token`, which deliberately don't write `process.env`. Pair it with the tracked `@next/env` item |
| L22 | `scripts/instagram-token.mjs` copies `storeToken`'s upsert and hard-codes Graph `v25.0` | S | **Tracked**. Careful: `getDbPool()` isn't neutral there (pool size, TLS for loopback, the env-file rule) |
| L23 | Sync defaults 50/25 restated in the CLI (`instagram-sync.mjs:129-130`) | S | Marginal. `PANEL_RUN` is fixed on purpose and tests assert it |
| L24 | The pluralisation helper is written 4 times (`messages.js:54`, `format.js:76`, `InstagramCard.tsx:14,163`) | S | Only `InstagramCard`'s two raw copies can merge. `messages.plural` formats with `formatCount`, so unifying them would change output above 1,000 |
| L25 | The SHA-256 + `timingSafeEqual` compare is written twice (cron, `statesMatch`) | S | Rank last or skip: it saves about 2 lines, and the wrappers must stay |
| L26 | The sidebar nav list is duplicated as the sitemap's `PAGES` (`Sidebar.tsx:115-121`, `sitemap.xml.tsx:8`) | S | Zero-change: a shared `NAV_ITEMS` (with no icons in the sitemap's import) |
| L27 | The site URL is a literal in `Meta.tsx:4`, `sitemap.xml.tsx:5` and `lib/mdx.js:36-37` although `lib/admin/owner.js` exports `SITE_ORIGIN`. Meta's OG size tags depend on string equality with the mdx default | S | Zero-change: one `SITE_ORIGIN` and `DEFAULT_OG_IMAGE` |
| L28 | The post slug is derived 3 inconsistent ways (`lib/mdx.js:44-60`, `blog/[id].tsx:113`, `sitemap.xml.tsx:25`). A stray `foo.md` would break the build | S | Zero-change for today's 4 `.mdx` posts: one `getPostSlugs()` |
| L29 | Repeated chrome markup: the two sidebar toggles, the site title (Sidebar and Navbar) and the card styling (`TopTracks`, `GitHubStats`, `AdminCard`, with `#111111` 6 times) | S | Zero-change: `Card`, `SiteTitle`, `SidebarToggle` and a semantic token |
| L30 | Desktop: app ids, names and tones spread over 5 files. `cx` and `clamp` copied. JS layout constants mirror CSS | S | Zero-change: one `apps.ts` record and shared helpers. Add cross-reference comments on the CSS side |
| L31 | Test setup: four Blob-fake env lines are copied into 3 integration tests, and the other-project port list is written 3 times | S | Zero-change: `tests/helpers/fake-blob-env.mjs` and an exported `OTHER_PROJECT_PORTS` |
| L32 | One `/projects/<id>.tsx` file per project instead of a `[id].tsx` route | S | **Defer** until a third project, because it switches the pages from automatic static optimization to SSG |

### Performance

| # | Finding | Effort | Notes |
| --- | --- | --- | --- |
| L33 | `buildAdminStatus` reads the 30-day upload total twice per 30-second poll (`status.js:126,128` → `sync-limits.js:66`) | S | Zero-change: pass the value through. This also makes the bar and the verdict use the same number |
| L34 | The Spotify plasma visualizer allocates 2 arrays per cell per frame (about 10.8k cells at 600×440) (`SpotifyApp.tsx:11-18, 52-99`) | S | Zero-change: write into `image.data` directly. **Don't** throttle or switch to time-based `t`, because that visibly changes the animation |

### Complexity

| # | Finding | Effort | Notes |
| --- | --- | --- | --- |
| L35 | `runSync` is about 130 lines and threads 9–10 parameters plus mutable boxes (`instagram-sync.js:538-666`) | M | Extract only a pure `selectMissing(raw, existingKeys)` (lines 539-571), with unit tests. The lease box and the ordering are load-bearing and commented |
| L36 | `Desktop.tsx` mixes the tip banner, focus hand-off and the `?app=` routing | S | Optional: `useTipBanner`, `useAppScreenRoute` and `useKeyWindowFocus`. There are no tests, so check by hand |
| L37 | `Desktop.module.css` is 1,444 lines | M | **Recommend leaving it.** The `.theme` descendant selectors and source order make a split risky |
| L38 | `Sidebar` imports `useMediaQuery` from `components/desktop/hooks` | S | Zero-change: move the shared hooks to `components/hooks.ts` |
| L39 | No-op layout wrappers: an inner `maxW` under a smaller outer `maxW`, `flex="1"` inside a block `<main>`, and `passHref` | S | Zero-change. **Keep** `overflow="auto"`, because it scopes wide tables in posts |
| L40 | Bookshelf renders the cover `<Image>` twice (`Bookshelf.tsx:128-148`) | S | Zero-change: render it once and wrap it in a Link only when there is a URL. Leave the API's `limit`, `message` and `sourceTitle` alone |
| L41 | Redundant `.slice(0, 20)` in RunsTable and ActivityLog, which SQL already limits | S | Optional. They cost nothing |

### Refuted (no action)

- **Cache `/api/nowplaying` at the edge.** A 5-second `s-maxage` would almost never hit at this
  traffic, and it would make the song state stale. Keep `no-store`.
- **`/api/bookshelf`'s numeric `limit` is dead.** It's the documented default path of a public
  route. Removing it changes the response body.

## Gaps in the test safety net

To keep a refactor behaviour-identical, an area needs tests. These have **no automated
tests**:

- `components/desktop/**` and `lib/macos.ts`
- `lib/media-probe.js`, `lib/image-resize.js` and `lib/blob-store.js` (integration only)
- `pages/api/snapshots/**`, `pages/api/nowplaying|toptracks|bookshelf` and `PhotoPost`
- `lib/mdx.js`
- the admin pages' `getServerSideProps`

Before touching any of these, write a characterization test (or for UI, take before and after
screenshots at both breakpoints in light and dark mode).

## Suggested order

1. **Zero-change batch, about 2 h, all S.** L2, L4, L5, L6, L8, L13, L14, L15, L16, L18, L19,
   L21, L26, L27, L28, L33, L34, and M3's zero-change step. Run `npm test`, lint and tsc after
   each one.
2. **M4 together with L1**, the Listening Timeline removal. This needs a yes on the route and
   scope removal.
3. **M1**, Cloudinary, following TODO.md and Kevin's production steps. Then L9, and L12 with
   the lease fencing.
4. **M2**, the carousel. This needs a decision on the dots and spinner.
5. The rest are optional, as and when.
