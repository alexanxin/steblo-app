// The join screens (reference R9): when two trees meet, find who is the same person.
//   pair picker → questions → "We matched N people automatically" → "Check differences"
// The walk itself is src/join.js. Its changes are adopted at once and stored in order (ctx.stage); every answer is
// its own transaction, so a killed app keeps the answers so far and Needs attention offers Continue joining.
import { blockReasons, createWalk, startPoints } from "../src/join.js";
import { searchPeople } from "../src/search.js";
import { existingPeople, groupRecords } from "../src/sync-flow.js";
import { h } from "./dom.js";

const MAX_GROUP_OPTIONS = 200;
const MAX_RESULTS = 30;
const FIELD_LABELS = {
  g: "person.given", s: "person.surname", bs: "person.birthSurname", sx: "person.sex", bd: "person.born",
  bp: "person.birthPlace", dd: "person.died", dp: "person.deathPlace", dc: "person.deceased", nt: "person.note",
};

export function createJoin(ctx, overlay) {
  const { t } = ctx;
  let active = null;

  const btn = (label, onClick, cls = "", extra = {}) => h("button", { class: `btn-ghost ${cls}`.trim(), type: "button", on: { click: onClick }, ...extra }, label);
  const note = text => h("p", { class: "note" }, text);
  const ask = text => h("p", { class: "ask" }, text);
  const canonical = id => ctx.view.merged.get(id) ?? id;

  /** Stop the join: any screen waiting for an answer is released. */
  function abort() {
    if (!active) return;
    active.aborted = true;
    active.pending?.(null);
    active = null;
  }

  /** Draw a screen and wait for the user to answer it. `render(answer)` returns the screen. */
  function screen(me, render) {
    return new Promise(resolve => {
      me.pending = resolve;
      const answer = value => { me.pending = null; resolve(value); };
      overlay.show({ ...render(answer), onCancel: me.onCancel });
    });
  }

  // ---------------------------------------------------------------- showing people

  /** A person for a question: name, years, where born, and who they are connected to. */
  function card(id, heading = null) {
    const view = ctx.view;
    const person = view.people.get(id);
    const f = person?.f ?? {};
    const names = ids => ids.map(p => ctx.name(p)).join(", ");
    const parents = view.parentLinks.filter(l => l.child === id).map(l => l.parent);
    const partners = view.partnerLinks.filter(l => l.a === id || l.b === id).map(l => (l.a === id ? l.b : l.a));
    const children = view.parentLinks.filter(l => l.parent === id).map(l => l.child);
    const rows = [
      f.bp ? [t("person.born"), `${f.bd ? `${ctx.dateText(f.bd)} · ` : ""}${ctx.text(f.bp)}`] : f.bd ? [t("person.born"), ctx.dateText(f.bd)] : null,
      parents.length ? [t("rel.parents"), names(parents)] : null,
      partners.length ? [t("rel.partners"), names(partners)] : null,
      children.length ? [t("rel.children"), names(children.slice(0, 6)) + (children.length > 6 ? ` +${children.length - 6}` : "")] : null,
    ].filter(Boolean);
    return h("div", { class: "join-card" },
      heading ? h("div", { class: "join-heading" }, heading) : null,
      h("div", { class: "join-name" }, ctx.label(id)),
      ...rows.map(([k, v]) => h("div", { class: "join-line" }, h("span", { class: "join-key" }, k), " ", v)));
  }

  // ---------------------------------------------------------------- 1. the pair picker

  /** → "skip" | "all" | { existing, fresh }. */
  function pairScreen(me, group, inc, index, total) {
    const view = ctx.view;
    const existing = new Set(existingPeople(view, inc));
    const sorted = [...group.ids].sort((a, b) => ctx.label(a).localeCompare(ctx.label(b))).slice(0, MAX_GROUP_OPTIONS);
    return screen(me, answer => {
      const select = h("select", { "aria-label": t("join.fromGroup") }, ...sorted.map(id => h("option", { value: id }, ctx.label(id))));
      const search = h("input", { type: "search", autocomplete: "off", spellcheck: "false", placeholder: t("join.searchPlaceholder"), "aria-label": t("join.searchPlaceholder") });
      const results = h("div", { class: "join-results" });
      const chosen = h("p", { class: "join-chosen" });
      const warnings = h("div", { class: "join-warnings" });
      const go = btn(t("join.joinThem"), () => answer({ existing: picked, fresh: select.value }), "primary", { disabled: true });
      let picked = null;

      const refresh = () => {
        warnings.replaceChildren();
        chosen.textContent = picked ? t("join.chosen", { name: ctx.label(picked) }) : "";
        go.disabled = !picked;
        if (!picked) return;
        const reasons = blockReasons(ctx.view, canonical(picked), canonical(select.value));
        if (reasons.length) warnings.append(note(t("same.warning")), h("ul", { class: "problems" }, ...reasons.map(r => h("li", null, t(`same.reason.${r}`)))));
      };
      const list = () => {
        const query = search.value.trim();
        results.replaceChildren();
        if (!query) return;
        const found = searchPeople(ctx.view, query, 200).filter(r => existing.has(r.id)).slice(0, MAX_RESULTS);
        if (!found.length) results.append(note(t("search.none")));
        for (const { id } of found) {
          results.append(h("button", { class: `join-result${id === picked ? " is-picked" : ""}`, type: "button", on: { click: () => { picked = id; list(); refresh(); } } }, ctx.label(id)));
        }
      };
      search.addEventListener("input", list);
      select.addEventListener("change", refresh);

      return {
        title: t("join.pairTitle", { n: index, total }),
        body: [
          ask(t("join.groupAsk", { n: group.size })),
          h("label", { class: "field" }, h("span", null, t("join.fromGroup")), select),
          h("label", { class: "field" }, h("span", null, t("join.inTree")), search),
          results, chosen, warnings,
        ],
        foot: [go, btn(t("join.keepSeparate"), () => answer("skip")), total > index ? btn(t("join.keepAllSeparate"), () => answer("all")) : null],
      };
    });
  }

  // ---------------------------------------------------------------- 2. questions

  /** → { same: id } | "different" | "unsure". */
  function questionScreen(me, q, n) {
    return screen(me, answer => ({
      title: t("join.questionTitle", { n }),
      body: [
        ask(t(`join.asks.${q.relation}`, { x: ctx.name(q.x.id), of: ctx.name(canonical(q.of)) })),
        card(q.x.id, t("join.theNewOne")),
        note(t("join.candidates")),
        ...q.candidates.map(c => h("div", { class: "join-option" }, card(c.id), btn(t("join.samePerson"), () => answer({ same: c.id }), "primary"))),
      ],
      foot: [btn(t("join.different"), () => answer("different")), btn(t("join.unsure"), () => answer("unsure"))],
    }));
  }

  // ---------------------------------------------------------------- 3. review lists

  async function autoScreen(me, walk) {
    for (;;) {
      const entries = walk.automatic();
      if (!entries.length) return true;
      const action = await screen(me, answer => ({
        title: t("join.autoTitle", { n: entries.length }),
        body: [
          note(t("join.autoHelp")),
          ...entries.map(e => h("div", { class: "list-row" },
            h("span", { class: "grow" }, ctx.label(canonical(e.y)), h("span", { class: "dim" }, ` · ${t(`join.autoRel.${e.relation}`, { of: ctx.name(canonical(e.of)) })}`)),
            btn(t("dup.notSame"), () => answer(e)))),
        ],
        foot: [btn(t("common.continue"), () => answer("continue"), "primary")],
      }));
      if (me.aborted) return false;
      if (action === "continue" || action === null) return true;
      walk.unmerge(action);
      if (!(await ctx.flushWrites())) return false;
    }
  }

  /** → picks for walk.applyDifferences, or null to leave it to the later-wins rule. */
  function differencesScreen(me, diffs) {
    return screen(me, answer => {
      const show = (key, value) => (key === "bd" || key === "dd" ? ctx.dateText(value) : key === "dc" ? t("person.deceased") : ctx.text(String(value)));
      const choices = [];
      const body = [note(t("join.diffHelp"))];
      for (const d of diffs) {
        const rows = d.fields.map(field => {
          const name = `${d.id}-${field.f}`;
          const ours = h("input", { type: "radio", name, value: "ours", checked: field.choice === "ours" });
          const theirs = h("input", { type: "radio", name, value: "theirs", checked: field.choice === "theirs" });
          choices.push({ id: d.id, field, ours, theirs });
          return h("div", { class: "join-diff" }, h("b", null, t(FIELD_LABELS[field.f])),
            h("label", { class: "check" }, ours, h("span", null, t("join.ours"), ": ", show(field.f, field.ours))),
            h("label", { class: "check" }, theirs, h("span", null, t("join.theirs"), ": ", show(field.f, field.theirs))));
        });
        body.push(h("div", { class: "list-block" }, h("div", { class: "join-name" }, ctx.label(d.id)), ...rows));
      }
      const picks = () => choices.map(({ id, field, theirs }) => ({ id, f: field.f, value: theirs.checked ? field.theirs : field.ours }));
      return {
        title: t("join.diffTitle", { n: diffs.length }),
        body,
        foot: [btn(t("join.diffConfirm"), () => answer(picks()), "primary"), btn(t("join.diffSkip"), () => answer("skip"))],
      };
    });
  }

  // ---------------------------------------------------------------- the whole join

  /**
   * Run the join. `incoming` is the Set of record IDs that are new; `newGroups` ([{ ids, size }], largest first) and
   * `gainedRelatives` come from startPoints. → { pairs, questions, automatic } or { failed } or { aborted }.
   * The caller holds the editing lock; `onCancel` is what the Cancel button does.
   */
  async function run({ incoming, newGroups = [], gainedRelatives = [], onCancel }) {
    abort();
    const me = { aborted: false, pending: null, onCancel };
    active = me;
    const inc = incoming instanceof Set ? incoming : new Set(incoming);
    const pairs = [];
    for (let i = 0; i < newGroups.length; i++) {
      const pick = await pairScreen(me, newGroups[i], inc, i + 1, newGroups.length);
      if (me.aborted) return { aborted: true };
      if (pick === "all") break;
      if (pick && pick !== "skip") pairs.push([pick.existing, pick.fresh]);
    }
    const result = { pairs: pairs.length, questions: 0, automatic: 0 };
    if (!pairs.length && !gainedRelatives.length) { active = null; return result; }

    const walk = createWalk(ctx.tree, { pairs, selfPairs: gainedRelatives, incoming: inc, commit: ctx.stage });
    for (;;) {
      const q = walk.next();
      if (!(await ctx.flushWrites())) { active = null; return { failed: true }; }
      if (me.aborted) return { aborted: true };
      if (!q) break;
      result.questions += 1;
      const reply = await questionScreen(me, q, result.questions);
      if (me.aborted) return { aborted: true };
      walk.answer(q, reply ?? "unsure");
      if (!(await ctx.flushWrites())) { active = null; return { failed: true }; }
    }
    result.automatic = walk.automatic().length;
    if (!(await autoScreen(me, walk))) { const failed = !me.aborted; active = null; return failed ? { failed: true } : { aborted: true }; }
    const diffs = walk.differences();
    if (diffs.length) {
      const picks = await differencesScreen(me, diffs);
      if (me.aborted) return { aborted: true };
      if (Array.isArray(picks)) {
        walk.applyDifferences(picks);
        if (!(await ctx.flushWrites())) { active = null; return { failed: true }; }
      }
    }
    active = null;
    return result;
  }

  // ---------------------------------------------------------------- joins outside a sync

  /** A join that isn't part of a sync (a GEDCOM import, Needs attention): takes the lock and shows a result at the end. */
  async function standalone(options) {
    ctx.lock(true);
    const close = () => { abort(); overlay.hide(); ctx.lock(false); };
    const result = await run({ ...options, onCancel: close });
    if (result.aborted) return;
    if (result.failed) { overlay.hide(); ctx.lock(false); return; }
    if (!result.pairs && !result.questions && !result.automatic) {
      overlay.hide();
      ctx.lock(false);
      ctx.notify(t("join.keptSeparate"));
      return;
    }
    overlay.show({
      title: t("join.doneTitle"),
      body: [ask(t("join.doneText")), h("ul", { class: "problems" },
        h("li", null, t("join.doneAnswers", { n: result.questions })), h("li", null, t("join.doneAutomatic", { n: result.automatic })))],
      foot: [btn(t("common.close"), () => { overlay.hide(); ctx.lock(false); }, "primary")],
    });
  }

  /** After a GEDCOM import has been stored: the same join, with one person answering. Nothing runs on an empty tree. */
  async function afterImport(result) {
    const points = startPoints(ctx.tree.view(), result.incoming);
    if (!points.newGroups.length && !points.gainedRelatives.length) return false;
    await standalone({ incoming: result.incoming, newGroups: points.newGroups, gainedRelatives: points.gainedRelatives });
    return true;
  }

  /** Join from Needs attention / Continue joining: the separate groups are the new side (R9 Commits). */
  async function fromGroups(groups) {
    const view = ctx.view;
    const incoming = new Set();
    for (const g of groups) for (const r of groupRecords(view, g.ids)) incoming.add(r);
    const newGroups = groups.map(g => ({ ids: [...g.ids], size: g.size })).sort((a, b) => b.size - a.size);
    await standalone({ incoming, newGroups, gainedRelatives: [] });
  }

  return { run, abort, afterImport, fromGroups };
}
