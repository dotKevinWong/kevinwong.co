import { requireAdmin } from "../../../lib/admin/guard";
import { buildAdminStatus, createStatusHandler } from "../../../lib/admin/status";

// Body parser off: nothing may answer before requireAdmin's 404 gate (D1), and this route never reads a body.
export const config = { api: { bodyParser: false } };

const handler = createStatusHandler({ requireAdmin, buildAdminStatus });
export default handler;
