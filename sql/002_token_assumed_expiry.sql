-- A token generated from the Meta App Dashboard arrives without an expires_in,
-- so seeding it can only assume Meta's documented 60 days. If the real remaining
-- life is shorter, the normal refresh window (inside 30 days of expiry) would not
-- open until long after the token had actually died.
--
-- Flagging the guess lets ensureFreshToken() force one early refresh, which
-- replaces it with Meta's authoritative expires_in.

alter table integration_tokens
  add column if not exists expires_at_is_assumed boolean not null default false;
