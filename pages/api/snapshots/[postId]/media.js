import { getDbPool } from "../../../../lib/db";
import { SNAPSHOTS_CACHE_HEADER, UUID_REGEX, clampInt, normalizeMedia, rejectUnlessGet } from "../../../../lib/snapshots";

export default async function handler(req, res) {
  if (rejectUnlessGet(req, res)) return;

  const postId = String(req.query.postId || "");
  // Needs a finite ceiling: an unbounded parse reaches Postgres as "1e+21" or
  // past the integer range, and the query fails with a 500. Carousels top out
  // around 20 slides, so anything clamped to 1000 simply returns no media.
  const position = clampInt(req.query.position, { min: 0, max: 1000, fallback: 0 });
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
          m.asset_url as url,
          m.asset_pathname as "publicId",
          m.asset_width as width,
          m.asset_height as height
        from instagram_media m
        where m.post_id = $1
          and m.position >= $2
        order by m.position asc
        limit $3
      `,
      [postId, position, limit]
    );

    res.setHeader("Cache-Control", SNAPSHOTS_CACHE_HEADER);
    return res.status(200).json({ media: normalizeMedia(result.rows) });
  } catch (error) {
    console.error("[api/snapshots/:postId/media]", error);
    return res.status(500).json({ error: "Failed to load media" });
  }
}
