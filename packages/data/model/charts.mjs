// Data charts (T18, ADR-013 §4): the chart-level options of the shared chart
// contract plus one binding, a rectangular A1 block (header row first) whose
// columns follow the chart type's table adapter. The chart JSON is the
// adapter's fromRows over the block's typed values; it is derived, never
// saved. A saved SVG preview shows the chart without ECharts.
import { address, parseAddress, parseRange } from "./workbook.mjs";
import { jsonStringify } from "./json.mjs";
import { registry } from "../../shared/charts/index.mjs";
import { checkOptions } from "../../shared/charts/schema.mjs";

export const MAX_CHARTS = 50;
// Binding cells, header included (ADR-013 §4 allows 10,000 data points).
export const MAX_CHART_CELLS = 20000;
// Saved preview length in UTF-16 code units, as for a pasted preview.
export const MAX_PREVIEW = 2 * 1024 * 1024;
export const WIDTHS = [160, 2000],
  HEIGHTS = [120, 1600],
  DEFAULT_SIZE = { width: 560, height: 320 };
// Box geometry shared by the editor and build-time previews: the title and
// unit are HTML above the plot (as in Slides); the preview is the plot only.
const PAD = 8,
  TITLE = 24,
  UNIT = 18;
export function plotSize(chart) {
  const head =
    (chart.options.title ? TITLE : 0) + (chart.options.unit ? UNIT : 0);
  return {
    width: chart.width - 2 * PAD,
    height: chart.height - 2 * PAD - head,
  };
}
// Column roles per type, in adapter order. Category charts take a category
// column and one numeric column per series, named by the header row.
const CATEGORY = { roles: ["text"], series: true, min: 2 };
export const LAYOUTS = {
  column: CATEGORY,
  hbar: CATEGORY,
  stacked: CATEGORY,
  line: CATEGORY,
  waterfall: { roles: ["text", "number", "flag"], min: 3 },
  bubble: { roles: ["text", "number", "number", "number"], min: 4 },
  gantt: { roles: ["text", "date", "date", "text", "flag"], min: 2 },
};
export const chartTypes = () => Object.keys(registry);
export const typeLabel = (type) => registry[type]?.label ?? type;
export const chartLabel = (chart) => chart.options.title || "Untitled chart";
// The block's expected columns, for messages and the chart panel.
export const columnsHint = (type) =>
  LAYOUTS[type].series
    ? "a category column, then one column per series (names in the header row)"
    : registry[type].table.columns({}).join(", ");

const fail = (message) => {
  throw new Error(message);
};
const object = (v) =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
function fields(value, allowed, where) {
  if (!object(value)) fail(`${where}: expected object`);
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) fail(`${where}: unknown field ${key}`);
}
const id = (v) => typeof v === "string" && /^[a-zA-Z][\w-]{0,79}$/.test(v);
const size = (v, [min, max]) => Number.isInteger(v) && v >= min && v <= max;

export function validateCharts(book) {
  const charts = book.charts === undefined ? [] : book.charts;
  if (!Array.isArray(charts) || charts.length > MAX_CHARTS)
    fail(`Expected at most ${MAX_CHARTS} charts`);
  const ids = new Set(),
    sheetIds = new Set(book.sheets.map((s) => s.id));
  for (const chart of charts) {
    fields(
      chart,
      [
        "id",
        "sheetId",
        "anchor",
        "width",
        "height",
        "type",
        "options",
        "source",
        "preview",
      ],
      "chart",
    );
    if (!id(chart.id) || ids.has(chart.id)) fail("Duplicate/invalid chart ID");
    ids.add(chart.id);
    if (!sheetIds.has(chart.sheetId)) fail(`Chart ${chart.id}: unknown sheet`);
    if (typeof chart.anchor !== "string" || chart.anchor.includes(":"))
      fail(`Chart ${chart.id}: anchor must be one cell`);
    parseAddress(chart.anchor);
    if (!size(chart.width, WIDTHS) || !size(chart.height, HEIGHTS))
      fail(
        `Chart ${chart.id}: width ${WIDTHS.join("–")} px and height ${HEIGHTS.join("–")} px required`,
      );
    if (typeof chart.type !== "string" || !Object.hasOwn(LAYOUTS, chart.type))
      fail(`Chart ${chart.id}: unknown type`);
    const problems = checkOptions(chart.type, chart.options);
    if (problems.length) fail(`Chart ${chart.id}: ${problems.join("; ")}`);
    fields(chart.source, ["sheetId", "ref"], "chart source");
    if (!sheetIds.has(chart.source.sheetId))
      fail(`Chart ${chart.id}: unknown source sheet`);
    if (chart.source.ref !== "#REF!") parseRange(chart.source.ref);
    if (chart.preview !== undefined) {
      fields(chart.preview, ["svg", "revision"], "chart preview");
      if (
        typeof chart.preview.svg !== "string" ||
        chart.preview.svg.length > MAX_PREVIEW ||
        !/^<svg[\s>]/.test(chart.preview.svg) ||
        typeof chart.preview.revision !== "string" ||
        !/^[a-f0-9]{64}$/.test(chart.preview.revision)
      )
        fail(`Chart ${chart.id}: invalid preview`);
    }
  }
}

