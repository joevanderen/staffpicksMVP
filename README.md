# Staff Picks

A tiny static site: one question a day for everybody. No build step, no packages.

## Preview it on your computer
Unzip the folder, then double-click `index.html`. It starts in **demo mode**: everything stays in your browser, with sample friends and a week of past days so you can see the sidebar, inbox and feed filled in. The "Demo tools" box at the bottom lets you pretend you joined 6 days ago (to fill the inbox) and jump to tomorrow (to see the daily gate, late answers and the inbox grow).

## How a day works
- A day starts at **6:00 AM Buenos Aires time** (09:00 UTC).
- You must answer **today's** question before you can see anything else. Reveal it, answer it, and the feed, archive and inbox unlock.
- Days you skipped sit in your **Inbox**. Answer what you like, "Skip the rest" clears the rest. New people start with an empty inbox.
- **Late to the Party** shows new answers on old days you already answered.
- Each day's question is chosen once (equal chance for every prompt, no repeats until the list runs out, never the same category two days in a row) and then frozen, so editing the list never changes past days.

## The prompt list (master document)
`prompts.csv` holds every prompt: real ones, plus 40 fake ones that only appear in the reveal animation. Edit it in Google Sheets or Excel, then send it back to me and I'll regenerate `prompts.js` (the file the site actually reads). Columns:
- `weight`: 1 (common) to 10 (rare). `11` = fake, never chosen. Everything is 1 for now.
- `repeatable`: yes = may be asked again once the unused prompts run out.
- `status`: `ready` prompts can be chosen. Anything else (like "needs completion") is skipped.

## Put a real shared feed online (about 15 minutes)

### 1. The database (Supabase, free)
1. Make a project at supabase.com.
2. **SQL Editor > New query**, paste all of `supabase-setup.sql`, press **Run**. This version **erases** the old weekly-version test tables and creates the new ones.
3. Copy the **Project URL** and an API key (the legacy **anon** key starting with `eyJ`, or the newer **publishable** key starting with `sb_publishable_`).
4. Paste both into `config.js` (`SUPABASE_URL` and `SUPABASE_ANON_KEY`). The key is meant to be public.
5. Open `index.html` once, answer, and check that a row shows up in the `posts` table. The bottom bar should say "shared feed" instead of "DEMO MODE".

### 2. Host it on GitHub Pages
1. Create a public repo and upload every file in this folder.
2. **Settings > Pages**: Source = "Deploy from a branch", Branch = `main`, folder = `/ (root)`.
3. In a minute your site is at `https://YOUR-USERNAME.github.io/REPO-NAME/`.

### Removing a post or changing a day's question
Supabase dashboard > **Table Editor**, edit or delete the row in `posts` or `daily_prompts`.

## Links in answers
Pasting a link adds a smart button ("Listen on Spotify", "Watch on YouTube", "Open in Google Maps", and so on). Spotify and YouTube links also get a "Play here" button that loads a small embedded player.

## Honest limits of this beta
- Anyone with the site address can type any name. Fine for trusted friends. Add email login, an admin page and blocking before sharing widely.
- Someone who clears their browser data or switches devices counts as a new person (and gets an empty inbox).
- "My list" is saved on each device only.
- Fonts come from Google Fonts; offline, similar system fonts are used.

## Updating a live site (update 1)
1. In Supabase, run `supabase-update-1.sql` (it only adds things; nothing is deleted).
2. Then upload the new site files to GitHub, replacing the old ones (keep your config.js keys).

## Accounts (update 2)
Do these in order.

1. **Supabase, SQL Editor:** run `supabase-update-2.sql` (after update 1). The last result shows `your_admin_invite_code`. Copy it.
2. **Supabase, Authentication, URL Configuration:** set **Site URL** to your site address (for now your GitHub address, for example `https://joevanderen.github.io/YOUR-REPO/`). Under **Redirect URLs** add `https://joevanderen.github.io/**` and, once it works, `https://thealgorhythm.org/**`. The login email's link sends people back to these addresses, so this step matters.
3. (Later, optional) **Codes instead of links:** once you connect your own email sender in Supabase (Authentication, Emails, SMTP), you can edit the templates to include `{{ .Token }}`, then set `LOGIN_METHOD: "code"` in `config.js`. Until then, `"link"` (the default) works with Supabase's built-in email.
4. **GitHub:** upload ALL the files from this folder over the old ones. There is a new file, `auth.js`, so don't skip it.
5. **Open your site with your admin invite:** `https://YOUR-SITE/#invite=YOUR_CODE`. Enter your email, then the code from the email, then pick your name (like "Joe V.") and a username.
6. **Link old answers:** open `supabase-link-friends.sql`, run the first two queries, then run `select link_old_data('yourusername', 'TheNameYouTypedBefore');` for each person right after they join, before they answer anything new.
7. **Invite friends:** in the site, "Invite a friend" makes links (as admin you can make links that several people can use).
8. **When everyone has joined and been linked:** run `supabase-lock.sql` and set `REQUIRE_LOGIN: true` in `config.js`.
