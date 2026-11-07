// The card menu and the forms: edit, add a relative, link, marriage, delete, erase, This is me, Same person as…
import { validateField } from "../src/records.js";
import { baseSurname, formFor, matchKey } from "../src/names.js";
import { blockReasons } from "../src/join.js";
import { searchPeople } from "../src/search.js";
import { h, clear } from "./dom.js";

const QUALIFIERS = ["", "abt", "bef", "aft", "est"];
const SEXES = ["", "M", "F", "X", "U"];

export function createForms(ctx) {
  const { t } = ctx;
  const menuEl = ctx.el.ctx;
  let menu = null;
  let closeTimer = 0;

  // ---------- small form pieces
  const field = (labelKey, input, hint, vars) => h("label", { class: "field" }, h("span", null, t(labelKey, vars)), input, hint ? h("small", { class: "hint" }, hint) : null);
  const text = (value = "", attrs = {}) => h("input", { value: value ?? "", autocomplete: "off", ...attrs });
  const select = (options, value, labelOf) => {
    const el = h("select", null, ...options.map(o => h("option", { value: o }, labelOf(o))));
    el.value = value ?? "";
    return el;
  };
  const btn = (label, onClick, cls = "") => h("button", { class: `btn-ghost ${cls}`.trim(), type: "button", on: { click: onClick } }, label);
  const errorLine = () => h("p", { class: "form-error", role: "alert", hidden: true });
  const showError = (node, message) => { node.textContent = message || ""; node.hidden = !message; };
  const errorText = err => {
    if (err?.code === "invalid") return t("error.invalid");
    if (err?.code === "state") return t("error.state");
    if (err?.code === "missing") return t("error.missing");
    if (err?.code === "refused") return t("error.refused");
    return t("error.generic");
  };

  /** A partial date: qualifier, day, month, year, and free wording (story 12). */
  function dateField(labelKey, date) {
    const q = select(QUALIFIERS, date?.q ?? "", v => (v ? t(`date.${v}`) : t("date.exact")));
    const d = text(date?.d ?? "", { inputmode: "numeric", maxlength: 2, "aria-label": t("date.day"), placeholder: t("date.day") });
    const m = text(date?.m ?? "", { inputmode: "numeric", maxlength: 2, "aria-label": t("date.month"), placeholder: t("date.month") });
    const y = text(date?.y ?? "", { inputmode: "numeric", maxlength: 4, "aria-label": t("date.year"), placeholder: t("date.year") });
    const free = text(date?.t ?? "", { maxlength: 60, "aria-label": t("date.words"), placeholder: t("date.words") });
    const node = h("div", { class: "field date" }, h("span", null, t(labelKey)), q, h("div", { class: "date-row" }, d, m, y), free);
    return {
      node,
      /** → { ok, value } with value a date object or null */
      read(key = "bd") {
        const num = el => (el.value.trim() === "" ? undefined : Number(el.value.trim()));
        const value = {};
        const dy = num(y);
        const dm = num(m);
        const dd = num(d);
        if (dy !== undefined) value.y = dy;
        if (dm !== undefined) value.m = dm;
        if (dd !== undefined) value.d = dd;
        if (q.value) value.q = q.value;
        if (free.value.trim()) value.t = free.value.trim();
        if (Object.keys(value).length === 0) return { ok: true, value: null };
        const checked = validateField(key === "md" || key === "ed" ? "partner" : "person", key, value);
        return checked.ok ? { ok: true, value: checked.value } : { ok: false };
      },
    };
  }

  // ---------- the person form (edit and add)
  function personForm({ title, values = {}, prefillSurname = null, sexHint = "", extra = [], extraRead = null, submitLabel, onSubmit }) {
    const given = text(values.g, { maxlength: 80 });
    const surname = text(values.s ?? prefillSurname ?? "", { maxlength: 80 });
    const birthSurname = text(values.bs, { maxlength: 80 });
    const sex = select(SEXES, values.sx ?? sexHint, v => (v ? t(`sex.${v}`) : t("sex.none")));
    const born = dateField("person.born", values.bd);
    const bornPlace = text(values.bp, { maxlength: 120 });
    const deceased = h("input", { type: "checkbox", checked: !!values.dc });
    const died = dateField("person.died", values.dd);
    const diedPlace = text(values.dp, { maxlength: 120 });
    const note = h("textarea", { rows: 5, maxlength: 5000, value: values.nt ?? "" });
    const error = errorLine();
    let surnameTouched = false;
    surname.addEventListener("input", () => { surnameTouched = true; });
    // the new relative's surname follows their sex (Novakov / Novakova) until the user types their own
    if (prefillSurname) {
      sex.addEventListener("change", () => {
        if (!surnameTouched && (sex.value === "M" || sex.value === "F")) surname.value = formFor(prefillSurname, sex.value);
      });
    }
    const save = btn(submitLabel, async () => {
      showError(error, "");
      const fields = { g: given.value, s: surname.value, bs: birthSurname.value, sx: sex.value, bp: bornPlace.value, dp: diedPlace.value, nt: note.value, dc: deceased.checked };
      for (const key of ["g", "s", "bs", "sx", "bp", "dp", "nt"]) if (fields[key].trim() === "") fields[key] = null;
      if (!values.dc && !deceased.checked) fields.dc = null; // not deceased and nothing recorded: leave it unset
      const bd = born.read("bd");
      const dd = died.read("dd");
      if (!bd.ok || !dd.ok) { showError(error, t("error.date")); return; }
      fields.bd = bd.value;
      fields.dd = dd.value;
      save.disabled = true;
      try {
        await onSubmit(fields, extraRead?.());
      } catch (err) {
        console.warn("form refused:", err.message, err.field || "");
        showError(error, errorText(err));
      } finally {
        save.disabled = false;
      }
    }, "primary");
    const body = h("div", { class: "edit" },
      field("person.given", given), field("person.surname", surname), field("person.birthSurname", birthSurname), field("person.sex", sex),
      born.node, field("person.birthPlace", bornPlace),
      h("label", { class: "check" }, deceased, h("span", null, t("person.deceasedKnown"))),
      died.node, field("person.deathPlace", diedPlace),
      field("person.note", note), ...extra, error);
    ctx.openSheet({ title, body, foot: [save, btn(t("common.cancel"), () => ctx.closeSheet())] });
  }

  const valuesOf = id => {
    const person = ctx.view.people.get(id) || ctx.view.deleted.get(id);
    return person ? person.f : {};
  };

  function editPerson(id) {
    closeMenu();
    const f = valuesOf(id);
    personForm({
      title: t("form.editTitle", { name: ctx.name(id) }),
      values: f,
      submitLabel: t("common.save"),
      onSubmit: async fields => {
        // a field never set stays unset; only what the person typed or cleared is written
        for (const key of Object.keys(fields)) if (fields[key] === null && f[key] === undefined) delete fields[key];
        if (await ctx.act(ctx.tree.edit(id, fields))) ctx.closeSheet();
      },
    });
  }

  /** The first person of an empty tree, or one more person who is not linked to anyone yet (join them with Link). */
  function addFirst(more = false) {
    personForm({
      title: more ? t("form.addPersonTitle") : t("form.addFirstTitle"),
      submitLabel: t("common.add"),
      onSubmit: async fields => {
        for (const key of Object.keys(fields)) if (fields[key] === null) delete fields[key];
        const change = ctx.tree.addPerson(fields);
        const [id] = change.puts.keys();
        if (await ctx.act(change)) { ctx.closeSheet(); ctx.show(id); }
      },
    });
  }

  function addRelative(id, relation) {
    closeMenu();
    const target = valuesOf(id);
    const view = ctx.view;
    const partners = view.partnerLinks.filter(l => l.a === id || l.b === id).map(l => (l.a === id ? l.b : l.a));
    const otherParent = relation === "child" && partners.length > 0
      ? select(["", ...partners], partners[0], v => (v ? ctx.name(v) : t("form.otherParentNone")))
      : null;
    const marriage = relation === "partner" ? dateField("marriage.date", null) : null;
    const marriagePlace = relation === "partner" ? text("", { maxlength: 120 }) : null;
    const ended = relation === "partner" ? h("input", { type: "checkbox" }) : null;
    const extra = [];
    if (otherParent) extra.push(field("form.otherParent", otherParent));
    if (marriage) extra.push(h("h2", { class: "form-sub" }, t("marriage.title")), marriage.node, field("marriage.place", marriagePlace), h("label", { class: "check" }, ended, h("span", null, t("marriage.ended"))));
    // the family surname follows the new person's sex; a partner brings their own
    const base = relation === "partner" || !target.s ? null : baseSurname(target.s);
    personForm({
      title: t(`form.add.${relation}`, { name: ctx.name(id) }),
      prefillSurname: base,
      sexHint: relation === "partner" && (target.sx === "M" || target.sx === "F") ? (target.sx === "M" ? "F" : "M") : "",
      extra,
      submitLabel: t("common.add"),
      onSubmit: async fields => {
        for (const key of Object.keys(fields)) if (fields[key] === null) delete fields[key];
        const options = otherParent ? { otherParent: otherParent.value || undefined } : {};
        if (otherParent && !otherParent.value) delete options.otherParent;
        const change = ctx.tree.addRelative(id, relation, fields, options);
        const created = [...change.puts.keys()].find(k => /^[0-9a-f]{16}$/.test(k) && !ctx.tree.records().has(k));
        let marriageFields = null;
        if (marriage) {
          const md = marriage.read("md");
          if (!md.ok) throw Object.assign(new Error("date"), { code: "invalid" });
          marriageFields = {};
          if (md.value) marriageFields.md = md.value;
          if (marriagePlace.value.trim()) marriageFields.mp = marriagePlace.value;
          if (ended.checked) marriageFields.en = true;
          if (Object.keys(marriageFields).length === 0) marriageFields = null;
        }
        if (!(await ctx.act(change))) return;
        if (marriageFields) await ctx.act(ctx.tree.editPartnership(id, created, marriageFields));
        ctx.closeSheet();
        ctx.show(id);
        ctx.notify(t("form.added", { name: ctx.name(created) }));
      },
    });
  }

  function editPartnership(a, b) {
    closeMenu();
    const link = ctx.view.partnerLinks.find(l => (l.a === a && l.b === b) || (l.a === b && l.b === a));
    const f = link ? link.f : {};
    const date = dateField("marriage.date", f.md);
    const place = text(f.mp, { maxlength: 120 });
    const ended = h("input", { type: "checkbox", checked: !!f.en });
    const endDate = dateField("marriage.endDate", f.ed);
    const error = errorLine();
    const save = btn(t("common.save"), async () => {
      const md = date.read("md");
      const ed = endDate.read("ed");
      if (!md.ok || !ed.ok) { showError(error, t("error.date")); return; }
      const fields = { md: md.value, mp: place.value.trim() === "" ? null : place.value, en: ended.checked ? true : (f.en === undefined ? null : false), ed: ed.value };
      for (const key of Object.keys(fields)) if (fields[key] === null && f[key] === undefined) delete fields[key];
      try {
        if (await ctx.act(ctx.tree.editPartnership(a, b, fields))) ctx.closeSheet();
      } catch (err) { showError(error, errorText(err)); }
    }, "primary");
    ctx.openSheet({
      title: t("marriage.titleOf", { a: ctx.name(a), b: ctx.name(b) }),
      body: h("div", { class: "edit" }, date.node, field("marriage.place", place), h("label", { class: "check" }, ended, h("span", null, t("marriage.ended"))), endDate.node, error),
      foot: [save, btn(t("common.cancel"), () => ctx.closeSheet())],
    });
  }

  // ---------- choosing a person
  /**
   * A sheet with a search box. `check(id)` returns null if the person can be picked, else the reason (shown, not pickable).
   * Resolves to the chosen ID, or null if the sheet was closed.
   */
  function pickPerson({ title, check = () => null }) {
    return new Promise(resolve => {
      let done = false;
      const finish = value => { if (done) return; done = true; resolve(value); };
      const input = text("", { type: "search", "aria-label": t("search.placeholder"), placeholder: t("search.placeholder") });
      const list = h("div", { class: "pick-list" });
      const render = () => {
        clear(list);
        const found = searchPeople(ctx.view, input.value, 30);
        if (!input.value.trim()) { list.append(h("p", { class: "note" }, t("pick.type"))); return; }
        if (found.length === 0) list.append(h("p", { class: "note" }, t("search.none")));
        for (const { id } of found) {
          const why = check(id);
          list.append(h("button", { class: "result", type: "button", disabled: !!why, on: { click: () => { finish(id); ctx.closeSheet(false); } } },
            h("span", { class: "rn" }, ctx.name(id)), h("span", { class: "ry" }, ctx.info(id).span), why ? h("span", { class: "rc" }, why) : null));
        }
      };
      input.addEventListener("input", render);
      render();
      ctx.openSheet({ title, body: h("div", { class: "edit" }, input, list), foot: [btn(t("common.cancel"), () => ctx.closeSheet())], onClose: () => finish(null) });
      input.focus();
    });
  }

  async function linkExisting(id, role) {
    closeMenu();
    const dry = other => {
      try {
        if (role === "parent") ctx.tree.link("parent", other, id);
        else if (role === "child") ctx.tree.link("parent", id, other);
        else ctx.tree.link(role, id, other);
        return null;
      } catch (err) {
        return err.code === "refused" ? t("error.refused") : err.code === "state" ? t("link.cannot") : t("error.invalid");
      }
    };
    const check = other => {
      if (other === id) return t("link.self");
      const reason = dry(other);
      if (reason) return reason;
      const change = role === "parent" ? ctx.tree.link("parent", other, id) : role === "child" ? ctx.tree.link("parent", id, other) : ctx.tree.link(role, id, other);
      return change.puts.size === 0 ? t("link.already") : null;
    };
    const other = await pickPerson({ title: t(`link.pick.${role}`, { name: ctx.name(id) }), check });
    if (!other) return;
    try {
      const change = role === "parent" ? ctx.tree.link("parent", other, id) : role === "child" ? ctx.tree.link("parent", id, other) : ctx.tree.link(role, id, other);
      if (await ctx.act(change)) { ctx.show(id); ctx.notify(t("link.done", { a: ctx.name(other), b: ctx.name(id) })); }
    } catch (err) {
      ctx.notify(errorText(err), { kind: "error" });
    }
  }

  async function sameAs(id) {
    closeMenu();
    const other = await pickPerson({ title: t("same.pick", { name: ctx.name(id) }), check: o => (o === id ? t("link.self") : null) });
    if (!other) return;
    const reasons = blockReasons(ctx.view, id, other);
    const doMerge = async () => {
      try {
        if (await ctx.act(ctx.tree.merge(id, other, {}))) { ctx.closeSheet(); ctx.show(id); ctx.notify(t("same.done")); }
      } catch (err) { ctx.notify(errorText(err), { kind: "error" }); }
    };
    ctx.openSheet({
      title: t("same.confirmTitle"),
      body: h("div", { class: "edit" },
        h("p", { class: "ask" }, t("same.confirm", { a: ctx.label(id), b: ctx.label(other) })),
        reasons.length ? h("div", { class: "conflict" }, h("div", { class: "cl" }, t("same.warning")), h("ul", null, ...reasons.map(r => h("li", null, t(`same.reason.${r}`))))) : null,
        h("p", { class: "note" }, t("same.undo"))),
      foot: [btn(reasons.length ? t("same.mergeAnyway") : t("same.merge"), doMerge, "primary"), btn(t("common.cancel"), () => ctx.closeSheet())],
    });
  }

  // ---------- delete and erase
  function confirmDelete(id) {
    closeMenu();
    ctx.openSheet({
      title: t("delete.title"),
      body: h("div", { class: "edit" }, h("p", { class: "ask" }, t("delete.text", { name: ctx.name(id) }))),
      foot: [
        btn(t("menu.delete"), async () => { if (await ctx.act(ctx.tree.removePerson(id))) { ctx.closeSheet(); ctx.notify(t("delete.done", { name: ctx.name(id) })); } }, "danger"),
        btn(t("common.cancel"), () => ctx.closeSheet()),
      ],
    });
  }

  function confirmErase(id) {
    closeMenu();
    const f = valuesOf(id);
    const given = (f.g || "").trim();
    const expected = given || t("erase.word");
    const same = typed => (matchKey(expected) ? matchKey(typed) === matchKey(expected) : typed.trim().toLowerCase() === expected.toLowerCase());
    const input = text("", { "aria-label": t("erase.type", { name: expected }) });
    const go = btn(t("menu.erase"), async () => {
      if (await ctx.act(ctx.tree.erase(id))) { ctx.closeSheet(); ctx.notify(t("erase.done")); }
    }, "danger");
    go.disabled = true;
    input.addEventListener("input", () => { go.disabled = !same(input.value); });
    ctx.openSheet({
      title: t("erase.title"),
      body: h("div", { class: "edit" }, h("p", { class: "ask" }, t("erase.text", { name: ctx.text(given || ctx.name(id)) })), field("erase.type", input, null, { name: expected })),
      foot: [go, btn(t("common.cancel"), () => ctx.closeSheet())],
    });
    input.focus();
  }

  async function thisIsMe(id) {
    closeMenu();
    if (await ctx.act({ puts: new Map(), group: null, meta: { thisIsMe: id } })) { ctx.notify(t("me.done", { name: ctx.name(id) })); ctx.redraw(); }
  }

  // ---------- the card menu
  function item(label, onClick, cls = "") {
    return h("button", { class: `ctx-item ${cls}`.trim(), type: "button", role: "menuitem", on: { click: onClick } }, label);
  }

  function renderMenu() {
    const { id, page } = menu;
    const view = ctx.view;
    const info = ctx.info(id);
    const rows = [h("div", { class: "ctx-head" }, h("b", null, `${info.given} ${info.surname}`.trim()), info.span ? h("span", null, info.span) : null)];
    const back = () => { menu.page = "main"; renderMenu(); };
    if (page === "main") {
      rows.push(
        item(t("menu.edit"), () => editPerson(id)),
        item(`${t("menu.addRelative")} ›`, () => { menu.page = "add"; renderMenu(); }),
        item(`${t("menu.link")} ›`, () => { menu.page = "link"; renderMenu(); }),
        item(t("menu.sameAs"), () => sameAs(id)),
        item(t("menu.duplicates"), () => { closeMenu(); ctx.screens.duplicates(id); }),
        item(t("menu.thisIsMe"), () => thisIsMe(id)),
        item(t("menu.hourglass"), () => { closeMenu(); ctx.show(id); }),
        item(t("menu.history"), () => { closeMenu(); ctx.screens.history(id); }),
        h("div", { class: "ctx-sep" }),
        item(t("menu.delete"), () => confirmDelete(id), "danger"),
        item(t("menu.erase"), () => confirmErase(id), "danger"),
      );
    } else if (page === "add") {
      const parentIds = view.parentLinks.filter(l => l.child === id).map(l => l.parent);
      // two parents block a third, unless one is a nameless placeholder that the new parent will fill
      const full = parentIds.length >= 2 && !parentIds.some(pid => Object.keys(view.people.get(pid)?.f ?? {}).length === 0);
      rows.push(item(`‹ ${t("common.back")}`, back), h("div", { class: "ctx-sep" }),
        item(t("rel.parent"), () => addRelative(id, "parent")),
        item(t("rel.child"), () => addRelative(id, "child")),
        item(t("rel.partner"), () => addRelative(id, "partner")),
        item(t("rel.sibling"), () => addRelative(id, "sibling")));
      if (full) rows[3].disabled = true;
    } else if (page === "link") {
      rows.push(item(`‹ ${t("common.back")}`, back), h("div", { class: "ctx-sep" }),
        item(t("link.asParent"), () => linkExisting(id, "parent")),
        item(t("link.asChild"), () => linkExisting(id, "child")),
        item(t("link.asPartner"), () => linkExisting(id, "partner")),
        item(t("link.asSibling"), () => linkExisting(id, "sibling")));
    }
    menuEl.replaceChildren(...rows);
    place();
  }

  // beside the card (or at the finger), always fully on screen
  function place() {
    const w = menuEl.offsetWidth;
    const hgt = menuEl.offsetHeight;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const m = 8;
    const at = menu.at;
    let x;
    let y;
    if (at?.rect) {
      const r = at.rect;
      x = r.right + 8 + w <= W - m ? r.right + 8 : r.left - 8 - w;
      y = r.top;
      if (x < m) { x = r.left; y = r.bottom + 8; }
    } else {
      x = at?.x ?? m;
      y = at?.y ?? m;
    }
    menuEl.style.left = `${Math.min(Math.max(x, m), Math.max(m, W - w - m))}px`;
    menuEl.style.top = `${Math.min(Math.max(y, m), Math.max(m, H - hgt - m))}px`;
    clearTimeout(closeTimer);
    menuEl.classList.remove("is-closing");
    menuEl.classList.add("is-open");
    menuEl.querySelector("button:not([disabled])")?.focus({ preventScroll: true });
  }

  function openMenu(id, at) {
    if (!ctx.view.people.has(id)) return;
    menu = { id, page: "main", at };
    renderMenu();
  }

  function closeMenu() {
    if (!menu) return;
    menu = null;
    menuEl.classList.remove("is-open");
    menuEl.classList.add("is-closing");
    closeTimer = setTimeout(() => menuEl.classList.remove("is-closing"), 150);
  }
  window.addEventListener("resize", closeMenu);
  // The event path, not e.target.closest(): a menu item that opens a submenu is gone from the
  // page by the time the click reaches the document, and would look like a click outside.
  document.addEventListener("click", e => {
    const inside = e.composedPath().some(n => n === menuEl || n.id === "panel" || n.classList?.contains("card"));
    if (menu && !inside) closeMenu();
  });

  return { openMenu, closeMenu, editPerson, addRelative, addFirst, editPartnership, pickPerson, linkExisting, sameAs, confirmDelete, confirmErase, field, btn, text, select, errorLine, showError };
}
