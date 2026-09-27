import sharp from "sharp";

// The Instagram API hands out full-resolution originals — up to 4096px and
// ~1.4 MB each — while /snapshots shows them in a 320px card. The posts that
// came from the data export are 1440px wide at ~287 KB, so new ones are brought
// into line before they are stored. That matters beyond page weight: on the
// Hobby plan, Blob's monthly transfer allowance is a hard stop.

// Instagram's own maximum for a feed photo (4:5 portrait at 1440 wide), which
// is exactly what the export-era originals are.
export const MAX_WIDTH = 1440;
export const MAX_HEIGHT = 1800;

// Chosen by measurement: on the API's 4096px originals, mozjpeg at quality 80
// averaged 289 KB against the export-era average of 287 KB.
const JPEG_OPTIONS = { quality: 80, mozjpeg: true };

// A warm serverless instance handles one sync at a time; libvips' operation
// cache would only hold decoded images in memory between invocations.
sharp.cache(false);

/**
 * Whether a probed image needs re-encoding before it is stored.
 *
 * A JPEG already within 1440x1800 is kept byte-for-byte: re-encoding it would
 * only lose quality. Anything larger, anything that is not a JPEG, and anything
 * whose size the probe could not read goes through resizeForWeb().
 */
export function needsResize(probe) {
  if (probe.format !== "jpeg") return true;
  if (!probe.width || !probe.height) return true;
  return probe.width > MAX_WIDTH || probe.height > MAX_HEIGHT;
}

/**
 * Downscale to fit within 1440x1800 and re-encode as JPEG.
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
