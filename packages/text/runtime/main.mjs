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
import { fromDocument } from "../model/html.mjs";
import { looksCanonical } from "../model/file.mjs";
import { validateFile } from "../model/validate.mjs";
import { toDoc } from "../editor/schema/parse.mjs";
import {
  findArticle,
  saveFile,
  verifySaved,
} from "../editor/schema/document.mjs";
import { subsetGuard } from "../editor/schema/guard.mjs";
import { articleHTML } from "../editor/schema/serialize.mjs";
import { setupSaving } from "./saving.mjs";
import { mountShell, refusal } from "./shell.mjs";
import { LOOK_CSS, lookAttributes, mirrorLook, setLook } from "./look.mjs";
import shellCSS from "../../shared/shell/shell.css";
import drawerCSS from "../../shared/shell/drawer.css";
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
const file = self?.id === "engine" ? fromDocument(document) : null;
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
  style.textContent = shellCSS + drawerCSS + LOOK_CSS + editorCSS;
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

  let view;
  const saving = setupSaving({
    opened,
    canonical: looksCanonical(file, articleHTML(doc)),
    serialize: () => save(view.state.doc),
    // The text about to be written must reopen as the same document; DOMParser runs no script.
    check: (text) =>
      verifySaved(text, view.state.doc, (t) =>
        fromDocument(new DOMParser().parseFromString(t, "text/html")),
      ),
    name: () => (document.title.trim() || "document") + ".html",
    changed: () => commands.changed(),
  });
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
        "Mod-s": () => (commands.run("save"), true),
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
  commands.register(
    "save",
    () => saving.save(),
    () => !saving.busy,
  );
  commands.register("save-copy", () => saving.saveCopy());
  commands.register("print", () => window.print());
  commands.register("undo", run(undo), () => undo(view.state));
  commands.register("redo", run(redo), () => redo(view.state));
  for (const key of ["theme", "font", "page", "margins"])
    commands.register(key, (value) =>
      setLook(key, value)(view.state, view.dispatch),
    );
  mountShell(commands, saving, report, () => view.state.doc.attrs);
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
