import { toNodeHandler } from "better-auth/node";
import { getAuth } from "../../../lib/auth";
import { forwardAuthRequest, isAdminEnabled, isAllowedAuthRequest, setNoStore } from "../../../lib/admin/guard";

// Better Auth reads the raw body itself.
export const config = { api: { bodyParser: false } };

// Only start sign-in, GitHub's callback and sign-out reach Better Auth, and only in production on www.
// Everything else (get-session returns the raw session token) is a 404 before Better Auth runs.
// forwardAuthRequest pins X-Forwarded-Proto to https (better-call builds Better Auth's URL from it), and turns an
// error thrown out of Better Auth (onAPIError.throw) into one redacted log line and a 500.
export default async function handler(req, res) {
  setNoStore(res);
  if (!isAdminEnabled(req) || !isAllowedAuthRequest(req.method, req.url)) {
    return res.status(404).json({ error: "not_found" });
  }
  return forwardAuthRequest(req, res, (request, response) => toNodeHandler(getAuth())(request, response));
}
