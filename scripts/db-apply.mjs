#!/usr/bin/env node
/**
 * Apply SQL migration files to a database, each file on its own connection.
 *
 *   npm run db:apply -- --yes sql/005_a.sql sql/006_b.sql        # production, from DATABASE_URL
 *   npm run db:apply -- --url-env TEST_DATABASE_URL sql/005_a.sql # any other variable, used as given
 *
 * Without --url-env it reads DATABASE_URL from the environment, then .env and
 * .env.local in the current directory, and strips Neon's -pooler itself: the
 * pooler runs PgBouncer in transaction mode, and migrations need the direct
 * host. It prints the target (host and database, never the user or password)
 * and refuses any non-local database unless --yes comes after the `--`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { sslFor } from "../lib/db.js";
import { loadEnvFiles } from "./load-env.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const USAGE = [
  "Usage: npm run db:apply -- [--url-env NAME] [--yes] <file.sql>...",
  "Put --yes after the --. npm keeps a --yes placed before it, so the script never sees it.",
].join("\n");

const POOLER_LABEL = /^([^.]+)-pooler\./;

/** The same URL with a trailing -pooler removed from the first host label. */
export function directUrlFrom(databaseUrl) {
  const url = new URL(databaseUrl);
  url.hostname = url.hostname.replace(POOLER_LABEL, "$1.");
  return url.href;
}

export function isPoolerUrl(connectionString) {
  return POOLER_LABEL.test(new URL(connectionString).hostname);
}

/** host[:port]/database, never the user or the password. */
export function describeTarget(connectionString) {
  const { hostname, port, pathname } = new URL(connectionString);
  return `${hostname}${port ? ":" + port : ""}/${decodeURIComponent(pathname.slice(1))}`;
}

const usageError = (message) => new Error(`${message}\n${USAGE}`);

export function parseArgs(argv) {
  const files = [];
  let urlEnv = null;
  let yes = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--yes") {
      yes = true;
    } else if (arg === "--url-env") {
      const name = argv[i + 1];
      if (!name || name.startsWith("--")) throw usageError("--url-env needs a variable name");
      urlEnv = name;
      i++;
    } else if (arg.startsWith("-")) {
      throw usageError(`Unknown option ${arg}`);
    } else if (!arg.endsWith(".sql")) {
      throw usageError(`Not an .sql file: ${arg}`);
    } else {
      files.push(arg);
    }
  }

  if (files.length === 0) throw usageError("No .sql files given");
  return { files, urlEnv, yes };
}

/**
 * env[urlEnv] as given, or else the direct form of env.DATABASE_URL. Refuses an
 * unset variable and a pooler host.
 */
export function resolveTargetUrl({ urlEnv }, env) {
  const name = urlEnv ?? "DATABASE_URL";
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);

  const url = urlEnv ? value : directUrlFrom(value);
  if (isPoolerUrl(url)) {
    throw new Error(
      `Refusing ${describeTarget(url)}: a -pooler host runs in transaction mode; migrations need the direct host`
    );
  }
  return url;
}

export async function applySqlFiles(connectionString, files, { log = console.log } = {}) {
  // One fresh client per file, by design: pg_dump's output runs
  // set_config('search_path', '', false) for the rest of its session, and a
  // failed `begin; … commit;` file leaves its connection in an aborted
  // transaction (25P02).
  for (const file of files) {
    const sql = fs.readFileSync(file, "utf8");
    const name = path.relative(ROOT, path.resolve(file));
    const client = new pg.Client({ connectionString, ssl: sslFor(connectionString) });
    await client.connect();
    try {
      // No parameters, so pg uses the simple-query protocol: a file's statements run as one implicit
      // transaction (or in the file's own begin/commit) and a failure rolls the file back.
      await client.query(sql);
    } catch (err) {
      throw new Error(`${name}: ${err.message}`, { cause: err });
    } finally {
      await client.end();
    }
    log(`applied ${name}`);
  }
}

async function main(argv) {
  let args;
  let url;
  try {
    args = parseArgs(argv);
    // The real environment wins over the env files, as in requireEnv.
    url = resolveTargetUrl(args, { ...loadEnvFiles(), ...process.env });
  } catch (err) {
    console.error(err.message);
    return 1;
  }

  console.log(`Target: ${describeTarget(url)}`);
  console.log(`Files:  ${args.files.join(", ")}`);

  // npm keeps a --yes that comes before the `--` for itself, so the script
  // never sees it. Refusing is the safe result of that mistake.
  if (sslFor(url) !== false && !args.yes) {
    console.error("Not a local database. Re-run with --yes (after `--`) to apply.");
    return 1;
  }

  try {
    await applySqlFiles(url, args.files);
  } catch (err) {
    console.error(err.message);
    return 1;
  }
  return 0;
}

// process.exitCode rather than process.exit(), so output written to a pipe is
// flushed before the process ends.
if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
