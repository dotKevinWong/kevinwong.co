// Width/height (and, for video, duration) straight from a file's bytes.
//
// Cloudinary used to report these after it fetched the upload. Vercel Blob is
// plain storage and reports nothing, and the Instagram API has no width/height
// field on IG Media — so the sync reads them itself from the bytes it has
// already downloaded for put().
//
// Deliberately dependency-free. sharp is the obvious tool, but it is a ~19 MB
// native binary for a job that only needs a few header bytes, and on next
// 16.2.x its libvips package is not traced into the function, so it builds and
// then dies at runtime with ERR_DLOPEN_FAILED (lovell/sharp#4567, fixed in next
// 16.3.0). A JPEG's size is in its SOF segment (byte ~280 in every Instagram
// JPEG), an MP4's in the moov/trak/tkhd box. Checked against all 133 files on
// /snapshots and ffmpeg fixtures covering moov-at-end, HEVC and 90/180/270°
// rotation.
//
// Every dimension returned is the DISPLAY size: EXIF orientations 5-8 and a
// 90/270-degree tkhd matrix swap width and height, because browsers apply both
// when they draw the element and components/PhotoPost.tsx sizes its frame from
// width / height.

const IMAGE_FORMATS = {
  jpeg: { mime: "image/jpeg", ext: "jpg" },
  png: { mime: "image/png", ext: "png" },
  webp: { mime: "image/webp", ext: "webp" },
  gif: { mime: "image/gif", ext: "gif" },
  avif: { mime: "image/avif", ext: "avif" },
  // Recognised only so it can be rejected by name: Chrome and Firefox cannot
  // render HEIC in an <img>, so storing one would publish a broken slide.
  heic: { mime: "image/heic", ext: "heic" },
};

const VIDEO_FORMATS = {
  mp4: { mime: "video/mp4", ext: "mp4" },
  mov: { mime: "video/quicktime", ext: "mov" },
};

const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"]);

/** Identify a file by its magic bytes. Never trusts a URL extension or a Content-Type header. */
export function sniff(buf) {
  if (buf.length < 12) return null;
  const ascii = (start, end) => buf.toString("latin1", start, end);

  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return image("jpeg");
  if (buf.readUInt32BE(0) === 0x89504e47) return image("png");
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return image("webp");
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return image("gif");

  if (ascii(4, 8) === "ftyp") {
    const ftypSize = buf.readUInt32BE(0);
    const brands = [ascii(8, 12)];
    for (let off = 16; off + 4 <= Math.min(ftypSize, buf.length); off += 4) brands.push(ascii(off, off + 4));
    if (brands.includes("avif") || brands.includes("avis")) return image("avif");
    if (brands.some((b) => HEIF_BRANDS.has(b))) return image("heic");
    return video(brands[0] === "qt  " ? "mov" : "mp4");
  }

  return null;
}

const image = (format) => ({ kind: "image", format, ...IMAGE_FORMATS[format] });
const video = (format) => ({ kind: "video", format, ...VIDEO_FORMATS[format] });

/**
 * Probe a complete file.
 *
 * Returns { kind, format, mime, ext, width, height, duration }. Throws only when
 * the bytes are not a recognisable image or video at all (an HTML error page,
 * an empty body). width/height are null when the format is recognised but the
 * header could not be read — the caller decides whether that is fatal.
 */
