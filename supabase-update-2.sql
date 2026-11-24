-- The Algorhythm: update 2 (accounts, usernames, invite links, moderation).
-- SAFE for your live site: it only ADDS things and tightens who can write as whom.
-- Existing posts, reactions and saves are untouched, and people can keep using the site
-- with just a name until you run supabase-lock.sql later.
-- Run it in Supabase: SQL Editor > New query > paste > Run. Run supabase-update-1.sql first if you haven't.

-- ============ 1) members ============
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  role         text not null default 'member' check (role in ('member','admin')),
  blocked      boolean not null default false,
  invited_by   uuid references profiles(id) on delete set null,
  invite_code  text,
  created_at   timestamptz not null default now()
);
alter table profiles enable row level security;

-- helpers used by the rules below
create or replace function is_member() returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and not blocked) $$;

create or replace function is_admin() returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and not blocked) $$;

-- ============ 2) invites ============
create table if not exists invites (
  code        text primary key,
  created_by  uuid references profiles(id) on delete cascade,
  uses_left   int not null default 1 check (uses_left >= 0),
  grants_admin boolean not null default false,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz
);
alter table invites enable row level security;

-- ============ 3) link rows to people ============
alter table posts     add column if not exists user_id uuid references profiles(id) on delete set null;
alter table posts     add column if not exists hidden  boolean not null default false;
alter table reactions add column if not exists user_id uuid references profiles(id) on delete set null;
alter table saves     add column if not exists user_id uuid references profiles(id) on delete set null;

-- ============ 4) functions the website calls ============
-- Anyone (even logged out) can ask "is this invite code real, and who made it?"
create or replace function check_invite(p_code text) returns json
  language plpgsql stable security definer set search_path = public as $$
declare i invites; n text;
begin
  select * into i from invites
   where code = upper(trim(p_code)) and uses_left > 0 and (expires_at is null or expires_at > now());
  if not found then return json_build_object('valid', false); end if;
  select display_name into n from profiles where id = i.created_by;
  return json_build_object('valid', true, 'inviter', n);
end $$;

-- A logged-in person turns an invite into a membership (name + username).
create or replace function redeem_invite(p_code text, p_username text, p_display_name text) returns profiles
  language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  uname text := lower(trim(p_username));
  dname text := trim(p_display_name);
  i invites;
  p profiles;
begin
  if uid is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from profiles where id = uid) then raise exception 'already_member'; end if;
  if uname !~ '^[a-z0-9_]{3,20}$' then raise exception 'bad_username'; end if;
  if uname = any (array['admin','administrator','root','support','staff','mod','moderator','help','system',
                        'algorhythm','thealgorhythm','null','undefined','me','you','everyone','all']) then
    raise exception 'reserved_username';
  end if;
  if not (char_length(dname) between 1 and 40) then raise exception 'bad_name'; end if;
  if exists (select 1 from profiles where username = uname) then raise exception 'username_taken'; end if;
  update invites set uses_left = uses_left - 1
   where code = upper(trim(p_code)) and uses_left > 0 and (expires_at is null or expires_at > now())
   returning * into i;
  if not found then raise exception 'bad_invite'; end if;
  insert into profiles (id, username, display_name, role, invited_by, invite_code)
  values (uid, uname, dname, case when i.grants_admin then 'admin' else 'member' end, i.created_by, i.code)
  returning * into p;
  return p;
end $$;

-- Members make invite links. Regular members get 3 in total (change the 3 below to give more).
-- Admins can make links that several people can use.
create or replace function create_invite(p_uses int default 1) returns text
  language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); p profiles; n int; c text; u int := coalesce(p_uses, 1);
begin
  select * into p from profiles where id = uid and not blocked;
  if not found then raise exception 'not_member'; end if;
  if p.role <> 'admin' then
    select count(*) into n from invites where created_by = uid;
    if n >= 3 then raise exception 'invite_limit'; end if;
    u := 1;
  else
    u := greatest(1, least(u, 100));
  end if;
  c := upper(substr(md5(random()::text || clock_timestamp()::text || uid::text), 1, 8));
  insert into invites (code, created_by, uses_left) values (c, uid, u);
  return c;
end $$;

-- Only YOU run this one, here in the SQL editor, to attach a friend's old answers to their new account.
create or replace function link_old_data(p_username text, p_author_name text) returns text
  language plpgsql security definer set search_path = public as $$
