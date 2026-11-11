// Tables with merged cells (ADR-013 decision 3): the grid of a table.t and the row and column
// operations of the editor. Cells keep their nodes (and so their text) when rows and columns
// move around them; only colspan and rowspan change.

// slots[r][c] is the anchor { cell, r, c, rs, cs } covering that grid position. A rowspan past the
// last row of its row group (thead, tbody, tfoot), or rowspan="0", stops there, as browsers draw it.
export function tableGrid(table) {
  const rows = [...table.rows], slots = rows.map(() => []), anchors = [], end = [];
  for (let r = rows.length - 1; r >= 0; r--) end[r] = rows[r + 1]?.parentNode === rows[r].parentNode ? end[r + 1] : r + 1;
  rows.forEach((tr, r) => {
    let c = 0;
    for (const cell of tr.cells) {
      while (slots[r][c]) c++;
      const rs = cell.rowSpan > 0 ? Math.min(cell.rowSpan, end[r] - r) : end[r] - r;
      const a = { cell, r, c, rs, cs: Math.max(1, cell.colSpan) };
      anchors.push(a);
      for (let i = r; i < r + rs; i++) for (let j = c; j < c + a.cs; j++) slots[i][j] = a;
      c += a.cs;
    }
  });
  return { rows, slots, anchors, width: Math.max(0, ...slots.map(s => s.length)) };
}
export const merged = a => a.rs > 1 || a.cs > 1;

// Writes the anchors back: each row gets its anchors in column order. Missing positions (a ragged
// table) are filled with empty cells like their row, so every operation leaves a rectangular grid.
function rebuild(g, blank) {
  const height = g.rows.length, width = Math.max(1, ...g.anchors.map(a => a.c + a.cs));
  const taken = g.rows.map(() => new Array(width).fill(false));
  for (const a of g.anchors) for (let i = a.r; i < a.r + a.rs; i++) for (let j = a.c; j < a.c + a.cs; j++) taken[i][j] = true;
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++)
    if (!taken[r][c]) g.anchors.push({ cell: blank(r, c), r, c, rs: 1, cs: 1 });
  g.rows.forEach((tr, r) => tr.replaceChildren(...g.anchors.filter(a => a.r === r).sort((a, b) => a.c - b.c).map(a => {
    for (const [name, n] of [['rowspan', a.rs], ['colspan', a.cs]])
      if (n > 1) a.cell.setAttribute(name, n); else a.cell.removeAttribute(name);
    return a.cell;
  })));
}
// An empty cell shaped like `model` (same tag and classes), with a caret placeholder.
function emptyLike(model) {
  const c = model ? model.cloneNode(false) : document.createElement('td');
  c.removeAttribute('rowspan');
  c.removeAttribute('colspan');
  c.appendChild(document.createElement('br'));
  return c;
}
const rowLike = (g, r) => g.anchors.filter(a => a.r <= r && r < a.r + a.rs).sort((a, b) => a.c - b.c)[0]?.cell;

