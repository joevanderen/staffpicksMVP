(() => {
  "use strict";

  const cfg = window.APP_CONFIG;
  const DATA = window.PROMPTS || { real: [], fake: [] };
  const $ = (sel) => document.querySelector(sel);

  // ============================================================
  // tiny helpers
  // ============================================================
  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === false || v == null) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const kid of kids) if (kid != null && kid !== false) n.append(kid);
    return n;
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "d-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ============================================================
  // this device's state
  // ============================================================
  const KEY = "staffpicks.v2";
  function freshState() {
    return { name: "", deviceId: "", joinedDay: "", lateSeen: 0, revealed: {}, dismissed: {}, saved: {}, savesSynced: false, accountId: "", pendingInvite: "", commentsSeen: 0, demoOffset: 0 };
  }
  function loadState() {
    try { return Object.assign(freshState(), JSON.parse(localStorage.getItem(KEY) || "{}")); }
    catch { return freshState(); }
  }
  function saveState() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ } }

  const state = loadState();
  if (!state.deviceId) { state.deviceId = uuid(); saveState(); }

  const REMOTE = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  if (REMOTE) state.demoOffset = 0;

  // Who is acting. With an account: the profile. Without one: this device and the typed name.
  let me = null;               // { id, username, display_name, role, blocked } once logged in and joined
  let profileChecked = false;  // true once we know whether the logged-in user has a profile
  const actorId = () => (me ? "u:" + me.id : state.deviceId);
  const myName = () => (me ? me.display_name : state.name);
  const isAdmin = () => !!(me && me.role === "admin");

  // ============================================================
  // days (a day starts at 6 AM Buenos Aires = 09:00 UTC)
  // ============================================================
  const nowMs = () => Date.now() + (REMOTE ? 0 : state.demoOffset) * 86400000;
  const dayKeyOf = (ms) => new Date(ms - cfg.DAY_START_UTC_HOUR * 3600e3).toISOString().slice(0, 10);
  const todayKey = () => dayKeyOf(nowMs());
  function addDays(key, n) {
    const d = new Date(key + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  const dayStartMs = (key) => Date.parse(key + "T00:00:00Z") + cfg.DAY_START_UTC_HOUR * 3600e3;
  function fmtDay(key, opts) {
    try { return new Date(key + "T00:00:00Z").toLocaleDateString(undefined, { ...opts, timeZone: "UTC" }); }
    catch { return key; }
  }

  // ============================================================
  // data stores: Supabase if configured, otherwise demo mode
  // ============================================================
  const remote = () => {
    const base = cfg.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1";
    const headers = { apikey: cfg.SUPABASE_ANON_KEY, "Content-Type": "application/json" };
    // Legacy anon keys are JWTs (start with "eyJ") and go in Authorization too.
    // Newer publishable keys (sb_publishable_...) are not JWTs, so they go in apikey only.
    if (cfg.SUPABASE_ANON_KEY.startsWith("eyJ")) headers.Authorization = "Bearer " + cfg.SUPABASE_ANON_KEY;
    async function req(path, opts = {}) {
      const h = { ...headers };
      const tok = await Auth.token();           // logged in: act as that person
      if (tok) h.Authorization = "Bearer " + tok;
      const r = await fetch(base + path, { ...opts, headers: { ...h, ...(opts.headers || {}) } });
      if (!r.ok) throw new Error((await r.text()) || r.statusText);
      if (r.status === 204) return null;
      try { return await r.json(); } catch { return null; }
    }
    return {
      req,
      rpc: (fn, args) => req("/rpc/" + fn, { method: "POST", body: JSON.stringify(args || {}) }),
      listProfiles: () => req("/profiles?select=id,username,display_name,role,blocked,invited_by,invite_code,created_at&limit=2000"),
      getProfile: (id) => req("/profiles?select=*&id=eq." + encodeURIComponent(id)).then((r) => (r && r[0]) || null),
      listInvites: (id) => req("/invites?select=*&created_by=eq." + encodeURIComponent(id) + "&order=created_at.desc"),
      setHidden: (postId, hidden) => req("/posts?id=eq." + encodeURIComponent(postId), { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ hidden }) }),
      setBlocked: (id, blocked) => req("/profiles?id=eq." + encodeURIComponent(id), { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ blocked }) }),
      listComments: () => req("/comments?select=*&order=created_at.asc&limit=5000"),
      addComment: (row) => req("/comments", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) }).then((r) => r && r[0]),
      deleteComment: (id) => req("/comments?id=eq." + encodeURIComponent(id), { method: "DELETE" }),
      setCommentHidden: (id, hidden) => req("/comments?id=eq." + encodeURIComponent(id), { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ hidden }) }),
      listPrompts: () => req("/daily_prompts?select=*&order=day.desc&limit=2000"),
      async addPrompt(row) {
        try {
          await req("/daily_prompts?on_conflict=day", {
            method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(row)
          });
        } catch { /* someone else may have won the race, or our clock is off; fall through to read */ }
        const rows = await req("/daily_prompts?select=*&day=eq." + encodeURIComponent(row.day));
        return rows && rows[0];
      },
      listPosts: () => req("/posts?select=*&order=created_at.desc&limit=2000"),
      async addPost(p) {
        const rows = await req("/posts", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(p) });
        return rows && rows[0];
      },
      listReactions: () => req("/reactions?select=post_id,device_id,kind,name&limit=10000"),
      addReaction: (postId, kind) =>
        req("/reactions", { method: "POST", body: JSON.stringify({ post_id: postId, device_id: actorId(), kind, name: myName(), user_id: me ? me.id : undefined }) }),
      listSaves: () => req("/saves?select=post_id,device_id,name&limit=10000"),
      addSave: (postId) =>
        req("/saves?on_conflict=post_id,device_id", {
          method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
          body: JSON.stringify({ post_id: postId, device_id: actorId(), name: myName(), user_id: me ? me.id : undefined })
        }),
      removeSave: (postId) =>
        req(`/saves?post_id=eq.${encodeURIComponent(postId)}&device_id=eq.${encodeURIComponent(actorId())}`, { method: "DELETE" }),
      removeReaction: (postId, kind) =>
        req(`/reactions?post_id=eq.${encodeURIComponent(postId)}&device_id=eq.${encodeURIComponent(actorId())}&kind=eq.${encodeURIComponent(kind)}`, { method: "DELETE" })
    };
  };

  const SAMPLE_AUTHORS = ["Sample Sam", "Demo Dana", "Preview Pat", "Test Tess", "Mock Max"];
  const SAMPLES = {
    Travel: [
      { t: "Lisbon", c: "Hills, tiles, custard tarts. I'd go back tomorrow." },
      { t: "Oaxaca", c: "Mole, mezcal, and a market on every corner." },
      { t: "Chiang Mai", c: "Slow mornings and a bowl of khao soi." }],
    Food: [
      { t: "Cacio e pepe, but lazy", c: "Three ingredients and a lot of stirring." },
      { t: "The taco cart on my corner", c: "Cash only. Worth it every single time.", l: "https://www.google.com/maps/search/?api=1&query=taco+cart" },
      { t: "Buttered toast with flaky salt", c: "Don't overthink it." }],
    General: [
      { t: "Reading on the couch", c: "No phone, one lamp, nothing planned." },
      { t: "Long walks with no destination", c: "Best thinking I do all week." },
      { t: "Texting my sister memes", c: "Probably way more than the average person." }],
    Literature: [
      { t: "The Hobbit", c: "Still the book I'd hand to anyone." },
      { t: "Piranesi", c: "Strange and quiet and perfect." },
      { t: "Where the Wild Things Are", c: "I can still see the pictures." }],
    Cinema: [
      { t: "Past Lives", c: "Quiet, devastating, and somehow warm." },
      { t: "Spirited Away", c: "Every rewatch finds something new." },
      { t: "Paddington 2", c: "Pure kindness for an hour and a half." }],
    Television: [
      { t: "Fleabag", c: "Two seasons, no wasted minute." },
      { t: "Bluey", c: "Yes, I watch it without kids." },
      { t: "The Bear", c: "Stress, but make it delicious." }],
    Music: [
      { t: "Maps — Yeah Yeah Yeahs", c: "Still the one." },
      { t: "Never Gonna Give You Up", c: "You know exactly why.", l: "https://youtu.be/dQw4w9WgXcQ" },
      { t: "Dreams — Fleetwood Mac", c: "Instant mood fix." }]
  };

  const demo = (() => {
    const PK = "staffpicks.demo2.prompts", OK = "staffpicks.demo2.posts", RK = "staffpicks.demo2.reactions", SK = "staffpicks.demo2.saves";
    const rd = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } };
    const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

    function samplePost(day, category, author, r, createdMs, taken = new Set()) {
      const bank = SAMPLES[category] || SAMPLES.General;
      const start = Math.floor(r() * bank.length);
      let s = bank[start];
      for (let k = 0; k < bank.length; k++) { // prefer an answer nobody has used that day
        const cand = bank[(start + k) % bank.length];
        if (!taken.has(cand.t)) { s = cand; break; }
      }
      taken.add(s.t);
      return {
        id: uuid(), day, author_name: author, device_id: "sample:" + author, title: s.t, caption: s.c,
        link: s.l || null, scope: "global", created_at: new Date(createdMs).toISOString()
      };
    }
    function seedDay(row) {
      const r = rng(hash("seed" + row.day));
      const n = 2 + Math.floor(r() * 2);
      const authors = SAMPLE_AUTHORS.slice().sort(() => r() - 0.5).slice(0, n);
      const posts = rd(OK, []);
      const used = new Set();
      for (const a of authors) {
        let t = dayStartMs(row.day) + (1 + r() * 14) * 3600e3;
        if (t > nowMs()) t = nowMs() - (5 + r() * 60) * 60e3;
        posts.push(samplePost(row.day, row.category, a, r, t, used));
      }
      wr(OK, posts);
    }
    return {
      async listPrompts() { return rd(PK, []); },
      async addPrompt(row) {
        const all = rd(PK, []);
        const ex = all.find((x) => x.day === row.day);
        if (ex) return ex;
        all.push(row); wr(PK, all); seedDay(row);
        return row;
      },
      async listPosts() { return rd(OK, []); },
      async addPost(p) {
        const all = rd(OK, []);
        if (all.some((x) => x.day === p.day && x.device_id === p.device_id)) throw new Error("duplicate key");
        const row = { ...p, id: uuid(), created_at: new Date(nowMs()).toISOString() };
        all.unshift(row); wr(OK, all);
        return row;
      },
      async listReactions() { return rd(RK, []); },
      async addReaction(postId, kind) {
        const all = rd(RK, []);
        if (!all.some((r) => r.post_id === postId && r.device_id === actorId() && r.kind === kind))
          all.push({ post_id: postId, device_id: actorId(), kind, name: myName() });
        wr(RK, all);
      },
      async removeReaction(postId, kind) {
        wr(RK, rd(RK, []).filter((r) => !(r.post_id === postId && r.device_id === actorId() && r.kind === kind)));
      },
      async listProfiles() { return []; },
      async listComments() { return []; },
      async listSaves() { return rd(SK, []); },
      async addSave(postId) {
        const all = rd(SK, []);
        if (!all.some((x) => x.post_id === postId && x.device_id === actorId()))
          all.push({ post_id: postId, device_id: actorId(), name: myName() });
        wr(SK, all);
      },
      async removeSave(postId) {
        wr(SK, rd(SK, []).filter((x) => !(x.post_id === postId && x.device_id === actorId())));
      },
      // demo-only: a few friends reply late to days the viewer already answered
      addLateSamples(days) {
        const posts = rd(OK, []);
        const r = rng(hash("late" + nowMs()));
        for (const day of days) {
          const row = promptsByDay[day]; if (!row) continue;
          const dayPosts = posts.filter((p) => p.day === day);
          const taken = new Set(dayPosts.map((p) => p.author_name));
          const free = SAMPLE_AUTHORS.filter((a) => !taken.has(a));
          if (!free.length) continue;
          posts.push(samplePost(day, row.category, free[Math.floor(r() * free.length)], r, nowMs() - 60e3, new Set(dayPosts.map((p) => p.title))));
        }
        wr(OK, posts);
      }
    };
  })();

  const store = REMOTE ? remote() : demo;

  // ============================================================
  // loaded data
  // ============================================================
  let promptsByDay = {};
  let posts = [];
  let postsByDay = {};
  let mine = {};
  let reactions = {}; // postId -> { kind: { n, mine, names: [] } }
  let saves = {};     // postId -> { names: [], mine }
  let profilesById = {}, profilesByName = {};
  let commentsByPost = {};  // postId -> [comment, ...] oldest first
  const commentsOpen = new Set();

  function reindex() {
    postsByDay = {}; mine = {};
    for (const p of posts) {
      (postsByDay[p.day] = postsByDay[p.day] || []).push(p);
      if (p.device_id === actorId()) mine[p.day] = p;
    }
    for (const d of Object.keys(postsByDay)) postsByDay[d].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }
  function buildReactionMap(list) {
    const map = {};
    for (const r of list) {
      const slot = (map[r.post_id] = map[r.post_id] || {});
      const k = (slot[r.kind] = slot[r.kind] || { n: 0, mine: false, names: [] });
      k.n += 1;
      k.names.push(r.name || "a friend");
      if (r.device_id === actorId()) k.mine = true;
    }
    return map;
  }
  function buildSaveMap(list) {
    const map = {};
    for (const r of list) {
      const s = (map[r.post_id] = map[r.post_id] || { names: [], mine: false });
      s.names.push(r.name || "a friend");
      if (r.device_id === actorId()) s.mine = true;
    }
    return map;
  }

  async function loadAll() {
    const [pr, po, re, sv, pf, cm] = await Promise.all([
      store.listPrompts(), store.listPosts(), store.listReactions(),
      store.listSaves().catch(() => []),
      store.listProfiles().catch(() => []),
      store.listComments().catch(() => [])
    ]);
    commentsByPost = {};
    for (const c of cm || []) (commentsByPost[c.post_id] = commentsByPost[c.post_id] || []).push(c);
    profilesById = {}; profilesByName = {};
    for (const x of pf || []) { profilesById[x.id] = x; profilesByName[x.username] = x; }
    promptsByDay = {};
    for (const r of pr || []) promptsByDay[r.day] = r;
    posts = po || [];
    reactions = buildReactionMap(re || []);
    saves = buildSaveMap(sv || []);
    reindex();
    syncSaves();
  }
  // Keeps "My list" and the online saves in step:
  // lists saved on this device before saves lived online are shared once,
  // and saves made elsewhere under this account show up here.
  function syncSaves() {
    if (!state.savesSynced) {
      state.savesSynced = true;
      for (const id of Object.keys(state.saved)) {
        if (!posts.some((p) => p.id === id)) continue;
        if (saves[id] && saves[id].mine) continue;
        store.addSave(id).catch(() => { state.savesSynced = false; saveState(); });
        const sv = (saves[id] = saves[id] || { names: [], mine: false });
        sv.names.push(myName() || "a friend"); sv.mine = true;
      }
    }
    for (const [id, sv] of Object.entries(saves)) {
      if (!sv.mine || state.saved[id]) continue;
      const p = posts.find((x) => x.id === id);
      if (!p) continue;
      const row = promptsByDay[p.day] || {};
      state.saved[id] = { id, title: p.title, category: row.category || "General", from: p.author_name, link: p.link || null, savedAt: Date.parse(p.created_at) || nowMs(), done: false };
    }
    saveState();
  }

  // ============================================================
  // choosing the day's prompt (equal chance per prompt; frozen once chosen)
  // ============================================================
  function pickPrompt(day, used) {
    const eligible = DATA.real.filter((p) => p.weight <= 10);
    let pool = eligible.filter((p) => !used.has(p.id));
    if (!pool.length) pool = eligible.filter((p) => p.repeatable);
    if (!pool.length) pool = eligible;
    const prev = promptsByDay[addDays(day, -1)];
    if (prev) {
      const varied = pool.filter((p) => p.category !== prev.category);
      if (varied.length) pool = varied;
    }
    const r = rng(hash("pick:" + day));
    const weights = pool.map((p) => 11 - p.weight);
    let t = r() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) { t -= weights[i]; if (t < 0) return pool[i]; }
    return pool[pool.length - 1];
  }

  async function ensureDay(day) {
    if (promptsByDay[day]) return promptsByDay[day];
    if (!DATA.real.length) throw new Error("No prompts are marked ready in prompts.csv.");
    const used = new Set(Object.values(promptsByDay).map((r) => r.prompt_key));
    const p = pickPrompt(day, used);
    const row = { day, prompt_key: p.id, prompt: p.prompt, short_title: p.title, category: p.category };
    let saved = null;
    try { saved = await store.addPrompt(row); } catch { /* fall back to our own pick */ }
    promptsByDay[day] = saved || row;
    if (!REMOTE) { posts = await store.listPosts(); reindex(); }
    return promptsByDay[day];
  }

  // ============================================================
  // links: smart buttons and embedded players
  // ============================================================
  function linkInfo(url) {
    let u;
    try { u = new URL(url); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.replace(/^www\./, "");
    const info = { href: u.href, label: "Open link ↗", host, embed: null };

    if (host === "open.spotify.com") {
      info.label = "Listen on Spotify";
      const m = u.pathname.match(/(?:intl-[a-z-]+\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]+)/);
      if (m) info.embed = { src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, height: (m[1] === "track" || m[1] === "episode") ? 152 : 352 };
    } else if (host === "youtu.be" || host.endsWith("youtube.com")) {
      info.label = "Watch on YouTube";
      let id = "";
      if (host === "youtu.be") id = u.pathname.slice(1, 12);
      else if (u.pathname === "/watch") id = u.searchParams.get("v") || "";
      else { const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/); if (m) id = m[1]; }
      if (/^[\w-]{11}$/.test(id)) info.embed = { src: `https://www.youtube-nocookie.com/embed/${id}`, ratio: "16 / 9" };
    } else if (host === "music.apple.com") info.label = "Listen on Apple Music";
    else if (host === "maps.app.goo.gl" || (/(^|\.)google\.[a-z.]+$/.test(host) && u.pathname.startsWith("/maps"))) info.label = "Open in Google Maps";
    else if (host.endsWith("imdb.com")) info.label = "Open on IMDb";
    else if (host.endsWith("letterboxd.com") || host === "boxd.it") info.label = "Open on Letterboxd";
    else if (host.endsWith("goodreads.com")) info.label = "Open on Goodreads";
    else if (host.endsWith("netflix.com")) info.label = "Watch on Netflix";
    return info;
  }

  function linkBlock(url) {
    const info = url ? linkInfo(url) : null;
    if (!info) return null;
    const wrap = el("div");
    const row = el("div", { class: "linkrow" });
    row.append(el("a", { class: "btn small", href: info.href, target: "_blank", rel: "noopener noreferrer nofollow", text: info.label }));
    if (info.label === "Open link ↗") row.append(el("span", { class: "host", text: info.host }));
    const playerSlot = el("div", { class: "player" });
    playerSlot.hidden = true;
    if (info.embed) {
      const playBtn = el("button", { class: "btn small", type: "button", text: "▶ Play here" });
      playBtn.addEventListener("click", () => {
        if (!playerSlot.hidden) { playerSlot.hidden = true; playerSlot.textContent = ""; playBtn.textContent = "▶ Play here"; return; }
        const f = el("iframe", {
          src: info.embed.src, title: "Player", loading: "lazy",
          allow: "encrypted-media; fullscreen; picture-in-picture", referrerpolicy: "strict-origin-when-cross-origin",
          sandbox: "allow-scripts allow-same-origin allow-popups allow-presentation"
        });
        if (info.embed.height) f.style.height = info.embed.height + "px";
        if (info.embed.ratio) f.style.aspectRatio = info.embed.ratio;
        playerSlot.textContent = ""; playerSlot.append(f); playerSlot.hidden = false; playBtn.textContent = "✕ Close player";
      });
      row.append(playBtn);
    }
    wrap.append(row, playerSlot);
    return wrap;
  }

  // ============================================================
  // saving things to "My list" (this device only, for now)
  // ============================================================
  function toggleSave(post) {
    const slot = (saves[post.id] = saves[post.id] || { names: [], mine: false });
    const meName = myName() || "a friend";
    if (state.saved[post.id]) {
      delete state.saved[post.id];
      slot.mine = false;
      const i = slot.names.indexOf(meName); if (i >= 0) slot.names.splice(i, 1);
      store.removeSave(post.id).catch(() => {});
    } else {
      slot.mine = true; slot.names.push(meName);
      store.addSave(post.id).catch(() => {});
      const row = promptsByDay[post.day] || {};
      state.saved[post.id] = {
        id: post.id, title: post.title, category: row.category || "General", from: post.author_name,
        link: post.link || null, savedAt: nowMs(), done: false
      };
    }
    saveState();
    renderSidebar();
  }
  function findLinks(item) {
    const out = [];
    const direct = item.link ? linkInfo(item.link) : null;
    if (direct) out.push({ label: direct.label === "Open link ↗" ? "Their link" : direct.label, href: direct.href });
    const f = cfg.FIND[item.category] || cfg.DEFAULT_FIND;
    out.push({ label: f.label, href: f.url.replace("{q}", encodeURIComponent(item.title)) });
    return out;
  }
  function listAsText() {
    const items = Object.values(state.saved);
    const lines = [];
    for (const g of cfg.LIST_GROUPS) {
      const m = items.filter((i) => g.cats.includes(i.category)).sort((a, b) => b.savedAt - a.savedAt);
      if (!m.length) continue;
      lines.push(g.title.toUpperCase());
      for (const i of m) lines.push((i.done ? "[x] " : "[ ] ") + i.title + " (from " + i.from + ")");
      lines.push("");
    }
    return lines.join("\n").trim();
  }

  // ============================================================
  // cards
  // ============================================================
  function graffitiFor(post) {
    const wrap = el("div", { class: "graffiti", "aria-hidden": "true" });
    const slot = reactions[post.id] || {};
    const colors = ["#c8372d", "#1b4fa0", "#1f7a3d", "#6a2c91", "#d9731a"];
    for (const r of cfg.REACTIONS) {
      const info = slot[r.kind];
      if (!info || info.n < 1) continue;
      const rand = rng(hash(post.id + r.kind));
      const s = el("span", { text: r.graffiti });
      s.style.left = (4 + rand() * 52) + "%";
      s.style.top = (4 + rand() * 38) + "%";
      s.style.fontSize = Math.min(60, 26 + info.n * 6 + rand() * 8) + "px";
      s.style.transform = `rotate(${(rand() - 0.5) * 48}deg)`;
      s.style.color = colors[Math.floor(rand() * colors.length)];
      wrap.append(s);
    }
    return wrap;
  }

  async function toggleReaction(post, kind, repaint) {
    const slot = (reactions[post.id] = reactions[post.id] || {});
    const cur = (slot[kind] = slot[kind] || { n: 0, mine: false, names: [] });
    cur.names = cur.names || [];
    const meName = myName() || "a friend";
    const adding = !cur.mine;
    const flip = (add) => {
      cur.mine = add;
      cur.n = Math.max(0, cur.n + (add ? 1 : -1));
      if (add) cur.names.push(meName);
      else { const i = cur.names.indexOf(meName); if (i >= 0) cur.names.splice(i, 1); }
    };
    flip(adding);
    repaint();
    try { await (adding ? store.addReaction(post.id, kind) : store.removeReaction(post.id, kind)); }
    catch { flip(!adding); repaint(); }
  }

  function makeCard(post, opts = {}) {
    const rand = rng(hash(post.id));
    const when = new Date(post.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const c = el("article", { class: "card" });
    c.style.setProperty("--tilt", ((rand() - 0.5) * 2.4).toFixed(2) + "deg");
    const ts = CardStyle.apply(c, post.card_style);   // -1 = the normal look
    c.append(el("div", { class: "tape" }));
    if (opts.heading) c.append(el("p", { class: "prompt" }, opts.heading));
    c.append(el("h3", { class: "title" + (ts >= 0 ? " ts-" + ts : ""), text: post.title }));
    if (post.hidden) c.append(el("span", { class: "stamp hid", text: "hidden from others" }));
    if (post.confidence === "sure" || post.confidence === "vibes")
      c.append(el("span", { class: "stamp " + post.confidence, text: post.confidence === "sure" ? "strong opinion" : "just vibes" }));
    if (post.caption) c.append(el("p", { class: "caption", text: post.caption }));
    const lb = linkBlock(post.link);
    if (lb) c.append(lb);
    const prof = post.user_id && profilesById[post.user_id];
    const meta = el("p", { class: "meta" }, "— ");
    meta.append(prof ? el("a", { href: "#u=" + prof.username, text: post.author_name }) : post.author_name, ", " + when);
    c.append(meta);
    if (opts.preview) return c;

    const bar = el("div", { class: "reactions" });
    const who = el("div", { class: "whoreacted" });
    let graf = el("div");
    c.append(bar, who, graf);
    if (me) c.append(commentsBlock(post, !!opts.openComments));

    function paint() {
      bar.textContent = "";
      const saved = !!state.saved[post.id];
      bar.append(el("button", {
        class: "rbtn save", type: "button", "aria-pressed": String(saved),
        text: saved ? "✓ On my list" : "+ Save to my list",
        onclick: () => { toggleSave(post); paint(); }
      }));
      const slot = reactions[post.id] || {};
      for (const r of cfg.REACTIONS) {
        const info = slot[r.kind] || { n: 0, mine: false };
        const b = el("button", { class: "rbtn", type: "button", "aria-pressed": String(info.mine),
          title: info.n > 0 ? (info.names || []).join(", ") : null, onclick: () => toggleReaction(post, r.kind, paint) });
        b.append(r.label);
        if (info.n > 0) b.append(el("span", { class: "n", text: String(info.n) }));
        bar.append(b);
      }
      who.textContent = "";
      for (const r of cfg.REACTIONS) {
        const info = slot[r.kind];
        if (info && info.n > 0) who.append(el("p", {}, el("b", { text: r.graffiti + ": " }), (info.names || []).join(", ")));
      }
      const sv = saves[post.id];
      if (sv && sv.names.length) who.append(el("p", {}, el("b", { text: "On their list: " }), sv.names.join(", ")));
      if (isAdmin()) {
        bar.append(el("button", { class: "rbtn", type: "button", text: post.hidden ? "Unhide (admin)" : "Hide (admin)",
          onclick: async () => {
            try { await store.setHidden(post.id, !post.hidden); post.hidden = !post.hidden; render(); }
            catch (ex) { alert("Couldn't change that: " + String(ex && ex.message || ex).slice(0, 120)); }
          } }));
      }
      const g = graffitiFor(post);
      graf.replaceWith(g);
      graf = g;
    }
    paint();
    return c;
  }

  // ============================================================
  // the answer form
  // ============================================================
  function buildAnswerForm(day) {
    const title = el("input", { maxlength: "120", required: "required", placeholder: "A name, a place, a song... whatever fits" });
    const caption = el("textarea", { rows: "3", maxlength: String(cfg.CAPTION_MAX), placeholder: "A line or two. Be honest." });
    const link = el("input", { type: "text", inputmode: "url", autocapitalize: "off", maxlength: "500", placeholder: "Spotify, YouTube, Maps, anything..." });
    const counter = el("em");
    let confidence = null;
    const confBtns = [["sure", "Strong opinion"], ["vibes", "Just vibes"]].map(([val, label]) =>
      el("button", { class: "rbtn", type: "button", "aria-pressed": "false", text: label, onclick: () => {
        confidence = confidence === val ? null : val;
        confBtns.forEach((b, i) => b.setAttribute("aria-pressed", String(confidence === ["sure", "vibes"][i])));
      } }));
    const err = el("p", { class: "err", role: "alert" });
    const btn = el("button", { class: "btn big", type: "submit", text: "Post it" });
    const form = el("form", { class: "answer-form" },
      el("label", { class: "field" }, el("span", { text: "Your answer" }), title),
      el("label", { class: "field" }, el("span", {}, "Why? ", counter), caption),
      el("label", { class: "field" }, el("span", { text: "Link (optional)" }), link,
        el("p", { class: "hint", text: "Spotify and YouTube links get a play button in the feed." })),
      el("div", { class: "field" }, el("span", { text: "How sure are you? (optional)" }),
        el("div", { class: "reactions" }, ...confBtns),
        el("p", { class: "hint", text: "Tap again to clear. Skip it if you'd rather not say." })),
      el("div", { class: "row" }, btn), err);
    const updateCounter = () => { counter.textContent = (cfg.CAPTION_MAX - caption.value.length) + " characters left"; };
    caption.addEventListener("input", updateCounter);
    updateCounter();

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      err.textContent = "";
      const t = title.value.trim();
      const cap = caption.value.trim().slice(0, cfg.CAPTION_MAX);
      let lk = link.value.trim();
      if (!t) { err.textContent = "Give your answer a name."; return; }
      if (lk) {
        if (!/^https?:\/\//i.test(lk)) lk = "https://" + lk;
        if (!linkInfo(lk)) { err.textContent = "That link doesn't look right."; return; }
      }
      btn.disabled = true;
      try {
        const row = await store.addPost({
          day, author_name: myName(), device_id: actorId(), user_id: me ? me.id : undefined,
          card_style: me && CardStyle.valid(me.card_style) ? me.card_style : undefined,
          title: t, caption: cap, link: lk || null, scope: "global", confidence
        });
        if (row) posts = [row, ...posts];
        reindex();
        delete state.dismissed[day];
        saveState();
        go("day=" + day);
      } catch (ex) {
        const msg = String(ex && ex.message || "");
        if (/duplicate|23505/i.test(msg)) { err.textContent = "You've already answered this day. Reloading..."; await refresh(); }
        else err.textContent = "Couldn't post. " + msg.slice(0, 160);
        btn.disabled = false;
      }
    });
    form._focus = () => title.focus();
    return form;
  }

  // ============================================================
  // views
  // ============================================================
  const main = () => $("#main");
  let animToken = 0;

  function panel(titleText, ...kids) {
    return el("section", { class: "win" },
      el("div", { class: "titlebar" }, el("span", { text: titleText })),
      el("div", { class: "win-body" }, ...kids));
  }

  // ----- gate: you must answer today's question first -----
  function renderGate() {
    const today = todayKey();
    const row = promptsByDay[today];
    const m = main(); m.textContent = "";
    if (!row) { m.append(panel("Today", el("p", { class: "empty", text: "Couldn't find today's question. Try reloading." }))); return; }

    const token = ++animToken;
    const text = el("span", { class: "ask-text" });
    const box = el("div", { class: "ask-box" }, text);
    const reveal = el("button", { class: "btn big", type: "button", text: "Reveal" });
    const skipLine = el("p", { class: "skipline" });
    const formWrap = el("div");

    function showForm() {
      formWrap.textContent = "";
      const f = buildAnswerForm(today);
      formWrap.append(
        el("p", { class: "note", text: "Everyone answers the same question. Answer today's to unlock the feed, the archive and your inbox." }), f);
      return f;
    }

    if (state.revealed[today]) {
      text.textContent = row.prompt;
      reveal.hidden = true;
      showForm();
    } else {
      text.textContent = "What will today's question be?";
      box.classList.add("idle");
      reveal.addEventListener("click", async () => {
        reveal.disabled = true;
        state.revealed[today] = true; saveState();
        box.classList.remove("idle");
        const ctl = { skip: false };
        const skip = el("button", { class: "linklike", type: "button", text: "skip animation", onclick: () => { ctl.skip = true; } });
        skipLine.append(skip);
        await runReveal(text, row, token, ctl);
        if (token !== animToken) return;
        skipLine.textContent = "";
        reveal.hidden = true;
        const f = showForm();
        f._focus();
      });
    }

    const recent = [];
    for (let i = 1; i <= 5; i++) { const r = promptsByDay[addDays(today, -i)]; if (r) recent.push(r); }

    m.append(el("section", { class: "win" },
      el("div", { class: "titlebar" }, el("span", { text: "Question of the Day" })),
      el("div", { class: "win-body" },
        el("div", { class: "portal-head" },
          el("span", { class: "portal-logo", text: cfg.SITE_NAME }),
          el("span", { class: "portal-date", text: fmtDay(today, { weekday: "long", month: "long", day: "numeric" }) })),
        el("div", { class: "ask-row" }, box, reveal),
        skipLine,
        recent.length ? el("p", { class: "recent" }, el("b", { text: "Recent questions: " }),
          ...recent.map((r) => el("span", { class: "ln", text: r.short_title }))) : null,
        formWrap)));
  }

  function runReveal(textEl, row, token, ctl) {
    return new Promise((resolve) => {
      const finish = () => { textEl.style.filter = "none"; textEl.textContent = row.prompt; resolve(); };
      if (reduceMotion) { finish(); return; }
      const reals = DATA.real.filter((p) => p.id !== row.prompt_key).map((p) => p.prompt);
      const fakes = DATA.fake.slice();
      const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
      const N = 34;
      const seq = [];
      for (let i = 0; i < N; i++) seq.push(Math.random() < 0.4 && fakes.length ? pick(fakes) : pick(reals));
      const tail = [];
      for (let i = 0; i < 6; i++) tail.push(i % 2 === 0 ? pick(reals) : (fakes.length ? pick(fakes) : pick(reals)));
      const total = N + tail.length;
      let i = 0;
      (function step() {
        if (token !== animToken || ctl.skip) { finish(); return; }
        if (i >= total) { finish(); return; }
        const legible = i >= N;
        textEl.textContent = legible ? tail[i - N] : seq[i];
        textEl.style.filter = legible ? "none" : "blur(5px)";
        const t = i / N;
        const delay = legible ? 420 + (i - N) * 140 : 40 + 150 * t * t * t + 20 * t;
        i++;
        setTimeout(step, delay);
      })();
    });
  }

  // ----- one day -----
  function renderDay(day) {
    const m = main(); m.textContent = "";
    const row = promptsByDay[day];
    if (!row) { m.append(panel("Not found", el("p", { class: "empty", text: "There's no question for that day." }))); return; }
    const today = todayKey();
    const answered = !!mine[day];

    const head = el("div", { class: "win-body" },
      el("p", { class: "cat-tag", text: row.category }),
      el("p", { class: "sentence big", text: row.prompt }));
    m.append(el("section", { class: "win" },
      el("div", { class: "titlebar" }, el("span", { text: fmtDay(day, { weekday: "long", month: "long", day: "numeric" }) + (day === today ? "  ·  Today" : "") })),
      head));

    if (!answered) {
      const f = buildAnswerForm(day);
      const kids = [
        el("p", { class: "note", text: "Answer to see what everyone said." }), f,
        el("div", { class: "row center" }, el("button", { class: "linklike", type: "button", text: "Not now, skip this day",
          onclick: () => { state.dismissed[day] = true; saveState(); go("inbox"); } }))
      ];
      m.append(panel("Your answer", ...kids));
      return;
    }
    const list = postsByDay[day] || [];
    const body = [
      el("div", { class: "tabs", role: "tablist", "aria-label": "Feed scope" },
        el("button", { class: "tab active", role: "tab", "aria-selected": "true", text: "Global" }),
        ...["Nation", "State", "City", "Friends & family"].map((n) => el("button", { class: "tab", disabled: "disabled", title: "Coming later", text: n })))
    ];
    if (!list.length) body.push(el("p", { class: "empty", text: "No answers yet." }));
    for (const p of list) body.push(makeCard(p));
    m.append(panel("The shelf · " + list.length + (list.length === 1 ? " answer" : " answers"), ...body));
  }

  // ----- inbox -----
  function inboxDays() {
    const today = todayKey();
    return Object.keys(promptsByDay)
      .filter((d) => d < today && d >= (state.joinedDay || today) && !mine[d] && !state.dismissed[d])
      .sort().reverse();
  }

  function renderInbox() {
    const m = main(); m.textContent = "";
    const days = inboxDays();
    const body = [];
    if (!days.length) {
      body.push(el("p", { class: "empty", text: "Inbox zero. Nothing waiting for you." }));
    } else {
      body.push(el("div", { class: "mail-tools" },
        el("span", { class: "hint", text: "Answer what you like, then skip the rest." }),
        el("button", { class: "btn small", type: "button", text: "Skip the rest",
          onclick: () => { for (const d of days) state.dismissed[d] = true; saveState(); renderSidebar(); renderInbox(); } })));
      for (const d of days) {
        const r = promptsByDay[d];
        body.push(el("div", { class: "mail-row" },
          el("span", { class: "d", text: fmtDay(d, { weekday: "short", month: "short", day: "numeric" }) }),
          el("span", { class: "t" }, r.short_title, el("small", { text: r.prompt })),
          el("a", { class: "btn small", href: "#day=" + d, text: "Answer" }),
          el("button", { class: "btn small", type: "button", "aria-label": "Dismiss", text: "✕",
            onclick: () => { state.dismissed[d] = true; saveState(); renderSidebar(); renderInbox(); } })));
      }
    }
    m.append(panel("Inbox" + (days.length ? " (" + days.length + ")" : ""), ...body));
  }

  // ----- late to the party -----
  function lateItems() {
    const today = todayKey();
    const out = [];
    for (const [day, my] of Object.entries(mine)) {
      if (day >= today) continue;
      const mineAt = Date.parse(my.created_at);
      for (const p of postsByDay[day] || []) {
        if (p.device_id !== actorId() && Date.parse(p.created_at) > mineAt) out.push(p);
      }
    }
    return out.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 60);
  }
  const lateNewCount = () => lateItems().filter((p) => Date.parse(p.created_at) > state.lateSeen).length;

  function renderLate() {
    const m = main(); m.textContent = "";
    const items = lateItems();
    const body = [el("p", { class: "hint", text: "New answers to days you've already answered." })];
    if (!items.length) body.push(el("p", { class: "empty", text: "No late arrivals yet." }));
    for (const p of items) {
      const r = promptsByDay[p.day] || {};
      const heading = el("a", { href: "#day=" + p.day, text: fmtDay(p.day, { weekday: "short", month: "short", day: "numeric" }) + " · " + (r.short_title || "") });
      body.push(makeCard(p, { heading }));
    }
    m.append(panel("Late to the Party", ...body));
    state.lateSeen = nowMs(); saveState();
    renderSidebar();
  }

  // ----- the card designer -----
  const BASIC_COLORS = [
    "#ff8080","#ffff80","#80ff80","#00ff80","#80ffff","#0080ff","#ff80c0","#ff80ff",
    "#ff0000","#ffff00","#80ff00","#00ff40","#00ffff","#0080c0","#8080c0","#ff00ff",
    "#804040","#ff8040","#00ff00","#008080","#004080","#8080ff","#800040","#ff0080",
    "#800000","#ff8000","#008000","#008040","#0000ff","#0000a0","#800080","#8000ff",
    "#400000","#804000","#004000","#004040","#000080","#000040","#400040","#400080",
    "#000000","#808000","#808040","#808080","#408080","#c0c0c0","#fdf6dc","#ffffff"
  ];

  // An old-Windows color dialog: 48 basic colors, a rainbow square, a brightness slider, and a hex box.
  function colorDialog(initial, onPick) {
    const root = el("div", { class: "color-dialog" });
    const grid = el("div", { class: "grid48", role: "group", "aria-label": "Basic colors" });
    const sws = BASIC_COLORS.map((hex) => {
      const b = el("button", { class: "sw", type: "button", "aria-label": hex, "aria-pressed": "false", title: hex, style: "background:" + hex });
      b.addEventListener("click", () => pick(hex));
      grid.append(b);
      return b;
    });
    const canvas = el("canvas", { width: "280", height: "120", role: "img", "aria-label": "Rainbow color picker. Use the hex box for exact colors." });
    const ctx = canvas.getContext("2d");
    const g1 = ctx.createLinearGradient(0, 0, 280, 0);
    for (let i = 0; i <= 6; i++) g1.addColorStop(i / 6, "hsl(" + (i * 60) + ",100%,50%)");
    ctx.fillStyle = g1; ctx.fillRect(0, 0, 280, 120);
    const g2 = ctx.createLinearGradient(0, 0, 0, 120);
    g2.addColorStop(0, "rgba(128,128,128,0)"); g2.addColorStop(1, "rgba(128,128,128,1)");
    ctx.fillStyle = g2; ctx.fillRect(0, 0, 280, 120);
    const light = el("input", { type: "range", min: "5", max: "95", value: "50", "aria-label": "Brightness" });
    const hex = el("input", { type: "text", maxlength: "7", "aria-label": "Hex color", spellcheck: "false" });
    const chip = el("span", { class: "newchip" });
    let hs = [0, 0];
    const fromPicker = () => pick(CardStyle.hslToHex(hs[0], hs[1], +light.value));
    function at(e) {
      const r = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      hs = [x * 360, (1 - y) * 100];
      fromPicker();
    }
    let down = false;
    canvas.addEventListener("pointerdown", (e) => { down = true; try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ } at(e); });
    canvas.addEventListener("pointermove", (e) => { if (down) at(e); });
    canvas.addEventListener("pointerup", () => { down = false; });
    light.addEventListener("input", () => { if (hs[1] > 0 || hs[0] > 0) fromPicker(); });
    hex.addEventListener("change", () => {
      const v = "#" + hex.value.trim().replace(/^#/, "");
      if (CardStyle.HEX.test(v)) pick(v.toLowerCase());
      else hex.value = chip.dataset.hex || "";
    });
    function show(h) {
      chip.dataset.hex = h; chip.style.background = h; hex.value = h;
      sws.forEach((b) => b.setAttribute("aria-pressed", String(b.title === h)));
    }
    function pick(h) { show(h); onPick(h); }
    root.append(el("div", {}, "Basic colors:"), grid, el("div", {}, "Mix your own:"), canvas,
      el("div", { class: "mix" }, el("label", {}, "Brightness ", light), chip, hex));
    show(initial);
    return { el: root, set: show };
  }

  function renderDesigner() {
    const m = main(); m.textContent = "";
    const saved = CardStyle.valid(me.card_style) ? me.card_style : null;
    const draft = Object.assign({}, CardStyle.DEFAULT, saved || {});
    let editing = "bg";
    const FIELDS = [["bg", "Card color"], ["fg", "Text color"], ["tc", "Title color"]];

    const previewHost = el("div", { class: "design-preview" });
    const status = el("div", { class: "contrast" });
    const msg = el("p", { class: "hint", role: "status" });
    const saveBtn = el("button", { class: "btn", type: "button", text: "Save my card look" });
    const resetBtn = el("button", { class: "btn", type: "button", text: "Back to the plain look" });
    const tsGrid = el("div", { class: "ts-grid", role: "group", "aria-label": "Title style" });
    const colorRow = el("div", { class: "color-row" });
    const dialogHost = el("div");
    let dialog = null;

    function paintPreview() {
      const fake = {
        id: "preview", user_id: me.id, author_name: myName(), created_at: new Date().toISOString(),
        title: "Your answer goes here", caption: "This is how the little caption under your answer will look. Make it yours.",
        link: null, card_style: draft
      };
      previewHost.textContent = "";
      previewHost.append(el("p", { class: "hint", text: "Preview" }), makeCard(fake, { preview: true }));
    }
    function paintStatus() {
      status.textContent = "";
      const t = CardStyle.ratio(draft.fg, draft.bg), h = CardStyle.ratio(draft.tc, draft.bg);
      const line = (label, ok, r, min) => el("p", {}, label + ": ",
        el("span", { class: ok ? "good" : "bad", text: ok ? "easy to read" : "too hard to read" }),
        el("small", { text: "  (" + r.toFixed(1) + " : 1, needs " + min + ")" }));
      status.append(line("Text on card", CardStyle.textOk(draft), t, CardStyle.MIN_TEXT), line("Title on card", CardStyle.titleOk(draft), h, CardStyle.MIN_TITLE));
      const ok = CardStyle.readable(draft);
      if (!ok) {
        status.append(el("button", { class: "btn small", type: "button", text: "Fix it for me", onclick: () => {
          if (!CardStyle.textOk(draft)) draft.fg = CardStyle.fix(draft.fg, draft.bg, CardStyle.MIN_TEXT + 0.5);
          if (!CardStyle.titleOk(draft)) draft.tc = CardStyle.fix(draft.tc, draft.bg, CardStyle.MIN_TITLE + 0.5);
          paintAll();
        } }), el("p", { class: "hint", text: "This keeps your card color and adjusts the text colors just enough." }));
      }
      saveBtn.disabled = !ok;
    }
    function paintTitles() {
      tsGrid.textContent = "";
      CardStyle.TITLE_STYLES.forEach((name, i) => {
        const b = el("button", { class: "ts-btn", type: "button", "aria-pressed": String(draft.t === i), onclick: () => { draft.t = i; paintAll(); } },
          el("span", { class: "title ts-" + i, text: "Aa Title" }), el("small", { text: name }));
        b.style.setProperty("--cbg", draft.bg); b.style.setProperty("--cfg", draft.fg); b.style.setProperty("--ctc", draft.tc);
        tsGrid.append(b);
      });
    }
    function paintColors() {
      colorRow.textContent = "";
      for (const [key, label] of FIELDS) {
        const b = el("button", { class: "color-btn", type: "button", "aria-pressed": String(editing === key), onclick: () => { editing = key; paintColors(); dialog.set(draft[key]); } },
          el("span", { class: "chip", style: "background:" + draft[key] }), label);
        colorRow.append(b);
      }
    }
    function paintAll() { paintTitles(); paintColors(); paintPreview(); paintStatus(); if (dialog) dialog.set(draft[editing]); msg.textContent = ""; }

    dialog = colorDialog(draft[editing], (hexv) => { draft[editing] = hexv; paintTitles(); paintColors(); paintPreview(); paintStatus(); msg.textContent = ""; });
    dialogHost.append(dialog.el);

    saveBtn.addEventListener("click", async () => {
      if (!CardStyle.readable(draft)) return;
      saveBtn.disabled = true;
      try {
        await store.rpc("set_card_style", { p_style: { t: draft.t, bg: draft.bg, fg: draft.fg, tc: draft.tc } });
        me.card_style = { t: draft.t, bg: draft.bg, fg: draft.fg, tc: draft.tc };
        msg.textContent = "Saved. Your next answers will use this look.";
      } catch { msg.textContent = "Couldn't save that. Try again in a moment."; }
      saveBtn.disabled = !CardStyle.readable(draft);
    });
    resetBtn.addEventListener("click", async () => {
      try {
        await store.rpc("set_card_style", { p_style: null });
        me.card_style = null;
        Object.assign(draft, CardStyle.DEFAULT); editing = "bg";
        paintAll(); msg.textContent = "Back to the plain look.";
      } catch { msg.textContent = "Couldn't reset that. Try again in a moment."; }
    });

    const left = el("div", {},
      el("h4", { text: "1. Title style" }), tsGrid,
      el("h4", { text: "2. Colors" }), colorRow, dialogHost,
      el("h4", { text: "3. Is it readable?" }), status,
      el("div", { class: "row", style: "margin-top:10px" }, saveBtn, resetBtn), msg);
    m.append(panel("Design my card", el("p", { class: "hint", style: "margin-bottom:12px", text: "Your look is saved on each answer you post, so older answers keep the look they had. Posts you've already made don't change." }),
      el("div", { class: "design" }, left, previewHost)));
    paintAll();
    renderSidebar();
  }

  // ----- comments -----
  const COMMENT_MAX = 200;

  // posts I wrote, or have commented on
  function involvedPostIds() {
    const ids = new Set();
    for (const p of posts) if (me && p.user_id === me.id) ids.add(p.id);
    for (const [pid, list] of Object.entries(commentsByPost)) if (me && list.some((c) => c.user_id === me.id)) ids.add(pid);
    return ids;
  }
  function unseenList() {
    if (!me) return [];
    const ids = involvedPostIds();
    const out = [];
    for (const pid of ids) {
      for (const c of commentsByPost[pid] || []) {
        if (c.user_id !== me.id && !c.hidden && Date.parse(c.created_at) > state.commentsSeen) out.push(c);
      }
    }
    return out;
  }
  const unseenCount = () => unseenList().length;

  function commentsBlock(post, startOpen) {
    const wrap = el("div", { class: "comments" });
    let open = startOpen || commentsOpen.has(post.id);
    function paint() {
      wrap.textContent = "";
      const list = (commentsByPost[post.id] || []).filter((c) => !c.hidden || c.user_id === me.id || isAdmin());
      wrap.append(el("button", {
        class: "linklike", type: "button", "aria-expanded": String(open),
        text: (open ? "Hide comments" : "Comments") + (list.length ? " (" + list.length + ")" : ""),
        onclick: () => { open = !open; if (open) commentsOpen.add(post.id); else commentsOpen.delete(post.id); paint(); }
      }));
      if (!open) return;
      for (const c of list) {
        const prof = profilesById[c.user_id];
        const when = new Date(c.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        const p = el("p", { class: "comment" + (c.hidden ? " is-hidden" : "") },
          prof ? el("a", { href: "#u=" + prof.username, text: c.author_name }) : el("b", { text: c.author_name }),
          " " + c.body + " ", el("small", { text: when + (c.hidden ? " · hidden from others" : "") }));
        if (c.user_id === me.id) {
          p.append(" ", el("button", { class: "linklike small", type: "button", text: "delete", onclick: async () => {
            try { await store.deleteComment(c.id); commentsByPost[post.id] = (commentsByPost[post.id] || []).filter((x) => x.id !== c.id); paint(); }
            catch { /* leave it; try again */ }
          } }));
        } else if (isAdmin()) {
          p.append(" ", el("button", { class: "linklike small", type: "button", text: c.hidden ? "unhide" : "hide", onclick: async () => {
            try { await store.setCommentHidden(c.id, !c.hidden); c.hidden = !c.hidden; paint(); } catch { /* ignore */ }
          } }));
        }
        wrap.append(p);
      }
      const input = el("input", { maxlength: String(COMMENT_MAX), "aria-label": "Add a comment", placeholder: "Add a comment (" + COMMENT_MAX + " characters max)" });
      const err = el("span", { class: "err", role: "alert" });
      const form = el("form", { class: "comment-form" }, input, el("button", { class: "btn small", type: "submit", text: "Post" }), err);
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const body = input.value.trim().slice(0, COMMENT_MAX);
        if (!body) return;
        err.textContent = "";
        try {
          const row = await store.addComment({ post_id: post.id, user_id: me.id, author_name: myName(), body });
          if (row) (commentsByPost[post.id] = commentsByPost[post.id] || []).push(row);
          commentsOpen.add(post.id);
          paint();
        } catch { err.textContent = "Couldn't post that. Try again."; }
      });
      wrap.append(form);
    }
    paint();
    return wrap;
  }

  // everything said on posts I wrote or joined, newest conversation first
  function renderComments() {
    const m = main(); m.textContent = "";
    const ids = involvedPostIds();
    const rows = [];
    for (const pid of ids) {
      const post = posts.find((x) => x.id === pid);
      const list = (commentsByPost[pid] || []).filter((c) => !c.hidden || isAdmin());
      if (!post || !list.length) continue;
      rows.push({ post, last: Math.max(...list.map((c) => Date.parse(c.created_at))) });
    }
    rows.sort((a, b) => b.last - a.last);
    const body = [el("p", { class: "hint", text: "Comments on your answers, and on answers you've commented on." })];
    if (!rows.length) body.push(el("p", { class: "empty", text: "No comments yet." }));
    for (const { post } of rows) {
      const r = promptsByDay[post.day] || {};
      const heading = el("a", { href: "#day=" + post.day, text: fmtDay(post.day, { weekday: "short", month: "short", day: "numeric" }) + " · " + (r.short_title || "") });
      body.push(makeCard(post, { heading, openComments: true }));
    }
    m.append(panel("Comments", ...body));
    // a server clock slightly ahead of this device must not leave the badge stuck
    const newest = Math.max(0, ...Object.values(commentsByPost).flat().map((c) => Date.parse(c.created_at) || 0));
    state.commentsSeen = Math.max(nowMs(), Math.min(newest, nowMs() + 10 * 60e3)); saveState();
    renderSidebar();
  }

  // ----- a member's profile -----
  function renderProfile(username) {
    const m = main(); m.textContent = "";
    const prof = profilesByName[username];
    if (!prof) { m.append(panel("Not found", el("p", { class: "empty", text: "Nobody here goes by that name." }))); return; }
    const inviter = prof.invited_by && profilesById[prof.invited_by];
    const joined = new Date(prof.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    const info = el("p", { class: "hint" }, "@" + prof.username + " · joined " + joined);
    if (inviter) info.append(" · invited by ", el("a", { href: "#u=" + inviter.username, text: inviter.display_name }));
    const body = [el("p", { class: "sentence big", text: prof.display_name }), info];
    if (me && prof.id === me.id) body.push(el("p", {}, el("a", { href: "#invites", text: "Invite a friend" })));
    if (isAdmin() && prof.id !== me.id) {
      const msg = el("span", { class: "hint" });
      body.push(el("div", { class: "row" },
        el("button", { class: "btn small", type: "button", text: prof.blocked ? "Unblock (admin)" : "Block (admin)",
          onclick: async () => {
            try { await store.setBlocked(prof.id, !prof.blocked); prof.blocked = !prof.blocked; renderProfile(username); }
            catch (ex) { msg.textContent = "Couldn't change that."; }
          } }), msg));
      if (prof.blocked) body.push(el("p", { class: "err", text: "This member is blocked." }));
    }
    m.append(panel("Profile", ...body));

    const theirs = posts.filter((p) => p.user_id === prof.id).sort((a, b) => (a.day < b.day ? 1 : -1));
    const visible = theirs.filter((p) => (me && prof.id === me.id) || mine[p.day]);
    const cards = [];
    if (!visible.length) cards.push(el("p", { class: "empty", text: "No answers to show yet." }));
    for (const p of visible) {
      const r = promptsByDay[p.day] || {};
      const heading = el("a", { href: "#day=" + p.day, text: fmtDay(p.day, { weekday: "short", month: "short", day: "numeric" }) + " · " + (r.short_title || "") });
      cards.push(makeCard(p, { heading }));
    }
    const hiddenN = theirs.length - visible.length;
    if (hiddenN > 0) cards.push(el("p", { class: "hint", text: hiddenN + (hiddenN === 1 ? " more answer is" : " more answers are") + " on days you haven't answered yet." }));
    m.append(panel("Answers", ...cards));
  }

  // ----- invite links -----
  async function renderInvites() {
    const m = main(); m.textContent = "";
    const body = el("div", {});
    m.append(panel("Invite a friend", body));
    body.append(el("p", { class: "hint", text: "Loading..." }));
    let list = [];
    try {
      const [inv, pf] = await Promise.all([store.listInvites(me.id), store.listProfiles().catch(() => null)]);
      list = inv || [];
      if (pf) { profilesById = {}; profilesByName = {}; for (const x of pf) { profilesById[x.id] = x; profilesByName[x.username] = x; } }
    } catch (ex) {
      body.textContent = "";
      body.append(el("p", { class: "err", text: "Couldn't load your invites." }));
      return;
    }
    body.textContent = "";
    body.append(el("p", { text: isAdmin()
      ? "Make a link and send it to a friend. As an admin you can make links that work for several people."
      : "Make a link and send it to a friend. Each link lets one person join, and you can make up to 3." }));
    const msg = el("p", { class: "err", role: "alert" });
    const uses = el("input", { type: "number", min: "1", max: "100", value: "1", "aria-label": "How many people can use this link", style: "width:70px" });
    const make = el("button", { class: "btn", type: "button", text: "Make a new invite link" });
    make.addEventListener("click", async () => {
      msg.textContent = ""; make.disabled = true;
      try {
        await store.rpc("create_invite", isAdmin() ? { p_uses: Math.max(1, Math.min(100, parseInt(uses.value, 10) || 1)) } : {});
        renderInvites();
      } catch (ex) {
        msg.textContent = /invite_limit/.test(String(ex && ex.message)) ? "You've used all your invite links." : "Couldn't make a link. Try again in a moment.";
        make.disabled = false;
      }
    });
    body.append(el("div", { class: "row" }, make, isAdmin() ? el("label", {}, "people: ", uses) : null), msg);
    for (const inv of list) {
      const url = location.origin + location.pathname + "#invite=" + inv.code;
      const joiners = Object.values(profilesById).filter((x) => x.invite_code === inv.code).map((x) => x.display_name);
      const status = (inv.uses_left > 0 ? inv.uses_left + " left" : "used") + (joiners.length ? " · joined: " + joiners.join(", ") : "");
      const copyMsg = el("span", { class: "ok" });
      body.append(el("div", { class: "mail-row" },
        el("span", { class: "t" }, url, el("small", { text: status })),
        inv.uses_left > 0 ? el("button", { class: "btn small", type: "button", text: "Copy", onclick: async () => {
          try { await navigator.clipboard.writeText(url); copyMsg.textContent = "Copied."; } catch { copyMsg.textContent = "Select and copy it by hand."; }
        } }) : null, copyMsg));
    }
    if (!list.length) body.append(el("p", { class: "empty", text: "No invite links yet." }));
  }

  // ----- my list -----
  function renderListView() {
    const m = main(); m.textContent = "";
    const items = Object.values(state.saved);
    const body = [];
    if (!items.length) body.push(el("p", { class: "empty", text: "Nothing saved yet. Hit “Save to my list” on any answer." }));
    else {
      const known = new Set(cfg.LIST_GROUPS.flatMap((g) => g.cats));
      for (const g of [...cfg.LIST_GROUPS, { title: "Other stuff", cats: null }]) {
        const mineItems = items
          .filter((i) => (g.cats ? g.cats.includes(i.category) : !known.has(i.category)))
          .sort((a, b) => (a.done - b.done) || (b.savedAt - a.savedAt));
        if (!mineItems.length) continue;
        const wrap = el("div", { class: "list-group" }, el("h3", { text: g.title }));
        for (const i of mineItems) {
          const cb = el("input", { type: "checkbox", "aria-label": "Done" });
          cb.checked = !!i.done;
          cb.addEventListener("change", () => { state.saved[i.id].done = cb.checked; saveState(); renderListView(); });
          const row = el("div", { class: "li" + (i.done ? " done" : "") }, cb,
            el("div", { class: "li-main" }, el("div", { class: "li-title", text: i.title }), el("div", { class: "li-from", text: "from " + i.from })));
          for (const l of findLinks(i)) row.append(el("a", { href: l.href, target: "_blank", rel: "noopener noreferrer nofollow", text: l.label }));
          row.append(el("button", { class: "x", type: "button", "aria-label": "Remove from list", text: "✕",
            onclick: () => { delete state.saved[i.id]; saveState(); renderListView(); renderSidebar(); } }));
          wrap.append(row);
        }
        body.push(wrap);
      }
      const msg = el("span", { class: "ok" });
      body.push(el("div", { class: "row", style: "margin-top:12px" },
        el("button", { class: "btn", type: "button", text: "Copy list as text", onclick: async () => {
          try { await navigator.clipboard.writeText(listAsText()); msg.textContent = "Copied."; }
          catch { msg.textContent = "Couldn't copy. Select the list and copy it by hand."; }
        } }), msg));
    }
    m.append(panel("My list", ...body));
    renderSidebar();
  }

  // ============================================================
  // sidebar
  // ============================================================
  function currentRoute() {
    const h = location.hash.slice(1);
    if (h.startsWith("day=")) return { view: "day", day: h.slice(4) };
    if (h === "inbox") return { view: "inbox" };
    if (h === "late") return { view: "late" };
    if (h === "list") return { view: "list" };
    if (h === "invites") return { view: "invites" };
    if (h === "comments") return { view: "comments" };
    if (h === "design") return { view: "design" };
    if (h.startsWith("u=")) return { view: "profile", username: decodeURIComponent(h.slice(2)).toLowerCase() };
    return { view: "day", day: todayKey() };
  }

  function renderSidebar() {
    const side = $("#side");
    side.textContent = "";
    if (!myName() || !mine[todayKey()]) return;
    const route = currentRoute();
    const today = todayKey();
    const todayRow = promptsByDay[today];

    const item = (href, label, { active, unread, sub, badge } = {}) => {
      const a = el("a", { class: "nav" + (active ? " active" : "") + (unread ? " unread" : ""), href: "#" + href }, label);
      if (badge) a.append(el("span", { class: "badge", text: String(badge) }));
      if (sub) a.append(el("small", { text: sub }));
      a.addEventListener("click", () => side.classList.remove("open"));
      return a;
    };

    const inbox = inboxDays().length, late = lateNewCount(), saved = Object.keys(state.saved).length;
    side.append(
      item("day=" + today, "Today", { active: route.view === "day" && route.day === today,
        sub: todayRow && state.revealed[today] ? todayRow.short_title : "??? open to reveal" }),
      item("inbox", "Inbox", { active: route.view === "inbox", unread: inbox > 0, badge: inbox || 0 }),
      item("late", "Late to the Party", { active: route.view === "late", unread: late > 0, badge: late || 0 }),
      item("list", "My list", { active: route.view === "list", badge: saved || 0 }));
    if (me) {
      side.append(
        item("comments", "Comments", { active: route.view === "comments", unread: unseenCount() > 0, badge: unseenCount() || 0 }),
        item("design", "Design my card", { active: route.view === "design" }),
        item("u=" + me.username, "My profile", { active: route.view === "profile" && route.username === me.username }),
        item("invites", "Invite a friend", { active: route.view === "invites" }));
    }

    side.append(el("h4", { text: "Past days" }));
    const days = Object.keys(promptsByDay).filter((d) => d < today).sort().reverse();
    const thisMonth = today.slice(0, 7);
    const byMonth = {};
    for (const d of days) (byMonth[d.slice(0, 7)] = byMonth[d.slice(0, 7)] || []).push(d);

    const dayLink = (d) => {
      const r = promptsByDay[d];
      const a = item("day=" + d, "", { active: route.view === "day" && route.day === d });
      a.classList.add("day");
      if (mine[d]) a.append(el("span", { class: "tick", text: "✓" }));
      a.append(fmtDay(d, { weekday: "short", day: "numeric" }) + " · " + r.short_title);
      return a;
    };

    for (const mk of Object.keys(byMonth).sort().reverse()) {
      if (mk === thisMonth) { for (const d of byMonth[mk]) side.append(dayLink(d)); continue; }
      const det = el("details", {});
      if (route.view === "day" && route.day && route.day.slice(0, 7) === mk) det.open = true;
      det.append(el("summary", { text: fmtDay(mk + "-01", { month: "long", year: "numeric" }) + " (" + byMonth[mk].length + ")" }));
      for (const d of byMonth[mk]) det.append(dayLink(d));
      side.append(det);
    }
    if (!days.length) side.append(el("p", { class: "hint", text: "Past days will show up here." }));
  }

  // ============================================================
  // router
  // ============================================================
  function go(hash) {
    if (location.hash === "#" + hash) render();
    else location.hash = hash;
  }

  function authScreen() {
    if (!REMOTE) return null;
    if (Auth.session() && !me && profileChecked) return "join";
    if (!Auth.session() && (cfg.REQUIRE_LOGIN || state.pendingInvite || login.linkError || location.hash === "#login")) return "login";
    return null;
  }

  function render() {
    const screen = authScreen();
    $("#win-login").hidden = screen !== "login";
    $("#win-join").hidden = screen !== "join";
    if (screen) {
      $("#win-welcome").hidden = true; $("#shell").hidden = true; $("#demo-tools").hidden = true;
      if (screen === "login") showLogin(); else showJoin();
      return;
    }
    if (me && me.blocked) {
      $("#win-welcome").hidden = true; $("#shell").hidden = false; $("#shell").classList.add("locked");
      main().textContent = ""; main().append(panel("Account paused", el("p", { text: "This account has been paused. Talk to whoever invited you." })));
      return;
    }
    const named = !!myName();
    $("#win-welcome").hidden = named;
    $("#to-login-row").hidden = !REMOTE;
    $("#shell").hidden = !named;
    $("#demo-tools").hidden = REMOTE || !named;
    if (!named) { $("#name-input").focus(); return; }
    $("#who").textContent = myName();
    $("#rename").textContent = me ? "Log out" : "not you?";

    const shell = $("#shell");
    const today = todayKey();
    const unlocked = !!mine[today];
    shell.classList.toggle("locked", !unlocked);
    $("#side").classList.remove("open");

    if (!unlocked) { renderGateOnce(); renderSidebar(); return; }
    animToken++;
    renderSidebar();
    const route = currentRoute();
    if (route.view === "inbox") renderInbox();
    else if (route.view === "late") renderLate();
    else if (route.view === "list") renderListView();
    else if (route.view === "profile") renderProfile(route.username);
    else if (route.view === "invites" && me) renderInvites();
    else if (route.view === "comments" && me) renderComments();
    else if (route.view === "design" && me) renderDesigner();
    else renderDay(route.view === "day" ? route.day : todayKey());
    window.scrollTo({ top: 0 });
  }

  // The gate keeps its own DOM while the reveal animation runs, so don't rebuild it on every render.
  let gateDay = "";
  function renderGateOnce() {
    const today = todayKey();
    if (gateDay === today && main().querySelector(".ask-box")) return;
    gateDay = today;
    renderGate();
  }

  const canWrite = () => !(REMOTE && Auth.session() && !me);
  async function refresh() {
    try { await loadAll(); if (canWrite()) await ensureDay(todayKey()); gateDay = ""; render(); }
    catch (ex) { showFatal(ex); }
  }

  function showFatal(ex) {
    const m = main(); m.textContent = "";
    m.append(panel("Something's not right",
      el("p", { class: "err", text: "Couldn't load the site." }),
      el("p", { text: String(ex && ex.message || ex).slice(0, 300) }),
      el("p", { class: "hint", text: REMOTE ? "If this is a new Supabase project, check that you ran supabase-setup.sql (the version that came with this update)." : "" })));
    $("#shell").hidden = false;
    $("#win-welcome").hidden = true;
    $("#shell").classList.add("locked");
  }

  // ============================================================
  // demo bootstrap and tools
  // ============================================================
  async function demoBootstrap() {
    const today = todayKey();
    for (let i = 7; i >= 1; i--) await ensureDay(addDays(today, -i));
  }

  function wireDemoTools() {
    $("#demo-joined").addEventListener("click", () => {
      state.joinedDay = addDays(todayKey(), -6);
      state.dismissed = {};
      saveState(); render();
    });
    $("#demo-next").addEventListener("click", async () => {
      const answeredDays = Object.keys(mine).filter((d) => d <= todayKey());
      state.demoOffset += 1; saveState();
      demo.addLateSamples(answeredDays.sort().reverse().slice(0, 3));
      gateDay = "";
      await ensureDay(todayKey());
      await loadAll();
      go("");
      render();
    });
    $("#demo-reset").addEventListener("click", () => {
      if (!confirm("Erase the demo and start over?")) return;
      try { Object.keys(localStorage).filter((k) => k.startsWith("staffpicks.")).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
      location.hash = ""; location.reload();
    });
  }

  // ============================================================
  // accounts: login, joining with an invite, who am I
  // ============================================================
  const login = { step: "email", email: "", inviteOk: false, inviter: "", checked: false, linkError: false };
  const byCode = () => cfg.LOGIN_METHOD === "code";

  async function loadMe() {
    me = null; profileChecked = false;
    const u = Auth.user();
    if (!u) { profileChecked = true; return; }
    const prof = await store.getProfile(u.id);
    if (!Auth.session()) { profileChecked = true; return; } // the login ended while we were asking
    me = prof;
    profileChecked = true;
    if (!me) return;
    if (state.accountId !== me.id) {
      if (state.accountId) { state.saved = {}; state.dismissed = {}; state.joinedDay = ""; }
      state.accountId = me.id; state.savesSynced = false; state.commentsSeen = nowMs();
    }
    if (!state.joinedDay) state.joinedDay = dayKeyOf(Date.parse(me.created_at) || nowMs());
    if (!state.lateSeen) state.lateSeen = nowMs();
    if (!state.commentsSeen) state.commentsSeen = nowMs();
    saveState();
  }

  // An invite link (#invite=CODE): remember the code, tidy the address bar, check it. Works on first load
  // and when someone pastes an invite link into a tab that already has the site open.
  async function takeInviteFromHash() {
    const m = location.hash.match(/^#invite=([A-Za-z0-9]+)/);
    if (!m) return false;
    state.pendingInvite = m[1].toUpperCase(); saveState();
    history.replaceState(null, "", location.pathname + location.search);
    login.step = "email";
    if (!Auth.session()) await checkInvite();
    return true;
  }

  async function takeAuthFromHash() {
    const r = await Auth.fromHash(location.hash);
    if (!r) return false;
    history.replaceState(null, "", location.pathname + location.search);
    if (r.error) login.linkError = true;
    return true;
  }

  async function checkInvite() {
    login.checked = true;
    login.inviteOk = false; login.inviter = "";
    try {
      const r = await store.rpc("check_invite", { p_code: state.pendingInvite });
      if (r && r.valid) { login.inviteOk = true; login.inviter = r.inviter || ""; }
    } catch { /* the SQL may not be installed yet: treat as not valid */ }
  }

  function showLogin() {
    const banner = $("#login-invite");
    if (state.pendingInvite && login.inviteOk) {
      banner.hidden = false;
      banner.textContent = (login.inviter ? login.inviter + " invited you." : "You've been invited.") + " Enter your email to join.";
    } else if (state.pendingInvite) {
      banner.hidden = false;
      banner.textContent = "That invite link isn't valid, or it was already used. If you already have an account, log in below.";
    } else {
      banner.hidden = true;
    }
    $("#login-email-form").hidden = login.step !== "email";
    $("#login-sentrow").hidden = login.step !== "code";
    $("#login-code-form").hidden = !(login.step === "code" && byCode());
    if (login.linkError) { $("#login-msg").textContent = "That link didn't work. It may have expired or already been used. Send yourself a new one."; login.linkError = false; }
    $("#login-open").hidden = !!cfg.REQUIRE_LOGIN;
    if (login.step === "email") $("#login-email").focus(); else if (byCode()) $("#login-code").focus();
  }

  function showJoin() {
    const code = $("#join-code");
    const u = Auth.user();
    if (!code.value) code.value = (u && u.invite) || state.pendingInvite || "";
    $("#join-email").textContent = u && u.email ? u.email : "";
    $("#join-name").focus();
  }

  function wireAuthForms() {
    const say = (id, t) => { $(id).textContent = t; };
    $("#to-login").addEventListener("click", () => { location.hash = "login"; });
    $("#login-skip").addEventListener("click", () => { state.pendingInvite = ""; saveState(); location.hash = ""; render(); });

    $("#login-email-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      say("#login-msg", "");
      const email = $("#login-email").value.trim().toLowerCase();
      if (!email) return;
      const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
      try {
        const invited = !!(state.pendingInvite && login.inviteOk);
        await Auth.sendCode(email, invited, invited ? state.pendingInvite : "");
        login.email = email; login.step = "code";
        say("#login-sent", byCode()
          ? "We sent a code to " + email + ". It can take a minute. Check spam too."
          : "We sent a link to " + email + ". Open the email and click the link. It can take a minute, and check spam too.");
        render();
      } catch (ex) {
        say("#login-msg", ex.status === 429
          ? "Too many tries. Wait a minute and try again."
          : "Couldn't send a code. If you're new here, you need an invite link from a friend.");
      }
      btn.disabled = false;
    });

    $("#login-code-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      say("#login-msg", "");
      const token = $("#login-code").value.replace(/\s+/g, "");
      if (!token) return;
      const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
      try {
        await Auth.verify(login.email, token);
        location.hash = ""; location.reload();
      } catch (ex) {
        say("#login-msg", "That code didn't work. Check it, or ask for a new one.");
        btn.disabled = false;
      }
    });
    $("#login-back").addEventListener("click", () => { login.step = "email"; say("#login-msg", ""); render(); });

    $("#join-username").addEventListener("input", (e) => {
      e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
    });
    $("#join-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      say("#join-msg", "");
      const code = $("#join-code").value.trim().toUpperCase();
      const dname = $("#join-name").value.trim();
      const uname = $("#join-username").value.trim().toLowerCase();
      if (!code) { say("#join-msg", "Paste your invite code."); return; }
      if (!dname) { say("#join-msg", "Add your name."); return; }
      if (!/^[a-z0-9_]{3,20}$/.test(uname)) { say("#join-msg", "Usernames are 3 to 20 letters, numbers or underscores."); return; }
      const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
      try {
        await store.rpc("redeem_invite", { p_code: code, p_username: uname, p_display_name: dname });
        state.pendingInvite = ""; saveState();
        location.hash = ""; location.reload();
      } catch (ex) {
        const t = String(ex && ex.message || "");
        say("#join-msg",
          /username_taken|duplicate|23505/.test(t) ? "That username is taken. Try another."
          : /reserved_username/.test(t) ? "That username isn't available."
          : /bad_username/.test(t) ? "Usernames are 3 to 20 letters, numbers or underscores."
          : /bad_invite/.test(t) ? "That invite code isn't valid, or it was already used."
          : /already_member/.test(t) ? "You already have an account. Reloading..."
          : "Couldn't join. Try again in a moment.");
        if (/already_member/.test(t)) setTimeout(() => location.reload(), 1200);
        btn.disabled = false;
      }
    });
    $("#join-logout").addEventListener("click", () => { Auth.signOut(); location.hash = ""; location.reload(); });
  }

  // ============================================================
  // boot
  // ============================================================
  async function boot() {
    document.title = cfg.SITE_NAME;
    document.querySelectorAll("[data-site-name]").forEach((n) => (n.textContent = cfg.SITE_NAME));
    document.querySelectorAll("[data-tagline]").forEach((n) => (n.textContent = cfg.TAGLINE));
    $("#mode-label").textContent = REMOTE ? cfg.SITE_NAME + " — shared feed" : cfg.SITE_NAME + " — DEMO MODE: everything stays on this device";
    const tick = () => { $("#clock").textContent = new Date(nowMs()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); };
    tick(); setInterval(tick, 30000);

    $("#name-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = $("#name-input").value.trim();
      if (!v) return;
      state.name = v.slice(0, 40);
      if (!state.joinedDay) state.joinedDay = todayKey();
      if (!state.lateSeen) state.lateSeen = nowMs();
      saveState();
      render();
    });
    $("#rename").addEventListener("click", () => {
      if (me || Auth.session()) {
        Auth.signOut();
        state.name = ""; state.saved = {}; state.dismissed = {}; state.joinedDay = ""; state.savesSynced = false; state.accountId = ""; state.commentsSeen = 0;
        saveState();
        location.hash = ""; location.reload();
        return;
      }
      state.name = ""; saveState();
      $("#name-input").value = "";
      render();
    });
    wireAuthForms();
    $("#menu-btn").addEventListener("click", () => $("#side").classList.toggle("open"));
    window.addEventListener("hashchange", async () => {
      if (REMOTE && /access_token=|error=/.test(location.hash)) { await takeAuthFromHash(); location.reload(); return; }
      if (REMOTE && await takeInviteFromHash()) { if (me) { state.pendingInvite = ""; saveState(); } }
      render();
    });
    if (!REMOTE) wireDemoTools();

    if (REMOTE) {
      await takeAuthFromHash();   // arriving from the link in the login email
      try { await loadMe(); } catch (ex) { showFatal(ex); return; }
      await takeInviteFromHash();
      if (me && state.pendingInvite) { state.pendingInvite = ""; saveState(); }
      else if (!Auth.session() && state.pendingInvite && !login.checked) await checkInvite();
    }

    try {
      await loadAll();
      if (!REMOTE && !Object.keys(promptsByDay).length) { await demoBootstrap(); await loadAll(); }
      if (canWrite()) await ensureDay(todayKey());
    } catch (ex) { showFatal(ex); return; }
    render();

    // roll over to the next day if the page stays open past 6 AM Buenos Aires
    let lastToday = todayKey();
    setInterval(async () => {
      const t = todayKey();
      if (t === lastToday) return;
      lastToday = t;
      try { await loadAll(); if (canWrite()) await ensureDay(t); gateDay = ""; render(); } catch { /* try again next minute */ }
    }, 60000);
  }

  boot();
})();
