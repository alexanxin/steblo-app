// The full-screen layer that sync and join screens draw into. One screen at a time, always with a Cancel
// (or Close) button in the header, so a sync can be left from every screen (R6).
import { h } from "./dom.js";

export function createOverlay(ctx) {
  const root = document.getElementById("sync");
  const title = h("h1", { id: "sync-title" });
  const cancel = h("button", { class: "btn-ghost", type: "button" });
  const body = h("div", { class: "sync-body edit" });
  const foot = h("footer", { class: "sync-foot" });
  root.replaceChildren(h("section", { class: "sync-card", role: "dialog", "aria-modal": "true", "aria-labelledby": "sync-title" },
    h("header", { class: "sync-head" }, title, cancel), body, foot));
  let onCancel = null;
  cancel.addEventListener("click", () => onCancel?.());

  return {
    get open() { return !root.hidden; },
    /** Draw a screen. `cancelLabel` is "Cancel" while a sync can still be stopped and "Close" at the end. */
    show({ title: text, body: nodes = [], foot: buttons = [], onCancel: handler = null, cancelLabel = ctx.t("common.cancel") }) {
      title.textContent = text;
      cancel.textContent = cancelLabel;
      cancel.hidden = !handler;
      onCancel = handler;
      body.replaceChildren(...[nodes].flat().filter(Boolean));
      foot.replaceChildren(...buttons.filter(Boolean));
      foot.hidden = buttons.filter(Boolean).length === 0;
      root.hidden = false;
      body.scrollTop = 0;
    },
    hide() {
      root.hidden = true;
      onCancel = null;
      body.replaceChildren();
      foot.replaceChildren();
    },
  };
}
