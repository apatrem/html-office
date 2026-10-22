// Shared shell components for the mock-ups: icons, buttons, pickers, menus.
// Icons are simple outline drawings made for these mock-ups (no icon library).

const P = {
  undo: '<path d="M7 5 3 9l4 4"/><path d="M3 9h9a4 4 0 0 1 0 8H9"/>',
  redo: '<path d="m13 5 4 4-4 4"/><path d="M17 9H8a4 4 0 0 0 0 8h3"/>',
  painter: '<rect x="4" y="3" width="10" height="5" rx="1"/><path d="M14 5.5h2v4h-6v3"/><rect x="9" y="12.5" width="2" height="5" rx=".5"/>',
  eraser: '<path d="m4 13 7-7 5 5-5 5H7z"/><path d="M9 16.5h8"/><path d="m7.5 9.5 5 5"/>',
  fill: '<path d="m5 9 5-5 6 6-5 5z"/><path d="M16.5 12.5c.8 1.2 1.2 2 1.2 2.5a1.2 1.2 0 0 1-2.4 0c0-.5.4-1.3 1.2-2.5z"/>',
  borders: '<rect x="3.5" y="3.5" width="13" height="13" rx="1"/><path d="M10 3.5v13M3.5 10h13" stroke-dasharray="1.5 1.8"/>',
  alignL: '<path d="M3 5h14M3 9h9M3 13h14M3 17h9"/>',
  alignC: '<path d="M3 5h14M5.5 9h9M3 13h14M5.5 17h9"/>',
  alignR: '<path d="M3 5h14M8 9h9M3 13h14M8 17h9"/>',
  alignJ: '<path d="M3 5h14M3 9h14M3 13h14M3 17h14"/>',
  across: '<path d="M2.5 4v12M17.5 4v12"/><path d="M5 10h10"/><path d="m7 7.5-2.5 2.5L7 12.5M13 7.5l2.5 2.5-2.5 2.5"/>',
  wrap: '<path d="M3 5h14"/><path d="M3 10h11a2.8 2.8 0 0 1 0 5.6H10"/><path d="m11.5 13.8-1.8 1.8 1.8 1.8"/><path d="M3 15.5h4"/>',
  link: '<path d="m8.2 11.8 3.6-3.6"/><path d="m9 6.3 1.3-1.3a3.2 3.2 0 0 1 4.6 4.6l-1.3 1.3"/><path d="m11 13.7-1.3 1.3a3.2 3.2 0 0 1-4.6-4.6l1.3-1.3"/>',
  image: '<rect x="3" y="4" width="14" height="12" rx="1.5"/><circle cx="7.3" cy="8" r="1.4"/><path d="m3.5 14.5 4-4 3.5 3.5 2-2 3.5 3.5"/>',
  table: '<rect x="3" y="4" width="14" height="12" rx="1"/><path d="M3 8h14M3 12h14M8 4v12"/>',
  chart: '<path d="M3 16.5h14"/><path d="M5 15V10M8.5 15V6M12 15v-4M15.5 15V7.5" stroke-width="2.2"/>',
  shape: '<rect x="3" y="8" width="8" height="8" rx=".8"/><circle cx="13" cy="7" r="4"/>',
  textbox: '<rect x="3" y="4" width="14" height="12" rx="1" stroke-dasharray="2 1.6"/><path d="M7 8h6M10 8v5"/>',
  block: '<rect x="3" y="5" width="14" height="10" rx="1.5"/><path d="M6 8.5h8M6 11.5h5"/>',
  comment: '<path d="M4 4h12v9H9.5L6 16v-3H4z"/>',
  footnote: '<path d="M4 15.5h7M4 11.5h9"/><path d="M14 4.5l1.5-1v5"/>',
  xref: '<path d="M4 6h7M4 10h5M4 14h7"/><path d="m13 8 3 2-3 2"/>',
  toc: '<path d="M4 5h12M7 9h9M7 13h9M4 17h12"/>',
  pagebreak: '<path d="M5 3v4h10V3M5 17v-4h10v4"/><path d="M2.5 10h3M8.5 10h3M14.5 10h3"/>',
  sliders: '<path d="M4 6h12M4 14h12"/><circle cx="8" cy="6" r="2" fill="var(--ui-bg)"/><circle cx="12.5" cy="14" r="2" fill="var(--ui-bg)"/>',
  palette: '<path d="M10 3a7 7 0 0 0 0 14c1.2 0 1.6-.8 1.3-1.7-.4-1 .3-2 1.4-2H15a2.5 2.5 0 0 0 2.5-2.6C17.4 6.4 14.1 3 10 3z"/><circle cx="6.5" cy="9" r="1"/><circle cx="9" cy="6.2" r="1"/><circle cx="12.6" cy="6.6" r="1"/>',
  save: '<path d="M4 3.5h9.5l2.5 2.5v10.5H4z"/><path d="M7 3.5v3.5h5.5V3.5"/><rect x="6.5" y="11" width="7" height="5.5"/>',
  print: '<path d="M6 7.5V3.5h8v4"/><rect x="3" y="7.5" width="14" height="6.5" rx="1"/><path d="M6 11.5h8v5H6z"/>',
  help: '<circle cx="10" cy="10" r="7"/><path d="M8 8a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.3v.4"/><path d="M10 14.2v.1"/>',
  more: '<circle cx="5" cy="10" r=".9" fill="currentColor"/><circle cx="10" cy="10" r=".9" fill="currentColor"/><circle cx="15" cy="10" r=".9" fill="currentColor"/>',
  menu: '<path d="M3.5 6h13M3.5 10h13M3.5 14h13"/>',
  caret: '<path d="m6 8 4 4 4-4"/>',
  plus: '<path d="M10 4.5v11M4.5 10h11"/>',
  gridlines: '<rect x="3.5" y="3.5" width="13" height="13"/><path d="M3.5 8h13M3.5 12.3h13M8 3.5v13M12.3 3.5v13"/>',
  styles: '<rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1"/><rect x="11" y="3.5" width="5.5" height="5.5" rx="1" fill="currentColor"/><rect x="3.5" y="11" width="5.5" height="5.5" rx="1" fill="currentColor" opacity=".45"/><rect x="11" y="11" width="5.5" height="5.5" rx="1"/>',
  globe: '<circle cx="10" cy="10" r="7"/><path d="M3 10h14"/><path d="M10 3c2 2 2.8 4.4 2.8 7S12 15 10 17c-2-2-2.8-4.4-2.8-7S8 5 10 3z"/>',
  play: '<path d="M6.5 4.5 15.5 10l-9 5.5z"/>',
  bullets: '<circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="10" r="1" fill="currentColor"/><circle cx="4.5" cy="14" r="1" fill="currentColor"/><path d="M8 6h9M8 10h9M8 14h9"/>',
  numbers: '<path d="M3.5 5l1.3-.8v3.6M3.3 10.6c.4-.6 2.3-.7 2 .6-.2.7-2 1.6-2 2.3h2.2"/><path d="M8.5 6h8.5M8.5 10h8.5M8.5 14h8.5"/>',
  outdent: '<path d="M8 5h9M8 10h9M8 15h9"/><path d="M6 7.5 3.5 10 6 12.5"/>',
  indent: '<path d="M8 5h9M8 10h9M8 15h9"/><path d="m3.5 7.5 2.5 2.5-2.5 2.5"/>',
  download: '<path d="M10 3.5v9.5M6 9.5l4 4 4-4M4 16.5h12"/>',
  upload: '<path d="M10 13.5V4M6 8l4-4 4 4M4 16.5h12"/>',
  calc: '<path d="M15.8 9.5A6 6 0 1 1 13.5 5"/><path d="M15.8 3.5v3.3h-3.3"/>',
  arrange: '<rect x="3" y="3" width="9" height="9" rx="1"/><rect x="8" y="8" width="9" height="9" rx="1" fill="var(--ui-bg)"/>',
  layout: '<rect x="3" y="4" width="14" height="12" rx="1"/><path d="M8.5 4v12M8.5 9h8.5"/>',
  reset: '<path d="M4.5 9.5A5.5 5.5 0 1 0 6.2 5.6"/><path d="M4.2 3.5v3.3h3.3"/>',
  footer: '<rect x="3" y="4" width="14" height="12" rx="1"/><path d="M5.5 13.5h6M14 13.5h.5"/>',
  copy: '<rect x="6.5" y="6.5" width="10" height="10" rx="1.5"/><path d="M13.5 6.5V4.5a1 1 0 0 0-1-1h-8a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2"/>',
  trash: '<path d="M4 6h12M8 6V4h4v2M5.5 6l.8 10.5h7.4L14.5 6"/>',
  rowAdd: '<rect x="3" y="3.5" width="14" height="6" rx="1"/><path d="M10 12.5v5M7.5 15h5"/>',
  colAdd: '<rect x="3.5" y="3" width="6" height="14" rx="1"/><path d="M12.5 10h5M15 7.5v5"/>',
  rowDel: '<rect x="3" y="3.5" width="14" height="6" rx="1"/><path d="M7.5 15h5"/>',
  sheet: '<path d="M3 5.5h14v11H3z"/><path d="M3 9h14M8 5.5v11"/>',
  dropdown: '<rect x="3" y="6" width="14" height="8" rx="1.5"/><path d="m11.5 9 1.5 1.5L14.5 9"/>',
  condfmt: '<rect x="3" y="3.5" width="14" height="13" rx="1"/><path d="M6 13V9.5M9 13V7M12 13v-2M15 13V8" stroke-width="2"/>',
  pivot: '<rect x="3" y="3" width="14" height="14" rx="1"/><path d="M3 7.5h14M7.5 3v14"/><path d="m11 10.5 2 2 2-2"/>',
  eye: '<path d="M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5z"/><circle cx="10" cy="10" r="2.2"/>',
  markdown: '<rect x="2.5" y="5" width="15" height="10" rx="1.5"/><path d="M5 12.5v-5l2 2.5 2-2.5v5M13.5 7.5v5M11.8 10.8l1.7 1.7 1.7-1.7"/>',
  check: '<path d="m4.5 10.5 3.5 3.5 7.5-8"/>',
  close: '<path d="m5 5 10 10M15 5 5 15"/>',
  outline: '<path d="M4 5h12M7 9h9M10 13h6M7 17h9"/>',
  thumbs: '<rect x="3" y="3" width="6" height="4.5" rx=".8"/><rect x="3" y="9.5" width="6" height="4.5" rx=".8"/><path d="M11.5 5.3h5.5M11.5 11.8h5.5"/>',
  highlight: '<path d="m12.5 3.5 4 4-7 7H5.5v-4z"/><path d="M3 17.5h14" stroke-width="2.4" stroke="var(--hl, #F5D547)"/>',
  code: '<path d="m7 6-4 4 4 4M13 6l4 4-4 4"/>',
  sum: '<path d="M15 4.5H5.5L10.5 10l-5 5.5H15"/>',
  fx: '<path d="M9.5 4.3c-1.6-.5-2.8.3-3.1 1.9L4.6 16"/><path d="M3.8 9h5"/><path d="m11 9 5.5 6.5M16.5 9 11 15.5"/>',
  zoom: '<circle cx="9" cy="9" r="5"/><path d="m13 13 3.5 3.5"/>',
};

