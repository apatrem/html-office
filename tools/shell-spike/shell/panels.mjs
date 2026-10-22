// Panel bodies shared by the products: cell styles (Data), regional settings
// (Data), document settings (all: theme, font, product extras).
import { h, roving } from "./dom.mjs";

export const CELL_STYLES = [
  ["normal", "Normal", "Default"],
  ["title", "Title", "Sheet or block title"],
  ["header", "Header", "Column header"],
  ["rowHeader", "Row label", "Row label"],
  ["assumption", "Assumption", "Input (Excel “Input”)"],
  ["calculation", "Calculation", "Calculated value"],
  ["output", "Output", "Key result"],
  ["total", "Total", "Total row"],
  ["note", "Note", "Comment or source"],
  ["alert", "Alert", "Value to watch"],
  ["hyperlink", "Hyperlink", "Applied to linked cells"],
];

export function cellStylesBody({ current, onApply, extra }) {
  const grid = h("div", { class: "sh-style-grid", role: "radiogroup", "aria-label": "Cell style" });
  for (const [id, name, desc] of CELL_STYLES) {
    const b = h(
      "button",
      {
        type: "button",
        role: "radio",
        class: "sh-style-tile",
        "aria-checked": String(id === current),
        onclick: () => {
          for (const o of grid.children) o.setAttribute("aria-checked", String(o === b));
          onApply(id);
        },
      },
      h("span", { class: `sh-st-prev sh-cs-${id}`, "aria-hidden": "true" }, ["calculation", "assumption", "output", "total"].includes(id) ? "€3,875" : id === "hyperlink" ? "example.org" : name),
      h("span", { class: "sh-st-name" }, name),
      h("span", { class: "sh-st-desc" }, desc),
    );
    grid.append(b);
  }
  roving(grid, "button");
  return [grid, h("p", { class: "sh-hint" }, "Fixed catalogue of 11 styles in charte colours (ADR-012). No custom styles."), extra];
}

export const LOCALES = [
  ["en-US", "English (United States)"],
  ["en-GB", "English (United Kingdom)"],
  ["fr-FR", "Français (France)"],
  ["de-DE", "Deutsch (Deutschland)"],
  ["es-ES", "Español (España)"],
  ["it-IT", "Italiano (Italia)"],
];
const SAMPLE_DATE = new Date(Date.UTC(2026, 9, 22));
export function localePreview(locale) {
  const n = (opts) => new Intl.NumberFormat(locale, opts);
  const d = (opts) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...opts });
  return [
    ["Number", n({ minimumFractionDigits: 2 }).format(1234.5)],
    ["Currency", n({ style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(1234)],
    ["Percent", n({ style: "percent", minimumFractionDigits: 1 }).format(0.08)],
    ["Short date", d({ dateStyle: "short" }).format(SAMPLE_DATE)],
    ["Long date", d({ dateStyle: "full" }).format(SAMPLE_DATE)],
  ];
}

export function regionalBody({ locale, onSave }) {
  const select = h("select", { id: "sh-locale" }, LOCALES.map(([v, name]) => h("option", { value: v, selected: v === locale }, `${name} — ${v}`)));
  const table = h("table", { class: "sh-kv" });
  const draw = () =>
    table.replaceChildren(h("caption", {}, "Preview"), ...localePreview(select.value).map(([k, v]) => h("tr", {}, h("th", { scope: "row" }, k), h("td", {}, v))));
  select.addEventListener("change", draw);
  draw();
  const status = h("p", { class: "sh-hint", role: "status" });
  return [
    h("div", { class: "sh-fld" }, h("label", { for: "sh-locale" }, "Locale"), select),
    table,
    h("div", { class: "sh-fld sh-dis" }, h("label", { for: "sh-tz" }, "Time zone"), h("select", { id: "sh-tz", disabled: true }, h("option", {}, "UTC"))),
    h("p", { class: "sh-hint" }, "Display only: values never change. Time zone is not a document field until checked against the engine. Formulas keep English names and separators."),
    h("div", { class: "sh-prow" }, h("button", { type: "button", class: "sh-b sh-t sh-primary", onclick: () => { onSave(select.value); status.textContent = "Regional settings saved."; } }, "Save")),
    status,
  ];
}

export const THEMES = [
  ["document", "Document charte"],
  ["blue", "Blue"],
  ["red", "Red"],
  ["green", "Green"],
  ["black", "Black"],
];
export const FONTS = [
  ["arial", "Arial"],
  ["verdana", "Verdana"],
  ["tahoma", "Tahoma"],
  ["trebuchet", "Trebuchet MS"],
  ["georgia", "Georgia"],
  ["times", "Times New Roman"],
];
export function documentBody({ theme, font, onTheme, onFont, fontNote, extra }) {
  const themes = h("div", { class: "sh-themes", role: "radiogroup", "aria-label": "Theme" });
  for (const [id, name] of THEMES) {
    const b = h(
      "button",
      { type: "button", role: "radio", class: "sh-theme", "aria-checked": String(id === theme), onclick: () => { for (const o of themes.children) o.setAttribute("aria-checked", String(o === b)); onTheme(id); } },
      h("span", { class: `sh-dots sh-th-${id}`, "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i"), h("i")),
      h("span", {}, name),
    );
    themes.append(b);
  }
  roving(themes, "button");
  const fonts = h("div", { class: "sh-fonts", role: "radiogroup", "aria-label": "Document font" });
  for (const [id, name] of FONTS) {
    const b = h(
      "button",
      { type: "button", role: "radio", class: `sh-font sh-ff-${id}`, "aria-checked": String(id === font), onclick: () => { for (const o of fonts.children) o.setAttribute("aria-checked", String(o === b)); onFont(id); } },
      h("span", {}, name),
      id === "arial" && h("em", { class: "sh-tag" }, "default"),
      h("span", { class: "sh-aa", "aria-hidden": "true" }, "Aa 1,234"),
    );
    fonts.append(b);
  }
  roving(fonts, "button");
  return [h("h3", {}, "Theme"), themes, h("h3", {}, "Font"), fonts, h("p", { class: "sh-hint" }, fontNote), extra];
}
