import { test } from "node:test";
import assert from "node:assert/strict";
import * as owner from "../lib/admin/owner.js";
import {
  OWNER_GITHUB_ID, OWNER_GITHUB_LOGIN, OWNER_SPOTIFY_ACCOUNT_ID, SITE_ORIGIN, SITE_HOST,
} from "../lib/admin/owner.js";

test("owner constants", () => {
  assert.deepEqual(Object.keys(owner).sort(), [
    "OWNER_GITHUB_ID", "OWNER_GITHUB_LOGIN", "OWNER_SPOTIFY_ACCOUNT_ID", "SITE_HOST", "SITE_ORIGIN",
  ]);
  assert.equal(OWNER_GITHUB_ID, "1741711");
  assert.equal(OWNER_GITHUB_LOGIN, "dotKevinWong");
  assert.equal(SITE_ORIGIN, "https://www.kevinwong.co");
  assert.equal(SITE_HOST, "www.kevinwong.co");
});

test("OWNER_SPOTIFY_ACCOUNT_ID has been filled in", () => {
  assert.notEqual(OWNER_SPOTIFY_ACCOUNT_ID, "<from --whoami>");
  assert.match(OWNER_SPOTIFY_ACCOUNT_ID, /^[A-Za-z0-9._-]{1,64}$/);
});
