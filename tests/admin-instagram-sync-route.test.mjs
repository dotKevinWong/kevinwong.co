import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createInstagramSyncHandler, readJsonBody } from "../lib/admin/instagram-sync-route.js";
import { OWNER_ACTOR } from "../lib/admin/audit-log.js";
import { InstagramReauthRequiredError } from "../lib/instagram.js";
import { fakeReq, fakeRes, withEnv } from "./helpers/admin-fakes.mjs";
import "./helpers/resolve-extensionless.mjs";

const OWNER = { userId: "user-1", name: "Kevin Wong", image: null, expiresAt: new Date("2026-10-17T12:00:00Z") };
const PANEL_OPTIONS = { trigger: "panel", maxPosts: 50, maxUploads: 25, timeBudgetMs: 60_000 };

const summary = (o = {}) => ({ dryRun: true, startDate: "2022-01-01T00:00:00.000Z", fetched: 0, alreadyPresent: 0,
  skipped: [], inserted: [], uploads: 0, deferred: 0, warnings: [], errors: [], ...o });
const post = (body) => ({ method: "POST", headers: { origin: "https://www.kevinwong.co" }, body });
// fakeRes that adds "respond" to calls.order when the handler sends, so a test can check the response goes last.
const trackedRes = (calls) => {
  const res = fakeRes();
  for (const m of ["json", "end"]) {
    const send = res[m];
    res[m] = function (...args) { calls.order.push("respond"); return send.apply(this, args); };
  }
  return res;
};

// `allowed` answers the first checkPanelRunAllowed call; `recheck` answers the one a thrown import makes afterwards.
function setup({ owner = async () => OWNER, allowed = { allowed: true }, recheck = { allowed: true },
  claim = { claimed: true }, sync = async () => summary(), log = async () => {} } = {}) {
  const calls = { requireAdmin: [], read: 0, check: [], claim: [], release: 0, sync: [], log: [] };
  const handler = createInstagramSyncHandler({
    requireAdmin: async (req, res, opts) => { calls.requireAdmin.push(opts); return owner(req, res); },
    readJsonBody: async (req) => { calls.read += 1; return req.body; },
    checkPanelRunAllowed: async (args) => { calls.check.push(args); calls.order.push("check"); return calls.check.length === 1 ? allowed : recheck; },
    claimPanelSlot: async (args) => { calls.claim.push(args); return claim; },
    releasePanelImportSlot: async () => { calls.release += 1; calls.order.push("release"); },
    syncInstagram: async (opts) => { calls.sync.push(opts); return sync(opts); },
    logAdminEvent: async (event, opts) => { calls.log.push([event, opts]); calls.order.push("log"); return log(); },
  });
  calls.order = []; // "check", "log", "release", and "respond" from trackedRes, as they happen
  return { handler, calls };
}

test("asks requireAdmin for the mutation guard", async () => {
  const { handler, calls } = setup();
  await handler(post({ dryRun: true }), fakeRes());
  assert.deepEqual(calls.requireAdmin, [{ mutation: true }]);
});

test("passes requireAdmin's 403 through and does nothing else", async () => {
  const { handler, calls } = setup({ owner: async (req, res) => { res.status(403).json({ error: "bad_origin" }); return null; } });
  const res = fakeRes();
  await handler(post({ dryRun: true }), res);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: "bad_origin" });
  assert.equal(calls.check.length + calls.sync.length + calls.log.length + calls.read, 0); // the body is never read
});

test("405 with Allow: POST for GET", async () => {
  const { handler, calls } = setup();
  const res = fakeRes();
  await handler({ method: "GET", headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, "POST");
  assert.deepEqual(res.body, { error: "method_not_allowed" });
  assert.equal(calls.sync.length + calls.read, 0);
});

for (const body of [undefined, null, {}, { dryRun: "yes" }, { dryRun: 1 }, [true], "dryRun=true"]) {
  test(`400 bad_request for body ${JSON.stringify(body)}`, async () => {
    const { handler, calls } = setup();
    const res = fakeRes();
    await handler(post(body), res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: "bad_request" });
    assert.equal(calls.check.length + calls.claim.length + calls.sync.length, 0);
  });
}

