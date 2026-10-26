// Animated walk-through of the FAQ chatbot widget in the projects section, rebuilt from its
// screenshots: open the widget → FAQ list → "Ask AI" → type the question → answer → close.
// Texts are the ones in the screenshots. It plays only while on screen; visitors who prefer
// reduced motion get the final chat as a still (that's what the HTML shows by default).
(() => {
  const demo = document.querySelector(".wd");
  if (!demo) return;
  const box = demo.parentElement;
  const log = demo.querySelector(".wd-log");
  const input = demo.querySelector(".wd-typed");
  const QUESTION = "Explain to me shortly how to expand my business.";
  const ANSWER = "To expand your business, consider the following strategies:\n\n" +
    "1. Market Research: Identify new markets or demographics.\n" +
    "2. Diversification: Introduce new products or services.";

  // The widget is built at 525×530 (the screenshots' size); scale its visible part
  // (500×514: panel plus launcher) to fit the card, with a small breathing margin.
  const fit = () => demo.style.setProperty("--k", 0.96 * Math.min(box.clientWidth / 500, box.clientHeight / 514));
  new ResizeObserver(fit).observe(box);
  fit();

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  // Pause between steps while the card is off screen or the tab is hidden.
  let visible = false;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.4 }).observe(box);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const wait = async ms => { await sleep(ms); while (!visible || document.hidden) await sleep(250); };

  const press = async cls => { demo.classList.add(cls); await wait(220); demo.classList.remove(cls); };
  const say = (who, text) => {
    const msg = document.createElement("div");
    msg.className = `wd-msg wd-${who}`;
    msg.textContent = text;
    log.append(msg);
  };

  (async () => {
    for (;;) {
      demo.classList.remove("open", "typing");
      await wait(900);
      log.textContent = "";
      input.textContent = "";
      demo.dataset.view = "faq";
      await press("press-launcher");
      demo.classList.add("open");
      await wait(1700);
      await press("press-ask");
      demo.dataset.view = "chat";
      await wait(700);
      demo.classList.add("typing");
      for (const ch of QUESTION) { input.textContent += ch; await wait(42); }
      await wait(450);
      demo.classList.remove("typing");
      input.textContent = "";
      say("user", QUESTION);
      await wait(1300);
      say("bot", ANSWER);
      await wait(4500);
    }
  })();
})();
