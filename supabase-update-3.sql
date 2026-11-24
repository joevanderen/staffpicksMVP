-- The Algorhythm: update 3 (comments). SAFE: it only adds a table and its rules.
-- Run it in Supabase: SQL Editor > New query > paste > Run. (Update 2 must already be done.)

create table if not exists comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references posts(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  author_name text not null check (char_length(author_name) between 1 and 40),
  body        text not null check (char_length(body) between 1 and 200),
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists comments_post_idx on comments (post_id, created_at);
alter table comments enable row level security;

drop policy if exists "members read comments"   on comments;
drop policy if exists "members add comments"    on comments;
drop policy if exists "admins hide comments"    on comments;
drop policy if exists "members delete comments" on comments;

-- Only logged-in members can read or write comments (name-only visitors can't see them).
create policy "members read comments" on comments for select to authenticated
  using (is_member() and (hidden = false or user_id = auth.uid() or is_admin()));
create policy "members add comments" on comments for insert to authenticated
  with check (is_member() and user_id = auth.uid() and hidden = false);
create policy "admins hide comments" on comments for update to authenticated
  using (is_admin()) with check (is_admin());
create policy "members delete comments" on comments for delete to authenticated
  using (user_id = auth.uid() or is_admin());
