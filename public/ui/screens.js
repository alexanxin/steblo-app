// The other screens: menu, Needs attention, History, Settings, backup, restore, GEDCOM, duplicates.
import { writeBackup, validateBackup, restoreBackup } from "../src/backup.js";
import { importGedcom, exportGedcom } from "../src/gedcom.js";
import { duplicatesAround } from "../src/join.js";
import { randomHex } from "../src/history.js";
import { h } from "./dom.js";

const HEX16 = /^[0-9a-f]{16}$/;
const MB = 1024 * 1024;

export function createScreens(ctx, forms) {
  const { t } = ctx;
  const { btn } = forms;
  const row = (...kids) => h("div", { class: "btn-row" }, ...kids);
  const section = (title, ...kids) => h("section", { class: "sec" }, title ? h("h2", null, title) : null, ...kids);
  const note = text => h("p", { class: "note" }, text);

  // ---------- files
  function today() { return new Date().toISOString().slice(0, 10); }

  /** Save a text file: the share sheet on a touch phone (the only way on iOS), a download elsewhere. */
  async function saveFile(name, text, type) {
    const file = new File([text], name, { type });
    if (navigator.maxTouchPoints > 0 && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return true; } catch (err) { if (err?.name === "AbortError") return false; }
    }
    const url = URL.createObjectURL(file);
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  }

  /** Pick a file. The input must be made inside the tap that asked for it. */
  function chooseFile(accept) {
    return new Promise(resolve => {
      const input = h("input", { type: "file", accept, hidden: true });
      input.addEventListener("change", () => { resolve(input.files[0] || null); input.remove(); });
      input.addEventListener("cancel", () => { resolve(null); input.remove(); });
      document.body.append(input);
      input.click();
    });
  }

  // ---------- menu
  function menu() {
    const count = ctx.attentionCount(ctx.view);
    const go = fn => () => { ctx.closeSheet(); fn(); };
    ctx.openSheet({
      title: t("menu.title"),
      body: h("div", { class: "menu-list" },
        h("button", { class: "menu-row", type: "button", on: { click: go(() => ctx.sync.start()) } }, h("b", null, t("sync.menu"))),
        h("button", { class: "menu-row", type: "button", on: { click: go(() => forms.addFirst(true)) } }, h("b", null, t("menu.addPerson"))),
        h("button", { class: "menu-row", type: "button", on: { click: go(() => attention()) } }, h("b", null, t("attention.title")), count ? h("span", { class: "badge-inline" }, String(count)) : null),
        h("button", { class: "menu-row", type: "button", on: { click: go(() => history()) } }, h("b", null, t("history.title"))),
        h("button", { class: "menu-row", type: "button", on: { click: go(() => settings()) } }, h("b", null, t("settings.title")))),
    });
  }

  // ---------- Needs attention
  function attention() {
    const view = ctx.view;
    const a = view.attention;
    const body = [];
    const person = (id, extra) => h("div", { class: "list-row" }, h("span", { class: "grow" }, ctx.label(id)), extra);
    const show = id => btn(t("attention.show"), () => { ctx.closeSheet(); ctx.show(id); });

    if (a.manyParents.length) {
      body.push(section(t("attention.manyParents"), note(t("attention.manyParentsHelp")), ...a.manyParents.map(id => {
        const parents = view.parentLinks.filter(l => l.child === id).map(l => l.parent);
        return h("div", { class: "list-block" }, person(id, show(id)), ...parents.map(p => h("div", { class: "list-row sub-row" }, h("span", { class: "grow" }, ctx.label(p)),
          btn(t("attention.unlink"), async () => { if (await ctx.act(ctx.tree.unlink("parent", p, id))) attention(); }))));
      })));
    }
    if (a.loops.length) body.push(section(t("attention.loops"), note(t("attention.loopsHelp")), ...a.loops.map(id => person(id, show(id)))));
    if (a.partlyErased.length) {
      body.push(section(t("attention.partlyErased"), note(t("attention.partlyErasedHelp")), ...a.partlyErased.map(p => h("div", { class: "list-row" },
        h("span", { class: "grow" }, ctx.text(`${p.f.g || "?"} ${p.f.s || ""}`.trim())),
        btn(t("attention.eraseRest"), async () => { if (await ctx.act(ctx.tree.eraseRest(p.id))) attention(); }, "danger")))));
    }
    if (a.separate.length) {
      const joinFrom = groups => () => { ctx.closeSheet(); ctx.join.fromGroups(groups); };
      body.push(section(t("attention.separate"), note(t("attention.separateHelp")),
        row(btn(t("join.continue"), joinFrom(a.separate), "primary")),
        ...a.separate.slice(0, 100).map(g => {
          const first = g.ids[0];
          return h("div", { class: "list-row" }, h("span", { class: "grow" }, `${ctx.label(first)} · ${t("attention.groupSize", { n: g.size })}`), show(first), btn(t("join.fromAttention"), joinFrom([g])));
        })));
    }
    if (body.length === 0) body.push(note(t("attention.none")));
    ctx.openSheet({ title: t("attention.title"), body: h("div", { class: "edit" }, ...body), foot: [btn(t("common.close"), () => ctx.closeSheet())] });
  }

  // ---------- History
  const deviceName = id => {
    if (id === ctx.meta.device) return t("history.thisPhone");
    const nm = ctx.tree.records().get(`d:${id}`)?.f.nm?.[0];
    return nm ? ctx.text(nm) : t("history.otherPhone");
  };
  const timeText = at => new Date(at).toLocaleString(ctx.i18n.lang === "mk" ? "mk" : undefined, { dateStyle: "medium", timeStyle: "short" });

  function history(personId = null, shown = 60) {
    const view = ctx.view;
    const canonical = personId ? (view.merged.get(personId) ?? personId) : null;
    const all = ctx.history.filter(g => !canonical || g.people.some(p => (view.merged.get(p) ?? p) === canonical));
    const groups = [...all].reverse();
    const body = [];
    if (ctx.historyDropped) body.push(note(t("history.dropped")));
    if (!personId && view.deleted.size) {
      body.push(section(t("history.deleted"), ...[...view.deleted.values()].slice(0, 100).map(p => h("div", { class: "list-row" },
        h("span", { class: "grow" }, ctx.label(p.id)),
        btn(t("history.restore"), async () => { if (await ctx.act(ctx.tree.restorePerson(p.id))) history(personId, shown); })))));
    }
    if (groups.length === 0) body.push(note(t("history.none")));
    for (const g of groups.slice(0, shown)) body.push(historyRow(g, personId, shown));
    if (groups.length > shown) body.push(btn(t("history.more"), () => history(personId, shown + 60)));
    ctx.openSheet({
      title: personId ? t("history.titleOf", { name: ctx.name(personId) }) : t("history.title"),
      body: h("div", { class: "edit" }, ...body),
      foot: [btn(t("common.close"), () => ctx.closeSheet())],
    });
  }

  function historyRow(g, personId, shown) {
    const created = g.changes.filter(c => c.created && HEX16.test(c.r)).length;
    const edits = g.changes.filter(c => c.f).length;
    const names = g.people.filter(p => ctx.view.people.has(ctx.view.merged.get(p) ?? p) || ctx.view.deleted.has(p)).slice(0, 3).map(p => ctx.name(ctx.view.merged.get(p) ?? p));
    const bits = [];
    if (created) bits.push(t("history.created", { n: created }));
    if (edits) bits.push(t("history.edited", { n: edits }));
    const lost = g.lost?.length ? h("details", { class: "lost" }, h("summary", null, t("history.lost", { n: g.lost.length })),
      ...g.lost.map(l => h("div", { class: "note" }, `${l.f}: ${JSON.stringify(l.loser[0])} → ${JSON.stringify(l.winner[0])}`))) : null;
    const undoable = g.action !== "erase" && g.action !== "undo" && !(g.changes.length === 0);
    return h("div", { class: "history-row" },
      h("div", { class: "history-main" },
        h("b", null, t(`history.action.${g.action}`)), " ", h("span", { class: "dim" }, `${timeText(g.at)} · ${deviceName(g.device)}`),
        names.length ? h("div", { class: "note" }, names.join(", ")) : null,
        bits.length ? h("div", { class: "note" }, bits.join(" · ")) : null, lost),
      undoable ? btn(t("history.undo"), () => confirmUndo(g, personId, shown)) : null);
  }

  function confirmUndo(g, personId, shown) {
    const created = g.changes.filter(c => c.created && HEX16.test(c.r)).length;
    const edits = g.changes.filter(c => c.f).length;
    const reaches = g.action === "sync" || g.action === "import";
    ctx.openSheet({
      title: t("history.undoTitle"),
      body: h("div", { class: "edit" },
        h("p", { class: "ask" }, t(`history.action.${g.action}`), " · ", timeText(g.at)),
        reaches ? h("p", { class: "ask" }, t("history.undoSyncWarning", { people: created, details: edits })) : null,
        note(t("history.undoReaches"))),
      foot: [
        btn(t("history.undo"), async () => {
          try {
            const change = ctx.tree.undo(g);
            const ok = await ctx.act(change);
            if (ok) { history(personId, shown); ctx.notify(change.skipped ? t("history.undoneSkipped", { n: change.skipped }) : t("history.undone")); }
          } catch (err) { ctx.notify(err.code === "refused" ? t("history.cannotUndo") : t("error.generic"), { kind: "error" }); }
        }, "primary"),
        btn(t("common.cancel"), () => history(personId, shown)),
      ],
    });
  }

  // ---------- backup, restore, GEDCOM
  function backup() {
    ctx.openSheet({
      title: t("backup.title"),
      body: h("div", { class: "edit" }, h("p", { class: "ask" }, t("backup.warning")), note(t("backup.where"))),
      foot: [
        btn(t("backup.save"), async () => {
          const text = writeBackup({ records: ctx.tree.records(), meta: ctx.meta, history: ctx.history, createdAt: Date.now() });
          if (await saveFile(`steblo-backup-${today()}.json`, text, "application/json")) {
            await ctx.act({ puts: new Map(), group: null, meta: { lastBackup: Date.now() } });
            ctx.closeSheet();
            ctx.notify(t("backup.saved"));
          }
        }, "primary"),
        btn(t("common.cancel"), () => ctx.closeSheet()),
      ],
    });
  }

  /** The newer-data screen: whatever is stored, as a file, with no checks (R14). */
  async function saveRawBackup() {
    try {
      const raw = await ctx.storage.exportRaw();
      await saveFile(`steblo-raw-${today()}.json`, JSON.stringify({ format: "steblo-raw", ...raw }), "application/json");
    } catch (err) {
      console.error(err);
    }
  }

  async function restore() {
    const file = await chooseFile("application/json,.json");
    if (!file) return;
    if (file.size > 50 * MB) { ctx.notify(t("restore.tooBig"), { kind: "error" }); return; }
    const verdict = validateBackup(await file.text());
    if (!verdict.ok) {
      ctx.openSheet({
        title: t("restore.refusedTitle"),
        body: h("div", { class: "edit" }, h("p", { class: "ask" }, t("restore.refused")), h("ul", { class: "problems" }, ...verdict.errors.slice(0, 12).map(e => h("li", null, `${e.where}: ${e.reason}`)))),
        foot: [btn(t("common.close"), () => ctx.closeSheet())],
      });
      return;
    }
    const valid = verdict.valid;
    const people = [...valid.records.values()].filter(r => r.kind === "person").length;
    const doRestore = async () => {
      try {
        const state = restoreBackup(valid, { device: randomHex(8), name: ctx.meta.name });
        await ctx.storage.restore(state);
        ctx.closeSheet(false);
        await ctx.adoptState({ ...state, historyDropped: false });
        ctx.notify(t("restore.done", { n: people }));
      } catch (err) {
        ctx.notify(t("save.failed"), { kind: "error", sticky: true });
        console.error(err);
      }
    };
    ctx.openSheet({
      title: t("restore.title"),
      body: h("div", { class: "edit" }, h("p", { class: "ask" }, t("restore.confirm", { people, date: new Date(valid.createdAt).toLocaleDateString() })), note(t("restore.replaces"))),
      foot: [
        ctx.tree.view().people.size > 0 ? btn(t("restore.saveFirst"), async () => { await saveFile(`steblo-backup-${today()}.json`, writeBackup({ records: ctx.tree.records(), meta: ctx.meta, history: ctx.history, createdAt: Date.now() }), "application/json"); }) : null,
        btn(t("restore.go"), doRestore, "danger"),
        btn(t("common.cancel"), () => ctx.closeSheet()),
      ],
    });
  }

  async function gedcomImport() {
    const file = await chooseFile(".ged,.gedcom,text/plain");
    if (!file) return;
    let result;
    try {
      result = await importGedcom(ctx.tree, new Uint8Array(await file.arrayBuffer()), { now: Date.now() });
    } catch (err) {
      ctx.openSheet({
        title: t("gedcom.failedTitle"),
        body: h("div", { class: "edit" }, h("p", { class: "ask" }, err.code === "encoding" ? t("gedcom.encoding") : err.code === "size" ? t("gedcom.size") : t("gedcom.failed"))),
        foot: [btn(t("common.close"), () => ctx.closeSheet())],
      });
      return;
    }
    const s = result.summary;
    const notKept = Object.entries(s.notKept).sort((x, y) => y[1] - x[1]);
    const lines = [
      t("gedcom.newPeople", { n: s.newPeople }), t("gedcom.newLinks", { n: s.newLinks }),
      s.matched ? t("gedcom.matched", { n: s.matched }) : null, s.filled ? t("gedcom.filled", { n: s.filled }) : null,
      s.skipped ? t("gedcom.skipped", { n: s.skipped }) : null, s.cut ? t("gedcom.cut", { n: s.cut }) : null,
      s.htmlRemoved ? t("gedcom.html", { n: s.htmlRemoved }) : null, s.controlRemoved ? t("gedcom.control", { n: s.controlRemoved }) : null,
      s.rejected ? t("gedcom.rejected", { n: s.rejected }) : null, s.badLines ? t("gedcom.badLines", { n: s.badLines }) : null,
    ].filter(Boolean);
    const nothing = result.change.puts.size === 0;
    ctx.openSheet({
      title: t("gedcom.summaryTitle"),
      body: h("div", { class: "edit" },
        h("ul", { class: "problems" }, ...lines.map(l => h("li", null, l))),
        notKept.length ? section(t("gedcom.notKept"), h("p", { class: "note" }, notKept.map(([tag, n]) => `${tag} ${n}`).join(", "))) : null,
        result.newGroups.length ? note(t("gedcom.joinLater")) : null),
      foot: [
        nothing ? null : btn(t("gedcom.add"), async () => { if (await ctx.act(result.change)) { ctx.closeSheet(); ctx.notify(t("gedcom.done", { n: s.newPeople })); ctx.join.afterImport(result); } }, "primary"),
        btn(nothing ? t("common.close") : t("common.cancel"), () => ctx.closeSheet()),
      ],
    });
  }

  function gedcomExport() {
    ctx.openSheet({
      title: t("gedcom.exportTitle"),
      body: h("div", { class: "edit" }, h("p", { class: "ask" }, t("gedcom.exportWarning"))),
      foot: [
        btn(t("gedcom.exportGo"), async () => {
          const text = exportGedcom(ctx.tree.view(), new Date());
          if (await saveFile(`steblo-${today()}.ged`, text, "text/plain")) { ctx.closeSheet(); ctx.notify(t("gedcom.exported")); }
        }, "primary"),
        btn(t("common.cancel"), () => ctx.closeSheet()),
      ],
    });
  }

  // ---------- duplicates around a person
  function duplicates(id) {
    const found = duplicatesAround(ctx.tree, id);
    const body = found.length === 0 ? [note(t("dup.none"))] : found.map(d => h("div", { class: "list-block" },
      h("div", { class: "note" }, t(`dup.${d.relation}`)),
      h("div", { class: "list-row" }, h("span", { class: "grow" }, `${ctx.label(d.a)}  =  ${ctx.label(d.b)}`)),
      row(
        btn(t("same.merge"), async () => { if (await ctx.act(ctx.tree.merge(d.a, d.b, {}))) duplicates(id); }, "primary"),
        btn(t("dup.notSame"), async () => { if (await ctx.act(ctx.tree.notSame(d.a, d.b))) duplicates(id); }))));
    ctx.openSheet({ title: t("dup.title", { name: ctx.name(id) }), body: h("div", { class: "edit" }, ...body), foot: [btn(t("common.close"), () => ctx.closeSheet())] });
  }

  // ---------- settings
  async function settings() {
    const persisted = await ctx.persisted();
    const age = ctx.daysSinceBackup();
    const name = forms.text(ctx.meta.name, { maxlength: 60, "aria-label": t("settings.name") });
    const nameError = forms.errorLine();
    const lang = forms.select(["en", "mk"], ctx.i18n.lang, v => t(`lang.${v}`));
    lang.addEventListener("change", async () => { await ctx.setSettings({ lang: lang.value }); settings(); });
    const latin = h("input", { type: "checkbox", checked: ctx.i18n.latin });
    latin.addEventListener("change", async () => { await ctx.setSettings({ latin: latin.checked }); settings(); });
    const me = ctx.meta.thisIsMe ? (ctx.view.merged.get(ctx.meta.thisIsMe) ?? ctx.meta.thisIsMe) : null;
    const body = h("div", { class: "edit" },
      section(t("settings.name"), forms.field("settings.nameHelp", name), nameError,
        btn(t("common.save"), async () => {
          try {
            if (await ctx.act(ctx.tree.setDeviceName(name.value))) { forms.showError(nameError, ""); ctx.notify(t("settings.nameSaved")); }
          } catch { forms.showError(nameError, t("error.invalid")); }
        })),
      section(t("settings.language"), lang, h("label", { class: "check" }, latin, h("span", null, t("settings.latin")))),
      section(t("settings.me"), note(me && ctx.view.people.has(me) ? ctx.name(me) : t("settings.meNone")), note(t("settings.meHelp"))),
      section(t("settings.backup"),
        note(age === null ? t("settings.backupNever") : t("settings.backupAge", { days: age })),
        row(btn(t("backup.save"), () => backup(), "primary"), btn(t("restore.button"), () => restore()))),
      section(t("settings.gedcom"), row(btn(t("gedcom.importButton"), () => gedcomImport()), btn(t("gedcom.exportButton"), () => gedcomExport()))),
      section(t("settings.storage"),
        note(persisted === true ? t("settings.persisted") : persisted === false ? t("settings.notPersisted") : t("settings.persistUnknown")),
        ctx.lastRedraw.ms !== undefined ? note(t("settings.redraw", { ms: Math.round(ctx.lastRedraw.ms), n: ctx.lastRedraw.people })) : null,
        ctx.installPrompt ? btn(t("start.install"), async () => { await ctx.installPrompt.prompt(); }) : null),
      note(t("settings.about")));
    ctx.openSheet({ title: t("settings.title"), body, foot: [btn(t("common.close"), () => ctx.closeSheet())] });
  }

  return { menu, attention, history, settings, backup, restore, gedcomImport, gedcomExport, duplicates, saveRawBackup, saveFile, chooseFile };
}
