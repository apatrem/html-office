// Portable table model (ADR-013 §3): a rectangular grid of slots, each a
// cell, null (empty) or {covered: true} inside a colspan/rowspan anchor.
// Appearance uses token names only; a destination maps them to its charte.
import { ClipboardError, plainObject, fields, safeURL } from "./errors.mjs";

// The closed vocabulary shared by Slides and Data (ADR-012).
export const TEXT_COLORS = ["ink", "acc", "mid", "alert", "t2", "bg"];
export const FILLS = ["none", "tint", "lig", "mid", "acc", "alert", "dark"];
export const CELL_STYLES = [
  "normal",
  "title",
  "header",
  "rowHeader",
  "assumption",
  "calculation",
  "output",
  "total",
  "note",
  "alert",
  "hyperlink",
];
export const ALIGNS = ["left", "center", "right"];
export const VALUE_TYPES = ["number", "text", "boolean", "date", "error"];
// HTML's own span limits.
export const MAX_COLSPAN = 1000,
  MAX_ROWSPAN = 65534;

const CELL = [
  "text",
  "header",
  "colspan",
  "rowspan",
  "value",
  "format",
  "runs",
  "bold",
  "italic",
  "color",
  "fill",
  "cellStyle",
  "link",
  "align",
];
const RUN = ["text", "bold", "italic", "color", "link"];
const fail = (message) => {
  throw new ClipboardError(message);
};
const flag = (v, where) => {
  if (v !== undefined && typeof v !== "boolean")
    fail(`${where}: expected true or false`);
};
const oneOf = (v, allowed, where) => {
  if (v !== undefined && !allowed.includes(v))
    fail(`${where}: use one of ${allowed.join(", ")}`);
};
const span = (v, max, where) => {
  if (v !== undefined && (!Number.isInteger(v) || v < 1 || v > max))
    fail(`${where}: expected an integer from 1 to ${max}`);
};
export function validateLink(link, where = "link") {
  fields(link, ["url"], where);
  if (!safeURL(link.url))
    fail(`${where}: only https, http or mailto links up to 2,048 characters`);
}
function validateValue(value, where) {
  fields(value, ["type", "value"], where);
  oneOf(value.type, VALUE_TYPES, `${where} type`);
  const v = value.value,
    ok =
      value.type === "number" || value.type === "date"
        ? typeof v === "number" && Number.isFinite(v)
        : value.type === "boolean"
          ? typeof v === "boolean"
          : typeof v === "string";
  if (!ok) fail(`${where}: value does not match its type`);
}
function validateCell(cell, where) {
  fields(cell, CELL, where);
  if (typeof cell.text !== "string") fail(`${where}: text is required`);
  for (const key of ["header", "bold", "italic"])
    flag(cell[key], `${where} ${key}`);
  span(cell.colspan, MAX_COLSPAN, `${where} colspan`);
  span(cell.rowspan, MAX_ROWSPAN, `${where} rowspan`);
  if (cell.value !== undefined) validateValue(cell.value, `${where} value`);
  // A Data preset; Data's own validator checks its fields.
  if (
    cell.format !== undefined &&
    !(
      plainObject(cell.format) &&
      Object.entries(cell.format).every(
        ([key, v]) =>
          /^[a-z][a-zA-Z]{0,31}$/.test(key) &&
          ["string", "number", "boolean"].includes(typeof v),
      )
    )
  )
    fail(`${where}: format must be an object of plain values`);
  oneOf(cell.color, TEXT_COLORS, `${where} color`);
  oneOf(cell.fill, FILLS, `${where} fill`);
  oneOf(cell.cellStyle, CELL_STYLES, `${where} cellStyle`);
  oneOf(cell.align, ALIGNS, `${where} align`);
  if (cell.link !== undefined) validateLink(cell.link, `${where} link`);
  if (cell.runs !== undefined) {
    if (!Array.isArray(cell.runs) || !cell.runs.length)
      fail(`${where}: runs must be a non-empty array`);
    let text = "";
    cell.runs.forEach((run, i) => {
      const at = `${where} run ${i + 1}`;
      fields(run, RUN, at);
      if (typeof run.text !== "string") fail(`${at}: text is required`);
      flag(run.bold, `${at} bold`);
      flag(run.italic, `${at} italic`);
      oneOf(run.color, TEXT_COLORS, `${at} color`);
      if (run.link !== undefined) validateLink(run.link, `${at} link`);
      text += run.text;
    });
    if (text !== cell.text) fail(`${where}: runs must add up to the cell text`);
  }
}

