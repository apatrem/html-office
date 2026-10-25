// Variant A shell of html-text (ADR-011 §7, U04-Text), from the shared native components:
// a file bar with menus and Save, and one toolbar. It starts with the commands T03 makes work;
// each later task adds its own (a released shell never shows an inert command).
import { h, button } from "../../shared/shell/dom.mjs";
import { menubar, menuButton } from "../../shared/shell/menu.mjs";
import { toolbar, group } from "../../shared/shell/toolbar.mjs";
import { modal } from "../../shared/shell/dialogs.mjs";

const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const key = (k) => (mac ? "⌘" : "Ctrl+") + k;
const SHORTCUTS = [
  ["Save", key("S")],
  ["Undo", key("Z")],
  ["Redo", `${key("Shift+Z")} or ${key("Y")}`],
  ["New paragraph", "Enter"],
];

function shortcuts(opener) {
  modal(
    "Keyboard shortcuts",
    h(
      "table",
      { class: "tx-keys" },
      SHORTCUTS.map(([label, keys]) =>
        h("tr", {}, h("th", { scope: "row" }, label), h("td", {}, keys)),
      ),
    ),
    [],
    { opener },
  );
}

export function mountShell(cmd, saving, report) {
  const binds = [];
  const item = (label, id, extra = {}) => ({
    label,
    ...extra,
    disabled: !cmd.enabled(id),
    onSelect: () => cmd.run(id),
  });
  const add = (id, spec) => {
    const b = button({ ...spec, onClick: () => cmd.run(id) });
    binds.push([b, id]);
    return b;
  };
  const menus = [
    {
      name: "File",
      items: () => [
        item("Save", "save", { shortcut: key("S") }),
        item("Save a copy", "save-copy"),
        "-",
        item("Print / PDF", "print"),
      ],
    },
    {
      name: "Edit",
      items: () => [
        item("Undo", "undo", { shortcut: key("Z") }),
        item("Redo", "redo", { shortcut: key("Shift+Z") }),
      ],
    },
    {
      name: "Help",
      items: () => [
        {
          label: "Keyboard shortcuts",
          onSelect: () => shortcuts(document.activeElement),
        },
      ],
    },
  ];
  const title = document.title.trim() || "Document";
  const status = h("p", { role: "status" });
  const kept = h("p", {});
  const save = add("save", {
    label: "Save",
    ic: "save",
    text: "Save",
    cls: "sh-primary",
    title: `Save to file (${key("S")})`,
  });
  const bar = toolbar(
    "Document",
    group(
      "History",
      add("undo", { label: "Undo", ic: "undo", title: `Undo (${key("Z")})` }),
      add("redo", {
        label: "Redo",
        ic: "redo",
        title: `Redo (${key("Shift+Z")})`,
      }),
    ),
  );
  const top = h(
    "div",
    { class: "sh-root tx-shell" },
    h(
      "div",
      { class: "sh-row" },
      h(
        "div",
        { class: "sh-ident" },
        h("span", { class: "sh-mark", "aria-hidden": "true" }, "T"),
        h(
          "div",
          { class: "sh-tt" },
          h("span", { class: "sh-title", title }, title),
          h("div", { class: "sh-state" }, status, kept),
        ),
      ),
      h("div", { class: "sh-wide" }, menubar("Document menu", menus)),
      h("span", { class: "sh-spacer" }),
      save,
      h(
        "span",
        { class: "sh-only-narrow" },
        menuButton(
          button({ label: "Menu", ic: "menu" }),
          () =>
            menus.flatMap((m, i) => [
              ...(i ? ["-"] : []),
              { heading: m.name },
              ...m.items(),
            ]),
          "Menu",
        ),
      ),
    ),
    h("div", { class: "sh-row sh-row2" }, bar),
  );
  // Clicking the chrome keeps the caret in the document.
  top.addEventListener("pointerdown", (event) => {
    if (!event.target.closest("input, textarea")) event.preventDefault();
  });
  document.body.prepend(top);
  document.addEventListener("keydown", (event) => {
    // The editor handles its own Mod-s; this covers focus in the chrome.
    if (
      !event.defaultPrevented &&
      (mac ? event.metaKey : event.ctrlKey) &&
      event.key === "s"
    ) {
      event.preventDefault();
      cmd.run("save");
    }
  });
  const text = (el, t) => {
    if (el.textContent !== t) el.textContent = t;
  };
  const protectedCount = report.protected.length;
  text(
    kept,
    protectedCount
      ? `${protectedCount} protected block${protectedCount > 1 ? "s" : ""} (not editable)`
      : "",
  );
  function sync() {
    for (const [b, id] of binds) b.disabled = !cmd.enabled(id);
    text(
      status,
      saving.busy
        ? "Saving…"
        : saving.message || (saving.dirty ? "Unsaved changes" : ""),
    );
    save.classList.toggle("dirty", saving.dirty);
    bar.refresh?.(document.activeElement);
  }
  cmd.subscribe(sync);
  sync();
}

// Shown instead of the editor when the file fails validation; nothing is saved.
export function refusal(report) {
  const first = report.errors.slice(0, 5);
  document.body.prepend(
    h(
      "div",
      { class: "sh-root tx-refusal", role: "alert" },
      h(
        "p",
        {},
        h("strong", {}, "This document cannot be edited. "),
        `${report.errors.length} problem${report.errors.length > 1 ? "s" : ""} must be fixed in the source first (packages/text/tools/check.mjs lists them all):`,
      ),
      h(
        "ul",
        {},
        first.map((e) => h("li", {}, `${e.message} (${e.path})`)),
      ),
    ),
  );
}
