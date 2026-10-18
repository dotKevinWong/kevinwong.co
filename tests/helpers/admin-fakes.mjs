// Fake Next.js req/res and injected auth/db for admin route tests (no HTTP server, no module mocks), and the
// constants those tests share.
export const PROD_ENV = Object.freeze({ VERCEL_ENV: "production" });

// No auth configuration and no database: a route that reached getAuth() or getDbPool() under it would throw and log.
export const NO_AUTH_ENV = Object.freeze({
  VERCEL_ENV: undefined, NODE_ENV: undefined, DATABASE_URL: undefined,
  BETTER_AUTH_URL: undefined, BETTER_AUTH_SECRET: undefined, GITHUB_CLIENT_ID: undefined, GITHUB_CLIENT_SECRET: undefined,
});

// lib/admin/guard.js's Cache-Control for every admin answer.
export const NO_STORE = "private, no-store, max-age=0, must-revalidate";

// A failure as pg reports it: a credential in the message and a `detail`, neither of which may be logged. A route
// logs it as REDACTED_LINE, describeError's one redacted line.
export const LEAKY_MESSAGE = "password authentication failed for postgresql://kw_owner:npg_hunter2@db.example.test/neondb";
export const REDACTED_LINE = "Error [28P01]: password authentication failed for postgresql://[redacted]@db.example.test/neondb";
export const leakyError = () =>
  Object.assign(new Error(LEAKY_MESSAGE), { code: "28P01", detail: "Key (refresh_token)=(detail-secret)" });

// The rule both "filled in" tests hold OWNER_SPOTIFY_ACCOUNT_ID to: a Spotify user id, never the placeholder.
export const FILLED_SPOTIFY_ACCOUNT_ID = /^[A-Za-z0-9._-]{1,64}$/;

export function fakeReq({ method = "GET", host = "www.kevinwong.co", origin, cookie, query = {}, url = "/" } = {}) {
  const headers = { host };
  if (origin !== undefined) headers.origin = origin;
  if (cookie !== undefined) headers.cookie = cookie;
  return { method, headers, query, url };
}

export function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: undefined, ended: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    getHeader(name) { return this.headers[name.toLowerCase()]; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.ended = true; return this; },
    end() { this.ended = true; return this; },
  };
}

export const OWNER_SESSION = Object.freeze({
  user: { id: "user-1", name: "Kevin Wong", email: "1741711@github.placeholder.invalid", image: "https://avatars.githubusercontent.com/u/1741711?v=4" },
  session: { id: "session-1", userId: "user-1", token: "session-token", expiresAt: new Date("2026-10-17T12:00:00.000Z") },
});

// What getOwnerSession returns for OWNER_SESSION, and what a faked requireAdmin hands a route.
export const OWNER = Object.freeze({ name: "Kevin Wong", image: "https://avatars.githubusercontent.com/u/1741711?v=4" });

export function fakeAuth(session = OWNER_SESSION) {
  const calls = [];
  return { calls, api: { async getSession(args) { calls.push(args); return session; } } };
}

/**
 * Runs fn with process.env changed by vars (undefined deletes a key), then puts every key named in vars
 * back as it was, including any fn changed itself.
 */
export async function withEnv(vars, fn) {
  const saved = Object.keys(vars).map((key) => [key, key in process.env, process.env[key]]);
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await fn();
  } finally {
    for (const [key, had, value] of saved) {
      if (had) process.env[key] = value;
      else delete process.env[key];
    }
  }
}

export function fakeDb(rowCount = 1) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount, rows: Array.from({ length: rowCount }, () => ({ "?column?": 1 })) };
    },
  };
}
