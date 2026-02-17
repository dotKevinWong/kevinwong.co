import { getDbPool } from "../../../../lib/db";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clampStartPosition(input) {
  const parsed = Number.parseInt(String(input || 0), 10);
  if (Number.isNaN(parsed)) {
    return 0;
  }

  return Math.max(0, parsed);
}

function clampLimit(input) {
  const parsed = Number.parseInt(String(input || 1), 10);
  if (Number.isNaN(parsed)) {
    return 1;
  }

  return Math.max(1, Math.min(6, parsed));
}

function normalizeRows(rows) {
  return rows.map((row) => ({
    id: row.id,
    position: Number(row.position || 0),
    kind: row.kind,
    url: row.url,
    publicId: row.publicId,
    width: row.width ? Number(row.width) : null,
    height: row.height ? Number(row.height) : null,
  }));
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const postId = String(req.query.postId || "");
  const position = clampStartPosition(req.query.position);
  const limit = clampLimit(req.query.limit);

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

    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ media: normalizeRows(result.rows) });
  } catch (error) {
    console.error("[api/snapshots/:postId/media]", error);
    return res.status(500).json({ error: "Failed to load media" });
  }
}