export function probeMedia(buf) {
  const type = sniff(buf);
  if (!type) {
    throw new Error(`Unrecognised media bytes (starts ${buf.subarray(0, 8).toString("hex") || "<empty>"})`);
  }

  let size = null;
  let duration = null;
  try {
    if (type.format === "jpeg") size = jpegSize(buf);
    else if (type.format === "png") size = pngSize(buf);
    else if (type.format === "webp") size = webpSize(buf);
    else if (type.format === "gif") size = { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    else if (type.format === "avif" || type.format === "heic") size = heifSize(buf);
    else ({ size, duration } = movieInfo(buf));
  } catch {
    // A RangeError from a truncated or malformed header. Treated exactly like
    // "header not found" rather than failing the whole file.
    size = null;
  }

  const valid = size && size.width > 0 && size.height > 0;
  return {
    ...type,
    width: valid ? size.width : null,
    height: valid ? size.height : null,
    duration,
  };
}

// ---------------------------------------------------------------- JPEG

function jpegSize(buf) {
  let orientation = 1;
  let off = 2;

  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) return null; // lost sync: not a marker
    const marker = buf[off + 1];

    if (marker === 0xff) { off += 1; continue; } // fill byte before a marker
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { off += 2; continue; } // no length field
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / start of scan with no SOF seen

    const length = buf.readUInt16BE(off + 2);
    if (length < 2) return null;

    if (marker === 0xe1) orientation = exifOrientation(buf, off + 4, off + 2 + length) ?? orientation;

    // SOF0..SOF15, excluding DHT (C4), JPG (C8) and DAC (CC), which share the range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = buf.readUInt16BE(off + 5);
      const width = buf.readUInt16BE(off + 7);
      return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
    }

    off += 2 + length;
  }

  return null;
}

/** EXIF Orientation (tag 0x0112) from an APP1 payload, or null. */
function exifOrientation(buf, start, end) {
  if (end > buf.length || buf.toString("latin1", start, start + 6) !== "Exif\0\0") return null;
  const tiff = start + 6;
  const order = buf.toString("latin1", tiff, tiff + 2);
  if (order !== "II" && order !== "MM") return null;
  const le = order === "II";
  const read16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const read32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));

  const ifd0 = tiff + read32(tiff + 4);
  if (ifd0 + 2 > end) return null;
  const count = read16(ifd0);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > end) return null;
    if (read16(entry) === 0x0112) return read16(entry + 8);
  }
  return null;
}

// ---------------------------------------------------------------- PNG / WebP

