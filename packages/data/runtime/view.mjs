import { address, parseAddress } from "../model/workbook.mjs";
const numberFormats = new Map(),
  dateFormats = new Map();
export function display(cell, locale = "en-US") {
  const v = cell?.formula ? cell.result : cell?.input;
  if (!v || v.type === "blank") return "";
  if (v.type === "boolean") return v.value ? "TRUE" : "FALSE";
  if (v.type === "error" || v.type === "text") return v.value;
  const f = cell.format ?? { kind: "general" };
  if (f.kind === "date" || v.type === "date") {
    const serial = Math.floor(v.value);
    if (serial < 0 || serial > 2958465) return "####";
    let formatter = dateFormats.get(locale);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: "UTC",
        calendar: "gregory",
      });
      dateFormats.set(locale, formatter);
    }
    const date = new Date(
      Date.UTC(1899, 11, 31) + (serial > 59 ? serial - 1 : serial) * 86400000,
    );
    if (serial === 60)
      return formatter
        .formatToParts(date)
        .map((part) => (part.type === "day" ? "29" : part.value))
        .join("");
    return formatter.format(date);
  }
  if (f.kind === "general") return String(v.value);
  const options = {
    minimumFractionDigits: f.digits ?? 2,
    maximumFractionDigits: f.digits ?? 2,
  };
  if (f.kind === "percent") options.style = "percent";
  if (f.kind === "currency" || f.kind === "accounting") {
    options.style = "currency";
    options.currency = f.currency ?? "EUR";
    if (f.kind === "accounting") options.currencySign = "accounting";
  }
  const key = locale + JSON.stringify(options);
  let formatter = numberFormats.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    numberFormats.set(key, formatter);
  }
  return formatter.format(v.value);
}
const bounds = new WeakMap();
export function touchPreview(cells, ref) {
  const old = bounds.get(cells);
  if (old) {
    const p = parseAddress(ref);
    old.rows = Math.max(old.rows, p.row);
    old.columns = Math.max(old.columns, p.column);
  }
}
export function usedBounds(sheet) {
  let rows = 4,
    columns = 3;
  let cached = bounds.get(sheet.cells);
  if (!cached) {
    for (const ref of Object.keys(sheet.cells)) {
      const p = parseAddress(ref);
      rows = Math.max(rows, p.row);
      columns = Math.max(columns, p.column);
    }
    cached = { rows, columns };
    bounds.set(sheet.cells, cached);
  }
  return cached;
}
export function preview(sheet, locale) {
  const cached = usedBounds(sheet);
  let rows, columns;
  rows = cached.rows;
  columns = cached.columns;
  const truncated = rows > 30 || columns > 12;
  rows = Math.min(rows, 30);
  columns = Math.min(columns, 12);
  return {
    truncated,
    rows: Array.from({ length: rows }, (_, r) =>
      Array.from({ length: columns }, (_, c) => ({
        ref: address(r + 1, c + 1),
        cell: sheet.cells[address(r + 1, c + 1)] ?? {},
        text: display(sheet.cells[address(r + 1, c + 1)], locale),
      })),
    ),
  };
}
export const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
