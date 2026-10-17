import { test } from "node:test";
import assert from "node:assert/strict";
import { activityLabel, checkResultMessage, detailsSummary, flashFromQuery, importConfirmText, importResultMessage,
  panelAvailability, runStatusBadge, spotifyBadge, spotifyFlashMessage, syncErrorMessage } from "../../lib/admin/messages.js";

const limits = { panelCeiling: 1000, cronCeiling: 1800, monthlyLimit: 2000, storageLimitBytes: 1_000_000_000 };
const post = (shortcode, mediaCount) => ({ shortcode, postedAt: "2026-10-15T18:00:00.000Z", mediaCount });
const sync = (over) => ({ status: "ok", fetched: 14, alreadyPresent: 11, posts: [], uploads: 0, deferred: 0, errorCount: 0, ...over });
const failed = (status, body) => ({ ok: false, status, body, signedOut: false });

test("flashFromQuery reads only the two reconnect results", () => {
  assert.deepEqual(flashFromQuery({ spotify: "connected" }), { spotify: "connected", spotifyError: null });
  assert.deepEqual(flashFromQuery({ spotify_error: "wrong_account" }), { spotify: null, spotifyError: "wrong_account" });
  assert.deepEqual(flashFromQuery({ spotify: "yes", spotify_error: "<b>hi</b>" }), { spotify: null, spotifyError: null });
  assert.deepEqual(flashFromQuery({}), { spotify: null, spotifyError: null });
});

test("spotifyFlashMessage explains each reconnect result", () => {
  assert.deepEqual(spotifyFlashMessage({ spotify: "connected", spotifyError: null }),
    { status: "success", title: "Spotify reconnected", description: "The new token takes effect everywhere within a minute." });
  const cases = {
    denied: "Spotify approval was cancelled. Nothing changed.",
    state_mismatch: "The reconnect expired or started in another tab. Nothing changed. Press Reconnect again.",
    not_configured: "The server has no Spotify client credentials. Nothing changed. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in Vercel, redeploy, then reconnect.",
    exchange_failed: "Spotify didn't accept the approval. Nothing changed. Try again.",
    missing_scopes: "Spotify didn't grant all three permissions. Nothing changed. Reconnect and approve every permission.",
    account_lookup_failed: "Couldn't read the Spotify account. Nothing changed. Try again.",
    wrong_account: "That isn't the site's Spotify account. Nothing changed. Sign in to Spotify as the right account, then reconnect.",
    save_failed: "Spotify approved, but saving the new token failed. Nothing changed. Try again.",
    something_new: "Reconnecting failed. Nothing changed. Try again.",
  };
  for (const [code, description] of Object.entries(cases)) {
    assert.deepEqual(spotifyFlashMessage({ spotify: null, spotifyError: code }), { status: "error", title: "Spotify not reconnected", description });
  }
  assert.equal(spotifyFlashMessage({ spotify: null, spotifyError: null }), null);
});

test("spotifyBadge labels each state", () => {
  assert.deepEqual(spotifyBadge("connected"), { label: "Connected", colorPalette: "green" });
  assert.deepEqual(spotifyBadge("dead"), { label: "Needs reconnect", colorPalette: "red" });
  assert.deepEqual(spotifyBadge("env"), { label: "Using env var", colorPalette: "orange" });
  assert.deepEqual(spotifyBadge("missing"), { label: "Not connected", colorPalette: "gray" });
});

test("runStatusBadge colors every sync_runs status", () => {
  const expected = { running: ["Running", "blue"], ok: ["OK", "green"], partial: ["Partial", "orange"], skipped: ["Skipped", "gray"],
    failed: ["Failed", "red"], reauth_required: ["Token rejected", "red"], abandoned: ["Abandoned", "orange"] };
  for (const [status, [label, colorPalette]] of Object.entries(expected)) assert.deepEqual(runStatusBadge(status), { label, colorPalette });
  assert.deepEqual(runStatusBadge("mystery"), { label: "mystery", colorPalette: "gray" });
});

