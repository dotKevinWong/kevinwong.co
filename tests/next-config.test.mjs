import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextConfig = require("../next.config.js");
const { getPathMatch } = require("next/dist/shared/lib/router/utils/path-match");

const ADMIN_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

// Next applies every matching rule in array order; for a repeated key the later rule wins.
function effectiveHeaders(rules, path) {
  const out = new Map();
  for (const rule of rules) if (getPathMatch(rule.source)(path)) for (const { key, value } of rule.headers) out.set(key.toLowerCase(), value);
  return out;
}

test("the admin header rules come after the generic rule", async () => {
  const rules = await nextConfig.headers();
  assert.equal(rules[0].source, "/((?!_next/).*)");
  assert.deepEqual(rules.slice(1).map((r) => r.source), ["/admin/:path*", "/api/admin/:path*", "/api/auth/:path*"]);
  for (const rule of rules.slice(1)) assert.deepEqual(rule.headers, ADMIN_HEADERS);
});

test("admin header keys use the generic rule's casing and no rule sets Cache-Control", async () => {
  const rules = await nextConfig.headers();
  const genericKeys = new Map(rules[0].headers.map(({ key }) => [key.toLowerCase(), key]));
  for (const { key } of rules.slice(1).flatMap((r) => r.headers)) {
    if (genericKeys.has(key.toLowerCase())) assert.equal(key, genericKeys.get(key.toLowerCase()));
  }
  assert.ok(rules.flatMap((r) => r.headers).every(({ key }) => key.toLowerCase() !== "cache-control"));
});

test("admin and auth paths deny framing and indexing; public paths keep 'self'", async () => {
  const rules = await nextConfig.headers();
  for (const path of ["/admin", "/admin/sign-in", "/api/admin/status", "/api/admin/spotify/callback", "/api/auth/callback/github"]) {
    const h = effectiveHeaders(rules, path);
    assert.equal(h.get("content-security-policy"), "frame-ancestors 'none'", path);
    assert.equal(h.get("x-frame-options"), "DENY", path);
    assert.equal(h.get("x-robots-tag"), "noindex, nofollow", path);
    assert.equal(h.get("x-content-type-options"), "nosniff", path);
  }
  for (const path of ["/", "/blog", "/administrator", "/api/nowplaying"]) {
    const h = effectiveHeaders(rules, path);
    assert.equal(h.get("content-security-policy"), "frame-ancestors 'self'", path);
    assert.equal(h.has("x-robots-tag"), false, path);
  }
});
