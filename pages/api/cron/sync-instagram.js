import { syncInstagram } from "../../../lib/instagram-sync";
import { InstagramReauthRequiredError } from "../../../lib/instagram";

export const config = {
  // Mirroring a backlog of carousels means several Cloudinary round trips per
  // post. Hobby projects with Fluid compute allow up to 300s; without Fluid the
  // ceiling is 60s and the DEFAULT is only 10s, which this job would blow
  // through — so set it explicitly either way.
  maxDuration: 300,
};

export default async function handler(req, res) {
  // A cached response is invisible in Vercel's logs and can stop a cron from
  // appearing to run at all.
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.CRON_SECRET;

  // Fail closed. Vercel documents that it sends CRON_SECRET as a bearer token
  // when the variable is set, but documents nothing about the unset case — so
  // an absent secret is treated as a misconfiguration, never as "allow all".
  // Otherwise this route would be an unauthenticated endpoint that writes to the
  // database and spends Cloudinary quota.
  if (!secret) {
    console.error("[cron/sync-instagram] CRON_SECRET is not set; refusing to run.");
    return res.status(500).json({ error: "CRON_SECRET is not configured" });
  }

  if (req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true";

  try {
    const summary = await syncInstagram({ dryRun });

    console.log(
      `[cron/sync-instagram] fetched=${summary.fetched} new=${summary.inserted.length} ` +
        `present=${summary.alreadyPresent} uploads=${summary.uploads} ` +
        `deferred=${summary.deferred} skipped=${summary.skipped.length} errors=${summary.errors.length}`
    );

    // Surface per-post failures in the response as well as the logs; the run as
    // a whole still succeeded, and tomorrow will retry them.
    return res.status(200).json(summary);
  } catch (error) {
    if (error instanceof InstagramReauthRequiredError) {
      // lib/instagram.js has already logged what to do and marked the token dead
      // so no further API calls are attempted until a new one is seeded.
      return res.status(503).json({
        error: "Instagram re-authorization required",
        detail: error.message,
      });
    }

    console.error("[cron/sync-instagram] failed:", error);
    return res.status(500).json({ error: "Sync failed", detail: error.message });
  }
}
