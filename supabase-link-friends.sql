-- The Algorhythm: attach each friend's OLD answers to their new account.
-- Do this after they've joined with an invite link.

-- Step 1: see who has old answers that aren't linked yet.
-- (If a name shows more than one device, that person posted from several phones/computers. That's fine.)
select author_name, count(*) as posts, count(distinct device_id) as devices
from posts where user_id is null group by author_name order by author_name;

-- Step 2: see who has joined.
select username, display_name, created_at from profiles order by created_at;

-- Step 3: link, one line per friend: (their username, the name they typed back when they posted).
-- Edit the examples, then run. It tells you how many rows it moved.
-- select link_old_data('dana', 'Dana');
-- select link_old_data('sam', 'Sam');
