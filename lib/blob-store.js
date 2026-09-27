import { head, put } from "@vercel/blob";

// Vercel Blob is plain storage: unlike Cloudinary it neither fetches a remote
// URL for us nor reports dimensions. So the caller downloads the bytes, measures
// them with lib/media-probe.js, and hands the buffer to uploadToBlob().

// The SDK retries failed uploads 10 times by default with an uncapped
// exponential backoff (1s, 2s ... 512s, each randomised up to 2x), which adds
// up to well over the cron's 300s maxDuration. During a Blob outage the function
// would be killed mid-backoff and return nothing. Three retries is ~12s. The SDK
// reads this at call time, so setting it here takes effect; an explicit value in
// the environment still wins.
process.env.VERCEL_BLOB_RETRIES ??= "3";

// Public: /snapshots serves these straight into <img>/<video>. A private store
// would route every view through a Function and bill the bytes twice.
const ACCESS = "public";

// Each pathname holds one Instagram media item forever, so browsers may cache
// it for a year. (Blob's default is 30 days; its minimum is 60s.)
const CACHE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const DOWNLOAD_TIMEOUT_MS = 60_000;
const UPLOAD_TIMEOUT_MS = 90_000;

// Instagram videos are at most ~15 MB today. Anything far beyond that is not
// media we want to mirror into a 1 GB Hobby store.
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

export function isBlobConfigured() {
  // In a deployed function the SDK can also authenticate with OIDC, which needs
  // BLOB_STORE_ID; locally (project not linked) it needs the read-write token.
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

/** A Date (or ISO string) -> "202512". Matches the folders the original import used. */
export function folderFor(postedAt) {
  const d = postedAt instanceof Date ? postedAt : new Date(postedAt);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Where one media item lives in the store, e.g. snapshots/202512/DS3aHQajYlN-0.jpg
 *
 * Deterministic, so a re-run after a partial failure overwrites the same object
 * instead of leaving an orphan; legible, so the store's file browser maps
 * straight back to Instagram (the shortcode is the post's URL) and to a
 * carousel slide (the position).
 */
export function pathnameFor({ postedAt, shortcode, position, ext }) {
  return `snapshots/${folderFor(postedAt)}/${shortcode}-${position}.${ext}`;
}

/**
 * Download a URL into memory.
 *
 * Buffered rather than streamed on purpose: the probe needs the bytes anyway,
 * and the Blob SDK can only retry an upload whose body it can resend — a
 * consumed stream fails with "Response body object should not be disturbed or
 * locked" on the first retry instead of retrying.
 */
export async function downloadMedia(url, { timeoutMs = DOWNLOAD_TIMEOUT_MS } = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }

  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Download refused: ${declared} bytes exceeds ${MAX_DOWNLOAD_BYTES}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Download refused: ${buffer.length} bytes exceeds ${MAX_DOWNLOAD_BYTES}`);
  }
  return buffer;
}

/**
 * Upload a buffer to a fixed pathname, replacing whatever is there.
 *
 * The time bound is an AbortController on a timer, deliberately not
 * AbortSignal.timeout(): the SDK only stops retrying on an AbortError, and
 * AbortSignal.timeout() raises a TimeoutError, which it treats as retryable —
 * each later attempt then fails instantly and sleeps through the backoff.
 */
export async function uploadToBlob(pathname, buffer, contentType, { timeoutMs = UPLOAD_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await put(pathname, buffer, {
      access: ACCESS,
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: CACHE_MAX_AGE_SECONDS,
      abortSignal: controller.signal,
    });
    return { url: result.url, pathname: result.pathname, contentType: result.contentType };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cheap end-to-end credential check: one head() on an object known to exist.
 * Returns "ok" or a short reason. Costs one Blob simple operation.
 */
export async function checkBlobAccess(pathname) {
  if (!isBlobConfigured()) return "not configured (no BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID)";
  if (!pathname) return "configured, nothing stored yet to check against";
  try {
    await head(pathname);
    return "ok";
  } catch (error) {
    return `${error.name}: ${error.message}`;
  }
}
