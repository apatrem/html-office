// Variant A editor shell for html-data (ADR-011 §7, U04-Data), built from the
// shared native components. It only runs registered commands and shows their
// state; every control here applies and renders end to end.
import { h, button, icon } from "../../shared/shell/dom.mjs";
import { validateLinkShape } from "../model/formatting.mjs";
import { menubar, menuButton } from "../../shared/shell/menu.mjs";
import { toolbar, group, spacer } from "../../shared/shell/toolbar.mjs";
import {
  closePopover,
  openPopover,
  openPopoverState,
} from "../../shared/shell/popover.mjs";
import { openMenu } from "../../shared/shell/menu.mjs";
import { drawer as createDrawer } from "../../shared/shell/drawer.mjs";
import {
  cellStylesBody,
  documentBody,
  regionalBody,
  LOCALES,
} from "../../shared/shell/panels.mjs";
import {
  openSwatches,
  openBorders,
  colourButton,
} from "../../shared/shell/pickers.mjs";
import {
  modal,
  field,
  linkDialog,
  dialogOpen,
} from "../../shared/shell/dialogs.mjs";

const STYLES = [
  ["normal", "Normal"],
  ["title", "Title"],
  ["header", "Header"],
  ["rowHeader", "Row label"],
  ["assumption", "Assumption"],
  ["calculation", "Calculation"],
  ["output", "Output"],
  ["total", "Total"],
  ["note", "Note"],
  ["alert", "Alert"],
  ["hyperlink", "Hyperlink"],
];
const FORMATS = [
  ["General", { kind: "general" }],
  ["Number", { kind: "number", digits: 2 }],
  ["Currency", { kind: "currency", digits: 2 }],
  ["Accounting", { kind: "accounting", digits: 2 }],
  ["Percent", { kind: "percent", digits: 1 }],
  ["Short date", { kind: "date" }],
  ["Long date", { kind: "date", dateStyle: "long" }],
  "-",
  ["Thousands (k)", { kind: "number", digits: 1, scale: "thousands" }],
  ["Millions (M)", { kind: "number", digits: 1, scale: "millions" }],
  [
    "Negative in parentheses",
    { kind: "number", digits: 0, negative: "parentheses" },
  ],
  ["Negative in red", { kind: "number", digits: 0, negative: "red" }],
];
// A preset matches on kind and its display options, not on decimals.
const same = (a = { kind: "general" }, b) =>
  ["kind", "dateStyle", "scale", "negative"].every(
    (key) => (a[key] ?? DEFAULTS[key]) === (b[key] ?? DEFAULTS[key]),
  );
const DEFAULTS = { kind: "general", dateStyle: "short", negative: "minus" };
const formatName = (format) =>
  FORMATS.find((f) => f !== "-" && same(format, f[1]))?.[0] ??
  FORMATS.find(
    (f) => f !== "-" && f[1].kind === (format?.kind ?? "general"),
  )[0];
const styleName = (id) => STYLES.find(([v]) => v === id)?.[1] ?? id;
const ALIGN = [
  ["left", "Align left", "alignL"],
  ["center", "Align centre", "alignC"],
  ["right", "Align right", "alignR"],
  ["centerContinuous", "Centre across selection", "across"],
];
const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const key = (k, shift) => `${mac ? "⌘" : "Ctrl+"}${shift ? "Shift+" : ""}${k}`;

