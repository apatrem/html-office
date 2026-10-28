// The editor's clipboard (T07, ADR-013). Every paste and drop from outside is read here, never by
// ProseMirror's DOM parser: html-office envelopes first, then HTML through the subset mapping
// (editor/clipboard/html.mjs), then plain text. Clipboard HTML is parsed into a detached
// <template> and read as data. A selected table is copied as the html-office envelope, a
// semantic table for other applications and TSV; any other selection as subset HTML and text.
import { Slice, Fragment } from "prosemirror-model";
import { NodeSelection, TextSelection } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import {
  SCHEMA,
  MIME,
  LIMITS,
  ClipboardError,
  decodeEnvelope,
  findEnvelope,
  parseInert,
  writeClipboard,
  tableText,
  fromTSV,
  validateTable,
} from "../../shared/clipboard/index.mjs";
import { schema, domFromTree } from "../editor/schema/schema.mjs";
import {
  blockTree,
  inlineTrees,
  cellTree,
} from "../editor/schema/serialize.mjs";
import { element } from "../model/html.mjs";
import { FORMAT_VERSION } from "../model/format.mjs";
import {
  fromHTML,
  textBlocks,
  inlineLines,
  describeLost,
} from "../editor/clipboard/html.mjs";
import { markdownHTML, MAX_MARKDOWN } from "../editor/clipboard/markdown.mjs";
import {
  LIMIT,
  tableFigure,
  portableTable,
  tableGrid,
} from "../editor/clipboard/table.mjs";
import { usedIds } from "../editor/commands.mjs";

const N = schema.nodes;
const MAX_CELLS = LIMIT.rows * LIMIT.columns;
// Textblocks that hold one paragraph of inline content: what is pasted there becomes lines.
const ONE_PARAGRAPH = [
  N.table_cell,
  N.table_header,
  N.caption,
  N.title,
  N.subtitle,
  N.footnote,
];

const skipped = (schema) =>
  `Clipboard data in an unsupported format (${schema}) was skipped; a newer version may be needed.`;

// What a DataTransfer holds, as blocks for `doc`: {blocks, lost, notices}. Throws a
// ClipboardError when the paste must be refused (a broken envelope, a table over the limits).
// The IDs a pasted cross-reference may keep: the document's headings and figures (T08).
const FIGURES = new Set([N.heading, N.chart, N.image_figure, N.table_figure]);
function referenceIds(doc) {
  const ids = new Set();
  doc.descendants((node) => {
    if (FIGURES.has(node.type) && node.attrs.id) ids.add(node.attrs.id);
  });
  return ids;
}

export function readTransfer(data, doc, { plain = false } = {}) {
  const types = Array.from(data.types ?? []),
    get = (type) => (types.includes(type) ? data.getData(type) : ""),
    used = usedIds(doc),
    targets = referenceIds(doc),
    notices = [],
    none = new Map();
  const text = () => {
    const value = get("text/plain");
    if (value.length > LIMITS.text)
      throw new ClipboardError("the clipboard text is too large");
    return value;
  };
  if (!plain) {
    let envelope = null;
    const custom = get(MIME);
    if (custom) {
      const read = decodeEnvelope(custom, { maxCells: MAX_CELLS });
      if (read.envelope) envelope = read.envelope;
      else notices.push(skipped(read.skipped));
    }
    const html = get("text/html");
    // HTML over its limit cannot be inspected and is treated as absent (ADR-013 §1).
    const root = html && html.length <= LIMITS.html ? parseInert(html) : null;
    if (!envelope && root) {
      const attribute = findEnvelope(root);
      if (attribute !== null) {
        const read = decodeEnvelope(attribute, { maxCells: MAX_CELLS });
        if (read.envelope) envelope = read.envelope;
        else notices.push(skipped(read.skipped));
      }
    }
    if (envelope?.kind === "chart")
      throw new ClipboardError("a chart is pasted (Edit › Paste), not dropped");
    if (envelope?.table)
      return {
        blocks: [tableFigure(envelope.table, used)],
        lost: none,
        notices,
      };
    // A Data range too large for a portable table: its TSV, as a table.
    if (envelope)
      return {
        blocks: [
          tableFigure(
            validateTable({
              rows: fromTSV(text(), { maxCells: MAX_CELLS }).map((row) =>
                row.map((value) => (value ? { text: value } : null)),
              ),
            }),
            used,
          ),
        ],
        lost: none,
        notices,
      };
    if (root) {
      const read = fromHTML(root, { used, targets, maxCells: MAX_CELLS });
      if (read.blocks.length || !types.includes("text/plain"))
        return { ...read, notices };
    }
  }
  return { blocks: textBlocks(text()), lost: none, notices, plain: true };
}

