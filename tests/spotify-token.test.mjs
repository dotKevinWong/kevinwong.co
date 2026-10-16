import { test } from "node:test";
import assert from "node:assert/strict";
import * as tokens from "../lib/spotify-token.js";

// Accepts both of pg's call forms: query(text, values) and query({ text, values, query_timeout }).
function fakeDb(result = { rows: [], rowCount: 0 }) {
  const calls = [];
  const query = async (textOrConfig, values) => {
    const config = typeof textOrConfig === "string" ? { text: textOrConfig, values } : textOrConfig;
    calls.push({ text: config.text, params: config.values, queryTimeout: config.query_timeout });
    return result;
  };
  return { calls, query };
}

test("constants", () => {
  assert.equal(tokens.SPOTIFY_PROVIDER, "spotify");
  assert.deepEqual(tokens.SPOTIFY_SCOPES, ["user-read-currently-playing", "user-top-read", "user-read-recently-played"]);
  assert.ok(Object.isFrozen(tokens.SPOTIFY_SCOPES));
  assert.equal(tokens.AUTHORIZATION_LIFETIME_DAYS, 180);
});

test("every statement is scoped to provider spotify", async () => {
  const db = fakeDb({ rows: [{ authorized_at: new Date(0), expires_at: new Date(0) }], rowCount: 1 });
  await tokens.readSpotifyRow(db);
  await tokens.readSpotifyStatusRow(db);
  await tokens.saveSpotifyAuthorization({ refreshToken: "rt", accountId: "acct", scopes: ["a"] }, db);
  await tokens.storeRotatedRefreshToken("rt", "rt-2", db);
  await tokens.markSpotifyDead("invalid_grant", "rt", db);
  assert.equal(db.calls.length, 5);
  for (const { text, params } of db.calls) {
    assert.match(text, /provider/);
    assert.equal(params[0], "spotify");
  }
});

test("the three statements a Spotify refresh runs pass query_timeout: 4500", async () => {
  assert.equal(tokens.STORE_QUERY_TIMEOUT_MS, 4_500);
  const db = fakeDb({ rows: [], rowCount: 1 });
  await tokens.readSpotifyRow(db);
  await tokens.markSpotifyDead("invalid_grant", "rt", db);
  await tokens.storeRotatedRefreshToken("rt", "rt-2", db);
  assert.deepEqual(db.calls.map((call) => call.queryTimeout), [4500, 4500, 4500]);
});

test("readSpotifyStatusRow never selects a token column", async () => {
  const db = fakeDb();
  assert.equal(await tokens.readSpotifyStatusRow(db), null);
  assert.doesNotMatch(db.calls[0].text, /refresh_token|access_token/);
});

test("writes without a token make no query and return false", async () => {
  const db = fakeDb({ rows: [], rowCount: 1 });
  assert.equal(await tokens.markSpotifyDead("invalid_grant", "", db), false);
  assert.equal(await tokens.markSpotifyDead("invalid_grant", undefined, db), false);
  assert.equal(await tokens.storeRotatedRefreshToken("", "next", db), false);
  assert.equal(await tokens.storeRotatedRefreshToken("prev", "", db), false);
  assert.equal(db.calls.length, 0);
});

test("compare-and-swap results come from rowCount", async () => {
  assert.equal(await tokens.markSpotifyDead("invalid_grant", "rt", fakeDb({ rows: [], rowCount: 0 })), false);
  assert.equal(await tokens.markSpotifyDead("invalid_grant", "rt", fakeDb({ rows: [], rowCount: 1 })), true);
  assert.equal(await tokens.storeRotatedRefreshToken("a", "b", fakeDb({ rows: [], rowCount: 0 })), false);
  assert.equal(await tokens.storeRotatedRefreshToken("a", "b", fakeDb({ rows: [], rowCount: 1 })), true);
});

test("saveSpotifyAuthorization refuses a missing refreshToken or accountId", async () => {
  const db = fakeDb();
  const message = "saveSpotifyAuthorization needs a refreshToken and an accountId";
  await assert.rejects(tokens.saveSpotifyAuthorization({ refreshToken: "", accountId: "acct", scopes: [] }, db), { message });
  await assert.rejects(tokens.saveSpotifyAuthorization({ refreshToken: "rt", accountId: "", scopes: [] }, db), { message });
  assert.equal(db.calls.length, 0);
});

test("saveSpotifyAuthorization sends space-joined scopes and the lifetime in days", async () => {
  const db = fakeDb({ rows: [{ authorized_at: new Date(0), expires_at: new Date(1) }], rowCount: 1 });
  assert.deepEqual(
    await tokens.saveSpotifyAuthorization({ refreshToken: "rt", accountId: "acct", scopes: ["a", "b"] }, db),
    { authorizedAt: new Date(0), expiresAt: new Date(1) }
  );
  assert.deepEqual(db.calls[0].params, ["spotify", "rt", "acct", "a b", 180]);
});
