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
import { fromDocument, serialize } from "../model/html.mjs";
import { serializeFile } from "../model/file.mjs";
import { validateFile } from "../model/validate.mjs";
import { toDoc } from "../editor/schema/parse.mjs";
import {
  findArticle,
  saveFile,
  verifySaved,
} from "../editor/schema/document.mjs";
import { subsetGuard } from "../editor/schema/guard.mjs";
import { setupSaving } from "./saving.mjs";
import { mountShell, refusal } from "./shell.mjs";
import shellCSS from "../../shared/shell/shell.css";
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

// The file is captured while this script runs: it is the last element of the file, so everything
// before it is parsed, and nothing added later (by the editor, an extension…) enters the capture.
const file = fromDocument(document);

function start() {
  const report = validateFile(file);
  const style = document.createElement("style");
  style.textContent = shellCSS + editorCSS;
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
  const asRead = serializeFile(file, serialize(findArticle(file)));
  let view;
  const saving = setupSaving({
    opened,
    canonical: asRead === opened,
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
      attributes: { "aria-label": "Document", spellcheck: "true" },
      dispatchTransaction(tr) {
        view.updateState(view.state.apply(tr));
        if (tr.docChanged) saving.edited();
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
  mountShell(commands, saving, report);
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
