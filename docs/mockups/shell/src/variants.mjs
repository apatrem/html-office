// The three layout variants. Each returns the shell markup around the shared canvases.
import { btn, grp, sep, spacer, icon, colourButton, picker, menuPop, swatchPopovers, esc } from "./parts.mjs";
import * as C from "./canvas.mjs";

export const PRODUCTS = {
  slides: { name: "Slides", mark: "S", title: "Community Learning — year-one review" },
  data: { name: "Data", mark: "D", title: "Community Learning — fictional 24-month P&L" },
  text: { name: "Text", mark: "T", title: "Business review and 2027 plan" },
};

// ---------- menus (complete command sets, brief §4) ----------
const pl = { planned: true };
const MENUS = {
  slides: {
    File: [["Save", "Cmd+S"], ["Save a copy"], ["Print / PDF"], "-", ["Document settings…", "", { panel: "settings" }], "-", ["File format guide"], ["Third-party notices"]],
    Edit: [["Undo", "Cmd+Z"], ["Redo", "Cmd+Shift+Z"], "-", ["Duplicate", "Cmd+D"], ["Delete", "Del"], ["Clear formatting"]],
    Insert: [["Text box"], ["Shape", "", { sub: 1 }], ["Block", "", { sub: 1 }], ["Image"], ["Table"], ["Chart", "", { sub: 1 }], "-", ["New slide", "", { sub: 1 }]],
    Slide: [["Layout", "", { sub: 1 }], ["Reset layout"], ["Footer…"], "-", ["Duplicate slide"], ["Delete slide"]],
    Arrange: [["Align left"], ["Centre horizontally"], ["Align right"], "-", ["Align top"], ["Centre vertically"], ["Align bottom"], "-", ["Distribute horizontally"], ["Distribute vertically"], "-", ["Bring forward", "Cmd+]"], ["Send backward", "Cmd+["]],
    Help: [["Shortcuts", "?", { panel: "help" }], ["File format guide"]],
  },
  data: {
    File: [["Save", "Cmd+S"], ["Save a copy"], "-", ["Import CSV / XLSX…", "", pl], ["Refresh source", "", pl], ["Export CSV", "", pl], ["Download PNG of selection", "", pl], ["Print / PDF…", "", pl], "-", ["Document settings…", "", { panel: "settings" }], ["Regional settings…", "", { panel: "regional" }], "-", ["File format guide"], ["Third-party notices"]],
    Edit: [["Undo", "Cmd+Z"], ["Redo", "Cmd+Shift+Z"], "-", ["Paste table…"], ["Fill down"], ["Fill right"], "-", ["Copy style", "", pl], ["Clear formatting", "", pl]],
    Insert: [["Rows above / below"], ["Columns left / right"], ["Sheet"], "-", ["Link…", "Cmd+K", pl], ["Chart", "", pl], ["Pivot", "", pl]],
    Format: [["Cell styles…", "", { panel: "styles" }], ["Number", "", { sub: 1 }], ["Borders", "", { sub: 1, planned: 1 }], ["Alignment", "", { sub: 1, planned: 1 }], ["Conditional formatting…"], "-", ["Column width…", "", pl], ["Auto-fit columns", "", pl]],
    Data: [["Recalculate", "F9"], ["Scenario", "", { sub: 1 }], ["Dropdown settings…"], "-", ["Manage sheets…"], ["Delete rows"], ["Delete columns"]],
    View: [["Grid lines", "", pl], ["Formula bar"]],
    Help: [["Shortcuts", "", { panel: "help" }], ["File format guide"]],
  },
  text: {
    File: [["Save", "Cmd+S"], ["Save a copy"], "-", ["Import Markdown…"], ["Export Markdown"], ["Print preview"], ["Print / PDF"], "-", ["Document settings…", "", { panel: "settings" }], "-", ["File format guide"], ["Third-party notices"]],
    Edit: [["Undo", "Cmd+Z"], ["Redo", "Cmd+Shift+Z"], "-", ["Paste as plain text"], ["Clear formatting"]],
    Insert: [["Table"], ["Chart", "", { sub: 1 }], ["Image"], ["Footnote"], ["Cross-reference…"], ["Table of contents"], ["Page break"], "-", ["Link…", "Cmd+K"], ["Comment", "Cmd+Alt+M"]],
    Format: [["Block style", "", { sub: 1 }], ["Lists", "", { sub: 1 }], ["Alignment", "", { sub: 1 }], "-", ["Start on a new page"], ["Heading numbers…"]],
    Review: [["New comment", "Cmd+Alt+M"], ["Comments panel", "", { panel: "comments" }], ["Next comment"], ["Resolve"], ["Orphaned comments…"]],
    View: [["Edit"], ["Markdown (read-only)"], ["Print preview"], "-", ["Outline", "", { panel: "outline" }]],
    Help: [["Shortcuts", "", { panel: "help" }], ["File format guide"]],
  },
};

