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
    ];
  },
};

module.exports = nextConfig;
