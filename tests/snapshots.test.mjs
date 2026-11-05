import { test } from "node:test";
import assert from "node:assert/strict";

import { toSnapshotPost } from "../lib/snapshots.js";

const POST_ROW = {
  id: "0b8a3c1e-1f2a-4b3c-8d4e-5f6a7b8c9d0e",
  caption: "Lake day",
  instagramUrl: "https://www.instagram.com/p/abc/",
  postedAt: new Date("2024-06-01T12:00:00Z"),
};

const slide = (position, extra = {}) => ({
  id: `m${position}`,
  position,
  kind: "image",
  url: `https://blob.example/${position}.jpg`,
  publicId: `snapshots/${position}.jpg`,
  width: 1440,
  height: 1920,
  ...extra,
});

test("toSnapshotPost returns every slide and keeps media as slide 0 only", () => {
  const post = toSnapshotPost(POST_ROW, {
    postId: POST_ROW.id,
    mediaCount: 3,
    slides: [slide(0), slide(1, { kind: "video", width: null, height: null }), slide(2)],
  });

  assert.deepEqual(Object.keys(post), [
    "id", "caption", "instagramUrl", "postedAt", "mediaCount", "media", "slides",
  ]);
  assert.equal(post.postedAt, "2024-06-01T12:00:00.000Z");
  assert.equal(post.mediaCount, 3);
  assert.deepEqual(post.media, [slide(0)]);
  assert.deepEqual(post.slides.map((s) => s.position), [0, 1, 2]);
  assert.deepEqual(post.slides[1], slide(1, { kind: "video", width: null, height: null }));
});

test("toSnapshotPost gives a post without media an empty shape", () => {
  const post = toSnapshotPost({ ...POST_ROW, caption: null, postedAt: null }, undefined);

  assert.equal(post.caption, "");
  assert.equal(post.postedAt, null);
  assert.equal(post.mediaCount, 0);
  assert.deepEqual(post.media, []);
  assert.deepEqual(post.slides, []);
});

test("toSnapshotPost leaves media empty when slide 0 is missing", () => {
  const post = toSnapshotPost(POST_ROW, { mediaCount: 1, slides: [slide(1)] });

  assert.deepEqual(post.media, []);
  assert.deepEqual(post.slides, [slide(1)]);
});
