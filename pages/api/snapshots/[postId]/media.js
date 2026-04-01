import { getDbPool } from "../../../../lib/db";
import { UUID_REGEX, clampInt, normalizeMedia } from "../../../../lib/snapshots";
import { rateLimit } from "../../../../lib/rate-limit";

const CACHE_HEADER =
  "public, s-maxage=2592000, stale-while-revalidate=86400";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (rateLimit(req)) {
    return res.status(429).json({ error: "Too many requests" });
  }

  const postId = String(req.query.postId || "");
  const position = clampInt(req.query.position, { min: 0, max: Infinity, fallback: 0 });
  const limit = clampInt(req.query.limit, { min: 1, max: 6, fallback: 1 });

  if (!postId) {
    return res.status(400).json({ error: "postId is required" });
  }
  if (!UUID_REGEX.test(postId)) {
    return res.status(400).json({ error: "Invalid postId" });
  }

  try {
    const pool = getDbPool();
    const result = await pool.query(
      `
        select
          m.id,
          m.position,
          m.kind,
          m.cloudinary_url as url,
          m.cloudinary_public_id as "publicId",
          m.cloudinary_width as width,
          m.cloudinary_height as height
        from instagram_media m
        where m.post_id = $1
          and m.position >= $2
        order by m.position asc
        limit $3
      `,
      [postId, position, limit]
    );

    res.setHeader("Cache-Control", CACHE_HEADER);
    return res.status(200).json({ media: normalizeMedia(result.rows) });
  } catch (error) {
    console.error("[api/snapshots/:postId/media]", error);
    return res.status(500).json({ error: "Failed to load media" });
  }
}