export function icon(name) {
  return `<svg class="ic" viewBox="0 0 20 20" aria-hidden="true" focusable="false">${P[name]}</svg>`;
}

const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
export { esc };

// Toolbar button. `glyph` is a letter-style icon (B, I, €, %); `ic` an icon name.
export function btn({ ic, glyph, label, text, dd, pressed, panel, menu, cls = "", attrs = "", planned, key }) {
  const tip = label + (key ? ` (${key})` : "") + (planned ? " · planned" : "");
  const a = [`type="button"`, `class="b ${cls}${text ? " t" : ""}${dd ? " dd" : ""}${planned ? " planned" : ""}"`, `title="${esc(tip)}"`];
  if (!text) a.push(`aria-label="${esc(label)}"`);
  if (pressed !== undefined) a.push(`aria-pressed="${pressed}"`);
  if (panel) a.push(`data-panel="${panel}"`, `aria-pressed="false"`);
  if (menu) a.push(`data-menu="${menu}"`, `aria-haspopup="true"`, `aria-expanded="false"`);
  const face = ic ? icon(ic) : glyph ? `<span class="g">${glyph}</span>` : "";
  return `<button ${a.join(" ")} ${attrs}>${face}${text ? `<span class="lbl">${esc(text)}</span>` : ""}${dd ? icon("caret").replace('class="ic"', 'class="ic car"') : ""}</button>`;
}
export const sep = () => '<span class="sep" role="separator"></span>';
export const grp = (label, ...items) => `<div class="grp" role="group" aria-label="${esc(label)}">${items.join("")}</div>`;
export const spacer = () => '<span class="spacer"></span>';

