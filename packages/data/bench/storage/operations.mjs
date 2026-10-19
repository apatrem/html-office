// Assessment-only range operations. T10 will add the complete product command contract.
import { parseAddress, address, validateCell } from "../../model/workbook.mjs";
import { EngineSession } from "../../engine/adapter.mjs";
export function writeCell(book, sheetId, ref, cell) {
  validateCell(cell);
  parseAddress(ref);
  const sheet = book.sheets.find((s) => s.id === sheetId);
  if (!sheet) throw new Error("Unknown sheet");
  sheet.cells[ref] = structuredClone(cell);
  delete book.snapshot;
  return book;
}
export async function structuralEdit(
  book,
  module,
  { sheetId, axis = "row", index, count = 1, remove = false },
) {
  if (book.names.length)
    throw new Error("Named-range structural edits await the T10 contract");
  if (
    !["row", "column"].includes(axis) ||
    !Number.isInteger(index) ||
    index < 1 ||
    !Number.isInteger(count) ||
    count < 1
  )
    throw new Error("Invalid structural edit");
  const target = book.sheets.findIndex((s) => s.id === sheetId);
  if (target < 0) throw new Error("Unknown sheet");
  const session = new EngineSession(module);
  try {
    session.load(book);
    session.engine.pauseEvaluation();
    const command =
      (remove ? "delete" : "insert") + (axis === "row" ? "Rows" : "Columns");
    session.engine[command](target, index, count);
    session.engine.resumeEvaluation();
    const next = structuredClone(book),
      cells = {};
    for (const [ref, cell] of Object.entries(next.sheets[target].cells)) {
      const point = parseAddress(ref),
        position = axis === "row" ? point.row : point.column;
      if (remove && position >= index && position < index + count) continue;
      if (position >= index)
        point[axis === "row" ? "row" : "column"] += remove ? -count : count;
      cells[address(point.row, point.column)] = cell;
    }
    next.sheets[target].cells = cells;
    next.sheets.forEach((sheet, i) => {
      for (const [ref, cell] of Object.entries(sheet.cells))
        if (cell.formula) {
          const p = parseAddress(ref);
          cell.formula = session.engine.getCellContent(i, p.row, p.column);
        }
    });
    session.book = next;
    return await session.calculate();
  } finally {
    session.dispose();
  }
}
