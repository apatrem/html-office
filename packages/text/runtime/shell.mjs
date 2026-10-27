// Variant A shell of html-text (ADR-011 §7, U04-Text), from the shared native components:
// a file bar with menus and Save, and one toolbar. It starts with the commands T03 makes work;
// each later task adds its own (a released shell never shows an inert command).
import { h, button } from "../../shared/shell/dom.mjs";
import { menubar, menuButton } from "../../shared/shell/menu.mjs";
import { toolbar, group } from "../../shared/shell/toolbar.mjs";
import { modal } from "../../shared/shell/dialogs.mjs";
import { drawer as createDrawer } from "../../shared/shell/drawer.mjs";
import { documentBody, choices } from "../../shared/shell/panels.mjs";

const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const key = (k) => (mac ? "⌘" : "Ctrl+") + k;
const SHORTCUTS = [
  [() => (window.showSaveFilePicker ? "Save" : "Save a copy"), key("S")],
  ["Undo", key("Z")],
  ["Redo", `${key("Shift+Z")} or ${key("Y")}`],
  ["New paragraph", "Enter"],
];

// "document": what style#theme sets when the article has no data-page or data-margins.
const PAGE_CHOICES = [
  ["document", h("span", {}, "Theme default")],
  ["a4", h("span", {}, "A4"), h("span", { class: "sh-aa" }, "210 × 297 mm")],
  [
    "letter",
    h("span", {}, "Letter"),
    h("span", { class: "sh-aa" }, "8.5 × 11 in"),
  ],
];
const MARGIN_CHOICES = [
  ["document", h("span", {}, "Theme default")],
  ["narrow", h("span", {}, "Narrow")],
  ["normal", h("span", {}, "Normal")],
  ["wide", h("span", {}, "Wide")],
];

function shortcuts(opener) {
  modal(
    "Keyboard shortcuts",
    h(
      "table",
      { class: "tx-keys" },
      SHORTCUTS.map(([label, keys]) =>
        h(
          "tr",
          {},
          h(
            "th",
            { scope: "row" },
            typeof label === "function" ? label() : label,
          ),
          h("td", {}, keys),
        ),
      ),
    ),
    [],
    { opener },
  );
}

