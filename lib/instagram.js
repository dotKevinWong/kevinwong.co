import { getDbPool } from "./db.js";

// "Instagram API with Instagram Login". The Basic Display API this replaced
// reached end-of-life on 2024-12-04 and now errors on every request.
//
// Endpoints are unversioned where Meta's own reference leaves them unversioned
// (the token endpoints) and pinned where it pins them (the media node). Meta's
// Instagram docs render examples at v25.0 even though the Graph API changelog
// has moved to v26.0 — the Instagram surface simply has not been re-versioned,
// so v25.0 is the version Meta actually documents for these calls.
const GRAPH_HOST = "https://graph.instagram.com";
const API_VERSION = "v25.0";

export const PROVIDER = "instagram";

// Meta's IG Media reference badges caption "Available for Instagram API with
// Facebook Login only", but an Instagram Login token with
// instagram_business_basic reads it fine (verified 2026-09-26 with
// `npm run instagram:sync -- --probe-caption`). If Meta ever enforces the badge,
// requesting it would fail the whole call with error code 100 rather than just
// omitting the field — the probe is the way to re-check.
const MEDIA_FIELDS = [
  "id",
  "caption",
  "media_type",
  "media_url",
  "permalink",
  "thumbnail_url",
  "timestamp",
  "username",
  // Carousel slides. Children cannot return caption or permalink, but do carry
  // their own media_type/media_url/timestamp.
  "children{id,media_type,media_url,thumbnail_url,timestamp}",
].join(",");

// Refresh this far ahead of expiry. Instagram allows a refresh any time the
// token is >=24h old and unexpired, and a refresh resets the full 60 days — so
// the only real risk is *missing* the window. Vercel documents cron delivery as
// best effort ("occasional transient network errors can prevent a request from
// reaching"), so a single missed day must not matter. Thirty days of margin
// means ~30 consecutive failed invocations before the token is unrecoverable.
const REFRESH_WHEN_EXPIRING_WITHIN_MS = 30 * 24 * 60 * 60 * 1000;

// Meta requires the token to be at least 24 hours old before it can be
// refreshed, and publishes no error for violating that floor. Stay clear of it.
const MIN_REFRESH_INTERVAL_MS = 25 * 60 * 60 * 1000;

export class InstagramReauthRequiredError extends Error {
  constructor(message = "Instagram token is expired or revoked") {
    super(message);
    this.name = "InstagramReauthRequiredError";
  }
}

/**
 * True when Meta is telling us the token is permanently unusable.
 *
 * Match on error.code, not error.type: the type string is not stable across
 * Instagram's endpoints ("OAuthException" on the Graph host, "IGApiException"
 * elsewhere), but code 190 is the documented OAuth error for every expired,
 * revoked, invalidated or password-changed token.
 */
function isDeadTokenError(body) {
  return Number(body?.error?.code) === 190;
}

function describeError(body, status) {
  const e = body?.error;
  if (!e) return `HTTP ${status}`;
  const subcode = e.error_subcode ? ` subcode=${e.error_subcode}` : "";
  return `HTTP ${status} code=${e.code}${subcode} type=${e.type}: ${e.message}`;
}

export async function loadToken() {
  const pool = getDbPool();
  const { rows } = await pool.query(
    `select access_token, expires_at, refreshed_at, dead_reason, expires_at_is_assumed
       from integration_tokens where provider = $1`,
    [PROVIDER]
  );

  if (rows.length === 0) {
    throw new InstagramReauthRequiredError(
      "No Instagram token stored. Run `npm run instagram:token -- <token>` to seed one."
    );
  }

  const row = rows[0];
  if (row.dead_reason) {
    throw new InstagramReauthRequiredError(
      `Instagram token was marked dead: ${row.dead_reason}`
    );
  }

  return {
    accessToken: row.access_token,
    expiresAt: new Date(row.expires_at),
    refreshedAt: new Date(row.refreshed_at),
    expiresAtIsAssumed: row.expires_at_is_assumed === true,
  };
}

