import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SPOTIFY_ADMIN_REDIRECT_URI, SpotifyOAuthError, spotifyCredentials, buildAuthorizeUrl,
  exchangeCode, fetchSpotifyAccountId, fetchSpotifyProfile, missingScopes,
} from "../lib/spotify-oauth.js";

const ALL = ["user-read-currently-playing", "user-top-read", "user-read-recently-played"];
const basic = (id, secret) => `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
const recorder = (respond) => {
  const calls = [];
  return { calls, fetchImpl: async (url, init = {}) => { calls.push({ url, init }); return respond(); } };
};
const exchange = (fetchImpl) =>
  exchangeCode({ code: "code-SECRET", redirectUri: SPOTIFY_ADMIN_REDIRECT_URI, clientId: "cid", clientSecret: "client-SECRET", fetchImpl });
const oauthError = (code) => (error) => {
  assert.ok(error instanceof SpotifyOAuthError);
  assert.equal(error.name, "SpotifyOAuthError");
  assert.equal(error.code, code);
  assert.ok(!error.message.includes("SECRET"));
  return true;
};

test("the admin redirect URI is the www callback", () => {
  assert.equal(SPOTIFY_ADMIN_REDIRECT_URI, "https://www.kevinwong.co/api/admin/spotify/callback");
});

test("spotifyCredentials prefers SPOTIFY_* and falls back to the lowercase names", () => {
  assert.deepEqual(spotifyCredentials({ SPOTIFY_CLIENT_ID: "new-id", SPOTIFY_CLIENT_SECRET: "new-secret", client_id: "old-id", client_secret: "old-secret" }), { clientId: "new-id", clientSecret: "new-secret" });
  assert.deepEqual(spotifyCredentials({ client_id: "old-id", client_secret: "old-secret" }), { clientId: "old-id", clientSecret: "old-secret" });
  assert.deepEqual(spotifyCredentials({ SPOTIFY_CLIENT_ID: "new-id", client_secret: "old-secret" }), { clientId: "new-id", clientSecret: "old-secret" });
});

test("spotifyCredentials throws when either is missing", () => {
  for (const env of [{}, { SPOTIFY_CLIENT_ID: "id" }, { client_secret: "secret" }]) {
    assert.throws(() => spotifyCredentials(env), { message: "Spotify client credentials are not set" });
  }
});

test("buildAuthorizeUrl sends exactly the six parameters", () => {
  const url = new URL(buildAuthorizeUrl({ clientId: "cid", redirectUri: SPOTIFY_ADMIN_REDIRECT_URI, state: "st-123" }));
  assert.equal(`${url.origin}${url.pathname}`, "https://accounts.spotify.com/authorize");
  assert.deepEqual([...url.searchParams.keys()].sort(), ["client_id", "redirect_uri", "response_type", "scope", "show_dialog", "state"]);
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: "cid", response_type: "code",
    redirect_uri: "https://www.kevinwong.co/api/admin/spotify/callback",
    scope: "user-read-currently-playing user-top-read user-read-recently-played",
    state: "st-123", show_dialog: "true",
  });
});

test("exchangeCode posts an authorization_code grant with Basic auth and maps the response", async () => {
  const { calls, fetchImpl } = recorder(() => Response.json({ access_token: "at-1", token_type: "Bearer", scope: "user-top-read user-read-currently-playing", expires_in: 3600, refresh_token: "rt-1" }));
  assert.deepEqual(await exchange(fetchImpl), { refreshToken: "rt-1", accessToken: "at-1", scopes: ["user-top-read", "user-read-currently-playing"], expiresIn: 3600 });
  const [{ url, init }] = calls;
  assert.equal(url, "https://accounts.spotify.com/api/token");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, basic("cid", "client-SECRET"));
  assert.equal(init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(String(init.body))), {
    grant_type: "authorization_code", code: "code-SECRET", redirect_uri: "https://www.kevinwong.co/api/admin/spotify/callback",
  });
  assert.ok(init.signal instanceof AbortSignal);
});

test("exchangeCode maps a missing scope field to []", async () => {
  const { fetchImpl } = recorder(() => Response.json({ access_token: "at-1", expires_in: 3600, refresh_token: "rt-1" }));
  assert.deepEqual((await exchange(fetchImpl)).scopes, []);
});

test("exchangeCode failures are exchange_failed and carry no secret", async () => {
  const responses = [
    () => Response.json({ error: "invalid_grant", error_description: "Invalid authorization code" }, { status: 400 }),
    () => Response.json({ access_token: "at-SECRET", expires_in: 3600 }), // no refresh_token
    () => { throw new TypeError("fetch failed"); },
  ];
  for (const respond of responses) {
    await assert.rejects(exchange(recorder(respond).fetchImpl), oauthError("exchange_failed"));
  }
});

test("fetchSpotifyAccountId reads /v1/me with the access token", async () => {
  const { calls, fetchImpl } = recorder(() => Response.json({ id: "owner-123", display_name: "Kevin" }));
  assert.equal(await fetchSpotifyAccountId("at-1", fetchImpl), "owner-123");
  assert.equal(calls[0].url, "https://api.spotify.com/v1/me");
  assert.equal(calls[0].init.headers.Authorization, "Bearer at-1");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("fetchSpotifyProfile returns the id and the display name", async () => {
  assert.deepEqual(await fetchSpotifyProfile("at-1", recorder(() => Response.json({ id: "owner-123", display_name: "Kevin" })).fetchImpl), { id: "owner-123", displayName: "Kevin" });
  assert.deepEqual(await fetchSpotifyProfile("at-1", recorder(() => Response.json({ id: "owner-123", display_name: null })).fetchImpl), { id: "owner-123", displayName: null });
});

test("account lookup failures are account_lookup_failed", async () => {
  const responses = [
    () => Response.json({ error: { status: 401, message: "Invalid access token" } }, { status: 401 }),
    () => Response.json({ display_name: "Kevin" }), // no id
    () => { throw new TypeError("fetch failed"); },
  ];
  for (const respond of responses) {
    await assert.rejects(fetchSpotifyAccountId("at-SECRET", recorder(respond).fetchImpl), oauthError("account_lookup_failed"));
  }
});

test("missingScopes lists what was not granted, in SPOTIFY_SCOPES order", () => {
  assert.deepEqual(missingScopes(ALL), []);
  assert.deepEqual(missingScopes(["user-read-recently-played", "user-read-email", "user-top-read", "user-read-currently-playing"]), []);
  assert.deepEqual(missingScopes(["user-top-read"]), ["user-read-currently-playing", "user-read-recently-played"]);
  assert.deepEqual(missingScopes([]), ALL);
});

test("SpotifyOAuthError carries its code", () => {
  const error = new SpotifyOAuthError("exchange_failed", "Token exchange failed with 400: invalid_grant");
  assert.ok(error instanceof Error);
  assert.equal(error.name, "SpotifyOAuthError");
  assert.equal(error.code, "exchange_failed");
  assert.equal(error.message, "Token exchange failed with 400: invalid_grant");
});
