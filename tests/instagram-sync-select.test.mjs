import { test } from "node:test";
import assert from "node:assert/strict";
import { selectMissing } from "../lib/instagram-sync.js";
import { PANEL_CHECK_SLOT, PANEL_IMPORT_SLOT, SYNC_LEASE } from "../lib/job-locks.js";

// One API media object, as fetchRecentMedia returns it.
const post = (shortcode, timestamp, extra = {}) => ({
  id: `id-${shortcode}`,
  media_type: "IMAGE",
  media_url: `https://cdn.test/${shortcode}.jpg`,
  permalink: `https://www.instagram.com/p/${shortcode}/`,
  timestamp,
  ...extra,
});

test("selectMissing returns the posts not yet stored, oldest first", () => {
  const raw = [post("NEWEST", "2026-10-03T00:00:00Z"), post("OLDEST", "2026-10-01T00:00:00Z"), post("MIDDLE", "2026-10-02T00:00:00Z")];
  const r = selectMissing(raw, new Set());
  assert.deepEqual(r.missing.map((p) => p.shortcode), ["OLDEST", "MIDDLE", "NEWEST"]);
  assert.deepEqual([r.alreadyPresent, r.invalid, r.beforeStart], [0, [], []]);
});

test("selectMissing counts a stored post as already present and leaves it out", () => {
  const raw = [post("STORED", "2026-10-01T00:00:00Z"), post("FRESH", "2026-10-02T00:00:00Z")];
  const r = selectMissing(raw, new Set(["ig:STORED"]));
  assert.deepEqual(r.missing.map((p) => p.sourceKey), ["ig:FRESH"]);
  assert.equal(r.alreadyPresent, 1);
});

test("selectMissing normalizes each post: key, caption, date and media", () => {
  const [p] = selectMissing([post("ABC", "2026-10-01T00:00:00Z", { caption: "hi" })], new Set()).missing;
  assert.equal(p.shortcode, "ABC");
  assert.equal(p.sourceKey, "ig:ABC");
  assert.equal(p.caption, "hi");
  assert.equal(p.postedAt.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.deepEqual(p.media.map((m) => [m.position, m.kind, m.url]), [[0, "image", "https://cdn.test/ABC.jpg"]]);
  // A post with no caption gets "".
  assert.equal(selectMissing([post("NOCAP", "2026-10-01T00:00:00Z")], new Set()).missing[0].caption, "");
});

test("selectMissing skips, in order, a post with no shortcode and one with no usable timestamp", () => {
  const raw = [
    post("GOOD", "2026-10-01T00:00:00Z"),
    { id: "no-link", media_type: "IMAGE", timestamp: "2026-10-01T00:00:00Z" },
    post("NODATE", undefined),
    post("BADDATE", "not a date"),
  ];
  const r = selectMissing(raw, new Set());
  assert.deepEqual(r.invalid, [
    { id: "no-link", reason: "no permalink/shortcode" },
    { id: "id-NODATE", reason: "missing timestamp" },
    { id: "id-BADDATE", reason: "missing timestamp" },
  ]);
  assert.deepEqual(r.missing.map((p) => p.shortcode), ["GOOD"]);
  assert.equal(r.alreadyPresent, 0);
});

test("selectMissing skips a missing post from before 2022, but counts a stored one as present", () => {
  const raw = [post("OLD", "2021-12-31T23:59:59Z"), post("OLDSTORED", "2019-05-01T00:00:00Z"), post("EDGE", "2022-01-01T00:00:00Z")];
  const r = selectMissing(raw, new Set(["ig:OLDSTORED"]));
  assert.deepEqual(r.beforeStart, [{ id: "OLD", reason: "before the /snapshots start date (2022-01-01)" }]);
  assert.deepEqual(r.missing.map((p) => p.shortcode), ["EDGE"]);
  assert.equal(r.alreadyPresent, 1);
});

test("selectMissing does not change its input", () => {
  const raw = [post("B", "2026-10-02T00:00:00Z"), post("A", "2026-10-01T00:00:00Z")];
  const copy = structuredClone(raw);
  const keys = new Set(["ig:X"]);
  selectMissing(raw, keys);
  assert.deepEqual(raw, copy);
  assert.deepEqual([...keys], ["ig:X"]);
});

test("the job_locks names are the ones production's rows use", () => {
  assert.equal(SYNC_LEASE, "instagram-sync");
  assert.equal(PANEL_CHECK_SLOT, "instagram-panel-check");
  assert.equal(PANEL_IMPORT_SLOT, "instagram-panel-import");
});
