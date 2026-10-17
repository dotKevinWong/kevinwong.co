import { getDbPool } from "./db.js";
import { capJson, redact } from "./redact.js";

// One sync_runs row per sync run (sql/006_sync_runs.sql), written by
// lib/instagram-sync.js and read by /admin. Every function takes the pool last
// so the integration tests can pass their own; callers in lib/ never do.

/**
 * Real (non-dry) runs stop once this many uploads have landed in the last 30
 * days. Vercel Blob's Hobby plan stops the store outright at 2,000 uploads a
 * month, which would blank every image on /snapshots, so this leaves 200 spare
 * for hand-run backfills and the ceiling's own overshoot (see syncInstagram).
 */
export const UPLOAD_CEILING_30D = 1800;

const RUN_COLUMNS = `id, trigger, dry_run, status, started_at, finished_at, fetched, imported, uploads,
       deferred, skipped, error_count, error`;

/** The row's status for a run that returned a summary rather than throwing. */
export function statusFromSummary(summary) {
  if (summary?.leaseHeld || summary?.ceilingReached || summary?.notRecorded) return "skipped";
  if (summary?.errors?.length > 0) return "partial";
  return "ok";
}

/** How many uploads this run may make: maxUploads, or whatever is left under the ceiling if that is less. */
export function uploadAllowance(maxUploads, usedLast30Days) {
  return Math.max(0, Math.min(maxUploads, UPLOAD_CEILING_30D - usedLast30Days));
}

function toRun(row) {
  return {
    id: Number(row.id),
    trigger: row.trigger,
    dryRun: row.dry_run,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    fetched: row.fetched,
    imported: row.imported,
    uploads: row.uploads,
    deferred: row.deferred,
    skipped: row.skipped,
    errorCount: row.error_count,
    error: row.error,
  };
}

/**
 * Insert a 'running' row for a new run and return its id.
 *
 * First marks abandoned any running row of this job that is older than 15
 * minutes while the lease has expired (or was never taken): its process died
 * before it could finish the row. A run that is merely slow keeps renewing the
 * lease, so it is left alone.
 */
export async function startRun({ job, trigger, dryRun }, db = getDbPool()) {
  // Only the instagram job exists in v1, and its lease is 'instagram-sync'
  // (LOCK_NAME in lib/instagram-sync.js).
  await db.query(
    `update sync_runs
        set status = 'abandoned', finished_at = now()
      where job = $1
        and status = 'running'
        and started_at < now() - interval '15 minutes'
        and not exists (select 1 from job_locks
                         where name = 'instagram-sync' and locked_until >= now())`,
    [job]
  );
  const { rows } = await db.query(
    `insert into sync_runs (job, trigger, dry_run, status, started_at)
     values ($1, $2, $3, 'running', now())
     returning id`,
    [job, trigger, dryRun]
  );
  return Number(rows[0].id);
}

/**
 * Add n uploads to a run's row. syncInstagram awaits it after every successful
 * upload, so a run that is killed partway (Ctrl-C, OOM, maxDuration) has
 * already counted what it spent.
 */
export async function incrementRunUploads(id, n = 1, db = getDbPool()) {
  await db.query(`update sync_runs set uploads = uploads + $2 where id = $1`, [id, n]);
}

/**
 * Record a run's outcome. Unconditional on the current status, so a run the
 * sweep marked abandoned still records its real outcome. uploads never goes
 * below what incrementRunUploads recorded. The stored summary and error are
 * redacted and the summary size-capped; the caller's summary is not changed.
 */
export async function finishRun(id, { status, summary, error }, db = getDbPool()) {
  const s = summary;
  await db.query(
    `update sync_runs
        set status = $2, finished_at = now(),
            fetched = $3, imported = $4, uploads = greatest(uploads, $5), deferred = $6, skipped = $7,
            error_count = $8, summary = $9::jsonb, error = $10
      where id = $1`,
    [
      id,
      status,
      s?.fetched ?? 0,
      s?.inserted?.length ?? 0,
      s?.uploads ?? 0,
      s?.deferred ?? 0,
      s?.skipped?.length ?? 0,
      s?.errors?.length ?? 0,
      s == null ? null : JSON.stringify(capJson(redact(s))),
      error == null ? null : redact(String(error)),
    ]
  );
}

/** Real uploads over the last `days` days, across every job: they all spend the same Blob allowance. */
export async function uploadsInLastDays(days, db = getDbPool()) {
  const { rows } = await db.query(
    `select coalesce(sum(uploads), 0)::integer as total
       from sync_runs
      where dry_run = false
        and started_at >= now() - make_interval(days => $1::integer)`,
    [days]
  );
  return Number(rows[0].total);
}

/** The job's most recent runs, newest first, without their summaries. */
export async function recentRuns({ job = "instagram", limit = 20 } = {}, db = getDbPool()) {
  const { rows } = await db.query(
    `select ${RUN_COLUMNS}
       from sync_runs
      where job = $1
      order by started_at desc, id desc
      limit $2`,
    [job, limit]
  );
  return rows.map(toRun);
}

/** The job's most recent run, optionally only those from one trigger or of one kind (dry or real), or null. */
export async function lastRun({ job = "instagram", trigger, dryRun } = {}, db = getDbPool()) {
  const { rows } = await db.query(
    `select ${RUN_COLUMNS}
       from sync_runs
      where job = $1
        and ($2::text is null or trigger = $2)
        and ($3::boolean is null or dry_run = $3)
      order by started_at desc, id desc
      limit 1`,
    [job, trigger ?? null, dryRun ?? null]
  );
  return rows.length === 0 ? null : toRun(rows[0]);
}
