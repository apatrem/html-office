// Spilled array results (F-01). IronCalc spills a formula that returns an
// array (=SEQUENCE(3), =FILTER(…), =C2:C6*2) into the cells right of and
// below it. The anchor formula cell saves the whole rectangle as a calculated
// result, `spill: {ref, results}`; the covered cells keep no record of their
// own (or only formatting). Readers ask cellAt for a covered cell, which
// returns its value as a read-only view, never a canonical record.
import { address, parseAddress, parseRange } from "./workbook.mjs";

// A cell with its own input or formula; it blocks a spill.
export const occupied = (cell) =>
  !!(cell?.formula || (cell?.input && cell.input.type !== "blank"));

const indexes = new WeakMap();
function build(cells) {
  const anchors = [],
    covered = new Map();
  let rows = 0,
    columns = 0;
  for (const [ref, cell] of Object.entries(cells)) {
    if (!cell.spill) continue;
    anchors.push([ref, cell, cell.spill]);
    const r = parseRange(cell.spill.ref);
    rows = Math.max(rows, r.bottom);
    columns = Math.max(columns, r.right);
    for (let row = r.top; row <= r.bottom; row++)
      for (let col = r.left; col <= r.right; col++)
        if (row !== r.top || col !== r.left)
          covered.set(address(row, col), {
            anchor: ref,
            value: cell.spill.results[row - r.top][col - r.left],
          });
  }
  return { anchors, covered, bounds: { rows, columns } };
}
// Derived per cells object. An anchor replaced or removed is detected here;
// results applied in place call forgetSpills.
function index(cells) {
  const cached = indexes.get(cells);
  if (
    cached &&
    cached.anchors.every(
      ([ref, cell, spill]) => cells[ref] === cell && cell.spill === spill,
    )
  )
    return cached;
  const built = build(cells);
  indexes.set(cells, built);
  return built;
}
export function forgetSpills(cells) {
  indexes.delete(cells);
}
// {anchor, value} for a cell covered by a spill, or undefined.
export function spillAt(sheet, ref) {
  return index(sheet.cells).covered.get(ref);
}
// The last row and column any spill reaches (0 when there is none).
export function spillBounds(sheet) {
  return index(sheet.cells).bounds;
}
// The cell as readers see it: its own record, or the spilled value as the
// anchor's formula result, with the record's formatting and `spilledFrom`
// naming the anchor, so stale-result checks apply to it too. A cell with its
// own input or formula wins (the anchor shows #SPILL! once recalculated).
export function cellAt(sheet, ref) {
  const cell = sheet.cells[ref];
  if (occupied(cell)) return cell;
  const spill = index(sheet.cells).covered.get(ref);
  if (!spill) return cell;
  const { input, ...rest } = cell ?? {};
  return {
    ...rest,
    formula: sheet.cells[spill.anchor].formula,
    result: spill.value,
    spilledFrom: spill.anchor,
  };
}
// A spilled cell as a plain value record (copying it copies the value, as in
// Excel); other cells unchanged.
export function asValue(cell) {
  if (!cell?.spilledFrom) return cell;
  const { formula, result, spilledFrom, ...rest } = cell;
  return { ...rest, input: result };
}
// The sheet as readers see it, for code that reads `sheet.cells[ref]`:
// covered cells appear with their spilled value. Never write through it.
export function readView(sheet) {
  const { covered } = index(sheet.cells);
  if (!covered.size) return sheet;
  const cells = { ...sheet.cells };
  for (const ref of covered.keys())
    if (!occupied(cells[ref])) cells[ref] = cellAt(sheet, ref);
  return { ...sheet, cells };
}
// Applies a calculation's result delta ({sheetId, ref, result, spill?}) to
// the formula cells of `book`, in place.
export function applyResults(book, results) {
  const touched = new Set();
  for (const r of results) {
    const cells = book.sheets.find((s) => s.id === r.sheetId).cells,
      cell = cells[r.ref];
    cell.result = r.result;
    if (r.spill) cell.spill = r.spill;
    else delete cell.spill;
    touched.add(cells);
  }
  for (const cells of touched) forgetSpills(cells);
}
// The anchors' spill rectangles do not overlap, start at their anchor, and
// carry one typed result per cell, the first equal to the anchor's result.
export function validateSpills(sheet, validateValue) {
  const seen = new Set();
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    if (cell.spill === undefined) continue;
    const r = parseRange(cell.spill.ref),
      { row, column } = parseAddress(ref);
    if (r.top !== row || r.left !== column)
      throw new Error(`Spill of ${ref} must start at ${ref}`);
    const height = r.bottom - r.top + 1,
      width = r.right - r.left + 1;
    if (height * width < 2) throw new Error("A spill covers at least 2 cells");
    const results = cell.spill.results;
    if (
      !Array.isArray(results) ||
      results.length !== height ||
      results.some((line) => !Array.isArray(line) || line.length !== width)
    )
      throw new Error(`Spill results of ${ref} must match ${cell.spill.ref}`);
    results.flat().forEach(validateValue);
    const first = results[0][0];
    if (
      first.type !== cell.result.type ||
      !Object.is(first.value, cell.result.value)
    )
      throw new Error(`Spill of ${ref} must start with its result`);
    for (let y = r.top; y <= r.bottom; y++)
      for (let x = r.left; x <= r.right; x++) {
        const key = y * 16385 + x;
        if (seen.has(key)) throw new Error("Spill ranges cannot overlap");
        seen.add(key);
      }
  }
}