test("syncErrorMessage turns refusals into a reason and a retry time", () => {
  assert.equal(syncErrorMessage(failed(429, { error: "too_soon", retryAfterSeconds: 420 })),
    "A check already ran in the last 10 minutes. Try again in 7 minutes.");
  assert.equal(syncErrorMessage(failed(429, { error: "daily_limit", retryAfterSeconds: 50_400 })),
    "An import already ran in the last 24 hours. Try again in 14 hours.");
  assert.equal(syncErrorMessage(failed(429, { error: "upload_ceiling", retryAfterSeconds: 259_200 })),
    "Uploads in the last 30 days reached the panel's limit of 1,000. Try again in 3 days.");
  assert.equal(syncErrorMessage(failed(429, { error: "upload_ceiling" })),
    "Uploads in the last 30 days reached the panel's limit of 1,000.");
  assert.equal(syncErrorMessage(failed(503, { error: "instagram_reauth_required" })),
    "Instagram rejected the token, so nothing ran. Issue a new token as the README's Instagram section describes.");
  assert.equal(syncErrorMessage(failed(403, { error: "bad_origin" })),
    "The server refused this page's origin. Reload the page and try again.");
  assert.equal(syncErrorMessage(failed(0, null)), "Couldn't reach the server. Check the connection and try again.");
  assert.equal(syncErrorMessage(failed(500, null)), "The run failed (HTTP 500). The runs table has the details.");
});

// Controller note 3: the sync route can also answer 500 { error: "server_error" } (requireAdmin's owner-check
// failure), and a proxy or platform can answer any other 5xx. All of them get the generic message, and a body the
// panel doesn't know is never echoed.
test("syncErrorMessage gives the generic message for server_error, sync_failed and any unknown 5xx", () => {
  const generic = (status) => `The run failed (HTTP ${status}). The runs table has the details.`;
  assert.equal(syncErrorMessage(failed(500, { error: "server_error" })), generic(500));
  assert.equal(syncErrorMessage(failed(500, { error: "sync_failed" })), generic(500));
  assert.equal(syncErrorMessage(failed(502, null)), generic(502));
  assert.equal(syncErrorMessage(failed(504, { error: "gateway_timeout" })), generic(504));
  assert.equal(syncErrorMessage(failed(500, { error: "<b>boom</b>", detail: "secret" })), generic(500));
  assert.equal(syncErrorMessage(failed(429, { error: "something_new", retryAfterSeconds: 60 })), generic(429));
});

test("checkResultMessage and importResultMessage summarise a run", () => {
  assert.equal(checkResultMessage(sync({})), "No new posts. Nothing to import.");
  assert.equal(checkResultMessage(sync({ posts: [post("A1", 3), post("B2", 1)], uploads: 4 })),
    "Found 2 new posts with 4 files to upload.");
  assert.equal(checkResultMessage(sync({ posts: [post("A1", 3)], uploads: 3, deferred: 5, errorCount: 1 })),
    "Found 1 new post with 3 files to upload. 5 more posts wait for a later run. 1 error; see the runs table.");
  assert.equal(importResultMessage(sync({ posts: [post("A1", 3), post("B2", 1)], uploads: 4 })), "Imported 2 posts (4 file uploads).");
  assert.equal(importResultMessage(sync({ status: "partial", posts: [post("A1", 3)], uploads: 3, errorCount: 2 })),
    "Imported 1 post (3 file uploads). 2 errors; see the runs table.");
  assert.equal(importResultMessage(sync({ status: "skipped" })),
    "Nothing was imported: another sync held the lease, or the 30-day upload ceiling was reached. The runs table has the details.");
});

test("importConfirmText states the post and upload counts", () => {
  const check = sync({ posts: [post("A1", 3), post("B2", 1)], uploads: 4 });
  assert.equal(importConfirmText(check, { uploads30d: 120, limits }),
    "Import 2 posts and upload 4 files to Blob? That brings uploads in the last 30 days to 124 of 2,000. The panel allows one import per 24 hours.");
});

