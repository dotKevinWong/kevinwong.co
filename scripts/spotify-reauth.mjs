#!/usr/bin/env node
/**
 * Mints a fresh Spotify refresh token, stores one in Postgres, or reports which
 * Spotify account the current one belongs to.
 *
 *   npm run spotify:reauth                # approve in the browser, print the new token
 *   npm run spotify:reauth -- --save      # approve, check the scopes and the account,
 *                                         # then store it in integration_tokens
 *   npm run spotify:reauth -- --whoami    # print the current token's account; no browser
 *
 * Options go after the `--`. Without it npm keeps --save or --whoami for itself,
 * and the script runs as if it had no option: it opens the browser and prints
 * the token.
 *
 * Spotify expires user refresh tokens about six months after the original
 * authorization, and refreshing does not extend that window, so this (or the
 * panel's Reconnect at /admin) has to be re-run roughly twice a year, ideally
 * before the current token dies rather than after.
 *
 * --save stores the token only when Spotify granted every scope and the
 * approving account is the site owner's (lib/admin/owner.js); it never prints
 * the token. --whoami reads the database row first, else the refresh_token env
 * var. It writes nothing, except a rotated refresh token, which it stores by
 * compare-and-swap.
 *
 * The browser modes require `http://127.0.0.1:8888/callback` in the app's
 * Redirect URIs at https://developer.spotify.com/dashboard (Spotify rejects
 * `localhost`; the loopback IP literal is required).
 */

import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { ENV_FILES, loadEnvFiles, requireEnv } from "./load-env.mjs";
import {
	buildAuthorizeUrl,
	exchangeCode,
	fetchSpotifyAccountId,
	fetchSpotifyProfile,
	missingScopes,
	spotifyCredentials,
} from "../lib/spotify-oauth.js";
import {
	AUTHORIZATION_LIFETIME_DAYS,
	readSpotifyRow,
	saveSpotifyAuthorization,
	storeRotatedRefreshToken,
} from "../lib/spotify-token.js";
import { OWNER_SPOTIFY_ACCOUNT_ID, SITE_ORIGIN } from "../lib/admin/owner.js";
import { getDbPool } from "../lib/db.js";
import { redact } from "../lib/redact.js";

const PORT = 8888;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
const REQUEST_TIMEOUT_MS = 10_000;

// The real environment wins. Copying the files into process.env is what lets
// getDbPool() and spotifyCredentials() see .env and .env.local; none of the lib
// modules above reads process.env at import time, so this can run after them.
const fileEnv = loadEnvFiles();
for (const [key, value] of Object.entries(fileEnv)) {
	if (process.env[key] === undefined) process.env[key] = value;
}

const USAGE = `
Usage: npm run spotify:reauth -- [option]

  (no option)  Approve in the browser and print the new refresh token
  --save       Approve in the browser, check the scopes and the account,
               then store the token in Postgres (integration_tokens)
  --whoami     Print which Spotify account the current token belongs to
               (database row first, else the refresh_token env var); no browser
  --help       Show this message
`;

const args = process.argv.slice(2);
const unknown = args.filter((arg) => !["--save", "--whoami", "--help", "-h"].includes(arg));
if (unknown.length > 0) {
	console.error(`Unknown argument: ${unknown.join(" ")}\n${USAGE}`);
	process.exit(1);
}

const save = args.includes("--save");
const whoami = args.includes("--whoami");

if (save && whoami) {
	console.error("Use --whoami or --save, not both.");
	process.exit(1);
}

if (args.includes("--help") || args.includes("-h")) {
	console.log(USAGE);
	process.exit(0);
}

let clientId;
let clientSecret;
try {
	({ clientId, clientSecret } = spotifyCredentials(process.env));
} catch {
	console.error(
		"Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET (or the older client_id / client_secret). " +
			`Set them in ${ENV_FILES.join(" or ")} (looked in ${process.cwd()}) or in the environment.`
	);
	process.exit(1);
}

// Set before the first database call, so every exit path that may have opened
// the pool ends it.
let usedDb = false;

const endPool = async () => {
	if (!usedDb) return;
	try {
		await getDbPool().end();
	} catch {
		// Exiting anyway.
	}
};

const fail = async (message) => {
	console.error(message);
	await endPool();
	process.exit(1);
};

const isoDate = (date) => new Date(date).toISOString().split("T")[0];

