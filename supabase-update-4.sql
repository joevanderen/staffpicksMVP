-- The Algorhythm: update 4 (custom card looks). SAFE: it only adds columns and one function.
-- Run it in Supabase: SQL Editor > New query > paste > Run. (Updates 2 and 3 must already be done.)

-- A person's saved look, and the look each post was made with.
alter table profiles add column if not exists card_style jsonb;
alter table posts    add column if not exists card_style jsonb;

-- Only a style number (0-9) and three hex colors are allowed. Nothing else can be stored.
alter table profiles drop constraint if exists profiles_card_style_shape;
alter table profiles add constraint profiles_card_style_shape check (
  card_style is null or (
    jsonb_typeof(card_style) = 'object'
    and (card_style->>'t')  ~ '^[0-9]$'
    and (card_style->>'bg') ~ '^#[0-9a-fA-F]{6}$'
    and (card_style->>'fg') ~ '^#[0-9a-fA-F]{6}$'
    and (card_style->>'tc') ~ '^#[0-9a-fA-F]{6}$'));
alter table posts drop constraint if exists posts_card_style_shape;
alter table posts add constraint posts_card_style_shape check (
  card_style is null or (
    jsonb_typeof(card_style) = 'object'
    and (card_style->>'t')  ~ '^[0-9]$'
    and (card_style->>'bg') ~ '^#[0-9a-fA-F]{6}$'
    and (card_style->>'fg') ~ '^#[0-9a-fA-F]{6}$'
    and (card_style->>'tc') ~ '^#[0-9a-fA-F]{6}$'));

-- Members change only their own look, through this function (so nobody can edit their own role or block status).
create or replace function set_card_style(p_style jsonb) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not is_member() then raise exception 'not_member'; end if;
  update profiles set card_style = p_style where id = auth.uid();
end $$;