test("panelAvailability compares the limits with the status's own clock", () => {
  const at = "2026-10-16T12:00:00.000Z";
  const free = { nextCheckAt: null, nextImportAt: null, importBlockedReason: null };
  assert.deepEqual(panelAvailability(free, at, limits), { canCheck: true, checkHint: null, canImport: true, importHint: null });
  assert.deepEqual(panelAvailability({ ...free, nextCheckAt: "2026-10-16T12:07:00.000Z" }, at, limits),
    { canCheck: false, checkHint: "Next check available Oct 16, 2026, 12:07 UTC.", canImport: true, importHint: null });
  assert.equal(panelAvailability({ ...free, nextCheckAt: "2026-10-16T11:59:00.000Z" }, at, limits).canCheck, true);
  assert.deepEqual(panelAvailability({ ...free, importBlockedReason: "daily_limit", nextImportAt: "2026-10-17T09:30:00.000Z" }, at, limits),
    { canCheck: true, checkHint: null, canImport: false,
      importHint: "The panel allows one import per 24 hours. Next import available Oct 17, 2026, 09:30 UTC." });
  assert.deepEqual(panelAvailability({ ...free, importBlockedReason: "upload_ceiling" }, at, limits),
    { canCheck: true, checkHint: null, canImport: false,
      importHint: "Uploads in the last 30 days reached 1,000, the panel's limit. The daily sync keeps importing up to 1,800." });
});

test("activityLabel and detailsSummary describe audit rows", () => {
  const labels = { sign_in: "Signed in", sign_in_rejected: "Sign-in refused", spotify_connected: "Spotify reconnected",
    spotify_connect_failed: "Spotify reconnect failed", instagram_check: "Checked for new posts",
    instagram_import: "Imported posts", panel_run_refused: "Run refused" };
  for (const [event, label] of Object.entries(labels)) assert.equal(activityLabel(event), label);
  assert.equal(activityLabel("unknown_event"), "unknown_event");
  assert.equal(detailsSummary({ code: "wrong_account" }), "code: wrong_account");
  assert.equal(detailsSummary({ login: "someone", githubId: 42, nested: { a: 1 }, list: [1], gone: null, ok: true }),
    "login: someone, githubId: 42, ok: true");
  const long = detailsSummary({ reason: "x".repeat(300) });
  assert.equal(long.length, 120);
  assert.ok(long.endsWith("…"));
  assert.equal(detailsSummary(null), "");
});

// Beyond the brief: the lookups are keyed by values the server or the query string supplies, and a code such as
// "constructor" or "__proto__" matches the code pattern, so none of them may read an inherited property.
test("lookups ignore inherited property names", () => {
  for (const key of ["constructor", "__proto__", "toString"]) {
    assert.equal(spotifyFlashMessage({ spotify: null, spotifyError: key }).description, "Reconnecting failed. Nothing changed. Try again.");
    assert.deepEqual(spotifyBadge(key), { label: key, colorPalette: "gray" });
    assert.deepEqual(runStatusBadge(key), { label: key, colorPalette: "gray" });
    assert.equal(activityLabel(key), key);
    assert.equal(syncErrorMessage(failed(429, { error: key, retryAfterSeconds: 60 })),
      "The run failed (HTTP 429). The runs table has the details.");
  }
});

// Beyond the brief: a run with no posts still reports its errors and deferrals, and an Import that finds nothing
// new (the cron got there first) doesn't claim it imported "0 posts".
test("a run with no posts still reports its errors, and an empty import says so", () => {
  assert.equal(checkResultMessage(sync({ errorCount: 2 })), "No new posts. Nothing to import. 2 errors; see the runs table.");
  assert.equal(importResultMessage(sync({})), "No new posts. Nothing was imported.");
  assert.equal(importResultMessage(sync({ posts: [post("A1", 1)], uploads: 1, deferred: 1 })),
    "Imported 1 post (1 file upload). 1 more post waits for a later run.");
});
