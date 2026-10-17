// What the admin pages say about a failure. Plain ESM with no imports, so
// client components can use it. A raw code or error_description is never
// rendered: a code is looked up here, and anything unknown gets the fallback.

const CODE_PATTERN = /^[a-z0-9_]{1,64}$/;

const EXPIRED = "That sign-in attempt expired. Try again.";

// not_owner, access_denied and the state_* codes come from Better Auth's OAuth
// callback redirect to /admin/sign-in?error=<code>. rate_limited and
// start_failed are client-side codes for a sign-in that couldn't start.
const SIGN_IN_ERRORS = {
  not_owner: "That GitHub account can't sign in here.",
  access_denied: "GitHub sign-in was cancelled.",
  state_mismatch: EXPIRED,
  state_not_found: EXPIRED,
  state_invalid: EXPIRED,
  rate_limited: "Too many sign-in attempts. Wait a minute and try again.",
  start_failed: "Couldn't start GitHub sign-in. Try again in a minute.",
};

const SIGN_IN_FALLBACK = "Sign-in didn't work. Try again.";

/**
 * A query value (?error=, ?spotify_error=) kept only when it is a short
 * lowercase code, so a crafted query never reaches the page as text.
 * @param {unknown} value
 * @returns {string | null}
 */
export function errorCodeFromQuery(value) {
  return typeof value === "string" && CODE_PATTERN.test(value) ? value : null;
}

/**
 * The message for a sign-in error code, or null when there is no error. A code
 * that isn't listed gets a generic message, never the code itself.
 * @param {string | null | undefined} code
 * @returns {string | null}
 */
export function signInErrorMessage(code) {
  if (!code) return null;
  return Object.hasOwn(SIGN_IN_ERRORS, code) ? SIGN_IN_ERRORS[code] : SIGN_IN_FALLBACK;
}
