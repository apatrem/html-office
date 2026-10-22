// Variant A for html-data built from the shared native shell components.
// Commands the current model supports go through the existing canonical
// handlers (bridge); ADR-012 features without a model yet are recorded as
// intents, exactly as in R05, so the two spikes compare like for like.
import { h, button, icon } from "./shell/dom.mjs";
import { menubar, menuButton } from "./shell/menu.mjs";
import { toolbar, group, spacer } from "./shell/toolbar.mjs";
import { openSwatches, openBorders } from "./shell/pickers.mjs";
import { drawer as createDrawer } from "./shell/drawer.mjs";
import { linkDialog } from "./shell/dialogs.mjs";
import { cellStylesBody, regionalBody, documentBody, CELL_STYLES, LOCALES } from "./shell/panels.mjs";

const MODEL_STYLES = new Set(["normal", "title", "header", "rowHeader", "assumption", "calculation", "output", "total", "note", "hyperlink"]);
const FORMATS = [
  ["General", { kind: "general" }],
  ["Number", { kind: "number", digits: 2 }],
  ["Currency", { kind: "currency", currency: "EUR", digits: 2 }],
  ["Accounting", { kind: "accounting", currency: "EUR", digits: 2 }],
  ["Percent", { kind: "percent", digits: 1 }],
  ["Short date", { kind: "date", dateStyle: "short" }],
  ["Long date", { kind: "date", dateStyle: "long" }],
  "-",
  ["Thousands (k)", { kind: "number", digits: 1, scale: "thousands" }],
  ["Millions (M)", { kind: "number", digits: 1, scale: "millions" }],
  ["Negative in parentheses", { kind: "number", digits: 0, negative: "parentheses" }],
  ["Negative in red", { kind: "number", digits: 0, negative: "red" }],
];
function formatLabel(format) {
  if (format.kind === "date") return format.dateStyle === "long" ? "Long date" : "Short date";
  if (format.scale) return format.scale === "thousands" ? "Thousands" : "Millions";
  return { general: "General", number: "Number", currency: "Currency", accounting: "Accounting", percent: "Percent" }[format.kind];
}

