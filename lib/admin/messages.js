// What the admin pages say about a failure or a result. Plain ESM, so client
// components can use it; its only import is ./format.js, which has none. A raw
// code or error_description is never rendered: a code is looked up here, and
// anything unknown gets the fallback.

import { formatCount, formatDuration, formatTimestamp } from "./format.js";

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

// ---- The dashboard (/admin) ----

// Own-property lookup only, so a crafted code such as "constructor" or "__proto__" gets the fallback.
const lookup = (table, key) => (typeof key === "string" && Object.hasOwn(table, key) ? table[key] : undefined);

// "1 post", "5 posts", "1 new post".
const plural = (n, word) => `${formatCount(n)} ${word}${n === 1 ? "" : "s"}`;

/**
 * The two reconnect results that GET /api/admin/spotify/callback
 * (lib/admin/spotify-reconnect.js) puts in the query. Anything else, including
 * a crafted value, comes back null.
 * @param {Record<string, unknown>} query
 * @returns {{ spotify: "connected" | null, spotifyError: string | null }}
 */
export function flashFromQuery(query) {
  return {
    spotify: query?.spotify === "connected" ? "connected" : null,
    spotifyError: errorCodeFromQuery(query?.spotify_error),
  };
}

// The eight error codes that GET /api/admin/spotify/callback (lib/admin/spotify-reconnect.js) puts in ?spotify_error=.
const SPOTIFY_ERRORS = {
  denied: "Spotify approval was cancelled. Nothing changed.",
  state_mismatch: "The reconnect expired or started in another tab. Nothing changed. Press Reconnect again.",
  not_configured:
    "The server has no Spotify client credentials. Nothing changed. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in Vercel, redeploy, then reconnect.",
  exchange_failed: "Spotify didn't accept the approval. Nothing changed. Try again.",
  missing_scopes: "Spotify didn't grant all three permissions. Nothing changed. Reconnect and approve every permission.",
  account_lookup_failed: "Couldn't read the Spotify account. Nothing changed. Try again.",
  wrong_account:
    "That isn't the site's Spotify account. Nothing changed. Sign in to Spotify as the right account, then reconnect.",
  save_failed: "Spotify approved, but saving the new token failed. Nothing changed. Try again.",
};
const SPOTIFY_ERROR_FALLBACK = "Reconnecting failed. Nothing changed. Try again.";

/**
 * The alert for a reconnect result, or null when there was none. The error code
 * is looked up and never shown. An error wins over a success.
 * @param {{ spotify: "connected" | null, spotifyError: string | null }} flash
 * @returns {{ status: "success" | "error", title: string, description: string } | null}
 */
export function spotifyFlashMessage(flash) {
  if (flash.spotifyError) {
    return {
      status: "error",
      title: "Spotify not reconnected",
      description: lookup(SPOTIFY_ERRORS, flash.spotifyError) ?? SPOTIFY_ERROR_FALLBACK,
    };
  }
  if (flash.spotify === "connected") {
    return {
      status: "success",
      title: "Spotify reconnected",
      // Other instances recheck a dead row once a minute, but keep a working token's cached access token until
      // its next refresh, within an hour (README, Spotify token).
      description:
        "The new token is saved. This server uses it now, and every other one within an hour, or within a minute if the old token had stopped working.",
    };
  }
  return null;
}

const SPOTIFY_BADGES = {
  connected: { label: "Connected", colorPalette: "green" },
  dead: { label: "Needs reconnect", colorPalette: "red" },
  env: { label: "Using env var", colorPalette: "orange" },
  missing: { label: "Not connected", colorPalette: "gray" },
};

/**
 * @param {string} state "connected" | "dead" | "env" | "missing"
 * @returns {{ label: string, colorPalette: "green" | "red" | "orange" | "gray" | "blue" }}
 */
export function spotifyBadge(state) {
  return lookup(SPOTIFY_BADGES, state) ?? { label: String(state), colorPalette: "gray" };
}

const RUN_STATUS_BADGES = {
  running: { label: "Running", colorPalette: "blue" },
  ok: { label: "OK", colorPalette: "green" },
  partial: { label: "Partial", colorPalette: "orange" },
  skipped: { label: "Skipped", colorPalette: "gray" },
  failed: { label: "Failed", colorPalette: "red" },
  reauth_required: { label: "Token rejected", colorPalette: "red" },
  abandoned: { label: "Abandoned", colorPalette: "orange" },
};

/**
 * @param {string} status a sync_runs status
 * @returns {{ label: string, colorPalette: "green" | "red" | "orange" | "gray" | "blue" }}
 */
export function runStatusBadge(status) {
  return lookup(RUN_STATUS_BADGES, status) ?? { label: String(status), colorPalette: "gray" };
}

