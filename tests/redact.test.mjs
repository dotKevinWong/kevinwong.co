import test from "node:test";
import assert from "node:assert/strict";
import { capJson, describeError, redact } from "../lib/redact.js";

const FORTY = "A1b2C3d4E5".repeat(4);

test("redact replaces the credential after Bearer", () => {
  assert.equal(redact("Authorization: Bearer BQDx-abc.123"), "Authorization: Bearer [redacted]");
  assert.equal(redact('{"authorization":"bearer abc"}'), '{"authorization":"bearer [redacted]"}');
});

for (const key of ["access_token", "refresh_token", "code", "client_secret", "token"]) {
  test(`redact replaces the value of the ${key} query parameter`, () => {
    assert.equal(
      redact(`https://example.test/cb?${key}=s3cr3t&state=ok`),
      `https://example.test/cb?${key}=[redacted]&state=ok`
    );
  });
}

test("redact handles a form body and leaves look-alike keys alone", () => {
  assert.equal(
    redact("grant_type=refresh_token&refresh_token=AQDshort"),
    "grant_type=refresh_token&refresh_token=[redacted]"
  );
  assert.equal(redact("error_code=190&id_token=abc"), "error_code=190&id_token=abc");
});

test("redact keeps short numeric error codes", () => {
  assert.equal(redact("HTTP 500 code=190 type=OAuthException"), "HTTP 500 code=190 type=OAuthException");
  assert.equal(redact("error?code=2&state=ok"), "error?code=2&state=ok");
  assert.equal(redact("x?code=AQDk3j_9xYz"), "x?code=[redacted]");
  assert.equal(redact("x?code=123456"), "x?code=[redacted]");
});

test("redact removes postgres and postgresql credentials", () => {
  assert.equal(
    redact("connect failed: postgresql://kw_owner:npg_pw123@db.example.test/neondb"),
    "connect failed: postgresql://[redacted]@db.example.test/neondb"
  );
  assert.equal(
    redact("postgres://postgres:pw@127.0.0.1:55432/kw_test"),
    "postgres://[redacted]@127.0.0.1:55432/kw_test"
  );
});

test("redact replaces any run of 40 or more token characters", () => {
  assert.equal(redact(`refreshed with ${FORTY} ok`), "refreshed with [redacted] ok");
  assert.equal(
    redact("Basic QmFzZTY0K3Rva2VuL3dpdGgrc2xhc2hlcy9hbmQ9cGFkZGluZw=="),
    "Basic [redacted]"
  );
});

test("redact leaves a 39-character run alone", () => {
  const thirtyNine = FORTY.slice(0, 39);
  assert.equal(redact(`id ${thirtyNine} ok`), `id ${thirtyNine} ok`);
});

test("redact also hides a long URL path (accepted over-redaction)", () => {
  assert.equal(
    redact("GET https://api.spotify.com/v1/me/player/currently-playing failed"),
    "GET https:[redacted] failed"
  );
});

test("redact copies nested objects and arrays without changing the input", () => {
  const input = { a: [{ b: "Bearer xyz" }, 42, null], c: { d: true } };
  const out = redact(input);
  assert.deepEqual(out, { a: [{ b: "Bearer [redacted]" }, 42, null], c: { d: true } });
  assert.equal(input.a[0].b, "Bearer xyz");
  assert.notEqual(out, input);
  assert.notEqual(out.a, input.a);
});

test("redact truncates strings over 500 characters with an ellipsis", () => {
  const exactly500 = "word ".repeat(100);
  assert.equal(redact(exactly500), exactly500);
  const long = "word ".repeat(120);
  const out = redact(long);
  assert.equal(out.length, 501);
  assert.equal(out, `${long.slice(0, 500)}…`);
});

test("redact redacts before truncating, so no fragment of a token survives the cut", () => {
  assert.equal(redact("word ".repeat(94) + "s".repeat(60)), "word ".repeat(94) + "[redacted]");
});

test("redact returns non-string values untouched", () => {
  const when = new Date(0);
  assert.equal(redact(42), 42);
  assert.equal(redact(true), true);
  assert.equal(redact(null), null);
  assert.equal(redact(undefined), undefined);
  assert.equal(redact(when), when);
  assert.deepEqual(redact({ n: 1, ok: false, when }), { n: 1, ok: false, when });
  assert.equal(redact({ when }).when, when);
});

