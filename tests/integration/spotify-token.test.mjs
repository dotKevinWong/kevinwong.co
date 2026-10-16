import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { testDb } from "../helpers/db.mjs";
import {
  SPOTIFY_SCOPES, AUTHORIZATION_LIFETIME_DAYS, readSpotifyRow, saveSpotifyAuthorization,
  storeRotatedRefreshToken, markSpotifyDead, readSpotifyStatusRow,
} from "../../lib/spotify-token.js";

const DAY_MS = 86_400_000;
const db = testDb();

describe("lib/spotify-token.js against the test database", { skip: db.skip }, () => {
  const save = (refreshToken) =>
    saveSpotifyAuthorization({ refreshToken, accountId: "owner-1", scopes: SPOTIFY_SCOPES }, db.pool);
  const raw = async () => (await db.pool.query("select * from integration_tokens where provider = 'spotify'")).rows[0];
  const instagram = async () =>
    (await db.pool.query("select to_jsonb(t) as row from integration_tokens t where provider = 'instagram'")).rows[0].row;

  before(() => db.resetSchema());
  after(() => db.close());
  beforeEach(async () => {
    await db.pool.query("delete from integration_tokens");
    await db.pool.query(
      `insert into integration_tokens (provider, access_token, expires_at, refreshed_at, expires_at_is_assumed)
       values ('instagram', 'ig-token', now() + interval '50 days', now() - interval '2 days', false)`
    );
  });

  it("returns null from both readers when there is no spotify row", async () => {
    assert.equal(await readSpotifyRow(db.pool), null);
    assert.equal(await readSpotifyStatusRow(db.pool), null);
  });

  it("saveSpotifyAuthorization then readSpotifyRow returns what was saved", async () => {
    const saved = await save("rt-1");
    assert.ok(saved.authorizedAt instanceof Date && saved.expiresAt instanceof Date);
    assert.equal(saved.expiresAt - saved.authorizedAt, AUTHORIZATION_LIFETIME_DAYS * DAY_MS);
    assert.deepEqual(await readSpotifyRow(db.pool), {
      refreshToken: "rt-1", deadReason: null, authorizedAt: saved.authorizedAt,
      expiresAt: saved.expiresAt, accountId: "owner-1", scopes: [...SPOTIFY_SCOPES],
    });
    const row = await raw();
    assert.equal(row.access_token, null);
    assert.equal(row.scopes, "user-read-currently-playing user-top-read user-read-recently-played");
    assert.equal(row.expires_at_is_assumed, true);
  });

  it("saveSpotifyAuthorization over a dead row stores the new token and clears dead_reason", async () => {
    await save("rt-1");
    assert.equal(await markSpotifyDead("invalid_grant", "rt-1", db.pool), true);
    await save("rt-2");
    const row = await readSpotifyRow(db.pool);
    assert.equal(row.refreshToken, "rt-2");
    assert.equal(row.deadReason, null);
  });

  it("storeRotatedRefreshToken swaps once and refuses a stale previous token", async () => {
    await save("rt-A");
    assert.equal(await storeRotatedRefreshToken("rt-A", "rt-B", db.pool), true);
    assert.equal(await storeRotatedRefreshToken("rt-A", "rt-C", db.pool), false);
    assert.equal((await readSpotifyRow(db.pool)).refreshToken, "rt-B");
  });

  it("a rotation that lands after the old token was marked dead stores the new token and clears dead_reason", async () => {
    await save("rt-A");
    // Another instance re-sent rt-A after Spotify had rotated it, and marked it dead first.
    assert.equal(await markSpotifyDead("invalid_grant", "rt-A", db.pool), true);
    assert.equal(await storeRotatedRefreshToken("rt-A", "rt-B", db.pool), true);
    const row = await readSpotifyRow(db.pool);
    assert.equal(row.refreshToken, "rt-B");
    assert.equal(row.deadReason, null);
  });

  it("storeRotatedRefreshToken keeps authorized_at and expires_at (rotation does not extend the six months)", async () => {
    const saved = await save("rt-A");
    await storeRotatedRefreshToken("rt-A", "rt-B", db.pool);
    const row = await readSpotifyRow(db.pool);
    assert.deepEqual([row.authorizedAt, row.expiresAt], [saved.authorizedAt, saved.expiresAt]);
  });

  it("markSpotifyDead does not latch a newer token written by a reconnect", async () => {
    await save("rt-old");
    await save("rt-new"); // the reconnect
    assert.equal(await markSpotifyDead("invalid_grant", "rt-old", db.pool), false);
    const row = await readSpotifyRow(db.pool);
    assert.equal(row.refreshToken, "rt-new");
    assert.equal(row.deadReason, null);
  });

  it("markSpotifyDead latches the matching token exactly once", async () => {
    await save("rt-A");
    assert.equal(await markSpotifyDead("invalid_grant", "rt-A", db.pool), true);
    assert.equal(await markSpotifyDead("invalid_grant", "rt-A", db.pool), false);
    assert.equal((await readSpotifyRow(db.pool)).deadReason, "invalid_grant");
  });

  it("readSpotifyStatusRow returns no token fields", async () => {
    await save("rt-A");
    const status = await readSpotifyStatusRow(db.pool);
    assert.equal("refreshToken" in status, false);
    assert.equal("accessToken" in status, false);
    assert.deepEqual(Object.keys(status).sort(), ["accountId", "authorizedAt", "deadReason", "expiresAt", "scopes", "updatedAt"]);
    assert.deepEqual(status.scopes, [...SPOTIFY_SCOPES]);
    assert.ok(status.updatedAt instanceof Date);
    assert.ok(!JSON.stringify(status).includes("rt-A"));
  });

  it("no function touches the instagram row", async () => {
    const before = await instagram();
    await save("rt-A");
    await storeRotatedRefreshToken("rt-A", "rt-B", db.pool);
    assert.equal(await storeRotatedRefreshToken("ig-token", "x", db.pool), false);
    assert.equal(await markSpotifyDead("invalid_grant", "ig-token", db.pool), false);
    await markSpotifyDead("invalid_grant", "rt-B", db.pool);
    await readSpotifyRow(db.pool);
    await readSpotifyStatusRow(db.pool);
    await save("rt-C");
    assert.deepEqual(await instagram(), before);
  });
});
