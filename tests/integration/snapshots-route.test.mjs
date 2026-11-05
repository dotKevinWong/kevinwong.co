import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { getDbPool } from "../../lib/db.js";
import { SNAPSHOTS_CACHE_HEADER } from "../../lib/snapshots.js";
import { testDb } from "../helpers/db.mjs";
import { fakeRes } from "../helpers/admin-fakes.mjs";
import "../helpers/resolve-extensionless.mjs";

const db = testDb();
// The route uses getDbPool(): point it at the local test database. tests/helpers/db.mjs has already refused, at
// import, any DATABASE_URL but the test database.
if (!db.skip) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const { default: listHandler } = await import("../../pages/api/snapshots/index.js");
const { default: mediaHandler } = await import("../../pages/api/snapshots/[postId]/media.js");

const POSTS = [
  // Newest first in the response.
  { id: "00000000-0000-4000-8000-000000000003", postedAt: "2024-03-01T00:00:00Z", slides: 3 },
  { id: "00000000-0000-4000-8000-000000000002", postedAt: "2024-02-01T00:00:00Z", slides: 1 },
  { id: "00000000-0000-4000-8000-000000000001", postedAt: "2024-01-01T00:00:00Z", slides: 0 },
];

let ipCounter = 0;
const call = async (handler, query) => {
  const res = fakeRes();
  // A fresh address per call keeps the per-instance rate limiter out of the way.
  await handler({ method: "GET", headers: { "x-forwarded-for": `10.0.0.${++ipCounter}` }, query }, res);
  return res;
};

describe("/api/snapshots (integration)", { skip: db.skip }, () => {
  before(async () => {
    await db.resetSchema();
    for (const post of POSTS) {
      await db.pool.query(
        `insert into instagram_posts (id, source_key, caption, instagram_url, posted_at)
         values ($1, $2, $3, $4, $5)`,
        [post.id, `ig:${post.id}`, `caption ${post.id}`, `https://www.instagram.com/p/${post.id}/`, post.postedAt]
      );
      // Inserted in reverse so the response's order comes from the query, not from insertion.
      for (let position = post.slides - 1; position >= 0; position -= 1) {
        // cloudinary_* still holds different values, to show the routes no longer read it.
        // Slide 1 has no Blob dimensions, which come back as null rather than Cloudinary's.
        const sized = position !== 1;
        await db.pool.query(
          `insert into instagram_media (post_id, position, kind, cloudinary_public_id, cloudinary_url,
             cloudinary_width, cloudinary_height, cloudinary_folder, file_ext, source_uri, source_created_at,
             asset_url, asset_pathname, asset_width, asset_height)
           values ($1, $2, $3, $4, $5, 1080, 1350, 'f', 'jpg', 'https://src.invalid', now(), $6, $7, $8, $9)`,
          [
            post.id, position, position === 1 ? "video" : "image",
            `cld/${post.id}/${position}`, `https://res.cloudinary.invalid/${post.id}/${position}.jpg`,
            `https://blob.invalid/${post.id}/${position}.jpg`,
            `snapshots/${post.id}/${position}.jpg`,
            sized ? 1440 : null, sized ? 1920 : null,
          ]
        );
      }
    }
  });
  after(async () => { await getDbPool().end(); await db.close(); });

  test("returns every slide with each post, and media stays slide 0 only", async () => {
    const res = await call(listHandler, { limit: "3" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["cache-control"], SNAPSHOTS_CACHE_HEADER);
    assert.deepEqual(res.body.pagination, { limit: 3, hasMore: false, nextCursor: null });

    const [carousel, single, empty] = res.body.posts;
    assert.deepEqual(res.body.posts.map((p) => p.id), POSTS.map((p) => p.id));
    assert.deepEqual(Object.keys(carousel),
      ["id", "caption", "instagramUrl", "postedAt", "mediaCount", "media", "slides"]);
    assert.equal(carousel.postedAt, "2024-03-01T00:00:00.000Z");
    assert.equal(carousel.mediaCount, 3);
    assert.deepEqual(carousel.slides.map((s) => s.position), [0, 1, 2]);
    assert.deepEqual(carousel.media, [carousel.slides[0]]);

    // Only the Blob columns are read, even where they are null and cloudinary_* is not.
    assert.equal(carousel.slides[0].url, `https://blob.invalid/${carousel.id}/0.jpg`);
    assert.equal(carousel.slides[0].publicId, `snapshots/${carousel.id}/0.jpg`);
    assert.equal(carousel.slides[0].width, 1440);
    assert.deepEqual(
      { ...carousel.slides[1], id: "x" },
      { id: "x", position: 1, kind: "video", url: `https://blob.invalid/${carousel.id}/1.jpg`,
        publicId: `snapshots/${carousel.id}/1.jpg`, width: null, height: null }
    );

    assert.equal(single.mediaCount, 1);
    assert.deepEqual(single.media, single.slides);
    assert.deepEqual({ mediaCount: empty.mediaCount, media: empty.media, slides: empty.slides },
      { mediaCount: 0, media: [], slides: [] });
  });

  test("each slide matches what [postId]/media returns for that position", async () => {
    const list = await call(listHandler, { limit: "3" });
    const carousel = list.body.posts[0];
    for (const slide of carousel.slides) {
      const res = await call(mediaHandler, { postId: carousel.id, position: String(slide.position), limit: "1" });
      assert.deepEqual(res.body.media, [slide]);
    }
  });

  test("keyset pagination still pages through in order", async () => {
    // limit is clamped to at least 3, so ask for 3 and check the cursor after trimming one post off the end.
    await db.pool.query(
      `insert into instagram_posts (id, source_key, caption, posted_at)
       values ('00000000-0000-4000-8000-000000000000', 'ig:oldest', '', '2023-12-01T00:00:00Z')`
    );
    const first = await call(listHandler, { limit: "3" });
    assert.equal(first.body.pagination.hasMore, true);
    const second = await call(listHandler, { limit: "3", cursor: first.body.pagination.nextCursor });
    assert.deepEqual(second.body.posts.map((p) => p.id), ["00000000-0000-4000-8000-000000000000"]);
    assert.deepEqual(second.body.posts[0].slides, []);
    assert.equal(second.body.pagination.hasMore, false);
  });
});
