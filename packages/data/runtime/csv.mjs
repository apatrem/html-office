// Export sheet as CSV (T19): the selected sheet's values from A1 to its last
// filled cell, never formulas or formatting. Two value policies: calculated
// values (full precision, no grouping, ISO dates) or the text as displayed.
// The separators follow the workbook's regional setting unless chosen: a
// decimal comma goes with semicolons, as Excel expects in those locales.
// Text a spreadsheet would read as a formula is neutralised with a leading
// apostrophe (CSV injection). Engine-free: stale or missing saved results
// need an explicit choice, recalculating first or exporting saved values.
import { address, parseAddress } from "../model/workbook.mjs";
import { display } from "./view.mjs";

// Fields a CSV may hold (rows × columns from A1): about 100 MB of text.
export const MAX_CSV_FIELDS = 10000000;
const BOM = "﻿";

export const decimalMark = (locale) =>
  new Intl.NumberFormat(locale)
    .formatToParts(1.5)
    .find((part) => part.type === "decimal")?.value ?? ".";

// The default separators for a locale: semicolons with a decimal comma.
export const regionalSeparators = (locale) =>
  decimalMark(locale) === ","
    ? { separator: ";", decimal: "," }
    : { separator: ",", decimal: "." };

// Cells with a value: a formula or a non-blank input (not style-only cells
// or explicit blanks).
const filled = (cell) =>
  !!cell?.formula || (!!cell?.input && cell.input.type !== "blank");

// The rectangle exported: from A1 to the last filled row and column, so
// positions survive; an empty sheet has none.
export function csvBounds(sheet) {
  let rows = 0,
    columns = 0;
  for (const [ref, cell] of Object.entries(sheet.cells))
    if (filled(cell)) {
      const p = parseAddress(ref);
      rows = Math.max(rows, p.row);
      columns = Math.max(columns, p.column);
    }
  return { rows, columns };
}

// Excel 1900 serial to an ISO date, with a time when it has one (to the
// second); the fictitious 1900-02-29 is serial 60.
export function isoDate(serial) {
  const seconds = Math.round(serial * 86400),
    day = Math.floor(seconds / 86400),
    rest = seconds - day * 86400,
    date = new Date(
      Date.UTC(1899, 11, 31) + (day > 59 ? day - 1 : day) * 86400000,
    ),
    pad = (n) => String(n).padStart(2, "0"),
    text =
      day === 60
        ? "1900-02-29"
        : `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  return rest
    ? `${text} ${pad(Math.floor(rest / 3600))}:${pad(Math.floor(rest / 60) % 60)}:${pad(rest % 60)}`
    : text;
}

// Leading characters a spreadsheet reads as a formula (OWASP CSV injection),
// including their full-width forms, and a tab or carriage return.
const FORMULA_LIKE = /^[\s　]*[=+\-@＝＋－＠]|^[\t\r]/;
export const neutralise = (text) =>
  FORMULA_LIKE.test(text) ? `'${text}` : text;

// One cell's field before quoting. `missing` counts formulas without a saved
// result (exported empty).
export function cellText(cell, { values, decimal, locale }, counts) {
  if (!filled(cell)) return "";
  const v = cell.formula ? cell.result : cell.input;
  if (!v) {
    counts.missing++;
    return "";
  }
  if (v.type === "text") {
    if (v.value !== neutralise(v.value)) counts.neutralised++;
    return neutralise(v.value);
  }
  if (!values) return display(cell, locale);
  if (v.type === "blank") return "";
  if (v.type === "boolean") return v.value ? "TRUE" : "FALSE";
  if (v.type === "error") return v.value;
  const date = cell.format?.kind === "date" || v.type === "date";
  if (date && v.value >= 0 && v.value < 2958466) return isoDate(v.value);
  const text = String(v.value);
  return decimal === "," ? text.replace(".", ",") : text;
}

// RFC 4180 quoting: a field holding the separator, a quote, a line break or
// edge spaces is quoted, with quotes doubled.
export function quote(text, separator) {
  return text.includes(separator) ||
    /["\r\n]/.test(text) ||
    /^\s|\s$/.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}

// The CSV text (UTF-8 BOM, CRLF line ends, same field count on every row)
// and what it holds.
export function sheetCSV(
  sheet,
  { values = true, locale = "en-US", separator, decimal } = {},
) {
  const defaults = regionalSeparators(locale);
  separator ??= defaults.separator;
  decimal ??= defaults.decimal;
  const { rows, columns } = csvBounds(sheet),
    counts = { missing: 0, neutralised: 0 };
  if (rows * columns > MAX_CSV_FIELDS)
    return {
      rows,
      columns,
      refused: `This sheet is too large for CSV (${(rows * columns).toLocaleString("en-US")} fields from A1 to ${address(rows, columns)}; the limit is ${MAX_CSV_FIELDS.toLocaleString("en-US")}).`,
    };
  const lines = [],
    options = { values, decimal, locale };
  for (let row = 1; row <= rows; row++) {
    const fields = [];
    for (let col = 1; col <= columns; col++)
      fields.push(
        quote(
          cellText(sheet.cells[address(row, col)], options, counts),
          separator,
        ),
      );
    lines.push(fields.join(separator));
  }
  return {
    text: BOM + lines.map((line) => line + "\r\n").join(""),
    rows,
    columns,
    separator,
    decimal,
    ...counts,
  };
}
