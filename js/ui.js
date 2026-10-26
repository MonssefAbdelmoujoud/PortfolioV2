// Page controls: theme toggle, language toggle, and the scroll veil over the ocean.
// The starting language and theme are already set by the inline script in <head>.
(() => {
  const root = document.documentElement;
  const darkQuery = matchMedia("(prefers-color-scheme: dark)");
  const save = (key, value) => { try { localStorage.setItem(key, value); } catch {} };

  // ── theme ───────────────────────────────────────────────────────
  // An explicit choice lives in data-theme; without one the system setting applies.
  // ocean.js listens for "themechange" to repaint the animation in the new colours.
  const currentTheme = () => root.dataset.theme || (darkQuery.matches ? "dark" : "light");
  // Switching theme fades the colours over 180 ms instead of jumping: .theme-fade switches on
  // the CSS colour transitions for just the length of the switch, and ocean.js cross-fades
  // the pond on "themechange". With reduced motion the CSS turns the fade off.
  let fadeTimer;
  const fadeColours = () => {
    root.classList.add("theme-fade");
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => root.classList.remove("theme-fade"), 250);
  };
  // Clicks during a running switch are ignored. A second switch halfway through would make
  // the CSS colours reverse from where they are (and finish early) while the pond starts a
  // fresh 180 ms fade, so solid boxes like the socials bar would visibly drift out of step
  // with the pond. It also keeps fast clicking from flashing the whole page.
  let switching = false;
  document.getElementById("theme").addEventListener("click", () => {
    if (switching) return;
    switching = true;
    setTimeout(() => { switching = false; }, 200);
    fadeColours();
    root.dataset.theme = currentTheme() === "dark" ? "light" : "dark";
    save("theme", root.dataset.theme);
    document.dispatchEvent(new Event("themechange"));
  });
  // The system switching dark/light by itself fades the same way (no explicit choice saved).
  darkQuery.addEventListener("change", () => { fadeColours(); document.dispatchEvent(new Event("themechange")); });

  // ── language ────────────────────────────────────────────────────
  const langBtn = document.getElementById("lang");
  const showLang = () => {
    const nl = root.dataset.lang === "nl";
    langBtn.querySelectorAll("[data-l]").forEach(s => s.classList.toggle("on", s.dataset.l === root.dataset.lang));
    // Image descriptions: alt (or aria-label on animated media) holds English, data-alt-nl Dutch.
    document.querySelectorAll("[data-alt-nl]").forEach(el => {
      const attr = el.tagName === "IMG" ? "alt" : "aria-label";
      el.dataset.altEn ??= el.getAttribute(attr);
      el.setAttribute(attr, nl ? el.dataset.altNl : el.dataset.altEn);
    });
  };
  showLang();
  langBtn.addEventListener("click", () => {
    root.dataset.lang = root.lang = root.dataset.lang === "nl" ? "en" : "nl";
    save("lang", root.dataset.lang);
    showLang();
  });

  // ── scroll veil ─────────────────────────────────────────────────
  // --veil goes 0 → 1 over the first ~60% of a screen; the CSS uses it to blur and dim the ocean.
  let veil = -1;
  const updateVeil = () => {
    const v = Math.round(Math.min(1, Math.max(0, scrollY / (innerHeight * 0.6))) * 100) / 100;
    if (v !== veil) { veil = v; root.style.setProperty("--veil", v); }
  };
  addEventListener("scroll", updateVeil, { passive: true });
  updateVeil();

  // ── email links ─────────────────────────────────────────────────
  // The address never appears whole in the HTML (bots read the source, not the screen):
  // each link stores its two halves and only becomes a real mailto: link once a person
  // points at it, focuses it or taps it. Without JS the link falls back to #contact.
  document.querySelectorAll("a.mail").forEach(a => {
    const arm = () => { a.href = "mailto:" + a.dataset.u + "@" + a.dataset.d; };
    ["pointerenter", "focus", "touchstart", "mousedown"].forEach(ev => a.addEventListener(ev, arm, { once: true, passive: true }));
  });

  // ── project videos ──────────────────────────────────────────────
  // Clips play only while at least half visible, so off-screen videos cost nothing.
  // Visitors who prefer reduced motion get the poster plus play controls instead of autoplay.
  const videos = document.querySelectorAll(".media:not(.gd) video");   // .gd runs its own sequence
  if (videos.length) {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) videos.forEach(v => { v.controls = true; });
    else {
      const io = new IntersectionObserver(entries => entries.forEach(({ target, isIntersecting }) => {
        if (isIntersecting) target.play().catch(() => {}); else target.pause();
      }), { threshold: 0.5 });
      videos.forEach(v => io.observe(v));
    }
  }
})();
