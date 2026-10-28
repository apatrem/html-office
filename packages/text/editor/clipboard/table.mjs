// Text tables and the portable table of ADR-013 §3, both ways (T07). A pasted table, from another
// html-office product, Excel, Sheets, Word, Docs or a web page, arrives as a validated portable
// table and becomes a new figure.table; a copied Text table leaves as one.
import {
  ClipboardError,
  validateTable,
} from "../../../shared/clipboard/index.mjs";
import { schema } from "../schema/schema.mjs";

const N = schema.nodes,
  M = schema.marks;

// The largest table pasted into a document (ADR-013 §3); larger pastes are refused whole.
export const LIMIT = { rows: 1000, columns: 30 };

// A fresh figure ID: tab-1, tab-2… not in `used` (which gains it).
export function freshId(prefix, used) {
  let n = 1;
  while (used.has(`${prefix}-${n}`)) n++;
  used.add(`${prefix}-${n}`);
  return `${prefix}-${n}`;
}

const ALIGN = { left: "ta-l", center: "ta-c", right: "ta-r" };
// Data cell styles as Text marks (ADR-013 §3): alert, title and output are bold, note italic.
const STYLE_BOLD = ["alert", "title", "output"];

// Inline nodes of a cell: runs (or the whole text) with bold, italic and links; a line break in
// the text is a <br>.
function cellContent(slot) {
  const runs = slot.runs ?? [
    {
      text: slot.text,
      bold: slot.bold ?? (STYLE_BOLD.includes(slot.cellStyle) || undefined),
      italic: slot.italic ?? (slot.cellStyle === "note" || undefined),
      link: slot.link,
    },
  ];
  const out = [];
  for (const run of runs) {
    let marks = [];
    if (run.link) marks = M.link.create({ href: run.link.url }).addToSet(marks);
    if (run.bold) marks = M.strong.create().addToSet(marks);
    if (run.italic) marks = M.em.create().addToSet(marks);
    run.text
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .forEach((line, i) => {
        if (i) out.push(N.hard_break.create(null, null, marks));
        const clean = line.replace(/[\t\f\v]/g, " ");
        if (clean) out.push(schema.text(clean, marks));
      });
  }
  return out;
}
// Header cells and total rows are bold in the theme: a bold covering the whole cell adds nothing
// there and is left out.
function unbold(nodes) {
  const text = nodes.filter((n) => n.isText && n.text.trim());
  if (!text.length || !text.every((n) => M.strong.isInSet(n.marks)))
    return nodes;
  return nodes.map((n) => n.mark(M.strong.removeFromSet(n.marks)));
}

// A validated portable table as a Text table node. Header rows form the thead (th only); a span
// that would cross from the header into the body stops at the header's last row. A table whose
// rows are all header rows keeps its last row in the body. extras: {cols, compact, totals}
// from Text's own markup (column widths and emphasis, density, total rows), and content(r, c),
// a cell's inline nodes when the source has richer text than the portable runs.
export function tableNode(model, extras = {}) {
  const rows = model.rows,
    width = rows[0].length;
  if (rows.length > LIMIT.rows || width > LIMIT.columns)
    throw new ClipboardError(
      `a Text table holds at most ${LIMIT.rows.toLocaleString("en-US")} rows and ${LIMIT.columns} columns`,
    );
  const head = Math.min(model.headerRows ?? 0, rows.length - 1),
    totals = new Set([...(model.totalRows ?? []), ...(extras.totals ?? [])]);
  // Slots a clipped header span no longer covers become empty cells.
  const freed = rows.map(() => []);
  const built = rows.map((row, r) => {
    const isHead = r < head,
      total = !isHead && totals.has(r),
      cells = [];
    row.forEach((slot, c) => {
      if (slot?.covered && !freed[r][c]) return;
      const th = isHead || !!slot?.header;
      const type = th ? N.table_header : N.table_cell;
      if (!slot || slot.covered) {
        cells.push(type.create());
        return;
      }
      let rowspan = slot.rowspan ?? 1;
      if (isHead && r + rowspan > head) {
        for (let i = head; i < r + rowspan; i++)
          for (let j = c; j < c + (slot.colspan ?? 1); j++) freed[i][j] = true;
        rowspan = head - r;
      }
      const align = slot.align ?? model.columns?.[c]?.align;
      cells.push(
        type.create(
          {
            colspan: slot.colspan ?? 1,
            rowspan,
            align:
              align === "left" && !slot.align ? null : (ALIGN[align] ?? null),
          },
          (th || total ? unbold : (n) => n)(
            extras.content?.(r, c) ?? cellContent(slot),
          ),
        ),
      );
    });
    return N.table_row.create({ head: isHead, total }, cells);
  });
  const widths = model.columns?.map((c) =>
    c.width >= 0.5 ? String(Math.min(100, Math.round(c.width))) : null,
  );
  const cols =
    extras.cols ??
    (widths?.some(Boolean)
      ? widths.map((width) => ({ width, emphasis: false }))
      : null);
  return N.table.create({ compact: !!extras.compact, cols }, built);
}

