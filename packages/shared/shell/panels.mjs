// Panel bodies (ADR-011 §7): cell styles and regional settings (Data), and
// document settings shared by every product (theme, font, product extras).
// Each control applies immediately through the callbacks it is given.
import { h, roving } from "./dom.mjs";
import { CHARTES, THEME_NAMES } from "../themes/chartes.mjs";
import { FONTS } from "../themes/fonts.mjs";

export { FONTS };

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

// A radio group of buttons: arrows move, click or Enter applies.
export function choices(label, cls, items, current, onPick) {
  const group = h("div", {
    class: cls,
    role: "radiogroup",
    "aria-label": label,
  });
  for (const [id, ...content] of items) {
    const b = h(
      "button",
      {
        type: "button",
        role: "radio",
        "aria-checked": String(id === current),
        onclick: () => {
          for (const other of group.children)
            other.setAttribute("aria-checked", String(other === b));
          onPick(id);
        },
      },
      ...content,
    );
    b.dataset.value = id;
    group.append(b);
  }
  roving(group, "button");
  return group;
}

export function cellStylesBody({ current, onApply, extra }) {
  const sample = (id) =>
    ["calculation", "assumption", "output", "total"].includes(id)
      ? "€3,875"
      : id === "hyperlink"
        ? "example.org"
        : CELL_STYLES.find(([v]) => v === id)[1];
  return [
    choices(
      "Cell style",
      "sh-style-grid",
      CELL_STYLES.map(([id, name, description]) => [
        id,
        h(
          "span",
          { class: `sh-st-prev sh-cs-${id}`, "aria-hidden": "true" },
          sample(id),
        ),
        h("span", { class: "sh-st-name" }, name),
        h("span", { class: "sh-st-desc" }, description),
      ]),
      current,
      onApply,
    ),
    h(
      "p",
      { class: "sh-hint" },
      "Fixed catalogue of 11 styles in charte colours. Direct formatting stays available in the toolbar.",
    ),
    extra,
  ];
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
  const n = (options) => new Intl.NumberFormat(locale, options),
    d = (options) =>
      new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...options });
  return [
    ["Number", n({ minimumFractionDigits: 2 }).format(1234.5)],
    [
      "Currency",
      n({
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }).format(1234),
    ],
    ["Percent", n({ style: "percent", minimumFractionDigits: 1 }).format(0.08)],
    ["Short date", d({ dateStyle: "short" }).format(SAMPLE_DATE)],
    ["Long date", d({ dateStyle: "long" }).format(SAMPLE_DATE)],
  ];
}

// Display locale only: values and formulas never change.
export function regionalBody({ locale, onSave }) {
  const known = LOCALES.some(([value]) => value === locale),
    select = h(
      "select",
      {},
      [...(known ? [] : [[locale, locale]]), ...LOCALES].map(([value, name]) =>
        h(
          "option",
          { value, selected: value === locale },
          value === name ? name : `${name} — ${value}`,
        ),
      ),
    ),
    table = h("table", { class: "sh-kv" });
  const draw = () =>
    table.replaceChildren(
      h("caption", {}, "Preview"),
      ...localePreview(select.value).map(([key, value]) =>
        h("tr", {}, h("th", { scope: "row" }, key), h("td", {}, value)),
      ),
    );
  select.addEventListener("change", draw);
  draw();
  const id = `sh-locale-${Math.random().toString(36).slice(2)}`;
  select.id = id;
  return [
    h("div", { class: "sh-fld" }, h("label", { for: id }, "Locale"), select),
    table,
    h(
      "p",
      { class: "sh-hint" },
      "Changes how numbers and dates display. Values never change; formulas keep English names and separators.",
    ),
    h(
      "div",
      { class: "sh-prow" },
      h(
        "button",
        {
          type: "button",
          class: "sh-b sh-t sh-primary",
          onclick: () => onSave(select.value),
        },
        "Apply locale",
      ),
    ),
  ];
}

// theme/font: current values, "document" meaning the document's own charte
// (its colours given as documentColours) and its font.
export function documentBody({
  theme,
  font,
  documentColours,
  onTheme,
  onFont,
  fontNote,
  extra,
}) {
  const dots = (colours) =>
    h(
      "span",
      { class: "sh-dots", "aria-hidden": "true" },
      ["ink", "acc", "mid", "lig", "alert"].map((token) =>
        h("i", { style: `background:${colours[token]}` }),
      ),
    );
  const themes = choices(
    "Theme",
    "sh-themes",
    [
      ["document", dots(documentColours), h("span", {}, "Document charte")],
      ...Object.entries(THEME_NAMES).map(([id, name]) => [
        id,
        dots(CHARTES[id]),
        h("span", {}, name),
      ]),
    ],
    theme,
    onTheme,
  );
  const fonts = choices(
    "Document font",
    "sh-fonts",
    [
      [
        "document",
        h("span", {}, "Charte font"),
        h("span", { class: "sh-aa", "aria-hidden": "true" }, "Aa 1,234"),
      ],
      ...FONTS.map(([id, name, stack]) => [
        id,
        h("span", { style: `font-family:${stack}` }, name),
        h(
          "span",
          {
            class: "sh-aa",
            "aria-hidden": "true",
            style: `font-family:${stack}`,
          },
          "Aa 1,234",
        ),
      ]),
    ],
    font,
    onFont,
  );
  return [
    h("h3", {}, "Theme"),
    themes,
    h(
      "p",
      { class: "sh-hint" },
      "Built-in chartes recolour the document; its own charte is kept and can be chosen again.",
    ),
    h("h3", {}, "Font"),
    fonts,
    fontNote && h("p", { class: "sh-hint" }, fontNote),
    extra,
  ];
}
