import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  SPOTIFY_ADMIN_REDIRECT_URI,
  buildAuthorizeUrl,
  exchangeCode as realExchangeCode,
  fetchSpotifyAccountId as realFetchSpotifyAccountId,
  missingScopes,
  spotifyCredentials,
} from "../spotify-oauth.js";
import { saveSpotifyAuthorization as realSaveSpotifyAuthorization } from "../spotify-token.js";
import { resetSpotifyTokenCache as realResetSpotifyTokenCache } from "../spotify.js";
import { describeError } from "../redact.js";
import { OWNER_SPOTIFY_ACCOUNT_ID } from "./owner.js";
import { OWNER_ACTOR, logAdminEvent as realLogAdminEvent } from "./audit-log.js";
import { getOwnerSession, isAdminEnabled, isSameOrigin, setNoStore } from "./guard.js";

// The panel's Spotify reconnect. pages/api/admin/spotify/authorize.js (a POST from the panel's Reconnect form)
// sets a state cookie and sends the browser to Spotify's approve page; pages/api/admin/spotify/callback.js (the
// GET Spotify redirects back to) clears it, checks it, exchanges the code, checks the account and the scopes,
// saves the refresh token and sends the browser back to /admin. Both route files only call into this module.
//
// Both are top-level navigations, so they never answer 401: without an owner session they 303 to
// /admin/sign-in, and every reconnect outcome is a 303 to /admin with ?spotify=connected or
// ?spotify_error=<code>. No code, access token or refresh token is ever logged or put in an audit row.

