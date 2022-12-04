/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    client_id: process.env.client_id,
    client_secret: process.env.client_secret,
    refresh_token: process.env.refresh_token,
  }
}

module.exports = nextConfig
