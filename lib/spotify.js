import querystring from "querystring";

const client_id = process.env.client_id;
const client_secret = process.env.client_secret;
const refresh_token = process.env.refresh_token;

const basic = Buffer.from(`${client_id}:${client_secret}`).toString("base64");
const NOW_PLAYING_ENDPOINT = `https://api.spotify.com/v1/me/player/currently-playing`;
const TOP_TRACKS_LONG_ENDPOINT = `https://api.spotify.com/v1/me/top/tracks?time_range=long_term&limit=50`;
const TOP_TRACKS_ENDPOINT = `https://api.spotify.com/v1/me/top/tracks?time_range=short_term&limit=10&offset=5`;
const RECENTLY_PLAYED_ENDPOINT = "https://api.spotify.com/v1/me/player/recently-played?limit=50";
const TOKEN_ENDPOINT = `https://accounts.spotify.com/api/token`;

export class SpotifyReauthRequiredError extends Error {
	constructor(message = "Spotify refresh token is expired or revoked") {
		super(message);
		this.name = "SpotifyReauthRequiredError";
	}
}

// Spotify expires user refresh tokens six months after the original
// authorization, and refreshing does not extend that window. When the token
// dies the endpoint answers 400 invalid_grant, and no retry can ever succeed —
// only a hand-run re-authorization can. Latch that state so we stop calling
// out: /api/nowplaying is polled every 15s by every open tab, so without this
// a dead token means an endless stream of failing requests to Spotify.
//
// The latch is per serverless instance rather than global, so it caps the
// damage instead of eliminating it. It clears when the instance recycles or
// when a deploy picks up a new refresh_token.
let reauthRequired = false;

export const isReauthRequired = () => reauthRequired;

const getAccessToken = async () => {
	if (reauthRequired) {
		throw new SpotifyReauthRequiredError();
	}

	const response = await fetch(TOKEN_ENDPOINT, {
		method: "POST",
		headers: {
			Authorization: `Basic ${basic}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: querystring.stringify({
			grant_type: "refresh_token",
			refresh_token,
		}),
	});

	const body = await response.json().catch(() => ({}));

	if (!response.ok) {
		if (body.error === "invalid_grant") {
			reauthRequired = true;
			console.error(
				"[spotify] Refresh token rejected (invalid_grant) — expired or revoked. " +
					"Run `npm run spotify:reauth` and update the refresh_token env var, then redeploy."
			);
			throw new SpotifyReauthRequiredError();
		}

		throw new Error(
			`[spotify] Token refresh failed with ${response.status}: ${body.error ?? "unknown error"}`
		);
	}

	if (!body.access_token) {
		throw new Error("[spotify] Token refresh returned no access_token");
	}

	// Spotify only rotates the refresh token on some grants. If it ever does,
	// the copy in the env var is dead and the next refresh will fail — so say
	// so now rather than leaving a silent outage to be discovered later.
	if (body.refresh_token && body.refresh_token !== refresh_token) {
		// Deliberately not logging the token itself — runtime logs are not a
		// place to put credentials. Re-run the reauth script to get one.
		console.warn(
			"[spotify] Token refresh returned a NEW refresh token, so the stored " +
				"refresh_token env var is now stale. Run `npm run spotify:reauth` " +
				"and update it before the current one stops working."
		);
	}

	return body;
};

const spotifyFetch = async (endpoint) => {
	const { access_token } = await getAccessToken();

	return fetch(endpoint, {
		headers: {
			Authorization: `Bearer ${access_token}`,
			"Content-Type": "application/json",
		},
	});
};

export const getNowPlaying = () => spotifyFetch(NOW_PLAYING_ENDPOINT);

export const getTopTracks = () => spotifyFetch(TOP_TRACKS_ENDPOINT);

export const getTopTracksLong = () => spotifyFetch(TOP_TRACKS_LONG_ENDPOINT);

export const getListeningTimeline = () => spotifyFetch(RECENTLY_PLAYED_ENDPOINT);