// The blocks as a slice for the selection: blocks in the document's body, quotes, callouts and
// lists; lines in a textblock that holds one paragraph; text in code.
function sliceFor($from, blocks, plain) {
  const parent = $from.parent;
  if (parent.type.spec.code) {
    const text = blocks
      .map((b) => b.textBetween(0, b.content.size, "\n", "\n"))
      .join("\n");
    return new Slice(Fragment.from(text ? schema.text(text) : []), 0, 0);
  }
  // Plain text takes the marks where it lands, as typing does.
  const marks = plain ? $from.marks() : null;
  const mark = (node) =>
    marks && node.isText
      ? node.mark(node.type.schema.marks.link.removeFromSet(marks))
      : node;
  if (ONE_PARAGRAPH.includes(parent.type)) {
    let nodes = inlineLines(blocks);
    if (parent.type === N.footnote)
      nodes = nodes.flatMap((n) =>
        n.isText || n.type === N.xref
          ? [n]
          : n.type === N.hard_break
            ? [schema.text(" ", n.marks)]
            : n.textContent
              ? [schema.text(n.textContent, n.marks)]
              : [],
      );
    return new Slice(Fragment.fromArray(nodes.map(mark)), 0, 0);
  }
  if (marks)
    blocks = blocks.map((b) =>
      b.type.create(b.attrs, Fragment.fromArray(childrenOf(b).map(mark))),
    );
  // An edge opens into the textblock at the caret only when it is a paragraph (its text joins the
  // caret's block), a list where the caret is in a list, or, in an empty block, anything but a
  // table: a pasted heading, quote or table stays itself next to the caret's paragraph, and a
  // table is never opened (its cells would become text).
  const fragment = Fragment.fromArray(blocks),
    open = Slice.maxOpen(fragment, false);
  const opens = (node) =>
    node.type !== N.table_figure &&
    (!parent.content.size ||
      node.type === N.paragraph ||
      (parent.type === N.list_text &&
        (node.type === N.bullet_list || node.type === N.ordered_list)));
  return new Slice(
    fragment,
    opens(blocks[0]) ? open.openStart : 0,
    opens(blocks.at(-1)) ? open.openEnd : 0,
  );
}
const childrenOf = (node) => {
  const out = [];
  node.forEach((n) => out.push(n));
  return out;
};

// Literal styles for other applications, read from the rendered cell (ADR-013 §3): the one place
// where charte tokens become colours.
function literal(cell) {
  if (!cell) return "";
  const cs = getComputedStyle(cell),
    align = { start: "left", end: "right" }[cs.textAlign] || cs.textAlign;
  let out = `color:${cs.color};font-weight:${cs.fontWeight};font-style:${cs.fontStyle};text-align:${align};`;
  if (!/^(transparent|rgba\(.*,\s*0\))$/.test(cs.backgroundColor))
    out += `background-color:${cs.backgroundColor};`;
  for (const side of ["Top", "Right", "Bottom", "Left"])
    if (
      cs[`border${side}Style`] !== "none" &&
      parseFloat(cs[`border${side}Width`]) > 0
    )
      out += `border-${side.toLowerCase()}:${cs[`border${side}Width`]} ${cs[`border${side}Style`]} ${cs[`border${side}Color`]};`;
  return out;
}

// The table a selection copies as a table: a selected table figure or table, or a cell
// selection (T10): {table, pos, rect}. Anything else is copied as subset HTML.
export function selectedTable(state) {
  const sel = state.selection;
  if (sel instanceof NodeSelection) {
    if (sel.node.type === N.table) return { table: sel.node, pos: sel.from };
    if (sel.node.type === N.table_figure) {
      const table = sel.node.lastChild;
      return { table, pos: sel.to - 1 - table.nodeSize };
    }
  }
  return null;
}

