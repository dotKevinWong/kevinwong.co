-- Rotating third-party tokens.
--
-- These cannot live in environment variables: Vercel env vars are immutable at
-- runtime, so a job that refreshes its own credential has nowhere to put the new
-- value. Instagram long-lived tokens last 60 days and must be refreshed before
-- then, so the credential has to live somewhere the running function can write.

create table if not exists integration_tokens (
  provider     text primary key,
  access_token text        not null,
  expires_at   timestamptz not null,
  refreshed_at timestamptz not null default now(),
  -- Set when the provider tells us the token is permanently dead (Instagram
  -- error code 190). Cleared when a new token is seeded by hand. While this is
  -- set the sync makes no API calls at all.
  dead_reason  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
