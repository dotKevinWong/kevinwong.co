import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { migrationFiles } from "../scripts/test-db.mjs";

test("every migration from 005 that alters a table does it in one transaction with a lock timeout", () => {
  for (const file of migrationFiles()) {
    const sql = fs.readFileSync(file, "utf8");
    if (!/^\s*alter table/im.test(sql)) continue;
    const name = path.basename(file);
    assert.match(sql, /^begin;$/m, name);
    assert.match(sql, /^set local lock_timeout = '5s';$/m, name);
    assert.match(sql, /^commit;$/m, name);
  }
});

test("every migration from 005 opens with a comment block", () => {
  for (const file of migrationFiles()) {
    assert.match(fs.readFileSync(file, "utf8"), /^-- /, path.basename(file));
  }
});
