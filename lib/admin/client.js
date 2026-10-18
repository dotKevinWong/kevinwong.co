// Browser helpers for the admin pages. Plain ESM with no imports, so client
// components can use it. Do not import anything here that reaches lib/db.js or
// lib/auth.js: that would pull pg and Better Auth into the browser bundle.

const GITHUB_AUTHORIZE_PREFIX = "https://github.com/login/oauth/authorize?";

/**
 * POSTs a JSON body to a same-origin URL and reports what came back. It never
 * throws: a network failure is status 0, and a body that isn't JSON (or is
 * malformed JSON) is null. `signedOut` is true for a 401, so a caller can send
 * an expired session to /admin/sign-in.
 * @param {string} url
 * @param {unknown} body
 * @param {{ fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<{ ok: boolean, status: number, body: unknown, signedOut: boolean }>}
 */
export async function postJson(url, body, { fetchImpl = fetch } = {}) {
  let res;
  try {
    // A plain call, never options.fetchImpl(...): a detached window.fetch called
    // with another `this` throws "Illegal invocation".
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, body: null, signedOut: false };
  }
  let parsed = null;
  if (res.headers.get("content-type")?.includes("json")) {
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
  }
  return { ok: res.ok, status: res.status, body: parsed, signedOut: res.status === 401 };
}

/**
 * The GitHub authorize URL in a Better Auth sign-in response, or null when the
 * response holds anything else. The page navigates to whatever this returns,
 * so it accepts only GitHub's authorize endpoint.
 * @param {unknown} body
 * @returns {string | null}
 */
export function githubAuthorizeUrl(body) {
  const url = /** @type {{ url?: unknown } | null} */ (body)?.url;
  return typeof url === "string" && url.startsWith(GITHUB_AUTHORIZE_PREFIX) ? url : null;
}

/**
 * The status poll's onError rule: a 401 means the session is gone, so the
 * dashboard goes to /admin/sign-in. lib/fetcher.js puts the HTTP status on the
 * error it throws.
 * @param {{ status?: number } | null | undefined} error
 * @returns {boolean}
 */
export function isSignedOutError(error) {
  return error?.status === 401;
}

/**
 * The banner the dashboard shows for the status poll: "load_failed" when no
 * status has loaded and the last fetch failed, "loading" before the first one,
 * "refresh_failed" when a status is showing but the latest refresh failed, and
 * null otherwise. A 401 shows no refresh banner, because isSignedOutError has
 * already sent the page to sign-in.
 * @param {{ hasData: boolean, error: { status?: number } | null | undefined }} poll
 * @returns {"load_failed" | "loading" | "refresh_failed" | null}
 */
export function statusBanner({ hasData, error }) {
  if (!hasData) return error ? "load_failed" : "loading";
  return error && !isSignedOutError(error) ? "refresh_failed" : null;
}
