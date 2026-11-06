// Tiny DOM builder. Text goes in through textContent only: no innerHTML, and no style attribute
// (the CSP forbids it). Positions are set with el.style from code.
const SVGNS = "http://www.w3.org/2000/svg";

function apply(el, attrs) {
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "style") throw new Error("inline style attributes are not allowed; set el.style from code");
    if (key === "class") el.setAttribute("class", value);
    else if (key === "text") el.textContent = value;
    else if (key === "on") for (const [type, fn] of Object.entries(value)) el.addEventListener(type, fn);
    else if (key === "data") for (const [name, v] of Object.entries(value)) el.dataset[name] = v;
    else if (key === "value" || key === "checked" || key === "disabled" || key === "hidden" || key === "selected") el[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
}

function append(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
}

/** h("button", { class: "x", on: { click } }, "label", child…) */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  apply(el, attrs);
  append(el, kids);
  return el;
}

export function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  apply(el, attrs);
  append(el, kids);
  return el;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const clear = el => el.replaceChildren();