const SUBMENUS = {
  slides: {
    "m-shape": ["Shape", [["Rectangle"], ["Rounded rectangle"], ["Ellipse"], ["Triangle"], ["Diamond"], ["Hexagon"], ["Parallelogram"], ["Pentagon arrow"], ["Chevron"], ["Right arrow"], ["Left arrow"], ["Up arrow"], ["Down arrow"], "-", ["Thin arrow →"], ["Thin arrow ↓"], ["Rule"]]],
    "m-block": ["Block", [["Box"], ["Tinted box"], ["Callout"], ["Key figure"]]],
    "m-chart": ["Chart", [["Columns"], ["Horizontal bars"], ["Stacked bars"], ["Lines"], ["Waterfall"], ["Bubbles"], ["Gantt"]]],
    "m-arrange": ["Arrange", MENUS.slides.Arrange],
    "m-layout": ["Layout", ["Title only", "Impact title", "Left title", "Section divider", "Quote", "Panel 1/4", "Panel 1/3", "Panel 1/2", "Panel 2/3", "Three lines", "Cover", "End"].map((l) => [l])],
    "m-newslide": ["New slide", ["Title only", "Impact title", "Left title", "Section divider", "Quote", "Panel 1/3", "Panel 1/2", "Three lines", "Cover", "End"].map((l) => [l])],
    "m-align": ["Alignment", [["Align left"], ["Centre"], ["Align right"]]],
    "m-more": ["More", [["Smaller text"], ["Larger text"], ["Align left"], ["Centre"], ["Align right"], "-", ["Arrange", "", { sub: 1 }], ["Duplicate", "Cmd+D"], ["Delete", "Del"], ["Clear formatting"]]],
  },
  data: {
    "m-numfmt": ["Number format", [["General"], ["Number"], ["Currency"], ["Accounting"], ["Percent"], ["Short date"], ["Long date"], "-", ["Thousands (k)", "", pl], ["Millions (M)", "", pl], ["Negative in parentheses", "", pl], ["Negative in red", "", pl]]],
    "m-cellstyle": ["Cell style", [["Normal"], ["Title"], ["Header"], ["Row label"], ["Assumption"], ["Calculation"], ["Output"], ["Total"], ["Note"], ["Alert"], "-", ["All cell styles…", "", { panel: "styles" }]]],
    "m-borders": ["Borders", [["All borders"], ["Inner borders"], ["Outer borders"], ["Top"], ["Bottom"], ["Left"], ["Right"], ["No borders"], "-", ["Thin"], ["Medium"], ["Double"], "-", ["Border colour", "", { sub: 1 }]]],
    "m-align": ["Alignment", [["General"], ["Left"], ["Centre"], ["Right"], ["Centre across selection"], "-", ["Wrap text"]]],
    "m-insert": ["Insert", [["Rows above"], ["Rows below"], ["Columns left"], ["Columns right"]]],
    "m-delete": ["Delete", [["Delete rows"], ["Delete columns"]]],
    "m-scenario": ["Scenario", [["Base"], ["Upside"], ["Downside"]]],
    "m-locale": ["Locale", [["English (United States)"], ["English (United Kingdom)"], ["Français (France)"], ["Deutsch"], ["Español"], ["Italiano"], "-", ["Regional settings…", "", { panel: "regional" }]]],
    "m-goto": ["Go to", [["C4"], ["Inputs!B2"], ["Summary!B2"]]],
    "m-sheets": ["Sheets", [["Summary"], ["Inputs"], ["Actuals"], ["Calculations"], "-", ["Manage sheets…"]]],
    "m-more": ["More", [["Borders", "", { sub: 1 }], ["Wrap text"], ["Centre across selection"], ["Link…", "Cmd+K"], ["Conditional formatting…"], ["Grid lines"], ["Copy style"], ["Clear formatting"], "-", ["Paste table…"], ["Fill down"], ["Fill right"], ["Recalculate", "F9"]]],
  },
  text: {
    "m-block": ["Block style", [["Title"], ["Subtitle"], ["Heading 1"], ["Heading 2"], ["Heading 3"], ["Heading 4"], ["Body"], ["Lead"], ["Quote"], ["Callout: note"], ["Callout: warning"], ["Callout: key message"], ["Caption"], ["Code"]]],
    "m-chart": ["Chart", [["Columns"], ["Horizontal bars"], ["Stacked bars"], ["Lines"], ["Waterfall"], ["Bubbles"], ["Gantt"]]],
    "m-align": ["Alignment", [["Align left"], ["Centre"], ["Align right"], ["Justify"]]],
    "m-page": ["Page format", [["A4"], ["Letter"]]],
    "m-margins": ["Margins", [["Normal"], ["Narrow"], ["Wide"]]],
    "m-more": ["More", [["Underline", "Cmd+U"], ["Superscript"], ["Subscript"], ["Inline code"], ["Highlight"], "-", ["Bulleted list"], ["Numbered list"], ["Indent"], ["Outdent"], "-", ["Page break"], ["Start on a new page"], ["Clear formatting"]]],
  },
};
function menus(product, { includeMain = true } = {}) {
  let out = "";
  if (includeMain)
    for (const [name, items] of Object.entries(MENUS[product])) out += menuPop(`m-${product}-${name.toLowerCase()}`, name, items);
  out += menuPop("m-main", "Menu", Object.keys(MENUS[product]).map((k) => [k, "", { sub: 1 }]));
  for (const [id, [title, items]] of Object.entries(SUBMENUS[product])) out += menuPop(id, title, items);
  return out + swatchPopovers();
}
const menubar = (product) =>
  `<nav class="menubar" role="menubar" aria-label="Menu">${Object.keys(MENUS[product])
    .map((k) => `<span class="mw"><button type="button" role="menuitem" class="mb" data-menu="m-${product}-${k.toLowerCase()}" aria-haspopup="true" aria-expanded="false">${k}</button></span>`)
    .join("")}</nav>`;