// Writes the envelope, a semantic table and TSV; throws a ClipboardError when it cannot.
export function copyTable(view, data, { table, pos, rect }) {
  const model = portableTable(table, rect);
  const top = rect?.top ?? 0,
    left = rect?.left ?? 0;
  const cells = new Map(
    tableGrid(table, pos).anchors.map((a) => [
      `${a.r - top},${a.c - left}`,
      a.pos,
    ]),
  );
  return writeClipboard(data, {
    envelope: {
      schema: SCHEMA,
      kind: "table",
      source: { product: "text", format: FORMAT_VERSION },
      table: model,
    },
    table: model,
    text: tableText(model),
    html: {
      css: (_slot, r, c) => {
        const at = cells.get(`${r},${c}`);
        return literal(at === undefined ? null : view.nodeDOM(at));
      },
    },
  });
}

// What leaves the document: no comment anchors or threads, and no images (their assets stay in
// this file). A copy inside the document keeps them through the internal clipboard (T09).
const comment = schema.marks.comment;
function outward(fragment) {
  const kept = [];
  fragment.forEach((node) => {
    if ([N.comments, N.comment_thread, N.image_figure].includes(node.type))
      return;
    const marks = comment.removeFromSet(node.marks);
    kept.push(
      node.isLeaf
        ? node.mark(marks)
        : node.type.create(node.attrs, outward(node.content), marks),
    );
  });
  return Fragment.fromArray(kept);
}

// Subset HTML for a copied slice (ProseMirror adds its context and data-pm-slice): what Text
// reads back exactly, and other applications as semantic HTML. An element is always written,
// for the internal clipboard's token.
function trees(whole) {
  const fragment = outward(whole);
  if (!fragment.size) return [element("p", [], [])];
  if (fragment.firstChild?.isInline) return inlineTrees(fragment);
  const out = [];
  fragment.forEach((node) => {
    if (node.type === N.table_row) {
      const cells = [];
      node.forEach((c) => cells.push(cellTree(c)));
      out.push(element("tr", [], cells));
    } else if (node.type === N.table_cell || node.type === N.table_header)
      out.push(cellTree(node));
    else if (node.type === N.list_text)
      out.push(element("p", [], inlineTrees(node.content)));
    else out.push(blockTree(node));
  });
  return out;
}
export const clipboardSerializer = {
  serializeFragment(fragment, options = {}, target) {
    const out =
      target ?? (options.document ?? document).createDocumentFragment();
    for (const tree of trees(fragment)) out.appendChild(domFromTree(tree));
    return out;
  },
};
// Line breaks and cross-reference labels in the plain text of a copy.
export const clipboardTextSerializer = (slice) =>
  slice.content.textBetween(0, slice.content.size, "\n\n", (leaf) =>
    leaf.type === N.hard_break
      ? "\n"
      : leaf.type === N.xref
        ? leaf.attrs.label
        : "",
  );

