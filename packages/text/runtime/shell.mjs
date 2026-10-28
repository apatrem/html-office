// Variant A shell of html-text (ADR-011 §7, U04-Text), from the shared native components:
// a file bar with menus and Save, and one toolbar. It starts with the commands T03 makes work;
// each later task adds its own (a released shell never shows an inert command).
import { h, button, icon } from "../../shared/shell/dom.mjs";
import { menubar, menuButton } from "../../shared/shell/menu.mjs";
import { toolbar, group } from "../../shared/shell/toolbar.mjs";
import {
  modal,
  field,
  linkDialog,
  checkUrl,
} from "../../shared/shell/dialogs.mjs";
import { STYLES, linkProblem } from "../editor/commands.mjs";
import { drawer as createDrawer } from "../../shared/shell/drawer.mjs";
import { documentBody, choices } from "../../shared/shell/panels.mjs";

const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const key = (k) => (mac ? "⌘" : "Ctrl+") + k;
const alt = (k) => (mac ? "⌘⌥" : "Ctrl+Alt+") + k;
const SHORTCUTS = [
  [() => (window.showSaveFilePicker ? "Save" : "Save a copy"), key("S")],
  ["Undo", key("Z")],
  ["Redo", `${key("Shift+Z")} or ${key("Y")}`],
  ["New paragraph", "Enter"],
  ["Body text", alt("0")],
  ["Heading 1 to 4", `${alt("1")} to ${alt("4")}`],
  ["Bold, italic, underline", `${key("B")}, ${key("I")}, ${key("U")}`],
  ["Highlight", key("Shift+H")],
  ["Superscript, subscript", `${key(".")}, ${key(",")}`],
  ["Inline code", key("E")],
  ["Link", key("K")],
  ["Bulleted, numbered list", `${key("Shift+8")}, ${key("Shift+7")}`],
  ["List level down, up", "Tab, Shift+Tab"],
  ["Page break", key("Enter")],
];
// Toolbar glyphs for commands without a shared icon (20 × 20, as shared/shell/icons.mjs).
const svg = (paths) =>
  `<svg class="sh-ic" viewBox="0 0 20 20" aria-hidden="true" focusable="false">${paths}</svg>`;
