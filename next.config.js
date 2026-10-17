// Admin and auth routes: no framing at all, no indexing. Listed after the generic rule
// because Next applies matching rules in order and the later value wins for a repeated key
// (Content-Security-Policy here). Same key casing as the generic rule. No Cache-Control
// rule: the handlers send no-store themselves (lib/admin/guard.js setNoStore).
const ADMIN_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The Spotify credentials (client_id, client_secret, refresh_token) are read from
  // process.env at runtime by lib/spotify.js. Don't list them under `env` here: that
  // inlines their values into the compiled output, client bundles included.
  async headers() {
    return [
      {
        // Pages, API routes and public/ files. Next's own /_next/ assets are left
        // out: `next dev` serves some of its scripts as application/json, which
        // nosniff would make the browser refuse to run.
        source: "/((?!_next/).*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
      { source: "/admin/:path*", headers: ADMIN_HEADERS },
      { source: "/api/admin/:path*", headers: ADMIN_HEADERS },
      { source: "/api/auth/:path*", headers: ADMIN_HEADERS },
    ];
  },
};

module.exports = nextConfig;