test("readJsonBody parses a small JSON body and gives undefined for anything else", async () => {
  const stream = (text, type = "application/json") =>
    Object.assign(Readable.from([Buffer.from(text)]), { headers: { "content-type": type } });
  assert.deepEqual(await readJsonBody(stream('{"dryRun":true}')), { dryRun: true });
  assert.deepEqual(await readJsonBody(stream('{"dryRun":false}', "application/json; charset=utf-8")), { dryRun: false });
  assert.equal(await readJsonBody(stream("{oops")), undefined);
  assert.equal(await readJsonBody(stream('{"dryRun":true}', "text/plain")), undefined);
  assert.equal(await readJsonBody(stream("")), undefined);
  assert.equal(await readJsonBody(stream(`{"pad":"${"x".repeat(1100)}"}`)), undefined);
});

test("extra keys are ignored: the server fixes every other parameter", async () => {
  const { handler, calls } = setup({ sync: async () => summary({ dryRun: false }) });
  await handler(post({ dryRun: false, maxUploads: 1000, maxPosts: 999, timeBudgetMs: 0, trigger: "cron" }), fakeRes());
  assert.deepEqual(calls.check, [{ dryRun: false }]);
  assert.deepEqual(calls.claim, [{ dryRun: false }]);
  assert.deepEqual(calls.sync, [{ ...PANEL_OPTIONS, dryRun: false }]);
});

test("429 with reason, retryAfterSeconds, Retry-After and a panel_run_refused event", async () => {
  const { handler, calls } = setup({ allowed: { allowed: false, reason: "too_soon", retryAfterSeconds: 120 } });
  const res = fakeRes();
  await handler(post({ dryRun: true }), res);
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body, { error: "too_soon", retryAfterSeconds: 120 });
  assert.equal(res.headers["retry-after"], "120");
  assert.deepEqual(calls.log, [["panel_run_refused",
    { actor: OWNER_ACTOR, details: { dryRun: true, reason: "too_soon", retryAfterSeconds: 120 } }]]);
  assert.equal(calls.claim.length + calls.sync.length, 0); // refused before the slot is claimed
});

for (const [dryRun, reason] of [[true, "too_soon"], [false, "daily_limit"]]) {
  test(`429 ${reason} when another request already holds the ${dryRun ? "check" : "import"} slot`, async () => {
    const { handler, calls } = setup({ claim: { claimed: false, retryAfterSeconds: 42 } });
    const res = fakeRes();
    await handler(post({ dryRun }), res);
    assert.equal(res.statusCode, 429);
    assert.deepEqual(res.body, { error: reason, retryAfterSeconds: 42 });
    assert.equal(res.headers["retry-after"], "42");
    assert.deepEqual(calls.check, [{ dryRun }]);
    assert.deepEqual(calls.claim, [{ dryRun }]);
    assert.deepEqual(calls.log, [["panel_run_refused",
      { actor: OWNER_ACTOR, details: { dryRun, reason, retryAfterSeconds: 42 } }]]);
    assert.equal(calls.sync.length + calls.release, 0);
  });
}

test("200 for a check: posts carry shortcode, postedAt and mediaCount only", async () => {
  const { handler, calls } = setup({ sync: async () => summary({
    fetched: 12, alreadyPresent: 11, uploads: 3, blob: "ok", resize: "ok (sharp 0.35.4, libvips 8.17.2)",
    inserted: [{ shortcode: "DAbc123", postedAt: "2026-10-15T10:00:00.000Z", mediaCount: 3, caption: "secret caption", dryRun: true }],
  }) });
  const res = trackedRes(calls);
  await handler(post({ dryRun: true }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    status: "ok", fetched: 12, alreadyPresent: 11,
    posts: [{ shortcode: "DAbc123", postedAt: "2026-10-15T10:00:00.000Z", mediaCount: 3 }],
    uploads: 3, deferred: 0, errorCount: 0, blob: "ok", resize: "ok (sharp 0.35.4, libvips 8.17.2)",
  });
  assert.ok(!JSON.stringify(res.body).includes("secret caption"));
  assert.deepEqual(calls.sync, [{ ...PANEL_OPTIONS, dryRun: true }]);
  assert.deepEqual(calls.log, [["instagram_check",
    { actor: OWNER_ACTOR, details: { status: "ok", fetched: 12, imported: 1, uploads: 3, deferred: 0, errorCount: 0 } }]]);
  assert.deepEqual(calls.order, ["check", "log", "respond"]); // the response goes last
});

