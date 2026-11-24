// Card looks: the 10 title styles, color math, and the readability rules.
// The same rules run in the designer (to stop you saving an unreadable card)
// and when drawing any card (an unreadable card from anyone is shown in the normal look instead).
(() => {
  "use strict";
  const DEFAULT = { t: 0, bg: "#fdf6dc", fg: "#1d1a14", tc: "#1d1a14" };
  const TITLE_STYLES = ["Marker", "Typewriter", "Block", "Outline", "Script", "Pixel", "Fade", "Slanted", "Stamp", "Double"];
  const MIN_TEXT = 4.5;   // body text against the card color
  const MIN_TITLE = 3;    // big title against the card color
  const HEX = /^#[0-9a-fA-F]{6}$/;

  const norm = (h) => String(h).toLowerCase();
  function toRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function toHex(r, g, b) {
    const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    return "#" + c(r) + c(g) + c(b);
  }
  function lum(hex) {
    const [r, g, b] = toRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function ratio(a, b) {
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(100, s)) / 100; l = Math.max(0, Math.min(100, l)) / 100;
    const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return toHex(f(0) * 255, f(8) * 255, f(4) * 255);
  }
  function hexToHsl(hex) {
    const [r, g, b] = toRgb(hex).map((v) => v / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0, s = 0; const l = (max + min) / 2;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [h, s * 100, l * 100];
  }

  function valid(st) {
    return !!st && typeof st === "object" && Number.isInteger(st.t) && st.t >= 0 && st.t < TITLE_STYLES.length
      && HEX.test(st.bg) && HEX.test(st.fg) && HEX.test(st.tc);
  }
  const textOk = (st) => ratio(st.fg, st.bg) >= MIN_TEXT;
  const titleOk = (st) => ratio(st.tc, st.bg) >= MIN_TITLE;
  const readable = (st) => valid(st) && textOk(st) && titleOk(st);

  // Nudge a color's lightness (keeping its hue) until it reads against bg.
  function fix(color, bg, min) {
    if (ratio(color, bg) >= min) return color;
    const [h, s, l] = hexToHsl(color);
    const towardWhite = ratio("#ffffff", bg) >= ratio("#000000", bg);
    for (let i = 0; i <= 100; i++) {
      const next = hslToHex(h, s, towardWhite ? Math.min(100, l + i) : Math.max(0, l - i));
      if (ratio(next, bg) >= min) return next;
    }
    return towardWhite ? "#ffffff" : "#000000";
  }

  // Put a look on a card element. Returns the title style number, or -1 for the normal look.
  function apply(el, st) {
    if (!readable(st)) {
      el.removeAttribute("data-styled");
      for (const v of ["--cbg", "--cfg", "--ctc"]) el.style.removeProperty(v);
      return -1;
    }
    el.setAttribute("data-styled", "1");
    el.style.setProperty("--cbg", norm(st.bg));
    el.style.setProperty("--cfg", norm(st.fg));
    el.style.setProperty("--ctc", norm(st.tc));
    return st.t;
  }

  window.CardStyle = { DEFAULT, TITLE_STYLES, MIN_TEXT, MIN_TITLE, valid, readable, textOk, titleOk, ratio, fix, apply, hslToHex, hexToHsl, HEX };
})();
