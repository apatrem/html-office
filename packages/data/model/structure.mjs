import { address, parseAddress, parseRange } from "./workbook.mjs";
export function validateStructure(command, book) {
  if (
    !command ||
    typeof command !== "object" ||
    Object.keys(command).some(
      (k) => !["sheetId", "axis", "action", "index", "count"].includes(k),
    )
  )
    throw new Error("Invalid structural command");
  const { sheetId, axis, action, index, count } = command;
  if (
    !["row", "column"].includes(axis) ||
    !["insert", "delete"].includes(action)
  )
    throw new Error("Invalid structural action/axis");
  const limit = axis === "row" ? 1048576 : 16384;
  if (!Number.isInteger(count) || count < 1 || count > limit)
    throw new Error("Invalid structural count");
  if (!Number.isInteger(index) || index < 1 || index + count - 1 > limit)
    throw new Error("Structural index out of bounds");
  if (book && !book.sheets.some((s) => s.id === sheetId))
    throw new Error("Unknown sheet ID");
  return command;
}
export function inverseStructure(command) {
  validateStructure(command);
  return {
    ...command,
    action: command.action === "insert" ? "delete" : "insert",
  };
}
function moved(n, { action, index, count }) {
  if (action === "insert") return n >= index ? n + count : n;
  if (n < index) return n;
  if (n < index + count) return null;
  return n - count;
}
export function shiftRange(ref, command) {
  validateStructure(command);
  if (ref === "#REF!") return ref;
  const r = parseRange(ref),
    row = command.axis === "row",
    a = row ? r.top : r.left,
    b = row ? r.bottom : r.right,
    limit = row ? 1048576 : 16384;
  let first = a,
    last = b;
  if (command.action === "insert") {
    if (command.index <= a) {
      first += command.count;
      last += command.count;
    } else if (command.index <= b) last += command.count;
    if (first > limit) return "#REF!";
    last = Math.min(limit, last);
  } else {
    const end = command.index + command.count - 1;
    const survivorFirst = a < command.index ? a : Math.max(a, end + 1),
      survivorLast = b > end ? b : Math.min(b, command.index - 1);
    if (survivorFirst > survivorLast) return "#REF!";
    first = moved(survivorFirst, command);
    last = moved(survivorLast, command);
  }
  const start = address(row ? first : r.top, row ? r.left : first),
    end = address(row ? last : r.bottom, row ? r.right : last);
  return start === end ? start : `${start}:${end}`;
}
export function shiftWorkbook(book, command) {
  validateStructure(command, book);
  const next = {
    ...book,
    sheets: book.sheets.map((sheet) => {
      if (sheet.id !== command.sheetId) return sheet;
      const cells = {};
      for (const [ref, cell] of Object.entries(sheet.cells)) {
        const p = parseAddress(ref),
          n = moved(command.axis === "row" ? p.row : p.column, command);
        if (n !== null)
          cells[
            address(
              command.axis === "row" ? n : p.row,
              command.axis === "column" ? n : p.column,
            )
          ] = cell;
      }
      return { ...sheet, cells };
    }),
    names: book.names.map((name) =>
      name.sheetId === command.sheetId
        ? { ...name, ref: shiftRange(name.ref, command) }
        : name,
    ),
  };
  delete next.snapshot;
  return next;
}
export function structureBeforeRefs(book, command) {
  validateStructure(command, book);
  const refs = [];
  for (const sheet of book.sheets)
    for (const [ref, cell] of Object.entries(sheet.cells)) {
      const p = parseAddress(ref),
        n = command.axis === "row" ? p.row : p.column;
      if (
        cell.formula ||
        (command.action === "delete" &&
          sheet.id === command.sheetId &&
          n >= command.index &&
          n < command.index + command.count)
      )
        refs.push({ sheetId: sheet.id, ref });
    }
  return refs;
}
// Headers contain workbook/sheet metadata, but never duplicate source cells.
export function captureHead(book) {
  const { sheets, snapshot, ...head } = book;
  return structuredClone({
    ...head,
    sheets: sheets.map(({ cells, ...sheet }) => sheet),
  });
}
export function restoreHead(book, head) {
  const cells = new Map(book.sheets.map((sheet) => [sheet.id, sheet.cells]));
  for (const key of Object.keys(book)) delete book[key];
  Object.assign(book, structuredClone(head));
  book.sheets = book.sheets.map((sheet) => ({
    ...sheet,
    cells: cells.get(sheet.id) ?? {},
  }));
}
