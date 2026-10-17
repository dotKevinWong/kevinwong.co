// pages/api/admin/spotify/authorize.js
import { handleSpotifyAuthorize } from "../../../../lib/admin/spotify-reconnect";

// Body parser off: nothing may answer before the 404 gate (D1), and this route never reads a body.
export const config = { api: { bodyParser: false } };

// POST from the panel's Reconnect form: owner + same-origin check, state cookie, 303 to Spotify.
export default function handler(req, res) {
  return handleSpotifyAuthorize(req, res);
}
