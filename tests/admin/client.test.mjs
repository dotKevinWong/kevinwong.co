import { test } from "node:test";
import assert from "node:assert/strict";
import { githubAuthorizeUrl, isSignedOutError, postJson, statusBanner } from "../../lib/admin/client.js";

const jsonResponse = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("postJson sends a same-origin JSON POST", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push([url, init]); return jsonResponse(200, {}); };
  await postJson("/api/admin/instagram/sync", { dryRun: true }, { fetchImpl });
  assert.equal(calls.length, 1);
  const [url, init] = calls[0];
  assert.equal(url, "/api/admin/instagram/sync");
  assert.equal(init.method, "POST");
  assert.equal(init.headers["content-type"], "application/json");
  assert.equal(init.body, '{"dryRun":true}');
  assert.equal(init.credentials, "same-origin");
  assert.equal(init.cache, "no-store");
});

test("postJson returns ok, status and the parsed body", async () => {
  const result = await postJson("/x", {}, { fetchImpl: async () => jsonResponse(200, { status: "ok" }) });
  assert.deepEqual(result, { ok: true, status: 200, body: { status: "ok" }, signedOut: false });
});

test("postJson reports 401 as signedOut", async () => {
  const result = await postJson("/x", {}, { fetchImpl: async () => jsonResponse(401, { error: "unauthorized" }) });
  assert.deepEqual(result, { ok: false, status: 401, body: { error: "unauthorized" }, signedOut: true });
});

test("postJson keeps a 429 body for the refusal message", async () => {
  const body = { error: "too_soon", retryAfterSeconds: 420 };
  const result = await postJson("/x", {}, { fetchImpl: async () => jsonResponse(429, body) });
  assert.deepEqual(result, { ok: false, status: 429, body, signedOut: false });
});

test("postJson returns a null body for a non-JSON response", async () => {
  const fetchImpl = async () => new Response("<!DOCTYPE html>", { status: 404, headers: { "content-type": "text/html" } });
  assert.deepEqual(await postJson("/x", {}, { fetchImpl }), { ok: false, status: 404, body: null, signedOut: false });
});

test("postJson returns a null body when the JSON is malformed", async () => {
  const fetchImpl = async () => new Response("{oops", { status: 500, headers: { "content-type": "application/json" } });
  assert.deepEqual(await postJson("/x", {}, { fetchImpl }), { ok: false, status: 500, body: null, signedOut: false });
});

test("postJson reports a network failure as status 0", async () => {
  const fetchImpl = async () => { throw new TypeError("Failed to fetch"); };
  assert.deepEqual(await postJson("/x", {}, { fetchImpl }), { ok: false, status: 0, body: null, signedOut: false });
});

test("githubAuthorizeUrl accepts only GitHub's authorize endpoint", () => {
  const good = "https://github.com/login/oauth/authorize?response_type=code&client_id=abc&state=xyz";
  assert.equal(githubAuthorizeUrl({ url: good, redirect: true }), good);
  assert.equal(githubAuthorizeUrl({ url: "https://github.com.evil.example/login/oauth/authorize?x=1" }), null);
  assert.equal(githubAuthorizeUrl({ url: "https://evil.example/?u=https://github.com/login/oauth/authorize?" }), null);
  assert.equal(githubAuthorizeUrl({ url: "/admin" }), null);
  assert.equal(githubAuthorizeUrl({ url: 42 }), null);
  assert.equal(githubAuthorizeUrl(null), null);
});

// The status poll's rules in components/admin/AdminPage.tsx: SWR's onError sends a 401 to sign-in, and the banner
// says whether the status failed to load, is loading, or is stale. lib/fetcher.js puts the status on the error.
test("isSignedOutError is true only for a 401", () => {
  assert.equal(isSignedOutError(Object.assign(new Error("x"), { status: 401 })), true);
  for (const status of [403, 404, 500, 0, undefined]) {
    assert.equal(isSignedOutError(Object.assign(new Error("x"), { status })), false, String(status));
  }
  assert.equal(isSignedOutError(undefined), false);
});

test("statusBanner: failed with no status yet, loading, stale after a failed refresh, and nothing for a 401", () => {
  const error = (status) => Object.assign(new Error("x"), { status });
  assert.equal(statusBanner({ hasData: false, error: error(500) }), "load_failed");
  assert.equal(statusBanner({ hasData: false, error: undefined }), "loading");
  assert.equal(statusBanner({ hasData: true, error: error(500) }), "refresh_failed");
  assert.equal(statusBanner({ hasData: true, error: error(0) }), "refresh_failed");
  assert.equal(statusBanner({ hasData: true, error: error(401) }), null, "a 401 goes to sign-in instead");
  assert.equal(statusBanner({ hasData: true, error: undefined }), null);
});
