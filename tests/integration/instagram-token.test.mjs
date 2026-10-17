import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as instagram from "../../lib/instagram.js";
import { getDbPool } from "../../lib/db.js";
import { testDb } from "../helpers/db.mjs";
import { stubFetch } from "../helpers/fetch-stub.mjs";

const db = testDb();
// lib/instagram.js uses getDbPool(), whose pool opens on first use (inside the tests): point it at the
// local test database. tests/helpers/db.mjs has already refused a remote DATABASE_URL at import.
if (!db.skip) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const GRAPH = "https://graph.instagram.com";
const REFRESH = `${GRAPH}/refresh_access_token`;
const ME = `${GRAPH}/v25.0/me`;
const MEDIA = `${GRAPH}/v25.0/me/media`;
const DAY = 86_400;
const graph190 = () =>
  Response.json({ error: { code: 190, type: "OAuthException", message: "Error validating access token" } }, { status: 400 });
const refreshed = (token) => Response.json({ access_token: token, token_type: "bearer", expires_in: 5_184_000 });

describe("Instagram token compare-and-swap (integration)", { skip: db.skip }, () => {
  const tokenRow = async () => (await db.pool.query(
    `select access_token, expires_at, refreshed_at, dead_reason, expires_at_is_assumed
       from integration_tokens where provider = 'instagram'`)).rows[0];
  const seed = (accessToken) => instagram.storeToken({ accessToken, expiresInSeconds: 60 * DAY });
  // Due for a refresh: past the 25-hour floor and inside the 30-day window.
  async function seedDue(accessToken) {
    await instagram.storeToken({ accessToken, expiresInSeconds: 10 * DAY });
    await db.pool.query(`update integration_tokens set refreshed_at = now() - interval '26 hours' where provider = 'instagram'`);
  }
  // What `npm run instagram:token` does: an unconditional upsert of a new token.
  const reseed = (accessToken) => instagram.storeToken({ accessToken, expiresInSeconds: 60 * DAY, expiryIsAssumed: true });

  before(() => db.resetSchema());
  beforeEach(() => db.pool.query("delete from integration_tokens"));
  after(async () => { await getDbPool().end(); await db.close(); });

  test("storeRefreshedToken updates the row when it still holds the previous token", async () => {
    await reseed("T1"); // stores expires_at_is_assumed = true, so the final assertion proves the update resets it
    const ok = await instagram.storeRefreshedToken({ previousToken: "T1", accessToken: "T1b", expiresInSeconds: 5_184_000 });
    assert.equal(ok, true);
    const row = await tokenRow();
    assert.equal(row.access_token, "T1b");
    assert.equal(row.expires_at_is_assumed, false);
    assert.ok(Math.abs(row.expires_at.getTime() - (Date.now() + 5_184_000_000)) < 60_000);
  });

  test("storeRefreshedToken returns false and writes nothing when the row holds another token", async () => {
    await seed("T2");
    const original = await tokenRow();
    const ok = await instagram.storeRefreshedToken({ previousToken: "T1", accessToken: "T1b", expiresInSeconds: 5_184_000 });
    assert.equal(ok, false);
    assert.deepEqual(await tokenRow(), original);
  });

  test("storeRefreshedToken returns false and writes nothing when the row is marked dead", async () => {
    await seed("T1");
    await db.pool.query(`update integration_tokens set dead_reason = 'marked by another run' where provider = 'instagram'`);
    const ok = await instagram.storeRefreshedToken({ previousToken: "T1", accessToken: "T1b", expiresInSeconds: 5_184_000 });
    assert.equal(ok, false);
    const row = await tokenRow();
    assert.equal(row.access_token, "T1");
    assert.equal(row.dead_reason, "marked by another run");
  });

  test("a refresh with no race stores the refreshed token", async (t) => {
    await seedDue("T1");
    stubFetch(t, { [REFRESH]: () => refreshed("T1b") });
    t.mock.method(console, "log", () => {});
    assert.equal(await instagram.ensureFreshToken(), "T1b");
    const row = await tokenRow();
    assert.equal(row.access_token, "T1b");
    assert.equal(row.dead_reason, null);
    assert.ok(Date.now() - row.refreshed_at.getTime() < 60_000);
  });

  test("a refresh that races a reseed does not overwrite the reseeded token", async (t) => {
    await seedDue("T1");
    stubFetch(t, { [REFRESH]: async () => { await reseed("T2"); return refreshed("T1b"); } });
    const warn = t.mock.method(console, "warn", () => {});
    assert.equal(await instagram.ensureFreshToken(), "T1b"); // this run still uses its refreshed token
    const row = await tokenRow();
    assert.equal(row.access_token, "T2");
    assert.equal(row.expires_at_is_assumed, true);
    assert.equal(row.dead_reason, null);
    assert.equal(warn.mock.callCount(), 1);
  });

  test("a refresh does not clear a dead flag set while it was in flight", async (t) => {
    await seedDue("T1");
    stubFetch(t, {
      [REFRESH]: async () => {
        await db.pool.query(`update integration_tokens set dead_reason = 'marked by another run' where provider = 'instagram'`);
        return refreshed("T1b");
      },
    });
    t.mock.method(console, "warn", () => {});
    assert.equal(await instagram.ensureFreshToken(), "T1b");
    const row = await tokenRow();
    assert.equal(row.access_token, "T1");
    assert.equal(row.dead_reason, "marked by another run");
  });

  test("a 190 on an old token does not mark a newer token dead", async (t) => {
    await seed("T2");
    const fetchStub = stubFetch(t, { [MEDIA]: graph190, [ME]: graph190 });
    t.mock.method(console, "warn", () => {});
    await assert.rejects(
      instagram.fetchRecentMedia({ accessToken: "T1", maxPosts: 1 }),
      (error) => !(error instanceof instagram.InstagramReauthRequiredError) && /code=190/.test(error.message)
    );
    assert.equal((await tokenRow()).dead_reason, null);
    assert.equal(fetchStub.mock.callCount(), 2); // the media call, then the confirmation
  });

  test("a 190 during a refresh that races a reseed does not mark the reseeded token dead", async (t) => {
    await seedDue("T1");
    stubFetch(t, { [REFRESH]: async () => { await reseed("T2"); return graph190(); }, [ME]: graph190 });
    t.mock.method(console, "warn", () => {});
    assert.equal(await instagram.ensureFreshToken(), "T1"); // not latched: the old token comes back, as today
    const row = await tokenRow();
    assert.equal(row.access_token, "T2");
    assert.equal(row.dead_reason, null);
  });

  test("a confirmed 190 on the stored token still marks it dead", async (t) => {
    await seed("T1");
    stubFetch(t, { [MEDIA]: graph190, [ME]: graph190 });
    t.mock.method(console, "error", () => {});
    await assert.rejects(instagram.fetchRecentMedia({ accessToken: "T1", maxPosts: 1 }), instagram.InstagramReauthRequiredError);
    assert.match((await tokenRow()).dead_reason, /^HTTP 400 code=190 /);
  });

  test("markTokenDead without a token does not latch", async (t) => {
    await seed("T1");
    const fetchStub = stubFetch(t, { [MEDIA]: graph190 });
    t.mock.method(console, "warn", () => {});
    await assert.rejects(
      instagram.fetchRecentMedia({ accessToken: "", maxPosts: 1 }),
      (error) => !(error instanceof instagram.InstagramReauthRequiredError)
    );
    assert.equal(fetchStub.mock.callCount(), 1); // no confirmation request
    assert.equal((await tokenRow()).dead_reason, null);
  });
});
