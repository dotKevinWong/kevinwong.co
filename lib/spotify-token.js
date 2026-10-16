import { getDbPool } from "./db.js";

// The database side of the Spotify credential: the integration_tokens row for
// provider 'spotify' (columns from sql/005).
//
// Spotify's long-lived secret is the refresh token; its access tokens last an
// hour and are only cached in memory. So the refresh token lives in its own
// refresh_token column, the spotify row leaves access_token null, and every
// statement here is scoped to provider = 'spotify'. The instagram row, which
// keeps its token in access_token, is never read or written.
//
// Two serverless instances can refresh at the same time, so every token write
// is a compare-and-swap on the token value itself, never on updated_at: a JS
// Date keeps only milliseconds and Postgres stores microseconds, so a
// timestamp read back into JS and compared would almost never match.
//
// Every function takes an optional db (anything with pg's query()) as its last
// argument. The default, getDbPool(), is evaluated at call time, so a missing
// DATABASE_URL rejects the returned promise instead of throwing at import.
//
// No token value is ever put into a log line or an error message.

export const SPOTIFY_PROVIDER = "spotify";

export const SPOTIFY_SCOPES = Object.freeze([
  "user-read-currently-playing",
  "user-top-read",
  "user-read-recently-played",
]);

// Spotify ends an authorization this long after the owner approves it, and
// refreshing does not extend it. The figure is an estimate, which is why the
// row is saved with expires_at_is_assumed = true.
export const AUTHORIZATION_LIFETIME_DAYS = 180;

function splitScopes(text) {
  return text ? text.split(" ").filter(Boolean) : [];
}

export async function readSpotifyRow(db = getDbPool()) {
  const { rows } = await db.query(
    `select refresh_token, dead_reason, authorized_at, expires_at, account_id, scopes
       from integration_tokens
      where provider = $1`,
    [SPOTIFY_PROVIDER]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    refreshToken: row.refresh_token,
    deadReason: row.dead_reason,
    authorizedAt: row.authorized_at,
    expiresAt: row.expires_at,
    accountId: row.account_id,
    scopes: splitScopes(row.scopes),
  };
}

// A new authorization (the owner clicked Approve): replaces whatever the row
// held, including a dead token, and restarts the 180-day estimate. The
// lifetime is counted in 24-hour steps rather than '1 day' intervals, because
// a day interval follows the session TimeZone and would drift by an hour when
// a DST change falls inside the window.
export async function saveSpotifyAuthorization({ refreshToken, accountId, scopes }, db = getDbPool()) {
  if (!refreshToken || !accountId) {
    throw new Error("saveSpotifyAuthorization needs a refreshToken and an accountId");
  }
  const { rows } = await db.query(
    `insert into integration_tokens
       (provider, access_token, refresh_token, account_id, scopes, authorized_at,
        expires_at, expires_at_is_assumed, dead_reason, refreshed_at, updated_at)
     values
       ($1, null, $2, $3, $4, now(),
        now() + $5::int * interval '24 hours', true, null, now(), now())
     on conflict (provider) do update
       set access_token          = null,
           refresh_token         = excluded.refresh_token,
           account_id            = excluded.account_id,
           scopes                = excluded.scopes,
           authorized_at         = excluded.authorized_at,
           expires_at            = excluded.expires_at,
           expires_at_is_assumed = true,
           dead_reason           = null,
           refreshed_at          = excluded.refreshed_at,
           updated_at            = excluded.updated_at
     returning authorized_at, expires_at`,
    [SPOTIFY_PROVIDER, refreshToken, accountId, scopes.join(" "), AUTHORIZATION_LIFETIME_DAYS]
  );
  return { authorizedAt: rows[0].authorized_at, expiresAt: rows[0].expires_at };
}

// Spotify accepted `previous` and issued `next`. Swaps only while the row
// still holds `previous`; returns false when another instance (or a
// reconnect) has already replaced it.
//
// authorized_at and expires_at stay: refreshing never extends Spotify's six
// months. There is no dead_reason guard: Spotify has just accepted `previous`
// and issued `next`, so `next` is live even if another instance marked
// `previous` dead in the meantime, and clearing dead_reason keeps the only
// live token.
export async function storeRotatedRefreshToken(previous, next, db = getDbPool()) {
  // With no token there is nothing to compare, so never write blind.
  if (!previous || !next) return false;
  const { rowCount } = await db.query(
    `update integration_tokens
        set refresh_token = $3, dead_reason = null, refreshed_at = now(), updated_at = now()
      where provider = $1 and refresh_token = $2`,
    [SPOTIFY_PROVIDER, previous, next]
  );
  return rowCount === 1;
}

// Latches dead_reason only while the row still holds the token that failed
// and is not already dead, so a reconnect's newer token is never marked dead
// by a refresh that failed with the old one. Returns true when this call
// latched it.
export async function markSpotifyDead(reason, failedRefreshToken, db = getDbPool()) {
  // With no token there is nothing to compare, so never latch blind.
  if (!failedRefreshToken) return false;
  const { rowCount } = await db.query(
    `update integration_tokens
        set dead_reason = $3, updated_at = now()
      where provider = $1 and refresh_token = $2 and dead_reason is null`,
    [SPOTIFY_PROVIDER, failedRefreshToken, reason]
  );
  return rowCount === 1;
}

// For the admin status card: everything about the authorization except the
// token, which this query never selects.
export async function readSpotifyStatusRow(db = getDbPool()) {
  const { rows } = await db.query(
    `select dead_reason, authorized_at, expires_at, account_id, scopes, updated_at
       from integration_tokens
      where provider = $1`,
    [SPOTIFY_PROVIDER]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    deadReason: row.dead_reason,
    authorizedAt: row.authorized_at,
    expiresAt: row.expires_at,
    accountId: row.account_id,
    scopes: splitScopes(row.scopes),
    updatedAt: row.updated_at,
  };
}
