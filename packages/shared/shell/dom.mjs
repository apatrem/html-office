// Tiny DOM helpers shared by the shell components. No framework.
import { ICONS } from "./icons.mjs";

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "html") el.innerHTML = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat(Infinity))
    if (child != null && child !== false) el.append(child);
  return el;
}

const svg = document.createElement("template");
export function icon(name, cls = "sh-ic") {
  svg.innerHTML = `<svg class="${cls}" viewBox="0 0 20 20" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
  return svg.content.firstChild;
}

let next = 0;
export const uid = (prefix) => `${prefix}-${++next}`;

// Icon or text button. `label` is always the accessible name.
export function button({
  label,
  ic,
  glyph,
  text,
  caret,
  pressed,
  cls = "",
  onClick,
  title,
  disabled,
}) {
  const b = h(
    "button",
    {
      type: "button",
      class: `sh-b ${text ? "sh-t " : ""}${cls}`,
      "aria-label": text ? null : label,
      title: title ?? label,
      "aria-pressed": pressed === undefined ? null : String(pressed),
      disabled,
      onclick: onClick,
    },
    ic && icon(ic),
    glyph && h("span", { class: "sh-g", html: glyph }),
    text && h("span", { class: "sh-lbl" }, text),
    caret && icon("caret", "sh-ic sh-car"),
  );
  return b;
}

// Roving focus inside a container: one tab stop, arrow keys between items.
export function roving(
  container,
  selector,
  { vertical = false, wrap = true, onMove, edges } = {},
) {
  // `edges` matches helper items (toolbar scroll arrows) that arrow keys reach
  // but Home, End and the default tab stop skip.
  const command = (el) => !edges || !el.matches(edges);
  const items = () =>
    [...container.querySelectorAll(selector)].filter(
      (el) =>
        !el.disabled &&
        el.offsetParent !== null &&
        getComputedStyle(el).visibility !== "hidden" &&
        el.getAttribute("aria-disabled") !== "true",
    );
  function focusAt(index) {
    const list = items();
    if (!list.length) return;
    const i = wrap
      ? (index + list.length) % list.length
      : Math.max(0, Math.min(list.length - 1, index));
    for (const el of container.querySelectorAll(selector)) el.tabIndex = -1;
    list[i].tabIndex = 0;
    list[i].focus();
    onMove?.(list[i]);
  }
  container.addEventListener("keydown", (event) => {
    if (event.target.matches("input, select, textarea")) return;
    const list = items(),
      i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const fwd = vertical ? "ArrowDown" : "ArrowRight",
      back = vertical ? "ArrowUp" : "ArrowLeft";
    const commands = list.filter(command);
    const target = {
      [fwd]: i + 1,
      [back]: i - 1,
      Home: list.indexOf(commands[0]),
      End: list.indexOf(commands.at(-1)),
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    focusAt(target);
  });
  container.addEventListener("focusin", (event) => {
    if (!event.target.matches(selector)) return;
    for (const el of container.querySelectorAll(selector))
      el.tabIndex = el === event.target ? 0 : -1;
  });
  // Keeps exactly one tab stop, preferring the current one if still enabled
  // and shown (a product may hide groups of items as its context changes).
  const reset = () => {
    const all = [...container.querySelectorAll(selector)].filter(command),
      usable = (el) => !el.disabled && el.offsetParent !== null;
    const first =
      all.find((el) => el.getAttribute("aria-checked") === "true") ??
      all.find((el) => el.tabIndex === 0 && usable(el)) ??
      all.find(usable) ??
      all.find((el) => !el.disabled) ??
      all[0];
    for (const el of all) el.tabIndex = el === first ? 0 : -1;
  };
  reset();
  return { focusAt, reset, items, command };
}
