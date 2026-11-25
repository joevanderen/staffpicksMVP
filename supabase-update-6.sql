-- The Algorhythm: update 6 (profile photos and reaction faces). SAFE: it only adds a column, a private photo bucket and a few functions.
-- Run it in Supabase: SQL Editor > New query > paste > Run. (Updates 1 to 5 must already be done.)

-- Which photos each member has: {"main": 1732550000000, "surprised": ..., "happy": ..., "angry": ...}
-- (the number is the upload time and is part of the file's name, so a new photo never shows a stale one)
alter table profiles add column if not exists photos jsonb not null default '{}'::jsonb;
alter table profiles drop constraint if exists profiles_photos_shape;
alter table profiles add constraint profiles_photos_shape
  check (jsonb_typeof(photos) = 'object' and (photos - 'main' - 'surprised' - 'happy' - 'angry') = '{}'::jsonb);

-- A PRIVATE bucket: only logged-in members can see photos, and only through short-lived links.
-- Small JPEGs only (the site shrinks every photo to a 256-pixel square before uploading).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('faces', 'faces', false, 204800, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 204800, allowed_mime_types = array['image/jpeg'];

drop policy if exists "members read faces"       on storage.objects;
drop policy if exists "members upload own faces" on storage.objects;
drop policy if exists "members delete own faces" on storage.objects;

create policy "members read faces" on storage.objects for select to authenticated
  using (bucket_id = 'faces' and is_member());
-- each member can write only inside their own folder (the folder is named after their id)
create policy "members upload own faces" on storage.objects for insert to authenticated
  with check (bucket_id = 'faces' and is_member() and (storage.foldername(name))[1] = auth.uid()::text);
-- members can delete their own photos; you (admin) can delete anyone's
create policy "members delete own faces" on storage.objects for delete to authenticated
  using (bucket_id = 'faces' and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()));

-- Records (or removes) one of my photos. Pass a null version to remove it.
create or replace function set_my_photo(p_kind text, p_version bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_member() then raise exception 'Log in first.'; end if;
  if p_kind not in ('main', 'surprised', 'happy', 'angry') then raise exception 'Unknown photo.'; end if;
  if p_version is null then
    update profiles set photos = photos - p_kind where id = auth.uid();
  else
    if p_version < 1 then raise exception 'Bad version.'; end if;
    update profiles set photos = photos || jsonb_build_object(p_kind, p_version) where id = auth.uid();
  end if;
end $$;
revoke execute on function set_my_photo(text, bigint) from public, anon;
grant execute on function set_my_photo(text, bigint) to authenticated;

-- Removes all of my photos from my profile (the site then deletes the files).
create or replace function clear_my_photos() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_member() then raise exception 'Log in first.'; end if;
  update profiles set photos = '{}'::jsonb where id = auth.uid();
end $$;
revoke execute on function clear_my_photos() from public, anon;
grant execute on function clear_my_photos() to authenticated;

-- Admin only: remove everything from someone's profile photos.
create or replace function admin_clear_photos(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  update profiles set photos = '{}'::jsonb where id = p_user;
end $$;
revoke execute on function admin_clear_photos(uuid) from public, anon;
grant execute on function admin_clear_photos(uuid) to authenticated;
