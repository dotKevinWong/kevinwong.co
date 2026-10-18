// Scrubs secrets out of what this project stores: sync_runs.error and summary,
// and admin_audit_log.details. Keys are kept; the string value under a
// sensitive key is replaced, in objects and in JSON text. It deliberately
// over-redacts: any run of 40 or more token characters goes, long URL paths
// included.

const MAX_STRING_LENGTH = 500;
const REDACTED = "[redacted]";
// A code= value of 1-5 digits is a Graph API error code (code=190, code=2), not an OAuth code: keep it.
const redactParam = (match, key, value) =>
  key.toLowerCase() === "code" && /^\d{1,5}$/.test(value) ? match : `${key}=${REDACTED}`;
// Matched case-insensitively on the whole key. Not `code`: reconnect outcomes are stored as { code: "denied" }.
const SENSITIVE_KEYS = [
  "access_token",
  "refresh_token",
  "id_token",
  "client_secret",
  "token",
  "secret",
  "password",
  "authorization",
];
const SENSITIVE_KEY_SET = new Set(SENSITIVE_KEYS);
const isSensitiveKey = (key) => SENSITIVE_KEY_SET.has(key.toLowerCase());
// "<sensitive key>": "<value>" in JSON text. The value's two alternatives can't both match a character, so
// the scan is linear; the s flag lets an escape precede a raw newline in text that only looks like JSON.
const SENSITIVE_JSON_VALUE = new RegExp(
  String.raw`("(?:${SENSITIVE_KEYS.join("|")})"\s*:\s*")((?:[^"\\]|\\.)*)"`,
  "gis"
);
// A value the Bearer rule already reduced to `Bearer [redacted]` keeps its scheme; any other value goes.
const redactJsonValue = (match, prefix, value) =>
  /^Bearer\s+\[redacted\]$/i.test(value) ? match : `${prefix}${REDACTED}"`;
// The specific rules run first, so their key or scheme stays readable; the catch-all runs last.
const RULES = [
  [/\b(Bearer\s+)[^\s"',;]+/gi, `$1${REDACTED}`],
  [/\b(postgres(?:ql)?:\/\/)[^@\s/]+@/gi, `$1${REDACTED}@`],
  [SENSITIVE_JSON_VALUE, redactJsonValue],
  [/\b(access_token|refresh_token|client_secret|code|token)=([^&\s"']+)/gi, redactParam],
  [/[A-Za-z0-9_\-.~+/=]{40,}/g, REDACTED],
];

function redactString(s) {
  let out = s;
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  if (out.length > MAX_STRING_LENGTH) out = `${out.slice(0, MAX_STRING_LENGTH)}…`;
  // A cut by UTF-16 units can split an emoji; a lone surrogate would make a jsonb insert fail.
  return out.toWellFormed();
}

function isPlainObject(value) {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function redact(value) {
  // The objects on the current path: a cycle back to one is marked, a shared reference is copied again.
  const path = new WeakSet();

  function walk(item) {
    if (typeof item === "string") return redactString(item);
    if (!Array.isArray(item) && !isPlainObject(item)) return item;
    if (path.has(item)) return "[circular]";
    path.add(item);
    let copy;
    if (Array.isArray(item)) {
      copy = item.map((element) => walk(element));
    } else {
      copy = Object.fromEntries(
        Object.entries(item).map(([key, child]) => [
          key,
          isSensitiveKey(key) && typeof child === "string" ? REDACTED : walk(child),
        ])
      );
      if (Object.getPrototypeOf(item) === null) Object.setPrototypeOf(copy, null);
    }
    path.delete(item);
    return copy;
  }

  return walk(value);
}

// One redacted line for a log: the error's name, its code and its message, never the Error object, its stack
// or pg's err.detail. The name and code matter when the message is empty, as in the AggregateError
// [ECONNREFUSED] that pg throws when no address of a host accepts the connection. A thrown value that isn't an
// Error is described as String(value). Every log line in lib/ and pages/ that reports an error uses this one.
export function describeError(error) {
  return redact(`${error?.name || "Error"}${error?.code ? ` [${error.code}]` : ""}: ${error?.message || String(error)}`);
}

export function capJson(value, maxBytes = 16_000) {
  const json = JSON.stringify(value);
  if (json === undefined) return value;
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes <= maxBytes) return value;
  return { truncated: true, bytes, preview: json.slice(0, Math.floor(maxBytes / 2)).toWellFormed() };
}
