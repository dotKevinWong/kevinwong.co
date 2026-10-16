-- A record of every Instagram sync run, and of what is done through /admin.
--
-- The sync's only record used to be its logs, which the Hobby plan deletes
-- after an hour. sync_runs keeps one row per run, from the cron, the panel or
-- the CLI, so /admin can show the last run, recent errors, and the uploads
-- spent over the last 30 days against Blob's hard monthly cap (uploads counts
-- real Blob uploads; on a dry run it is what the run would have uploaded). A
-- run killed mid-way never finishes its row, so the next run marks a 'running'
-- row older than 15 minutes whose lease has expired as 'abandoned'. summary is
-- the run's summary after redact() and a size cap (lib/redact.js), so it holds
-- no tokens.
--
-- admin_audit_log records sign-ins, refused sign-ins, Spotify reconnects and
-- panel runs, with redacted details.
--
-- New tables only, so no lock_timeout wrapper (as in 001 and 004). Additive;
-- safe to apply at any time and to run twice.

create table if not exists sync_runs (
  id          bigint      generated always as identity primary key,
  job         text        not null,
  trigger     text        not null check (trigger in ('cron', 'panel', 'cli')),
  dry_run     boolean     not null,
  status      text        not null default 'running'
              check (status in ('running', 'ok', 'partial', 'skipped', 'failed',
                                'reauth_required', 'abandoned')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  fetched     integer     not null default 0,
  imported    integer     not null default 0,
  uploads     integer     not null default 0,
  deferred    integer     not null default 0,
  skipped     integer     not null default 0,
  error_count integer     not null default 0,
  error       text,
  summary     jsonb
);

create index if not exists sync_runs_job_started_at_idx
  on sync_runs (job, started_at desc);

create table if not exists admin_audit_log (
  id      bigint      generated always as identity primary key,
  at      timestamptz not null default now(),
  event   text        not null,
  actor   text,
  details jsonb       not null default '{}'::jsonb
);

create index if not exists admin_audit_log_at_idx
  on admin_audit_log (at desc);
