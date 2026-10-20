import { address, parseAddress } from "../model/workbook.mjs";
export function display(cell) {
  const v = cell?.formula ? cell.result : cell?.input;
  if (!v || v.type === "blank") return "";
  if (v.type === "boolean") return v.value ? "TRUE" : "FALSE";
  if (v.type === "error" || v.type === "text") return v.value;
  const f = cell.format ?? { kind: "general" };
  if (f.kind === "date" || v.type === "date") return `Excel date ${v.value}`;
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
  return new Intl.NumberFormat("en-US", options).format(v.value);
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
export function preview(sheet) {
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
        text: display(sheet.cells[address(r + 1, c + 1)]),
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
