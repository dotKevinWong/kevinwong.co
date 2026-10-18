-- Undoes 007. Drops Better Auth's four tables, with every row in them:
-- auth_session (everyone is signed out), auth_account and auth_user (the
-- owner's GitHub sign-in record, created again at the next sign-in after 007
-- goes back on) and auth_verification (always empty). admin_audit_log (006)
-- and its sign-in history stay.
--
-- Precondition: the code is rolled back first (Vercel Instant Rollback to
-- Deploy A's deployment). Deploy B's Better Auth fails every request while its
-- tables are missing; Deploy A's code never reads them.
--
-- Not a migration: setup and the test database apply only sql/'s numbered
-- files. Run it with npm run db:apply (README, *Undoing 007*), which sends the
-- whole file as one query. The drops run in one transaction, the two tables
-- that reference auth_user before it, so either all four go or none do. Each
-- drop needs an ACCESS EXCLUSIVE lock, so, as in 005, they fail fast rather
-- than queue every reader. Safe to run twice, and 007 applies again afterwards.
begin;
set local lock_timeout = '5s';
drop table if exists auth_session;
drop table if exists auth_account;
drop table if exists auth_verification;
drop table if exists auth_user;
commit;
