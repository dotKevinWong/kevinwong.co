import { test } from "node:test";
import assert from "node:assert/strict";
import { UPLOAD_CEILING_30D, statusFromSummary, uploadAllowance } from "../lib/sync-runs.js";

test("the 30-day upload ceiling is 1,800", () => assert.equal(UPLOAD_CEILING_30D, 1800));
test("statusFromSummary is ok when nothing went wrong", () =>
  assert.equal(statusFromSummary({ errors: [], skipped: [] }), "ok"));
test("statusFromSummary is ok when only individual posts were skipped", () =>
  assert.equal(statusFromSummary({ errors: [], skipped: [{ id: "B", reason: "no usable media" }] }), "ok"));
test("statusFromSummary is partial when any post failed", () =>
  assert.equal(statusFromSummary({ errors: [{ id: "A", error: "Download failed: HTTP 404" }], skipped: [] }), "partial"));
test("statusFromSummary is skipped when the lease was held", () =>
  assert.equal(statusFromSummary({ leaseHeld: true, errors: [], skipped: [{ id: "run", reason: "another sync is already running" }] }), "skipped"));
test("statusFromSummary is skipped when the ceiling was reached, even with errors", () =>
  assert.equal(statusFromSummary({ ceilingReached: true, errors: [{ id: "A", error: "x" }], skipped: [] }), "skipped"));
test("statusFromSummary is skipped when the run could not be recorded", () =>
  assert.equal(statusFromSummary({ notRecorded: true, errors: [], skipped: [{ id: "run", reason: "run could not be recorded" }] }), "skipped"));
test("uploadAllowance caps maxUploads to what is left under the ceiling", () => {
  assert.equal(uploadAllowance(25, 0), 25);
  assert.equal(uploadAllowance(25, 1790), 10);
  assert.equal(uploadAllowance(500, 1799), 1);
  assert.equal(uploadAllowance(25, 1800), 0);
  assert.equal(uploadAllowance(25, 2400), 0);
});
test("uploadAllowance fails closed when the cap or the count is not a usable number", () => {
  assert.equal(uploadAllowance(NaN, 0), 0);
  assert.equal(uploadAllowance(Infinity, 0), 0);
  assert.equal(uploadAllowance(-1, 0), 0);
  assert.equal(uploadAllowance(25, NaN), 0);
});
