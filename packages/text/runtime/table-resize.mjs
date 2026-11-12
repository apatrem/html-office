// Dragging a table's column borders: the column on the dragged side changes, the others keep
// their widths, so the table grows or shrinks by as much (up to the text column, where the drag
// stops). A left-aligned or centred table resizes the column left of a border, a right-aligned
// one the column right of it, so the border follows the pointer. Widths stay whole percentages
// (FORMAT.md › Table): the table's of the text column, the columns' of the table. The preview
// changes only inline styles, which ProseMirror ignores (the figure's view below; the table's,
// print.mjs, ignores everything outside its rows); releasing the pointer applies the result as
// one undo step.
import { Plugin } from "prosemirror-state";
import { DOMSerializer } from "prosemirror-model";
import { TableMap } from "prosemirror-tables";
import { schema } from "../editor/schema/schema.mjs";
import { own, resizedColumns, setColumnWidths } from "../editor/tables.mjs";

const N = schema.nodes;
const EDGE = 4; // pixels either side of a border that grab it

// The figure, rendered from its toDOM spec, with its attributes patched in place on update, so
// the preview's inline width never makes ProseMirror redraw or reread the table.
const figureViews = new WeakMap();
const render = (node) =>
  DOMSerializer.renderSpec(document, node.type.spec.toDOM(node));
class FigureView {
  constructor(node) {
    this.node = node;
    const { dom, contentDOM } = DOMSerializer.renderSpec(
      document,
      node.type.spec.toDOM(node),
    );
    this.dom = dom;
    this.contentDOM = contentDOM;
    figureViews.set(dom, this);
  }
  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    const fresh = render(node);
    for (const { name } of [...this.dom.attributes])
      if (!fresh.dom.hasAttribute(name)) this.dom.removeAttribute(name);
    for (const { name, value } of [...fresh.dom.attributes])
      if (this.dom.getAttribute(name) !== value)
        this.dom.setAttribute(name, value);
    return true;
  }
  ignoreMutation(m) {
    return (
      m.type === "attributes" &&
      m.target === this.dom &&
      m.attributeName === "style"
    );
  }
}
// The border near the pointer: {figure (position), c (column that changes), side (+1: the column
// left of the border, -1: right of it), k (2 for a centred table, which grows on both sides)}.
// Only the editor's own cells (not a protected block's) and tables of at most 100 columns, whose
// widths can all be whole percentages.
function borderAt(view, event) {
  const cell = event.target.closest?.("td, th");
  if (!cell || !view.dom.contains(cell)) return null;
  const pos = view.posAtDOM(cell, 0) - 1;
  if (pos < 0 || view.nodeDOM(pos) !== cell) return null;
  const $cell = view.state.doc.resolve(pos);
  const depth = $cell.depth;
  if (depth < 3 || $cell.node(depth - 2).type !== N.table_figure) return null;
  // The cell's row, table and figure are its three ancestors.
  const table = $cell.node(depth - 1),
    tableStart = $cell.start(depth - 1),
    figurePos = $cell.before(depth - 2);
  const map = TableMap.get(table),
    rect = map.findCell(pos - tableStart),
    width = map.width;
  if (width > 100) return null;
  const box = cell.getBoundingClientRect(),
    x = event.clientX;
  const align = $cell.node(depth - 2).attrs.align;
  let border = null; // the border's column boundary, 1..width (1: after the first column)
  if (Math.abs(x - box.right) <= EDGE) border = rect.right;
  else if (Math.abs(x - box.left) <= EDGE) border = rect.left;
  if (border === null) return null;
  if (align === "right") {
    if (border === width) return null; // the right edge is the anchor
    return { figure: figurePos, c: border, side: -1, k: 1 };
  }
  if (border === 0) return null; // the left edge is the anchor
  return {
    figure: figurePos,
    c: border - 1,
    side: 1,
    k: align === "center" ? 2 : 1,
  };
}

// Column widths in pixels, from the borders that cells show. A border no cell ends on (behind a
// merged cell) is placed by the columns' saved percentages, or evenly when they have none.
function measure(view, figurePos) {
  const figure = view.state.doc.nodeAt(figurePos);
  const table = figure.lastChild,
    tablePos = figurePos + figure.nodeSize - 1 - table.nodeSize;
  const map = TableMap.get(table);
  const edges = Array(map.width + 1).fill(null);
  const dom = view.nodeDOM(tablePos);
  edges[0] = dom.getBoundingClientRect().left;
  for (const at of new Set(map.map)) {
    const r = map.findCell(at);
    const box = view.nodeDOM(tablePos + 1 + at)?.getBoundingClientRect();
    if (box) {
      edges[r.right] ??= box.right;
      edges[r.left] ??= box.left;
    }
  }
  edges[map.width] ??= dom.getBoundingClientRect().right;
  // Between two borders that show, the columns with a saved percentage take it, the others
  // share what is left evenly.
  const saved = table.attrs.cols?.map((c) => Number(c.width) || 0) ?? [];
  const tablePx = edges[map.width] - edges[0];
  for (let i = 1; i < map.width; i++)
    if (edges[i] === null) {
      let j = i;
      while (edges[j] === null) j++;
      const span = Array.from({ length: j - i + 1 }, (_, k) =>
        saved[i - 1 + k] ? (saved[i - 1 + k] / 100) * tablePx : null,
      );
      const gap = edges[j] - edges[i - 1],
        known = span.reduce((a, w) => a + (w ?? 0), 0),
        unknown = span.filter((w) => w === null).length;
      const first = unknown
        ? (span[0] ?? Math.max(0, gap - known) / unknown)
        : (span[0] * gap) / known;
      edges[i] = edges[i - 1] + first;
    }
  return edges.slice(1).map((e, i) => Math.max(1, e - edges[i]));
}
const textWidth = (view) => {
  const css = getComputedStyle(view.dom);
  return (
    view.dom.clientWidth -
    parseFloat(css.paddingLeft) -
    parseFloat(css.paddingRight)
  );
};

