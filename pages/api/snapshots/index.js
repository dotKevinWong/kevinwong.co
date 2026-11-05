import { getDbPool } from "../../../lib/db";
import { SNAPSHOTS_CACHE_HEADER, UUID_REGEX, clampInt, rejectUnlessGet, toSnapshotPost } from "../../../lib/snapshots";

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

export default async function handler(req, res) {
  if (rejectUnlessGet(req, res)) return;

  const limit = clampInt(req.query.limit, { min: 3, max: 12, fallback: 6 });
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
                  'url', m.asset_url,
                  'publicId', m.asset_pathname,
                  'width', m.asset_width,
                  'height', m.asset_height
                )
                order by m.position asc
              ),
              '[]'::json
            ) as slides
          from instagram_media m
          where m.post_id = any($1::uuid[])
          group by m.post_id
        `,
        [postIds]
      );

      mediaResult.rows.forEach((row) => {
        mediaByPostId.set(row.postId, row);
      });
    }

    // Every slide comes with the list, so the carousel never waits on
    // [postId]/media. "media" stays slide 0 only, as before, for bundles that
    // were built against that shape.
    const posts = pageRows.map((row) => toSnapshotPost(row, mediaByPostId.get(row.id)));

    const lastPost = posts[posts.length - 1];
    const nextCursor = hasMore && lastPost
      ? encodeCursor({ id: lastPost.id, postedAt: lastPost.postedAt })
      : null;

    res.setHeader("Cache-Control", SNAPSHOTS_CACHE_HEADER);
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
