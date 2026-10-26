// Plays the garage-app recordings (projects section) one after the other: the phone clip, a short
// hold on its last frame, then the PC clip in the browser window (.pc), and back. The loop only
// runs while the card is on screen; with reduced motion the phone's poster frame stays put.
(() => {
  const fig = document.querySelector(".gd");
  if (!fig || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const phone = fig.querySelector(".gd-ph"), pc = fig.querySelector(".gd-pc");
  const HOLD = 900;   // ms on each clip's last frame before switching

  let current = phone, visible = false, timer = 0;
  const play = () => { if (visible) current.play().catch(() => {}); };
  const next = () => {
    current = current === phone ? pc : phone;
    current.currentTime = 0;
    fig.classList.toggle("pc", current === pc);
    play();
  };
  [phone, pc].forEach(v => v.addEventListener("ended", () => { timer = setTimeout(next, HOLD); }));

  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) { phone.preload = pc.preload = "auto"; if (current.ended) next(); else play(); }
    else { clearTimeout(timer); current.pause(); }
  }, { threshold: 0.3 }).observe(fig);
})();
