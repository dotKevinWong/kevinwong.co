import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { applySqlFiles } from "../../scripts/db-apply.mjs";
import { resetTestDatabase } from "../../scripts/test-db.mjs";
import { testDb } from "../helpers/db.mjs";

const db = testDb();
const quiet = { log: () => {} };

describe("test database reset", { skip: db.skip }, () => {
  let dir;
  const sqlFile = (name, text) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text);
    return file;
  };

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kw-sql-"));
    await db.resetSchema();
  });
  after(async () => {
    await db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("the fixture creates production's tables and the media_kind enum", async () => {
    const { rows } = await db.pool.query(
      "select table_name from information_schema.tables where table_schema = 'public'"
    );
    const names = rows.map((row) => row.table_name);
    for (const table of ["instagram_media", "instagram_posts", "integration_tokens", "job_locks"]) {
      assert.ok(names.includes(table), table);
    }
    const { rowCount } = await db.pool.query("select 1 from pg_type where typname = 'media_kind'");
    assert.equal(rowCount, 1);
  });

  test("resetSchema empties the tables and leaves the pool usable", async () => {
    await db.pool.query("insert into job_locks (name) values ('reset-check')");
    await db.resetSchema();
    const { rows } = await db.pool.query("select count(*)::int as n from job_locks");
    assert.equal(rows[0].n, 0);
  });

  test("resetTestDatabase creates a missing kw_test database", async () => {
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.pathname = "/kw_test_created";
    const admin = new URL(process.env.TEST_DATABASE_URL);
    admin.pathname = "/postgres";
    const client = new pg.Client({ connectionString: admin.href, ssl: false });
    await client.connect();
    try {
      await client.query('drop database if exists "kw_test_created"');
      await resetTestDatabase({ url: url.href, applyMigrations: false });
      const { rowCount } = await client.query("select 1 from pg_database where datname = 'kw_test_created'");
      assert.equal(rowCount, 1);
    } finally {
      await client.query('drop database if exists "kw_test_created" with (force)');
      await client.end();
    }
  });

  test("each file runs on its own connection, so one file's search_path does not leak", async () => {
    const clear = sqlFile("a.sql", "select pg_catalog.set_config('search_path', '', false);");
    const unqualified = sqlFile("b.sql", "select count(*) from integration_tokens;");
    await assert.doesNotReject(
      applySqlFiles(process.env.TEST_DATABASE_URL, [clear, unqualified], quiet)
    );
  });

  test("a failing file names itself and rolls back", async () => {
    const bad = sqlFile("bad.sql", "create table t_partial (x int);\nselect 1/0;");
    await assert.rejects(
      applySqlFiles(process.env.TEST_DATABASE_URL, [bad], quiet),
      /bad\.sql: division by zero/
    );
    const { rows } = await db.pool.query("select to_regclass('public.t_partial') as t");
    assert.equal(rows[0].t, null);
  });
});
