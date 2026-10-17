import { test } from "node:test";
import assert from "node:assert/strict";
import { daysBetween, daysLeftLabel, formatBytes, formatCount, formatDate, formatDuration, formatTimestamp, percentOf }
  from "../../lib/admin/format.js";

test("daysLeftLabel counts down and never shows a negative day count", () => {
  assert.equal(daysLeftLabel(37, { estimated: true }), "37 days left (estimated)");
  assert.equal(daysLeftLabel(1, { estimated: true }), "1 day left (estimated)");
  assert.equal(daysLeftLabel(0, { estimated: true }), "Expires today (estimated)");
  assert.equal(daysLeftLabel(-3, { estimated: true }), "Past the estimated date");
  assert.equal(daysLeftLabel(12), "12 days left");
  assert.equal(daysLeftLabel(-3), "Expired");
  assert.equal(daysLeftLabel(null), "Unknown");
});

test("formatBytes uses decimal units to match the 1 GB store", () => {
  const cases = [[0, "0 B"], [999, "999 B"], [1_500, "1.5 kB"], [1_000_000, "1 MB"], [12_345_678, "12 MB"],
    [734_003_200, "734 MB"], [999_499_999, "999 MB"], [999_999_999, "1 GB"], [1_000_000_000, "1 GB"]];
  for (const [bytes, label] of cases) assert.equal(formatBytes(bytes), label, `formatBytes(${bytes})`);
});

test("formatCount groups thousands", () => {
  assert.equal(formatCount(2000), "2,000");
  assert.equal(formatCount(0), "0");
});

test("formatTimestamp and formatDate render UTC whatever the machine's zone", () => {
  assert.equal(formatTimestamp("2026-10-16T08:27:45.123Z"), "Oct 16, 2026, 08:27 UTC");
  assert.equal(formatTimestamp("2026-01-05T00:03:00.000Z"), "Jan 5, 2026, 00:03 UTC");
  assert.equal(formatTimestamp(null), "Never");
  assert.equal(formatDate("2026-10-16T23:59:59.000Z"), "Oct 16, 2026");
  assert.equal(formatDate(null), "Unknown");
});

test("formatDuration rounds up to minutes, then hours, then days", () => {
  const cases = [[0, "1 minute"], [30, "1 minute"], [61, "2 minutes"], [420, "7 minutes"], [3_600, "1 hour"],
    [5_400, "1 hour 30 minutes"], [50_400, "14 hours"], [86_399, "24 hours"], [172_800, "2 days"], [259_200, "3 days"]];
  for (const [seconds, label] of cases) assert.equal(formatDuration(seconds), label, `formatDuration(${seconds})`);
});

test("percentOf clamps to 0..100 and survives a zero max", () => {
  assert.equal(percentOf(500, 2000), 25);
  assert.equal(percentOf(2500, 2000), 100);
  assert.equal(percentOf(-3, 180), 0);
  assert.equal(percentOf(5, 0), 0);
});

test("daysBetween counts whole days", () => {
  assert.equal(daysBetween("2026-10-16T09:00:00.000Z", "2027-04-14T09:00:00.000Z"), 180);
  assert.equal(daysBetween(null, "2027-04-14T09:00:00.000Z"), null);
});
