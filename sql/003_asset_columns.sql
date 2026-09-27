-- Storage-neutral columns for /snapshots media, replacing the Cloudinary-specific
-- ones as media moves to Vercel Blob.
--
-- Expand/contract: these are added alongside cloudinary_* rather than renaming
-- them, because the code already deployed to production selects cloudinary_url
-- and friends by name. Nullable, so this is safe to apply at any time: existing
-- rows are untouched and the deployed read path never sees these columns.
--
-- During the transition the sync writes both sets (see insertPost in
-- lib/instagram-sync.js) and the read path prefers asset_*. Dropping cloudinary_*
-- is a later, separate step — see "Retiring Cloudinary" in the README.

-- Fail fast rather than queue behind a long-running transaction: the ALTER needs
-- an ACCESS EXCLUSIVE lock, and while it waits every live SELECT on the table
-- would queue behind it.
set lock_timeout = '5s';

alter table instagram_media
  add column if not exists asset_url          text,
  add column if not exists asset_pathname     text,
  add column if not exists asset_content_type text,
  add column if not exists asset_bytes        bigint,
  add column if not exists asset_width        integer,
  add column if not exists asset_height       integer;