test("200 for an import: partial status, no blob or resize keys", async () => {
  const { handler, calls } = setup({ sync: async () => summary({ dryRun: false, fetched: 5, uploads: 2, deferred: 1,
    inserted: [{ shortcode: "DXyz", postedAt: "2026-10-14T09:00:00.000Z", mediaCount: 2, caption: "hi" }],
    errors: [{ id: "179", error: "upload failed" }] }) });
  const res = fakeRes();
  await handler(post({ dryRun: false }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, "partial");
  assert.equal(res.body.errorCount, 1);
  assert.equal("blob" in res.body, false);
  assert.equal("resize" in res.body, false);
  assert.equal(calls.log[0][0], "instagram_import");
});

test("503 instagram_reauth_required, audited as reauth_required", async (t) => {
  t.mock.method(console, "error", () => {});
  const { handler, calls } = setup({ sync: async () => { throw new InstagramReauthRequiredError("dead"); } });
  const res = fakeRes();
  await handler(post({ dryRun: true }), res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: "instagram_reauth_required" });
  assert.deepEqual(calls.log, [["instagram_check", { actor: OWNER_ACTOR, details: { status: "reauth_required" } }]]);
});

test("500 sync_failed for any other error, message not echoed and logged only redacted", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const { handler, calls } = setup({ sync: async () => { throw new Error("connect postgres://kw:hunter2@db.example failed"); } });
  const res = fakeRes();
  await handler(post({ dryRun: false }), res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: "sync_failed" });
  assert.deepEqual(calls.log, [["instagram_import", { actor: OWNER_ACTOR, details: { status: "failed" } }]]);
  const lines = logged.mock.calls.map((c) => c.arguments.map(String).join(" "));
  assert.ok(lines.some((l) => l.includes("postgres://[redacted]@db.example")), lines.join("\n"));
  assert.ok(lines.every((l) => !l.includes("hunter2")), lines.join("\n"));
});

test("an import that ends skipped with 0 uploads releases the import slot; ok and partial imports keep it", async () => {
  const skipped = setup({ sync: async () => summary({ dryRun: false, leaseHeld: true,
    skipped: [{ id: "run", reason: "another sync is already running" }] }) });
  const res = trackedRes(skipped.calls);
  await skipped.handler(post({ dryRun: false }), res);
  assert.equal(res.body.status, "skipped");
  assert.equal(skipped.calls.release, 1);
  assert.deepEqual(skipped.calls.order, ["check", "log", "release", "respond"]);
  for (const o of [{}, { errors: [{ id: "179", error: "upload failed" }] }]) { // ok with 0 uploads, then partial
    const kept = setup({ sync: async () => summary({ dryRun: false, ...o }) });
    await kept.handler(post({ dryRun: false }), fakeRes());
    assert.equal(kept.calls.release, 0);
  }
});

test("a thrown import frees the import slot only when sync_runs no longer counts it", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const error of [new Error("Graph timeout"), new InstagramReauthRequiredError("dead")]) {
    const fail = async () => { throw error; };
    // Recorded failed or reauth_required with 0 uploads: the second read no longer reports daily_limit.
    for (const recheck of [{ allowed: true }, { allowed: false, reason: "upload_ceiling", retryAfterSeconds: 3600 }]) {
      const freed = setup({ sync: fail, recheck });
      await freed.handler(post({ dryRun: false }), trackedRes(freed.calls));
      assert.deepEqual(freed.calls.check, [{ dryRun: false }, { dryRun: false }]);
      assert.equal(freed.calls.release, 1);
      assert.deepEqual(freed.calls.order, ["check", "log", "check", "release", "respond"]);
    }
    // Uploads before the throw, or a row still marked running, keep the import counted, so the slot stays claimed.
    const kept = setup({ sync: fail, recheck: { allowed: false, reason: "daily_limit", retryAfterSeconds: 86_000 } });
    await kept.handler(post({ dryRun: false }), fakeRes());
    assert.equal(kept.calls.release, 0);
  }
  // A check never releases anything and makes no second read.
  const check = setup({ sync: async () => { throw new Error("Graph timeout"); } });
  await check.handler(post({ dryRun: true }), fakeRes());
  assert.equal(check.calls.check.length, 1);
  assert.equal(check.calls.release, 0);
});

test("a failed audit write does not change the response", async (t) => {
  t.mock.method(console, "error", () => {});
  const { handler } = setup({ log: async () => { throw new Error("db down"); } });
  const res = fakeRes();
  await handler(post({ dryRun: true }), res);
  assert.equal(res.statusCode, 200);
});

// Controller notes (Task 14): a rejection the handler has no answer for is one describeError line and a 500,
// never the Error object, its stack or pg's err.detail.
const LEAKY_MESSAGE = "password authentication failed for postgresql://kw_owner:npg_hunter2@db.example.test/neondb";
const REDACTED_LINE = "Error [28P01]: password authentication failed for postgresql://[redacted]@db.example.test/neondb";
const leakyError = () =>
  Object.assign(new Error(LEAKY_MESSAGE), { code: "28P01", detail: "Key (refresh_token)=(detail-secret)" });