/**
 * Latch the token as permanently unusable.
 *
 * Deliberately asymmetric: if the token really is dead, waiting until tomorrow
 * costs nothing because it stays dead. But a false positive costs a manual trip
 * to the Meta dashboard and an outage that lasts until someone notices. So this
 * re-checks with a second, minimal request before writing the irreversible flag,
 * and declines to latch if that request succeeds.
 */
async function markTokenDead(reason, accessToken) {
  if (accessToken) {
    try {
      const check = await fetch(
        `${GRAPH_HOST}/${API_VERSION}/me?fields=id&access_token=${encodeURIComponent(accessToken)}`
      );
      if (check.ok) {
        console.warn(
          `[instagram] Saw a token error (${reason}) but the token still works — ` +
            "treating it as transient and leaving it active."
        );
        return false;
      }
      const checkBody = await check.json().catch(() => ({}));
      if (!isDeadTokenError(checkBody)) {
        console.warn(
          `[instagram] Saw a token error (${reason}) but the confirmation check ` +
            "did not report code 190 — treating it as transient."
        );
        return false;
      }
    } catch {
      // Network failure during confirmation proves nothing. Do not latch.
      console.warn(
        `[instagram] Saw a token error (${reason}) but could not confirm it — ` +
          "leaving the token active and retrying next run."
      );
      return false;
    }
  }

  const pool = getDbPool();
  await pool.query(
    `update integration_tokens
        set dead_reason = $2, updated_at = now()
      where provider = $1`,
    [PROVIDER, reason]
  );
  console.error(
    `[instagram] Token is permanently dead (${reason}). Generate a new one in ` +
      "the Meta App Dashboard (Instagram > API setup with Instagram business " +
      "login > Generate token) and run `npm run instagram:token`."
  );
  return true;
}

export async function storeToken({ accessToken, expiresInSeconds, expiryIsAssumed = false }) {
  const pool = getDbPool();
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

  await pool.query(
    `insert into integration_tokens
       (provider, access_token, expires_at, refreshed_at, dead_reason, expires_at_is_assumed)
     values ($1, $2, $3, now(), null, $4)
     on conflict (provider) do update
       set access_token          = excluded.access_token,
           expires_at            = excluded.expires_at,
           refreshed_at          = now(),
           dead_reason           = null,
           expires_at_is_assumed = excluded.expires_at_is_assumed,
           updated_at            = now()`,
    [PROVIDER, accessToken, expiresAt, expiryIsAssumed]
  );

  return expiresAt;
}

/**
 * Refresh the long-lived token if it is drifting toward expiry.
 *
 * Returns the token to use for this run. Refreshing is idempotent-ish and cheap,
 * but pointless every single day, so it only fires inside the margin window.
 */
export async function ensureFreshToken() {
  const token = await loadToken();

  const msUntilExpiry = token.expiresAt.getTime() - Date.now();
  const msSinceRefresh = Date.now() - token.refreshedAt.getTime();

  // Meta refuses to refresh a token less than 24h old, and documents no error
  // for trying, so never go near that floor.
  if (msSinceRefresh < MIN_REFRESH_INTERVAL_MS) return token.accessToken;

  // A dashboard-generated token carries no expires_in, so seeding could only
  // assume the documented 60 days. Force one refresh as soon as it is old enough
  // to be refreshable, which replaces the guess with Meta's real value. Waiting
  // for the normal window would mean trusting the guess for 30 days — and if the
  // token actually had less life than assumed, it would be dead by then.
  if (!token.expiresAtIsAssumed && msUntilExpiry > REFRESH_WHEN_EXPIRING_WITHIN_MS) {
    return token.accessToken;
  }

  const url =
    `${GRAPH_HOST}/refresh_access_token` +
    `?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token.accessToken)}`;

  const response = await fetch(url);
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (isDeadTokenError(body)) {
      const latched = await markTokenDead(describeError(body, response.status), token.accessToken);
      if (latched) throw new InstagramReauthRequiredError();
      return token.accessToken;
    }
    // A transient failure (5xx, network blip) is survivable: the existing token
    // is still valid for weeks, so use it and try the refresh again tomorrow.
    console.warn(
      `[instagram] Token refresh failed, continuing with existing token. ${describeError(body, response.status)}`
    );
    return token.accessToken;
  }

  if (!body.access_token || !body.expires_in) {
    console.warn("[instagram] Refresh returned no token; continuing with existing one.");
    return token.accessToken;
  }

  // Always derive expiry from the returned integer. Meta's docs warn the 60-day
  // lifetime is not a contract, and their own samples disagree (5184000 vs
  // 5183944 seconds).
  const expiresAt = await storeToken({
    accessToken: body.access_token,
    expiresInSeconds: Number(body.expires_in),
    expiryIsAssumed: false,
  });
  console.log(`[instagram] Token refreshed; now expires ${expiresAt.toISOString()}`);

  return body.access_token;
}

