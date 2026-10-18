import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import pg from "pg";
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
const ONE_OF_EACH = { users: 1, sessions: 1, accounts: 1, verifications: 1 };

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

// The rows outside 007 that the undo must leave alone: one or more in every other table in `public`.
const keptRows = async () => {
  const q = async (sql) => (await db.pool.query(sql)).rows;
  return {
    tokens: await q("select provider, access_token, expires_at from integration_tokens order by provider"),
    runs: await q("select job, trigger, dry_run, status, uploads from sync_runs order by id"),
    events: await q("select event, actor, details from admin_audit_log order by id"),
    locks: await q("select name, locked_until from job_locks order by name"),
    posts: await q("select id, source_key, posted_at from instagram_posts order by id"),
    media: await q("select id, post_id, position, kind::text, asset_url from instagram_media order by id"),
  };
};

const POST_ID = "00000000-0000-4000-8000-000000000001";
const MEDIA_ID = "00000000-0000-4000-8000-000000000002";

async function seed() {
  await db.pool.query(
    `insert into integration_tokens (provider, access_token, expires_at, refreshed_at, created_at, updated_at)
     values ('instagram', 'IGQ-test-token', '2026-12-01T00:00:00Z', '2026-10-01T00:00:00Z',
             '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z')`
  );
  await db.pool.query("insert into sync_runs (job, trigger, dry_run, status, uploads) values ('instagram', 'panel', false, 'ok', 3)");
  await db.pool.query(`insert into admin_audit_log (event, actor, details) values ('sign_in', 'github:1741711', '{"ipAddress":null}')`);
  await db.pool.query(
    `insert into job_locks (name, locked_until)
     values ('instagram-sync', '2026-10-18T05:15:00Z'), ('instagram-panel-import', '2026-10-19T12:00:00Z')`
  );
  await db.pool.query(
    `insert into instagram_posts (id, source_key, posted_at) values ($1, 'ig:TESTCODE', '2026-10-01T12:00:00Z')`,
    [POST_ID]
  );
  await db.pool.query(
    `insert into instagram_media (id, post_id, position, kind, cloudinary_public_id, cloudinary_url, cloudinary_folder,
                                  file_ext, source_uri, source_created_at, asset_url)
     values ($1, $2, 0, 'image', 'snapshots/TESTCODE-0', 'https://res.cloudinary.example/TESTCODE-0.jpg', 'snapshots',
             'jpg', 'https://instagram.example/TESTCODE-0.jpg', '2026-10-01T12:00:00Z',
             'https://blob.example/snapshots/202610/TESTCODE-0.jpg')`,
    [MEDIA_ID, POST_ID]
  );
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
    for (const [table, rows] of Object.entries(kept)) assert.ok(rows.length > 0, `${table} is seeded`);

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

  // A timeout, so that an undo without its lock_timeout fails this test instead of hanging the run. The holder
  // also ends itself: after 12 idle seconds in its transaction the server closes it and frees the lock, so such an
  // undo then succeeds and assert.rejects fails.
  test("the undo is all or nothing: blocked on auth_verification after two drops, it times out and rolls both back",
    { timeout: 30_000 }, async () => {
      await migrateThrough007();
      await seed();
      const migrated = await schema();

      // auth_verification is the third drop, so by the time the undo waits for this reader's lock it has already
      // dropped auth_session and auth_account. Its 5-second lock_timeout then fails the transaction, and the
      // rollback has to bring both back.
      const holder = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, ssl: false });
      holder.on("error", () => {});
      await holder.connect();
      try {
        await holder.query("set idle_in_transaction_session_timeout = '12s'");
        await holder.query("begin");
        await holder.query("select count(*) from auth_verification");
        await assert.rejects(apply(UNDO), (error) => {
          assert.equal(error.message, "sql/undo/undo-007.sql: canceling statement due to lock timeout");
          assert.equal(error.cause?.code, "55P03");
          return true;
        });
      } finally {
        await holder.query("rollback").catch(() => {});
        await holder.end().catch(() => {});
      }

      assert.deepEqual(await authTables(), AUTH_TABLES);
      assert.deepEqual(await schema(), migrated);
      assert.deepEqual(await authRowCounts(), ONE_OF_EACH);
    });

  test("the undo drops nothing it didn't create: a view on auth_user makes it fail and change nothing", async () => {
    await migrateThrough007();
    await seed();
    await db.pool.query(`create view owner_names as select "id", "name" from auth_user`);
    const withView = await schema();
    const kept = await keptRows();

    // Without a CASCADE, Postgres refuses to drop auth_user while the view depends on it. The first three drops had
    // succeeded, and the rollback brings them back.
    await assert.rejects(apply(UNDO), (error) => {
      assert.equal(error.message, "sql/undo/undo-007.sql: cannot drop table auth_user because other objects depend on it");
      assert.equal(error.cause?.code, "2BP01");
      return true;
    });

    assert.deepEqual(await schema(), withView);
    assert.deepEqual(await authTables(), AUTH_TABLES);
    assert.deepEqual(await authRowCounts(), ONE_OF_EACH);
    assert.deepEqual(await keptRows(), kept);
    assert.deepEqual((await db.pool.query("select id, name from owner_names")).rows, [{ id: "u1", name: "Kevin Wong" }]);
  });
});
