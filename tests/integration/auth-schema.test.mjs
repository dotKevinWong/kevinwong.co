import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { testDb } from "../helpers/db.mjs";

const db = testDb();
const applySql = (file) => db.pool.query(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"));
const EXPECTED = {
  auth_user: ["id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt"],
  auth_session: ["id", "expiresAt", "token", "createdAt", "updatedAt", "ipAddress", "userAgent", "userId"],
  auth_account: ["id", "accountId", "providerId", "userId", "accessToken", "refreshToken", "idToken",
    "accessTokenExpiresAt", "refreshTokenExpiresAt", "scope", "password", "createdAt", "updatedAt"],
  auth_verification: ["id", "identifier", "value", "expiresAt", "createdAt", "updatedAt"],
};

describe("sql/007_auth.sql", { skip: db.skip }, () => {
  before(() => db.resetSchema());
  after(() => db.close());

  test("007 applies twice", async () => {
    await applySql("sql/007_auth.sql");
    await applySql("sql/007_auth.sql");
  });

  test("007 creates exactly the columns Better Auth 1.7.10 reads and writes", async () => {
    for (const [table, columns] of Object.entries(EXPECTED)) {
      const { rows } = await db.pool.query(
        "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position",
        [table],
      );
      assert.deepEqual(rows.map((r) => r.column_name), columns, table);
    }
  });

  test("auth_account holds one row per (providerId, accountId)", async () => {
    await db.pool.query(`insert into auth_user ("id", "name", "email", "updatedAt") values ('u1', 'Kevin Wong', '1741711@github.placeholder.invalid', now())`);
    const insertAccount = (id) => db.pool.query(
      `insert into auth_account ("id", "accountId", "providerId", "userId", "updatedAt") values ($1, '1741711', 'github', 'u1', now())`,
      [id],
    );
    await insertAccount("a1");
    await assert.rejects(insertAccount("a2"), { code: "23505" });
  });
});
