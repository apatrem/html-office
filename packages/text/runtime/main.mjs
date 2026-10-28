// html-text editor bootstrap (T03). The file's own nodes are captured before anything else runs;
// article#doc is validated with the same rules as tools/check.mjs, then edited with ProseMirror.
// Saving writes the captured zones unchanged and article#doc from the editor's document.
import {
  EditorState,
  Selection,
  TextSelection,
  NodeSelection,
} from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { history, undo, redo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import {
  baseKeymap,
  chainCommands,
  toggleMark,
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
import * as G from "../editor/generated.mjs";
import { regenerate, fileFormat } from "../editor/numbering.mjs";
import { internalClipboard } from "../editor/internal-clipboard.mjs";
import * as E from "../editor/commands.mjs";
import * as T from "../editor/tables.mjs";
import { articleHTML } from "../editor/schema/serialize.mjs";
import { setupSaving } from "./saving.mjs";
import { setupClipboard } from "./clipboard.mjs";
import * as I from "../editor/images.mjs";
import { assetStore } from "../model/assets.mjs";
import {
  imagePlugin,
  imageDialog,
  imageError,
  pickImage,
  shrinkImage,
} from "./images.mjs";
import { mountShell, refusal } from "./shell.mjs";
import * as C from "../editor/charts.mjs";
import { chartManager, chartPlugin, chartDialog } from "./charts.mjs";
import { commentsPanel, commentHighlights } from "./comments.mjs";
import { LOOK_CSS, lookAttributes, mirrorLook, setLook } from "./look.mjs";
import shellCSS from "../../shared/shell/shell.css";
import drawerCSS from "../../shared/shell/drawer.css";
import panelsCSS from "../../shared/shell/panels.css";
import editorCSS from "./style.css";

// Enter as in baseKeymap, except: a list item splits into items (an empty one leaves its level);
// a heading split at its end continues with a paragraph (the guard gives a heading split in the
// middle a fresh ID), as do the cover's title and subtitle; nothing splits inside a footnote or a
// table cell, whose text stays one paragraph (FORMAT.md).
const inside = (types) => (state) => {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 0; d--)
    if (types.includes($from.node(d).type.name)) return true;
  return false;
};
const enter = chainCommands(
  newlineInCode,
  inside(["footnote", "table_cell", "table_header"]),
  E.splitListItem,
  E.titleEnter,
  createParagraphNear,
  liftEmptyBlock,
  splitBlockAs((node, atEnd) =>
    (node.type === schema.nodes.heading && atEnd) ||
    node.type === schema.nodes.title ||
    node.type === schema.nodes.subtitle
      ? { type: schema.nodes.paragraph }
      : null,
  ),
);
const M = schema.marks,
  N = schema.nodes;
// Inline marks: command ID, mark, label, shortcut key.
export const MARKS = [
  ["bold", M.strong, "Bold", "Mod-b"],
  ["italic", M.em, "Italic", "Mod-i"],
  ["underline", M.u, "Underline", "Mod-u"],
  ["highlight", M.highlight, "Highlight", "Mod-Shift-h"],
  ["superscript", M.sup, "Superscript", "Mod-."],
  ["subscript", M.sub, "Subscript", "Mod-,"],
  ["code", M.code, "Inline code", "Mod-e"],
];
// Table commands (T10): command ID and command; the shell names them.
const TABLE_COMMANDS = [
  ["insert-table", T.insertTable()],
  ["row-above", T.addRowBefore],
  ["row-below", T.addRowAfter],
  ["column-left", T.addColumnBefore],
  ["column-right", T.addColumnAfter],
  ["delete-rows", T.deleteRows],
  ["delete-columns", T.deleteColumns],
  ["delete-table", T.deleteTable],
  ["merge-cells", T.mergeCells],
  ["split-cell", T.splitCell],
  ["header-rows", T.toggleHeaderRows],
  ["total-rows", T.toggleTotalRows],
  ["row-headers", T.toggleRowHeaders],
  ["emphasis", T.toggleEmphasis],
  ["compact", T.toggleCompact],
  ["distribute-columns", T.distributeColumns],
  ["caption", T.toggleCaption],
];
const ALIGNS = [
  ["align-left", null],
  ["align-center", "ta-c"],
  ["align-right", "ta-r"],
  ["justify", "ta-j"],
];

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
  // Images (T12): saving writes only the assets the document uses.
  const assets = assetStore(file);
  const save = (doc) => saveFile(assets.fileFor(file, doc), doc);
  const doc = toDoc(findArticle(file), report.blocks);
  // The file as opened, unused assets included: Save checks the chosen file against it.
  const opened = saveFile(file, doc);
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
      serializeFile(
        withEngine(assets.fileFor(file, view.state.doc), []),
        '<article id="doc"></article>',
      ),
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
  // must validate like a file. It replaces the document and starts a new history, since undo
  // cannot bring back the zones it replaced; saving then writes those zones.
  function restoreDraft({ article, zones }) {
    if (article === null)
      throw new Error("it was stored by another version of the editor");
    const tree = withEngine(read(zones), findEngine(file.html));
    const next = openFile(read(serializeFile(tree, article))).doc;
    file = tree;
    assets.reset(file);
    numbers.format = fileFormat(file);
    E.reserveIds(fileIds(file.html));
    view.updateState(
      EditorState.create({ doc: next, plugins: view.state.plugins }),
    );
    refresh();
    saving.edited();
    mirrorLook(next);
    commands.changed();
  }
  // New heading IDs avoid the IDs of the file's other elements (title, guide, zones).
  const fileIds = (node, out = []) => {
    if (node.type !== "element") return out;
    if (node.name === "article" && attr(node, "id") === "doc") return out;
    const id = attr(node, "id");
    if (id !== null) out.push(id);
    for (const child of node.children) fileIds(child, out);
    return out;
  };
  E.reserveIds(fileIds(file.html));
  const findEngine = (node) =>
    node.type === "element" && attr(node, "id") === "engine"
      ? node
      : node.children?.map(findEngine).find(Boolean);
  const run = (command) => () => command(view.state, view.dispatch, view);
  // The layout theme's heading format (style#theme --heading-format, T08), read from the file
  // as check.mjs reads it. A restored draft brings its own theme, so the options change then.
  const numbers = { format: fileFormat(file) };
  const charts = chartManager(() => commands.changed());
  // Generated labels and contents are rewritten on open, outside the undo history: a stale
  // label written by hand or by an LLM shows as an unsaved change and is corrected on save.
  const refresh = () => {
    const tr = view.state.tr;
    if (regenerate(tr, numbers))
      view.dispatch(tr.setMeta("addToHistory", false));
  };
  // Pastes go through T07's clipboard handling, which first gives them to the internal clipboard
  // (a copy from this document, kept whole: T09) and to the chart plugin (a chart envelope: T11).
  const internal = internalClipboard();
  const chartsPlugin = chartPlugin(
    charts,
    () => commands.run("chart"),
    (message) => saving.say(message),
  );
  const state = EditorState.create({
    doc,
    plugins: [
      history(),
      // Cell selections, arrow keys and fixing table shapes, then Text's own table shape (T10).
      T.cellKeys(),
      T.tableEditing(),
      T.tableGuard(),
      subsetGuard(),
      imagePlugin(assets, () => commands.run("image")),
      chartsPlugin,
      G.generatedContent(numbers),
      internal,
      commentHighlights(),
      keymap({
        "Mod-z": undo,
        "Mod-y": redo,
        "Shift-Mod-z": redo,
        ...Object.fromEntries(
          MARKS.map(([, type, , k]) => [k, toggleMark(type)]),
        ),
        "Mod-Alt-0": E.setStyle("body"),
        ...Object.fromEntries(
          [1, 2, 3, 4].map((n) => [`Mod-Alt-${n}`, E.setStyle(`h${n}`)]),
        ),
        "Mod-Shift-8": E.toggleList(N.bullet_list),
        "Mod-Shift-7": E.toggleList(N.ordered_list),
        // In a table Tab moves between cells (adding a row after the last); in a list it
        // changes the level. It never leaves the document.
        Tab: (s, d, v) =>
          T.own(T.nextCell)(s, d, v) || (E.inList(s) && (E.indent(s, d), true)),
        "Shift-Tab": (s, d) =>
          T.previousCell(s, d) || (E.inList(s) && (E.outdent(s, d), true)),
        "Mod-Enter": E.insertPageBreak,
        "Mod-Alt-f": G.insertFootnote,
        "Mod-Alt-m": () => (commands.run("comment"), true),
        "Alt-Shift-ArrowUp": I.moveBlock(-1),
        "Alt-Shift-ArrowDown": I.moveBlock(1),
        "Mod-k": () => (commands.run("link"), true),
        Backspace: E.liftListItem,
        "Mod-s": () => (
          commands.run(saving.direct ? "save" : "save-copy"),
          true
        ),
      }),
      keymap({ ...baseKeymap, Enter: enter }),
    ],
  });
  // Paste, drop and copy (T07): clipboard content is read as data through the subset mapping.
  const clipboard = setupClipboard((text) => saving.say(text), {
    internal,
    chart: chartsPlugin.props.handlePaste,
    assets,
  });
  view = new EditorView(
    { mount: article },
    {
      state,
      handleDOMEvents: clipboard.handleDOMEvents,
      clipboardSerializer: clipboard.clipboardSerializer,
      clipboardTextSerializer: clipboard.clipboardTextSerializer,
      // The caret is kept clear of the sticky file bar and the floating settings bar.
      scrollMargin: { top: 110, bottom: 90, left: 5, right: 5 },
      scrollThreshold: { top: 110, bottom: 90, left: 0, right: 0 },
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
  // Editing commands (T06): enabled where they apply; run from the chrome, they return the
  // keyboard to the document.
  const edit = (id, command) =>
    commands.register(
      id,
      () => {
        command(view.state, view.dispatch, view);
        view.focus();
      },
      () => command(view.state),
    );
  for (const [style] of E.STYLES) edit(`style-${style}`, E.setStyle(style));
  for (const [id, type] of MARKS) edit(id, toggleMark(type));
  for (const [id, value] of ALIGNS) edit(id, E.setAlign(value));
  edit("bullets", E.toggleList(N.bullet_list));
  edit("numbers", E.toggleList(N.ordered_list));
  edit("indent", E.indent);
  edit("outdent", E.outdent);
  edit("page-break", E.insertPageBreak);
  edit("new-page", E.toggleNewPage);
  edit("unlink", E.removeLink);
  commands.register("unlink-quiet", () =>
    E.removeLink(view.state, view.dispatch),
  );
  // The link dialog asks for the address; set-link applies it.
  commands.register(
    "set-link",
    // Run from the link dialog, which hands focus back through "focus" once it has closed:
    // focusing the editor behind a modal dialog would move the selection (Safari).
    (href) => E.setLink(href)(view.state, view.dispatch),
    () => true,
  );
  // The dialog gives focus back through `back`: a native dialog refocuses the article first,
  // which resets the caret in Safari, so the selection is put back (links move no position).
  commands.register(
    "link",
    () => {
      const { anchor, head } = view.state.selection;
      shell.link(E.linkAt(view.state), () => {
        const size = view.state.doc.content.size;
        const at = (p) => Math.min(p, size);
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(view.state.doc, at(anchor), at(head)),
          ),
        );
        view.focus();
      });
    },
    () => {
      const { empty } = view.state.selection;
      return (
        (!empty || !!E.linkAt(view.state)) &&
        E.setLink("https://a.b")(view.state)
      );
    },
  );
  // Tables (T10): each command is enabled where it applies.
  for (const [id, command] of TABLE_COMMANDS) edit(id, T.own(command));
  commands.register(
    "column-width",
    () =>
      shell.columnWidth(T.columnWidthAt(view.state), (percent) => {
        T.own(T.setColumnWidth(percent))(view.state, view.dispatch, view);
        view.focus();
      }),
    () => T.isInTable(view.state),
  );
  commands.register("paste-plain", () => clipboard.pastePlain(view));
  // The Markdown dialog inserts at the selection, then gives focus back with the caret after it
  // (a native dialog refocuses the article first, which resets the caret in Safari).
  commands.register("markdown", () => {
    let { doc, selection } = view.state;
    shell.markdown(
      (source) => {
        const error = clipboard.insertMarkdown(view, source);
        ({ doc, selection } = view.state);
        return error;
      },
      () => {
        if (view.state.doc === doc)
          view.dispatch(view.state.tr.setSelection(selection));
        view.focus();
      },
    );
  });
  commands.register("undo", run(undo), () => undo(view.state));
  commands.register("redo", run(redo), () => redo(view.state));
  for (const key of ["theme", "font", "page", "margins"])
    commands.register(key, (value) =>
      setLook(key, value)(view.state, view.dispatch),
    );
  // Numbering, contents and cross-references (T08).
  commands.register("heading-numbers", (on) =>
    G.setHeadingNumbers(on)(view.state, view.dispatch),
  );
  commands.register("heading-format", (value) =>
    G.setHeadingFormat(value, numbers.format)(view.state, view.dispatch),
  );
  edit("contents", G.insertContents);
  edit("footnote", G.insertFootnote);
  for (const depth of [1, 2, 3, 4])
    edit(`contents-${depth}`, G.setContentsDepth(depth));
  // As with links, a dialog puts the selection back once it has closed (a native dialog
  // refocuses the article first, which resets the caret in Safari).
  const keepSelection = () => {
    const kept = view.state.selection.toJSON();
    return () => {
      try {
        view.dispatch(
          view.state.tr.setSelection(Selection.fromJSON(view.state.doc, kept)),
        );
      } catch {
        // The document changed under the dialog: the selection stays where it is.
      }
      view.focus();
    };
  };
  // The cross-reference dialog lists the targets; the chosen one is inserted at the selection.
  commands.register(
    "xref",
    () => {
      const back = keepSelection();
      shell.xref(G.referenceTargets(view.state), (target) => {
        back();
        if (target) G.insertXref(target)(view.state, view.dispatch);
      });
    },
    () => G.insertXref(null)(view.state),
  );
  // Images (T12): a picked file is shrunk, described in the dialog, then inserted; the
  // selected image's dialog changes its description, layout and width, or replaces it.
  const addImage = async () => {
    const picked = await pickImage();
    if (!picked) return null;
    try {
      return await shrinkImage(picked);
    } catch {
      imageError(picked.name);
      return null;
    }
  };
  const url = (image) => `data:${image.type};base64,${image.data}`;
  commands.register("image-insert", async () => {
    const back = keepSelection();
    const image = await addImage();
    if (!image) return back();
    imageDialog({
      initial: null,
      preview: url(image),
      onSave: (attrs) => {
        back();
        I.insertImage({ ...attrs, asset: assets.add(image) })(
          view.state,
          view.dispatch,
        );
      },
      done: back,
    });
  });
  commands.register(
    "image",
    () => {
      const found = I.imageAt(view.state);
      if (!found) return;
      const back = keepSelection();
      // The figure is named by its ID and its picture: an edit made while the dialog or the file
      // picker is open (the figure deleted, another inserted with the same ID, a draft restored)
      // never retargets the change to another image.
      const { id, asset } = found.node.attrs;
      const apply = (changes) => {
        back();
        if (I.imageById(view.state, id)?.node.attrs.asset === asset)
          I.setImage(changes, id)(view.state, view.dispatch);
        view.focus();
      };
      imageDialog({
        initial: found.node.attrs,
        preview: assets.url(found.node.attrs.asset),
        onSave: apply,
        onReplace: async () => {
          const image = await addImage();
          if (image) apply({ asset: assets.add(image) });
          else back();
        },
        done: back,
      });
    },
    () => !!I.imageAt(view.state),
  );
  // Charts (T11): the dialog edits type, width, title, unit and data; a new or changed chart is
  // drawn when ECharts is available, and its preview saved.
  commands.register("chart-insert", () => {
    const back = keepSelection();
    chartDialog({
      initial: null,
      onSave: (chart) => {
        back();
        C.insertChart(chart)(view.state, view.dispatch);
      },
      done: back,
    });
  });
  commands.register(
    "chart",
    () => {
      const found = C.chartAt(view.state);
      if (!found) return;
      const back = keepSelection();
      const { id, type, width, data } = found.node.attrs;
      chartDialog({
        initial: { type, width, data: JSON.parse(data) },
        onSave: (chart) => {
          back();
          C.setChart(chart, id)(view.state, view.dispatch);
        },
        done: back,
      });
    },
    () => !!C.chartAt(view.state),
  );
  commands.register(
    "draw-charts",
    () => charts.request(),
    () => charts.library === null,
  );
  // Comments (T13): the panel holds threads; a comment starts from the selected text.
  const comments = commentsPanel(view, (message) => {
    saving.say(message);
  });
  commands.register(
    "comment",
    () => shell.openComments(true),
    () => !view.state.selection.empty,
  );
  commands.register("comments", () => shell.openComments(false));
  edit("move-up", I.moveBlock(-1));
  edit("move-down", I.moveBlock(1));
  // What the toolbar and menus show as current.
  const current = () => {
    const s = view.state;
    return {
      style: E.styleAt(s),
      marks: Object.fromEntries(
        MARKS.map(([id, type]) => [id, E.markActive(s, type)]),
      ),
      align: E.alignAt(s),
      list: E.listKind(s)?.name ?? null,
      newPage: E.newPageAt(s),
      link: E.linkAt(s),
      contents: G.selectedContents(s)?.node.attrs.depth ?? null,
      table: T.isInTable(s) && {
        header: T.headerRowsAt(s),
        total: T.totalAt(s),
        rowHeaders: T.rowHeadersAt(s),
        emphasis: T.emphasisAt(s),
        compact: T.compactAt(s),
        caption: T.captionAt(s),
      },
    };
  };
  shell = mountShell(
    commands,
    saving,
    report,
    () => view.state.doc.attrs,
    current,
    () => numbers.format,
    comments,
  );
  refresh();
  mirrorLook(doc);
  document.body.classList.add("tx-editing");
  // Tests and tools read the editor through this handle; it is not part of the file.
  window.htmlText = {
    view,
    commands,
    saving,
    report,
    serialize: () => save(view.state.doc),
    // Resolves once pastes waiting for their images are in the document (T12b).
    pasted: () => clipboard.settled(),
    TextSelection,
    NodeSelection,
    CellSelection: T.CellSelection,
  };
}

if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
