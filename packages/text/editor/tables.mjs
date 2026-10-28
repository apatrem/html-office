// Report tables (T10) on prosemirror-tables: cell selections, rows and columns, merged cells, Tab
// navigation, header and total rows, row headers, column widths and emphasis, density and
// caption. A Text table keeps the subset's shape (FORMAT.md › Table): header rows lead the
// table and hold th cells only, at least one body row follows, no span crosses from the header
// into the body, and the colgroup, when present, has one col per column. Each cell holds one
// paragraph of inline content (the schema), so merged cells join their text with line breaks.
import { Fragment, Slice } from "prosemirror-model";
import { Plugin, TextSelection } from "prosemirror-state";
import { closeHistory } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import {
  tableEditing,
  CellSelection,
  TableMap,
  selectedRect,
  selectionCell,
  isInTable,
  addRow,
  addColumn,
  deleteRow as removeRows,
  deleteColumn as removeColumns,
  splitCell as split,
  goToNextCell,
  nextCell as cellBeside,
  __pastedCells as pastedCells,
  __clipCells as clipCells,
  __insertCells as insertCells,
} from "prosemirror-tables";
import { schema } from "./schema/schema.mjs";
import { usedIds } from "./commands.mjs";
import { freshId, LIMIT } from "./clipboard/table.mjs";

const N = schema.nodes;
export { CellSelection, isInTable, tableEditing };

// The table around the selection: {table, pos (of the table node), figure, figurePos, rect}.
function around(state) {
  if (!isInTable(state)) return null;
  const rect = selectedRect(state);
  const pos = rect.tableStart - 1;
  const $table = state.doc.resolve(pos);
  return {
    table: rect.table,
    pos,
    figure: $table.parent,
    figurePos: $table.before(),
    rect,
  };
}
const headCount = (table) => {
  let n = 0;
  while (n < table.childCount && table.child(n).attrs.head) n++;
  return n;
};
// True when a cell spans across the boundary above row `b`.
function crosses(map, b) {
  if (b <= 0 || b >= map.height) return false;
  for (let c = 0; c < map.width; c++)
    if (map.map[(b - 1) * map.width + c] === map.map[b * map.width + c])
      return true;
  return false;
}
// Runs a prosemirror-tables command into our own transaction, so it can be completed.
function capture(command, state) {
  let out = null;
  command(state, (tr) => (out = tr));
  return out;
}
// The table node at `pos` in tr.doc after a change, with its map.
const tableAt = (tr, pos) => {
  const table = tr.doc.nodeAt(pos);
  return { table, map: TableMap.get(table) };
};
// Sets the colgroup: null when no column has a width or emphasis.
function setCols(tr, pos, cols) {
  const keep = cols?.some((c) => c.width || c.emphasis) ? cols : null;
  tr.setNodeAttribute(pos, "cols", keep);
}

// A table command as an undo step of its own: history is closed before it and, with an empty
// step, after it, so typing just before or after is undone apart; the guard's repairs, appended
// to the command, stay in its step. `view` gives the state after the command.
export const own = (command) => (state, dispatch, view) =>
  command(
    state,
    dispatch &&
      ((tr) => {
        dispatch(closeHistory(tr));
        if (view) view.dispatch(closeHistory(view.state.tr));
      }),
    view,
  );

// ---------- the table shape, kept after every change ----------
// Header rows first and th only; at least one body row; no total in the header; no span from the
// header into the body; one col per column. Runs as an appended transaction, like the subset guard.
function repair(state) {
  const tr = state.tr;
  const tables = [];
  state.doc.descendants((node, pos) => {
    if (node.type === N.table) tables.push({ node, pos });
    return node.type !== N.table && !node.isTextblock;
  });
  for (const { node, pos } of tables.reverse()) {
    let head = headCount(node);
    if (head === node.childCount) head--;
    const map = TableMap.get(node);
    // A header ending inside a span ends above it.
    while (head > 0 && crosses(map, head)) head--;
    let at = pos + 1;
    node.forEach((row, _o, r) => {
      const isHead = r < head;
      if (row.attrs.head !== isHead || (isHead && row.attrs.total))
        tr.setNodeMarkup(at, null, {
          head: isHead,
          total: isHead ? false : row.attrs.total,
        });
      if (isHead)
        row.forEach((cell, offset) => {
          if (cell.type !== N.table_header)
            tr.setNodeMarkup(at + 1 + offset, N.table_header, cell.attrs);
        });
      at += row.nodeSize;
    });
    const cols = node.attrs.cols;
    if (cols && cols.length !== map.width)
      setCols(
        tr,
        pos,
        Array.from(
          { length: map.width },
          (_, i) => cols[i] ?? { width: null, emphasis: false },
        ),
      );
  }
  return tr.docChanged ? tr : null;
}
export const tableGuard = () =>
  new Plugin({
    appendTransaction(transactions, _old, state) {
      return transactions.some((tr) => tr.docChanged) ? repair(state) : null;
    },
  });

