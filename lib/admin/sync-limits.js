import { getDbPool } from "../db.js";
import { uploadsInLastDays } from "../sync-runs.js";

// The panel's own run limits (D4), on top of the 1,800 ceiling every real run obeys (lib/sync-runs.js). They read
// sync_runs, which records every run whatever its trigger, so a run the panel started and the function then lost
// still counts. Every time is worked out in SQL against now(), so the database is the only clock. Every function
// takes the pool last, so the integration tests and lib/admin/status.js can pass their own.

export const CHECK_MIN_GAP_MINUTES = 10;
export const IMPORT_WINDOW_HOURS = 24;
export const PANEL_UPLOAD_CEILING_30D = 1000;

const CHECK_GAP = `${CHECK_MIN_GAP_MINUTES} minutes`;
const IMPORT_WINDOW = `${IMPORT_WINDOW_HOURS} hours`;
const CHECK_SLOT = "instagram-panel-check";
const IMPORT_SLOT = "instagram-panel-import";
// The ceiling's retry when the oldest counted row can't be found (it left the window between the two reads).
const CEILING_RETRY_FALLBACK_SECONDS = 3600;

const toRetryAfter = (waitSeconds) => Math.max(1, Math.ceil(waitSeconds));

// The wait_seconds the query returns, or null when it has none (no row, or max()/min() over no rows).
async function waitSeconds(db, sql, params) {
  const { rows } = await db.query(sql, params);
  return rows[0]?.wait_seconds ?? null;
}

// Any panel check started in the last 10 minutes, whatever its outcome: a failed check still counts.
const CHECK_WAIT_SQL = `select extract(epoch from max(started_at) + $1::interval - now())::float8 as wait_seconds
  from sync_runs
 where job = 'instagram' and trigger = 'panel' and dry_run
   and started_at > now() - $1::interval`;

// Panel imports of the last 24 hours that used up the day. abandoned counts: a run killed by maxDuration never
// finishes its row, and the next startRun marks it abandoned, which must not free the day. A finished run, ok or
// partial, counts even with 0 uploads. A skipped, failed or reauth_required run counts only once it has uploaded
// something.
const IMPORT_WAIT_SQL = `select extract(epoch from max(started_at) + $1::interval - now())::float8 as wait_seconds
  from sync_runs
 where job = 'instagram' and trigger = 'panel' and not dry_run
   and started_at > now() - $1::interval
   and (status = any(array['running','ok','partial','abandoned']) or uploads > 0)`;

// When the oldest real upload of the last 30 days leaves the window: the earliest the ceiling's answer can change,
// so a lower bound, because the cron keeps adding uploads.
const CEILING_WAIT_SQL = `select extract(epoch from min(started_at) + interval '30 days' - now())::float8 as wait_seconds
  from sync_runs
 where not dry_run and uploads > 0 and started_at > now() - interval '30 days'`;

/**
 * Whether sync_runs lets the panel start a check ({ dryRun: true }) or an import ({ dryRun: false }) now. An import
 * is checked against the daily limit first, then the panel's 1,000-upload ceiling. Read-only, so it is
 * check-then-act: the route also claims the slot with claimPanelSlot. Anything but dryRun === true gets the
 * import's limits, the stricter pair.
 */
export async function checkPanelRunAllowed({ dryRun }, db = getDbPool()) {
  if (dryRun === true) {
    const wait = await waitSeconds(db, CHECK_WAIT_SQL, [CHECK_GAP]);
    if (wait !== null) return { allowed: false, reason: "too_soon", retryAfterSeconds: toRetryAfter(wait) };
    return { allowed: true };
  }

  const wait = await waitSeconds(db, IMPORT_WAIT_SQL, [IMPORT_WINDOW]);
  if (wait !== null) return { allowed: false, reason: "daily_limit", retryAfterSeconds: toRetryAfter(wait) };

  if ((await uploadsInLastDays(30, db)) >= PANEL_UPLOAD_CEILING_30D) {
    const ceilingWait = await waitSeconds(db, CEILING_WAIT_SQL, []);
    return {
      allowed: false,
      reason: "upload_ceiling",
      retryAfterSeconds: ceilingWait === null ? CEILING_RETRY_FALLBACK_SECONDS : toRetryAfter(ceilingWait),
    };
  }
  return { allowed: true };
}

/**
 * Claims the check's 10-minute slot or the import's 24-hour slot in job_locks before the run starts, because the
 * sync_runs row checkPanelRunAllowed reads is only written once syncInstagram is under way. The run lease's
 * pattern (lib/instagram-sync.js): each statement commits on its own, so it is safe through the transaction-mode
 * pooler. Two concurrent claims queue on the row lock, and under READ COMMITTED the second update re-checks
 * locked_until < now() against the first one's new value, so exactly one of them gets a row back.
 */
export async function claimPanelSlot({ dryRun }, db = getDbPool()) {
  const [name, interval] = dryRun === true ? [CHECK_SLOT, CHECK_GAP] : [IMPORT_SLOT, IMPORT_WINDOW];
  await db.query("insert into job_locks (name) values ($1) on conflict (name) do nothing", [name]);
  const { rows } = await db.query(
    `update job_locks set locked_until = now() + $2::interval
      where name = $1 and locked_until < now()
     returning locked_until`,
    [name, interval]
  );
  if (rows.length === 1) return { claimed: true };
  const wait = await waitSeconds(
    db,
    "select extract(epoch from locked_until - now())::float8 as wait_seconds from job_locks where name = $1",
    [name]
  );
  return { claimed: false, retryAfterSeconds: toRetryAfter(wait ?? 0) };
}

/**
 * Frees the import slot, for an import that used up nothing. Nothing frees the check slot: a failed check still
 * counts, as it does in sync_runs.
 */
export async function releasePanelImportSlot(db = getDbPool()) {
  await db.query("update job_locks set locked_until = 'epoch' where name = 'instagram-panel-import'");
}