async function graphGet(url, accessToken) {
  const separator = url.includes("?") ? "&" : "?";
  const response = await fetch(
    `${url}${separator}access_token=${encodeURIComponent(accessToken)}`
  );
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (isDeadTokenError(body)) {
      // Confirm before latching. This path can fire mid-pagination, where an
      // earlier page has already succeeded with the very same token — strong
      // evidence that a 190 here is transient rather than terminal.
      const latched = await markTokenDead(describeError(body, response.status), accessToken);
      if (latched) throw new InstagramReauthRequiredError();
    }
    throw new Error(`[instagram] ${describeError(body, response.status)}`);
  }

  return body;
}

/**
 * Fetch the most recent media, newest first.
 *
 * Deliberately does NOT persist a pagination cursor between runs. Meta is
 * explicit that cursors "can quickly become invalid if items are added or
 * deleted" — and a daily sync exists precisely because items get added, so a
 * stored cursor is invalidated by the very event it is meant to track. Instead
 * we re-read a bounded window of recent posts every run and let the unique
 * source_key decide what is actually new.
 */
export async function fetchRecentMedia({ accessToken, maxPosts = 50 }) {
  const collected = [];
  let url =
    `${GRAPH_HOST}/${API_VERSION}/me/media` +
    `?fields=${encodeURIComponent(MEDIA_FIELDS)}&limit=25`;

  while (url && collected.length < maxPosts) {
    const page = await graphGet(url, accessToken);
    const items = Array.isArray(page.data) ? page.data : [];
    collected.push(...items);

    // Meta warns not to infer "last page" from a short result set — only the
    // absence of paging.next is authoritative.
    const next = page.paging?.next;
    if (!next || items.length === 0) break;
    // paging.next already carries its own access_token; strip it so graphGet
    // appends the current one rather than a stale copy.
    url = next.replace(/([?&])access_token=[^&]*/, "$1").replace(/[?&]$/, "");
  }

  return collected.slice(0, maxPosts);
}

/**
 * One-off probe for whether caption is readable on this token.
 *
 * Meta badges caption as Facebook-Login-only, which would mean it never comes
 * back under Instagram Login. That is worth re-testing occasionally rather than
 * trusting forever, but it must never break a real sync — so it runs as its own
 * request and swallows the expected failure.
 */
export async function probeCaptionSupport(accessToken) {
  try {
    const body = await graphGet(
      `${GRAPH_HOST}/${API_VERSION}/me/media?fields=id,caption&limit=1`,
      accessToken
    );
    const first = body?.data?.[0];
    return { supported: true, sample: first?.caption ?? null };
  } catch (error) {
    if (error instanceof InstagramReauthRequiredError) throw error;
    return { supported: false, reason: error.message };
  }
}

/** `https://www.instagram.com/p/DS3aHQajYlN/` -> `DS3aHQajYlN` */
export function shortcodeFromPermalink(permalink) {
  if (typeof permalink !== "string") return null;
  const match = permalink.match(/instagram\.com\/(?:p|reel|tv)\/([^/?#]+)/i);
  return match ? match[1] : null;
}

/**
 * The idempotency key for a post.
 *
 * Derived from the permalink rather than the API's media id because the 21 rows
 * already in the table came from a data-export ZIP, which has no media ids —
 * but does have permalinks. The shortcode is the only identifier both sources
 * can produce, so it is what keeps the export-era rows and API-era rows from
 * duplicating each other.
 */
export function sourceKeyForShortcode(shortcode) {
  return `ig:${shortcode}`;
}