// "10 minutes", "24 hours" and "1,000" mirror the D4 constants in lib/admin/sync-limits.js. That module imports the
// database pool, so a client component cannot import it.
/** The one remedy for a token Instagram rejected, on the Instagram card and after a refused run. */
export const INSTAGRAM_TOKEN_REMEDY =
  "Generate a new token and seed it with npm run instagram:token, as the README's Instagram sync section describes.";

const PANEL_REFUSALS = {
  too_soon: "A check already ran in the last 10 minutes.",
  daily_limit: "An import already ran in the last 24 hours.",
  upload_ceiling: `Uploads in the last 30 days reached the panel's limit of ${formatCount(1000)}.`,
};

/**
 * Why a Check or Import didn't work, from postJson's result. Only a known
 * { error } code is turned into text; an unknown body is never echoed. A 500
 * sync_failed is a run that threw after writing its sync_runs row, so it points
 * at the runs table. Any other failure (400, 404, 405, the sync route's 500
 * server_error, a proxy's 502) wrote no row, so it points at Vercel's logs.
 * @param {{ ok: boolean, status: number, body: unknown, signedOut: boolean }} result
 * @returns {string}
 */
export function syncErrorMessage(result) {
  const body = /** @type {{ error?: unknown, retryAfterSeconds?: unknown } | null} */ (result.body);
  const code = body?.error;
  switch (result.status) {
    case 0:
      return "Couldn't reach the server. Check the connection and try again.";
    case 429: {
      const reason = lookup(PANEL_REFUSALS, code);
      if (reason === undefined) break;
      const wait = body?.retryAfterSeconds;
      return typeof wait === "number" && wait > 0 ? `${reason} Try again in ${formatDuration(wait)}.` : reason;
    }
    case 503:
      if (code === "instagram_reauth_required") {
        return `Instagram rejected the token, so nothing ran. ${INSTAGRAM_TOKEN_REMEDY}`;
      }
      break;
    case 403:
      if (code === "bad_origin") return "The server refused this page's origin. Reload the page and try again.";
      break;
    case 500:
      if (code === "sync_failed") return "The run failed (HTTP 500). The runs table has the details.";
      break;
    default:
  }
  return `The request failed (HTTP ${result.status}). Try again; Vercel's logs have the details.`;
}

/**
 * @typedef {{ status: string, posts: unknown[], uploads: number, deferred: number, errorCount: number }} SyncSummary
 */

// Posts held back by the run's caps.
function deferredTail(body) {
  if (!(body.deferred > 0)) return "";
  return ` ${plural(body.deferred, "more post")} ${body.deferred === 1 ? "waits" : "wait"} for a later run.`;
}

// The sentences a Check and an Import both end with: posts held back by the run's caps, and errors.
function runTail(body) {
  return `${deferredTail(body)}${body.errorCount > 0 ? ` ${plural(body.errorCount, "error")}; see the runs table.` : ""}`;
}

/**
 * What a Check (a dry run) found.
 * @param {SyncSummary} body
 * @returns {string}
 */
export function checkResultMessage(body) {
  if (body.posts.length === 0) return `No new posts. Nothing to import.${runTail(body)}`;
  return `Found ${plural(body.posts.length, "new post")} with ${plural(body.uploads, "file")} to upload.${runTail(body)}`;
}

/**
 * What an Import (a real run) did.
 * @param {SyncSummary} body
 * @returns {string}
 */
export function importResultMessage(body) {
  if (body.status === "skipped") {
    return "Nothing was imported: another sync held the lease, the 30-day upload ceiling was reached, or the run couldn't be recorded. The runs table has the details, or Vercel's logs if the run wasn't recorded.";
  }
  // posts lists only the posts that were stored: here every new post the run tried failed.
  if (body.posts.length === 0 && body.errorCount > 0) {
    return `Nothing was imported: ${plural(body.errorCount, "post")} failed. The runs table has the errors.${deferredTail(body)}`;
  }
  if (body.posts.length === 0) return `No new posts. Nothing was imported.${runTail(body)}`;
  return `Imported ${plural(body.posts.length, "post")} (${plural(body.uploads, "file upload")}).${runTail(body)}`;
}

/**
 * The notice after an Import: success for an ok run, error when every new post failed, a warning otherwise
 * (some posts failed, or the run stood down).
 * @param {SyncSummary} body
 * @returns {{ status: "success" | "warning" | "error", text: string }}
 */
export function importNotice(body) {
  let status = "warning";
  if (body.status === "ok") status = "success";
  else if (body.posts.length === 0 && body.errorCount > 0) status = "error";
  return { status, text: importResultMessage(body) };
}