// `panels` adds product panels ({id: () => ({title, subtitle, body})}) that
// runtime modules render themselves (pivot tables).
export function mountShell({ commands, state, panels: extraPanels = {} }) {
  const $ = (id) => document.getElementById(id);
  const run =
    (id, ...args) =>
    () =>
      commands.run(id, ...args);
  const item = (label, id, extra = {}) => ({
    label,
    disabled: !commands.enabled(id),
    onSelect: run(id, ...(extra.args ?? [])),
    ...extra,
  });
  // ---- side panels (ADR-011 §7): one at a time, over the canvas ----
  const drawer = createDrawer($("shell-drawer"));
  const panels = {
    styles: () => ({
      title: "Cell styles",
      subtitle: `Selection ${state().address}`,
      body: () =>
        cellStylesBody({
          current: state().cellStyle,
          onApply: (id) => commands.run("cell-style", id),
          extra: h(
            "div",
            { class: "sh-prow" },
            button({
              label: "Clear formatting",
              ic: "eraser",
              text: "Clear formatting",
              cls: "sh-ghost",
              onClick: run("clear-formatting"),
            }),
            button({
              label: "Copy style",
              ic: "painter",
              text: "Copy style",
              cls: "sh-ghost",
              onClick: run("copy-style"),
            }),
          ),
        }),
    }),
    settings: () => ({
      title: "Document settings",
      subtitle: "Theme and font apply to the whole workbook",
      body: () =>
        documentBody({
          theme: state().theme,
          font: state().font,
          documentColours: state().documentColours,
          onTheme: (theme) => commands.run("theme", theme),
          onFont: (font) => commands.run("font", font),
          fontNote: "Applies to the whole grid; one size for every cell.",
          extra: [
            h("h3", {}, "Regional"),
            h(
              "p",
              { class: "sh-hint" },
              `Locale: ${LOCALES.find(([v]) => v === state().locale)?.[1] ?? state().locale}`,
            ),
            h(
              "div",
              { class: "sh-prow" },
              button({
                label: "Regional settings…",
                ic: "globe",
                text: "Regional settings…",
                cls: "sh-ghost",
                onClick: () => openPanel("regional"),
              }),
            ),
          ],
        }),
    }),
    regional: () => ({
      title: "Regional settings",
      subtitle: "Display of numbers and dates",
      body: () =>
        regionalBody({
          locale: state().locale,
          onSave: (locale) => commands.run("locale", locale),
        }),
    }),
  };
  Object.assign(panels, extraPanels);
  function openPanel(id, trigger) {
    closePopover({ restore: false });
    drawer.open(id, { ...panels[id](), trigger });
    recordLocale();
  }
  // A freshly opened regional panel shows the committed locale.
  function recordLocale() {
    if (drawer.current() !== "regional") return;
    const select = drawer.host.querySelector("select");
    if (select) select.dataset.committed = state().locale;
  }
  // ---- pickers and dialogs the toolbar and menus share ----
  const ui = { border: { style: "thin", color: "ink" } };
  // Menus open the same pickers, anchored to their toolbar button.
  function anchor(b) {
    b.scrollIntoView({ block: "nearest", inline: "nearest" });
    return b;
  }
  function pickColour(kind) {
    const fill = kind === "fill",
      s = state().style;
    openSwatches(
      anchor(fill ? B.fill : B.color),
      kind,
      fill
        ? s.fill === "catalogue"
          ? "none"
          : (s.fill ?? "none")
        : (s.color ?? "ink"),
      (token) => commands.run(fill ? "fill-color" : "text-color", token),
    );
  }
  function pickBorders() {
    openBorders(anchor(B.borders), ui.border, ({ preset, style, color }) =>
      commands.run("borders", { preset, style, color }),
    );
  }
  function editLink(opener) {
    if (dialogOpen() || !commands.enabled("link")) return;
    const s = state();
    linkDialog({
      sheets: s.sheets,
      sheetId: s.sheetId,
      initial: s.link,
      opener: opener ?? document.activeElement,
      // The model's own rules: schemes, length and Excel bounds.
      check: (link) => {
        try {
          validateLinkShape(link);
          return "";
        } catch (error) {
          return error.message;
        }
      },
      onSave: (link) => commands.run("link", link),
      onRemove: () => commands.run("link", null),
    });
  }
  function columnWidth() {
    if (dialogOpen() || !commands.enabled("column-width")) return;
    const input = h("input", {
        type: "number",
        min: "8",
        max: "2000",
        value: String(state().columnWidth),
      }),
      apply = h(
        "button",
        { type: "button", class: "sh-b sh-t sh-primary" },
        "Apply width",
      );
    const dialog = modal(
      "Column width",
      [field("Width in pixels", input)],
      [
        h("span", { class: "sh-spacer" }),
        h(
          "button",
          {
            type: "button",
            class: "sh-b sh-t sh-ghost",
            onclick: () => dialog.close("cancel"),
          },
          "Cancel",
        ),
        apply,
      ],
    );
    const check = () => {
      const value = Number(input.value),
        ok = Number.isInteger(value) && value >= 8 && value <= 2000;
      input.setAttribute("aria-invalid", String(!ok));
      input.closest(".sh-fld").querySelector(".sh-err").textContent = ok
        ? ""
        : "Enter a whole number of pixels from 8 to 2000.";
      apply.disabled = !ok;
      return ok;
    };
    input.addEventListener("input", check);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        apply.click();
      }
    });
    apply.addEventListener("click", () => {
      if (!check()) return;
      dialog.close("apply");
      commands.run("column-width", Number(input.value));
    });
    input.select();
  }
  // A linked cell clicked with the pointer shows its target and actions.
  function showLink(element, link) {
    if (!element) return;
    const s = state(),
      target = link.url
        ? link.url
        : `${s.sheets.find((x) => x.id === link.sheetId)?.name ?? "Missing sheet"}!${link.ref}`;
    openPopover(
      element,
      [
        h(
          "p",
          { class: "sh-pop-h" },
          link.url ? "Link" : "Link to a place in this workbook",
        ),
        h("p", { class: "sh-link-target" }, target),
        h(
          "div",
          { class: "sh-prow" },
          h(
            "button",
            {
              type: "button",
              class: "sh-b sh-t sh-ghost",
              onclick: () => {
                closePopover({ restore: false });
                commands.run("open-link");
              },
            },
            link.url ? "Open link" : "Go to",
          ),
          h(
            "button",
            {
              type: "button",
              class: "sh-b sh-t sh-ghost",
              onclick: () => editLink(document.getElementById("grid")),
            },
            "Edit link…",
          ),
          h(
            "button",
            {
              type: "button",
              class: "sh-b sh-t sh-ghost",
              onclick: () => {
                closePopover({ restore: false });
                commands.run("link", null);
                document.getElementById("grid").focus();
              },
            },
            "Remove link",
          ),
        ),
      ],
      { label: "Link", cls: "sh-pop-link", focus: false },
    );
  }
  // Row, column and cell context menus (pointer or Shift+F10).
  function contextMenu(kind, element) {
    const rows = [
        item("Insert rows", "insert-rows"),
        item("Delete rows", "delete-rows"),
      ],
      columns = [
        item("Insert columns", "insert-columns"),
        item("Delete columns", "delete-columns"),
      ],
      width = [
        item("Column width…", "column-width", { onSelect: columnWidth }),
        item("Auto-fit column width", "auto-fit"),
      ],
      common = [
        item("Copy style", "copy-style"),
        item("Clear formatting", "clear-formatting"),
      ];
    const items =
      kind === "row"
        ? [...rows, "-", ...common]
        : kind === "column"
          ? [...columns, "-", ...width, "-", ...common]
          : [
              ...rows,
              ...columns,
              "-",
              item("Link…", "link", {
                onSelect: () => editLink(document.getElementById("grid")),
              }),
              ...(state().link ? [item("Open link", "open-link")] : []),
              "-",
              ...common,
              "-",
              item("Download as PNG", "download-png"),
            ];
    // Focus returns to the grid: the cell or header may be redrawn.
    openMenu(element, items, {
      label: `${kind === "cell" ? "Cell" : kind === "row" ? "Row" : "Column"} menu`,
      restoreTo: document.getElementById("grid"),
    });
  }
  const formatItems = () => {
    const current = formatName(state().format);
    return [
      ...FORMATS.map((preset) =>
        preset === "-"
          ? preset
          : item(preset[0], "number-format", {
              args: [preset[1]],
              checked: current === preset[0],
              radio: true,
            }),
      ),
      "-",
      item("More number formats…", "number-format-dialog"),
    ];
  };
  const styleItems = () =>
    STYLES.map(([id, label]) =>
      item(label, "cell-style", {
        args: [id],
        checked: state().cellStyle === id,
        radio: true,
      }),
    );
  // Every command has a home in the menus; the toolbar repeats frequent ones.
  const menus = [
    {
      name: "File",
      items: () => [
        item("Save", "save", { shortcut: key("S") }),
        item("Save a copy", "save-copy"),
        item("Download selection as PNG", "download-png"),
        "-",
        item("Document settings…", "theme", {
          onSelect: () => openPanel("settings"),
        }),
        item("Regional settings…", "locale", {
          onSelect: () => openPanel("regional"),
        }),
      ],
    },
    {
      name: "Edit",
      items: () => [
        item("Undo", "undo", { shortcut: key("Z") }),
        item("Redo", "redo", { shortcut: key("Z", true) }),
        "-",
        item("Paste table…", "paste-table"),
        item("Fill down", "fill-down"),
        item("Fill right", "fill-right"),
        item("Copy style", "copy-style"),
        "-",
        item("Delete rows", "delete-rows"),
        item("Delete columns", "delete-columns"),
        "-",
        item("Duplicate chart", "duplicate-chart"),
        item("Delete chart", "delete-chart"),
        "-",
        item("Clear formatting", "clear-formatting"),
      ],
    },
    {
      name: "Insert",
      items: () => [
        item("Insert rows", "insert-rows"),
        item("Insert columns", "insert-columns"),
        "-",
        item("Link…", "link", { shortcut: key("K"), onSelect: editLink }),
        item("New sheet…", "new-sheet"),
        "-",
        item("Pivot table…", "insert-pivot"),
        item("Chart…", "insert-chart"),
      ],
    },
    {
      name: "Format",
      items: () => {
        const s = state().style;
        return [
          item("Bold", "bold", { shortcut: key("B"), checked: !!s.bold }),
          item("Italic", "italic", {
            shortcut: key("I"),
            checked: !!s.italic,
          }),
          "-",
          item("Text colour…", "text-color", {
            onSelect: () => pickColour("text"),
          }),
          item("Fill colour…", "fill-color", {
            onSelect: () => pickColour("fill"),
          }),
          item("Borders…", "borders", { onSelect: pickBorders }),
          "-",
          ...ALIGN.map(([value, label]) =>
            item(label, "align", {
              args: [value],
              checked: s.align?.horizontal === value,
            }),
          ),
          item("Wrap text", "wrap", { checked: !!s.align?.wrap }),
          "-",
          item("Number format…", "number-format-dialog"),
          item("Increase decimal places", "decimals-more"),
          item("Decrease decimal places", "decimals-less"),
          "-",
          item("Cell styles…", "cell-style", {
            onSelect: () => openPanel("styles"),
          }),
          "-",
          item("Column width…", "column-width", { onSelect: columnWidth }),
          item("Auto-fit column width", "auto-fit"),
          "-",
          item("Conditional formatting…", "conditional-formatting"),
          item("Chart settings…", "chart-settings"),
          item("Clear formatting", "clear-formatting"),
        ];
      },
    },
    {
      name: "Data",
      items: () => [
        item("Recalculate", "recalculate"),
        item("Pivot tables…", "pivot-tables"),
        item("Refresh all pivot tables", "refresh-pivots"),
        item("Redraw charts", "redraw-charts"),
        "-",
        item("Dropdown settings…", "dropdown-settings"),
        item("Manage sheets…", "manage-sheets"),
      ],
    },
    {
      name: "View",
      items: () => [
        item("Grid lines", "grid-lines", { checked: state().gridLines }),
      ],
    },
    {
      name: "Help",
      items: () => [
        item("Keyboard shortcuts", "help", { args: ["keys"] }),
        item("File format guide", "help", { args: ["guide"] }),
        item("Third-party notices", "help", { args: ["notices"] }),
      ],
    },
  ];
  $("shell-menus").replaceChildren(menubar("Workbook menu", menus));
  $("shell-narrow").replaceChildren(
    menuButton(
      button({ label: "Menu", ic: "menu" }),
      () =>
        menus.flatMap((menu, i) => [
          ...(i ? ["-"] : []),
          { heading: menu.name },
          ...menu.items(),
        ]),
      "Menu",
    ),
  );

  const B = {};
  const add = (id, spec) =>
    (B[id] = button({ ...spec, onClick: run(spec.command ?? id) }));
  const picker = (label, items) =>
    menuButton(
      h(
        "button",
        { type: "button", class: "sh-b sh-pick", title: label },
        h("span", { class: "sh-lbl" }),
        icon("caret", "sh-ic sh-car"),
      ),
      items,
      label,
    );
  B.numberFormat = picker("Number format", formatItems);
  B.cellStyle = picker("Cell style", styleItems);
  B.currency = button({
    label: "Format as currency",
    glyph: "€",
    onClick: () =>
      commands.run("number-format", { kind: "currency", digits: 2 }),
  });
  B.percent = button({
    label: "Format as percentage",
    glyph: "%",
    onClick: () =>
      commands.run("number-format", { kind: "percent", digits: 1 }),
  });
  const bar = toolbar(
    "Formatting",
    group(
      "History",
      add("undo", { label: "Undo", ic: "undo", title: `Undo (${key("Z")})` }),
      add("redo", {
        label: "Redo",
        ic: "redo",
        title: `Redo (${key("Z", true)})`,
      }),
    ),
    group(
      "Clipboard",
      (B.painter = button({
        label: "Copy style",
        ic: "painter",
        onClick: run("copy-style"),
      })),
      add("clear-formatting", { label: "Clear formatting", ic: "eraser" }),
    ),
    group(
      "Number",
      B.currency,
      B.percent,
      add("decimals-less", {
        label: "Decrease decimal places",
        glyph: ".0<sub>←</sub>",
      }),
      add("decimals-more", {
        label: "Increase decimal places",
        glyph: ".00<sub>→</sub>",
      }),
      B.numberFormat,
    ),
    group("Cell style", B.cellStyle),
    group(
      "Emphasis",
      add("bold", {
        label: "Bold",
        glyph: "<b>B</b>",
        pressed: false,
        title: `Bold (${key("B")})`,
      }),
      add("italic", {
        label: "Italic",
        glyph: "<i>I</i>",
        pressed: false,
        title: `Italic (${key("I")})`,
      }),
    ),
    group(
      "Colour",
      (B.color = colourButton("text", () => pickColour("text"))),
      (B.fill = colourButton("fill", () => pickColour("fill"))),
    ),
    group(
      "Borders",
      (B.borders = h(
        "button",
        {
          type: "button",
          class: "sh-b",
          "aria-label": "Borders",
          title: "Borders",
          "aria-haspopup": "dialog",
          "aria-expanded": "false",
          onclick: () => pickBorders(),
        },
        icon("borders"),
        icon("caret", "sh-ic sh-car"),
      )),
    ),
    group(
      "Alignment",
      ...ALIGN.map(
        ([value, label, ic]) =>
          (B[`align-${value}`] = button({
            label,
            ic,
            pressed: false,
            onClick: run("align", value),
          })),
      ),
      add("wrap", { label: "Wrap text", ic: "wrap", pressed: false }),
    ),
    group(
      "Rules and view",
      (B.link = button({
        label: "Link",
        ic: "link",
        title: `Link (${key("K")})`,
        onClick: () => editLink(),
      })),
      add("conditional-formatting", {
        label: "Conditional formatting",
        ic: "condfmt",
      }),
      (B.gridLines = button({
        label: "Grid lines",
        ic: "gridlines",
        pressed: true,
        onClick: run("grid-lines"),
      })),
    ),
    spacer(),
    group(
      "Panels",
      (B.stylesPanel = drawer.toggle(
        button({ label: "Styles", ic: "styles", text: "Styles" }),
        "styles",
        panels.styles,
      )),
    ),
  );
  $("shell-toolbar").replaceChildren(bar);
  // The document-settings button ends the sheet bar (variant A).
  $("sheet-end").replaceChildren(
    (B.settings = drawer.toggle(
      button({ label: "Document settings", ic: "sliders", cls: "sh-sm" }),
      "settings",
      panels.settings,
    )),
  );
  // Panels open between the formula bar and the sheet bar.
  const top = () => {
    const root = document.documentElement.style;
    root.setProperty(
      "--sh-top",
      `${Math.round(document.querySelector(".formula-bar").getBoundingClientRect().bottom)}px`,
    );
    root.setProperty(
      "--sh-bottom",
      `${Math.round(innerHeight - document.querySelector(".sheet-bar").getBoundingClientRect().top)}px`,
    );
  };
  new ResizeObserver(top).observe(document.querySelector(".app"));
  top();

  // Sheet bar actions: new sheet and the list of all sheets.
  const sheetMenu = () => [
    ...state().groups.flatMap((g) => [
      { heading: g.name },
      ...g.sheets.map((s) => ({
        label: s.name,
        checked: s.current,
        radio: true,
        disabled: state().busy,
        onSelect: () => commands.run("select-sheet", s.id),
      })),
    ]),
    "-",
    item("Manage sheets…", "manage-sheets"),
  ];
  const newSheet = add("new-sheet", { label: "New sheet", ic: "plus" });
  B.sheets = menuButton(
    button({ label: "All sheets", ic: "menu" }),
    sheetMenu,
    "All sheets",
  );
  $("sheet-actions").replaceChildren(newSheet, B.sheets);

  function sync() {
    const s = state(),
      focused = document.activeElement;
    for (const [id, b] of Object.entries(B))
      if (commands.has(id)) b.disabled = !commands.enabled(id);
    for (const b of [B.currency, B.percent, B.numberFormat])
      b.disabled = !commands.enabled("number-format");
    B.cellStyle.disabled = !commands.enabled("cell-style");
    B.gridLines.disabled = !commands.enabled("grid-lines");
    B.gridLines.setAttribute("aria-pressed", String(s.gridLines));
    B.sheets.disabled = s.busy;
    const format = formatName(s.format),
      style = styleName(s.cellStyle);
    B.currency.querySelector(".sh-g").textContent = s.currencySymbol;
    B.numberFormat.querySelector(".sh-lbl").textContent = format;
    B.numberFormat.setAttribute("aria-label", `Number format: ${format}`);
    B.cellStyle.querySelector(".sh-lbl").textContent = style;
    B.cellStyle.setAttribute("aria-label", `Cell style: ${style}`);
    // Pressed states and swatch bars follow the active cell.
    const look = s.style;
    B.bold.setAttribute("aria-pressed", String(!!look.bold));
    B.italic.setAttribute("aria-pressed", String(!!look.italic));
    B.wrap.setAttribute("aria-pressed", String(!!look.align?.wrap));
    for (const [value] of ALIGN) {
      const b = B[`align-${value}`];
      b.setAttribute("aria-pressed", String(look.align?.horizontal === value));
      b.disabled = !commands.enabled("align");
    }
    for (const b of [B.color, B.fill, B.borders])
      b.disabled = !commands.enabled("borders");
    B.color.bar.style.background = `var(--${look.color ?? "ink"})`;
    B.fill.bar.style.background =
      !look.fill || ["none", "catalogue"].includes(look.fill)
        ? "transparent"
        : look.fill === "tint"
          ? "var(--callout)"
          : `var(--${look.fill === "dark" ? "ink" : look.fill})`;
    // An open panel follows the selection, undo and other changes.
    const open = drawer.current();
    if (open === "styles") {
      const sub = drawer.host.querySelector(".sh-ph p");
      if (sub) sub.textContent = `Selection ${s.address}`;
      for (const tile of drawer.host.querySelectorAll(
        ".sh-style-grid > button",
      ))
        tile.setAttribute(
          "aria-checked",
          String(tile.dataset.value === s.cellStyle),
        );
    } else if (open === "settings") {
      for (const b of drawer.host.querySelectorAll(".sh-themes > button"))
        b.setAttribute("aria-checked", String(b.dataset.value === s.theme));
      for (const b of drawer.host.querySelectorAll(".sh-fonts > button"))
        b.setAttribute("aria-checked", String(b.dataset.value === s.font));
    } else if (open === "regional") {
      // Undo or redo can change the committed locale under the panel.
      // The panel records the locale it opened with (openPanel), so an
      // unapplied choice is kept until the committed locale changes.
      const select = drawer.host.querySelector("select");
      if (select && select.dataset.committed !== s.locale) {
        select.dataset.committed = s.locale;
        if (![...select.options].some((o) => o.value === s.locale))
          select.prepend(new Option(s.locale, s.locale));
        select.value = s.locale;
        select.dispatchEvent(new Event("change"));
      }
    }
    B.painter.setAttribute("aria-pressed", String(s.painting));
    B.painter.disabled = !commands.enabled("copy-style");
    B.link.disabled = !commands.enabled("link");
    bar.refresh(focused);
  }
  commands.subscribe(sync);
  // Status lines are truncated in the file bar; the full text stays on hover
  // (screen readers already hear it through role="status").
  for (const line of document.querySelectorAll(".sh-state [role=status]")) {
    const title = () => (line.title = line.textContent);
    new MutationObserver(title).observe(line, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    title();
  }
  // Shortcuts that belong to the shell; the grid keeps its own.
  document.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const k = event.key.toLowerCase(),
      target = event.target;
    // Undo and redo from panels and the shell; the grid and text fields
    // keep their own handling (native undo in fields).
    if (
      (k === "z" || k === "y") &&
      !target.closest?.("#grid") &&
      !target.matches?.("input, textarea, select, [contenteditable]") &&
      !dialogOpen()
    ) {
      event.preventDefault();
      commands.run(k === "y" || event.shiftKey ? "redo" : "undo");
      return;
    }

    if (k === "s" && !event.shiftKey) {
      event.preventDefault();
      closePopover({ restore: false });
      commands.run("save");
    } else if ((k === "b" || k === "i") && !event.shiftKey && !dialogOpen()) {
      event.preventDefault();
      commands.run(k === "b" ? "bold" : "italic");
    } else if (k === "k" && !event.shiftKey) {
      // A shortcut that opens a dialog closes any open popover first.
      event.preventDefault();
      if (openPopoverState()) closePopover({ restore: false });
      editLink();
    }
  });
  sync();
  return {
    showLink,
    contextMenu,
    // Opens a panel, or leaves it open when it already is.
    openPanel: (id) => drawer.current() !== id && openPanel(id),
    currentPanel: () => drawer.current(),
  };
}
