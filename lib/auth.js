import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
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
// is what actually keeps every other path out. Every entry is a router path in
// Better Auth 1.7.10. /verify-email matters most: with the secret, its JWT
// mints a session without validateOwner. /reset-password/:token can't be
// listed (exact match), but it needs an auth_verification row, which this
// configuration never writes.
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
  "/verify-email",
  "/send-verification-email",
  "/request-password-reset",
  "/reset-password",
  "/verify-password",
  "/delete-user/callback",
  "/ok",
];

// The keys the sign-in page sends to /sign-in/social, and the other redirect
// options. Anything else is refused: `scopes` would widen what GitHub grants
// (and fill in Kevin's real email), and `idToken`, `loginHint`, `requestSignUp`
// and `additionalData` are sign-in features this app doesn't use.
const SIGN_IN_SOCIAL_KEYS = new Set(["provider", "callbackURL", "errorCallbackURL", "newUserCallbackURL", "disableRedirect"]);

/** hooks.before: refuses a /sign-in/social body that isn't a plain GitHub sign-in. */
const refuseUnreviewedSignIn = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== "/sign-in/social") return;
  const body = ctx.body;
  const allowed =
    body !== null &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    body.provider === "github" &&
    Object.keys(body).every((key) => SIGN_IN_SOCIAL_KEYS.has(key));
  if (!allowed) {
    throw new APIError("BAD_REQUEST", { code: "SIGN_IN_REQUEST_NOT_ALLOWED", message: "This sign-in request isn't allowed." });
  }
});

// Better Auth's default logger prints its arguments as they are, Error objects
// (stack, pg's err.detail) included. This one writes a single redacted line.
const describeError = (error) =>
  redact(`${error?.name || "Error"}${error?.code ? ` [${error.code}]` : ""}: ${error?.message || String(error)}`);

function describeLogPart(value) {
  try {
    return value instanceof Error ? describeError(value) : redact(String(value));
  } catch {
    return "[unprintable]";
  }
}

function logBetterAuth(level, message, ...args) {
  const line = `[better-auth] ${level}: ${[message, ...args].map(describeLogPart).join(" ")}`.replace(/\s+/g, " ").trim();
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

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
    // Better Auth reads these two from process.env itself, past these options: the first widens the
    // trusted origins, and the second replaces the secret checked above. This app uses neither.
    for (const name of ["BETTER_AUTH_TRUSTED_ORIGINS", "BETTER_AUTH_SECRETS"]) {
      if (env[name] !== undefined) throw new Error(`${name} must not be set`);
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
    hooks: { before: refuseUnreviewedSignIn },
    // throw: an error that is not an APIError rejects out of auth.handler instead of reaching better-call's
    // router, which would print the raw Error (stack, pg's err.detail) and answer a blank 500. The caller,
    // pages/api/auth/[...all].js, must catch it. APIError answers (redirects, 400, 403) are unchanged.
    onAPIError: { errorURL: "/admin/sign-in", throw: true },
    // Better Auth's default level (warn) is kept.
    logger: { log: logBetterAuth },
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
