#!/usr/bin/env node
/**
 * Mints a fresh Spotify refresh token.
 *
 * Spotify expires user refresh tokens six months after the original
 * authorization, and refreshing does not extend that window — so this has to be
 * re-run roughly twice a year, ideally before the current token dies rather
 * than after.
 *
 *   npm run spotify:reauth
 *
 * Requires `http://127.0.0.1:8888/callback` in the app's Redirect URIs at
 * https://developer.spotify.com/dashboard (Spotify rejects `localhost`; the
 * loopback IP literal is required).
 */

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const PORT = 8888;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;

// Everything pages/api/{nowplaying,toptracks,listeningtimeline}.js reads.
const SCOPES = [
	"user-read-currently-playing",
	"user-top-read",
	"user-read-recently-played",
].join(" ");

// Next.js reads these automatically; a bare node script does not. Lowest
// precedence first, matching Next's own ordering.
const ENV_FILES = [".env", ".env.local"];

const parseEnvFile = (envPath) => {
	if (!fs.existsSync(envPath)) return {};

	return Object.fromEntries(
		fs
			.readFileSync(envPath, "utf8")
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith("#"))
			.map((line) => {
				const separator = line.indexOf("=");
				if (separator === -1) return null;
				const key = line.slice(0, separator).trim();
				const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
				return [key, value];
			})
			.filter(Boolean)
	);
};

const loadEnvFiles = () =>
	ENV_FILES.reduce(
		(merged, file) => ({ ...merged, ...parseEnvFile(path.join(process.cwd(), file)) }),
		{}
	);

const fileEnv = loadEnvFiles();
const client_id = process.env.client_id ?? fileEnv.client_id;
const client_secret = process.env.client_secret ?? fileEnv.client_secret;

if (!client_id || !client_secret) {
	console.error(
		`Missing client_id / client_secret. Set them in ${ENV_FILES.join(" or ")} ` +
			`(looked in ${process.cwd()}) or in the environment.`
	);
	process.exit(1);
}

const state = crypto.randomBytes(16).toString("hex");

const authorizeUrl =
	"https://accounts.spotify.com/authorize?" +
	new URLSearchParams({
		client_id,
		response_type: "code",
		redirect_uri: REDIRECT_URI,
		scope: SCOPES,
		state,
		// Force the consent screen so this works even while the old token lives.
		show_dialog: "true",
	});

const exchangeCode = async (code) => {
	const response = await fetch("https://accounts.spotify.com/api/token", {
		method: "POST",
		headers: {
			Authorization: `Basic ${Buffer.from(`${client_id}:${client_secret}`).toString("base64")}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: REDIRECT_URI,
		}),
	});

	const body = await response.json();

	if (!response.ok) {
		throw new Error(
			`Token exchange failed with ${response.status}: ${body.error_description ?? body.error}`
		);
	}

	return body;
};

const reply = (res, status, message) => {
	res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
	res.end(message);
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

	try {
		const tokens = await exchangeCode(url.searchParams.get("code"));
		reply(res, 200, "Done. The refresh token is in your terminal — close this tab.");

		const expiry = new Date(Date.now() + 183 * 24 * 60 * 60 * 1000);
		console.log("\nNew refresh token:\n");
		console.log(tokens.refresh_token);
		console.log(`\nGranted scopes: ${tokens.scope}`);
		console.log(`Expires around: ${expiry.toISOString().split("T")[0]} (six months)\n`);
		console.log("Set it as `refresh_token` in .env.local and in the Vercel project");
		console.log("env vars, then redeploy — env var changes need a deploy to take effect.\n");
	} catch (exchangeError) {
		reply(res, 500, "Token exchange failed — check your terminal.");
		console.error(`\n${exchangeError.message}`);
		process.exitCode = 1;
	}

	server.close();
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