// Validates a table whole (all or nothing). maxCells bounds rows × columns
// before anything else is inspected.
export function validateTable(table, { maxCells = Infinity } = {}) {
  fields(table, ["rows", "headerRows", "totalRows", "columns"], "table");
  const rows = table.rows;
  if (!Array.isArray(rows) || !rows.length || !rows.every(Array.isArray))
    fail("table: rows must be a non-empty array of arrays");
  const width = rows[0].length;
  if (!width || rows.some((row) => row.length !== width))
    fail("table: expected a rectangular grid");
  if (rows.length * width > maxCells)
    fail(`table: more than ${maxCells.toLocaleString("en-US")} cells`);
  // Each covered slot must belong to exactly one anchor.
  const owner = rows.map((row) => row.map(() => false));
  rows.forEach((row, r) =>
    row.forEach((slot, c) => {
      const where = `table cell ${r + 1},${c + 1}`;
      if (slot === null) {
        if (owner[r][c]) fail(`${where}: covered slot must be {covered: true}`);
        return;
      }
      if (plainObject(slot) && slot.covered !== undefined) {
        fields(slot, ["covered"], where);
        if (slot.covered !== true || !owner[r][c])
          fail(`${where}: covered slot outside a span`);
        return;
      }
      validateCell(slot, where);
      if (owner[r][c]) fail(`${where}: overlaps a span`);
      const down = slot.rowspan ?? 1,
        across = slot.colspan ?? 1;
      if (r + down > rows.length || c + across > width)
        fail(`${where}: span leaves the table`);
      for (let i = r; i < r + down; i++)
        for (let j = c; j < c + across; j++)
          if (i !== r || j !== c) {
            if (owner[i][j]) fail(`${where}: spans overlap`);
            owner[i][j] = true;
          }
    }),
  );
  rows.forEach((row, r) =>
    row.forEach((slot, c) => {
      if (owner[r][c] && !(plainObject(slot) && slot.covered === true))
        fail(
          `table cell ${r + 1},${c + 1}: expected {covered: true} inside a span`,
        );
    }),
  );
  if (
    table.headerRows !== undefined &&
    (!Number.isInteger(table.headerRows) ||
      table.headerRows < 0 ||
      table.headerRows > rows.length)
  )
    fail("table: invalid headerRows");
  if (table.totalRows !== undefined) {
    const t = table.totalRows;
    if (
      !Array.isArray(t) ||
      new Set(t).size !== t.length ||
      !t.every((i) => Number.isInteger(i) && i >= 0 && i < rows.length)
    )
      fail("table: invalid totalRows");
  }
  if (table.columns !== undefined) {
    if (!Array.isArray(table.columns) || table.columns.length !== width)
      fail("table: one columns entry per column");
    table.columns.forEach((column, i) => {
      const where = `table column ${i + 1}`;
      fields(column, ["align", "width"], where);
      oneOf(column.align, ALIGNS, `${where} align`);
      if (
        column.width !== undefined &&
        (typeof column.width !== "number" ||
          !(column.width >= 0 && column.width <= 100))
      )
        fail(`${where}: width is a percentage`);
    });
  }
  return table;
}

// Displayed text as TSV, for text/plain (Excel's quoting).
export const quoteTSV = (value) =>
  /[\t\r\n"]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
export const toTSV = (rows) =>
  rows.map((row) => row.map(quoteTSV).join("\t")).join("\n");
export const tableText = (table) =>
  toTSV(table.rows.map((row) => row.map((slot) => slot?.text ?? "")));
