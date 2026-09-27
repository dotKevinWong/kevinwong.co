-- Leases that stop two runs of a scheduled job from overlapping.
--
-- Vercel documents that a cron event can occasionally be delivered more than
-- once, and the Instagram sync can also be run by hand. Two overlapping syncs
-- would both upload the same missing posts to Blob — spending the Hobby plan's
-- hard-capped monthly uploads — before one of them lost the insert race.
--
-- A lease row rather than pg_advisory_lock: DATABASE_URL goes through Neon's
-- PgBouncer pooler in transaction mode, where a session-level advisory lock can
-- stay attached to a pooled server connection after the client that took it is
-- gone. A lease also frees itself if the function is killed mid-run.
--
-- Additive; safe to apply at any time.

create table if not exists job_locks (
  name         text primary key,
  locked_until timestamptz not null default 'epoch'
);
