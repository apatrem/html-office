// html-text editor bootstrap (T03). The file's own nodes are captured before anything else runs;
// article#doc is validated with the same rules as tools/check.mjs, then edited with ProseMirror.
// Saving writes the captured zones unchanged and article#doc from the editor's document.
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { history, undo, redo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import {
  baseKeymap,
  chainCommands,
  newlineInCode,
  createParagraphNear,
  liftEmptyBlock,
  splitBlockAs,
} from "prosemirror-commands";
import { schema } from "../editor/schema/schema.mjs";
import { createCommands } from "../../shared/shell/commands.mjs";
import { fromDocument, attr } from "../model/html.mjs";
import { looksCanonical } from "../model/file.mjs";
import { validateFile } from "../model/validate.mjs";
import { toDoc } from "../editor/schema/parse.mjs";
import {
  findArticle,
  openFile,
  saveFile,
  verifySaved,
} from "../editor/schema/document.mjs";
import { serializeFile } from "../model/file.mjs";
import { subsetGuard } from "../editor/schema/guard.mjs";
import { articleHTML } from "../editor/schema/serialize.mjs";
import { setupSaving } from "./saving.mjs";
import { mountShell, refusal } from "./shell.mjs";
import { LOOK_CSS, lookAttributes, mirrorLook, setLook } from "./look.mjs";
import shellCSS from "../../shared/shell/shell.css";
import drawerCSS from "../../shared/shell/drawer.css";
import panelsCSS from "../../shared/shell/panels.css";
import editorCSS from "./style.css";

// Enter as in baseKeymap, except: a heading split at its end continues with a paragraph (the
// guard gives a heading split in the middle a fresh ID), and nothing splits inside a footnote or
// a table cell, whose text stays one paragraph (FORMAT.md).
const inside = (types) => (state) => {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 0; d--)
    if (types.includes($from.node(d).type.name)) return true;
  return false;
};
const enter = chainCommands(
  newlineInCode,
  inside(["footnote", "table_cell", "table_header"]),
  createParagraphNear,
  liftEmptyBlock,
  splitBlockAs((node, atEnd) =>
    node.type === schema.nodes.heading && atEnd
      ? { type: schema.nodes.paragraph }
      : null,
  ),
);

// The file is captured while this script runs: as the classic script#engine, last element of the
// file, everything before it is parsed and nothing added later (by the editor, an extension…)
// enters the capture. Run any other way, it refuses to edit.
const self = document.currentScript;
let file = self?.id === "engine" ? fromDocument(document) : null;
const misplaced = {
  ok: false,
  errors: [
    {
      code: "structure",
      message:
        "The editor runs as the classic script#engine, the last element of <body>",
      path: "body",
    },
  ],
};

// File zones found after the engine once parsing ends: a file the capture did not see whole.
function zonesAfter() {
  for (let n = self.nextElementSibling; n; n = n.nextElementSibling)
    if (n.localName === "script" || ["doc", "assets", "echarts"].includes(n.id))
      return true;
  return false;
}

function start() {
  const report = file && !zonesAfter() ? validateFile(file) : misplaced;
  const style = document.createElement("style");
  style.textContent = shellCSS + drawerCSS + panelsCSS + LOOK_CSS + editorCSS;
  document.head.append(style);
  if (!report.ok) {
    refusal(report);
    return;
  }
  const article = document.getElementById("doc");
  const commands = createCommands();
  const save = (doc) => saveFile(file, doc);
  const doc = toDoc(findArticle(file), report.blocks);
  const opened = save(doc);
  // A source that differs from its canonical form where the browser can see it (line breaks in
  // text, attribute order…) would be rewritten by any save: that needs pack.mjs, never a silent save.

  // DOMParser runs no script: the reader for every text this editor writes or restores.
  const read = (text) =>
    fromDocument(new DOMParser().parseFromString(text, "text/html"));
  let view, shell;
  const saving = setupSaving({
    opened,
    canonical: looksCanonical(file, articleHTML(doc)),
    serialize: () => save(view.state.doc),
    // The text about to be written must reopen as the same document; DOMParser runs no script.
    check: (text) => verifySaved(text, view.state.doc, read),
    name: () => (document.title.trim() || "document") + ".html",
    changed: () => commands.changed(),
    draft: () => articleHTML(view.state.doc),
    // The article is a placeholder that restoring replaces with the draft's.
    zones: () =>
      serializeFile(withEngine(file, []), '<article id="doc"></article>'),
    onDraft: (found) => shell.recover(found, restoreDraft),
  });
  // The file tree with the engine's code replaced (a draft stores the zones without it).
  function withEngine(tree, code) {
    const swap = (node) =>
      node.type === "element" && attr(node, "id") === "engine"
        ? Array.isArray(code)
          ? { ...node, children: code }
          : code
        : node.name === "html" || node.name === "body"
          ? { ...node, children: node.children.map(swap) }
          : node;
    return { ...tree, html: swap(tree.html) };
  }
  // A draft is restored with the zones stored with it (its assets, theme…) and this editor: it
  // must validate like a file, and it replaces the document as one undoable edit. Saving then
  // writes those zones.
  function restoreDraft({ article, zones }) {
    if (article === null)
      throw new Error("it was stored by another version of the editor");
    const engine = findEngine(file.html);
    const tree = withEngine(read(zones), engine);
    const next = openFile(read(serializeFile(tree, article))).doc;
    file = tree;
    let tr = view.state.tr.replaceWith(
      0,
      view.state.doc.content.size,
      next.content,
    );
    for (const [name, value] of Object.entries(next.attrs))
      if (tr.doc.attrs[name] !== value) tr = tr.setDocAttribute(name, value);
    view.dispatch(tr.scrollIntoView());
  }
  const findEngine = (node) =>
    node.type === "element" && attr(node, "id") === "engine"
      ? node
      : node.children?.map(findEngine).find(Boolean);
  const run = (command) => () => command(view.state, view.dispatch, view);
  const state = EditorState.create({
    doc,
    plugins: [
      history(),
      subsetGuard(),
      keymap({
        "Mod-z": undo,
        "Mod-y": redo,
        "Shift-Mod-z": redo,
        "Mod-s": () => (
          commands.run(saving.direct ? "save" : "save-copy"),
          true
        ),
      }),
      keymap({ ...baseKeymap, Enter: enter }),
    ],
  });
  view = new EditorView(
    { mount: article },
    {
      state,
      attributes: (state) => ({
        "aria-label": "Document",
        spellcheck: "true",
        ...lookAttributes(state.doc),
      }),
      dispatchTransaction(tr) {
        view.updateState(view.state.apply(tr));
        if (tr.docChanged) saving.edited();
        mirrorLook(view.state.doc);
        commands.changed();
      },
    },
  );
  // Direct Save exists only where the browser can write a chosen file (Chrome, Edge).
  if (saving.direct)
    commands.register(
      "save",
      () => saving.save(),
      () => saving.ready,
    );
  commands.register("save-copy", () => saving.saveCopy());
  commands.register("print", () => window.print());
  commands.register("undo", run(undo), () => undo(view.state));
  commands.register("redo", run(redo), () => redo(view.state));
  for (const key of ["theme", "font", "page", "margins"])
    commands.register(key, (value) =>
      setLook(key, value)(view.state, view.dispatch),
    );
  shell = mountShell(commands, saving, report, () => view.state.doc.attrs);
  mirrorLook(doc);
  document.body.classList.add("tx-editing");
  // Tests and tools read the editor through this handle; it is not part of the file.
  window.htmlText = {
    view,
    commands,
    saving,
    report,
    serialize: () => save(view.state.doc),
  };
}

if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
