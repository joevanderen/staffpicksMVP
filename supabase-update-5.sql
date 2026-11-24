-- The Algorhythm: update 5 (member questions, weekly vote, credit). SAFE: it only adds tables, functions and one column.
-- Run it in Supabase: SQL Editor > New query > paste > Run. (Updates 1 to 4 must already be done.)

-- ---------------------------------------------------------------
-- settings you can change in Table Editor > app_settings
-- ---------------------------------------------------------------
create table if not exists app_settings (key text primary key, value text not null);
alter table app_settings enable row level security;   -- no policies: only the functions below (and you) can read it
insert into app_settings (key, value) values ('question_approval', 'on') on conflict (key) do nothing;
-- 'on'  = you approve each suggested question before it can be drawn for a vote
-- 'off' = suggestions go straight into the pool

-- ---------------------------------------------------------------
-- the questions members suggest (no author column: authors live in question_authors)
-- ---------------------------------------------------------------
create table if not exists questions (
  id            uuid primary key default gen_random_uuid(),
  text          text not null check (char_length(text) between 15 and 140),
  category      text not null check (char_length(category) between 1 and 40),
  status        text not null default 'pending'
                check (status in ('pending','rejected','pool','candidate','scheduled','rotation','used','retired')),
  draws         int  not null default 0,        -- how many weekly votes it has been drawn into
  round_day     text,                           -- the Sunday its vote decides
  scheduled_day text,                           -- set on the winner
  asked_day     text,                           -- the day it was actually asked
  score         int,                            -- written only when a vote closes
  raters        int,
  created_at    timestamptz not null default now()
);
create index if not exists questions_status_idx on questions (status);