const identity = (p, { chip = true } = {}) =>
  `<div class="ident"><span class="mark mk-${p}" aria-hidden="true">${PRODUCTS[p].mark}</span><div class="tt"><span class="title" title="${esc(PRODUCTS[p].title)}">${esc(PRODUCTS[p].title)}</span>${chip ? `<span class="state" role="status">${p === "text" ? "Unsaved changes" : "Saved"}</span>` : ""}</div></div>`;

const saveBtn = (p) => btn({ ic: "save", label: "Save", text: "Save", key: "Cmd+S", cls: `primary${p === "text" ? " dirty" : ""}` });
const presentBtn = () => btn({ ic: "play", label: "Present", text: "Present", key: "P", cls: "ghost" });

// ---------- formatting command groups, reused by A and C ----------
const H = {
  history: () => grp("History", btn({ ic: "undo", label: "Undo", key: "Cmd+Z" }), btn({ ic: "redo", label: "Redo", key: "Cmd+Shift+Z" })),
  slidesInsert: () =>
    grp("Insert", btn({ ic: "textbox", label: "Text box" }), btn({ ic: "shape", label: "Shape", dd: true, menu: "m-shape" }), btn({ ic: "block", label: "Block", dd: true, menu: "m-block" }), btn({ ic: "image", label: "Image" }), btn({ ic: "table", label: "Table" }), btn({ ic: "chart", label: "Chart", dd: true, menu: "m-chart" })),
  slidesText: () => grp("Text", btn({ glyph: "A<sub>−</sub>", label: "Smaller text" }), btn({ glyph: "A<sup>+</sup>", label: "Larger text" }), btn({ glyph: "<b>B</b>", label: "Bold", key: "Cmd+B" }), btn({ glyph: "<i>I</i>", label: "Italic", key: "Cmd+I" })),
  colours: (clear = true) => grp("Colour", colourButton("color"), colourButton("fill"), clear ? btn({ ic: "eraser", label: "Clear formatting" }) : ""),
  align3: () => grp("Alignment", btn({ ic: "alignL", label: "Align left", pressed: true }), btn({ ic: "alignC", label: "Centre", pressed: false }), btn({ ic: "alignR", label: "Align right", pressed: false })),
  dataNumber: () => grp("Number", btn({ glyph: "€", label: "Currency" }), btn({ glyph: "%", label: "Percent" }), btn({ glyph: ".0<sub>←</sub>", label: "Fewer decimals" }), btn({ glyph: ".00<sub>→</sub>", label: "More decimals" }), picker({ label: "Number format", value: "Currency", menu: "m-numfmt", width: 96 })),
  dataFont: () => grp("Emphasis", btn({ glyph: "<b>B</b>", label: "Bold", key: "Cmd+B" }), btn({ glyph: "<i>I</i>", label: "Italic", key: "Cmd+I" })),
  dataAlign: () =>
    grp("Alignment", btn({ ic: "alignL", label: "Align left" }), btn({ ic: "alignC", label: "Centre" }), btn({ ic: "alignR", label: "Align right" }), btn({ ic: "across", label: "Centre across selection" }), btn({ ic: "wrap", label: "Wrap text" })),
  textInline: () =>
    grp("Inline", btn({ glyph: "<b>B</b>", label: "Bold", key: "Cmd+B" }), btn({ glyph: "<i>I</i>", label: "Italic", key: "Cmd+I" }), btn({ glyph: "<u>U</u>", label: "Underline", key: "Cmd+U" }), btn({ glyph: "x<sup>2</sup>", label: "Superscript" }), btn({ glyph: "x<sub>2</sub>", label: "Subscript" }), btn({ ic: "code", label: "Inline code" }), btn({ ic: "highlight", label: "Highlight" }), btn({ ic: "link", label: "Link", key: "Cmd+K" })),
  textLists: () => grp("Lists", btn({ ic: "bullets", label: "Bulleted list" }), btn({ ic: "numbers", label: "Numbered list" }), btn({ ic: "outdent", label: "Outdent" }), btn({ ic: "indent", label: "Indent" })),
  textAlign: () => grp("Alignment", btn({ ic: "alignL", label: "Align left", pressed: true }), btn({ ic: "alignC", label: "Centre", pressed: false }), btn({ ic: "alignR", label: "Align right", pressed: false }), btn({ ic: "alignJ", label: "Justify", pressed: false })),
  textInsert: () => grp("Insert", btn({ ic: "table", label: "Table" }), btn({ ic: "chart", label: "Chart", dd: true, menu: "m-chart" }), btn({ ic: "image", label: "Image" }), btn({ ic: "footnote", label: "Footnote" }), btn({ ic: "comment", label: "Comment", key: "Cmd+Alt+M" })),
};

