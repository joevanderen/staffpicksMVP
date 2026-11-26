// Login for Supabase without any library: email + one-time code.
// The session (a short-lived access token and a long-lived refresh token) lives in this browser only.
(() => {
  "use strict";
  const cfg = window.APP_CONFIG;
  const ENABLED = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  const base = ENABLED ? cfg.SUPABASE_URL.replace(/\/$/, "") + "/auth/v1" : "";
  const KEY = "staffpicks.auth";

  let session = null;
  try { session = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { session = null; }
  if (session && !(session.access_token && session.refresh_token)) session = null;

  function readStored() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || "null");
      return s && s.access_token && s.refresh_token ? s : null;
    } catch { return null; }
  }
  // Tell the page the login is over (it shows the login screen with a note).
  function ended() { try { if (window.Auth && typeof window.Auth.onEnd === "function") window.Auth.onEnd(); } catch { /* ignore */ } }

  function persist() {
    try {
      if (session) localStorage.setItem(KEY, JSON.stringify(session));
      else localStorage.removeItem(KEY);
    } catch { /* private mode */ }
  }

  function store(s) {
    session = {
      access_token: s.access_token,
      refresh_token: s.refresh_token,
      expires_at: s.expires_at || (Math.floor(Date.now() / 1000) + (s.expires_in || 3600)),
      user: s.user ? { id: s.user.id, email: s.user.email, invite: (s.user.user_metadata && s.user.user_metadata.invite) || "" } : (session && session.user) || null
    };
    persist();
  }

  async function call(path, body) {
    const r = await fetch(base + path, {
      method: "POST",
      headers: { apikey: cfg.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    let data = null;
    try { data = await r.json(); } catch { /* empty body */ }
    if (!r.ok) {
      const e = new Error((data && (data.msg || data.error_description || data.message)) || r.statusText || "Request failed");
      e.status = r.status;
      e.code = data && (data.error_code || data.code);
      throw e;
    }
    return data;
  }

  let refreshing = null;
  function refresh() {
    if (!session) return Promise.resolve(null);
    if (refreshing) return refreshing;
    const used = session.refresh_token;
    refreshing = call("/token?grant_type=refresh_token", { refresh_token: used })
      .then((s) => { store(s); return session; })
      .catch((e) => {
        // Refresh tokens are single-use. If another tab of this site already refreshed, use its login instead of ending ours.
        const other = readStored();
        if (other && other.refresh_token !== used) { session = other; return session; }
        // A bad refresh token means the login is over. A network hiccup should not log anyone out.
        if (e.status && e.status >= 400 && e.status < 500) { session = null; persist(); ended(); }
        throw e;
      })
      .finally(() => { refreshing = null; });
    return refreshing;
  }

  // Another tab logged in, refreshed or logged out: follow it.
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    const had = !!session;
    session = readStored();
    if (had && !session) ended();
  });

  window.Auth = {
    enabled: ENABLED,
    session: () => session,
    user: () => (session && session.user) || null,
    // A valid access token, refreshed first if it is about to expire. Null when logged out.
    async token() {
      if (!session) return null;
      if (session.expires_at - Math.floor(Date.now() / 1000) < 60) {
        try { await refresh(); } catch { /* fall through with what we have, or null if the login ended */ }
      }
      return session ? session.access_token : null;
    },
    // Try to get a fresh login right now (used when the server says ours expired). Returns the session, or null if the login is over.
    async forceRefresh() {
      if (!session) return null;
      try { await refresh(); } catch { /* network trouble keeps the session; a rejected login clears it */ }
      return session;
    },
    // Sends a code. allowNew=false means "only for people who already have an account".
    // The email holds a link (and, once you've set up your own email sender, a code too).
    // The invite code rides along so it survives opening the link in a different browser.
    async sendCode(email, allowNew, invite) {
      const back = encodeURIComponent(location.origin + location.pathname);
      await call("/otp?redirect_to=" + back, { email, create_user: !!allowNew, data: invite ? { invite } : undefined });
    },
    // Clicking the emailed link lands on the site with the login in the address bar.
    // Returns null if the address isn't a login, {error} if the link failed, {ok:true} if we're now logged in.
    async fromHash(hash) {
      const h = String(hash || "").replace(/^#/, "");
      if (!/(^|&)(access_token|error)=/.test(h)) return null;
      const q = new URLSearchParams(h);
      if (q.get("error") || q.get("error_description")) return { error: q.get("error_description") || q.get("error") };
      const at = q.get("access_token"), rt = q.get("refresh_token");
      if (!at || !rt) return { error: "Missing login details" };
      const exp = Number(q.get("expires_at")) || (Math.floor(Date.now() / 1000) + (Number(q.get("expires_in")) || 3600));
      try {
        const r = await fetch(base + "/user", { headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + at } });
        const u = await r.json();
        if (!r.ok || !u.id) return { error: "That link didn't work." };
        session = { access_token: at, refresh_token: rt, expires_at: exp,
          user: { id: u.id, email: u.email, invite: (u.user_metadata && u.user_metadata.invite) || "" } };
        persist();
        return { ok: true };
      } catch { return { error: "Couldn't reach the server." }; }
    },
    async verify(email, token) {
      const s = await call("/verify", { type: "email", email, token });
      if (!s || !s.access_token) throw new Error("That code didn't work.");
      store(s);
      return session;
    },
    signOut() { session = null; persist(); }
  };
})();
