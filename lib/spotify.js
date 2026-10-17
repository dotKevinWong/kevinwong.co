import { readSpotifyRow, storeRotatedRefreshToken, markSpotifyDead } from "./spotify-token.js";
import { redact } from "./redact.js";
import { spotifyCredentials } from "./spotify-oauth.js";

const NOW_PLAYING_ENDPOINT = `https://api.spotify.com/v1/me/player/currently-playing`;
const TOP_TRACKS_ENDPOINT = `https://api.spotify.com/v1/me/top/tracks?time_range=short_term&limit=10&offset=5`;
const RECENTLY_PLAYED_ENDPOINT = "https://api.spotify.com/v1/me/player/recently-played?limit=50";
const TOKEN_ENDPOINT = `https://accounts.spotify.com/api/token`;

// Without a signal, a stalled Spotify endpoint holds the invocation open for
// undici's 300s default. The routes already treat a thrown fetch as "nothing
// to show", so failing fast is strictly better than hanging.
const REQUEST_TIMEOUT_MS = 5000;

// Refresh this long before Spotify's stated expiry, so a token is never sent
// in the last moments of its life.
const TOKEN_EXPIRY_MARGIN_MS = 60 * 1000;

export class SpotifyReauthRequiredError extends Error {
	constructor(message = "Spotify refresh token is expired or revoked") {
		super(message);
		this.name = "SpotifyReauthRequiredError";
	}
}

const INVALID_GRANT_MESSAGE =
	"[spotify] Refresh token rejected (invalid_grant): expired or revoked. " +
	"Reconnect Spotify from /admin, or run `npm run spotify:reauth -- --save`.";

