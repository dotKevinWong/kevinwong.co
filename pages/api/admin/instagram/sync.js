import { createInstagramSyncHandler, readJsonBody } from "../../../../lib/admin/instagram-sync-route";
import { requireAdmin } from "../../../../lib/admin/guard";
import { checkPanelRunAllowed, claimPanelSlot, releasePanelImportSlot } from "../../../../lib/admin/sync-limits";
import { syncInstagram } from "../../../../lib/instagram-sync";
import { logAdminEvent } from "../../../../lib/admin/audit-log";

// Same ceiling as the cron route; the 60 s budget passed by the handler leaves the
// post already in flight room to finish (spec: "Panel runs get a 60-second budget").
// Body parser off: requireAdmin must answer before any body is read (D1); readJsonBody reads it afterwards.
export const config = { maxDuration: 300, api: { bodyParser: false } };

const handler = createInstagramSyncHandler({
  requireAdmin, readJsonBody, checkPanelRunAllowed, claimPanelSlot, releasePanelImportSlot, syncInstagram, logAdminEvent,
});
export default handler;