const toolbar = (label, inner) =>
  `<div class="tbar" role="toolbar" aria-label="${label}"><button type="button" class="ovf ovl" aria-label="Scroll toolbar left" tabindex="-1">‹</button><div class="tscroll">${inner}</div><button type="button" class="ovf ovr" aria-label="Scroll toolbar right" tabindex="-1">›</button></div>`;

// ---------- Variant A: menu bar + IronCalc-style icon toolbar ----------
function variantA(p) {
  const right = { slides: presentBtn() + saveBtn(p), data: saveBtn(p), text: saveBtn(p) }[p];
  const row1 = `<div class="row r1">${identity(p)}${menubar(p)}${spacer()}<div class="acts">${right}</div>${btn({ ic: "menu", label: "Menu", menu: "m-main", cls: "only-narrow" })}</div>`;
  const tb = {
    slides:
      H.history() + H.slidesInsert() + `<span class="ctx-chip" title="Commands below follow the selection">Chart</span>` + H.slidesText() + H.colours() + H.align3() +
      grp("Arrange", btn({ ic: "arrange", label: "Arrange", text: "Arrange", dd: true, menu: "m-arrange" })) +
      grp("Chart", btn({ ic: "chart", label: "Edit chart data", text: "Edit data" })) +
      grp("Element", btn({ ic: "copy", label: "Duplicate", key: "Cmd+D" }), btn({ ic: "trash", label: "Delete", key: "Delete" })),
    data:
      H.history() + grp("Clipboard", btn({ ic: "painter", label: "Copy style" }), btn({ ic: "eraser", label: "Clear formatting" })) + H.dataNumber() +
      grp("Cell style", picker({ label: "Cell style", value: "Calculation", menu: "m-cellstyle", width: 108 })) + H.dataFont() + H.colours(false) +
      grp("Borders", btn({ ic: "borders", label: "Borders", dd: true, menu: "m-borders" })) + H.dataAlign() +
      grp("Insert", btn({ ic: "link", label: "Link", key: "Cmd+K" }), btn({ ic: "condfmt", label: "Conditional formatting" }), btn({ ic: "gridlines", label: "Grid lines", pressed: true })) +
      spacer() + grp("Panels", btn({ ic: "styles", label: "Cell styles panel", text: "Styles", panel: "styles" })),
    text:
      H.history() + grp("Block style", picker({ label: "Block style", value: "Lead", menu: "m-block", width: 104 })) + H.textInline() + H.textLists() + H.textAlign() + H.textInsert() +
      grp("Clear", btn({ ic: "eraser", label: "Clear formatting" })) + spacer() + grp("Panels", btn({ ic: "comment", label: "Comments panel", text: "Comments 2", panel: "comments" })),
  }[p];
  const top = `<header class="top">${row1}<div class="row r2">${toolbar(p === "slides" ? "Slide and selection" : "Formatting", tb)}</div>${p === "data" ? C.formulaBar() : ""}</header>`;
  const pill =
    p === "data"
      ? ""
      : `<div class="pill" role="group" aria-label="Document settings and view">${btn({ ic: "palette", label: "Document settings: theme and font", text: "Theme & font", panel: "settings" })}<span class="pill-sep"></span>${
          p === "slides" ? `<span class="pill-info">2 / 5</span>${btn({ ic: "zoom", label: "Zoom", text: "Fit" })}` : `<span class="pill-info">Page 1 / 17 · A4</span>${btn({ ic: "zoom", label: "Zoom", text: "100%" })}`
        }</div>`;
  const bottom = p === "data" ? C.sheetTabs({ settings: true }) : "";
  return { top, bottom, pill, overlay: true };
}