const GLYPHS = {
  bold: "<b>B</b>",
  italic: "<i>I</i>",
  underline: "<u>U</u>",
  highlight: svg('<path d="m11 4 5 5-6 6H6v-4z"/><path d="M4 17.5h12"/>'),
  superscript: "x<sup>2</sup>",
  subscript: "x<sub>2</sub>",
  code: svg('<path d="m7 6-4 4 4 4M13 6l4 4-4 4"/>'),
  bullets: svg(
    '<circle cx="4" cy="6" r=".8"/><circle cx="4" cy="10" r=".8"/><circle cx="4" cy="14" r=".8"/><path d="M8 6h9M8 10h9M8 14h9"/>',
  ),
  numbers: svg(
    '<path d="M3 4.5h1.2v3.5M3 12.3c.4-.9 2.4-.9 2.4.3 0 1-2.4 1.5-2.4 2.4h2.6M9 6h8M9 10h8M9 14h8"/>',
  ),
  outdent: svg('<path d="M3 4h14M9 8h8M9 12h8M3 16h14M6 8l-3 2 3 2"/>'),
  indent: svg('<path d="M3 4h14M9 8h8M9 12h8M3 16h14M3 8l3 2-3 2"/>'),
  justify: svg('<path d="M3 5h14M3 9h14M3 13h14M3 17h14"/>'),
};
const STYLE_NAMES = Object.fromEntries(STYLES);
const MARK_ITEMS = [
  ["bold", "Bold", key("B")],
  ["italic", "Italic", key("I")],
  ["underline", "Underline", key("U")],
  ["highlight", "Highlight", key("Shift+H")],
  ["superscript", "Superscript", key(".")],
  ["subscript", "Subscript", key(",")],
  ["code", "Inline code", key("E")],
];
const ALIGN_ITEMS = [
  ["align-left", "Align left", null],
  ["align-center", "Center", "ta-c"],
  ["align-right", "Align right", "ta-r"],
  ["justify", "Justify", "ta-j"],
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
// Heading numbers (T08): on or off, and the format of each level, from the theme by default.
const NUMBER_CHOICES = [
  ["off", h("span", {}, "None")],
  ["on", h("span", {}, "Numbered"), h("span", { class: "sh-aa" }, "1, 1.1")],
];
const FORMATS = ["1.1.1.1", "I.A.1.a", "A.1.a.i", "1.a.i.A"];
const formatChoices = (theme) => [
  [
    "document",
    h("span", {}, "Theme default"),
    h("span", { class: "sh-aa" }, theme),
  ],
  ...FORMATS.filter((f) => f !== theme).map((f) => [
    f,
    h("span", {}, f.split(".").slice(0, 3).join(".")),
  ]),
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

// look(): the document's attributes (theme, font, page, margins, heading numbers and format).
// editing(): the selection's style, marks, alignment, list, new-page, link (T06) and the depth
// of a selected contents block (T08). format(): the theme's heading format.
export function mountShell(cmd, saving, report, look, editing, format) {
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
      name: "Insert",
      items: () => [
        item("Link…", "link", { shortcut: key("K") }),
        item("Remove link", "unlink"),
        "-",
        item("Page break", "page-break", { shortcut: key("Enter") }),
        "-",
        item("Contents", "contents"),
        item("Cross-reference…", "xref"),
      ],
    },
    {
      name: "Format",
      items: () => {
        const c = editing();
        return [
          { heading: "Paragraph style" },
          ...styleItems(c),
          "-",
          { heading: "Text" },
          ...MARK_ITEMS.map(([id, label, shortcut]) =>
            item(label, id, { shortcut, checked: c.marks[id] }),
          ),
          "-",
          { heading: "Alignment" },
          ...ALIGN_ITEMS.map(([id, label, value]) =>
            item(label, id, {
              checked: c.align !== undefined && c.align === value,
              radio: true,
            }),
          ),
          "-",
          { heading: "Lists" },
          item("Bulleted list", "bullets", {
            shortcut: key("Shift+8"),
            checked: c.list === "bullet_list",
          }),
          item("Numbered list", "numbers", {
            shortcut: key("Shift+7"),
            checked: c.list === "ordered_list",
          }),
          item("Increase list level", "indent", { shortcut: "Tab" }),
          item("Decrease list level", "outdent", { shortcut: "Shift+Tab" }),
          "-",
          item("Start on a new page", "new-page", {
            checked: c.newPage === true,
          }),
          ...(c.contents
            ? [
                "-",
                { heading: "Contents levels" },
                ...[1, 2, 3, 4].map((n) =>
                  item(n === 1 ? "Level 1" : `Levels 1–${n}`, `contents-${n}`, {
                    checked: c.contents === n,
                    radio: true,
                  }),
                ),
              ]
            : []),
        ];
      },
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
  // The paragraph style: a menu button showing the current style.
  const styleItems = (c) =>
    STYLES.map(([id, label]) =>
      item(label, `style-${id}`, { checked: c.style === id, radio: true }),
    );
  const styleLabel = h("span", { class: "sh-lbl" }, "Body");
  const styleButton = menuButton(
    button({
      label: "Paragraph style",
      text: "Body",
      caret: true,
      cls: "tx-style",
      title: "Paragraph style",
    }),
    () => styleItems(editing()),
    "Paragraph style",
  );
  styleButton.querySelector(".sh-lbl").replaceWith(styleLabel);
  const pressed = [];
  const toggle = (id, label, glyph, title, isOn) => {
    const b = add(id, { label, glyph, title, pressed: false });
    pressed.push([b, isOn]);
    return b;
  };
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
    group("Style", styleButton),
    group(
      "Text",
      ...MARK_ITEMS.map(([id, label, shortcut]) =>
        toggle(
          id,
          label,
          GLYPHS[id],
          `${label} (${shortcut})`,
          (c) => c.marks[id],
        ),
      ),
    ),
    group(
      "Link",
      toggle("link", "Link", null, `Link (${key("K")})`, (c) => !!c.link),
    ),
    group(
      "Lists",
      toggle(
        "bullets",
        "Bulleted list",
        GLYPHS.bullets,
        "Bulleted list",
        (c) => c.list === "bullet_list",
      ),
      toggle(
        "numbers",
        "Numbered list",
        GLYPHS.numbers,
        "Numbered list",
        (c) => c.list === "ordered_list",
      ),
      add("outdent", {
        label: "Decrease list level",
        glyph: GLYPHS.outdent,
        title: "Decrease list level (Shift+Tab)",
      }),
      add("indent", {
        label: "Increase list level",
        glyph: GLYPHS.indent,
        title: "Increase list level (Tab)",
      }),
    ),
    group(
      "Alignment",
      ...ALIGN_ITEMS.map(([id, label, value]) =>
        toggle(
          id,
          label,
          GLYPHS[id],
          label,
          (c) => c.align !== undefined && c.align === value,
        ),
      ),
    ),
  );
  // The link button has the shared icon; the alignment buttons too, except Justify.
  for (const [b, id] of binds) {
    const ic = {
      link: "link",
      "align-left": "alignL",
      "align-center": "alignC",
      "align-right": "alignR",
    }[id];
    if (ic) b.prepend(icon(ic));
  }
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
      numbers: a.headingNumbers ? "on" : "off",
      format: a.headingFormat ?? "document",
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
          h("h3", {}, "Heading numbers"),
          choices(
            "Heading numbers",
            "sh-fonts tx-numbers",
            NUMBER_CHOICES,
            current().numbers,
            (v) => cmd.run("heading-numbers", v === "on"),
          ),
          choices(
            "Number format",
            "sh-fonts tx-formats",
            formatChoices(format()),
            current().format,
            (v) => cmd.run("heading-format", v),
          ),
          h(
            "p",
            { class: "sh-hint" },
            "Unnumbered headings are skipped. Contents and cross-references follow the numbers.",
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
        [
          ".sh-fonts:not(.tx-pages, .tx-margins, .tx-numbers, .tx-formats) > button",
          c.font,
        ],
        [".tx-pages > button", c.page],
        [".tx-margins > button", c.margins],
        [".tx-numbers > button", c.numbers],
        [".tx-formats > button", c.format],
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
    const e = editing();
    for (const [b, isOn] of pressed)
      b.setAttribute("aria-pressed", String(!!isOn(e)));
    text(
      styleLabel,
      STYLE_NAMES[e.style] ??
        (e.style === "list"
          ? "List"
          : e.style === "cover"
            ? "Cover line"
            : "—"),
    );
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
  function recover({ date, asCopy, article, zones }, restore) {
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
        restore({ article, zones });
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
  // The link dialog: web and email addresses (FORMAT.md › Inline content).
  function link(href, back) {
    linkDialog({
      initial: href ? { url: href } : null,
      check: ({ url }) => checkUrl(url) || linkProblem(url.trim()),
      onSave: ({ url }) => cmd.run("set-link", url.trim()),
      onRemove: () => cmd.run("unlink-quiet"),
      // Focus returns through the editor, which puts its selection back.
      opener: { isConnected: true, focus: back },
    });
  }
  // The cross-reference dialog: headings and figures in document order, with their labels.
  // done(id) gets the chosen target, or null when cancelled.
  function xref(targets, done) {
    const describe = (t) =>
      t.kind === "heading"
        ? `${"\u2003".repeat(t.level - 1)}${t.label === t.text ? "" : `${t.label} · `}${t.text || "Untitled heading"}`
        : `${t.label}${t.text ? ` · ${t.text}` : ""}`;
    const list = h(
      "select",
      { size: String(Math.min(12, Math.max(4, targets.length))) },
      targets.map((t, i) =>
        h("option", { value: t.id, selected: i === 0 }, describe(t)),
      ),
    );
    const body = targets.length
      ? [
          field("Refer to", list),
          h(
            "p",
            { class: "sh-hint" },
            "The label follows its target: renumbering or retitling updates it.",
          ),
        ]
      : h("p", {}, "There is no heading or figure to refer to yet.");
    const close = (value) => () => dialog.close(value);
    const dialog = modal(
      "Insert cross-reference",
      body,
      [
        h(
          "button",
          {
            type: "button",
            class: "sh-b sh-t sh-ghost",
            onclick: close("cancel"),
          },
          "Cancel",
        ),
        h("span", { class: "sh-spacer" }),
        targets.length
          ? h(
              "button",
              {
                type: "button",
                class: "sh-b sh-t sh-primary",
                onclick: close("insert"),
              },
              "Insert",
            )
          : null,
      ],
      {
        onClose: (value) => done(value === "insert" ? list.value : null),
        // Focus returns through done(), which puts the editor's selection back.
        opener: { isConnected: false },
      },
    );
    list.addEventListener("dblclick", () => dialog.close("insert"));
    list.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      dialog.close("insert");
    });
    list.focus();
  }
  return { recover, link, xref };
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
