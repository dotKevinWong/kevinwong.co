-- Undoes 005 and 006. integration_tokens loses 005's columns (refresh_token,
-- authorized_at, account_id, scopes) and its CHECK, and access_token is NOT
-- NULL again. sync_runs and admin_audit_log are dropped, with every run they
-- recorded, including the uploads the 1,800-in-30-days ceiling counts.
--
-- Two preconditions, in this order:
--   1. The code from before Deploy A is live first. Once Deploy B is live,
--      Instant Rollback reaches only Deploy A, whose code still reads 005's
--      columns and writes sync_runs: revert Deploy B's and Deploy A's commits
--      on main and push (README, *Undoing 005 and 006*). Without sync_runs, a
--      real sync in the newer code stands down and imports nothing.
--   2. Then the spotify row is deleted (delete-spotify-row.sql), which throws
--      away the stored Spotify refresh token. With that row still there, the
--      SET NOT NULL fails with 23502 and nothing is changed.
--
-- Not a migration: setup and the test database apply only sql/'s numbered
-- files. Run it with npm run db:apply (README, *Undoing 005 and 006*), which
-- sends the whole file as one query: Postgres stops at a failing statement, so
-- the drop after commit runs only once the transaction above it has
-- committed. The ALTERs need an ACCESS EXCLUSIVE lock, so, as in 005, they
-- fail fast rather than queue every reader. Safe to run twice, and 005 and
-- 006 apply again afterwards.
begin;
set local lock_timeout = '5s';
alter table integration_tokens drop constraint if exists integration_tokens_has_token;
alter table integration_tokens alter column access_token set not null;
alter table integration_tokens drop column if exists refresh_token, drop column if exists authorized_at,
  drop column if exists account_id, drop column if exists scopes;
commit;
drop table if exists sync_runs, admin_audit_log;
