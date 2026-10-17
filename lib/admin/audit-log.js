import { getDbPool } from "../db.js";
import { redact } from "../redact.js";
import { OWNER_GITHUB_ID } from "./owner.js";

// admin_audit_log (sql/006_sync_runs.sql): sign-ins, refused sign-ins, Spotify
// reconnects and panel runs, read by /admin. details always pass through
// redact(), so no token reaches the table. Every function takes the pool last
// so the integration tests can pass their own; callers in lib/ never do.

export const ADMIN_EVENTS = Object.freeze([
  "sign_in",
  "sign_in_rejected",
  "spotify_connected",
  "spotify_connect_failed",
  "instagram_check",
  "instagram_import",
  "panel_run_refused",
]);

/** The actor for every event the owner causes. Never a Better Auth user id. */
export const OWNER_ACTOR = `github:${OWNER_GITHUB_ID}`;

export async function logAdminEvent(event, { actor = null, details = {} } = {}, db = getDbPool()) {
  if (!ADMIN_EVENTS.includes(event)) {
    throw new TypeError(`Unknown admin event: ${event}`);
  }
  await db.query(
    "insert into admin_audit_log (event, actor, details) values ($1, $2, $3::jsonb)",
    [event, actor, JSON.stringify(redact(details))]
  );
}

/**
 * Records a refused sign-in. Any GitHub account can cause one, so this writes
 * at most one row per GitHub id an hour and at most five rows an hour in all.
 * Returns true when a row was written.
 */
export async function logRejectedSignIn({ githubId, login }, db = getDbPool()) {
  const id = String(githubId);
  // Best-effort under concurrency: simultaneous refusals can each pass both checks, which is accepted
  // because every attempt costs a full GitHub OAuth round trip.
  const { rowCount } = await db.query(
    `insert into admin_audit_log (event, actor, details)
     select 'sign_in_rejected', $1::text, $2::jsonb
     where not exists (
       select 1 from admin_audit_log
       where event = 'sign_in_rejected' and actor = $1::text and at > now() - interval '1 hour'
     )
     and (
       select count(*) from admin_audit_log
       where event = 'sign_in_rejected' and at > now() - interval '1 hour'
     ) < 5`,
    [`github:${id}`, JSON.stringify(redact({ githubId: id, login: login ?? null }))]
  );
  return rowCount === 1;
}

/**
 * The newest events, newest first, leaving out refused sign-ins so strangers
 * can never push real events off the list (refusedSignInSummary covers them).
 */
export async function recentAdminEvents(limit = 20, db = getDbPool()) {
  const { rows } = await db.query(
    `select id, at, event, actor, details from admin_audit_log
     where event <> 'sign_in_rejected'
     order by at desc, id desc limit $1`,
    [limit]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    at: row.at,
    event: row.event,
    actor: row.actor,
    details: row.details,
  }));
}

/** The refused sign-ins of the last 24 hours: how many, and the time and login of the newest. */
export async function refusedSignInSummary(db = getDbPool()) {
  const { rows } = await db.query(
    `select count(*)::int as count24h, max(at) as latest_at,
            (array_agg(details->>'login' order by at desc, id desc))[1] as latest_login
     from admin_audit_log
     where event = 'sign_in_rejected' and at > now() - interval '24 hours'`
  );
  const [row] = rows;
  return { count24h: row.count24h, latestAt: row.latest_at, latestLogin: row.latest_login };
}
