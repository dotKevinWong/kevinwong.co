const store = new Map();

const CLEANUP_INTERVAL = 60000;
let lastCleanup = Date.now();

function cleanup(windowMs) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, record] of store) {
    if (now - record.start > windowMs) store.delete(key);
  }
}

export function rateLimit(req, { windowMs = 60000, max = 60 } = {}) {
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();

  cleanup(windowMs);

  const record = store.get(ip);
  if (!record || now - record.start > windowMs) {
    store.set(ip, { start: now, count: 1 });
    return false;
  }

  record.count++;
  return record.count > max;
}
