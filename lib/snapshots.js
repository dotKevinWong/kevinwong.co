export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function clampInt(input, { min, max, fallback }) {
  const parsed = Number.parseInt(String(input || fallback), 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function normalizeMedia(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((item) => ({
    id: item.id,
    position: Number(item.position || 0),
    kind: item.kind,
    url: item.url,
    publicId: item.publicId,
    width: item.width ? Number(item.width) : null,
    height: item.height ? Number(item.height) : null,
  }));
}