// A dry run's Blob check passes with "ok" (or, before anything is stored, "configured, nothing stored yet to check
// against"), and its resizer check with "ok (sharp …)". Anything else is the failing error's "name: message".
const blobCheckPassed = (text) => text === "ok" || text.startsWith("configured, nothing stored yet");
const resizeCheckPassed = (text) => text === "ok" || text.startsWith("ok (");

/**
 * The notice after a Check, and whether Import may follow it. A failed Blob or resizer check is an error that
 * blocks Import, because an import would fail on it.
 * @param {SyncSummary & { blob?: string, resize?: string }} body
 * @returns {{ status: "info" | "error", text: string, importAllowed: boolean }}
 */
export function checkNotice(body) {
  const failed = [];
  if (typeof body.blob === "string" && !blobCheckPassed(body.blob)) failed.push(["Blob", "Blob"]);
  if (typeof body.resize === "string" && !resizeCheckPassed(body.resize)) failed.push(["Resizing", "Resize"]);
  const found = checkResultMessage(body);
  if (failed.length === 0) return { status: "info", text: found, importAllowed: true };
  const what = failed.length === 1 ? `${failed[0][0]} failed its check` : "Blob and resizing failed their checks";
  const lines = failed.length === 1 ? `the ${failed[0][1]} line` : "the Blob and Resize lines";
  return { status: "error", text: `${what}, so an import would fail. See ${lines} below. ${found}`, importAllowed: false };
}

/**
 * The confirm dialog's sentence: what the import will upload and where that
 * leaves the 30-day count.
 * @param {{ posts: unknown[], uploads: number }} check the Check's result
 * @param {{ uploads30d: number, limits: { monthlyLimit: number } }} instagram
 * @returns {string}
 */
export function importConfirmText(check, { uploads30d, limits }) {
  return (
    `Import ${plural(check.posts.length, "post")} and upload ${plural(check.uploads, "file")} to Blob? ` +
    `That brings uploads in the last 30 days to ${formatCount(uploads30d + check.uploads)} of ${formatCount(limits.monthlyLimit)}. ` +
    "The panel allows one import per 24 hours."
  );
}

/**
 * Whether Check and Import are available, and why not. It compares the panel's
 * times with the status's own generatedAt, not the clock, so a render is the
 * same on the server and in the browser.
 * @param {{ nextCheckAt: string | null, nextImportAt: string | null, importBlockedReason: string | null }} panel
 * @param {string} generatedAt
 * @param {{ panelCeiling: number, cronCeiling: number }} limits
 * @returns {{ canCheck: boolean, checkHint: string | null, canImport: boolean, importHint: string | null }}
 */
export function panelAvailability(panel, generatedAt, limits) {
  const canCheck = !panel.nextCheckAt || Date.parse(panel.nextCheckAt) <= Date.parse(generatedAt);
  const canImport = panel.importBlockedReason === null;
  let importHint = null;
  if (panel.importBlockedReason === "daily_limit") {
    importHint = `The panel allows one import per 24 hours.${
      panel.nextImportAt ? ` Next import available ${formatTimestamp(panel.nextImportAt)}.` : ""
    }`;
  } else if (panel.importBlockedReason === "upload_ceiling") {
    importHint =
      `Uploads in the last 30 days reached ${formatCount(limits.panelCeiling)}, the panel's limit. ` +
      `The daily sync keeps importing up to ${formatCount(limits.cronCeiling)}.`;
  }
  return {
    canCheck,
    checkHint: canCheck ? null : `Next check available ${formatTimestamp(panel.nextCheckAt)}.`,
    canImport,
    importHint,
  };
}

const ACTIVITY_LABELS = {
  sign_in: "Signed in",
  sign_in_rejected: "Sign-in refused",
  spotify_connected: "Spotify reconnected",
  spotify_connect_failed: "Spotify reconnect failed",
  instagram_check: "Checked for new posts",
  instagram_import: "Imported posts",
  panel_run_refused: "Run refused",
};

/**
 * @param {string} event an admin_audit_log event
 * @returns {string}
 */
export function activityLabel(event) {
  return lookup(ACTIVITY_LABELS, event) ?? String(event);
}

const DETAILS_MAX = 120;

/**
 * One line for an audit row's details: only the string, number and boolean
 * values, as "key: value", cut to 120 characters. The details were redacted when
 * they were written (lib/admin/audit-log.js), and React escapes them.
 * @param {Record<string, unknown> | null | undefined} details
 * @returns {string}
 */
export function detailsSummary(details) {
  if (details === null || typeof details !== "object" || Array.isArray(details)) return "";
  const parts = [];
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") parts.push(`${key}: ${value}`);
  }
  const text = parts.join(", ");
  if (text.length <= DETAILS_MAX) return text;
  let cut = text.slice(0, DETAILS_MAX - 1);
  // Don't leave half of a surrogate pair in front of the ellipsis.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut}…`;
}
