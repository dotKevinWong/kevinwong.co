import { v2 as cloudinary } from "cloudinary";

// Instagram's media_url values are short-lived signed CDN URLs — they expire
// within hours, which is why the snapshots tables store Cloudinary URLs and keep
// the Instagram URL only as provenance in source_uri.
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// Matches the layout the original data-export backfill produced, e.g.
// .../upload/v1771359177/kevinwong/202512/18121631782527066_yhzcgp.jpg
const ROOT_FOLDER = "kevinwong";

/** A Date (or ISO string) -> "202512", the existing cloudinary_folder convention. */
export function folderFor(postedAt) {
  const d = postedAt instanceof Date ? postedAt : new Date(postedAt);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Best-effort file extension from an Instagram CDN URL, ignoring its query string. */
export function extensionFor(sourceUrl, kind) {
  const withoutQuery = String(sourceUrl || "").split("?")[0];
  const match = withoutQuery.match(/\.([a-z0-9]{2,5})$/i);
  if (match) return match[1].toLowerCase();
  return kind === "video" ? "mp4" : "jpg";
}

export function isMissingCredentials() {
  return (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  );
}

/**
 * Mirror one Instagram media item into Cloudinary.
 *
 * Passing the remote URL as the `file` argument makes Cloudinary fetch the bytes
 * server-side — nothing streams through the Vercel function, which keeps this
 * viable inside a serverless memory and duration budget.
 */
export async function mirrorToCloudinary({ sourceUrl, kind, postedAt, mediaId }) {
  const folder = folderFor(postedAt);

  const result = await cloudinary.uploader.upload(sourceUrl, {
    // Deterministic id, so a re-run of a partially-failed sync overwrites the
    // same asset instead of creating a duplicate. Signed uploads default to
    // overwrite: true, but state it rather than rely on the default.
    public_id: `${ROOT_FOLDER}/${folder}/${mediaId}`,
    overwrite: true,
    invalidate: true,
    unique_filename: false,
    use_filename: false,
    // Explicit beats "auto": auto has to sniff the URL, and Instagram video URLs
    // do not always carry an obvious extension.
    resource_type: kind === "video" ? "video" : "image",
    timeout: 120000,
  });

  return {
    publicId: result.public_id,
    url: result.secure_url,
    version: result.version ? Number(result.version) : null,
    resourceType: result.resource_type || null,
    format: result.format || null,
    width: result.width ? Number(result.width) : null,
    height: result.height ? Number(result.height) : null,
    // Only videos carry a duration.
    duration: result.duration != null ? Number(result.duration) : null,
    // Computed locally, never read back from the response: Cloudinary only
    // returns `folder` in fixed-folder product environments and `asset_folder`
    // in dynamic-folder ones, and cloudinary_folder is NOT NULL.
    folder,
  };
}

export default cloudinary;