// Colour pickers: closed vocabulary from ADR-012 §2, rendered with charte tokens.
export const TEXT_COLOURS = [
  ["ink", "Ink (default)"], ["acc", "Accent"], ["mid", "Mid"], ["alert", "Alert"], ["t2", "Secondary grey"], ["bg", "White"],
];
export const FILLS = [
  ["none", "No fill"], ["tint", "Tint"], ["lig", "Light"], ["mid", "Mid"], ["acc", "Accent"], ["alert", "Alert"], ["dark", "Dark"],
];
export function colourButton(kind) {
  const isFill = kind === "fill";
  return `<span class="mw">${btn({
    ic: isFill ? "fill" : undefined,
    glyph: isFill ? undefined : '<span class="Aglyph">A</span>',
    label: isFill ? "Fill colour" : "Text colour",
    dd: true,
    menu: isFill ? "pop-fill" : "pop-color",
    cls: "colour " + (isFill ? "k-fill" : "k-color"),
  })}</span>`;
}
export function swatchPopovers() {
  const sw = (list, prefix) =>
    list
      .map(([t, l]) => `<button type="button" class="sw sw-${t}" role="menuitemradio" aria-checked="${t === (prefix === "c" ? "ink" : "none")}" title="${l}" aria-label="${l}"></button>`)
      .join("");
  return `<div class="pop pop-sw" id="pop-color" role="menu" aria-label="Text colour" hidden><p class="pop-h">Text colour · charte tokens</p><div class="sw-row">${sw(TEXT_COLOURS, "c")}</div></div>
<div class="pop pop-sw" id="pop-fill" role="menu" aria-label="Fill colour" hidden><p class="pop-h">Fill · charte tokens</p><div class="sw-row">${sw(FILLS, "f")}</div><p class="pop-n">Dark fills switch text to white.</p></div>`;
}

