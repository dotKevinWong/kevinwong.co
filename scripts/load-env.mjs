import fs from "node:fs";
import path from "node:path";

// Next.js reads these automatically; a bare node script does not. Lowest
// precedence first, matching Next's own ordering.
export const ENV_FILES = [".env", ".env.local"];

function parseEnvFile(envPath) {
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
}

/** Merged contents of .env then .env.local, relative to the current directory. */
export function loadEnvFiles() {
  return ENV_FILES.reduce(
    (merged, file) => ({ ...merged, ...parseEnvFile(path.join(process.cwd(), file)) }),
    {}
  );
}

/**
 * Read a variable from the real environment first, then the env files.
 * Exits with a clear message when a required variable is missing.
 */
export function requireEnv(name, fileEnv = loadEnvFiles()) {
  const value = process.env[name] ?? fileEnv[name];
  if (!value) {
    console.error(
      `Missing ${name}. Set it in ${ENV_FILES.join(" or ")} (looked in ${process.cwd()}) or in the environment.`
    );
    process.exit(1);
  }
  return value;
}
