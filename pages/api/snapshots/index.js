import { getDbPool } from "../../../lib/db";

const MIN_LIMIT = 3;
const MAX_LIMIT = 12;
const DEFAULT_LIMIT = 6;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clampLimit(input) {
  const parsed = Number.parseInt(String(input || DEFAULT_LIMIT), 10);
  if (Number.isNaN(parsed)) {
    return DEFAULT_LIMIT;
  }

  return Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, parsed));
}

function encodeCursor(cursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(rawCursor) {
  if (!rawCursor) {
    return null;
  }

  try {
    const decodedText = Buffer.from(String(rawCursor), "base64url").toString("utf8");
    const decoded = JSON.parse(decodedText);

    if (!decoded || typeof decoded !== "object") {
      return null;
    }

    if (typeof decoded.id !== "string" || typeof decoded.postedAt !== "string") {
      return null;
    }
    if (!UUID_REGEX.test(decoded.id)) {
      return null;
    }

    const postedAtDate = new Date(decoded.postedAt);
    if (Number.isNaN(postedAtDate.getTime())) {
      return null;
    }

    return {
      id: decoded.id,
      postedAt: postedAtDate.toISOString(),
    };
  } catch {
    return null;
  }
}

function normalizeMedia(media) {
  if (!Array.isArray(media)) {
    return [];
  }

  return media.map((item) => ({
    id: item.id,
    position: Number(item.position || 0),
    kind: item.kind,
    url: item.url,
    publicId: item.publicId,
    width: item.width ? Number(item.width) : null,
    height: item.height ? Number(item.height) : null,
  }));
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const limit = clampLimit(req.query.limit);
  const cursor = decodeCursor(req.query.cursor);

  try {
    const pool = getDbPool();
    const postsResult = await pool.query(
      `
        select
          p.id,
          p.caption,
          p.instagram_url as "instagramUrl",
          p.posted_at as "postedAt"
        from instagram_posts p
        where (
          $1::timestamptz is null
          or (p.posted_at, p.id) < ($1::timestamptz, $2::uuid)
        )
        order by p.posted_at desc, p.id desc
        limit $3
      `,
      [cursor?.postedAt ?? null, cursor?.id ?? null, limit + 1]
    );

    const hasMore = postsResult.rows.length > limit;
    const pageRows = hasMore ? postsResult.rows.slice(0, limit) : postsResult.rows;
    const postIds = pageRows.map((row) => row.id);

    const mediaByPostId = new Map();

    if (postIds.length > 0) {
      const mediaResult = await pool.query(
        `
          select
            m.post_id as "postId",
            count(*)::int as "mediaCount",
            coalesce(
              json_agg(
                json_build_object(
                  'id', m.id,
                  'position', m.position,
                  'kind', m.kind,
                  'url', m.cloudinary_url,
                  'publicId', m.cloudinary_public_id,
                  'width', m.cloudinary_width,
                  'height', m.cloudinary_height
                )
                order by m.position asc
              ) filter (where m.position = 0),
              '[]'::json
            ) as media
          from instagram_media m
          where m.post_id = any($1::uuid[])
          group by m.post_id
        `,
        [postIds]
      );

      mediaResult.rows.forEach((row) => {
        mediaByPostId.set(row.postId, {
          mediaCount: Number(row.mediaCount || 0),
          media: normalizeMedia(row.media),
        });
      });
    }

    const posts = pageRows.map((row) => {
      const mediaPayload = mediaByPostId.get(row.id) || { mediaCount: 0, media: [] };

      return {
        id: row.id,
        caption: row.caption || "",
        instagramUrl: row.instagramUrl,
        postedAt: row.postedAt ? new Date(row.postedAt).toISOString() : null,
        mediaCount: mediaPayload.mediaCount,
        media: mediaPayload.media,
      };
    });

    const lastPost = posts[posts.length - 1];
    const nextCursor = hasMore && lastPost
      ? encodeCursor({ id: lastPost.id, postedAt: lastPost.postedAt })
      : null;

    res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=300");
    return res.status(200).json({
      posts,
      pagination: {
        limit,
        hasMore,
        nextCursor,
      },
    });
  } catch (error) {
    console.error("[api/snapshots]", error);
    return res.status(500).json({ error: "Failed to load snapshots" });
  }
}
