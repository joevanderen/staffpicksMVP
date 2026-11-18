-- Staff Picks database, version 2 (daily prompts).
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
--
-- WARNING: the first two lines erase the old test tables (posts and reactions from the
-- weekly version) so the new layout can be created cleanly. Fine in beta. Don't re-run
-- this file later once real posts exist, or they will be deleted.

drop table if exists reactions cascade;
drop table if exists posts cascade;
drop table if exists daily_prompts cascade;

-- One row per day: the question everyone answers. Written once, never changed,
-- so editing the prompt list later never rewrites history.
create table daily_prompts (
  day         text primary key check (day ~ '^\d{4}-\d{2}-\d{2}$'),   -- e.g. 2026-11-13 (a day starts 6 AM Buenos Aires)
  prompt_key  text not null,
  prompt      text not null,
  short_title text not null,
  category    text not null,
  created_at  timestamptz not null default now()
);

create table posts (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  day          text not null check (day ~ '^\d{4}-\d{2}-\d{2}$'),
  author_name  text not null check (char_length(author_name) between 1 and 40),
  device_id    text not null,
  title        text not null check (char_length(title) between 1 and 120),
  caption      text not null default '' check (char_length(caption) <= 200),
  link         text check (link is null or char_length(link) <= 500),
  scope        text not null default 'global',   -- later: global / national / state / city / circle
  scope_ref    text                              -- later: which country, state, city or friend group
);

-- One answer per person (device) per day.
create unique index posts_one_per_day on posts (day, device_id);
create index posts_created_idx on posts (created_at desc);

create table reactions (
  post_id    uuid not null references posts(id) on delete cascade,
  device_id  text not null,
  kind       text not null check (kind in ('never_heard','disagree','same','want_to_try','loved_it')),
  created_at timestamptz not null default now(),
  primary key (post_id, device_id, kind)
);

alter table daily_prompts enable row level security;
alter table posts         enable row level security;
alter table reactions     enable row level security;

create policy "read prompts"     on daily_prompts for select to anon using (true);
-- A day's prompt can be created by whoever opens the site first that day, but never for a future day.
create policy "add prompts"      on daily_prompts for insert to anon
  with check (day <= to_char((now() at time zone 'utc') - interval '9 hours', 'YYYY-MM-DD'));

create policy "read posts"       on posts         for select to anon using (true);
create policy "add posts"        on posts         for insert to anon with check (true);

create policy "read reactions"   on reactions     for select to anon using (true);
create policy "add reactions"    on reactions     for insert to anon with check (true);
create policy "remove reactions" on reactions     for delete to anon using (true);

-- No update or delete policies: to remove a post or change a day's prompt,
-- edit the row in the Supabase Table Editor.