// look(): the document's attributes (theme, font, page, margins; null when absent).
export function mountShell(cmd, saving, report, look) {
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
        ...(cmd.has("save")
          ? [
              item("Save", "save", { shortcut: key("S") }),
              item("Save a copy", "save-copy"),
            ]
          : [item("Save a copy", "save-copy", { shortcut: key("S") })]),
        "-",
        { label: "Document settings…", onSelect: () => openSettings() },
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
  // Safari and Firefox cannot write the opened file: their primary action says what it does.
  const save = cmd.has("save")
    ? add("save", {
        label: "Save",
        ic: "save",
        text: "Save",
        cls: "sh-primary",
        title: `Save to file (${key("S")})`,
      })
    : add("save-copy", {
        label: "Save a copy",
        ic: "save",
        text: "Save a copy",
        cls: "sh-primary",
        title: `Download a complete copy of this document (${key("S")}); this browser cannot save to the opened file`,
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
  // ---- document settings (ADR-011 §7, T04): theme, font, page format and margins ----
  // The document's own charte colours, read before any built-in overlay applies.
  const own = getComputedStyle(document.documentElement);
  const documentColours = Object.fromEntries(
    ["ink", "acc", "mid", "lig", "alert"].map((t) => [
      t,
      own.getPropertyValue(`--${t}`).trim(),
    ]),
  );
  const current = () => {
    const a = look();
    return {
      theme: a.theme ?? "document",
      font: a.font ?? "document",
      page: a.page ?? "document",
      margins: a.margins ?? "document",
    };
  };
  const settings = () => ({
    title: "Document settings",
    subtitle: "Theme, font and page apply to the whole document",
    body: () =>
      documentBody({
        ...current(),
        documentColours,
        onTheme: (t) => cmd.run("theme", t),
        onFont: (f) => cmd.run("font", f),
        fontNote: "Body text only; headings keep the charte font.",
        extra: [
          h("h3", {}, "Page format"),
          choices(
            "Page format",
            "sh-fonts tx-pages",
            PAGE_CHOICES,
            current().page,
            (v) => cmd.run("page", v),
          ),
          h("h3", {}, "Margins"),
          choices(
            "Margins",
            "sh-fonts tx-margins",
            MARGIN_CHOICES,
            current().margins,
            (v) => cmd.run("margins", v),
          ),
          h(
            "p",
            { class: "sh-hint" },
            "You edit at the text width of the page, so lines break where they print.",
          ),
        ],
      }),
  });
  const panel = createDrawer(h("div", { class: "sh-root tx-drawer" }));
  const width = h("span", { class: "sh-finfo", role: "status" });
  const settingsButton = panel.toggle(
    button({
      label: "Theme & page",
      ic: "sliders",
      text: "Theme & page",
      title: "Document settings: theme, font, page format and margins",
    }),
    "settings",
    settings,
  );
  // Opened from a menu, the panel returns focus to the settings-bar button when it closes.
  const openSettings = () =>
    panel.open("settings", { ...settings(), trigger: settingsButton });
  const float = h(
    "div",
    {
      class: "sh-root sh-float tx-float",
      role: "group",
      "aria-label": "Document settings",
    },
    settingsButton,
    width,
  );

  // Clicking the chrome keeps the caret in the document.
  for (const el of [top, float])
    el.addEventListener("pointerdown", (event) => {
      if (!event.target.closest("input, textarea")) event.preventDefault();
    });
  document.body.prepend(top);
  document.body.append(float, panel.host);
  // The editor handles its own Mod-s, Mod-z and Mod-y; this covers focus in the chrome (a panel
  // choice, a toolbar button). Text fields keep their own undo.
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || !(mac ? event.metaKey : event.ctrlKey))
      return;
    const k = event.key.toLowerCase();
    const id =
      k === "s"
        ? cmd.has("save")
          ? "save"
          : "save-copy"
        : event.target.closest?.("input, textarea, [contenteditable]")
          ? null
          : k === "z"
            ? event.shiftKey
              ? "redo"
              : "undo"
            : k === "y"
              ? "redo"
              : null;
    if (!id) return;
    event.preventDefault();
    cmd.run(id);
  });
  const text = (el, t) => {
    if (el.textContent !== t) el.textContent = t;
  };
  const protectedCount = report.protected.length;
  text(
    kept,
    [
      protectedCount &&
        `${protectedCount} protected block${protectedCount > 1 ? "s" : ""} (not editable)`,
      !saving.canonical && "Not in canonical form: saving needs pack.mjs",
    ]
      .filter(Boolean)
      .join(" · "),
  );
  const article = document.getElementById("doc");
  let measured = "";
  function sync() {
    for (const [b, id] of binds) b.disabled = !cmd.enabled(id);
    // The open panel follows undo and redo.
    if (panel.current()) {
      const c = current();
      for (const [sel, v] of [
        [".sh-themes > button", c.theme],
        [".sh-fonts:not(.tx-pages, .tx-margins) > button", c.font],
        [".tx-pages > button", c.page],
        [".tx-margins > button", c.margins],
      ])
        for (const b of panel.host.querySelectorAll(sel))
          b.setAttribute("aria-checked", String(b.dataset.value === v));
    }
    // The editing width, measured when the look changes: the page's text width in millimetres.
    const key = JSON.stringify(look());
    if (key !== measured) {
      measured = key;
      const cs = getComputedStyle(article);
      const px =
        article.clientWidth -
        parseFloat(cs.paddingLeft) -
        parseFloat(cs.paddingRight);
      text(width, `Text width ${Math.round((px * 25.4) / 96)} mm`);
    }
    status.dataset.state = saving.busy ? "saving" : saving.state;
    text(
      status,
      saving.busy ? "Saving…" : saving.message || STATES[saving.state](saving),
    );
    save.classList.toggle("dirty", saving.dirty);
    bar.refresh?.(document.activeElement);
  }
  cmd.subscribe(sync);
  sync();

  // A draft found on open: restore it (as a copy when the file changed since) or discard it.
  // The choice cannot be dismissed, so a later draft never replaces this one unseen.
  function recover({ date, asCopy, article: draft }, restore) {
    const when = new Date(date);
    const error = h("p", { class: "sh-err", role: "status" });
    const restoreButton = h(
      "button",
      { type: "button", class: "sh-b sh-t sh-primary" },
      asCopy ? "Restore as a copy" : "Restore draft",
    );
    const dialog = modal(
      "Recover unsaved changes?",
      [
        h(
          "p",
          {},
          `This browser kept a draft of unsaved changes to this document${isNaN(when) ? "" : `, last changed ${when.toLocaleString()}`}.`,
        ),
        h(
          "p",
          {},
          asCopy
            ? "The file has changed since the draft was made. Restored, the draft can only be saved to a new file or as a copy."
            : "Restoring replaces the document shown with the draft. Nothing is written to the file until you save.",
        ),
        error,
      ],
      [
        h(
          "button",
          {
            type: "button",
            class: "sh-b sh-t sh-ghost",
            onclick: () => {
              dialog.close("discard");
              saving.discarded();
            },
          },
          "Discard draft",
        ),
        h("span", { class: "sh-spacer" }),
        restoreButton,
      ],
    );
    dialog.addEventListener("cancel", (event) => event.preventDefault());
    restoreButton.addEventListener("click", () => {
      try {
        restore(draft);
      } catch (e) {
        error.textContent = `The draft cannot be restored: ${e.message}. Discard it to continue.`;
        restoreButton.disabled = true;
        return;
      }
      dialog.close("restore");
      saving.restored({ asCopy });
    });
    restoreButton.focus();
  }
  return { recover };
}

// The state line when no action has just reported: saved, unsaved, draft kept, or copied.
const STATES = {
  saved: () => "No unsaved changes",
  unsaved: (s) =>
    s.recovery === "unavailable"
      ? `Unsaved changes · no draft in this browser (${s.problem})`
      : "Unsaved changes",
  draft: () => "Unsaved changes · draft kept in this browser",
  copied: () => "Copy downloaded · this file is not changed",
};

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
