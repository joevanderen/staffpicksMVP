-- Update 7: let people edit their answer on the day they posted it.
-- Paste into Supabase > SQL Editor > Run. Safe to run twice.

alter table posts add column if not exists edited_at timestamptz;

-- Only your own post, only while its day is still "today" (days turn over at 6 AM Buenos Aires).
create or replace function edit_my_post(p_id uuid, p_title text, p_caption text, p_link text, p_confidence text)
returns posts language plpgsql security definer set search_path = public as $$
declare r posts;
begin
  if not is_member() then raise exception 'not_member'; end if;
  p_title   := btrim(coalesce(p_title, ''));
  p_caption := btrim(coalesce(p_caption, ''));
  p_link    := nullif(btrim(coalesce(p_link, '')), '');
  if char_length(p_title) not between 1 and 120 then raise exception 'bad_title'; end if;
  if char_length(p_caption) > 300 then raise exception 'bad_caption'; end if;
  if p_link is not null and (char_length(p_link) > 500 or p_link !~* '^https?://') then raise exception 'bad_link'; end if;
  if p_confidence is not null and p_confidence not in ('sure', 'vibes') then raise exception 'bad_confidence'; end if;
  update posts
     set title = p_title, caption = p_caption, link = p_link, confidence = p_confidence, edited_at = now()
   where id = p_id and user_id = auth.uid() and day = ba_today()
   returning * into r;
  if not found then raise exception 'not_editable'; end if;
  return r;
end $$;
revoke all on function edit_my_post(uuid, text, text, text, text) from public, anon;
grant execute on function edit_my_post(uuid, text, text, text, text) to authenticated;
