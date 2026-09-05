#!/usr/bin/env node
/**
 * Seed or inspect the stored Instagram access token.
 *
 *   npm run instagram:token                                   # show current status
 *   INSTAGRAM_ACCESS_TOKEN=<TOKEN> npm run instagram:token    # store a long-lived token
 *   INSTAGRAM_ACCESS_TOKEN=<TOKEN> npm run instagram:token -- --exchange
 *                                                             # exchange a short-lived one first
 *
 * Pass the token via the environment rather than as an argument: arguments end up
 * in shell history and in the process list.
 *
 * Get a long-lived token without any OAuth redirect flow: Meta App Dashboard ->
 * Instagram -> "API setup with Instagram business login" -> Generate token.
 *
 * After the first seed the daily cron refreshes the token on its own, so this
 * only needs re-running if the token is ever allowed to lapse past 60 days.
 */

import pg from "pg";
import { loadEnvFiles, requireEnv } from "./load-env.mjs";

const fileEnv = loadEnvFiles();
const args = process.argv.slice(2);
const exchange = args.includes("--exchange");

// Prefer the environment: a token passed as an argument is recorded verbatim in
// shell history and is visible to anyone who can run `ps`. argv still works, but
// warns, because it is the documented-elsewhere habit and silently dropping it
// would be worse than nagging about it.
const argToken = args.find((a) => !a.startsWith("--"));
const token = process.env.INSTAGRAM_ACCESS_TOKEN ?? fileEnv.INSTAGRAM_ACCESS_TOKEN ?? argToken;

if (argToken && !process.env.INSTAGRAM_ACCESS_TOKEN && !fileEnv.INSTAGRAM_ACCESS_TOKEN) {
  console.warn(
    "\nWarning: the token was passed as a command-line argument, so it is now in\n" +
      "your shell history and was visible in the process list. Prefer:\n" +
      "  INSTAGRAM_ACCESS_TOKEN=<token> npm run instagram:token\n" +
      "(a leading space keeps that out of history in most shells), then clear the\n" +
      "old entry from your history file.\n"
  );
}

const DATABASE_URL = requireEnv("DATABASE_URL", fileEnv);
const SIXTY_DAYS_SECONDS = 60 * 24 * 60 * 60;

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: true },
  max: 1,
});

const fail = async (message) => {
  console.error(message);
  await pool.end();
  process.exit(1);
};

async function validate(accessToken) {
  const res = await fetch(
    `https://graph.instagram.com/v25.0/me?fields=id,username&access_token=${encodeURIComponent(accessToken)}`
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = body?.error;
    throw new Error(
      `Token rejected: HTTP ${res.status}${e ? ` code=${e.code} ${e.message}` : ""}`
    );
  }
  return body;
}

async function exchangeForLongLived(shortLived) {
  const clientSecret = requireEnv("INSTAGRAM_CLIENT_SECRET", fileEnv);
  const url =
    "https://graph.instagram.com/access_token" +
    `?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(clientSecret)}` +
    `&access_token=${encodeURIComponent(shortLived)}`;

  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`Exchange failed: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  }
  return { accessToken: body.access_token, expiresIn: Number(body.expires_in) };
}

async function showStatus() {
  const { rows } = await pool.query(
    `select expires_at, refreshed_at, dead_reason, updated_at, expires_at_is_assumed
       from integration_tokens where provider = 'instagram'`
  );

  if (rows.length === 0) {
    console.log("\nNo Instagram token stored.\n");
    console.log("Get one from the Meta App Dashboard:");
    console.log("  Instagram -> API setup with Instagram business login -> Generate token");
    console.log("then run:  INSTAGRAM_ACCESS_TOKEN=<TOKEN> npm run instagram:token\n");
    return;
  }

  const row = rows[0];
  const daysLeft = Math.floor((new Date(row.expires_at) - Date.now()) / 86400000);

  console.log("\nStored Instagram token");
  const assumed = row.expires_at_is_assumed ? "  [ASSUMED — a refresh will correct it]" : "";
  console.log(`  expires_at:   ${new Date(row.expires_at).toISOString()}  (${daysLeft} days left)${assumed}`);
  console.log(`  refreshed_at: ${new Date(row.refreshed_at).toISOString()}`);
  if (row.dead_reason) {
    console.log(`  DEAD:         ${row.dead_reason}`);
    console.log("\n  Generate a new token in the Meta App Dashboard and re-seed it.\n");
    return;
  }

  try {
    const me = await validate(
      (await pool.query(`select access_token from integration_tokens where provider='instagram'`))
        .rows[0].access_token
    );
    console.log(`  live check:   OK (@${me.username}, id ${me.id})\n`);
  } catch (error) {
    console.log(`  live check:   FAILED — ${error.message}\n`);
  }
}

try {
  if (!token) {
    await showStatus();
  } else {
    let accessToken = token;
    let expiresIn = SIXTY_DAYS_SECONDS;
    let assumedExpiry = true;

    if (exchange) {
      const exchanged = await exchangeForLongLived(token);
      accessToken = exchanged.accessToken;
      expiresIn = exchanged.expiresIn;
      assumedExpiry = false;
      console.log(`Exchanged for a long-lived token (expires_in=${expiresIn}s).`);
    }

    const me = await validate(accessToken);
    console.log(`Token is valid for @${me.username} (id ${me.id}).`);

    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    await pool.query(
      `insert into integration_tokens
         (provider, access_token, expires_at, refreshed_at, dead_reason, expires_at_is_assumed)
       values ('instagram', $1, $2, now(), null, $3)
       on conflict (provider) do update
         set access_token          = excluded.access_token,
             expires_at            = excluded.expires_at,
             refreshed_at          = now(),
             dead_reason           = null,
             expires_at_is_assumed = excluded.expires_at_is_assumed,
             updated_at            = now()`,
      [accessToken, expiresAt, assumedExpiry]
    );

    console.log(`Stored. Expires ${expiresAt.toISOString()}.`);
    if (assumedExpiry) {
      console.log(
        "\nNote: 60 days is Meta's documented lifetime, not a value it returned here.\n" +
          "It is flagged as assumed, so the next run at least 25h from now forces a\n" +
          "refresh and replaces it with Meta's authoritative expiry."
      );
    }
    console.log("\nThe daily cron refreshes this automatically from now on.\n");
  }
} catch (error) {
  await fail(`\n${error.message}\n`);
}

await pool.end();
