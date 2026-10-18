import { test } from "node:test";
import assert from "node:assert/strict";
import fetcher from "../lib/fetcher.js";

// The SWR fetcher behind the dashboard's status poll and the public widgets. The dashboard's onError rule
// (isSignedOutError in lib/admin/client.js) reads the status this puts on the error.
test("fetcher resolves a 2xx response to its JSON", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ generatedAt: "2026-10-18T00:00:00.000Z" }));
  assert.deepEqual(await fetcher("/api/admin/status"), { generatedAt: "2026-10-18T00:00:00.000Z" });
});

test("fetcher rejects any other response with its HTTP status on the error", async (t) => {
  for (const status of [401, 403, 404, 500, 502]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ error: "x" }, { status }));
    await assert.rejects(fetcher("/api/admin/status"), (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.status, status);
      assert.equal(error.message, `Request to /api/admin/status failed with ${status}`);
      return true;
    }, String(status));
  }
});