declare uid uuid; devs text[]; np int; nr int; ns int;
begin
  select id into uid from profiles where username = lower(trim(p_username));
  if uid is null then raise exception 'No member with that username'; end if;
  select array_agg(distinct device_id) into devs from posts
   where author_name = p_author_name and user_id is null and device_id not like 'u:%';
  if devs is null then return 'Nothing to link for that name'; end if;
  update posts     set user_id = uid, device_id = 'u:' || uid where device_id = any (devs) and user_id is null;
  get diagnostics np = row_count;
  update reactions set user_id = uid, device_id = 'u:' || uid where device_id = any (devs) and user_id is null;
  get diagnostics nr = row_count;
  update saves     set user_id = uid, device_id = 'u:' || uid where device_id = any (devs) and user_id is null;
  get diagnostics ns = row_count;
  return 'Linked ' || np || ' posts, ' || nr || ' reactions, ' || ns || ' saves';
end $$;
revoke execute on function link_old_data(text, text) from public, anon, authenticated;

-- ============ 5) rules for logged-in members ============
-- (Anonymous, name-only use keeps working through the old rules until you run supabase-lock.sql.)
drop policy if exists "members read prompts"  on daily_prompts;
drop policy if exists "members add prompts"   on daily_prompts;
create policy "members read prompts" on daily_prompts for select to authenticated using (is_member());
create policy "members add prompts"  on daily_prompts for insert to authenticated
  with check (is_member() and day <= to_char((now() at time zone 'utc') - interval '9 hours', 'YYYY-MM-DD'));

drop policy if exists "members read profiles"  on profiles;
drop policy if exists "admins update profiles" on profiles;
create policy "members read profiles"  on profiles for select to authenticated using (is_member() or id = auth.uid());
create policy "admins update profiles" on profiles for update to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "read own invites" on invites;
create policy "read own invites" on invites for select to authenticated using (created_by = auth.uid() or is_admin());

drop policy if exists "members read posts"  on posts;
drop policy if exists "members add posts"   on posts;
drop policy if exists "admins update posts" on posts;
create policy "members read posts" on posts for select to authenticated
  using (is_member() and (hidden = false or user_id = auth.uid() or is_admin()));
create policy "members add posts"  on posts for insert to authenticated
  with check (is_member() and user_id = auth.uid() and device_id = 'u:' || auth.uid()::text and hidden = false);
create policy "admins update posts" on posts for update to authenticated using (is_admin()) with check (is_admin());

drop policy if exists "members read reactions"   on reactions;
drop policy if exists "members add reactions"    on reactions;
drop policy if exists "members remove reactions" on reactions;
create policy "members read reactions"   on reactions for select to authenticated using (is_member());
create policy "members add reactions"    on reactions for insert to authenticated
  with check (is_member() and user_id = auth.uid() and device_id = 'u:' || auth.uid()::text);
create policy "members remove reactions" on reactions for delete to authenticated using (user_id = auth.uid());

drop policy if exists "members read saves"   on saves;
drop policy if exists "members add saves"    on saves;
drop policy if exists "members remove saves" on saves;
create policy "members read saves"   on saves for select to authenticated using (is_member());
create policy "members add saves"    on saves for insert to authenticated
  with check (is_member() and user_id = auth.uid() and device_id = 'u:' || auth.uid()::text);
create policy "members remove saves" on saves for delete to authenticated using (user_id = auth.uid());

-- ============ 6) tighten the old name-only rules ============
-- Name-only visitors can no longer pose as a member, and can't see hidden posts.
drop policy if exists "read posts"       on posts;
drop policy if exists "add posts"        on posts;
drop policy if exists "add reactions"    on reactions;
drop policy if exists "add saves"        on saves;
create policy "read posts"     on posts     for select to anon using (hidden = false);
create policy "add posts"      on posts     for insert to anon with check (user_id is null and hidden = false and device_id not like 'u:%');
create policy "add reactions"  on reactions for insert to anon with check (user_id is null and device_id not like 'u:%');
create policy "add saves"      on saves     for insert to anon with check (user_id is null and device_id not like 'u:%');

-- ============ 7) your admin invite (shown at the bottom of the results) ============
insert into invites (code, uses_left, grants_admin)
select upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)), 1, true
where not exists (select 1 from profiles) and not exists (select 1 from invites where grants_admin);

select code as your_admin_invite_code from invites where grants_admin and uses_left > 0;