// Postgres holds the refresh token (the integration_tokens row for provider
// 'spotify'; see lib/spotify-token.js). This instance caches only the access
// token, until shortly before it expires, and concurrent requests share one
// refresh. Every refresh reads the row again, which is what picks up a
// reconnect, or a rotation another instance stored. The refresh_token env var
// stands in only while there is no row at all.
//
// Spotify ends an authorization six months after approval, and then answers
// invalid_grant. A rejected token is marked dead in the row by compare-and-swap
// on its value, and never sent again by this instance. While dead, the row is
// rechecked at most once a minute, so a reconnect from /admin takes effect
// within a minute with no redeploy.
//
// A database error, or a database call slower than storeTimeoutMs, fails the
// request (the routes show "nothing to show") and never falls back to the env
// token. The hot path (/api/nowplaying, polled every 15 s by every open tab)
// touches Postgres only on a refresh: about once an hour, or once a minute
// while dead.
//
// No token, client secret or Authorization header goes into a log line or an
// error message.
export function createSpotifyClient({
	store,
	fetchImpl = fetch,
	now = Date.now,
	env = process.env,
	recheckMs = 60_000,
	storeTimeoutMs = REQUEST_TIMEOUT_MS,
}) {
	let cached = null;     // { accessToken, expiresAt }
	let inFlight = null;   // the one refresh that concurrent callers share
	let deadSince = null;  // when this client last found no usable refresh token
	let deadToken = null;  // a refresh token Spotify answered invalid_grant for: never sent again
	let generation = 0;    // bumped by reset(); a refresh begun before it must not write state after it

	// A stalled pooler would otherwise hold the request open far longer than
	// the 5 s the Spotify calls are allowed. The timer is cleared when the store
	// call settles, so a fast call leaves no timer behind.
	const withTimeout = (promise, label) => {
		const call = Promise.resolve(promise);
		let timer;
		const timeout = new Promise((_, reject) => {
			timer = setTimeout(() => reject(new Error(`[spotify] ${label} timed out`)), storeTimeoutMs);
		});
		call.finally(() => clearTimeout(timer)).catch(() => {});
		return Promise.race([call, timeout]);
	};

	// No usable refresh token: stop asking for recheckMs. Returns the error for
	// the caller to throw, so a stale refresh still rejects its own callers.
	const latchDead = (gen) => {
		if (gen === generation) {
			deadSince = now();
			cached = null;
		}
		return new SpotifyReauthRequiredError();
	};

	const refresh = async (gen) => {
		const { clientId, clientSecret } = spotifyCredentials(env);

		// A rejection here (including a timeout) propagates as is: not latched,
		// and no fallback to the env token.
		const row = await withTimeout(store.readSpotifyRow(), "Reading the token row");
		const fromDb = row !== null;
		const refreshToken = fromDb ? row.refreshToken : env.refresh_token;

		if (!refreshToken || (fromDb && row.deadReason) || refreshToken === deadToken) {
			throw latchDead(gen);
		}

		const response = await fetchImpl(TOKEN_ENDPOINT, {
			method: "POST",
			headers: {
				Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: refreshToken,
			}).toString(),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});

		const body = (await response.json().catch(() => null)) ?? {};

		if (!response.ok) {
			if (body.error === "invalid_grant") {
				console.error(INVALID_GRANT_MESSAGE);
				// An env token has no row to mark. A failed mark is only logged:
				// deadToken still keeps this instance from re-sending the token.
				if (fromDb) {
					try {
						await withTimeout(
							store.markSpotifyDead("invalid_grant", refreshToken),
							"Marking the stored token dead"
						);
					} catch (error) {
						console.error("[spotify] Could not mark the stored token dead:", redact(error?.message));
					}
				}
				if (gen === generation) deadToken = refreshToken;
				throw latchDead(gen);
			}

			throw new Error(
				`[spotify] Token refresh failed with ${response.status}: ${body.error ?? "unknown error"}`
			);
		}

		if (!body.access_token) {
			throw new Error("[spotify] Token refresh returned no access_token");
		}

		// Spotify only rotates the refresh token on some grants. A rotation is
		// awaited, not fired and forgotten, because a suspended instance could
		// drop the write. The swap is on the token this refresh read, so a
		// reconnect or another instance's rotation is never overwritten.
		if (body.refresh_token && body.refresh_token !== refreshToken) {
			if (fromDb) {
				try {
					const stored = await withTimeout(
						store.storeRotatedRefreshToken(refreshToken, body.refresh_token),
						"Storing the rotated refresh token"
					);
					if (!stored) {
						console.warn(
							"[spotify] Spotify rotated the refresh token, but the stored one had already changed; keeping the stored one."
						);
					}
				} catch (error) {
					console.error("[spotify] Could not store the rotated refresh token:", redact(error?.message));
				}
			} else {
				console.warn(
					"[spotify] Spotify rotated the refresh token held in the refresh_token env var. Reconnect from /admin so the new one is stored."
				);
			}
		}

		// A missing or non-numeric expires_in leaves expiresAt as NaN, which never
		// compares as fresh, so the worst case is a refresh on every call.
		if (gen === generation) {
			cached = {
				accessToken: body.access_token,
				expiresAt: now() + Number(body.expires_in) * 1000 - TOKEN_EXPIRY_MARGIN_MS,
			};
			deadSince = null;
		}

		return body.access_token;
	};

	const getAccessToken = async () => {
		// Checked before the cache on purpose: once the refresh token is known to
		// be dead, stop serving from a token minted with it too.
		if (deadSince !== null && now() - deadSince < recheckMs) {
			throw new SpotifyReauthRequiredError();
		}

		if (cached && now() < cached.expiresAt) {
			return cached.accessToken;
		}

		if (!inFlight) {
			const pending = refresh(generation).finally(() => {
				if (inFlight === pending) inFlight = null;
			});
			inFlight = pending;
		}

		return inFlight;
	};

	const spotifyFetch = async (endpoint, { isRetry = false } = {}) => {
		const accessToken = await getAccessToken();

		const response = await fetchImpl(endpoint, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
			},
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});

		// A 401 means Spotify stopped honoring the token before its stated expiry
		// (revoked, or the app's credentials rotated). Forget it, unless a concurrent
		// request has already replaced it, and try once more with a fresh one.
		if (response.status === 401 && !isRetry) {
			if (cached?.accessToken === accessToken) {
				cached = null;
			}
			response.body?.cancel().catch(() => {});
			return spotifyFetch(endpoint, { isRetry: true });
		}

		return response;
	};

	return {
		getNowPlaying: () => spotifyFetch(NOW_PLAYING_ENDPOINT),
		getTopTracks: () => spotifyFetch(TOP_TRACKS_ENDPOINT),
		getListeningTimeline: () => spotifyFetch(RECENTLY_PLAYED_ENDPOINT),
		reset() {
			generation += 1;
			cached = null;
			inFlight = null;
			deadSince = null;
			deadToken = null;
		},
	};
}

// Creating it does no I/O: the database is first touched by a refresh.
const defaultClient = createSpotifyClient({
	store: { readSpotifyRow, storeRotatedRefreshToken, markSpotifyDead },
});

export const getNowPlaying = () => defaultClient.getNowPlaying();

export const getTopTracks = () => defaultClient.getTopTracks();

export const getListeningTimeline = () => defaultClient.getListeningTimeline();

// For the panel's Spotify callback, right after it saves a new authorization.
export const resetSpotifyTokenCache = () => defaultClient.reset();
