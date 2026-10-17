import { statusFromSummary } from "../sync-runs.js";
import { InstagramReauthRequiredError } from "../instagram.js";
import { OWNER_ACTOR } from "./audit-log.js";
import { describeError } from "../redact.js";

// POST /api/admin/instagram/sync: the panel's Check (a dry run) and Import (a real run) buttons.
// pages/api/admin/instagram/sync.js wires the real dependencies; the tests pass fakes. The client picks only
// dryRun. Every other run parameter is fixed here (D4), and the panel's limits are checked in sync_runs and then
// claimed in job_locks before syncInstagram starts.

// Next's body parser is off for this route (config.api.bodyParser = false), so requireAdmin answers 404, 403, 401
// or 500 before any body is read (D1). Returns the parsed body of an application/json request of 1 to limitBytes
// bytes, else undefined. It never stops reading early: ending the iterator early destroys the request and its socket.
export async function readJsonBody(req, limitBytes = 1024) {
  const type = String(req.headers?.["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size <= limitBytes) chunks.push(chunk);
    }
    if (type !== "application/json" || size === 0 || size > limitBytes) return undefined;
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

const PANEL_RUN = Object.freeze({ trigger: "panel", maxPosts: 50, maxUploads: 25, timeBudgetMs: 60_000 });

const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * deps = { requireAdmin, readJsonBody, checkPanelRunAllowed, claimPanelSlot, releasePanelImportSlot,
 * syncInstagram, logAdminEvent }, all required. The response always goes last: a Vercel function can freeze once
 * it is sent, so the audit write, the ledger re-read and any release are awaited first. Each of those is logged
 * and ignored when it fails, so it never changes the response; a failed release leaves the slot claimed, so the
 * limit fails closed.
 */
export function createInstagramSyncHandler({
  requireAdmin, readJsonBody, checkPanelRunAllowed, claimPanelSlot, releasePanelImportSlot, syncInstagram,
  logAdminEvent,
}) {
  // Awaits fn(); if it rejects, logs one redacted line and resolves to undefined.
  async function settle(label, fn) {
    try {
      return await fn();
    } catch (error) {
      console.error(`[admin/instagram] ${label}:`, describeError(error));
      return undefined;
    }
  }

  const audit = (event, details) =>
    settle("audit log write failed", () => logAdminEvent(event, { actor: OWNER_ACTOR, details }));

  // An import that ended having uploaded nothing doesn't use up the day, so its slot is freed.
  const releaseImportSlot = () => settle("import slot release failed", () => releasePanelImportSlot());

  async function refuse(res, { dryRun, reason, retryAfterSeconds }) {
    res.setHeader("Retry-After", String(retryAfterSeconds));
    await audit("panel_run_refused", { dryRun, reason, retryAfterSeconds });
    res.status(429).json({ error: reason, retryAfterSeconds });
  }

  // A throw carries no summary, so the ledger says whether the import used up the day: syncInstagram has recorded
  // its row as failed or reauth_required with every upload counted, which counts only when it uploaded something
  // (or still says running because recording failed). A re-read that fails keeps the slot claimed.
  async function afterThrownImport() {
    const verdict = await settle("limit re-read failed", () => checkPanelRunAllowed({ dryRun: false }));
    if (verdict !== undefined && verdict.reason !== "daily_limit") await releaseImportSlot();
  }

  async function handle(req, res) {
    // First, with the body parser off, so every method and every body gets 404 outside production (D1).
    const owner = await requireAdmin(req, res, { mutation: true });
    if (!owner) return;

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      res.status(405).json({ error: "method_not_allowed" });
      return;
    }

    const body = await readJsonBody(req);
    if (!isPlainObject(body) || typeof body.dryRun !== "boolean") {
      res.status(400).json({ error: "bad_request" });
      return;
    }
    const { dryRun } = body;

    const verdict = await checkPanelRunAllowed({ dryRun });
    if (!verdict.allowed) {
      await refuse(res, { dryRun, reason: verdict.reason, retryAfterSeconds: verdict.retryAfterSeconds });
      return;
    }

    const claim = await claimPanelSlot({ dryRun });
    if (!claim.claimed) {
      // Another request holds the slot: the run it started may not have written its sync_runs row yet.
      await refuse(res, { dryRun, reason: dryRun ? "too_soon" : "daily_limit", retryAfterSeconds: claim.retryAfterSeconds });
      return;
    }

    const event = dryRun ? "instagram_check" : "instagram_import";
    let summary;
    try {
      summary = await syncInstagram({ ...PANEL_RUN, dryRun });
    } catch (error) {
      const reauth = error instanceof InstagramReauthRequiredError;
      // lib/instagram.js has already logged what a dead token needs.
      if (!reauth) console.error("[admin/instagram] sync failed:", describeError(error));
      await audit(event, { status: reauth ? "reauth_required" : "failed" });
      if (!dryRun) await afterThrownImport();
      if (reauth) res.status(503).json({ error: "instagram_reauth_required" });
      else res.status(500).json({ error: "sync_failed" });
      return;
    }

    const status = statusFromSummary(summary);
    const errorCount = summary.errors.length;
    const result = {
      status,
      fetched: summary.fetched,
      alreadyPresent: summary.alreadyPresent,
      // Never the caption or anything else from the run's posts.
      posts: summary.inserted.map(({ shortcode, postedAt, mediaCount }) => ({ shortcode, postedAt, mediaCount })),
      uploads: summary.uploads,
      deferred: summary.deferred,
      errorCount,
    };
    if (summary.blob !== undefined) result.blob = summary.blob;
    if (summary.resize !== undefined) result.resize = summary.resize;

    await audit(event, {
      status, fetched: summary.fetched, imported: summary.inserted.length, uploads: summary.uploads,
      deferred: summary.deferred, errorCount,
    });
    // The cron held the run lease, the 1,800 ceiling stopped the run, or the run couldn't be recorded: as in
    // sync_runs, a skipped import with no uploads doesn't use up the day.
    if (!dryRun && status === "skipped" && summary.uploads === 0) await releaseImportSlot();
    res.status(200).json(result);
  }

  return async function instagramSyncHandler(req, res) {
    try {
      await handle(req, res);
    } catch (error) {
      // A rejection the steps above don't answer (the limits read or the claim failing, say): never the raw Error.
      console.error("[admin/instagram] request failed:", describeError(error));
      if (!res.headersSent) res.status(500).json({ error: "server_error" });
    }
  };
}
