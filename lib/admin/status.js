import { getDbPool } from "../db.js";
import { describeError, redact } from "../redact.js";
import { readSpotifyStatusRow } from "../spotify-token.js";
import { missingScopes } from "../spotify-oauth.js";
import { lastRun, recentRuns, uploadsInLastDays, UPLOAD_CEILING_30D } from "../sync-runs.js";
import { checkPanelRunAllowed, PANEL_UPLOAD_CEILING_30D } from "./sync-limits.js";
import { recentAdminEvents, refusedSignInSummary } from "./audit-log.js";
import { OWNER_SPOTIFY_ACCOUNT_ID } from "./owner.js";

// GET /api/admin/status: what the /admin dashboard shows. pages/api/admin/status.js wires the real dependencies;
// the tests pass fakes. Nothing here selects or returns a token: the Spotify read is readSpotifyStatusRow, and the
// Instagram read names its columns.

// Vercel Blob's Hobby limits, shown next to the library and the 30-day uploads.
const BLOB_MONTHLY_UPLOAD_LIMIT = 2000;
const BLOB_STORAGE_LIMIT_BYTES = 1_000_000_000;
// The cron runs daily, so a day and a half without one means a missed run.
const CRON_OVERDUE_MS = 36 * 3_600_000;
// A 'running' row this old, with the run lease free, belongs to a run that was killed before it could finish its
// row (startRun's own rule, lib/sync-runs.js). Well past the routes' 300 s maxDuration.
const ABANDONED_AFTER_MS = 15 * 60_000;
const DAY_MS = 86_400_000;

const iso = (v) => (v == null ? null : new Date(v).toISOString());
// Floored whole days, not clamped: negative once the date has passed.
const daysLeft = (date, now) => Math.floor((new Date(date) - now) / DAY_MS);
const later = (a, b) => (a === null ? b : b === null ? a : new Date(Math.max(a, b)));
// dead_reason can hold text from a provider's error, so it leaves redacted; the stored value is untouched.
const deadReasonJson = (v) => (v == null ? null : redact(String(v)));

const INSTAGRAM_TOKEN_SQL = `select expires_at, refreshed_at, expires_at_is_assumed, dead_reason
  from integration_tokens where provider = 'instagram'`;
const LEASE_SQL = "select locked_until from job_locks where name = 'instagram-sync'";
const LIBRARY_SQL = `select (select count(*) from instagram_posts)::int as posts,
  (select count(*) from instagram_media)::int as files,
  (select coalesce(sum(asset_bytes), 0) from instagram_media)::bigint as bytes`;
const PANEL_SLOTS_SQL = `select name, locked_until from job_locks
  where name in ('instagram-panel-check', 'instagram-panel-import')`;

const rowsOf = async (db, sql) => (await db.query(sql)).rows;

function toRunJson(run, { now, leaseHeld }) {
  const abandoned = run.status === "running" && now - new Date(run.startedAt) > ABANDONED_AFTER_MS && !leaseHeld;
  return {
    id: Number(run.id),
    trigger: run.trigger ?? null,
    dryRun: run.dryRun ?? null,
    status: abandoned ? "abandoned" : run.status ?? null,
    startedAt: iso(run.startedAt),
    finishedAt: iso(run.finishedAt),
    fetched: run.fetched ?? null,
    imported: run.imported ?? null,
    uploads: run.uploads ?? null,
    deferred: run.deferred ?? null,
    skipped: run.skipped ?? null,
    errorCount: run.errorCount ?? null,
    error: run.error ?? null,
  };
}

function spotifyJson(row, now) {
  if (!row) {
    return {
      state: "missing",
      authorizedAt: null, expiresAt: null, daysLeft: null, accountMatches: null,
      scopes: null, missingScopes: null, deadReason: null,
    };
  }
  return {
    state: row.deadReason ? "dead" : "connected",
    authorizedAt: iso(row.authorizedAt),
    expiresAt: iso(row.expiresAt),
    daysLeft: row.expiresAt == null ? null : daysLeft(row.expiresAt, now),
    accountMatches: row.accountId == null ? null : row.accountId === OWNER_SPOTIFY_ACCOUNT_ID,
    scopes: row.scopes,
    missingScopes: missingScopes(row.scopes),
    deadReason: deadReasonJson(row.deadReason),
  };
}

function instagramTokenJson(row, now) {
  if (!row) return null;
  return {
    expiresAt: iso(row.expires_at),
    daysLeft: daysLeft(row.expires_at, now),
    refreshedAt: iso(row.refreshed_at),
    expiresAtIsAssumed: row.expires_at_is_assumed === true,
    deadReason: deadReasonJson(row.dead_reason),
  };
}

