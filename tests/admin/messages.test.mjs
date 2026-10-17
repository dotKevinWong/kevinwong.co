import { test } from "node:test";
import assert from "node:assert/strict";
import { errorCodeFromQuery, signInErrorMessage } from "../../lib/admin/messages.js";

test("errorCodeFromQuery keeps only short lowercase codes", () => {
  assert.equal(errorCodeFromQuery("not_owner"), "not_owner");
  assert.equal(errorCodeFromQuery(undefined), null);
  assert.equal(errorCodeFromQuery(""), null);
  assert.equal(errorCodeFromQuery(["not_owner", "x"]), null);
  assert.equal(errorCodeFromQuery("Call 555-0100 to restore access"), null);
  assert.equal(errorCodeFromQuery("a".repeat(65)), null);
});

test("signInErrorMessage maps codes to plain messages", () => {
  assert.equal(signInErrorMessage(null), null);
  assert.equal(signInErrorMessage(undefined), null);
  assert.equal(signInErrorMessage("not_owner"), "That GitHub account can't sign in here.");
  assert.equal(signInErrorMessage("access_denied"), "GitHub sign-in was cancelled.");
  for (const code of ["state_mismatch", "state_not_found", "state_invalid"]) {
    assert.equal(signInErrorMessage(code), "That sign-in attempt expired. Try again.");
  }
  assert.equal(signInErrorMessage("rate_limited"), "Too many sign-in attempts. Wait a minute and try again.");
  assert.equal(signInErrorMessage("start_failed"), "Couldn't start GitHub sign-in. Try again in a minute.");
});

test("signInErrorMessage falls back for other codes and never echoes them", () => {
  assert.equal(signInErrorMessage("invalid_code"), "Sign-in didn't work. Try again.");
  assert.equal(signInErrorMessage("account_not_linked"), "Sign-in didn't work. Try again.");
});
