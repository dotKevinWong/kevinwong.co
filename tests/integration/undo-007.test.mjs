import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { testDb } from "../helpers/db.mjs";
import { applySqlFiles } from "../../scripts/db-apply.mjs";

const db = testDb();
const sqlFile = (name) => fileURLToPath(new URL(`../../sql/${name}`, import.meta.url));
const UNDO = sqlFile("undo/undo-007.sql");
const M005 = sqlFile("005_integration_tokens_spotify.sql");
const M006 = sqlFile("006_sync_runs.sql");
const M007 = sqlFile("007_auth.sql");

// db:apply's own code path: each file on a fresh connection, sent whole as one simple query, so a failure leaves
// no pool connection inside an aborted transaction.
const apply = (file) => applySqlFiles(process.env.TEST_DATABASE_URL, [file], { log: () => {} });
// The schema just before Deploy B: the fixture plus 005 and 006. resetSchema() also applies 008 and later, if any.
const migrateThrough006 = async () => {
  await db.resetSchema({ applyMigrations: false });
  await apply(M005);
  await apply(M006);
};
const migrateThrough007 = async () => {
  await migrateThrough006();
  await apply(M007);
};

const AUTH_TABLES = ["auth_account", "auth_session", "auth_user", "auth_verification"];

/** Everything in `public` that a table drop could leave behind or take with it. */
async function schema() {
  const q = async (sql) => (await db.pool.query(sql)).rows;
  return {
    relations: await q(
      `select c.relname, c.relkind::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' order by c.relname`
    ),
    columns: await q(
      `select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' order by table_name, ordinal_position`
    ),
    constraints: await q(
      `select c.conrelid::regclass::text as relation, c.conname, c.contype::text from pg_constraint c
         join pg_namespace n on n.oid = c.connamespace
        where n.nspname = 'public' order by relation, c.conname`
    ),
    types: (await q(
      `select t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public' order by t.typname`
    )).map((row) => row.typname),
  };
}

const authTables = async () =>
  (await db.pool.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name like 'auth\\_%' order by table_name`
  )).rows.map((row) => row.table_name);

const authRowCounts = async () =>
  (await db.pool.query(
    `select (select count(*) from auth_user)::int as users, (select count(*) from auth_session)::int as sessions,
            (select count(*) from auth_account)::int as accounts,
            (select count(*) from auth_verification)::int as verifications`
  )).rows[0];

// The rows outside 007 that the undo must leave alone.
const keptRows = async () => {
  const q = async (sql) => (await db.pool.query(sql)).rows;
  return {
    tokens: await q("select provider, access_token, expires_at from integration_tokens order by provider"),
    runs: await q("select job, trigger, dry_run, status, uploads from sync_runs order by id"),
    events: await q("select event, actor, details from admin_audit_log order by id"),
  };
};

async function seed() {
  await db.pool.query(
    `insert into integration_tokens (provider, access_token, expires_at, refreshed_at, created_at, updated_at)
     values ('instagram', 'IGQ-test-token', '2026-12-01T00:00:00Z', '2026-10-01T00:00:00Z',
             '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z')`
  );
  await db.pool.query("insert into sync_runs (job, trigger, dry_run, status, uploads) values ('instagram', 'panel', false, 'ok', 3)");
  await db.pool.query(`insert into admin_audit_log (event, actor, details) values ('sign_in', 'github:1741711', '{"ipAddress":null}')`);
  await db.pool.query(
    `insert into auth_user ("id", "name", "email", "updatedAt")
     values ('u1', 'Kevin Wong', '1741711@github.placeholder.invalid', now())`
  );
  await db.pool.query(
    `insert into auth_session ("id", "expiresAt", "token", "updatedAt", "userId")
     values ('s1', now() + interval '1 day', 'session-token', now(), 'u1')`
  );
  await db.pool.query(
    `insert into auth_account ("id", "accountId", "providerId", "userId", "updatedAt")
     values ('a1', '1741711', 'github', 'u1', now())`
  );
  await db.pool.query(
    `insert into auth_verification ("id", "identifier", "value", "expiresAt")
     values ('v1', 'some-identifier', 'some-value', now() + interval '10 minutes')`
  );
}

describe("undoing 007 (sql/undo/undo-007.sql)", { skip: db.skip }, () => {
  let before007;

  before(async () => {
    await migrateThrough006();
    before007 = await schema();
  });
  after(() => db.close());

  test("the undo drops the four auth tables with their rows, and leaves the schema as it was before 007", async () => {
    await migrateThrough007();
    await seed();
    assert.deepEqual(await authTables(), AUTH_TABLES);
    const kept = await keptRows();
    assert.equal(kept.events.length, 1);

    await apply(UNDO);

    assert.deepEqual(await authTables(), []);
    assert.deepEqual(await schema(), before007);
    assert.deepEqual(await keptRows(), kept);

    // Safe to run twice.
    await apply(UNDO);
    assert.deepEqual(await schema(), before007);
    assert.deepEqual(await keptRows(), kept);
  });

  test("007 applies again after the undo, and its schema comes back empty", async () => {
    await migrateThrough007();
    const migrated = await schema();
    await seed();

    await apply(UNDO);
    await apply(M007);

    assert.deepEqual(await schema(), migrated);
    assert.deepEqual(await authRowCounts(), { users: 0, sessions: 0, accounts: 0, verifications: 0 });
  });

  test("the undo is all or nothing: blocked by a lock on auth_user, it times out and every auth table and row stays", async () => {
    await migrateThrough007();
    await seed();
    const migrated = await schema();

    // An open transaction that has read auth_user holds a lock that the drops wait for, past the file's
    // 5-second lock_timeout. The rollback takes back every drop the transaction had already made.
    const holder = await db.pool.connect();
    try {
      await holder.query("begin");
      await holder.query("select count(*) from auth_user");
      await assert.rejects(apply(UNDO), (error) => {
        assert.equal(error.message, "sql/undo/undo-007.sql: canceling statement due to lock timeout");
        assert.equal(error.cause?.code, "55P03");
        return true;
      });
    } finally {
      await holder.query("rollback");
      holder.release();
    }

    assert.deepEqual(await authTables(), AUTH_TABLES);
    assert.deepEqual(await schema(), migrated);
    assert.deepEqual(await authRowCounts(), { users: 1, sessions: 1, accounts: 1, verifications: 1 });
  });
});
