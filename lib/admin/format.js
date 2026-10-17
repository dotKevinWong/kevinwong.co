// How the admin dashboard writes numbers, sizes, durations and dates. Plain ESM
// with no imports, so client components can use it. Dates are always UTC and
// en-US: the Vercel render (UTC) and Kevin's browser (Eastern) then produce the
// same text, so hydration never sees a mismatch.

const DATE_OPTIONS = { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" };
const TIMESTAMP_FORMAT = new Intl.DateTimeFormat("en-US", {
  ...DATE_OPTIONS,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", DATE_OPTIONS);
const COUNT_FORMAT = new Intl.NumberFormat("en-US");

const DAY_MS = 86_400_000;
const UNITS = ["B", "kB", "MB", "GB", "TB"];

const isValidDate = (iso) => iso != null && !Number.isNaN(Date.parse(iso));

/**
 * "37 days left (estimated)". Never a negative day count: a date in the past
 * reads "Past the estimated date" (or "Expired" for a date that isn't an estimate).
 * @param {number | null | undefined} daysLeft
 * @param {{ estimated?: boolean }} [options]
 * @returns {string}
 */
export function daysLeftLabel(daysLeft, { estimated = false } = {}) {
  if (daysLeft === null || daysLeft === undefined) return "Unknown";
  const suffix = estimated ? " (estimated)" : "";
  if (daysLeft < 0) return estimated ? "Past the estimated date" : "Expired";
  if (daysLeft === 0) return `Expires today${suffix}`;
  return `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left${suffix}`;
}

/**
 * Decimal units, to match Vercel Blob's 1 GB limit.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  let value = bytes;
  let unit = 0;
  // Step up while the value would *display* as 1000 or more, so 999_999_999 reads "1 GB", not "1000 MB".
  while (unit < UNITS.length - 1 && Math.round(value * 10) / 10 >= 1000) { value /= 1000; unit += 1; }
  const shown = unit > 0 && value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${shown} ${UNITS[unit]}`;
}

/**
 * @param {number} n
 * @returns {string}
 */
export function formatCount(n) {
  return COUNT_FORMAT.format(n);
}

/**
 * "Oct 16, 2026, 08:27 UTC", or "Never" for null.
 * @param {string | null | undefined} iso
 * @returns {string}
 */
export function formatTimestamp(iso) {
  return isValidDate(iso) ? `${TIMESTAMP_FORMAT.format(new Date(/** @type {string} */ (iso)))} UTC` : "Never";
}

/**
 * "Oct 16, 2026", or "Unknown" for null.
 * @param {string | null | undefined} iso
 * @returns {string}
 */
export function formatDate(iso) {
  return isValidDate(iso) ? DATE_FORMAT.format(new Date(/** @type {string} */ (iso))) : "Unknown";
}

const counted = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * A wait, rounded up: minutes under an hour, hours under 48 hours, then days.
 * @param {number} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes < 60) return counted(minutes, "minute");
  if (minutes < 48 * 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest > 0 ? `${counted(hours, "hour")} ${counted(rest, "minute")}` : counted(hours, "hour");
  }
  return counted(Math.ceil(minutes / 1440), "day");
}

/**
 * value as a percentage of max, clamped to 0..100. A zero max gives 0.
 * @param {number} value
 * @param {number} max
 * @returns {number}
 */
export function percentOf(value, max) {
  if (!(max > 0)) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

/**
 * Whole days from one ISO time to another, or null when either is missing.
 * @param {string | null | undefined} fromIso
 * @param {string | null | undefined} toIso
 * @returns {number | null}
 */
export function daysBetween(fromIso, toIso) {
  if (!isValidDate(fromIso) || !isValidDate(toIso)) return null;
  return Math.round((Date.parse(/** @type {string} */ (toIso)) - Date.parse(/** @type {string} */ (fromIso))) / DAY_MS);
}
