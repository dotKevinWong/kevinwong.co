import sharp from "sharp";

// The Instagram API hands out full-resolution originals — up to 4096px and
// ~1.4 MB each — while /snapshots shows them in a 320px card. The posts that
// came from the data export are 1440px wide at ~287 KB on average, so new ones
// are brought into line before they are stored. That matters beyond page
// weight: on the Hobby plan, Blob's monthly transfer allowance is a hard stop.

// 1440 wide matches the export-era photos. The height allows Instagram's
// tallest feed format, 3:4 portrait (1440x1920): 14 of the export-era photos
// are exactly that, and a lower cap would shrink new 3:4 photos narrower than
// the old ones. 4:5 portraits come out 1440x1800, landscapes 1440 wide.
export const MAX_WIDTH = 1440;
export const MAX_HEIGHT = 1920;

// Chosen by measurement: on the API's 4096px originals, mozjpeg at quality 80
// averaged 289 KiB against the export-era average of 287 KiB. That is an
// average to match, not a per-file cap — the export-era files themselves range
// from 84 KiB to over 1 MiB.
const JPEG_OPTIONS = { quality: 80, mozjpeg: true };

// Syncs never overlap (see the run lease in lib/instagram-sync.js), so libvips'
// operation cache would only hold decoded images in memory between invocations
// of a warm instance.
sharp.cache(false);

/**
 * Whether a probed image needs re-encoding before it is stored.
 *
 * A JPEG already within 1440x1920 is kept byte-for-byte: re-encoding it would
 * only lose quality. Anything larger, anything that is not a JPEG, and anything
 * whose size the probe could not read goes through resizeForWeb().
 */
export function needsResize(probe) {
  if (probe.format !== "jpeg") return true;
  if (!probe.width || !probe.height) return true;
  return probe.width > MAX_WIDTH || probe.height > MAX_HEIGHT;
}

/**
 * Downscale to fit within 1440x1920 and re-encode as JPEG.
 *
 * autoOrient() applies any EXIF rotation to the pixels first (the output
 * carries no EXIF, so it must not rely on the tag), then the image is shrunk —
 * never enlarged — to fit inside the box. JPEG has no transparency, so any alpha
 * is flattened onto white. sharp converts embedded colour profiles to sRGB and
 * strips metadata by default, which is what a web image should be.
 *
 * Returns the new bytes and their real dimensions, which are what the page's
 * aspect-ratio frame must use.
 */
export async function resizeForWeb(buffer) {
  const { data, info } = await sharp(buffer, { failOn: "error" })
    .autoOrient()
    .resize({ width: MAX_WIDTH, height: MAX_HEIGHT, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg(JPEG_OPTIONS)
    .toBuffer({ resolveWithObject: true });

  return { buffer: data, width: info.width, height: info.height, ext: "jpg", mime: "image/jpeg" };
}
