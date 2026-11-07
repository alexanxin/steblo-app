// First start (design §9): on iOS outside the installed app only install instructions, then language and name,
// then four choices: start with yourself, import GEDCOM, restore a backup, or scan a relative's tree.
import { createClock } from "../src/clock.js";
import { createTree } from "../src/tree.js";
import { randomHex } from "../src/history.js";
import { h, svg } from "./dom.js";

const mark = () => h("div", { class: "gate-mark" }, svg("svg", { viewBox: "0 0 24 24" }, svg("path", { d: "M12 21v-7m0 0-5-4m5 4 5-4M7 10V6m10 4V6" })));

export async function runStart(ctx, { storage, begin, setLanguage, screens }) {
  const { t } = ctx;
  const gate = ctx.el.gate;
  ctx.el.top.hidden = ctx.el.bottom.hidden = ctx.el.panel.hidden = true;
  const show = (...kids) => { gate.replaceChildren(h("div", { class: "gate-card" }, mark(), ...kids)); gate.hidden = false; };

  // iOS keeps the Home Screen app's storage apart from Safari's, so nothing may be entered in a Safari tab (story 2).
  if (ctx.platform.needsInstallFirst) {
    show(
      h("h1", null, "STEBLO"),
      h("p", { class: "gate-sub" }, t("start.iosTitle")),
      h("ol", { class: "steps" }, h("li", null, t("start.iosStep1")), h("li", null, t("start.iosStep2")), h("li", null, t("start.iosStep3"))),
      h("p", { class: "gate-sub" }, t("start.iosWhy")));
    return;
  }

  let name = "";
  const welcome = () => {
    const lang = h("select", { "aria-label": t("settings.language") }, ...["en", "mk"].map(v => h("option", { value: v, selected: v === ctx.i18n.lang }, t(`lang.${v}`))));
    lang.value = ctx.i18n.lang;
    lang.addEventListener("change", async () => { await setLanguage({ lang: lang.value }); welcome(); });
    const input = h("input", { value: name, maxlength: 60, autocomplete: "name", "aria-label": t("start.nameLabel") });
    const error = h("p", { class: "gate-msg", role: "alert" });
    const go = h("button", { class: "gate-btn", type: "button", on: { click: () => {
      const value = input.value.replace(/\s+/g, " ").trim();
      if (value === "" || [...value].length > 60) { error.textContent = t("start.nameNeeded"); return; }
      name = value;
      choices();
    } } }, t("common.next"));
    input.addEventListener("keydown", e => { if (e.key === "Enter") go.click(); });
    const latin = h("input", { type: "checkbox", checked: ctx.i18n.latin });
    latin.addEventListener("change", async () => { await setLanguage({ latin: latin.checked }); welcome(); });
    show(
      h("h1", null, "STEBLO"), h("p", { class: "gate-sub" }, t("start.welcome")),
      h("div", { class: "gate-form" },
        h("label", { class: "field" }, h("span", null, t("settings.language")), lang),
        ctx.i18n.lang === "mk" ? h("label", { class: "check" }, latin, h("span", null, t("settings.latin"))) : null,
        h("label", { class: "field" }, h("span", null, t("start.nameLabel")), input), h("p", { class: "note" }, t("start.nameHelp")), error),
      go,
      ctx.installPrompt ? h("button", { class: "gate-btn quiet", type: "button", on: { click: () => ctx.installPrompt.prompt() } }, t("start.install")) : null);
    input.focus();
  };

  /** Make this phone's identity and open the app (the first commit), then hand over to the chosen path. */
  async function createDevice() {
    const device = randomHex(8);
    const tree = createTree({ device, name: "", records: new Map(), clock: createClock() });
    const change = tree.setDeviceName(name);
    change.meta = { ...change.meta, device, name, settings: { lang: ctx.i18n.lang, latin: ctx.i18n.latin } };
    await storage.commit(change);
    await begin(await storage.load());
  }

  async function chosen(run) {
    try {
      await createDevice();
    } catch (err) {
      console.error(err);
      ctx.notify(t("save.failed"), { kind: "error", sticky: true });
      return;
    }
    await run();
  }

  async function startWithMyself() {
    const words = name.split(" ");
    const fields = words.length > 1 ? { g: words[0], s: words.slice(1).join(" ") } : { g: name };
    const change = ctx.tree.addPerson(fields);
    const [id] = change.puts.keys();
    change.meta = { ...change.meta, thisIsMe: id };
    if (await ctx.act(change)) { ctx.show(id); ctx.notify(t("start.ready")); }
  }

  const choices = () => {
    const choice = (title, text, onClick, disabled = false) => h("button", { class: "gate-choice", type: "button", disabled, on: { click: onClick } }, h("b", null, title), h("span", null, text));
    show(
      h("h1", null, t("start.choicesTitle")), h("p", { class: "gate-sub" }, t("start.choicesText", { name })),
      h("div", { class: "gate-choices" },
        choice(t("start.myself"), t("start.myselfText"), () => chosen(startWithMyself)),
        choice(t("start.gedcom"), t("start.gedcomText"), () => chosen(() => screens.gedcomImport())),
        choice(t("start.restore"), t("start.restoreText"), () => chosen(() => screens.restore())),
        choice(t("start.scan"), t("start.scanText"), () => chosen(() => ctx.sync.start()))),
      h("button", { class: "gate-btn quiet", type: "button", on: { click: welcome } }, t("common.back")));
  };

  welcome();
}
