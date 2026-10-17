import { fromNodeHeaders } from "better-auth/node";
import { getAuth } from "../auth.js";
import { getDbPool } from "../db.js";
import { redact } from "../redact.js";
import { OWNER_GITHUB_ID, SITE_HOST, SITE_ORIGIN } from "./owner.js";

// The checks every /admin page and /api/admin route runs, and the /api/auth
// route's allowlist. Server code only, like lib/auth.js.

const NO_STORE = "private, no-store, max-age=0, must-revalidate";

// One redacted line for a log: never the Error object, its stack or pg's err.detail.
const describeError = (error) =>
  redact(`${error?.name || "Error"}${error?.code ? ` [${error.code}]` : ""}: ${error?.message || String(error)}`);

/** Admin exists only on the production deployment, and only when reached as www.kevinwong.co. */
export function isAdminEnabled(req, env = process.env) {
  return env.VERCEL_ENV === "production" && req.headers.host === SITE_HOST;
}

/** Exact match: no trailing slash, no other scheme or host, and a missing Origin fails. */
export function isSameOrigin(req) {
  return req.headers.origin === SITE_ORIGIN;
}

export function setNoStore(res) {
  res.setHeader("Cache-Control", NO_STORE);
}

/**
 * The signed-in owner, or null. A session alone isn't enough: its user must
 * hold the GitHub account with the owner's id. Errors (database down, Better
 * Auth's SchemaMismatchError) propagate, so the caller fails with a 500.
 * Never returns the session token.
 */
export async function getOwnerSession(req, { auth = getAuth(), db = getDbPool() } = {}) {
  const s = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!s?.user?.id) return null;
  const { rowCount } = await db.query(
    `select 1 from auth_account where "userId" = $1 and "providerId" = 'github' and "accountId" = $2 limit 1`,
    [s.user.id, OWNER_GITHUB_ID]
  );
  if (rowCount !== 1) return null;
  return { userId: s.user.id, name: s.user.name, image: s.user.image ?? null, expiresAt: s.session.expiresAt };
}

/**
 * Runs the admin checks in order: no-store, enabled (404), same origin for a
 * mutation (403), owner session (401). Returns the owner, or null after it has
 * sent the error response. When the owner check itself fails (database down,
 * Better Auth's schema check), it logs one redacted line and answers 500, so a
 * caller's `if (!owner) return;` never lets a raw Error reach Next's logger.
 * deps is { env, auth, db }; a missing key means the real one. getAuth() is
 * reached only after the enabled check, so a preview (no auth env vars) never
 * builds Better Auth.
 */
export async function requireAdmin(req, res, { mutation = false, deps = {} } = {}) {
  setNoStore(res);
  if (!isAdminEnabled(req, deps.env)) {
    res.status(404).json({ error: "not_found" });
    return null;
  }
  if (mutation && !isSameOrigin(req)) {
    res.status(403).json({ error: "bad_origin" });
    return null;
  }
  let owner;
  try {
    owner = await getOwnerSession(req, { auth: deps.auth, db: deps.db });
  } catch (error) {
    console.error("[admin] owner check failed:", describeError(error));
    res.status(500).json({ error: "server_error" });
    return null;
  }
  if (owner === null) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
  return owner;
}

/** The only METHOD + path pairs the /api/auth route hands to Better Auth. Frozen, and the lookup itself. */
export const AUTH_ALLOWLIST = Object.freeze([
  "POST /api/auth/sign-in/social",
  "GET /api/auth/callback/github",
  "POST /api/auth/sign-out",
]);

// Exact METHOD + path. No URL parsing: "//x/..." must not turn into a host, and a trailing
// slash, a different case or an encoded character all fall through to 404.
export function isAllowedAuthRequest(method, url) {
  const path = String(url ?? "").split("?", 1)[0];
  return AUTH_ALLOWLIST.includes(`${method} ${path}`);
}

/**
 * Runs handle(req, res), which in pages/api/auth/[...all].js builds Better
 * Auth and forwards to its Node handler. Call it only for a request that
 * passed isAdminEnabled and isAllowedAuthRequest.
 *
 * better-call's toNodeHandler builds the Request URL that Better Auth routes
 * on from `${X-Forwarded-Proto || socket}://${:authority || Host}${req.url}`.
 * The caller checked Host and req.url, but a client can send the other two
 * (X-Forwarded-Proto: "https://www.kevinwong.co/api/auth/callback/github?#"
 * turns sign-out into the callback). Admin is enabled only in production on
 * www, which is always https, so the protocol is pinned and :authority goes.
 * (Better Auth itself reads X-Forwarded-Host/-Proto only without a baseURL or
 * with advanced.trustedProxyHeaders, and lib/auth.js uses neither.)
 *
 * lib/auth.js sets onAPIError.throw, so an error that isn't an APIError (the
 * database down, a body Better Auth can't parse) rejects out of the handler;
 * so does getAuth() on a misconfigured deployment. This logs one redacted
 * line, never the Error object, its stack or pg's err.detail, and answers 500
 * if nothing has been sent yet.
 */
export async function forwardAuthRequest(req, res, handle) {
  try {
    req.headers["x-forwarded-proto"] = "https";
    delete req.headers[":authority"];
    return await handle(req, res);
  } catch (error) {
    console.error("[auth] request failed:", describeError(error));
    if (!res.headersSent) res.status(500).json({ error: "server_error" });
  }
}
