# Staff Picks — spec (v1: daily prompt)

**Idea:** one question a day for everybody. Answer today's to unlock everyone's answers. Curation by people you know, not an algorithm.

## Built in v1
- **Daily prompt:** one question per day, day starts 6 AM Buenos Aires. Picked once from the master list (equal chance per prompt, no repeats until exhausted, never the same category two days running) and stored, so past days never change.
- **Gate:** you can't see anything until you've answered today's. No peek.
- **Reveal:** a search-box animation: a blur of real and fake prompts, a few legible ones, then today's lands. Plays once, only for today. Old days open plainly. Today's title stays hidden in the sidebar until revealed.
- **Sidebar:** Today, Inbox, Late to the Party, My list, then past days (current month listed, earlier months as dropdowns). A menu button on phones.
- **Inbox:** unanswered days since you joined. Answer any, dismiss any, or "Skip the rest". New people start empty.
- **Late to the Party:** new answers on days you already answered.
- **Answer:** the thing itself, a 200-character caption, optional link. One answer per person per day.
- **Links:** smart button (Spotify, YouTube, Apple Music, Maps, IMDb, Letterboxd, Goodreads, Netflix) and a "Play here" embedded player for Spotify and YouTube.
- **Reactions:** Woah, never heard of that / OMG I disagree / Yes, same / I want to try this / Already did it, loved it. Counts only. Nothing reorders. Marker graffiti appears once anyone reacts.
- **My list:** save any answer, grouped by category, check off, find-it links, copy as text. Device-only for now.
- **Storage:** Supabase free tier + GitHub Pages. With no keys, demo mode with sample friends.

## Planned (in the order I'd do them)
1. Email login (magic link), an admin page for you, blocking and removal tools.
2. Share card: a story-sized image drawn in the browser (prompt, their answer, site address, "answer today's to see everyone else's"). People add the link sticker themselves. Do this once login exists.
3. Community questions: anyone suggests, you approve; three candidates are voted on during the week; the winner is the weekend prompt, credited to its author. Winner computed on page load, no scheduler needed. Vote counts hidden until voting closes.
4. Scopes: global, national, state, city, friends & family (columns already in the database).
5. "I want to do homework" and book reports; a real Spotify playlist (needs a track-search answer field and Spotify login); events; reputation.

## Open questions
- Site name (working title: Staff Picks).
- Fake and real prompt lists are drafts; edit `prompts.csv`.
- Which day is community day, and who picks the three candidates.
