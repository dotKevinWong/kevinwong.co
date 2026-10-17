import { fromNodeHeaders } from "better-auth/node";
import { getAuth } from "../auth.js";
import { getDbPool } from "../db.js";
import { redact } from "../redact.js";
import { OWNER_GITHUB_ID, SITE_HOST, SITE_ORIGIN } from "./owner.js";

// The checks every /admin page and /api/admin route runs, and the /api/auth
// route's allowlist. Server code only, like lib/auth.js.

const NO_STORE = "private, no-store, max-age=0, must-revalidate";

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
 * sent the error response. deps is { env, auth, db }; a missing key means the
 * real one. getAuth() is reached only after the enabled check, so a preview
 * (no auth env vars) never builds Better Auth.
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
  const owner = await getOwnerSession(req, { auth: deps.auth, db: deps.db });
  if (owner === null) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
  return owner;
}

const AUTH_ALLOWLIST = new Set([
  "POST /api/auth/sign-in/social",
  "GET /api/auth/callback/github",
  "POST /api/auth/sign-out",
]);

// Exact METHOD + path. No URL parsing: "//x/..." must not turn into a host, and a trailing
// slash, a different case or an encoded character all fall through to 404.
export function isAllowedAuthRequest(method, url) {
  const path = String(url ?? "").split("?", 1)[0];
  return AUTH_ALLOWLIST.has(`${method} ${path}`);
}

/**
 * Runs handle(req, res), which in pages/api/auth/[...all].js builds Better
 * Auth and forwards to its Node handler. lib/auth.js sets onAPIError.throw, so
 * an error that isn't an APIError (the database down, a body Better Auth can't
 * parse) rejects out of it; so does getAuth() on a misconfigured deployment.
 * This logs one redacted line, never the Error object, its stack or pg's
 * err.detail, and answers 500 if nothing has been sent yet.
 */
export async function forwardAuthRequest(req, res, handle) {
  try {
    return await handle(req, res);
  } catch (error) {
    console.error("[auth] request failed:", redact(`${error?.name || "Error"}${error?.code ? ` [${error.code}]` : ""}: ${error?.message || String(error)}`));
    if (!res.headersSent) res.status(500).json({ error: "server_error" });
  }
}