export const STATE_COOKIE_NAME = "__Host-kw_spotify_state";
export const CLEAR_STATE_COOKIE = `${STATE_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

export function stateCookie(state) {
  return `${STATE_COOKIE_NAME}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`;
}

/** 32 random bytes as base64url: 43 characters. */
export function newState() {
  return randomBytes(32).toString("base64url");
}

/** The state cookie's value, or null when it is absent or empty. Matches the cookie name exactly. */
export function readStateCookie(cookieHeader) {
  if (typeof cookieHeader !== "string") return null;
  for (const part of cookieHeader.split(";")) {
    const pair = part.trim();
    const eq = pair.indexOf("=");
    if (eq === -1 || pair.slice(0, eq) !== STATE_COOKIE_NAME) continue;
    return pair.slice(eq + 1) || null;
  }
  return null;
}

const isNonEmptyString = (value) => typeof value === "string" && value !== "";
const sha256 = (value) => createHash("sha256").update(value).digest();

/** Constant time on the SHA-256 digests, so neither the length nor the content leaks through timing. */
export function statesMatch(expected, presented) {
  if (!isNonEmptyString(expected) || !isNonEmptyString(presented)) return false;
  return timingSafeEqual(sha256(expected), sha256(presented));
}

// A query value, or null unless it is a non-empty string: a repeated parameter (an array) counts as missing.
const param = (query, name) => (isNonEmptyString(query?.[name]) ? query[name] : null);

// Every audit write is awaited, and a failed one is logged and ignored, so it never changes the outcome.
async function audit(log, event, details) {
  try {
    await log(event, { actor: OWNER_ACTOR, details });
  } catch (error) {
    console.error("[admin/spotify] audit log write failed:", describeError(error));
  }
}

async function failure(log, code, extra = {}, { audited = true } = {}) {
  if (audited) await audit(log, "spotify_connect_failed", { code, ...extra });
  console.warn(`[admin/spotify] reconnect failed: ${code}`);
  return { outcome: code, location: `/admin?spotify_error=${code}` };
}

/**
 * The callback's work after the admin checks. Returns { outcome, location }; each check's failure is an
 * outcome, not a rejection. deps = { env, exchangeCode, fetchSpotifyAccountId, saveSpotifyAuthorization,
 * resetSpotifyTokenCache, logAdminEvent }; a missing key means the real one.
 */
export async function completeSpotifyReconnect({ query, cookieState, deps = {} }) {
  const env = deps.env ?? process.env;
  const exchangeCode = deps.exchangeCode ?? realExchangeCode;
  const fetchSpotifyAccountId = deps.fetchSpotifyAccountId ?? realFetchSpotifyAccountId;
  const saveSpotifyAuthorization = deps.saveSpotifyAuthorization ?? realSaveSpotifyAuthorization;
  const resetSpotifyTokenCache = deps.resetSpotifyTokenCache ?? realResetSpotifyTokenCache;
  const log = deps.logAdminEvent ?? realLogAdminEvent;
  const fail = (code, extra, options) => failure(log, code, extra, options);

  // The state comes first, so a cross-site link to the callback gets nothing past it. Without a state cookie
  // no reconnect was in flight, so that mismatch writes no audit row.
  if (!statesMatch(cookieState, param(query, "state"))) {
    return fail("state_mismatch", {}, { audited: isNonEmptyString(cookieState) });
  }

  // Spotify sends the state back with error=access_denied, so a real denial gets here. Its raw text is never kept.
  const error = param(query, "error");
  if (error !== null) return fail("denied", { reason: error === "access_denied" ? "access_denied" : "other" });

  let credentials;
  try {
    credentials = spotifyCredentials(env);
  } catch {
    return fail("not_configured");
  }

  const code = param(query, "code");
  if (code === null) return fail("exchange_failed", { reason: "missing code" });

  let tokens;
  try {
    tokens = await exchangeCode({
      code,
      redirectUri: SPOTIFY_ADMIN_REDIRECT_URI,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
    });
  } catch (error) {
    return fail("exchange_failed", { reason: error?.message });
  }

  const missing = missingScopes(tokens.scopes);
  if (missing.length > 0) return fail("missing_scopes", { missing });

  let accountId;
  try {
    accountId = await fetchSpotifyAccountId(tokens.accessToken);
  } catch (error) {
    return fail("account_lookup_failed", { reason: error?.message });
  }

  if (accountId !== OWNER_SPOTIFY_ACCOUNT_ID) return fail("wrong_account", { accountId });

  try {
    await saveSpotifyAuthorization({ refreshToken: tokens.refreshToken, accountId, scopes: tokens.scopes });
  } catch (error) {
    return fail("save_failed", { reason: error?.message });
  }

  resetSpotifyTokenCache();
  await audit(log, "spotify_connected", { accountId, scopes: tokens.scopes });
  return { outcome: "connected", location: "/admin?spotify=connected" };
}

function redirect(res, location) {
  res.setHeader("Location", location);
  res.status(303).end();
}

// Answers a failed check (database down, Better Auth's schema check) with one redacted line and a 500, so a raw
// Error never reaches Next's API resolver, which would print it whole: stack, pg fields and all.
function serverError(res, label, error) {
  console.error(`[admin/spotify] ${label}:`, describeError(error));
  res.status(500).json({ error: "server_error" });
}

// True for the owner. Otherwise it has answered: 303 to /admin/sign-in without an owner session (both routes
// are top-level navigations, so a JSON 401 would show as a page), or 500 when the check itself failed.
async function checkOwner(req, res, deps) {
  let owner;
  try {
    owner = await getOwnerSession(req, { auth: deps.auth, db: deps.db });
  } catch (error) {
    serverError(res, "owner check failed", error);
    return false;
  }
  if (!owner) {
    redirect(res, "/admin/sign-in");
    return false;
  }
  return true;
}

/**
 * POST /api/admin/spotify/authorize. deps.env goes to isAdminEnabled and spotifyCredentials, deps.auth and
 * deps.db to getOwnerSession, deps.logAdminEvent to the audit log; a missing key means the real one.
 */
export async function handleSpotifyAuthorize(req, res, deps = {}) {
  setNoStore(res);
  if (!isAdminEnabled(req, deps.env)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  // Before the session is read.
  if (!isSameOrigin(req)) {
    res.status(403).json({ error: "bad_origin" });
    return;
  }
  if (!(await checkOwner(req, res, deps))) return;

  let clientId;
  try {
    ({ clientId } = spotifyCredentials(deps.env ?? process.env));
  } catch {
    const { location } = await failure(deps.logAdminEvent ?? realLogAdminEvent, "not_configured");
    redirect(res, location);
    return;
  }

  const state = newState();
  res.setHeader("Set-Cookie", stateCookie(state));
  redirect(res, buildAuthorizeUrl({ clientId, redirectUri: SPOTIFY_ADMIN_REDIRECT_URI, state }));
}

/**
 * GET /api/admin/spotify/callback. The state cookie is cleared on every answer. No same-origin check: Spotify's
 * redirect is a cross-site top-level GET, which SameSite=Lax still sends the session cookie with. The owner is
 * checked again, because the session can expire during the 10-minute round trip. The whole deps object also
 * goes to completeSpotifyReconnect.
 */
export async function handleSpotifyCallback(req, res, deps = {}) {
  res.setHeader("Set-Cookie", CLEAR_STATE_COOKIE);
  setNoStore(res);
  if (!isAdminEnabled(req, deps.env)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (!(await checkOwner(req, res, deps))) return;

  let location;
  try {
    ({ location } = await completeSpotifyReconnect({
      query: req.query,
      cookieState: readStateCookie(req.headers.cookie),
      deps,
    }));
  } catch (error) {
    // Its own failures are outcomes; this is only for a rejection it doesn't handle.
    serverError(res, "reconnect failed unexpectedly", error);
    return;
  }
  redirect(res, location);
}
