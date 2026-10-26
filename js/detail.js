// Project detail view: clicking a project's demo (or its "details" button) opens it large in a
// dialog, next to the card's text. The live demo itself moves into the dialog and back on close,
// so its script keeps running and simply rescales to the bigger box. A card can carry extra text
// for this view in <div class="more" hidden>; it is only shown here.
(() => {
  const cards = [...document.querySelectorAll(".card")].filter(c => c.querySelector(".media:not(:has(.ascii-art))"));
  if (!cards.length) return;

  const dialog = document.createElement("dialog");
  dialog.className = "detail";
  dialog.setAttribute("aria-labelledby", "detail-title");
  dialog.innerHTML = `
    <div class="detail-head">
      <h3 id="detail-title"></h3>
      <button class="detail-close" type="button"><span lang="en">[ close ]</span><span lang="nl">[ sluiten ]</span></button>
    </div>
    <div class="detail-body">
      <div class="detail-media"></div>
      <div class="detail-text"></div>
    </div>`;
  document.body.append(dialog);
  const title = dialog.querySelector("#detail-title");
  const mediaSlot = dialog.querySelector(".detail-media");
  const textSlot = dialog.querySelector(".detail-text");

  let open = null;   // { media, stand-in } while the dialog shows a card

  const show = card => {
    const media = card.querySelector(".media");
    // keep the card's layout while its demo is away
    const standIn = document.createElement("div");
    standIn.className = "media";
    standIn.setAttribute("aria-hidden", "true");
    media.replaceWith(standIn);
    mediaSlot.append(media);
    open = { media, standIn };

    title.textContent = card.querySelector("h3").textContent;
    textSlot.replaceChildren(...[...card.children]
      .filter(el => el.matches(".badge, .tagline, p, .more, .tags") || el.querySelector(".badge"))
      .map(el => {
        const copy = el.matches(".card-head") ? el.querySelector(".badge").cloneNode(true) : el.cloneNode(true);
        copy.hidden = false;
        return copy;
      }));
    dialog.showModal();
  };

  dialog.addEventListener("close", () => {
    if (!open) return;
    open.standIn.replaceWith(open.media);
    open = null;
  });
  dialog.querySelector(".detail-close").addEventListener("click", () => dialog.close());
  // a click on the dimmed backdrop (the dialog element itself, outside its content) closes it
  dialog.addEventListener("click", e => { if (e.target === dialog) dialog.close(); });

  for (const card of cards) {
    const media = card.querySelector(".media");
    // The button sits over the demo's corner but outside the figure: the figure has role="img",
    // which would hide a button inside it from screen readers.
    const wrap = document.createElement("div");
    wrap.className = "media-wrap";
    media.before(wrap);
    wrap.append(media);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "detail-open";
    btn.innerHTML = `<span lang="en">[ details ]</span><span lang="nl">[ details ]</span>`;
    btn.setAttribute("aria-haspopup", "dialog");
    btn.addEventListener("click", () => show(card));
    wrap.append(btn);
    media.addEventListener("click", () => { if (!open) show(card); });
  }
})();