create table if not exists question_authors (
  question_id uuid primary key references questions(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade
);

create table if not exists question_votes (
  question_id uuid not null references questions(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  value       int  not null check (value in (-1, 0, 1)),
  primary key (question_id, user_id)
);

-- Which question (if any) a day's prompt came from
alter table daily_prompts add column if not exists question_id uuid references questions(id) on delete set null;

alter table questions        enable row level security;
alter table question_authors enable row level security;
alter table question_votes   enable row level security;

drop policy if exists "read questions"        on questions;
drop policy if exists "read question authors" on question_authors;
drop policy if exists "read own votes"        on question_votes;

-- Members see questions that are up for a vote, in the rotation, or already asked, plus their own.
-- The pool and the approval queue stay hidden from members (you, the admin, see everything).
create policy "read questions" on questions for select to authenticated using (
  is_admin()
  or (is_member() and (
        status in ('candidate','scheduled','rotation','used')
        or exists (select 1 from question_authors a where a.question_id = questions.id and a.user_id = auth.uid())))
);
-- Who wrote a question is visible to its author, and to everyone only once the question has been asked.
-- Not even the admin can read it through the site; only the Supabase dashboard shows it.
create policy "read question authors" on question_authors for select to authenticated using (
  is_member() and (
    user_id = auth.uid()
    or exists (select 1 from daily_prompts d where d.question_id = question_authors.question_id))
);
-- You can read only your own ratings. Nobody reads anyone else's.
create policy "read own votes" on question_votes for select to authenticated using (user_id = auth.uid());
-- (No insert/update/delete policies: all changes go through the functions below.)

-- ---------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------
create or replace function ba_today() returns text language sql stable
as $$ select to_char((now() at time zone 'utc') - interval '9 hours', 'YYYY-MM-DD') $$;

-- Closes every vote whose Sunday has started: tallies, picks the winner, files the rest.
create or replace function settle_rounds() returns void
language plpgsql security definer set search_path = public as $$
declare t text := ba_today(); r record; w uuid;
begin
  perform pg_advisory_xact_lock(7001);
  for r in select distinct round_day from questions where status = 'candidate' and round_day <= t order by 1 loop
    update questions q set
      score  = coalesce((select sum(value) from question_votes v where v.question_id = q.id), 0),
      raters = (select count(*) from question_votes v where v.question_id = q.id)
    where q.status = 'candidate' and q.round_day = r.round_day;

    -- the winner: highest score (random among ties), unless it was clearly disliked
    select id into w from questions
      where status = 'candidate' and round_day = r.round_day and not (score < 0 and raters >= 3)
      order by score desc, random() limit 1;
    if w is not null then
      update questions set status = 'scheduled', scheduled_day = r.round_day where id = w;
    end if;

    -- everyone else: above 0 joins the rotation; 0 gets one more draw; below 0 with 3+ raters is retired
    update questions set status = case
        when score > 0 then 'rotation'
        when score < 0 and raters >= 3 then 'retired'
        when draws < 2 then 'pool'
        else 'retired' end
      where status = 'candidate' and round_day = r.round_day;
  end loop;

  -- a winner nobody opened the site for goes to the rotation instead of being lost
  update questions set status = 'rotation'
    where status = 'scheduled' and scheduled_day < t
      and not exists (select 1 from daily_prompts d where d.question_id = questions.id);
end $$;
revoke execute on function settle_rounds() from public, anon, authenticated;

-- Called by the site on load: closes finished votes and, Monday to Friday, opens the next one.
create or replace function vote_round() returns json
language plpgsql security definer set search_path = public as $$
declare t text := ba_today(); d date := ba_today()::date; dow int := extract(dow from ba_today()::date)::int;
        target text; n int;
begin
  if not is_member() then return json_build_object('target', null); end if;
  perform settle_rounds();
  perform pg_advisory_xact_lock(7001);
  if dow = 0 then return json_build_object('target', null, 'today', t); end if;   -- Sunday: next vote opens Monday
  target := to_char(d + (7 - dow), 'YYYY-MM-DD');                                  -- the coming Sunday
  if dow between 1 and 5 and not exists (select 1 from questions where status = 'candidate' and round_day = target) then
    select count(*) into n from questions where status = 'pool';
    if n >= 2 then
      update questions set status = 'candidate', round_day = target, draws = draws + 1, score = null, raters = null
        where id in (select id from questions where status = 'pool' order by random() limit 3);
      delete from question_votes where question_id in (select id from questions where status = 'candidate' and round_day = target);
    end if;
  end if;
  return json_build_object('target', target, 'today', t);
end $$;
revoke execute on function vote_round() from public, anon;
grant execute on function vote_round() to authenticated;

-- ---------------------------------------------------------------
-- member actions
-- ---------------------------------------------------------------
create or replace function submit_question(p_text text, p_category text) returns questions
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); t text := btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'));
        c text := btrim(coalesce(p_category, '')); q questions; st text;
begin
  if not is_member() then raise exception 'Log in first.'; end if;
  if char_length(t) < 15 or char_length(t) > 140 then raise exception 'A question runs 15 to 140 characters.'; end if;
  if char_length(c) < 1 or char_length(c) > 40 then raise exception 'Pick a category.'; end if;
  if not is_admin() and (
       select count(*) from question_authors a join questions x on x.id = a.question_id
       where a.user_id = uid and x.created_at > now() - interval '7 days') >= 3 then
    raise exception 'That''s three suggestions this week. Try again in a few days.';
  end if;
  if exists (select 1 from questions where lower(text) = lower(t) and status <> 'rejected') then
    raise exception 'That question is already in.';
  end if;
  st := case when is_admin() or coalesce((select value from app_settings where key = 'question_approval'), 'on') = 'off'
             then 'pool' else 'pending' end;
  insert into questions (text, category, status) values (t, c, st) returning * into q;
  insert into question_authors (question_id, user_id) values (q.id, uid);
  return q;
end $$;
revoke execute on function submit_question(text, text) from public, anon;
grant execute on function submit_question(text, text) to authenticated;

create or replace function rate_question(p_question uuid, p_value int) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if not is_member() then raise exception 'Log in first.'; end if;
  if p_value not in (-1, 0, 1) then raise exception 'Pick one of the three.'; end if;
  if not exists (select 1 from questions where id = p_question and status = 'candidate' and round_day > ba_today()) then
    raise exception 'Voting on that question has closed.';
  end if;
  if exists (select 1 from question_authors where question_id = p_question and user_id = uid) then
    raise exception 'You can''t rate your own question.';
  end if;
  insert into question_votes (question_id, user_id, value) values (p_question, uid, p_value)
    on conflict (question_id, user_id) do update set value = excluded.value;
end $$;
revoke execute on function rate_question(uuid, int) from public, anon;
grant execute on function rate_question(uuid, int) to authenticated;

-- admin only: approve or reject a waiting question (optionally fixing its wording)
create or replace function review_question(p_id uuid, p_approve boolean, p_text text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t text := nullif(btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')), '');
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  if t is not null and (char_length(t) < 15 or char_length(t) > 140) then raise exception 'A question runs 15 to 140 characters.'; end if;
  update questions set status = case when p_approve then 'pool' else 'rejected' end, text = coalesce(t, text)
    where id = p_id and status = 'pending';
end $$;
revoke execute on function review_question(uuid, boolean, text) from public, anon;
grant execute on function review_question(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------
-- when a day's prompt is created: the Sunday winner always takes Sunday,
-- and a question that gets asked is marked as used
-- ---------------------------------------------------------------
create or replace function daily_prompts_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare q questions;
begin
  perform settle_rounds();
  select * into q from questions where status = 'scheduled' and scheduled_day = new.day limit 1;
  if found then
    new.question_id := q.id;
    new.prompt_key  := 'Q:' || q.id::text;
    new.prompt      := q.text;
    new.short_title := case when char_length(q.text) > 28 then left(q.text, 27) || '…' else q.text end;
    new.category    := q.category;
  end if;
  return new;
end $$;

create or replace function daily_prompts_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.question_id is not null then
    update questions set status = 'used', asked_day = new.day
      where id = new.question_id and status in ('rotation', 'scheduled');
  end if;
  return new;
end $$;

drop trigger if exists daily_prompts_before_ins on daily_prompts;
drop trigger if exists daily_prompts_after_ins  on daily_prompts;
create trigger daily_prompts_before_ins before insert on daily_prompts for each row execute function daily_prompts_before();
create trigger daily_prompts_after_ins  after  insert on daily_prompts for each row execute function daily_prompts_after();
