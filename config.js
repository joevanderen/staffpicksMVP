// Everything you'd likely want to tweak lives here.
// The prompts themselves live in prompts.csv (master list) -> prompts.js (generated).
window.APP_CONFIG = {
  SITE_NAME: "Staff Picks",
  TAGLINE: "one question a day, answered by people you actually know",

  // Leave both empty to run in DEMO MODE (everything stays on your own device).
  // Fill them in from your Supabase project to share a real feed with friends.
  SUPABASE_URL: "https://dzittshmfsrbopblfftc.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_FaXvjl6-mz43tQkMv4cFKA_G6SHK2u3",

  CAPTION_MAX: 300,

  // A new day starts at 6:00 AM Buenos Aires time. Argentina is UTC-3 all year,
  // so that is 09:00 UTC. (Change this number if you want a different start hour.)
  DAY_START_UTC_HOUR: 9,

  // How the "My list" view groups saved things (by the prompt's category).
  LIST_GROUPS: [
    { title: "To watch",  cats: ["Cinema", "Television"] },
    { title: "To listen", cats: ["Music"] },
    { title: "To read",   cats: ["Literature"] },
    { title: "To eat",    cats: ["Food"] },
    { title: "To visit",  cats: ["Travel"] },
    { title: "Other",     cats: ["General"] }
  ],

  // The "search for it" link on each saved item. {q} becomes the thing's name.
  FIND: {
    "Travel":     { label: "Open in Google Maps", url: "https://www.google.com/maps/search/?api=1&query={q}" },
    "Music":      { label: "Find on Spotify",     url: "https://open.spotify.com/search/{q}" },
    "Cinema":     { label: "Where to watch",      url: "https://www.google.com/search?q={q}%20where%20to%20watch" },
    "Television": { label: "Where to watch",      url: "https://www.google.com/search?q={q}%20where%20to%20watch" },
    "Literature": { label: "Find on Goodreads",   url: "https://www.goodreads.com/search?q={q}" }
  },
  DEFAULT_FIND: { label: "Search it", url: "https://www.google.com/search?q={q}" },

  // The reaction buttons. "graffiti" is the marker scrawl that appears once someone reacts.
  REACTIONS: [
    { kind: "never_heard", label: "Woah, I've never heard of that!", graffiti: "WOAH!" },
    { kind: "same",        label: "Preach",                          graffiti: "PREACH" },
    { kind: "disagree",    label: "No! God! No! God! Please! NO!",   graffiti: "NO! GOD! NO!" }
  ],
  // Older reaction kinds (want_to_try, loved_it) are still stored but no longer shown.
};
