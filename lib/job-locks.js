// The job_locks rows (sql/004_job_locks.sql) and the one way they are claimed. No imports: the caller passes its pool.
//
// lib/admin/status.js reads these rows too, and builds its SQL from these constants.

/** The run lease: one uploading Instagram sync at a time (lib/instagram-sync.js). The sweep in lib/sync-runs.js reads it. */
export const SYNC_LEASE = "instagram-sync";
/** The panel's 10-minute slot for a check (dry run), claimed by lib/admin/sync-limits.js. */
export const PANEL_CHECK_SLOT = "instagram-panel-check";
/** The panel's 24-hour slot for an import, claimed by lib/admin/sync-limits.js. */
export const PANEL_IMPORT_SLOT = "instagram-panel-import";

/**
 * Claims the named row for `interval` (a Postgres interval string such as '10 minutes') if it is free, and returns
 * its new locked_until as text, or null when another holder has it.
 *
 * Each statement commits on its own, so it is safe through the transaction-mode pooler. Two concurrent claims queue on
 * the row lock, and under READ COMMITTED the second update re-checks locked_until < now() against the first one's new
 * value, so exactly one of them gets a row back.
 *
 * The text keeps Postgres's microseconds (a JS Date would drop them), so it can be compared back with
 * `locked_until = $n::timestamptz` to prove the row is still this holder's: lib/instagram-sync.js fences its lease
 * renewals and release that way.
 */
export async function claimLock(db, name, interval) {
  await db.query(`insert into job_locks (name) values ($1) on conflict (name) do nothing`, [name]);
  const { rows } = await db.query(
    `update job_locks set locked_until = now() + $2::interval
      where name = $1 and locked_until < now()
      returning locked_until::text`,
    [name, interval]
  );
  return rows.length === 1 ? rows[0].locked_until : null;
}
