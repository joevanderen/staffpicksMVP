-- Staff Picks: update 1. SAFE for your live site: it only ADDS things.
-- It does not delete or change any existing post or reaction.
-- Run this in Supabase (SQL Editor > New query > paste > Run) BEFORE uploading the new site files.

-- 1) Captions can be 300 characters (was 200)
alter table posts drop constraint if exists posts_caption_check;
alter table posts add constraint posts_caption_check check (char_length(caption) <= 300);

-- 2) Reactions remember who clicked them (older reactions stay anonymous: "a friend")
alter table reactions add column if not exists name text check (name is null or char_length(name) <= 40);

-- 3) Optional "how sure are you" on posts (older posts stay blank)
alter table posts add column if not exists confidence text check (confidence is null or confidence in ('sure','vibes'));

-- 4) Saves now live online so a post can show who put it on their list
create table if not exists saves (
  post_id    uuid not null references posts(id) on delete cascade,
  device_id  text not null,
  name       text check (name is null or char_length(name) <= 40),
  created_at timestamptz not null default now(),
  primary key (post_id, device_id)
);
alter table saves enable row level security;
drop policy if exists "read saves"   on saves;
drop policy if exists "add saves"    on saves;
drop policy if exists "remove saves" on saves;
create policy "read saves"   on saves for select to anon using (true);
create policy "add saves"    on saves for insert to anon with check (true);
create policy "remove saves" on saves for delete to anon using (true);
