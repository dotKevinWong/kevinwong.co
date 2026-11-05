// The panel's own run limits (D4), enforced by lib/admin/sync-limits.js. No imports, so client code
// (lib/admin/messages.js) can build its text from the same numbers: sync-limits.js imports the database pool.

export const CHECK_MIN_GAP_MINUTES = 10;
export const IMPORT_WINDOW_HOURS = 24;
export const PANEL_UPLOAD_CEILING_30D = 1000;
