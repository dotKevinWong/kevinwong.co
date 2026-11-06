import { rateLimit } from "./rate-limit.js";

// Kept short because the daily Instagram cron writes to these tables. At the
// previous 30-day s-maxage the edge kept serving a pre-sync body until the next
// production deploy, so new posts were invisible however often the cron ran.
// stale-while-revalidate keeps responses instant while the edge refreshes.
export const SNAPSHOTS_CACHE_HEADER =
  "public, s-maxage=300, stale-while-revalidate=86400";

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function clampInt(input, { min, max, fallback }) {
  const parsed = Number.parseInt(String(input || fallback), 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function normalizeMedia(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((item) => ({
    id: item.id,
    position: Number(item.position || 0),
    kind: item.kind,
    url: item.url,
    publicId: item.publicId,
    width: item.width ? Number(item.width) : null,
    height: item.height ? Number(item.height) : null,
  }));
}

/**
 * Builds one /api/snapshots post from its instagram_posts row and its
 * aggregated instagram_media row ({ mediaCount, slides }, or undefined when the
 * post has no media). "slides" is every slide in position order.
 */
export function toSnapshotPost(row, mediaRow) {
  const slides = normalizeMedia(mediaRow?.slides);

  return {
    id: row.id,
    caption: row.caption || "",
    instagramUrl: row.instagramUrl,
    postedAt: row.postedAt ? new Date(row.postedAt).toISOString() : null,
    mediaCount: Number(mediaRow?.mediaCount || 0),
    slides,
  };
}

/**
 * Answers non-GET requests with 405 and rate-limited ones with 429. Returns
 * true when it has responded, so the route should stop.
 */
export function rejectUnlessGet(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    res.status(405).json({ error: "Method not allowed" });
    return true;
  }

  if (rateLimit(req)) {
    res.status(429).json({ error: "Too many requests" });
    return true;
  }

  return false;
}