// Every dependency answers normally except `name`, which rejects with leakyError().
function rejecting(name) {
  const calls = { sync: 0, release: 0, log: 0 };
  const deps = {
    requireAdmin: async () => OWNER,
    readJsonBody: async (req) => req.body,
    checkPanelRunAllowed: async () => ({ allowed: true }),
    claimPanelSlot: async () => ({ claimed: true }),
    releasePanelImportSlot: async () => { calls.release += 1; },
    syncInstagram: async () => { calls.sync += 1; return summary({ dryRun: false }); },
    logAdminEvent: async () => { calls.log += 1; },
    [name]: async () => { throw leakyError(); },
  };
  return { handler: createInstagramSyncHandler(deps), calls };
}

for (const name of ["requireAdmin", "readJsonBody", "checkPanelRunAllowed", "claimPanelSlot"]) {
  test(`a rejecting ${name} is one redacted line and a 500 server_error`, async (t) => {
    const consoleError = t.mock.method(console, "error", () => {});
    const { handler, calls } = rejecting(name);
    const res = fakeRes();
    await handler(post({ dryRun: false }), res);
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: "server_error" });
    assert.deepEqual(consoleError.mock.calls.map((c) => c.arguments), [["[admin/instagram] request failed:", REDACTED_LINE]]);
    assert.equal(calls.sync + calls.release + calls.log, 0, "no run, no release, no audit row");
  });
}

test("a rejection after the response has gone out is logged and nothing more is sent", async (t) => {
  const consoleError = t.mock.method(console, "error", () => {});
  const { handler } = rejecting("checkPanelRunAllowed");
  const res = Object.assign(fakeRes(), { headersSent: true });
  await handler(post({ dryRun: true }), res);
  assert.equal(res.ended, false);
  assert.equal(res.body, undefined);
  assert.deepEqual(consoleError.mock.calls.map((c) => c.arguments), [["[admin/instagram] request failed:", REDACTED_LINE]]);
});

// The real pages/api/admin/instagram/sync.js, loaded through tests/helpers/resolve-extensionless.mjs, with no
// injected deps, no auth configuration and no database.
const route = await import("../pages/api/admin/instagram/sync.js");
const NO_STORE = "private, no-store, max-age=0, must-revalidate";
const NO_AUTH_ENV = {
  VERCEL_ENV: undefined, NODE_ENV: undefined, DATABASE_URL: undefined,
  BETTER_AUTH_URL: undefined, BETTER_AUTH_SECRET: undefined, GITHUB_CLIENT_ID: undefined, GITHUB_CLIENT_SECRET: undefined,
};

test("the sync route turns the body parser off and sets the 300 s ceiling", () => {
  assert.deepEqual(route.config, { maxDuration: 300, api: { bodyParser: false } });
});

test("the sync route 404s every method outside production or off www, before reading the body", (t) =>
  withEnv(NO_AUTH_ENV, async () => {
    const consoleError = t.mock.method(console, "error", () => {});
    const consoleWarn = t.mock.method(console, "warn", () => {});
    for (const [vercelEnv, host] of [[undefined, "www.kevinwong.co"], ["preview", "www.kevinwong.co"],
      ["development", "www.kevinwong.co"], ["production", "kevinwong.co"], ["production", "kevinwong-co.vercel.app"]]) {
      if (vercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = vercelEnv;
      for (const method of ["GET", "POST", "PUT", "DELETE"]) {
        const label = `${vercelEnv} ${host} ${method}`;
        const req = Object.assign(Readable.from([Buffer.from('{"dryRun":false}')]),
          fakeReq({ method, host, origin: "https://www.kevinwong.co", url: "/api/admin/instagram/sync" }));
        req.headers["content-type"] = "application/json";
        const res = fakeRes();
        await route.default(req, res);
        assert.equal(res.statusCode, 404, label);
        assert.deepEqual(res.body, { error: "not_found" }, label);
        assert.equal(res.getHeader("Cache-Control"), NO_STORE, label);
        assert.equal(req.readableDidRead, false, `${label}: the body was never read`);
      }
    }
    // Reaching Better Auth or the pool here would throw (no configuration, no DATABASE_URL) and log a line.
    assert.equal(consoleError.mock.callCount() + consoleWarn.mock.callCount(), 0, "nothing was logged");
  }));
