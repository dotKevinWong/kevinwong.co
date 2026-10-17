import { betterAuth } from "better-auth";
import { waitUntil } from "@vercel/functions";
import { getDbPool } from "./db.js";
import { redact } from "./redact.js";
import { OWNER_GITHUB_ID, SITE_ORIGIN } from "./admin/owner.js";
import { OWNER_ACTOR, logAdminEvent, logRejectedSignIn } from "./admin/audit-log.js";

// Better Auth for /admin: GitHub sign-in, and only the owner's GitHub id gets
// in. Server code only: import it from pages/api/** and getServerSideProps,
// never from a component. It does not import `server-only`, because the Better
// Auth CLI (scripts/auth.config.mjs) loads this file and cannot resolve it.

const NOT_OWNER = Object.freeze({
  error: "not_owner",
  errorDescription: "This GitHub account can't sign in here.",
});

// The second layer behind the allowlist in pages/api/auth/[...all].js. Better
// Auth matches these exactly, and only in its router, so the route's allowlist
// is what actually keeps every other path out.
const DISABLED_PATHS = [
  "/get-session",
  "/list-sessions",
  "/update-session",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/link-social",
  "/unlink-account",
  "/get-access-token",
  "/refresh-token",
  "/list-accounts",
  "/account-info",
  "/update-user",
  "/delete-user",
  "/change-email",
  "/change-password",
  "/sign-in/email",
  "/sign-up/email",
  "/error",
];

/**
 * user.validateUserInfo: lets the owner's GitHub account through and refuses
 * everyone else. Synchronous, so the refusal never waits on the database; the
 * rejected sign-in is logged in the background. Returns undefined or NOT_OWNER,
 * never false, which Better Auth would treat as a pass. Better Auth calls it
 * with (data, context); the third argument exists for the tests.
 */
export function validateOwner({ source }, context, { logRejected = logRejectedSignIn, schedule = waitUntil } = {}) {
  const profile = source?.oauth?.profile;
  if (
    source?.method === "oauth" &&
    source.oauth?.providerId === "github" &&
    String(profile?.id ?? "") === OWNER_GITHUB_ID
  ) {
    return undefined;
  }
  schedule(
    Promise.resolve()
      .then(() => logRejected({ githubId: String(profile?.id ?? "unknown"), login: profile?.login ?? null }))
      .catch((error) => console.error("[auth] could not log a rejected sign-in:", redact(error?.message)))
  );
  return NOT_OWNER;
}

/** GitHub sign-in requests no scopes, so the profile's email is often null; Better Auth needs one. */
export const githubProfileToUser = (p) => ({
  email: p.email ?? `${p.id}@github.placeholder.invalid`,
  name: p.name ?? p.login,
});

export function buildAuthOptions({ env = process.env, db } = {}) {
  if (env.NODE_ENV === "production") {
    if (!env.BETTER_AUTH_URL) throw new Error("BETTER_AUTH_URL is not set");
    if (env.BETTER_AUTH_URL !== SITE_ORIGIN) throw new Error(`BETTER_AUTH_URL must be ${SITE_ORIGIN}`);
    if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
      throw new Error("BETTER_AUTH_SECRET must be set to at least 32 characters");
    }
  }

  return {
    appName: "kevinwong.co admin",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: db ?? getDbPool(),
    emailAndPassword: { enabled: false },
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        disableDefaultScope: true,
        mapProfileToUser: githubProfileToUser,
      },
    },
    user: { modelName: "auth_user", validateUserInfo: validateOwner },
    session: {
      modelName: "auth_session",
      expiresIn: 86_400,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    account: {
      modelName: "auth_account",
      accountLinking: { enabled: false },
      storeStateStrategy: "cookie",
      encryptOAuthTokens: true,
    },
    verification: { modelName: "auth_verification" },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            waitUntil(
              logAdminEvent("sign_in", {
                actor: OWNER_ACTOR,
                details: { ipAddress: session.ipAddress ?? null, userAgent: session.userAgent ?? null },
              }).catch((error) => console.error("[auth] could not log sign_in:", redact(error?.message)))
            );
          },
        },
      },
    },
    onAPIError: { errorURL: "/admin/sign-in" },
    rateLimit: { enabled: true, storage: "memory" },
    telemetry: { enabled: false },
    disabledPaths: DISABLED_PATHS,
    advanced: {
      // Sign-in runs only in production, where the https baseURL already gives the __Secure- prefix; this
      // makes the integration tests see the same cookie names.
      useSecureCookies: true,
      backgroundTasks: {
        handler: (promise) =>
          waitUntil(Promise.resolve(promise).catch(() => console.error("[auth] a background task failed"))),
      },
    },
  };
}

let instance;

/** The Better Auth instance, built on first use: betterAuth() checks the secret and reads the database at once. */
export function getAuth() {
  instance ??= betterAuth(buildAuthOptions());
  return instance;
}