// ---------- inserting and deleting ----------
// A new table after the top-level block holding the selection: a header row and two body rows.
export const insertTable =
  (rows = 3, columns = 3) =>
  (state, dispatch) => {
    if (isInTable(state)) return false;
    const { $from, to } = state.selection;
    let at = $from.depth ? $from.after(1) : to;
    if (state.doc.lastChild.type === N.comments)
      at = Math.min(at, state.doc.content.size - state.doc.lastChild.nodeSize);
    if (dispatch) {
      const row = (head) =>
        N.table_row.create(
          { head },
          Array.from({ length: columns }, () =>
            (head ? N.table_header : N.table_cell).create(),
          ),
        );
      const figure = N.table_figure.create(
        { id: freshId("tab", usedIds(state.doc)) },
        N.table.create(
          null,
          Array.from({ length: rows }, (_, r) => row(r === 0)),
        ),
      );
      const tr = state.tr.insert(at, figure);
      // The caret in the first header cell.
      tr.setSelection(TextSelection.create(tr.doc, at + 4));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };

// Rows above or below the selection. A row added inside the header belongs to it.
// Never past the limits of a Text table (1,000 rows, 30 columns: ADR-013 §3).
const rowCommand = (below) => (state, dispatch) => {
  const t = around(state);
  if (!t || t.rect.map.height >= LIMIT.rows) return false;
  if (dispatch) {
    const index = below ? t.rect.bottom : t.rect.top;
    const head =
      index < headCount(t.table) && !(below && index === headCount(t.table));
    const tr = addRow(state.tr, t.rect, index);
    let rowPos = t.pos + 1;
    for (let i = 0; i < index; i++)
      rowPos += tr.doc.nodeAt(t.pos).child(i).nodeSize;
    if (head) tr.setNodeMarkup(rowPos, null, { head: true, total: false });
    dispatch(tr.scrollIntoView());
  }
  return true;
};
export const addRowBefore = rowCommand(false);
export const addRowAfter = rowCommand(true);

// Columns left or right of the selection, with a col (no width) when the table has a colgroup.
const columnCommand = (right) => (state, dispatch) => {
  const t = around(state);
  if (!t || t.rect.map.width >= LIMIT.columns) return false;
  if (dispatch) {
    const index = right ? t.rect.right : t.rect.left;
    const tr = addColumn(state.tr, t.rect, index);
    const cols = t.table.attrs.cols;
    if (cols)
      setCols(tr, t.pos, [
        ...cols.slice(0, index),
        { width: null, emphasis: false },
        ...cols.slice(index),
      ]);
    dispatch(tr.scrollIntoView());
  }
  return true;
};
export const addColumnBefore = columnCommand(false);
export const addColumnAfter = columnCommand(true);

// Never every row or every column: that is Delete table.
export function deleteRows(state, dispatch) {
  const t = around(state);
  if (!t || (t.rect.top === 0 && t.rect.bottom === t.rect.map.height))
    return false;
  if (dispatch) dispatch(capture(removeRows, state).scrollIntoView());
  return true;
}
export function deleteColumns(state, dispatch) {
  const t = around(state);
  if (!t || (t.rect.left === 0 && t.rect.right === t.rect.map.width))
    return false;
  if (dispatch) {
    const tr = capture(removeColumns, state);
    const cols = t.table.attrs.cols;
    if (cols)
      setCols(
        tr,
        t.pos,
        cols.filter((_, i) => i < t.rect.left || i >= t.rect.right),
      );
    dispatch(tr.scrollIntoView());
  }
  return true;
}
// The whole figure, caption included.
export function deleteTable(state, dispatch) {
  const t = around(state);
  if (!t) return false;
  if (dispatch) {
    const tr = state.tr.delete(t.figurePos, t.figurePos + t.figure.nodeSize);
    // A document never ends up empty (the schema needs a block).
    if (!tr.doc.childCount || tr.doc.firstChild.type === N.comments)
      tr.insert(0, N.paragraph.create());
    dispatch(tr.scrollIntoView());
  }
  return true;
}

// ---------- merged cells ----------
// The selected rectangle as one cell: the top-left cell takes the span and the other cells' text,
// one line each. Unavailable across the header's boundary or around a span that leaves the
// selection.
export function mergeCells(state, dispatch) {
  const sel = state.selection;
  if (
    !(sel instanceof CellSelection) ||
    sel.$anchorCell.pos === sel.$headCell.pos
  )
    return false;
  const { rect, table } = around(state);
  const { map, tableStart } = rect;
  const head = headCount(table);
  if (rect.top < head && rect.bottom > head) return false;
  for (let r = rect.top; r < rect.bottom; r++)
    for (let c = rect.left; c < rect.right; c++) {
      const cell = map.findCell(map.map[r * map.width + c]);
      if (
        cell.left < rect.left ||
        cell.right > rect.right ||
        cell.top < rect.top ||
        cell.bottom > rect.bottom
      )
        return false;
    }
  if (dispatch) {
    const seen = new Set(),
      cells = [];
    for (let r = rect.top; r < rect.bottom; r++)
      for (let c = rect.left; c < rect.right; c++) {
        const at = map.map[r * map.width + c];
        if (seen.has(at)) continue;
        seen.add(at);
        cells.push({ at, node: table.nodeAt(at) });
      }
    const [first, ...rest] = cells;
    let content = first.node.content;
    for (const { node } of rest)
      if (node.content.size)
        content = content.size
          ? content
              .append(Fragment.from(N.hard_break.create()))
              .append(node.content)
          : node.content;
    const tr = state.tr;
    for (const { at, node } of rest.reverse())
      tr.delete(tableStart + at, tableStart + at + node.nodeSize);
    tr.setNodeMarkup(tableStart + first.at, null, {
      ...first.node.attrs,
      colspan: rect.right - rect.left,
      rowspan: rect.bottom - rect.top,
    });
    const start = tableStart + first.at + 1;
    tr.replaceWith(start, start + first.node.content.size, content);
    tr.setSelection(new CellSelection(tr.doc.resolve(tableStart + first.at)));
    dispatch(tr);
  }
  return true;
}
// A merged cell back into single cells; the text stays in the first.
export const splitCell = (state, dispatch) => split(state, dispatch);

// ---------- Tab ----------
// Tab moves to the next cell, adding a row after the last one (none at the row limit);
// Shift-Tab to the previous cell.
export const nextCell = (state, dispatch) => {
  if (!isInTable(state)) return false;
  if (goToNextCell(1)(state, dispatch)) return true;
  const t = around(state);
  if (dispatch && t.rect.map.height < LIMIT.rows) {
    const tr = addRow(state.tr, t.rect, t.rect.map.height);
    const { map } = tableAt(tr, t.pos);
    const first = t.pos + 1 + map.map[(map.height - 1) * map.width];
    tr.setSelection(TextSelection.create(tr.doc, first + 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
};
export const previousCell = (state, dispatch) =>
  isInTable(state) && (goToNextCell(-1)(state, dispatch), true);

// Shift+arrow at the edge of a cell's text selects cells (prosemirror-tables looks for a paragraph
// inside the cell; a Text cell is itself the textblock). In a cell selection the library goes on.
const shiftArrow = (axis, dir) => (state, dispatch, view) => {
  const { selection } = state;
  if (!view || !(selection instanceof TextSelection)) return false;
  const { $head } = selection;
  if (!$head.parent.type.spec.tableRole?.endsWith("cell")) return false;
  const side =
    axis === "horiz" ? (dir > 0 ? "right" : "left") : dir > 0 ? "down" : "up";
  if (!view.endOfTextblock(side)) return false;
  const $cell = state.doc.resolve($head.before());
  const $next = cellBeside($cell, axis, dir);
  if (!$next) return false;
  if (dispatch)
    dispatch(state.tr.setSelection(new CellSelection($cell, $next)));
  return true;
};
// Before tableEditing() in the plugins.
export const cellKeys = () =>
  keymap({
    "Shift-ArrowLeft": shiftArrow("horiz", -1),
    "Shift-ArrowRight": shiftArrow("horiz", 1),
    "Shift-ArrowUp": shiftArrow("vert", -1),
    "Shift-ArrowDown": shiftArrow("vert", 1),
  });

// ---------- paste ----------
// A table pasted at the caret fills cells from its cell, adding rows and columns as needed; on a
// cell selection it is cut or repeated to fill it (prosemirror-tables).
export const pasteTable = (table) => (state, dispatch) => {
  if (!isInTable(state)) return false;
  let cells = pastedCells(new Slice(Fragment.from(table), 0, 0));
  if (!cells) return false;
  const sel = state.selection;
  let start, rect;
  if (sel instanceof CellSelection) {
    start = sel.$anchorCell.start(-1);
    rect = TableMap.get(sel.$anchorCell.node(-1)).rectBetween(
      sel.$anchorCell.pos - start,
      sel.$headCell.pos - start,
    );
    cells = clipCells(cells, rect.right - rect.left, rect.bottom - rect.top);
  } else {
    const $cell = selectionCell(state);
    start = $cell.start(-1);
    rect = TableMap.get($cell.node(-1)).findCell($cell.pos - start);
  }
  if (dispatch) {
    let tr = null,
      out = null;
    const proxy = {
      doc: state.doc,
      get tr() {
        return (tr = state.tr);
      },
    };
    try {
      insertCells(proxy, (done) => (out = done), start, rect, cells);
    } catch (error) {
      // prosemirror-tables 1.8.1 selects the pasted cells by positionAt, which is no cell when a
      // span from above covers the last slot (a pasted vertical merge): the cells are in place,
      // the selection is set here from the map.
      if (!/^No cell with offset/.test(error?.message) || !tr?.docChanged)
        throw error;
      const map = TableMap.get(tr.doc.nodeAt(start - 1)),
        bottom = rect.top + cells.height,
        right = rect.left + cells.width;
      tr.setSelection(
        new CellSelection(
          tr.doc.resolve(start + map.map[rect.top * map.width + rect.left]),
          tr.doc.resolve(start + map.map[(bottom - 1) * map.width + right - 1]),
        ),
      );
      out = tr;
    }
    dispatch(out.scrollIntoView());
  }
  return true;
};
// Inline content pasted on a cell selection replaces each selected cell's content; the cells keep
// their kind, spans and alignment.
export const fillCells = (content) => (state, dispatch) => {
  const sel = state.selection;
  if (!(sel instanceof CellSelection)) return false;
  if (dispatch) {
    const tr = state.tr;
    sel.forEachCell((cell, pos) =>
      tr.replaceWith(
        tr.mapping.map(pos + 1),
        tr.mapping.map(pos + 1 + cell.content.size),
        content,
      ),
    );
    dispatch(tr);
  }
  return true;
};

// ---------- header rows, total rows, row headers ----------
// Rows where the selection is: header rows when they are not, body rows when they all are. A
// header runs from the first row; it never takes the last row or splits a span.
export function toggleHeaderRows(state, dispatch) {
  const t = around(state);
  if (!t) return false;
  const head = headCount(t.table),
    { top, bottom, map } = t.rect;
  const isHead = bottom <= head;
  const next = isHead ? top : bottom;
  if (next >= map.height || crosses(map, next)) return false;
  if (dispatch) {
    const tr = state.tr;
    let at = t.pos + 1;
    t.table.forEach((row, _o, r) => {
      const h = r < next;
      if (row.attrs.head !== h) {
        tr.setNodeMarkup(at, null, { head: h, total: false });
        row.forEach((cell, offset) =>
          tr.setNodeMarkup(
            at + 1 + offset,
            h ? N.table_header : N.table_cell,
            cell.attrs,
          ),
        );
      }
      at += row.nodeSize;
    });
    dispatch(tr);
  }
  return true;
}
export const headerRowsAt = (state) => {
  const t = around(state);
  return !!t && t.rect.bottom <= headCount(t.table);
};
// Total rows: the selected body rows become total rows, or stop being ones.
export function toggleTotalRows(state, dispatch) {
  const t = around(state);
  if (!t || t.rect.top < headCount(t.table)) return false;
  if (dispatch) {
    const on = !totalAt(state);
    const tr = state.tr;
    let at = t.pos + 1;
    t.table.forEach((row, _o, r) => {
      if (r >= t.rect.top && r < t.rect.bottom && row.attrs.total !== on)
        tr.setNodeMarkup(at, null, { ...row.attrs, total: on });
      at += row.nodeSize;
    });
    dispatch(tr);
  }
  return true;
}
export const totalAt = (state) => {
  const t = around(state);
  if (!t) return false;
  for (let r = t.rect.top; r < t.rect.bottom; r++)
    if (!t.table.child(r).attrs.total) return false;
  return true;
};
// The selected body cells as row headers (th), or back to data cells.
function bodyCells(state) {
  const t = around(state);
  if (!t) return [];
  const head = headCount(t.table),
    { map, top, bottom, left, right, tableStart } = t.rect,
    seen = new Set(),
    out = [];
  // A cell selection holds the cells that start in its rectangle, not a span from outside it.
  if (state.selection instanceof CellSelection) {
    state.selection.forEachCell((node, pos) => {
      if (map.findCell(pos - tableStart).top >= head) out.push({ pos, node });
    });
    return out;
  }
  for (let r = Math.max(top, head); r < bottom; r++)
    for (let c = left; c < right; c++) {
      const at = map.map[r * map.width + c];
      if (seen.has(at)) continue;
      seen.add(at);
      out.push({ pos: t.rect.tableStart + at, node: t.table.nodeAt(at) });
    }
  return out;
}
export const rowHeadersAt = (state) => {
  const cells = bodyCells(state);
  return !!cells.length && cells.every((c) => c.node.type === N.table_header);
};
export function toggleRowHeaders(state, dispatch) {
  const cells = bodyCells(state);
  if (!cells.length) return false;
  if (dispatch) {
    const type = rowHeadersAt(state) ? N.table_cell : N.table_header;
    const tr = state.tr;
    for (const { pos, node } of cells) tr.setNodeMarkup(pos, type, node.attrs);
    dispatch(tr);
  }
  return true;
}

// ---------- columns: widths and emphasis; density ----------
const colsOf = (table, width) =>
  table.attrs.cols?.map((c) => ({ ...c })) ??
  Array.from({ length: width }, () => ({ width: null, emphasis: false }));
// The selected columns' width, a whole percentage of the table (1–100), or null for automatic.
export const setColumnWidth = (percent) => (state, dispatch) => {
  const t = around(state);
  if (!t) return false;
  if (
    percent !== null &&
    !(Number.isInteger(percent) && percent >= 1 && percent <= 100)
  )
    return false;
  if (dispatch) {
    const cols = colsOf(t.table, t.rect.map.width);
    for (let c = t.rect.left; c < t.rect.right; c++)
      cols[c].width = percent === null ? null : String(percent);
    const tr = state.tr;
    setCols(tr, t.pos, cols);
    dispatch(tr);
  }
  return true;
};
export const columnWidthAt = (state) => {
  const t = around(state);
  const w = t?.table.attrs.cols?.[t.rect.left]?.width;
  return w ? Number(w) : null;
};
// Every column the same width, adding up to 100% (at most 100 columns: widths are whole percents).
export function distributeColumns(state, dispatch) {
  const t = around(state);
  if (!t || t.rect.map.width > 100) return false;
  if (dispatch) {
    const n = t.rect.map.width,
      cols = colsOf(t.table, n);
    cols.forEach(
      (c, i) => (c.width = String(Math.floor(100 / n) + (i < 100 % n ? 1 : 0))),
    );
    const tr = state.tr;
    setCols(tr, t.pos, cols);
    dispatch(tr);
  }
  return true;
}
export const emphasisAt = (state) => {
  const t = around(state);
  if (!t?.table.attrs.cols) return false;
  for (let c = t.rect.left; c < t.rect.right; c++)
    if (!t.table.attrs.cols[c]?.emphasis) return false;
  return true;
};
export function toggleEmphasis(state, dispatch) {
  const t = around(state);
  if (!t) return false;
  if (dispatch) {
    const on = !emphasisAt(state),
      cols = colsOf(t.table, t.rect.map.width);
    for (let c = t.rect.left; c < t.rect.right; c++) cols[c].emphasis = on;
    const tr = state.tr;
    setCols(tr, t.pos, cols);
    dispatch(tr);
  }
  return true;
}
export const compactAt = (state) => !!around(state)?.table.attrs.compact;
export function toggleCompact(state, dispatch) {
  const t = around(state);
  if (!t) return false;
  if (dispatch)
    dispatch(
      state.tr.setNodeAttribute(t.pos, "compact", !t.table.attrs.compact),
    );
  return true;
}

// ---------- caption ----------
export const captionAt = (state) =>
  around(state)?.figure.firstChild.type === N.caption;
// Adds an empty caption above the table and puts the caret in it, or removes the caption.
export function toggleCaption(state, dispatch) {
  const t = around(state);
  if (!t) return false;
  if (dispatch) {
    const tr = state.tr;
    if (captionAt(state)) {
      const caption = t.figure.firstChild;
      tr.delete(t.figurePos + 1, t.figurePos + 1 + caption.nodeSize);
      tr.setSelection(TextSelection.near(tr.doc.resolve(t.figurePos + 1)));
    } else {
      tr.insert(t.figurePos + 1, N.caption.create());
      tr.setSelection(TextSelection.create(tr.doc, t.figurePos + 2));
    }
    dispatch(tr.scrollIntoView());
  }
  return true;
}
