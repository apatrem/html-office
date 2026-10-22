// Variant A editor shell for html-data (ADR-011 §7, U04-Data), built from the
// shared native components. It only runs registered commands and shows their
// state; every control here applies and renders end to end.
import { h, button, icon } from "../../shared/shell/dom.mjs";
import { menubar, menuButton } from "../../shared/shell/menu.mjs";
import { toolbar, group, spacer } from "../../shared/shell/toolbar.mjs";
import { closePopover } from "../../shared/shell/popover.mjs";

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
// Presets the grid renders today; scale, negative and long-date presets join with F02.
const FORMATS = [
  ["General", { kind: "general" }],
  ["Number", { kind: "number", digits: 2 }],
  ["Currency", { kind: "currency", digits: 2 }],
  ["Accounting", { kind: "accounting", digits: 2 }],
  ["Percent", { kind: "percent", digits: 1 }],
  ["Date", { kind: "date" }],
];
const formatName = (format) =>
  FORMATS.find(([, f]) => f.kind === (format?.kind ?? "general"))[0];
const styleName = (id) => STYLES.find(([v]) => v === id)?.[1] ?? id;
const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const key = (k, shift) => `${mac ? "⌘" : "Ctrl+"}${shift ? "Shift+" : ""}${k}`;

export function mountShell({ commands, state }) {
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
  const formatItems = () => {
    const current = state().format?.kind ?? "general";
    return [
      ...FORMATS.map(([label, format]) =>
        item(label, "number-format", {
          args: [format],
          checked: current === format.kind,
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
        "-",
        item("Delete rows", "delete-rows"),
        item("Delete columns", "delete-columns"),
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
        item("New sheet…", "new-sheet"),
      ],
    },
    {
      name: "Format",
      items: () => [
        { heading: "Number format" },
        ...formatItems(),
        item("Increase decimal places", "decimals-more"),
        item("Decrease decimal places", "decimals-less"),
        "-",
        { heading: "Cell style" },
        ...styleItems(),
        "-",
        item("Conditional formatting…", "conditional-formatting"),
        item("Clear formatting", "clear-formatting"),
      ],
    },
    {
      name: "Data",
      items: () => [
        item("Recalculate", "recalculate"),
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
      "Clear",
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
      "Rules and view",
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
  );
  $("shell-toolbar").replaceChildren(bar);

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
    const s = state();
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
    bar.refresh();
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
    if (event.key.toLowerCase() === "s" && !event.shiftKey) {
      event.preventDefault();
      closePopover({ restore: false });
      commands.run("save");
    }
  });
  sync();
}
