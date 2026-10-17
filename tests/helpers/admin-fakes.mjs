// Fake Next.js req/res and injected auth/db for admin route tests (no HTTP server, no module mocks).
export const PROD_ENV = Object.freeze({ VERCEL_ENV: "production" });

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