// ---------- Variant B: tabbed ribbon with labelled groups ----------
const rg = (caption, ...items) => `<div class="rgrp" role="group" aria-label="${esc(caption)}"><button type="button" class="b t gsum" data-menu="m-more" aria-haspopup="true" aria-expanded="false"><span class="lbl">${esc(caption)}</span>${icon("caret").replace('class="ic"', 'class="ic car"')}</button><div class="gbody">${items.join("")}</div><span class="cap">${esc(caption)}</span></div>`;
const L = (ic, label, extra = {}) => btn({ ic, label, text: label, ...extra });
function ribbonTabs(p) {
  const themeInline = `<div class="rtheme">${C.themePicker()}</div>`;
  const T = {
    slides: {
      Home: [
        rg("Slide", L("plus", "New slide", { dd: true, menu: "m-newslide" }), L("layout", "Layout", { dd: true, menu: "m-layout" }), btn({ ic: "reset", label: "Reset layout" })),
        rg("Text", btn({ glyph: "A<sub>−</sub>", label: "Smaller text" }), btn({ glyph: "A<sup>+</sup>", label: "Larger text" }), btn({ glyph: "<b>B</b>", label: "Bold" }), btn({ glyph: "<i>I</i>", label: "Italic" }), btn({ ic: "alignL", label: "Align left" }), btn({ ic: "alignC", label: "Centre" }), btn({ ic: "alignR", label: "Align right" })),
        rg("Colour", colourButton("color"), colourButton("fill"), btn({ ic: "eraser", label: "Clear formatting" })),
        rg("Arrange", L("arrange", "Arrange", { dd: true, menu: "m-arrange" })),
        rg("Chart", L("chart", "Edit data")),
        rg("Element", btn({ ic: "copy", label: "Duplicate" }), btn({ ic: "trash", label: "Delete" })),
      ],
      Insert: [rg("Insert", L("textbox", "Text box"), L("shape", "Shape", { dd: true, menu: "m-shape" }), L("block", "Block", { dd: true, menu: "m-block" }), L("image", "Image"), L("table", "Table"), L("chart", "Chart", { dd: true, menu: "m-chart" }))],
      Slide: [rg("Slide", L("plus", "New slide", { dd: true, menu: "m-newslide" }), L("layout", "Layout", { dd: true, menu: "m-layout" }), L("reset", "Reset layout"), L("footer", "Footer…"), L("copy", "Duplicate"), L("trash", "Delete"))],
      Document: [rg("Theme", themeInline), rg("Font", C.fontPicker({ compact: true })), rg("Footer", `<label class="fld inline">Footer text<input value="Community Learning · Year-one review"></label>`)],
      View: [rg("Show", L("play", "Present"), L("print", "Print / PDF")), rg("Help", L("help", "Shortcuts", { panel: "help" }), L("markdown", "File format guide"))],
    },
    data: {
      Home: [
        rg("Clipboard", L("table", "Paste table"), btn({ ic: "download", label: "Fill down" }), btn({ ic: "indent", label: "Fill right" }), btn({ ic: "painter", label: "Copy style" }), btn({ ic: "eraser", label: "Clear formatting" })),
        rg("Font", btn({ glyph: "<b>B</b>", label: "Bold" }), btn({ glyph: "<i>I</i>", label: "Italic" }), colourButton("color"), colourButton("fill"), btn({ ic: "borders", label: "Borders", dd: true, menu: "m-borders" })),
        rg("Alignment", btn({ ic: "alignL", label: "Align left" }), btn({ ic: "alignC", label: "Centre" }), btn({ ic: "alignR", label: "Align right" }), btn({ ic: "across", label: "Centre across selection" }), btn({ ic: "wrap", label: "Wrap text" })),
        rg("Number", picker({ label: "Number format", value: "Currency", menu: "m-numfmt", width: 92 }), btn({ glyph: "€", label: "Currency" }), btn({ glyph: "%", label: "Percent" }), btn({ glyph: ".0<sub>←</sub>", label: "Fewer decimals" }), btn({ glyph: ".00<sub>→</sub>", label: "More decimals" })),
        rg("Styles", `<div class="minigal">${["header", "rowHeader", "assumption", "calculation", "total"].map((s) => `<button type="button" class="mg cs-${s}${s === "calculation" ? " on" : ""}" aria-pressed="${s === "calculation"}" title="${s}">${{ header: "Header", rowHeader: "Row label", assumption: "Assumption", calculation: "Calculation", total: "Total" }[s]}</button>`).join("")}</div>`, btn({ ic: "styles", label: "All cell styles", panel: "styles" })),
        rg("Cells", L("rowAdd", "Insert", { dd: true, menu: "m-insert" }), L("rowDel", "Delete", { dd: true, menu: "m-delete" })),
      ],
      Insert: [rg("Insert", L("rowAdd", "Rows"), L("colAdd", "Columns"), L("sheet", "Sheet"), L("link", "Link", { planned: 1 }), L("chart", "Chart", { planned: 1 }), L("pivot", "Pivot", { planned: 1 }))],
      Data: [rg("Calculate", L("calc", "Recalculate"), picker({ label: "Scenario", value: "Scenario: Base", menu: "m-scenario" })), rg("Rules", L("dropdown", "Dropdowns…"), L("condfmt", "Conditional…")), rg("Sheets", L("sheet", "Manage sheets…")), rg("Sources", L("upload", "Import", { planned: 1 }), L("calc", "Refresh", { planned: 1 }))],
      Document: [rg("Theme", themeInline), rg("Font", C.fontPicker({ compact: true })), rg("Regional", picker({ label: "Locale", value: "English (US)", menu: "m-locale" }), L("globe", "More…", { panel: "regional" }))],
      View: [rg("Show", L("gridlines", "Grid lines", { planned: 1 }), L("fx", "Formula bar")), rg("Output", L("download", "PNG", { planned: 1 }), L("download", "CSV", { planned: 1 }), L("print", "Print / PDF", { planned: 1 })), rg("Help", L("help", "Shortcuts", { panel: "help" }))],
    },
    text: {
      Home: [
        rg("Styles", `<div class="minigal tx">${[["Body", "b"], ["Lead", "l"], ["Heading 1", "h1"], ["Heading 2", "h2"], ["Quote", "q"], ["Callout", "c"]].map(([n, k]) => `<button type="button" class="mg tg-${k}${k === "l" ? " on" : ""}" aria-pressed="${k === "l"}">${n}</button>`).join("")}</div>`, btn({ ic: "caret", label: "All block styles", menu: "m-block" })),
        rg("Font", btn({ glyph: "<b>B</b>", label: "Bold" }), btn({ glyph: "<i>I</i>", label: "Italic" }), btn({ glyph: "<u>U</u>", label: "Underline" }), btn({ glyph: "x<sup>2</sup>", label: "Superscript" }), btn({ glyph: "x<sub>2</sub>", label: "Subscript" }), btn({ ic: "code", label: "Inline code" }), btn({ ic: "highlight", label: "Highlight" })),
        rg("Paragraph", btn({ ic: "bullets", label: "Bulleted list" }), btn({ ic: "numbers", label: "Numbered list" }), btn({ ic: "outdent", label: "Outdent" }), btn({ ic: "indent", label: "Indent" }), btn({ ic: "alignL", label: "Align left" }), btn({ ic: "alignC", label: "Centre" }), btn({ ic: "alignR", label: "Align right" }), btn({ ic: "alignJ", label: "Justify" })),
        rg("Edit", btn({ ic: "link", label: "Link" }), btn({ ic: "eraser", label: "Clear formatting" })),
      ],
      Insert: [rg("Insert", L("table", "Table"), L("chart", "Chart", { dd: true, menu: "m-chart" }), L("image", "Image"), L("footnote", "Footnote"), L("xref", "Cross-ref"), L("toc", "Contents"), L("pagebreak", "Page break"), L("link", "Link"))],
      Review: [rg("Comments", L("comment", "New comment"), L("comment", "Comments", { panel: "comments" }), btn({ ic: "outdent", label: "Previous comment" }), btn({ ic: "indent", label: "Next comment" }), L("check", "Resolve"))],
      Document: [rg("Theme", themeInline), rg("Font", C.fontPicker({ compact: true })), rg("Page", picker({ label: "Page format", value: "A4", menu: "m-page" }), picker({ label: "Margins", value: "Normal margins", menu: "m-margins" }), L("footer", "Header & footer…")), rg("Numbering", L("numbers", "Heading numbers"))],
      View: [rg("Mode", L("textbox", "Edit"), L("markdown", "Markdown"), L("eye", "Print preview")), rg("Navigate", L("outline", "Outline", { panel: "outline" })), rg("Output", L("print", "Print / PDF"), L("download", "Export Markdown")), rg("Help", L("help", "Shortcuts", { panel: "help" }))],
    },
  }[p];
  return T;
}
function variantB(p, state) {
  const tabs = ribbonTabs(p);
  const names = Object.keys(tabs);
  const active = state.tab;
  const tablist = `<div class="tabs" role="tablist" aria-label="Ribbon">${names
    .map((n) => `<button type="button" role="tab" id="tab-${n.toLowerCase()}" data-tab="${n.toLowerCase()}" aria-controls="rp-${n.toLowerCase()}" aria-selected="${n.toLowerCase() === active}" tabindex="${n.toLowerCase() === active ? 0 : -1}">${n}</button>`)
    .join("")}</div><label class="tabsel"><span class="vh">Ribbon tab</span><select data-tab-select>${names.map((n) => `<option value="${n.toLowerCase()}"${n.toLowerCase() === active ? " selected" : ""}>${n}</option>`).join("")}</select></label>`;
  const qa = `<div class="acts">${btn({ ic: "undo", label: "Undo", key: "Cmd+Z" })}${btn({ ic: "redo", label: "Redo", key: "Cmd+Shift+Z" })}${p === "slides" ? presentBtn() : ""}${saveBtn(p)}</div>`;
  const row1 = `<div class="row r1">${identity(p)}${tablist}${spacer()}${qa}</div>`;
  const panels = names
    .map((n) => `<div class="rpanel" role="tabpanel" id="rp-${n.toLowerCase()}" aria-labelledby="tab-${n.toLowerCase()}"${n.toLowerCase() === active ? "" : " hidden"}>${toolbar(n + " commands", tabs[n].join(""))}</div>`)
    .join("");
  const top = `<header class="top">${row1}<div class="row r2 ribbon">${panels}</div>${p === "data" ? C.formulaBar() : ""}</header>`;
  const status = {
    slides: `<footer class="status" role="contentinfo"><span class="si">Slide 2 of 5</span><span class="si">Chart selected</span>${spacer()}<span class="si mute" data-theme-label>Theme: Blue · Arial</span>${btn({ ic: "zoom", label: "Zoom", text: "Fit", cls: "sm" })}</footer>`,
    data: `<footer class="status data">${C.sheetTabs({ stats: true })}</footer>`,
    text: `<footer class="status" role="contentinfo"><span class="si">Page 1 of 17</span><span class="si">4,812 words</span><span class="si">A4</span>${spacer()}<div class="seg" role="group" aria-label="View"><button type="button" aria-pressed="true">Edit</button><button type="button" aria-pressed="false">Markdown</button><button type="button" aria-pressed="false">Print preview</button></div>${btn({ ic: "zoom", label: "Zoom", text: "100%", cls: "sm" })}</footer>`,
  }[p];
  return { top, bottom: status, pill: "", overlay: false };
}

