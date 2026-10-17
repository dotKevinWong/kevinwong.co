import { describe, test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "../helpers/db.mjs";
import { ADMIN_EVENTS, OWNER_ACTOR, logAdminEvent, logRejectedSignIn, recentAdminEvents, refusedSignInSummary } from "../../lib/admin/audit-log.js";
import { redact } from "../../lib/redact.js";

const db = testDb();
const rows = async () => (await db.pool.query("select event, actor, details from admin_audit_log order by id")).rows;

test("logAdminEvent rejects an unknown event before touching the database", async () => {
  assert.deepEqual([...ADMIN_EVENTS], ["sign_in", "sign_in_rejected", "spotify_connected", "spotify_connect_failed", "instagram_check", "instagram_import", "panel_run_refused"]);
  assert.equal(OWNER_ACTOR, "github:1741711");
  let queries = 0;
  const fake = { async query() { queries += 1; return { rowCount: 1, rows: [] }; } };
  await assert.rejects(logAdminEvent("deleted_everything", {}, fake), TypeError);
  assert.equal(queries, 0);
});

describe("admin audit log", { skip: db.skip }, () => {
  before(() => db.resetSchema());
  beforeEach(() => db.pool.query("truncate admin_audit_log restart identity"));
  after(() => db.close());

  test("logAdminEvent stores the event, actor and redacted details", async () => {
    const details = {
      reason: "Bearer abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH",
      url: "https://accounts.spotify.com/api/token?code=AQBsecretcode&state=x",
    };
    await logAdminEvent("spotify_connect_failed", { actor: OWNER_ACTOR, details }, db.pool);
    const [row] = await rows();
    assert.equal(row.event, "spotify_connect_failed");
    assert.equal(row.actor, "github:1741711");
    assert.deepEqual(row.details, redact(details));
    assert.ok(!JSON.stringify(row.details).includes("abcdefghijklmnopqrstuvwxyz"));
    assert.ok(!JSON.stringify(row.details).includes("AQBsecretcode"));
  });

  test("logAdminEvent defaults actor to null and details to {}", async () => {
    await logAdminEvent("sign_in", undefined, db.pool);
    assert.deepEqual(await rows(), [{ event: "sign_in", actor: null, details: {} }]);
  });

  test("logRejectedSignIn writes at most one row per GitHub id per hour", async () => {
    assert.equal(await logRejectedSignIn({ githubId: "999", login: "intruder" }, db.pool), true);
    assert.equal(await logRejectedSignIn({ githubId: "999", login: "intruder" }, db.pool), false);
    assert.equal(await logRejectedSignIn({ githubId: "1000", login: "other" }, db.pool), true);
    assert.deepEqual(await rows(), [
      { event: "sign_in_rejected", actor: "github:999", details: { githubId: "999", login: "intruder" } },
      { event: "sign_in_rejected", actor: "github:1000", details: { githubId: "1000", login: "other" } },
    ]);
  });

  test("logRejectedSignIn writes again once the last row is over an hour old", async () => {
    assert.equal(await logRejectedSignIn({ githubId: "999", login: "intruder" }, db.pool), true);
    await db.pool.query("update admin_audit_log set at = now() - interval '59 minutes'");
    assert.equal(await logRejectedSignIn({ githubId: "999", login: "intruder" }, db.pool), false);
    await db.pool.query("update admin_audit_log set at = now() - interval '61 minutes'");
    assert.equal(await logRejectedSignIn({ githubId: "999", login: "intruder" }, db.pool), true);
    assert.equal((await rows()).length, 2);
  });

  test("logRejectedSignIn writes at most five rows an hour across all GitHub ids", async () => {
    for (let id = 1; id <= 5; id += 1) {
      assert.equal(await logRejectedSignIn({ githubId: String(id), login: `user${id}` }, db.pool), true, `id ${id}`);
    }
    assert.equal(await logRejectedSignIn({ githubId: "6", login: "user6" }, db.pool), false, "the sixth id in the hour");
    await logAdminEvent("sign_in", { actor: OWNER_ACTOR }, db.pool);
    assert.equal((await rows()).filter((r) => r.event === "sign_in_rejected").length, 5);
    await db.pool.query("update admin_audit_log set at = now() - interval '61 minutes' where event = 'sign_in_rejected'");
    assert.equal(await logRejectedSignIn({ githubId: "6", login: "user6" }, db.pool), true);
  });

  test("recentAdminEvents returns newest first, limited, with exactly five fields", async () => {
    await logAdminEvent("sign_in", { actor: OWNER_ACTOR }, db.pool);
    await logAdminEvent("instagram_check", { actor: OWNER_ACTOR, details: { fetched: 3 } }, db.pool);
    await logAdminEvent("instagram_import", { actor: OWNER_ACTOR }, db.pool);
    const events = await recentAdminEvents(2, db.pool);
    assert.deepEqual(events.map((e) => e.event), ["instagram_import", "instagram_check"]);
    assert.deepEqual(Object.keys(events[0]).sort(), ["actor", "at", "details", "event", "id"]);
    assert.equal(typeof events[0].id, "number");
    assert.ok(events[0].at instanceof Date);
    assert.deepEqual(events[1].details, { fetched: 3 });
    assert.equal((await recentAdminEvents(undefined, db.pool)).length, 3);
  });

  test("recentAdminEvents leaves out refused sign-ins", async () => {
    await logAdminEvent("sign_in", { actor: OWNER_ACTOR }, db.pool);
    for (let id = 1; id <= 3; id += 1) await logRejectedSignIn({ githubId: String(id), login: `user${id}` }, db.pool);
    assert.deepEqual((await recentAdminEvents(2, db.pool)).map((e) => e.event), ["sign_in"]);
    assert.deepEqual((await recentAdminEvents(undefined, db.pool)).map((e) => e.event), ["sign_in"]);
  });

  test("refusedSignInSummary counts the last 24 hours and names the newest refusal", async () => {
    assert.deepEqual(await refusedSignInSummary(db.pool), { count24h: 0, latestAt: null, latestLogin: null });
    await logRejectedSignIn({ githubId: "1", login: "old" }, db.pool);
    await db.pool.query("update admin_audit_log set at = now() - interval '25 hours' where actor = 'github:1'");
    await logRejectedSignIn({ githubId: "2", login: "earlier" }, db.pool);
    await db.pool.query("update admin_audit_log set at = now() - interval '2 hours' where actor = 'github:2'");
    await logRejectedSignIn({ githubId: "3", login: "newest" }, db.pool);
    await logAdminEvent("sign_in", { actor: OWNER_ACTOR }, db.pool);
    const summary = await refusedSignInSummary(db.pool);
    assert.deepEqual(Object.keys(summary).sort(), ["count24h", "latestAt", "latestLogin"]);
    assert.equal(summary.count24h, 2);
    assert.equal(summary.latestLogin, "newest");
    assert.ok(summary.latestAt instanceof Date);
    assert.ok(Math.abs(summary.latestAt.getTime() - Date.now()) < 60_000);
  });
});