// A new figure.table around a portable table, with an optional caption node.
export const tableFigure = (model, used, caption = null, extras) =>
  N.table_figure.create({ id: freshId("tab", used) }, [
    ...(caption ? [caption] : []),
    tableNode(model, extras),
  ]);

// Runs of a cell's inline content: bold, italic and links travel (ADR-013 §3); other marks are
// Text's own. A cross-reference gives its label; a footnote stays in the document.
function runsOf(cell) {
  const runs = [];
  cell.forEach((node) => {
    const text = node.isText
      ? node.text
      : node.type === N.hard_break
        ? "\n"
        : node.type === N.xref
          ? node.attrs.label
          : "";
    if (!text) return;
    const link = node.marks.find((m) => m.type === M.link);
    const run = {
      text,
      ...(M.strong.isInSet(node.marks) ? { bold: true } : {}),
      ...(M.em.isInSet(node.marks) ? { italic: true } : {}),
      ...(link ? { link: { url: link.attrs.href } } : {}),
    };
    const last = runs.at(-1);
    const key = (r) => `${!!r.bold}|${!!r.italic}|${r.link?.url ?? ""}`;
    if (last && key(last) === key(run)) last.text += text;
    else runs.push(run);
  });
  return runs;
}

// The anchor cells of a table node on its grid: [{cell, pos, r, c}] (pos: the cell's position
// in the document, table at `tablePos`), with the grid's size.
export function tableGrid(table, tablePos = -1) {
  const grid = [],
    anchors = [];
  let at = tablePos + 1;
  table.forEach((row, _o, r) => {
    grid[r] ??= [];
    let c = 0,
      pos = at + 1;
    row.forEach((cell) => {
      while (grid[r][c]) c++;
      for (let i = 0; i < cell.attrs.rowspan; i++)
        for (let j = 0; j < cell.attrs.colspan; j++)
          (grid[r + i] ??= [])[c + j] = true;
      anchors.push({ cell, pos, r, c });
      c += cell.attrs.colspan;
      pos += cell.nodeSize;
    });
    at += row.nodeSize;
  });
  const width = Math.max(0, ...grid.map((row) => row.length));
  return { anchors, rows: table.childCount, width };
}

// A Text table node as a validated portable table: the rectangle of `height` rows from `top` and
// `width` columns from `left` (all by default).
export function portableTable(
  table,
  { top: r0 = 0, height, left = 0, width } = {},
) {
  const grid = tableGrid(table);
  height ??= grid.rows - r0;
  width ??= grid.width - left;
  const slots = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => null),
  );
  const head = [];
  table.forEach((row, _o, r) => head.push(row.attrs.head));
  for (const { cell, r, c } of grid.anchors) {
    const { colspan, rowspan, align } = cell.attrs;
    // Only spans inside the copied rectangle (a CellSelection always covers whole spans).
    const top = r - r0,
      lft = c - left;
    if (top < 0 || lft < 0 || top >= height || lft >= width) continue;
    const across = Math.min(colspan, width - lft),
      down = Math.min(rowspan, height - top);
    for (let i = 0; i < down; i++)
      for (let j = 0; j < across; j++)
        slots[top + i][lft + j] = { covered: true };
    const runs = runsOf(cell.content),
      text = runs.map((run) => run.text).join(""),
      th = cell.type === N.table_header,
      key = { "ta-l": "left", "ta-c": "center", "ta-r": "right" }[align];
    slots[top][lft] =
      text || th || key || across > 1 || down > 1
        ? {
            text,
            ...(runs.length > 1
              ? { runs }
              : (({ text: _t, ...look }) => look)(runs[0] ?? {})),
            ...(th ? { header: true } : {}),
            ...(across > 1 ? { colspan: across } : {}),
            ...(down > 1 ? { rowspan: down } : {}),
            ...(key ? { align: key } : {}),
          }
        : null;
  }
  const model = { rows: slots };
  let headerRows = 0;
  while (headerRows < height && head[r0 + headerRows]) headerRows++;
  if (headerRows) model.headerRows = headerRows;
  const totals = [];
  table.forEach((row, _o, r) => {
    if (row.attrs.total && r >= r0 && r < r0 + height) totals.push(r - r0);
  });
  if (totals.length) model.totalRows = totals;
  const cols = table.attrs.cols?.slice(left, left + width);
  if (cols?.some((c) => c.width))
    model.columns = cols.map((c) => (c.width ? { width: +c.width } : {}));
  return validateTable(model);
}