// The clipboard handlers of the editor view. notify(text) shows a message in the status line.
// first: handlePaste functions (view, event) => boolean that may take a paste before the mapping
// (the internal clipboard of T09, the chart envelope of T11); a plain-text paste skips them.
export function setupClipboard(notify, first = []) {
  let plainNext = false;
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);

  // Inserts blocks at the selection (or at `at`, a drop position) as one undoable step.
  function insert(view, read, at = null, what = "Pasted") {
    const tr = view.state.tr;
    if (at !== null) tr.setSelection(TextSelection.near(tr.doc.resolve(at)));
    const slice = sliceFor(tr.selection.$from, read.blocks, read.plain);
    if (!slice.size) {
      const message = describeLost(read.lost);
      notify(
        [...read.notices, message ? `Nothing to paste. ${message}` : ""]
          .filter(Boolean)
          .join(" "),
      );
      return;
    }
    tr.replaceSelection(slice)
      .scrollIntoView()
      .setMeta("paste", true)
      .setMeta("uiEvent", at === null ? "paste" : "drop");
    // One undo step of its own: neither joined to the typing before it nor to what follows.
    view.dispatch(closeHistory(tr));
    view.dispatch(closeHistory(view.state.tr));
    const message = describeLost(read.lost);
    const notes = [...read.notices, message].filter(Boolean);
    if (notes.length) notify(`${what}. ${notes.join(" ")}`);
  }
  // Runs a read; a refused paste leaves the document unchanged and says why.
  function attempt(view, run) {
    try {
      run();
    } catch (error) {
      if (!(error instanceof ClipboardError)) console.error(error);
      notify(
        `Nothing was pasted: ${error instanceof ClipboardError ? error.message : "the clipboard content could not be read"}.`,
      );
    }
    view.focus();
  }

  const handleDOMEvents = {
    keydown(_view, event) {
      plainNext =
        event.shiftKey &&
        (mac ? event.metaKey : event.ctrlKey) &&
        event.key.toLowerCase() === "v";
      return false;
    },
    paste(view, event) {
      const data = event.clipboardData;
      if (!data) return false;
      event.preventDefault();
      // Shift held while pasting (ProseMirror's own reading of the keyboard) is plain text too.
      const plain = plainNext || !!view.input?.shiftKey;
      plainNext = false;
      if (!plain && first.some((handle) => handle(view, event))) return true;
      attempt(view, () =>
        insert(view, readTransfer(data, view.state.doc, { plain })),
      );
      return true;
    },
    // Content dragged in from outside; a drag inside the document moves its own slice.
    drop(view, event) {
      const data = event.dataTransfer;
      if (view.dragging || !data) return false;
      if (
        !["text/html", "text/plain", MIME].some((t) => data.types.includes(t))
      )
        return false;
      event.preventDefault();
      const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (!at) return true;
      attempt(view, () =>
        insert(view, readTransfer(data, view.state.doc), at.pos, "Dropped"),
      );
      return true;
    },
    copy: (view, event) => copy(view, event, false),
    cut: (view, event) => copy(view, event, true),
  };
  function copy(view, event, cut) {
    const found = selectedTable(view.state);
    if (!found || !event.clipboardData) return false;
    event.preventDefault();
    try {
      copyTable(view, event.clipboardData, found);
    } catch (error) {
      notify(`Copy failed: ${error.message}.`);
      return true;
    }
    if (cut && view.editable)
      view.dispatch(
        view.state.tr
          .deleteSelection()
          .scrollIntoView()
          .setMeta("uiEvent", "cut"),
      );
    return true;
  }

  // Edit › Paste as plain text: through the asynchronous clipboard where the browser allows it.
  async function pastePlain(view) {
    let text;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      notify(
        `This browser does not let the page read the clipboard: press ${mac ? "⌘⇧V" : "Ctrl+Shift+V"} to paste as plain text.`,
      );
      return;
    }
    attempt(view, () => {
      if (text.length > LIMITS.text)
        throw new ClipboardError("the clipboard text is too large");
      insert(view, {
        blocks: textBlocks(text),
        lost: new Map(),
        notices: [],
        plain: true,
      });
    });
  }

  // Insert › Markdown: the source as blocks at the selection; returns an error message or "".
  function insertMarkdown(view, source) {
    if (source.length > MAX_MARKDOWN) return "The Markdown is too long.";
    try {
      const read = fromHTML(parseInert(markdownHTML(source)), {
        used: usedIds(view.state.doc),
        targets: referenceIds(view.state.doc),
        maxCells: MAX_CELLS,
      });
      if (!read.blocks.length) return "There is nothing to insert.";
      insert(view, { ...read, notices: [] }, null, "Markdown inserted");
      if (!describeLost(read.lost)) notify("Markdown inserted.");
      return "";
    } catch (error) {
      if (!(error instanceof ClipboardError)) throw error;
      return `The Markdown cannot be inserted: ${error.message}.`;
    }
  }

  return {
    handleDOMEvents,
    clipboardSerializer,
    clipboardTextSerializer,
    pastePlain,
    insertMarkdown,
  };
}