// The drag under way: its cancel function, so a second pointer, the window losing focus or the
// editor going away ends it.
let active = null;

function startDrag(view, event, border) {
  const widths = measure(view, border.figure),
    text = textWidth(view),
    x0 = event.clientX,
    pointer = event.pointerId,
    doc = view.state.doc,
    figure = doc.nodeAt(border.figure);
  const figureDOM = view.nodeDOM(border.figure),
    tableDOM = figureDOM.querySelector(":scope > table");
  // A table without widths has no colgroup: one for the preview, removed afterwards.
  let group = tableDOM.querySelector(":scope > colgroup"),
    added = null;
  if (!group) {
    group = added = tableDOM.insertBefore(
      document.createElement("colgroup"),
      tableDOM.firstChild,
    );
    for (const _ of widths) group.append(document.createElement("col"));
  }
  const cols = [...group.children];
  let result = null;
  const preview = (r) => {
    figureDOM.style.width = `${r.width}%`;
    cols.forEach((col, i) => (col.style.width = `${r.cols[i]}%`));
  };
  const was = { cols: cols.map((col) => col.style.width) };
  // The figure's style as its node draws it now (an undo during the drag may have changed it);
  // the cols as they were (a changed table is drawn afresh, without them).
  const restore = () => {
    added?.remove();
    const now = figureViews.get(figureDOM)?.node;
    const style = now ? render(now).dom.getAttribute("style") : null;
    if (style) figureDOM.setAttribute("style", style);
    else figureDOM.removeAttribute("style");
    cols.forEach((col, i) => (col.style.width = was.cols[i]));
  };
  const listeners = [
    ["pointermove", (e) => e.pointerId === pointer && move(e)],
    ["pointerup", (e) => e.pointerId === pointer && end(true)],
    ["pointercancel", (e) => e.pointerId === pointer && end(false)],
    // The window losing focus (a release outside it may never reach the page).
    ["blur", (e) => e.target === window && end(false)],
    [
      "keydown",
      (e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        end(false);
      },
    ],
  ];
  // The document changed under the drag (the figure moved, changed or went): it is cancelled.
  const move = (e) => {
    if (view.state.doc !== doc || !(e.buttons & 1)) return end(false);
    result = resizedColumns(
      widths,
      border.c,
      (e.clientX - x0) * border.side * border.k,
      text,
    );
    if (result.moved) preview(result);
    else restore();
  };
  const end = (commit) => {
    if (active !== end) return;
    active = null;
    for (const [type, f] of listeners) removeEventListener(type, f, true);
    document.documentElement.classList.remove("tx-col-dragging");
    restore();
    if (
      commit &&
      result?.moved &&
      view.state.doc === doc &&
      doc.nodeAt(border.figure) === figure
    )
      own(setColumnWidths(border.figure, result))(
        view.state,
        view.dispatch,
        view,
      );
  };
  active = end;
  for (const [type, f] of listeners) addEventListener(type, f, true);
  document.documentElement.classList.add("tx-col-dragging");
}

export const tableResizing = () =>
  new Plugin({
    view: () => ({ destroy: () => active?.(false) }),
    props: {
      nodeViews: {
        table_figure: (node) => new FigureView(node),
      },
      handleDOMEvents: {
        pointermove(view, event) {
          if (event.buttons || event.pointerType === "touch") return false;
          view.dom.classList.toggle(
            "tx-col-resize",
            view.editable && !!borderAt(view, event),
          );
          return false;
        },
        pointerleave(view) {
          view.dom.classList.remove("tx-col-resize");
          return false;
        },
        // Mouse and pen only: on a touch screen a swipe scrolls, and the Table menu's dialogs
        // set widths.
        pointerdown(view, event) {
          if (
            active ||
            event.button !== 0 ||
            event.pointerType === "touch" ||
            !view.editable
          )
            return false;
          const border = borderAt(view, event);
          if (!border) return false;
          // No compatibility mouse events: ProseMirror starts no text or cell selection.
          event.preventDefault();
          startDrag(view, event, border);
          return true;
        },
      },
    },
  });