export function mountDataShell({ root, drawerHost, bridge }) {
  const t0 = performance.now();
  const intents = (globalThis.toolbarSpikeIntents = []);
  const styles = new Map(); // recorded direct formatting per cell, mirrors R05
  const ui = { theme: "document", font: "arial", locale: bridge.state().locale ?? "en-US", gridLines: true, border: { style: "thin", color: "ink" }, color: "ink", fill: "none" };
  const status = h("p", { class: "vh", role: "status", id: "toolbar-status" });
  const record = (kind, payload) => {
    const { sheetId, address } = bridge.state();
    intents.push({ kind, payload, sheetId, address });
    status.textContent = `Recorded intent: ${kind}`;
  };
  const key = () => {
    const s = bridge.state();
    return s.sheetId + "!" + s.address;
  };
  const cellStyle = () => styles.get(key()) ?? {};
  const setStyle = (kind, patch) => {
    styles.set(key(), { ...cellStyle(), ...patch });
    record(kind, patch);
    sync();
  };
  const drawer = createDrawer(drawerHost);
  const click = (id) => () => bridge.command(id);
  const safely = (fn) => () => {
    try {
      fn();
    } catch (error) {
      status.textContent = error.message;
    }
  };
  const applyFormat = (format) => safely(() => bridge.format(format))();
  const applyCellStyle = (name) => (MODEL_STYLES.has(name) ? safely(() => bridge.cellStyle(name))() : record("cellStyle.apply", { name }));

  // ---------- panels ----------
  const panels = {
    styles: () => ({
      title: "Cell styles",
      subtitle: `Selection ${bridge.state().address}`,
      body: () =>
        cellStylesBody({
          current: bridge.state().cellStyle,
          onApply: applyCellStyle,
          extra: h("div", { class: "sh-prow" }, button({ label: "Clear formatting", ic: "eraser", text: "Clear formatting", cls: "sh-ghost", onClick: () => bridge.clear() })),
        }),
    }),
    regional: () => ({
      title: "Regional settings",
      subtitle: "Display only",
      body: () => regionalBody({ locale: ui.locale, onSave: (locale) => { ui.locale = locale; record("regional.save", { locale }); } }),
    }),
    settings: () => ({
      title: "Document settings",
      subtitle: "Saved in this file",
      body: () =>
        documentBody({
          theme: ui.theme,
          font: ui.font,
          onTheme: (theme) => { ui.theme = theme; record("theme.pick", { theme }); },
          onFont: (font) => { ui.font = font; record("font.pick", { font }); },
          fontNote: "Applies to the whole grid; one size for every cell.",
          extra: [h("h3", {}, "Regional"), h("p", { class: "sh-hint" }, `Locale: ${LOCALES.find(([v]) => v === ui.locale)?.[1] ?? ui.locale}`), h("div", { class: "sh-prow" }, button({ label: "Regional settings…", ic: "globe", text: "Regional settings…", cls: "sh-ghost", onClick: () => openPanel("regional") }))],
        }),
    }),
  };
  const openPanel = (id, trigger) => drawer.open(id, { ...panels[id](), trigger });
  const openLink = () => {
    const s = bridge.state(),
      existing = cellStyle().link;
    linkDialog({
      sheets: s.sheetNames,
      currentSheet: s.sheetName,
      initial: existing,
      label: s.displayText,
      onSave: (link, label) => setStyle("link.set", { link, label }),
      onRemove: () => setStyle("link.delete", { link: null }),
    });
  };
  const toggleGrid = () => {
    ui.gridLines = !ui.gridLines;
    document.getElementById("grid").classList.toggle("assessment-no-grid", !ui.gridLines);
    sync();
  };
  const changeDecimals = (delta) => {
    const f = bridge.state().format;
    if (f.kind === "date") return;
    const base = f.kind === "general" ? { kind: "number", digits: 0 } : f;
    const digits = Math.max(0, Math.min(15, (base.digits ?? 0) + delta));
    applyFormat({ ...base, digits });
  };

  // ---------- menus (every Data command has a home here) ----------
  const fmtItems = () => FORMATS.map((f) => (f === "-" ? f : { label: f[0], onSelect: () => applyFormat(f[1]) }));
  const styleItems = () => [
    ...CELL_STYLES.map(([id, name]) => ({ label: name, checked: bridge.state().cellStyle === id, onSelect: () => applyCellStyle(id) })),
    "-",
    { label: "All cell styles…", onSelect: () => openPanel("styles") },
  ];
  const menus = [
    { name: "File", items: () => [
      { label: "Save", shortcut: "Cmd+S", onSelect: click("direct-save") },
      { label: "Save a copy", onSelect: click("save") },
      "-",
      { label: "Import CSV / XLSX…", planned: true, disabled: true },
      { label: "Export CSV", planned: true, disabled: true },
      { label: "Download PNG of selection", planned: true, onSelect: () => record("export.png", {}) },
      { label: "Print / PDF…", planned: true, disabled: true },
      "-",
      { label: "Document settings…", onSelect: () => openPanel("settings") },
      { label: "Regional settings…", onSelect: () => openPanel("regional") },
      "-",
      { label: "File format guide", onSelect: () => openDetails(0) },
      { label: "Third-party notices", onSelect: () => openDetails(1) },
    ] },
    { name: "Edit", items: () => [
      { label: "Undo", shortcut: "Cmd+Z", disabled: !bridge.state().canUndo, onSelect: click("undo") },
      { label: "Redo", shortcut: "Cmd+Shift+Z", disabled: !bridge.state().canRedo, onSelect: click("redo") },
      "-",
      { label: "Paste table…", onSelect: click("paste-table") },
      { label: "Fill down", onSelect: click("fill-down") },
      { label: "Fill right", onSelect: click("fill-right") },
      "-",
      { label: "Copy style", planned: true, onSelect: () => record("painter.start", {}) },
      { label: "Clear formatting", onSelect: () => bridge.clear() },
    ] },
    { name: "Insert", items: () => [
      { label: "Insert rows", onSelect: click("insert-row") },
      { label: "Insert columns", onSelect: click("insert-column") },
      { label: "Delete rows", onSelect: click("delete-row") },
      { label: "Delete columns", onSelect: click("delete-column") },
      "-",
      { label: "Link…", shortcut: "Cmd+K", onSelect: openLink },
      { label: "Chart", planned: true, disabled: true },
      { label: "Pivot", planned: true, disabled: true },
    ] },
    { name: "Format", items: () => [
      { label: "Cell styles…", onSelect: () => openPanel("styles") },
      ...fmtItems().slice(0, 7),
      "-",
      { label: "Conditional formatting…", onSelect: click("manage-conditional") },
      { label: "Column width…", planned: true, onSelect: () => record("column.width", {}) },
      { label: "Auto-fit columns", planned: true, onSelect: () => record("column.autofit", {}) },
    ] },
    { name: "Data", items: () => [
      { label: "Recalculate", onSelect: click("recalculate") },
      { label: "Dropdown settings…", onSelect: click("manage-dropdowns") },
      { label: "Manage sheets…", onSelect: click("manage-sheets") },
    ] },
    { name: "View", items: () => [{ label: "Grid lines", checked: ui.gridLines, onSelect: toggleGrid }] },
  ];
  function openDetails(index) {
    const d = document.querySelectorAll("main > details")[index];
    if (!d) return;
    d.open = true;
    d.scrollIntoView({ block: "start" });
    d.querySelector("summary").focus();
  }

  // ---------- rows ----------
  const saveBtn = button({ label: "Save", ic: "save", text: "Save", cls: "sh-primary", title: "Save (Cmd+S)", onClick: click("direct-save") });
  const stateText = h("span", { class: "sh-state" });
  const narrowMenu = menuButton(button({ label: "Menu", ic: "menu", cls: "sh-only-narrow" }), () => menus.flatMap((m, i) => [...(i ? ["-"] : []), { heading: m.name }, ...m.items()]), "Menu");
  const row1 = h(
    "div",
    { class: "sh-row" },
    h("div", { class: "sh-ident" }, h("span", { class: "sh-mark", "aria-hidden": "true" }, "D"), h("div", { class: "sh-tt" }, h("p", { class: "sh-title" }, bridge.state().title), stateText)),
    menubar("Workbook menu", menus),
    spacer(),
    saveBtn,
    narrowMenu,
  );

  const B = {};
  const add = (id, spec) => (B[id] = button(spec));
  const numberPick = menuButton(h("button", { type: "button", class: "sh-b sh-pick", title: "Number format" }, h("span", { class: "sh-lbl" }), icon("caret", "sh-ic sh-car")), fmtItems, "Number format");
  const stylePick = menuButton(h("button", { type: "button", class: "sh-b sh-pick", title: "Cell style" }, h("span", { class: "sh-lbl" }), icon("caret", "sh-ic sh-car")), styleItems, "Cell style");
  const colourBtn = (kind) => {
    const bar = h("span", { class: "sh-swbar" });
    const b = h("button", { type: "button", class: "sh-b sh-colour", "aria-label": kind === "fill" ? "Fill colour" : "Text colour", title: kind === "fill" ? "Fill colour" : "Text colour", "aria-haspopup": "dialog", "aria-expanded": "false" },
      kind === "fill" ? icon("fill") : h("span", { class: "sh-g" }, h("b", {}, "A")), bar);
    b.addEventListener("click", () =>
      openSwatches(b, kind, ui[kind === "fill" ? "fill" : "color"], (token) => {
        ui[kind === "fill" ? "fill" : "color"] = token;
        setStyle(kind === "fill" ? "style.fill" : "style.color", { [kind === "fill" ? "fill" : "color"]: token });
      }),
    );
    b.bar = bar;
    return b;
  };
  B.color = colourBtn("color");
  B.fill = colourBtn("fill");
  B.borders = h("button", { type: "button", class: "sh-b", "aria-label": "Borders", title: "Borders", "aria-haspopup": "dialog", "aria-expanded": "false" }, icon("borders"), icon("caret", "sh-ic sh-car"));
  B.borders.addEventListener("click", () => openBorders(B.borders, ui.border, (border) => record("style.border", border)));
  const stylesToggle = drawer.toggle(button({ label: "Cell styles panel", ic: "styles", text: "Styles" }), "styles", panels.styles);
  const tb = toolbar(
    "Formatting",
    group("History", add("undo", { label: "Undo", ic: "undo", title: "Undo (Cmd+Z)", onClick: click("undo") }), add("redo", { label: "Redo", ic: "redo", title: "Redo (Cmd+Shift+Z)", onClick: click("redo") })),
    group("Clipboard", add("painter", { label: "Copy style", ic: "painter", onClick: () => record("painter.start", {}) }), add("clear", { label: "Clear formatting", ic: "eraser", onClick: () => bridge.clear() })),
    group(
      "Number",
      add("currency", { label: "Format as currency", glyph: "€", onClick: () => applyFormat({ kind: "currency", currency: "EUR", digits: 2 }) }),
      add("percent", { label: "Format as percentage", glyph: "%", onClick: () => applyFormat({ kind: "percent", digits: 1 }) }),
      add("decLess", { label: "Decrease decimal places", glyph: ".0<sub>←</sub>", onClick: () => changeDecimals(-1) }),
      add("decMore", { label: "Increase decimal places", glyph: ".00<sub>→</sub>", onClick: () => changeDecimals(1) }),
      numberPick,
    ),
    group("Cell style", stylePick),
    group("Emphasis",
      add("bold", { label: "Bold", glyph: "<b>B</b>", pressed: false, title: "Bold (Cmd+B)", onClick: () => setStyle("style.bold", { bold: !cellStyle().bold }) }),
      add("italic", { label: "Italic", glyph: "<i>I</i>", pressed: false, title: "Italic (Cmd+I)", onClick: () => setStyle("style.italic", { italic: !cellStyle().italic }) })),
    group("Colour", B.color, B.fill),
    group("Borders", B.borders),
    group(
      "Alignment",
      ...[["left", "Align left", "alignL"], ["center", "Align centre", "alignC"], ["right", "Align right", "alignR"], ["centerContinuous", "Center across selection", "across"]].map(([value, label, ic]) =>
        add("align-" + value, { label, ic, pressed: false, onClick: () => setStyle("style.align.horizontal", { horizontal: cellStyle().horizontal === value ? "general" : value }) }),
      ),
      add("wrap", { label: "Wrap text", ic: "wrap", pressed: false, onClick: () => setStyle("style.wrap", { wrap: !cellStyle().wrap }) }),
    ),
    group("Insert",
      add("link", { label: "Insert link", ic: "link", title: "Insert link (Cmd+K)", onClick: openLink }),
      add("conditional", { label: "Conditional formatting", ic: "condfmt", onClick: click("manage-conditional") }),
      add("grid", { label: "Show/hide grid lines", ic: "gridlines", pressed: true, onClick: toggleGrid })),
    spacer(),
    group("Panels", stylesToggle),
  );
  const row2 = h("div", { class: "sh-row sh-row2" }, tb);
  root.classList.add("sh-root");
  root.replaceChildren(row1, row2, status);

  // Settings button at the end of the sheet bar (variant A bottom area).
  const settingsBtn = drawer.toggle(button({ label: "Document settings: theme, font, regional", ic: "sliders", cls: "sh-sm" }), "settings", panels.settings);
  document.getElementById("sheet-end")?.replaceChildren(settingsBtn);

  // ---------- state ----------
  function sync() {
    const s = bridge.state(),
      st = cellStyle(),
      busy = !s.canEdit;
    stateText.textContent = document.getElementById("save-status")?.textContent ?? "";
    for (const b of tb.querySelectorAll(".sh-tscroll button")) b.disabled = busy;
    B.undo.disabled = !s.canUndo;
    B.redo.disabled = !s.canRedo;
    numberPick.querySelector(".sh-lbl").textContent = formatLabel(s.format);
    numberPick.setAttribute("aria-label", `Number format: ${formatLabel(s.format)}`);
    const styleName = CELL_STYLES.find(([id]) => id === s.cellStyle)?.[1] ?? s.cellStyle;
    stylePick.querySelector(".sh-lbl").textContent = styleName;
    stylePick.setAttribute("aria-label", `Cell style: ${styleName}`);
    B.bold.setAttribute("aria-pressed", String(!!st.bold));
    B.italic.setAttribute("aria-pressed", String(!!st.italic));
    B.wrap.setAttribute("aria-pressed", String(!!st.wrap));
    for (const v of ["left", "center", "right", "centerContinuous"]) B["align-" + v].setAttribute("aria-pressed", String(st.horizontal === v));
    B.grid.setAttribute("aria-pressed", String(ui.gridLines));
    B.color.bar.style.background = `var(--${ui.color === "dark" ? "ink" : ui.color})`;
    B.fill.bar.style.background = ui.fill === "none" ? "transparent" : `var(--${ui.fill === "dark" ? "ink" : ui.fill})`;
    tb.refresh();
  }
  document.addEventListener("assessment-state", sync);
  new MutationObserver(sync).observe(document.getElementById("save-status"), { childList: true, characterData: true, subtree: true });
  const top = () => document.documentElement.style.setProperty("--sh-top", `${Math.round(root.getBoundingClientRect().bottom)}px`);
  new ResizeObserver(top).observe(root);
  addEventListener("scroll", top, { passive: true });
  // Shortcuts that belong to the shell (the grid keeps its own).
  document.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const k = event.key.toLowerCase();
    if (k === "k") {
      event.preventDefault();
      openLink();
    }
  });
  sync();
  top();
  return { mountMs: performance.now() - t0, openPanel, drawer };
}
