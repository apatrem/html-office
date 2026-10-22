import { parseAddress, address } from "./workbook.mjs";
export const ROWS = 1048576,
  COLUMNS = 16384,
  ROW_HEIGHT = 23,
  COLUMN_WIDTH = 100,
  ROW_HEADER = 40;
const clamp = (n, max) => Math.max(1, Math.min(max, n));
export function rectangle(anchor, focus) {
  const a = parseAddress(anchor),
    b = parseAddress(focus);
  return {
    top: Math.min(a.row, b.row),
    left: Math.min(a.column, b.column),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.column, b.column),
  };
}
export function navigate(
  ref,
  key,
  {
    command = false,
    shift = false,
    pageRows = 15,
    used = { rows: 1, columns: 1 },
  } = {},
) {
  let { row, column } = parseAddress(ref);
  if (key === "Home") {
    column = 1;
    if (command) row = 1;
  } else if (key === "End") {
    column = used.columns;
    if (command) row = used.rows;
  } else if (key === "PageUp") row -= pageRows;
  else if (key === "PageDown") row += pageRows;
  else if (key === "ArrowUp") row = command ? 1 : row - 1;
  else if (key === "ArrowDown") row = command ? used.rows : row + 1;
  else if (key === "ArrowLeft") column = command ? 1 : column - 1;
  else if (key === "ArrowRight") column = command ? used.columns : column + 1;
  else if (key === "Tab") column += shift ? -1 : 1;
  else if (key === "Enter") row += shift ? -1 : 1;
  return address(clamp(row, ROWS), clamp(column, COLUMNS));
}
export function viewport({ top, left, height, width }) {
  return {
    top: clamp(Math.floor(top / ROW_HEIGHT) - 2, ROWS),
    bottom: clamp(Math.ceil((top + height) / ROW_HEIGHT) + 2, ROWS),
    left: clamp(Math.floor(left / COLUMN_WIDTH) - 2, COLUMNS),
    right: clamp(Math.ceil((left + width) / COLUMN_WIDTH) + 2, COLUMNS),
  };
}
