-- The Algorhythm: LOCK. Run this ONLY after every friend has joined and had their old answers linked.
-- After it runs, nobody can read or write anything without logging in. (Logged-out visitors can still
-- check an invite link.) Then set REQUIRE_LOGIN: true in config.js.
-- Undo: run the "tighten the old name-only rules" part of supabase-update-2.sql again.

drop policy if exists "read prompts"     on daily_prompts;
drop policy if exists "add prompts"      on daily_prompts;
drop policy if exists "read posts"       on posts;
drop policy if exists "add posts"        on posts;
drop policy if exists "read reactions"   on reactions;
drop policy if exists "add reactions"    on reactions;
drop policy if exists "remove reactions" on reactions;
drop policy if exists "read saves"       on saves;
drop policy if exists "add saves"        on saves;
drop policy if exists "remove saves"     on saves;