// The same refresh grant lib/spotify.js sends. It is duplicated on purpose:
// that refresh is private to createSpotifyClient, whose cache, dead latch and
// store writes a one-shot check must not share.
const refreshAccessToken = async (refreshToken, { clientId, clientSecret }) => {
	let response;
	try {
		response = await fetch(TOKEN_ENDPOINT, {
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
	} catch (error) {
		throw new Error(`Token refresh failed: ${error?.name}`);
	}

	const body = (await response.json().catch(() => null)) ?? {};

	if (!response.ok && body.error === "invalid_grant") {
		throw new Error(
			"Spotify rejected the refresh token (invalid_grant): it has expired or been revoked. " +
				"Run `npm run spotify:reauth -- --save`."
		);
	}

	if (!response.ok || !body.access_token) {
		throw new Error(`Token refresh failed with ${response.status}: ${body.error ?? "unknown error"}`);
	}

	return { accessToken: body.access_token, refreshToken: body.refresh_token };
};

// --whoami: no server, no browser.
//
// Which token to check: the database row when DATABASE_URL is set and the row
// has one, else the refresh_token env var. Production lacks sql/005 until the
// rollout applies it, and until then the read fails with 42703 (undefined
// column); that one error falls back to the env var, and any other fails.
const runWhoami = async () => {
	let source; // { token, from: "database" | "env" }
	if (process.env.DATABASE_URL) {
		usedDb = true;
		try {
			const row = await readSpotifyRow();
			if (row?.deadReason) {
				await fail(
					`The stored Spotify token was marked dead (${row.deadReason}). ` +
						"Run `npm run spotify:reauth -- --save` or reconnect from /admin."
				);
			}
			if (row?.refreshToken) source = { token: row.refreshToken, from: "database" };
		} catch (error) {
			if (error?.code !== "42703") await fail(`Could not read the Spotify row: ${redact(error?.message)}`);
			console.log(
				"integration_tokens has no Spotify columns yet (sql/005 is not applied); using the refresh_token env var."
			);
		}
	} else {
		console.log("DATABASE_URL is not set; using the refresh_token env var.");
	}
	source ??= process.env.refresh_token ? { token: process.env.refresh_token, from: "env" } : null;
	if (!source) await fail("No Spotify row and no refresh_token env var: nothing to check.");

	let refreshed;
	try {
		refreshed = await refreshAccessToken(source.token, { clientId, clientSecret });
	} catch (error) {
		await fail(error.message);
	}

	// Spotify rotates the refresh token on some grants. The stored one is
	// swapped only while the row still holds the token this check sent.
	if (refreshed.refreshToken && refreshed.refreshToken !== source.token) {
		if (source.from === "database") {
			try {
				const stored = await storeRotatedRefreshToken(source.token, refreshed.refreshToken);
				console.log(
					stored
						? "Spotify rotated the refresh token; stored the new one."
						: "Spotify rotated the refresh token, but the stored one had already changed."
				);
			} catch (error) {
				console.error(`Spotify rotated the refresh token, but storing the new one failed: ${redact(error?.message)}`);
				process.exitCode = 1;
			}
		} else {
			console.log("Spotify rotated the refresh token held in the env var; the env copy may now be stale.");
		}
	}

	let profile;
	try {
		profile = await fetchSpotifyProfile(refreshed.accessToken);
	} catch (error) {
		await fail(`Could not read the Spotify account: ${error.message}`);
	}

	console.log(`Token source:       ${source.from === "database" ? "database row" : "refresh_token env var"}`);
	console.log(`Spotify account id: ${profile.id}`);
	console.log(`Display name:       ${profile.displayName ?? "(none)"}`);

	await endPool();
	process.exit();
};

if (whoami) await runWhoami();

if (save) {
	const databaseUrl = requireEnv("DATABASE_URL", fileEnv);
	let hostname;
	try {
		hostname = new URL(databaseUrl).hostname;
	} catch {
		// Not the URL error itself: it would echo the connection string.
		await fail("DATABASE_URL is not a valid URL.");
	}
	console.log(`--save will write to the database at ${hostname}.`);
}

const state = crypto.randomBytes(16).toString("hex");
const authorizeUrl = buildAuthorizeUrl({ clientId, redirectUri: REDIRECT_URI, state });

const reply = (res, status, message) => {
	res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
	res.end(message);
};

const printToken = (tokens, missing) => {
	const expiry = new Date(Date.now() + AUTHORIZATION_LIFETIME_DAYS * 24 * 60 * 60 * 1000);
	console.log("\nNew refresh token:\n");
	console.log(tokens.refreshToken);
	console.log(`\nGranted scopes: ${tokens.scopes.join(" ")}`);
	if (missing.length > 0) console.log(`Missing scopes: ${missing.join(" ")}`);
	console.log(`Expires around: ${isoDate(expiry)} (estimated: ${AUTHORIZATION_LIFETIME_DAYS} days)\n`);
	console.log(`Store it with \`npm run spotify:reauth -- --save\` next time, or reconnect at ${SITE_ORIGIN}/admin.`);
	console.log("Until the database has a Spotify row, the site reads the `refresh_token` env var: set it in .env");
	console.log("(and .env.local, which overrides .env) and in the Vercel project's env vars, then redeploy.\n");
};

// --save: the token is never printed, and nothing is written unless every
// scope was granted and the approving account is the owner's.
const saveTokens = async (tokens, missing) => {
	if (missing.length > 0) {
		console.error(`\nSpotify did not grant: ${missing.join(", ")}. Nothing was saved.`);
		process.exitCode = 1;
		return;
	}

	let accountId;
	try {
		accountId = await fetchSpotifyAccountId(tokens.accessToken);
	} catch {
		console.error("\nCould not read the Spotify account (account_lookup_failed). Nothing was saved.");
		process.exitCode = 1;
		return;
	}

	if (accountId !== OWNER_SPOTIFY_ACCOUNT_ID) {
		console.error(
			`\nApproved as Spotify account ${accountId}, not the site owner's (${OWNER_SPOTIFY_ACCOUNT_ID}). Nothing was saved.`
		);
		process.exitCode = 1;
		return;
	}

	usedDb = true;
	try {
		const { expiresAt } = await saveSpotifyAuthorization({
			refreshToken: tokens.refreshToken,
			accountId,
			scopes: tokens.scopes,
		});
		console.log(
			`\nSaved to integration_tokens (provider "spotify"). Estimated expiry: ${isoDate(expiresAt)}. ` +
				"The site picks it up within a minute; no redeploy needed."
		);
	} catch (error) {
		console.error(`\nCould not save: ${redact(error?.message)}. Nothing was saved.`);
		process.exitCode = 1;
	}
};

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
	if (url.pathname !== "/callback") return reply(res, 404, "Not found");

	const error = url.searchParams.get("error");
	if (error) {
		reply(res, 400, `Authorization failed: ${error}`);
		console.error(`\nAuthorization failed: ${error}`);
		server.close();
		process.exitCode = 1;
		return;
	}

	if (url.searchParams.get("state") !== state) {
		reply(res, 400, "State mismatch — discarding this response.");
		console.error("\nState mismatch — discarding this response. Re-run the script.");
		server.close();
		process.exitCode = 1;
		return;
	}

	let tokens;
	try {
		tokens = await exchangeCode({
			code: url.searchParams.get("code"),
			redirectUri: REDIRECT_URI,
			clientId,
			clientSecret,
		});
	} catch (exchangeError) {
		reply(res, 500, "Token exchange failed — check your terminal.");
		console.error(`\n${exchangeError.message}`);
		process.exitCode = 1;
		server.close();
		return;
	}

	const missing = missingScopes(tokens.scopes);

	if (save) {
		reply(res, 200, "Done. Check your terminal.");
		server.close();
		await saveTokens(tokens, missing);
		await endPool();
	} else {
		reply(res, 200, "Done. The refresh token is in your terminal — close this tab.");
		server.close();
		printToken(tokens, missing);
	}
});

server.on("error", (serverError) => {
	if (serverError.code === "EADDRINUSE") {
		console.error(`Port ${PORT} is already in use. Free it and re-run.`);
		process.exit(1);
	}
	throw serverError;
});

server.listen(PORT, "127.0.0.1", () => {
	console.log(`\nOpen this URL and approve access:\n\n${authorizeUrl}\n`);

	const opener = { darwin: "open", win32: "start" }[process.platform] ?? "xdg-open";
	spawn(opener, [authorizeUrl], { stdio: "ignore", detached: true }).on("error", () => {
		// No browser to launch — the printed URL is the fallback.
	});
});
