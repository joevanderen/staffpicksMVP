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
    return { name: "", deviceId: "", joinedDay: "", lateSeen: 0, revealed: {}, dismissed: {}, saved: {}, demoOffset: 0 };
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
      const r = await fetch(base + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
      if (!r.ok) throw new Error((await r.text()) || r.statusText);
      if (r.status === 204) return null;
      try { return await r.json(); } catch { return null; }
    }
    return {
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
      listReactions: () => req("/reactions?select=post_id,device_id,kind&limit=10000"),
      addReaction: (postId, kind) =>
        req("/reactions", { method: "POST", body: JSON.stringify({ post_id: postId, device_id: state.deviceId, kind }) }),
      removeReaction: (postId, kind) =>
        req(`/reactions?post_id=eq.${encodeURIComponent(postId)}&device_id=eq.${encodeURIComponent(state.deviceId)}&kind=eq.${encodeURIComponent(kind)}`, { method: "DELETE" })
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
    const PK = "staffpicks.demo2.prompts", OK = "staffpicks.demo2.posts", RK = "staffpicks.demo2.reactions";
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
        if (!all.some((r) => r.post_id === postId && r.device_id === state.deviceId && r.kind === kind))
          all.push({ post_id: postId, device_id: state.deviceId, kind });
        wr(RK, all);
      },
      async removeReaction(postId, kind) {
        wr(RK, rd(RK, []).filter((r) => !(r.post_id === postId && r.device_id === state.deviceId && r.kind === kind)));
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
  let reactions = {}; // postId -> { kind: { n, mine } }

  function reindex() {
    postsByDay = {}; mine = {};
    for (const p of posts) {
      (postsByDay[p.day] = postsByDay[p.day] || []).push(p);
      if (p.device_id === state.deviceId) mine[p.day] = p;
    }
    for (const d of Object.keys(postsByDay)) postsByDay[d].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }
  function buildReactionMap(list) {
    const map = {};
    for (const r of list) {
      const slot = (map[r.post_id] = map[r.post_id] || {});
      const k = (slot[r.kind] = slot[r.kind] || { n: 0, mine: false });
      k.n += 1;
      if (r.device_id === state.deviceId) k.mine = true;
    }
    return map;
  }

  async function loadAll() {
    const [pr, po, re] = await Promise.all([store.listPrompts(), store.listPosts(), store.listReactions()]);
    promptsByDay = {};
    for (const r of pr || []) promptsByDay[r.day] = r;
    posts = po || [];
    reactions = buildReactionMap(re || []);
    reindex();
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
    if (state.saved[post.id]) { delete state.saved[post.id]; }
    else {
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
    const cur = (slot[kind] = slot[kind] || { n: 0, mine: false });
    const adding = !cur.mine;
    cur.mine = adding;
    cur.n = Math.max(0, cur.n + (adding ? 1 : -1));
    repaint();
    try { await (adding ? store.addReaction(post.id, kind) : store.removeReaction(post.id, kind)); }
    catch {
      cur.mine = !adding;
      cur.n = Math.max(0, cur.n + (adding ? -1 : 1));
      repaint();
    }
  }

  function makeCard(post, opts = {}) {
    const rand = rng(hash(post.id));
    const when = new Date(post.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const c = el("article", { class: "card" });
    c.style.setProperty("--tilt", ((rand() - 0.5) * 2.4).toFixed(2) + "deg");
    c.append(el("div", { class: "tape" }));
    if (opts.heading) c.append(el("p", { class: "prompt" }, opts.heading));
    c.append(el("h3", { class: "title", text: post.title }));
    if (post.caption) c.append(el("p", { class: "caption", text: post.caption }));
    const lb = linkBlock(post.link);
    if (lb) c.append(lb);
    c.append(el("p", { class: "meta", text: "— " + post.author_name + ", " + when }));

    const bar = el("div", { class: "reactions" });
    let graf = el("div");
    c.append(bar, graf);

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
        const b = el("button", { class: "rbtn", type: "button", "aria-pressed": String(info.mine), onclick: () => toggleReaction(post, r.kind, paint) });
        b.append(r.label);
        if (info.n > 0) b.append(el("span", { class: "n", text: String(info.n) }));
        bar.append(b);
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
    const err = el("p", { class: "err", role: "alert" });
    const btn = el("button", { class: "btn big", type: "submit", text: "Post it" });
    const form = el("form", { class: "answer-form" },
      el("label", { class: "field" }, el("span", { text: "Your answer" }), title),
      el("label", { class: "field" }, el("span", {}, "Why? ", counter), caption),
      el("label", { class: "field" }, el("span", { text: "Link (optional)" }), link,
        el("p", { class: "hint", text: "Spotify and YouTube links get a play button in the feed." })),
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
          day, author_name: state.name, device_id: state.deviceId,
          title: t, caption: cap, link: lk || null, scope: "global"
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
        if (p.device_id !== state.deviceId && Date.parse(p.created_at) > mineAt) out.push(p);
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
    return { view: "day", day: todayKey() };
  }

  function renderSidebar() {
    const side = $("#side");
    side.textContent = "";
    if (!state.name || !mine[todayKey()]) return;
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

  function render() {
    const named = !!state.name;
    $("#win-welcome").hidden = named;
    $("#shell").hidden = !named;
    $("#demo-tools").hidden = REMOTE || !named;
    if (!named) { $("#name-input").focus(); return; }
    $("#who").textContent = state.name;

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
    else renderDay(route.day);
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

  async function refresh() {
    try { await loadAll(); await ensureDay(todayKey()); gateDay = ""; render(); }
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
      state.name = ""; saveState();
      $("#name-input").value = "";
      render();
    });
    $("#menu-btn").addEventListener("click", () => $("#side").classList.toggle("open"));
    window.addEventListener("hashchange", render);
    if (!REMOTE) wireDemoTools();

    try {
      await loadAll();
      if (!REMOTE && !Object.keys(promptsByDay).length) { await demoBootstrap(); await loadAll(); }
      await ensureDay(todayKey());
    } catch (ex) { showFatal(ex); return; }
    render();

    // roll over to the next day if the page stays open past 6 AM Buenos Aires
    let lastToday = todayKey();
    setInterval(async () => {
      const t = todayKey();
      if (t === lastToday) return;
      lastToday = t;
      try { await loadAll(); await ensureDay(t); gateDay = ""; render(); } catch { /* try again next minute */ }
    }, 60000);
  }

  boot();
})();