// When the panel's Check or Import is next allowed: the later of the limits' verdict (sync_runs) and a held slot
// claim (job_locks), which covers a claimed run that hasn't written its sync_runs row yet. null when neither applies.
function panelJson({ checkVerdict, importVerdict, slotRows, now }) {
  const heldUntil = (name) => {
    const row = slotRows.find((r) => r.name === name);
    return row && new Date(row.locked_until) > now ? new Date(row.locked_until) : null;
  };
  const verdictAt = (verdict) =>
    verdict.allowed ? null : new Date(now.getTime() + verdict.retryAfterSeconds * 1000);
  const importHeld = heldUntil("instagram-panel-import");
  let importBlockedReason = null;
  if (!importVerdict.allowed) importBlockedReason = importVerdict.reason;
  else if (importHeld !== null) importBlockedReason = "daily_limit";
  return {
    nextCheckAt: iso(later(verdictAt(checkVerdict), heldUntil("instagram-panel-check"))),
    nextImportAt: iso(later(verdictAt(importVerdict), importHeld)),
    importBlockedReason,
  };
}

/**
 * The dashboard's JSON. Every read runs at once and any failure rejects the whole status (never a guessed state,
 * such as "missing" because the Spotify read failed). Every value is JSON-safe.
 */
export async function buildAdminStatus({ db = getDbPool(), now = new Date() } = {}) {
  const [
    spotifyRow, instagramTokenRows, lastCron, leaseRows, [library], uploads30d,
    checkVerdict, importVerdict, slotRows, runs, events, refused,
  ] = await Promise.all([
    readSpotifyStatusRow(db),
    rowsOf(db, INSTAGRAM_TOKEN_SQL),
    lastRun({ trigger: "cron", dryRun: false }, db),
    rowsOf(db, LEASE_SQL),
    rowsOf(db, LIBRARY_SQL),
    uploadsInLastDays(30, db),
    checkPanelRunAllowed({ dryRun: true }, db),
    checkPanelRunAllowed({ dryRun: false }, db),
    rowsOf(db, PANEL_SLOTS_SQL),
    recentRuns({ limit: 20 }, db),
    recentAdminEvents(20, db),
    refusedSignInSummary(db),
  ]);

  const leaseRow = leaseRows[0];
  const leaseHeld = !!leaseRow && new Date(leaseRow.locked_until) > now;
  const runContext = { now, leaseHeld };

  return {
    generatedAt: iso(now),
    spotify: spotifyJson(spotifyRow, now),
    instagram: {
      token: instagramTokenJson(instagramTokenRows[0], now),
      lastCron: lastCron ? toRunJson(lastCron, runContext) : null,
      cronOverdue: !lastCron || now - new Date(lastCron.startedAt) > CRON_OVERDUE_MS,
      lease: { held: leaseHeld, lockedUntil: leaseHeld ? iso(leaseRow.locked_until) : null },
      library: { posts: Number(library.posts), files: Number(library.files), bytes: Number(library.bytes) },
      uploads30d: Number(uploads30d),
      limits: {
        panelCeiling: PANEL_UPLOAD_CEILING_30D,
        cronCeiling: UPLOAD_CEILING_30D,
        monthlyLimit: BLOB_MONTHLY_UPLOAD_LIMIT,
        storageLimitBytes: BLOB_STORAGE_LIMIT_BYTES,
      },
      panel: panelJson({ checkVerdict, importVerdict, slotRows, now }),
    },
    runs: runs.map((run) => toRunJson(run, runContext)),
    activity: events.map(({ id, at, event, actor, details }) => ({
      id: Number(id), at: iso(at), event, actor: actor ?? null, details: details ?? {},
    })),
    refusedSignIns: {
      count24h: Number(refused.count24h),
      latestAt: iso(refused.latestAt),
      latestLogin: refused.latestLogin ?? null,
    },
  };
}

/**
 * deps = { requireAdmin, buildAdminStatus }, both required; the route passes the real ones. A failure is logged as
 * one describeError line, never the Error object, its stack or pg's err.detail, and answered 500 status_failed.
 */
export function createStatusHandler({ requireAdmin, buildAdminStatus }) {
  async function handle(req, res) {
    // Not a mutation, so no options (and no 403): requireAdmin answers 404, 401 or 500 itself and returns null.
    const owner = await requireAdmin(req, res);
    if (!owner) return;

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      res.status(405).json({ error: "method_not_allowed" });
      return;
    }

    let status;
    try {
      status = await buildAdminStatus();
    } catch (error) {
      console.error("[admin/status] status read failed:", describeError(error));
      res.status(500).json({ error: "status_failed" });
      return;
    }
    res.status(200).json(status);
  }

  return async function adminStatusHandler(req, res) {
    try {
      await handle(req, res);
    } catch (error) {
      // A rejection the steps above don't answer (requireAdmin itself, say): never the raw Error.
      console.error("[admin/status] request failed:", describeError(error));
      if (!res.headersSent) res.status(500).json({ error: "status_failed" });
    }
  };
}