// The operations act at grid row / column `at`. Insertions return the new anchors, in grid order.
// Inserted before grid row `at`, shaped like `modelRow`: spans crossing that boundary grow, every
// other column gets an empty cell.
export function insertRow(table, at, modelRow) {
  const g = tableGrid(table), model = g.slots[modelRow.rowIndex] || [];
  const crossing = g.anchors.filter(a => a.r < at && a.r + a.rs > at);
  const tr = modelRow.cloneNode(false);
  tr.classList.remove('tot');
  if (!tr.getAttribute('class')) tr.removeAttribute('class');
  const fresh = [];
  for (let c = 0; c < g.width; c++)
    if (!crossing.some(a => a.c <= c && c < a.c + a.cs)) fresh.push({ cell: emptyLike(model[c]?.cell), r: at, c, rs: 1, cs: 1 });
  for (const a of g.anchors) if (a.r >= at) a.r++;
  for (const a of crossing) a.rs++;
  if (at < g.rows.length) g.rows[at].before(tr); else g.rows[g.rows.length - 1].after(tr);
  g.rows.splice(at, 0, tr);
  g.anchors.push(...fresh);
  rebuild(g, r => emptyLike(rowLike(g, r)));
  return fresh;
}
export function deleteRow(table, at) {
  const g = tableGrid(table);
  g.anchors = g.anchors.filter(a => !(a.r === at && a.rs === 1));
  for (const a of g.anchors) {
    if (a.r <= at && at < a.r + a.rs) a.rs--; // a merged cell starting here moves down with the rest of it
    else if (a.r > at) a.r--;
  }
  g.rows[at].remove();
  g.rows.splice(at, 1);
  rebuild(g, r => emptyLike(rowLike(g, r)));
}
// ---------- column widths (FORMAT.md › Tables) ----------
// A colgroup with one col per grid column, each with an optional data-width (a whole percentage of
// the table), present only while a column has a width.
const group = table => table.querySelector(':scope > colgroup');
export const columnWidths = table => {
  const n = tableGrid(table).width, cols = group(table)?.children;
  return Array.from({ length: n }, (_, i) => (cols?.[i]?.dataset.width ? Number(cols[i].dataset.width) : null));
};
// widths: one whole percentage or null per column.
export function setColumnWidths(table, widths) {
  group(table)?.remove();
  if (widths.some(w => w)) {
    const g = document.createElement('colgroup');
    for (const w of widths) {
      const col = g.appendChild(document.createElement('col'));
      if (w) col.dataset.width = String(w);
    }
    table.prepend(g);
  }
  relayout(table);
}
// WebKit keeps the column layout of a table in a grid slide when its colgroup changes: a passing
// change of table-layout makes it lay the table out again, without touching focus or selection.
function relayout(table) {
  const had = table.hasAttribute('style');
  table.style.tableLayout = 'fixed';
  void table.offsetWidth;
  table.style.removeProperty('table-layout');
  if (!had && !table.getAttribute('style')) table.removeAttribute('style');
}
// Whole percentages adding up to 100, each at least 1, from positive shares (largest remainders).
export function wholePercents(shares) {
  const total = shares.reduce((a, b) => a + b, 0), exact = shares.map(x => (x / total) * 100);
  const out = exact.map(x => Math.max(1, Math.floor(x)));
  const order = exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  for (let i = 0; left > 0; i = (i + 1) % out.length, left--) out[order[i][1]]++;
  for (; left < 0; left++) out[out.indexOf(Math.max(...out))]--;
  return out;
}
// Every column the same width, adding up to 100%.
export const evenWidths = n => Array.from({ length: n }, (_, i) => Math.floor(100 / n) + (i < 100 % n ? 1 : 0));
// After a column is inserted (width null) or deleted at grid column `at`.
function shiftWidths(table, at, insert) {
  if (!group(table)) return;
  const w = [...group(table).children].map(col => (col.dataset.width ? Number(col.dataset.width) : null));
  if (insert) w.splice(at, 0, null); else w.splice(at, 1);
  setColumnWidths(table, w);
}

// Inserted before grid column `at`; new cells take the look of the cell on their left.
export function insertColumn(table, at) {
  const g = tableGrid(table);
  const crossing = g.anchors.filter(a => a.c < at && a.c + a.cs > at);
  const fresh = [];
  g.rows.forEach((tr, r) => {
    if (crossing.some(a => a.r <= r && r < a.r + a.rs)) return;
    fresh.push({ cell: emptyLike((g.slots[r][at - 1] || g.slots[r][at])?.cell), r, c: at, rs: 1, cs: 1 });
  });
  for (const a of g.anchors) if (a.c >= at) a.c++;
  for (const a of crossing) a.cs++;
  g.anchors.push(...fresh);
  rebuild(g, r => emptyLike(rowLike(g, r)));
  shiftWidths(table, at, true);
  return fresh;
}
export function deleteColumn(table, at) {
  const g = tableGrid(table);
  g.anchors = g.anchors.filter(a => !(a.c === at && a.cs === 1));
  for (const a of g.anchors) {
    if (a.c <= at && at < a.c + a.cs) a.cs--;
    else if (a.c > at) a.c--;
  }
  rebuild(g, r => emptyLike(rowLike(g, r)));
  shiftWidths(table, at, false);
}
// Unmerges `cells` (every merged cell when omitted): each covered position gets an empty cell.
export function unmerge(table, cells) {
  const g = tableGrid(table);
  const list = g.anchors.filter(a => merged(a) && (!cells || cells.includes(a.cell)));
  for (const a of list) {
    for (let i = a.r; i < a.r + a.rs; i++) for (let j = a.c; j < a.c + a.cs; j++)
      if (i !== a.r || j !== a.c) g.anchors.push({ cell: emptyLike(a.cell), r: i, c: j, rs: 1, cs: 1 });
    a.rs = a.cs = 1;
  }
  rebuild(g, r => emptyLike(rowLike(g, r)));
  return list.length;
}
