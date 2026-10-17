// pages/api/admin/spotify/callback.js
import { handleSpotifyCallback } from "../../../../lib/admin/spotify-reconnect";

// Body parser off: nothing may answer before the 404 gate (D1), and this route never reads a body.
export const config = { api: { bodyParser: false } };

// GET from Spotify's redirect: clears the state cookie, checks it, stores the new token, 303 to /admin.
export default function handler(req, res) {
  return handleSpotifyCallback(req, res);
}