// Menus: items are [label, shortcut?, flags] or "-" separators.
export function menuPop(id, title, items) {
  const li = items
    .map((it) => {
      if (it === "-") return '<li role="separator" class="msep"></li>';
      const [label, key = "", flag = {}] = it;
      const extra = (flag.panel ? ` data-panel="${flag.panel}"` : "") + (typeof flag.sub === "string" ? ` data-menu="${flag.sub}" aria-haspopup="true" aria-expanded="false"` : "");
      return `<li role="none"><button type="button" role="menuitem"${extra}${flag.planned ? ' class="planned"' : ""}><span>${esc(label)}</span>${flag.planned ? '<em class="tag">planned</em>' : ""}${key ? `<kbd>${esc(key)}</kbd>` : ""}${flag.sub ? '<span class="sub">›</span>' : ""}</button></li>`;
    })
    .join("");
  return `<ul class="pop menu" id="${id}" role="menu" aria-label="${esc(title)}" hidden>${li}</ul>`;
}

// A select-looking button (style picker, number format, locale...).
export function picker({ label, value, menu, width = 0, cls = "" }) {
  return `<span class="mw"><button type="button" class="b pick ${cls}" ${width ? `style="min-width:${width}px"` : ""} aria-label="${esc(label)}: ${esc(value)}" title="${esc(label)}" ${menu ? `data-menu="${menu}" aria-haspopup="true" aria-expanded="false"` : ""}><span class="lbl">${esc(value)}</span>${icon("caret").replace('class="ic"', 'class="ic car"')}</button></span>`;
}
