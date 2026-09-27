#!/usr/bin/env node
/**
 * Put a blog post's cover image in Vercel Blob, alongside the /snapshots media.
 *
 *   npm run blog:image -- <file-or-url> <post-slug>            # upload, print the URL
 *   npm run blog:image -- <file-or-url> <post-slug> --update   # ...and set og_image in posts/<slug>.mdx
 *
 * The cover is used twice: as the post's og:image (the preview when a link is
 * shared) and as its thumbnail on /blog. It goes through the same resize as
 * synced photos — at most 1440x1920, JPEG — since some link-preview crawlers do
 * not accept WebP or AVIF.
 *
 * The pathname carries a hash of the image, e.g. blog/homebridge-3f9a1c2e.jpg.
 * Blob files are served with a one-year browser cache, so replacing a cover at
 * the same pathname would leave visitors looking at the old one; a new image
 * gets a new URL instead. The previous file is not deleted.
 *
 * Needs BLOB_READ_WRITE_TOKEN.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadEnvFiles } from "./load-env.mjs";

// lib/blob-store.js reads process.env when it loads, so apply the env files first.
for (const [key, value] of Object.entries(loadEnvFiles())) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const args = process.argv.slice(2);
const update = args.includes("--update");
const [source, slug] = args.filter((a) => !a.startsWith("--"));

if (!source || !slug) {
  console.error("Usage: npm run blog:image -- <file-or-url> <post-slug> [--update]");
  process.exit(1);
}
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
  console.error(`"${slug}" is not a post slug (lowercase letters, digits and hyphens).`);
  process.exit(1);
}

const postFile = path.join(process.cwd(), "posts", `${slug}.mdx`);
if (update && !fs.existsSync(postFile)) {
  console.error(`--update: ${postFile} does not exist.`);
  process.exit(1);
}

const { downloadMedia, isBlobConfigured, uploadToBlob } = await import("../lib/blob-store.js");
const { needsResize, resizeForWeb } = await import("../lib/image-resize.js");
const { probeMedia } = await import("../lib/media-probe.js");

if (!isBlobConfigured()) {
  console.error("BLOB_READ_WRITE_TOKEN is not set. Add it to .env (from the Blob store's settings).");
  process.exit(1);
}

const original = /^https?:\/\//.test(source) ? await downloadMedia(source) : fs.readFileSync(source);

const probe = probeMedia(original); // throws on bytes that are not an image or video
if (probe.kind !== "image") {
  console.error(`That is a ${probe.format} video, not an image.`);
  process.exit(1);
}

const image = needsResize(probe)
  ? await resizeForWeb(original)
  : { buffer: original, width: probe.width, height: probe.height, ext: probe.ext, mime: probe.mime };

const hash = crypto.createHash("sha256").update(image.buffer).digest("hex").slice(0, 8);
const blob = await uploadToBlob(`blog/${slug}-${hash}.${image.ext}`, image.buffer, image.mime);

const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
console.log(`\n${probe.format} ${probe.width}x${probe.height}, ${kb(original.length)}`);
console.log(`-> ${image.ext} ${image.width}x${image.height}, ${kb(image.buffer.length)}${image.buffer === original ? " (kept as-is)" : ""}`);
console.log(`\n${blob.url}\n`);

if (update) {
  const text = fs.readFileSync(postFile, "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    console.error(`${postFile} has no frontmatter block; set og_image by hand.`);
    process.exit(1);
  }
  // Replacer functions, not strings: a "$" in the frontmatter (an excerpt that
  // mentions a price, say) would otherwise be read as a replacement pattern.
  const frontmatter = /^og_image:.*$/m.test(match[1])
    ? match[1].replace(/^og_image:.*$/m, () => `og_image: ${blob.url}`)
    : `${match[1]}\nog_image: ${blob.url}`;
  fs.writeFileSync(postFile, text.replace(match[0], () => `---\n${frontmatter}\n---\n`));
  console.log(`Updated og_image in posts/${slug}.mdx\n`);
} else {
  console.log(`Set it as the post's cover with:\n  og_image: ${blob.url}\n`);
}