function pngSize(buf) {
  if (buf.toString("latin1", 12, 16) !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function webpSize(buf) {
  const chunk = buf.toString("latin1", 12, 16);
  if (chunk === "VP8 ") {
    // Lossy: 3-byte frame tag, 9d 01 2a start code, then 14-bit width/height.
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    // Lossless: 0x2f signature, then 14 bits of width-1 and 14 bits of height-1.
    if (buf[20] !== 0x2f) return null;
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    // Extended (alpha/animation/metadata): 24-bit canvas width-1 and height-1.
    return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  return null;
}

// ---------------------------------------------------------------- ISO BMFF (MP4 / MOV / AVIF)

/** Iterate the boxes laid out between start and end. Tolerates a truncated last box. */
function* boxes(buf, start, end) {
  let off = start;
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    let header = 8;
    if (size === 1) {
      if (off + 16 > end) return;
      size = Number(buf.readBigUInt64BE(off + 8)); // 64-bit "largesize" (big mdat)
      header = 16;
    } else if (size === 0) {
      size = end - off; // "extends to end of file"
    }
    if (size < header) return; // corrupt
    yield { type, start: off + header, end: Math.min(off + size, end) };
    off += size;
  }
}

function child(buf, parent, type) {
  for (const box of boxes(buf, parent.start, parent.end)) if (box.type === type) return box;
  return null;
}

function path(buf, parent, ...types) {
  let box = parent;
  for (const type of types) {
    box = box && child(buf, box, type);
  }
  return box;
}

/**
 * Display size and duration of the first visual track.
 *
 * moov is found wherever it is. Every Instagram MP4 measured so far is
 * "faststart" (ftyp, then moov at byte 32, then mdat), but this is handed the
 * whole file, so an encoder that writes moov last works just as well.
 */
function movieInfo(buf) {
  const moov = child(buf, { start: 0, end: buf.length }, "moov");
  if (!moov) return { size: null, duration: null };

  let duration = null;
  const mvhd = child(buf, moov, "mvhd");
  if (mvhd) {
    const v1 = buf[mvhd.start] === 1;
    const timescale = buf.readUInt32BE(mvhd.start + (v1 ? 20 : 12));
    const units = v1 ? Number(buf.readBigUInt64BE(mvhd.start + 24)) : buf.readUInt32BE(mvhd.start + 16);
    if (timescale > 0) duration = Math.round((units / timescale) * 1000) / 1000;
  }

  for (const trak of boxes(buf, moov.start, moov.end)) {
    if (trak.type !== "trak") continue;
    const size = trackSize(buf, trak);
    if (size) return { size, duration };
  }
  return { size: null, duration };
}

function trackSize(buf, trak) {
  const tkhd = child(buf, trak, "tkhd");
  if (!tkhd) return null;

  // FullBox: version(1) flags(3), then times/ids (20 bytes in v0, 32 in v1),
  // reserved(8) layer(2) alternate_group(2) volume(2) reserved(2), a 3x3
  // matrix of 32-bit values, then 16.16 fixed-point width and height.
  const matrix = tkhd.start + 4 + (buf[tkhd.start] === 1 ? 32 : 20) + 16;
  const a = buf.readInt32BE(matrix);
  const b = buf.readInt32BE(matrix + 4);
  let width = buf.readUInt32BE(matrix + 36) / 65536;
  let height = buf.readUInt32BE(matrix + 40) / 65536;

  if (!width || !height) {
    // Audio tracks are 0x0 — but so is a video track from a lazy muxer. Only
    // the latter has a visual sample description to fall back on.
    const fallback = sampleEntrySize(buf, trak);
    if (!fallback) return null;
    ({ width, height } = fallback);
  }

  // tkhd width/height are pre-transform. A 90/270-degree rotation puts the
  // weight of the matrix on b/c instead of a/d; the browser rotates on playback.
  const rotated = Math.abs(b) > Math.abs(a);
  width = Math.round(width);
  height = Math.round(height);
  return rotated ? { width: height, height: width } : { width, height };
}

const VISUAL_SAMPLE_ENTRIES = new Set(["avc1", "avc3", "hvc1", "hev1", "av01", "vp09", "mp4v", "dvh1", "dvhe"]);

function sampleEntrySize(buf, trak) {
  const hdlr = path(buf, trak, "mdia", "hdlr");
  if (!hdlr || buf.toString("latin1", hdlr.start + 8, hdlr.start + 12) !== "vide") return null;
  const stsd = path(buf, trak, "mdia", "minf", "stbl", "stsd");
  if (!stsd) return null;
  // stsd is a FullBox with a 4-byte entry count before its entries.
  for (const entry of boxes(buf, stsd.start + 8, stsd.end)) {
    if (!VISUAL_SAMPLE_ENTRIES.has(entry.type)) continue;
    // VisualSampleEntry: reserved(6) data_reference_index(2) pre_defined/reserved(16), width(2) height(2)
    return { width: buf.readUInt16BE(entry.start + 24), height: buf.readUInt16BE(entry.start + 26) };
  }
  return null;
}

/** AVIF/HEIF still: the largest 'ispe' property (grids list each tile too), rotated by 'irot'. */
function heifSize(buf) {
  const meta = child(buf, { start: 0, end: buf.length }, "meta");
  if (!meta) return null;
  // meta is a FullBox: skip version/flags before its children.
  const ipco = path(buf, { start: meta.start + 4, end: meta.end }, "iprp", "ipco");
  if (!ipco) return null;

  let best = null;
  let quarterTurns = 0;
  for (const prop of boxes(buf, ipco.start, ipco.end)) {
    if (prop.type === "ispe") {
      const width = buf.readUInt32BE(prop.start + 4);
      const height = buf.readUInt32BE(prop.start + 8);
      if (!best || width * height > best.width * best.height) best = { width, height };
    } else if (prop.type === "irot") {
      quarterTurns = buf[prop.start] & 0x03;
    }
  }
  if (!best) return null;
  return quarterTurns % 2 === 1 ? { width: best.height, height: best.width } : best;
}
