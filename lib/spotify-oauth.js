import { SPOTIFY_SCOPES } from "./spotify-token.js";

// The authorization-code side of Spotify: the consent URL, the code-for-token
// exchange and the /v1/me lookup that names the approving account. The admin
// panel's Spotify reconnect and scripts/spotify-reauth.mjs both use it. The
// refresh grant stays in lib/spotify.js, private to its client.
//
// Nothing here reads process.env at import time; spotifyCredentials reads it
// only when called.
//
// No token, code, client secret or Authorization header goes into an error
// message: a failure names only the step, the HTTP status, Spotify's own error
// text, or the name of the error fetch threw.

export const SPOTIFY_ADMIN_REDIRECT_URI = "https://www.kevinwong.co/api/admin/spotify/callback";

const AUTHORIZE_ENDPOINT = "https://accounts.spotify.com/authorize";
const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const PROFILE_ENDPOINT = "https://api.spotify.com/v1/me";

// Both calls are interactive one-offs (someone is waiting on a consent
// redirect or a terminal), so they get longer than the widgets' 5 s.
const REQUEST_TIMEOUT_MS = 10_000;

export class SpotifyOAuthError extends Error {
  // code is "exchange_failed" or "account_lookup_failed".
  constructor(code, message) {
    super(message);
    this.name = "SpotifyOAuthError";
    this.code = code;
  }
}

// SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET. Throws when either is missing.
export function spotifyCredentials(env = process.env) {
  const clientId = env.SPOTIFY_CLIENT_ID;
  const clientSecret = env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Spotify client credentials are not set");
  return { clientId, clientSecret };
}

// show_dialog forces the consent screen, so approving works (and can switch
// accounts) even while an older authorization is still live.
export function buildAuthorizeUrl({ clientId, redirectUri, state }) {
  return (
    `${AUTHORIZE_ENDPOINT}?` +
    new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: SPOTIFY_SCOPES.join(" "),
      state,
      show_dialog: "true",
    })
  );
}

const readJson = async (response) => (await response.json().catch(() => ({}))) ?? {};

export async function exchangeCode({ code, redirectUri, clientId, clientSecret, fetchImpl = fetch }) {
  let response;
  try {
    response = await fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new SpotifyOAuthError("exchange_failed", `Token exchange failed: ${error?.name}`);
  }

  const body = await readJson(response);

  if (!response.ok) {
    throw new SpotifyOAuthError(
      "exchange_failed",
      `Token exchange failed with ${response.status}: ${body.error_description ?? body.error ?? "unknown error"}`
    );
  }

  if (!body.refresh_token || !body.access_token) {
    throw new SpotifyOAuthError("exchange_failed", "Token exchange returned no refresh_token or access_token");
  }

  return {
    refreshToken: body.refresh_token,
    accessToken: body.access_token,
    scopes: (body.scope ?? "").split(" ").filter(Boolean),
    expiresIn: Number(body.expires_in),
  };
}

// /v1/me needs no extra scope for id and display_name.
export async function fetchSpotifyProfile(accessToken, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(PROFILE_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new SpotifyOAuthError("account_lookup_failed", `Account lookup failed: ${error?.name}`);
  }

  const body = await readJson(response);

  if (!response.ok) {
    throw new SpotifyOAuthError("account_lookup_failed", `Account lookup failed with ${response.status}`);
  }

  if (!body.id) {
    throw new SpotifyOAuthError("account_lookup_failed", "Account lookup returned no id");
  }

  return { id: body.id, displayName: body.display_name ?? null };
}

export async function fetchSpotifyAccountId(accessToken, fetchImpl = fetch) {
  return (await fetchSpotifyProfile(accessToken, fetchImpl)).id;
}

// The scopes in SPOTIFY_SCOPES that `granted` lacks, in SPOTIFY_SCOPES order.
// Extra granted scopes are ignored.
export function missingScopes(granted) {
  return SPOTIFY_SCOPES.filter((scope) => !granted.includes(scope));
}
