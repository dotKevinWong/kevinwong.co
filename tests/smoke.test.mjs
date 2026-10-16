import test from "node:test";
import assert from "node:assert/strict";

test("npm test passes the warning flag to every test process", () => {
  assert.ok(
    process.execArgv.includes("--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"),
    "run tests with `npm test`, which loads lib/*.js without the MODULE_TYPELESS_PACKAGE_JSON warning"
  );
});
