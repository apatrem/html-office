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
class FigureView {
  constructor(node) {
    this.node = node;
    const { dom, contentDOM } = DOMSerializer.renderSpec(
      document,
      node.type.spec.toDOM(node),
    );
    this.dom = dom;
    this.contentDOM = contentDOM;
  }
  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    const fresh = DOMSerializer.renderSpec(
      document,
      node.type.spec.toDOM(node),
    );
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
function borderAt(view, event) {
  const cell = event.target.closest?.("td, th");
  if (!cell || !view.dom.contains(cell)) return null;
  const pos = view.posAtDOM(cell, 0) - 1;
  const $cell = view.state.doc.resolve(pos);
  if ($cell.nodeAfter?.type.spec.tableRole?.includes("cell") !== true)
    return null;
  // The cell's row, table and figure are its three ancestors.
  const depth = $cell.depth,
    table = $cell.node(depth - 1),
    tableStart = $cell.start(depth - 1),
    figurePos = $cell.before(depth - 2);
  if ($cell.node(depth - 2).type !== N.table_figure) return null;
  const map = TableMap.get(table),
    rect = map.findCell(pos - tableStart),
    width = map.width;
  const box = cell.getBoundingClientRect(),
    x = event.clientX;
  const align = $cell.node(depth - 2).attrs.align;
  const nearRight = Math.abs(x - box.right) <= EDGE,
    nearLeft = Math.abs(x - box.left) <= EDGE;
  let border = null; // the border's column boundary, 1..width (1: after the first column)
  if (nearRight) border = rect.right;
  else if (nearLeft) border = rect.left;
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

// Column widths in pixels, from the borders that cells show (a border no cell ends on is
// placed evenly between its neighbours).
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
  for (let i = 1; i < map.width; i++)
    if (edges[i] === null) {
      let j = i;
      while (edges[j] === null) j++;
      edges[i] = edges[i - 1] + (edges[j] - edges[i - 1]) / (j - i + 1);
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

function startDrag(view, event, border) {
  const widths = measure(view, border.figure),
    text = textWidth(view),
    x0 = event.clientX;
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
  const restore = () => {
    added?.remove();
    const figure = view.state.doc.nodeAt(border.figure);
    figureDOM.style.width = figure.attrs.width ? `${figure.attrs.width}%` : "";
    const model = figure.lastChild.attrs.cols;
    cols.forEach(
      (col, i) =>
        (col.style.width = model?.[i]?.width ? `${model[i].width}%` : ""),
    );
  };
  const move = (e) => {
    result = resizedColumns(
      widths,
      border.c,
      (e.clientX - x0) * border.side * border.k,
      text,
    );
    preview(result);
  };
  const end = (e, commit) => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
    removeEventListener("pointercancel", cancel);
    removeEventListener("keydown", key, true);
    document.documentElement.classList.remove("tx-col-dragging");
    restore();
    if (commit && result)
      own(setColumnWidths(border.figure, result))(
        view.state,
        view.dispatch,
        view,
      );
  };
  const up = (e) => end(e, true);
  const cancel = (e) => end(e, false);
  const key = (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    end(e, false);
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
  addEventListener("pointercancel", cancel);
  addEventListener("keydown", key, true);
  document.documentElement.classList.add("tx-col-dragging");
}

export const tableResizing = () =>
  new Plugin({
    props: {
      nodeViews: {
        table_figure: (node) => new FigureView(node),
      },
      handleDOMEvents: {
        pointermove(view, event) {
          if (event.buttons) return false;
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
        pointerdown(view, event) {
          if (event.button !== 0 || !view.editable) return false;
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