test("redact marks a cycle and copies a shared reference twice", () => {
  const cyclic = { a: "x" };
  cyclic.self = cyclic;
  assert.deepEqual(redact(cyclic), { a: "x", self: "[circular]" });
  const shared = { k: "v" };
  assert.deepEqual(redact({ a: shared, b: shared }), { a: { k: "v" }, b: { k: "v" } });
});

test("capJson returns the same value when its JSON fits", () => {
  const value = { a: 1 };
  assert.equal(capJson(value), value);
  assert.equal(capJson("x".repeat(8), 10), "x".repeat(8));
  assert.equal(capJson(undefined), undefined);
});

test("capJson replaces an oversized value with a preview", () => {
  assert.deepEqual(capJson("x".repeat(8), 9), { truncated: true, bytes: 10, preview: '"xxx' });
  const out = capJson({ s: "a".repeat(20_000) });
  assert.equal(out.truncated, true);
  assert.equal(out.bytes, 20_008);
  assert.equal(out.preview.length, 8_000);
  assert.ok(out.preview.startsWith('{"s":"aaa'));
});

test("capJson measures UTF-8 bytes, not characters", () => {
  assert.deepEqual(capJson("é".repeat(10), 20), {
    truncated: true,
    bytes: 22,
    preview: `"${"é".repeat(9)}`,
  });
});

test("redact returns well-formed strings, even when the cut lands inside an emoji", () => {
  const cut = redact(`${"word ".repeat(99)}abcd😀 tail`); // the emoji straddles index 500
  assert.equal(cut.length, 501);
  assert.ok(cut.isWellFormed());
  // A caption sliced by UTF-16 units upstream (runSync's caption.slice(0, 80)) can end in half an emoji.
  assert.equal(redact("abcd\uD83D"), "abcd\uFFFD");
});

test("capJson's preview never ends in half an emoji", () => {
  const out = capJson(`${"a".repeat(7_998)}😀${"b".repeat(9_000)}`); // the JSON's 8,000th unit is the emoji's high half
  assert.equal(out.truncated, true);
  assert.ok(out.preview.isWellFormed());
});

test("redact scrubs short secrets under a sensitive key, in objects and in JSON text", () => {
  const clientSecret = "0123456789abcdef0123456789abcdef";
  const sessionToken = "abcdefghijklmnopqrstuvwxyz012345";
  assert.equal(redact(`{"client_secret":"${clientSecret}"}`), '{"client_secret":"[redacted]"}');
  assert.deepEqual(redact({ client_secret: clientSecret }), { client_secret: "[redacted]" });
  assert.deepEqual(redact({ session: { token: sessionToken } }), { session: { token: "[redacted]" } });
  assert.equal(
    redact(JSON.stringify({ session: { token: sessionToken } })),
    '{"session":{"token":"[redacted]"}}'
  );
  assert.equal(redact('{"authorization":"Basic YWRtaW46cGFzc3dvcmQ="}'), '{"authorization":"[redacted]"}');
});

test("redact leaves an outcome code under a code key alone", () => {
  const outcome = { code: "denied", reason: "access_denied" };
  assert.deepEqual(redact(outcome), outcome);
  assert.equal(redact('{"code":"wrong_account"}'), '{"code":"wrong_account"}');
});

test("describeError gives the name, the code and the message, never pg's detail", () => {
  const error = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:55432"), {
    code: "ECONNREFUSED",
    detail: "Key (provider)=(spotify) already exists.",
  });
  assert.equal(describeError(error), "Error [ECONNREFUSED]: connect ECONNREFUSED 127.0.0.1:55432");
});

test("describeError falls back to String(error) when the message is empty", () => {
  assert.equal(describeError(new AggregateError([new Error("a"), new Error("b")])), "AggregateError: AggregateError");
});

test("describeError redacts a credential in the message", () => {
  const error = new TypeError("connect failed: postgresql://kw_owner:npg_pw123@db.example.test/neondb");
  assert.equal(describeError(error), "TypeError: connect failed: postgresql://[redacted]@db.example.test/neondb");
});

test("describeError describes a thrown value that is not an Error", () => {
  assert.equal(describeError("plain text"), "Error: plain text");
  assert.equal(describeError(undefined), "Error: undefined");
  assert.equal(describeError(null), "Error: null");
});
