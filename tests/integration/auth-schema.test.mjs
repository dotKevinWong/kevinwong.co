import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { testDb } from "../helpers/db.mjs";

const db = testDb();
const applySql = (file) => db.pool.query(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"));
// [column, data_type, is_nullable] in table order, as Better Auth 1.7.10 defines them
// (@better-auth/core getAuthTables: string -> text, boolean -> boolean, date -> timestamptz; required -> NOT NULL).
const TEXT = "text";
const BOOL = "boolean";
const TSTZ = "timestamp with time zone";
const EXPECTED = {
  auth_user: [
    ["id", TEXT, "NO"], ["name", TEXT, "NO"], ["email", TEXT, "NO"], ["emailVerified", BOOL, "NO"],
    ["image", TEXT, "YES"], ["createdAt", TSTZ, "NO"], ["updatedAt", TSTZ, "NO"],
  ],
  auth_session: [
    ["id", TEXT, "NO"], ["expiresAt", TSTZ, "NO"], ["token", TEXT, "NO"], ["createdAt", TSTZ, "NO"],
    ["updatedAt", TSTZ, "NO"], ["ipAddress", TEXT, "YES"], ["userAgent", TEXT, "YES"], ["userId", TEXT, "NO"],
  ],
  auth_account: [
    ["id", TEXT, "NO"], ["accountId", TEXT, "NO"], ["providerId", TEXT, "NO"], ["userId", TEXT, "NO"],
    ["accessToken", TEXT, "YES"], ["refreshToken", TEXT, "YES"], ["idToken", TEXT, "YES"],
    ["accessTokenExpiresAt", TSTZ, "YES"], ["refreshTokenExpiresAt", TSTZ, "YES"], ["scope", TEXT, "YES"],
    ["password", TEXT, "YES"], ["createdAt", TSTZ, "NO"], ["updatedAt", TSTZ, "NO"],
  ],
  auth_verification: [
    ["id", TEXT, "NO"], ["identifier", TEXT, "NO"], ["value", TEXT, "NO"], ["expiresAt", TSTZ, "NO"],
    ["createdAt", TSTZ, "NO"], ["updatedAt", TSTZ, "NO"],
  ],
};

describe("sql/007_auth.sql", { skip: db.skip }, () => {
  before(() => db.resetSchema());
  after(() => db.close());

  test("007 applies twice", async () => {
    await applySql("sql/007_auth.sql");
    await applySql("sql/007_auth.sql");
  });

  test("007 creates exactly the columns Better Auth 1.7.10 reads and writes, with their types and nullability", async () => {
    for (const [table, columns] of Object.entries(EXPECTED)) {
      const { rows } = await db.pool.query(
        `select column_name, data_type, is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = $1 order by ordinal_position`,
        [table],
      );
      assert.deepEqual(rows.map((r) => [r.column_name, r.data_type, r.is_nullable]), columns, table);
    }
  });

  test("007's keys, unique constraints, cascading foreign keys and indexes", async () => {
    const { rows: constraints } = await db.pool.query(
      `select conname, contype, confdeltype, nullif(confrelid, 0)::regclass::text as refs,
              (select array_agg(a.attname::text order by a.attnum) from pg_attribute a
                where a.attrelid = c.conrelid and a.attnum = any(c.conkey)) as columns
         from pg_constraint c
        where c.conrelid::regclass::text like 'auth\\_%' and c.contype in ('p', 'u', 'f')
        order by conname`,
    );
    assert.deepEqual(constraints.map((r) => [r.conname, r.contype, r.columns, r.refs, r.confdeltype]), [
      ["auth_account_pkey", "p", ["id"], null, " "],
      ["auth_account_userId_fkey", "f", ["userId"], "auth_user", "c"],
      ["auth_session_pkey", "p", ["id"], null, " "],
      ["auth_session_token_key", "u", ["token"], null, " "],
      ["auth_session_userId_fkey", "f", ["userId"], "auth_user", "c"],
      ["auth_user_email_key", "u", ["email"], null, " "],
      ["auth_user_pkey", "p", ["id"], null, " "],
      ["auth_verification_pkey", "p", ["id"], null, " "],
    ]);
    const { rows: indexes } = await db.pool.query(
      "select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename like 'auth\\_%' order by indexname",
    );
    assert.deepEqual(indexes.map((r) => [r.indexname, r.indexdef]), [
      ["auth_account_pkey", "CREATE UNIQUE INDEX auth_account_pkey ON public.auth_account USING btree (id)"],
      ["auth_account_provider_account_uidx",
        'CREATE UNIQUE INDEX auth_account_provider_account_uidx ON public.auth_account USING btree ("providerId", "accountId")'],
      ["auth_account_userId_idx", 'CREATE INDEX "auth_account_userId_idx" ON public.auth_account USING btree ("userId")'],
      ["auth_session_pkey", "CREATE UNIQUE INDEX auth_session_pkey ON public.auth_session USING btree (id)"],
      ["auth_session_token_key", "CREATE UNIQUE INDEX auth_session_token_key ON public.auth_session USING btree (token)"],
      ["auth_session_userId_idx", 'CREATE INDEX "auth_session_userId_idx" ON public.auth_session USING btree ("userId")'],
      ["auth_user_email_key", "CREATE UNIQUE INDEX auth_user_email_key ON public.auth_user USING btree (email)"],
      ["auth_user_pkey", "CREATE UNIQUE INDEX auth_user_pkey ON public.auth_user USING btree (id)"],
      ["auth_verification_identifier_idx",
        "CREATE INDEX auth_verification_identifier_idx ON public.auth_verification USING btree (identifier)"],
      ["auth_verification_pkey", "CREATE UNIQUE INDEX auth_verification_pkey ON public.auth_verification USING btree (id)"],
    ]);
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
