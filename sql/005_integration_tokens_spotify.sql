-- Spotify's credential moves from the refresh_token env var into this table,
-- so a reconnect from /admin takes effect without a redeploy (an env var is
-- fixed for the life of a deployment; see 001).
--
-- Spotify's lasting credential is a refresh token. Its access tokens last an
-- hour and are only cached in memory, so the spotify row has no access_token:
-- that column becomes nullable, and a CHECK keeps every row holding at least
-- one of the two tokens. The instagram row is untouched, and every Instagram
-- reader filters on provider = 'instagram'.
--
--   refresh_token  Spotify's refresh token (the instagram row leaves it null).
--   authorized_at  When the owner last clicked Approve. Spotify ends an
--                  authorization 180 days after approval and refreshing does
--                  not extend it, so the spotify row's expires_at is
--                  authorized_at + 180 days with expires_at_is_assumed = true.
--   account_id     The Spotify account that approved, checked against the
--                  pinned owner account.
--   scopes         The granted scopes, space-separated as Spotify returns them.
--
-- ADD CONSTRAINT has no IF NOT EXISTS, so the CHECK is dropped and added again,
-- which keeps this file safe to run twice. The ALTERs need an ACCESS EXCLUSIVE
-- lock, so, as in 003, fail fast rather than queue every reader behind them,
-- with `set local` inside one transaction because of the pooler (see 004).
--
-- Safe to apply before the code that uses it: the deployed code only reads and
-- writes the instagram row, which always has an access_token.
begin;

set local lock_timeout = '5s';

alter table integration_tokens
  add column if not exists refresh_token text,
  add column if not exists authorized_at timestamptz,
  add column if not exists account_id    text,
  add column if not exists scopes        text;

alter table integration_tokens
  alter column access_token drop not null;

alter table integration_tokens
  drop constraint if exists integration_tokens_has_token;

alter table integration_tokens
  add constraint integration_tokens_has_token
  check (access_token is not null or refresh_token is not null);

commit;