// ---- binding ----
function typedValue(cell) {
  if (!cell) return null;
  if (cell.formula) return cell.result ?? undefined;
  return cell.input ?? null;
}
// Excel 1900 serial to ISO text; serial 60 is the fictitious 29 February
// 1900, which the Gantt validator then rejects as a date.
export function isoDate(serial) {
  const day = Math.floor(serial);
  if (day === 60) return "1900-02-29";
  return new Date(
    Date.UTC(1899, 11, 31) + (day > 59 ? day - 1 : day) * 86400000,
  )
    .toISOString()
    .slice(0, 10);
}
const ISSUE = {
  missing: "formula result not calculated",
  blank: "blank",
  text: "text",
  boolean: "TRUE/FALSE",
  error: "error",
};
// Reads the block into adapter rows. Labels use the displayed text (label is
// the editor's display function); numbers keep full precision; Gantt dates
// become ISO text. Cells that cannot supply a number are listed in `issues`.
export function chartTable(book, chart, label) {
  const layout = LAYOUTS[chart.type],
    sheet = book.sheets.find((s) => s.id === chart.source.sheetId);
  if (chart.source.ref === "#REF!" || !sheet)
    return { problem: "Its data range was deleted." };
  const r = parseRange(chart.source.ref),
    width = r.right - r.left + 1,
    height = r.bottom - r.top + 1;
  if (width * height > MAX_CHART_CELLS)
    return {
      problem: `Its data range has more than ${MAX_CHART_CELLS.toLocaleString("en-US")} cells.`,
    };
  if (height < 2)
    return { problem: "Its data range needs a header row and data rows." };
  if (width < layout.min || (!layout.series && width > layout.roles.length))
    return {
      problem: `Its data range needs ${layout.series ? `at least ${layout.min}` : `${layout.min}–${layout.roles.length}`} columns: ${columnsHint(chart.type)}.`,
    };
  const issues = [];
  let formulas = false;
  const role = (c) =>
    layout.series ? (c === 0 ? "text" : "number") : layout.roles[c];
  const read = (row, column) => {
    const ref = address(row, column),
      cell = sheet.cells[ref];
    if (cell?.formula) formulas = true;
    const v = typedValue(cell),
      kind = role(column - r.left);
    if (kind === "text") return label(cell);
    if (kind === "number") {
      if (v && (v.type === "number" || v.type === "date")) return v.value;
      issues.push({
        ref,
        kind: v === undefined ? "missing" : !v ? "blank" : v.type,
      });
      return null;
    }
    if (!v || v.type === "blank") return "";
    if (kind === "flag")
      return v.type === "boolean" || v.type === "text" ? v.value : "";
    // Gantt dates: date values, numbers shown as dates, or ISO-like text.
    if (
      v.type === "date" ||
      (v.type === "number" && cell.format?.kind === "date")
    )
      return isoDate(v.value);
    return v.type === "text" ? v.value : "";
  };
  const columns = layout.series ? width : layout.roles.length,
    headers = [],
    rows = [];
  for (let c = 0; c < columns; c++)
    headers.push(
      c < width ? label(sheet.cells[address(r.top, r.left + c)]) : "",
    );
  for (let row = r.top + 1; row <= r.bottom; row++) {
    const values = [];
    for (let c = 0; c < columns; c++)
      values.push(c < width ? read(row, r.left + c) : "");
    rows.push(values);
  }
  return { headers, rows, issues, formulas };
}
// The chart JSON of a binding and its problems. Category charts accept
// missing points (null) and report what became one; other types need every
// value, and their problems name the offending cells.
export function chartData(book, chart, label) {
  const table = chartTable(book, chart, label);
  if (table.problem) return { errors: [table.problem], issues: [] };
  const def = registry[chart.type],
    data = def.table.fromRows(
      table.rows,
      table.headers,
      structuredClone(chart.options),
    ),
    errors = def.validate(data);
  if (errors.length && table.issues.length)
    errors.push(
      `Check ${table.issues
        .slice(0, 5)
        .map((i) => `${i.ref} (${ISSUE[i.kind]})`)
        .join(
          ", ",
        )}${table.issues.length > 5 ? ` and ${table.issues.length - 5} more` : ""}.`,
    );
  return { data, errors, issues: table.issues, formulas: table.formulas };
}
// Identifies what a preview shows: type, chart JSON, size and built-in theme.
export async function chartRevision(chart, data, theme) {
  const text = jsonStringify(
    {
      type: chart.type,
      data,
      width: chart.width,
      height: chart.height,
      theme: theme ?? null,
    },
    { pretty: false, sortKeys: true },
  );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
// A saved preview as an image source: an <img> never runs scripts or loads
// resources from the SVG, so the preview needs no sanitiser.
export const previewSource = (svg) =>
  "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
export function nextChartId(book) {
  const used = new Set((book.charts ?? []).map((c) => c.id));
  let n = used.size + 1;
  while (used.has(`chart${n}`)) n++;
  return `chart${n}`;
}
// The anchor cell of a chart whose sheet changes: it moves like a cell, and
// to the first surviving row or column when its own is deleted.
export function shiftAnchor(anchor, { axis, action, index, count }) {
  const p = parseAddress(anchor),
    row = axis === "row",
    n = row ? p.row : p.column,
    limit = row ? 1048576 : 16384;
  let m = n;
  if (action === "insert") m = n >= index ? Math.min(limit, n + count) : n;
  else if (n >= index + count) m = n - count;
  else if (n >= index) m = index;
  m = Math.min(m, limit);
  return address(row ? m : p.row, row ? p.column : m);
}