// ---------- Variant C: one toolbar row + side rail ----------
function variantC(p) {
  const core = {
    slides: H.history() + H.slidesText() + H.colours(false) + grp("Alignment", btn({ ic: "alignL", label: "Alignment", dd: true, menu: "m-align" })) + grp("Chart", btn({ ic: "chart", label: "Edit chart data", text: "Data" })) + grp("More", btn({ ic: "more", label: "More commands", menu: "m-more" })),
    data:
      H.history() + grp("Cell style", picker({ label: "Cell style", value: "Calculation", menu: "m-cellstyle", width: 104 })) + H.dataFont() + H.colours(false) +
      grp("Alignment", btn({ ic: "alignL", label: "Alignment", dd: true, menu: "m-align" })) + grp("Number", btn({ glyph: "€", label: "Currency" }), btn({ glyph: "%", label: "Percent" }), btn({ glyph: ".0<sub>←</sub>", label: "Fewer decimals" }), btn({ glyph: ".00<sub>→</sub>", label: "More decimals" }), picker({ label: "Number format", value: "Currency", menu: "m-numfmt", width: 92 })) +
      grp("More", btn({ ic: "more", label: "More commands", menu: "m-more" })),
    text:
      H.history() + grp("Block style", picker({ label: "Block style", value: "Lead", menu: "m-block", width: 96 })) + grp("Inline", btn({ glyph: "<b>B</b>", label: "Bold" }), btn({ glyph: "<i>I</i>", label: "Italic" }), btn({ ic: "link", label: "Link" })) +
      grp("Lists", btn({ ic: "bullets", label: "Bulleted list" }), btn({ ic: "numbers", label: "Numbered list" })) + grp("Alignment", btn({ ic: "alignL", label: "Alignment", dd: true, menu: "m-align" })) + grp("More", btn({ ic: "more", label: "More commands", menu: "m-more" })),
  }[p];
  const right = `<div class="acts">${p === "slides" ? presentBtn() : ""}${saveBtn(p)}${btn({ ic: "menu", label: "File and help menu", menu: "m-main" })}</div>`;
  const top = `<header class="top"><div class="row r1 single">${identity(p)}<span class="sep tall"></span>${toolbar("Formatting", core)}${right}</div>${p === "data" ? C.formulaBar() : ""}</header>`;
  const rail = {
    slides: [["insert", "plus", "Insert"], ["slide", "layout", "Slide"], ["settings", "palette", "Document"], ["help", "help", "Help"]],
    data: [["insert", "plus", "Insert"], ["styles", "styles", "Styles"], ["regional", "globe", "Regional"], ["settings", "palette", "Document"], ["help", "help", "Help"]],
    text: [["insert", "plus", "Insert"], ["outline", "outline", "Outline"], ["comments", "comment", "Comments"], ["settings", "palette", "Document"], ["help", "help", "Help"]],
  }[p];
  const railHTML = `<nav class="rail" aria-label="Panels">${rail
    .map(([id, ic, l]) => `<button type="button" class="rb${id === "help" ? " end" : ""}" data-panel="${id}" aria-pressed="false">${icon(ic)}<span>${l}</span></button>`)
    .join("")}</nav>`;
  return { top, bottom: p === "data" ? C.sheetTabs() : "", pill: "", overlay: false, rail: railHTML };
}

export const VARIANTS = {
  a: { name: "A — Menu bar + icon toolbar", short: "Two rows", build: variantA },
  b: { name: "B — Tabbed ribbon", short: "Ribbon", build: variantB },
  c: { name: "C — One toolbar + side rail", short: "Rail", build: variantC },
};

export function panelsFor(p, v) {
  const list = [C.settingsPanel(p), C.helpPanel(p)];
  if (p === "data") list.push(C.stylesPanel(), C.regionalPanel());
  if (p === "text") list.push(C.commentsPanel(), C.outlinePanel());
  if (v === "c") {
    list.push(C.insertPanel(p));
    if (p === "slides") list.push(C.slidePanel());
  }
  return list.join("");
}

export function canvasFor(p) {
  if (p === "slides") return `${C.thumbs()}<main class="canvas c-slides" aria-label="Slide editor">${C.slideStage()}</main>`;
  if (p === "data") return `<main class="canvas c-data" aria-label="Workbook">${C.grid()}</main>`;
  return `<main class="canvas c-text" aria-label="Document">${C.page()}</main>`;
}

export { menus };
