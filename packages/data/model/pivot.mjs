// Basic pivot tables (T17, ADR-013): readable definitions, typed grouping of
// in-workbook records, SUM/COUNT/AVERAGE with totals, and the output range a
// pivot owns. Aggregation runs over typed values; it is not a formula evaluator.
import {
  parseAddress,
  parseRange,
  validateValue,
  ERRORS,
} from "./workbook.mjs";
import { jsonStringify } from "./json.mjs";

export const MAX_PIVOTS = 50;
export const MAX_ROW_FIELDS = 4;
export const MAX_COLUMN_FIELDS = 2;
export const MAX_FILTERS = 4;
export const MAX_MEASURES = 8;
export const MAX_FILTER_VALUES = 1000;
export const MAX_ROW_ITEMS = 10000;
export const MAX_COLUMN_ITEMS = 500;
export const MAX_OUTPUT_CELLS = 200000;
export const MAX_SOURCE_CELLS = 5000000;
export const AGGREGATES = ["sum", "count", "average"];
// Prefix of worker errors that concern the definition, not the engine.
export const PIVOT_ERROR = "Pivot: ";
const ROWS = 1048576,
  COLUMNS = 16384;
const AGGREGATE_LABEL = { sum: "Sum", count: "Count", average: "Average" };
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
const fieldName = (v) =>
  typeof v === "string" && v.length > 0 && v.length <= 255;
export const overlaps = (a, b) =>
  a.top <= b.bottom &&
  a.bottom >= b.top &&
  a.left <= b.right &&
  a.right >= b.left;
export const inside = (r, row, column) =>
  row >= r.top && row <= r.bottom && column >= r.left && column <= r.right;
// Column letters without address()'s round-trip validation: hot loops only.
const LETTERS = [];
export function columnName(column) {
  let name = LETTERS[column];
  if (name) return name;
  name = "";
  for (let c = column; c > 0; c = Math.floor((c - 1) / 26))
    name = String.fromCharCode(65 + ((c - 1) % 26)) + name;
  return (LETTERS[column] = name);
}
const at = (row, column) => columnName(column) + row;
const rangeRef = (r) =>
  r.top === r.bottom && r.left === r.right
    ? at(r.top, r.left)
    : `${at(r.top, r.left)}:${at(r.bottom, r.right)}`;

export function validatePivots(book) {
  const pivots = book.pivots === undefined ? [] : book.pivots;
  if (!Array.isArray(pivots) || pivots.length > MAX_PIVOTS)
    fail(`Expected at most ${MAX_PIVOTS} pivot tables`);
  const ids = new Set(),
    sheetIds = new Set(book.sheets.map((s) => s.id)),
    outputs = [];
  for (const pivot of pivots) {
    fields(
      pivot,
      [
        "id",
        "name",
        "source",
        "output",
        "rows",
        "columns",
        "filters",
        "values",
        "refreshed",
      ],
      "pivot",
    );
    if (!id(pivot.id) || ids.has(pivot.id)) fail("Duplicate/invalid pivot ID");
    ids.add(pivot.id);
    if (
      pivot.name !== undefined &&
      (typeof pivot.name !== "string" || pivot.name.length > 120)
    )
      fail("Pivot name must be text of at most 120 characters");
    fields(pivot.source, ["sheetId", "ref"], "pivot source");
    if (!sheetIds.has(pivot.source.sheetId)) fail("Unknown pivot source sheet");
    if (pivot.source.ref !== undefined && pivot.source.ref !== "#REF!")
      parseRange(pivot.source.ref);
    fields(pivot.output, ["sheetId", "ref"], "pivot output");
    if (!sheetIds.has(pivot.output.sheetId)) fail("Unknown pivot output sheet");
    const output = parseRange(pivot.output.ref);
    // Ownership is bounded: an unrefreshed pivot owns only its anchor, and no
    // stored output can exceed the largest table a refresh may write.
    if (
      pivot.refreshed === undefined &&
      (output.top !== output.bottom || output.left !== output.right)
    )
      fail("A pivot that was never refreshed owns only its anchor cell");
    if (
      (output.bottom - output.top + 1) * (output.right - output.left + 1) >
      MAX_OUTPUT_CELLS
    )
      fail(`A pivot output cannot exceed ${MAX_OUTPUT_CELLS} cells`);
    for (const [key, max] of [
      ["rows", MAX_ROW_FIELDS],
      ["columns", MAX_COLUMN_FIELDS],
    ])
      if (
        !Array.isArray(pivot[key]) ||
        pivot[key].length > max ||
        !pivot[key].every(fieldName)
      )
        fail(`Pivot ${key} must list at most ${max} field names`);
    if (!Array.isArray(pivot.filters) || pivot.filters.length > MAX_FILTERS)
      fail(`Pivot filters must list at most ${MAX_FILTERS} fields`);
    for (const filter of pivot.filters) {
      fields(filter, ["field", "values"], "pivot filter");
      if (!fieldName(filter.field)) fail("Invalid pivot filter field");
      if (
        !Array.isArray(filter.values) ||
        filter.values.length > MAX_FILTER_VALUES
      )
        fail(`A pivot filter keeps at most ${MAX_FILTER_VALUES} values`);
      for (const value of filter.values) validateValue(value);
    }
    const used = [
      ...pivot.rows,
      ...pivot.columns,
      ...pivot.filters.map((f) => f.field),
    ];
    if (new Set(used).size !== used.length)
      fail("A field can appear once among pivot rows, columns and filters");
    if (
      !Array.isArray(pivot.values) ||
      !pivot.values.length ||
      pivot.values.length > MAX_MEASURES
    )
      fail(`A pivot needs 1–${MAX_MEASURES} values`);
    for (const measure of pivot.values) {
      fields(measure, ["field", "aggregate"], "pivot value");
      if (!fieldName(measure.field) || !AGGREGATES.includes(measure.aggregate))
        fail("Pivot values need a field and sum, count or average");
    }
    if (pivot.refreshed !== undefined) {
      fields(pivot.refreshed, ["fingerprint", "at"], "pivot refreshed");
      if (
        !/^[a-f0-9]{64}$/.test(pivot.refreshed.fingerprint) ||
        typeof pivot.refreshed.at !== "string" ||
        !Number.isFinite(Date.parse(pivot.refreshed.at))
      )
        fail("Invalid pivot refresh stamp");
    }
    if (pivot.source.sheetId === pivot.output.sheetId) {
      if (pivot.source.ref === undefined)
        fail(
          "A pivot reading a whole sheet must write its output on another sheet",
        );
      if (
        pivot.source.ref !== "#REF!" &&
        overlaps(parseRange(pivot.source.ref), output)
      )
        fail("A pivot output cannot overlap its own source");
    }
    for (const other of outputs)
      if (other.sheetId === pivot.output.sheetId && overlaps(other, output))
        fail("Pivot outputs cannot overlap");
    outputs.push({ ...output, sheetId: pivot.output.sheetId });
  }
}

// The pivot that owns a cell, if any. `rects` is ownerRects(book) when many
// cells are checked against the same workbook.
export function ownerRects(book) {
  const sheets = new Map();
  for (const pivot of book.pivots ?? []) {
    if (!sheets.has(pivot.output.sheetId)) sheets.set(pivot.output.sheetId, []);
    sheets
      .get(pivot.output.sheetId)
      .push({ pivot, rect: parseRange(pivot.output.ref) });
  }
  return sheets;
}
export function pivotOwner(rects, sheetId, ref) {
  const list = rects.get(sheetId);
  if (!list) return undefined;
  const { row, column } = parseAddress(ref);
  return list.find(({ rect }) => inside(rect, row, column))?.pivot;
}
export const pivotLabel = (pivot) => pivot.name || pivot.id;

// Row/column operations may move an output, never cut through or delete part of
// it: its cells would no longer form the table its definition describes.
export function assertPivotStructure(
  book,
  { sheetId, axis, action, index, count },
) {
  for (const pivot of book.pivots ?? []) {
    if (pivot.output.sheetId !== sheetId) continue;
    const r = parseRange(pivot.output.ref),
      [a, b, limit] =
        axis === "row" ? [r.top, r.bottom, ROWS] : [r.left, r.right, COLUMNS],
      what = axis === "row" ? "rows" : "columns";
    if (action === "insert") {
      if (index > a && index <= b)
        fail(
          `Inserting ${what} would split pivot "${pivotLabel(pivot)}" (${pivot.output.ref}). Insert outside it, or move the pivot.`,
        );
      if (index <= a && b + count > limit)
        fail(
          `Inserting ${what} would push pivot "${pivotLabel(pivot)}" off the sheet.`,
        );
    } else if (index <= b && index + count - 1 >= a)
      fail(
        `Deleting these ${what} would remove part of pivot "${pivotLabel(pivot)}" (${pivot.output.ref}). Delete the pivot first.`,
      );
  }
}

// ---- source resolution ----
function typedValue(cell) {
  if (!cell) return null;
  if (cell.formula) return cell.result ?? undefined;
  return cell.input ?? null;
}
const isBlank = (v) => v === null || v.type === "blank";
// A header cell's field name: text, or the canonical string of a number or
// Boolean. Blanks, errors and missing results name no field.
export function headerLabel(cell) {
  const v = typedValue(cell);
  if (!v || v.type === "blank" || v.type === "error") return null;
  if (v.type === "text") return v.value || null;
  if (v.type === "boolean") return v.value ? "TRUE" : "FALSE";
  return String(v.value);
}
// Keys are validated A1 addresses; a character loop avoids a regular
// expression per cell on large sheets.
function usedRange(sheet) {
  let bottom = 0,
    right = 0;
  for (const ref in sheet.cells) {
    const cell = sheet.cells[ref];
    if (!cell.input && !cell.formula) continue;
    let i = 0,
      column = 0;
    for (; ref.charCodeAt(i) >= 65; i++)
      column = column * 26 + ref.charCodeAt(i) - 64;
    const row = Number(ref.slice(i));
    if (row > bottom) bottom = row;
    if (column > right) right = column;
  }
  return bottom ? { top: 1, left: 1, bottom, right } : null;
}
// The source rectangle and its header fields, or an explanation. `bounds`
// may supply a cached, possibly larger used range for whole-sheet sources
// ({rows, columns}): empty records and blank headers are skipped anyway.
export function resolveSource(
  book,
  pivot,
  { bounds, formulaResultsCurrent } = {},
) {
  const sheet = book.sheets.find((s) => s.id === pivot.source.sheetId);
  if (!sheet) fail("The pivot's source sheet no longer exists.");
  if (pivot.source.ref === "#REF!")
    fail("The pivot's source range was deleted. Choose a new source.");
  const cached = pivot.source.ref === undefined && bounds?.(sheet),
    rect =
      pivot.source.ref !== undefined
        ? parseRange(pivot.source.ref)
        : cached
          ? { top: 1, left: 1, bottom: cached.rows, right: cached.columns }
          : usedRange(sheet);
  if (!rect) fail(`The source sheet "${sheet.name}" is empty.`);
  const area = (r) => (r.bottom - r.top + 1) * (r.right - r.left + 1);
  // Cached bounds may include formatting-only cells: measure exactly first.
  if (cached && area(rect) > MAX_SOURCE_CELLS) {
    const exact = usedRange(sheet);
    if (!exact) fail(`The source sheet "${sheet.name}" is empty.`);
    Object.assign(rect, exact);
  }
  if (area(rect) > MAX_SOURCE_CELLS)
    fail("The pivot source is larger than 5,000,000 cells.");
  const labels = new Map(),
    duplicates = new Set();
  // Header formulas whose results are missing (or, when `formulaResultsCurrent`
  // is false, unverified) cannot name fields yet: only a recalculation can.
  let unresolved = false;
  for (let c = rect.left; c <= rect.right; c++) {
    const cell = sheet.cells[at(rect.top, c)];
    if (cell?.formula && (!cell.result || formulaResultsCurrent === false))
      unresolved = true;
    const label = headerLabel(cell);
    if (label === null) continue;
    if (labels.has(label)) duplicates.add(label);
    else labels.set(label, c);
  }
  return { sheet, rect, labels, duplicates, unresolved };
}
function fieldColumn(source, name) {
  if (source.duplicates.has(name))
    fail(`More than one source column is named "${name}". Rename one of them.`);
  const column = source.labels.get(name);
  if (column === undefined)
    fail(
      `The source has no column named "${name}". Was it renamed or deleted?`,
    );
  return column;
}

// ---- typed keys, ordering and aggregation ----
// Typed identity without coercion or case folding; signed zeros are equal.
export function itemKey(v) {
  if (isBlank(v)) return "_";
  if (v.type === "number") return `n${v.value === 0 ? 0 : v.value}`;
  if (v.type === "date") return `d${v.value === 0 ? 0 : v.value}`;
  if (v.type === "boolean") return v.value ? "b1" : "b0";
  if (v.type === "error") return `e${v.value}`;
  return `t${v.value}`;
}
const RANK = { number: 0, date: 1, text: 2, boolean: 3, error: 4 };
const rank = (v) => (isBlank(v) ? 5 : RANK[v.type]);
const codeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// Deterministic in every browser: no locale collation.
export function compareItems(a, b) {
  const ra = rank(a),
    rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 5) return 0;
  if (a.type === "text")
    return (
      codeUnits(a.value.toLowerCase(), b.value.toLowerCase()) ||
      codeUnits(a.value, b.value)
    );
  if (a.type === "error")
    return ERRORS.indexOf(a.value) - ERRORS.indexOf(b.value);
  return Number(a.value) - Number(b.value);
}
const tupleKey = (keys) => keys.map((k) => `${k.length}:${k}`).join("");
function compareTuples(a, b) {
  for (let i = 0; i < a.values.length; i++) {
    const order = compareItems(a.values[i], b.values[i]);
    if (order) return order;
  }
  return 0;
}
const accumulator = () => ({ sum: 0, numbers: 0, count: 0, error: null });
function accumulate(acc, v) {
  if (isBlank(v)) return;
  acc.count++;
  if (v.type === "error") acc.error ??= v.value;
  else if (v.type === "number" || v.type === "date") {
    // Source row order, as IronCalc's SUM adds values.
    acc.sum += v.value;
    acc.numbers++;
  }
}
function result(acc, aggregate) {
  if (aggregate === "count") return { type: "number", value: acc.count };
  if (acc.error) return { type: "error", value: acc.error };
  if (aggregate === "average" && !acc.numbers)
    return { type: "error", value: "#DIV/0!" };
  const value = aggregate === "sum" ? acc.sum : acc.sum / acc.numbers;
  // An overflowing sum is #NUM!, as IronCalc's SUM reports it.
  return Number.isFinite(value)
    ? { type: "number", value }
    : { type: "error", value: "#NUM!" };
}

// A record is a row with a populated cell anywhere across the source width
// (used columns are checked first). A missing formula result counts: the
// record then fails with guidance.
function present(cells, row, rect, used) {
  const filled = (column) => {
    const v = typedValue(cells[at(row, column)]);
    return v === undefined || !isBlank(v);
  };
  if (used.some(filled)) return true;
  for (let column = rect.left; column <= rect.right; column++)
    if (filled(column)) return true;
  return false;
}
// Groups and aggregates the source records. The result is relative to the
// anchor: `cells` holds [row, column, cell] with 0-based offsets. Cells may name
// `formatRef`, a source cell whose number format the output copies (resolved
// against the canonical workbook, see pivotEdits).
export function computePivot(book, pivot) {
  const source = resolveSource(book, pivot),
    { sheet, rect } = source,
    cells = sheet.cells;
  const rowColumns = pivot.rows.map((f) => fieldColumn(source, f)),
    columnColumns = pivot.columns.map((f) => fieldColumn(source, f)),
    filters = pivot.filters.map((f) => ({
      column: fieldColumn(source, f.field),
      keys: new Set(f.values.map(itemKey)),
    })),
    measures = pivot.values.map((m) => ({
      ...m,
      column: fieldColumn(source, m.field),
      formatRef: undefined,
    }));
  const used = [
    ...new Set([
      ...rowColumns,
      ...columnColumns,
      ...filters.map((f) => f.column),
      ...measures.map((m) => m.column),
    ]),
  ];
  const rowTuples = new Map(),
    columnTuples = new Map(),
    groups = new Map(),
    rowTotals = new Map(),
    columnTotals = new Map(),
    grand = measures.map(accumulator);
  let records = 0;
  const tuple = (map, columns, row, limit, what) => {
    const values = [],
      keys = [],
      refs = [];
    for (const column of columns) {
      const ref = at(row, column),
        v = typedValue(cells[ref]);
      if (v === undefined)
        fail(`Source cell ${ref} has no calculated result. Recalculate first.`);
      values.push(v ?? { type: "blank" });
      keys.push(itemKey(v));
      refs.push(ref);
    }
    const key = tupleKey(keys);
    let entry = map.get(key);
    if (!entry) {
      if (map.size >= limit)
        fail(
          `The pivot would have more than ${limit.toLocaleString("en-US")} ${what}.`,
        );
      entry = { key, values, refs };
      map.set(key, entry);
    }
    return entry;
  };
  const group = (map, key) => {
    let accs = map.get(key);
    if (!accs) map.set(key, (accs = measures.map(accumulator)));
    return accs;
  };
  next: for (let row = rect.top + 1; row <= rect.bottom; row++) {
    // Rows with no populated cell across the source width are skipped
    // (pivotFingerprint skips the same rows).
    const populated = present(cells, row, rect, used);
    if (!populated) continue;
    for (const filter of filters) {
      const ref = at(row, filter.column),
        v = typedValue(cells[ref]);
      if (v === undefined)
        fail(`Source cell ${ref} has no calculated result. Recalculate first.`);
      if (!filter.keys.has(itemKey(v))) continue next;
    }
    records++;
    const r = tuple(rowTuples, rowColumns, row, MAX_ROW_ITEMS, "row items"),
      c = tuple(
        columnTuples,
        columnColumns,
        row,
        MAX_COLUMN_ITEMS,
        "column items",
      ),
      cellAccs = group(groups, `${r.key}\u0000${c.key}`),
      rowAccs = group(rowTotals, r.key),
      columnAccs = group(columnTotals, c.key);
    measures.forEach((m, i) => {
      const ref = at(row, m.column),
        v = typedValue(cells[ref]);
      if (v === undefined)
        fail(`Source cell ${ref} has no calculated result. Recalculate first.`);
      if (
        m.formatRef === undefined &&
        v &&
        (v.type === "number" || v.type === "date")
      )
        m.formatRef = ref;
      accumulate(cellAccs[i], v);
      accumulate(rowAccs[i], v);
      accumulate(columnAccs[i], v);
      accumulate(grand[i], v);
    });
  }
  // Without row (or column) fields there is one implicit item: the total.
  const sortedRows = [...rowTuples.values()].sort(compareTuples),
    sortedColumns = [...columnTuples.values()].sort(compareTuples),
    k = pivot.rows.length,
    m = pivot.columns.length,
    v = measures.length;
  if (!k && !sortedRows.length)
    sortedRows.push({ key: tupleKey([]), values: [] });
  if (!m && !sortedColumns.length)
    sortedColumns.push({ key: tupleKey([]), values: [] });
  const labelColumns = Math.max(k, 1),
    blocks = m ? sortedColumns.length + 1 : 1,
    width = labelColumns + blocks * v,
    headerRows = m + 1,
    bodyRows = k ? sortedRows.length : 1,
    height = headerRows + bodyRows + (k ? 1 : 0);
  if (width * height > MAX_OUTPUT_CELLS)
    fail(
      `The pivot would cover ${(width * height).toLocaleString("en-US")} cells; the limit is ${MAX_OUTPUT_CELLS.toLocaleString("en-US")}.`,
    );
  const out = [],
    put = (row, column, cell) => out.push([row, column, cell]),
    text = (value, cellStyle) => ({
      input: { type: "text", value },
      cellStyle,
    }),
    // An item label keeps the format of the item's first source cell.
    label = (value, ref, cellStyle) =>
      isBlank(value)
        ? text("(blank)", cellStyle)
        : { input: value, cellStyle, ...(ref ? { formatRef: ref } : {}) },
    valueCell = (acc, measure, cellStyle) => {
      const value = result(acc, measure.aggregate);
      return {
        input: value,
        ...(cellStyle ? { cellStyle } : {}),
        ...(measure.aggregate !== "count" &&
        value.type === "number" &&
        measure.formatRef
          ? { formatRef: measure.formatRef }
          : {}),
      };
    };
  // Header rows: one per column field, then field names and measure labels.
  for (let i = 0; i < headerRows; i++)
    for (let c = 0; c < labelColumns; c++) {
      const name =
        i < m
          ? c === labelColumns - 1
            ? pivot.columns[i]
            : null
          : k
            ? pivot.rows[c]
            : null;
      put(i, c, name === null ? { cellStyle: "header" } : text(name, "header"));
    }
  sortedColumns.forEach((column, j) =>
    measures.forEach((measure, q) => {
      const c = labelColumns + j * v + q;
      for (let i = 0; i < m; i++)
        put(i, c, label(column.values[i], column.refs[i], "header"));
      put(
        m,
        c,
        text(
          `${AGGREGATE_LABEL[measure.aggregate]} of ${measure.field}`,
          "header",
        ),
      );
    }),
  );
  if (m)
    measures.forEach((measure, q) => {
      const c = labelColumns + sortedColumns.length * v + q;
      put(0, c, text("Total", "header"));
      for (let i = 1; i < m; i++) put(i, c, { cellStyle: "header" });
      put(
        m,
        c,
        text(
          `${AGGREGATE_LABEL[measure.aggregate]} of ${measure.field}`,
          "header",
        ),
      );
    });
  // Body rows; without row fields the single row is the grand total.
  sortedRows.forEach((row, t) => {
    const r = headerRows + t,
      style = k ? undefined : "total";
    if (k)
      for (let i = 0; i < k; i++)
        put(r, i, label(row.values[i], row.refs[i], "rowHeader"));
    else put(r, 0, text("Total", "total"));
    sortedColumns.forEach((column, j) => {
      const accs = k
        ? groups.get(`${row.key}\u0000${column.key}`)
        : m
          ? columnTotals.get(column.key)
          : records
            ? grand
            : null;
      measures.forEach((measure, q) => {
        const c = labelColumns + j * v + q;
        if (accs) put(r, c, valueCell(accs[q], measure, style));
        else if (style) put(r, c, { cellStyle: style });
      });
    });
    if (m)
      measures.forEach((measure, q) => {
        const accs = k ? rowTotals.get(row.key) : records ? grand : null;
        put(
          r,
          labelColumns + sortedColumns.length * v + q,
          accs ? valueCell(accs[q], measure, "total") : { cellStyle: "total" },
        );
      });
  });
  if (k) {
    const r = headerRows + bodyRows;
    put(r, 0, text("Total", "total"));
    for (let c = 1; c < labelColumns; c++) put(r, c, { cellStyle: "total" });
    sortedColumns.forEach((column, j) => {
      const accs = m ? columnTotals.get(column.key) : records ? grand : null;
      measures.forEach((measure, q) =>
        put(
          r,
          labelColumns + j * v + q,
          accs ? valueCell(accs[q], measure, "total") : { cellStyle: "total" },
        ),
      );
    });
    if (m)
      measures.forEach((measure, q) =>
        put(
          r,
          labelColumns + sortedColumns.length * v + q,
          records
            ? valueCell(grand[q], measure, "total")
            : { cellStyle: "total" },
        ),
      );
  }
  return {
    height,
    width,
    cells: out,
    records,
    rowItems: k ? sortedRows.length : 0,
    columnItems: m ? sortedColumns.length : 0,
  };
}

// Field names a definition uses, each once, in name order.
const usedNames = (pivot) =>
  [
    ...new Set([
      ...pivot.rows,
      ...pivot.columns,
      ...pivot.filters.map((f) => f.field),
      ...pivot.values.map((m) => m.field),
    ]),
  ].sort(codeUnits);
// The source revision: the computational definition, how each used field name
// resolves, and the typed values of the used fields in every record. Output
// placement, formats and the source's position on its sheet are excluded, so
// moving rows or columns around the source keeps a pivot current.
export async function pivotFingerprint(book, pivot) {
  const source = resolveSource(book, pivot),
    { rect, sheet } = source,
    names = usedNames(pivot),
    columns = names
      .map((n) => (source.duplicates.has(n) ? undefined : source.labels.get(n)))
      .filter((c) => c !== undefined);
  const parts = [
    jsonStringify(
      {
        format: "pivot/1",
        source: {
          sheetId: pivot.source.sheetId,
          whole: pivot.source.ref === undefined,
        },
        fields: names.map((n) =>
          source.duplicates.has(n)
            ? "duplicate"
            : source.labels.has(n)
              ? "found"
              : "missing",
        ),
        rows: pivot.rows,
        columns: pivot.columns,
        filters: pivot.filters.map((f) => ({
          field: f.field,
          keys: f.values.map(itemKey),
        })),
        values: pivot.values,
      },
      { pretty: false, sortKeys: true },
    ),
  ];
  for (let row = rect.top + 1; row <= rect.bottom; row++) {
    if (!present(sheet.cells, row, rect, columns)) continue;
    const keys = columns.map((column) => {
      const v = typedValue(sheet.cells[at(row, column)]);
      return v === undefined ? "?" : itemKey(v);
    });
    parts.push(keys.map((key) => `${key.length}:${key}`).join(""));
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(parts.join("\n")),
  );
  return [...new Uint8Array(digest)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

// Engine-free check that a definition's source and fields resolve.
// With unresolved header formulas, field names are left to the worker, which
// recalculates first.
export function checkPivot(book, pivot, options) {
  const source = resolveSource(book, pivot, options);
  if (!source.unresolved)
    for (const name of usedNames(pivot)) fieldColumn(source, name);
  return source;
}
// Derived freshness (never saved): current, stale, unverified, never or error.
export async function pivotState(
  book,
  pivot,
  { formulaResultsCurrent = false } = {},
) {
  try {
    const source = resolveSource(book, pivot),
      columns = usedNames(pivot).map((name) => fieldColumn(source, name));
    if (!pivot.refreshed) return { state: "never" };
    if (!formulaResultsCurrent) {
      for (let row = source.rect.top; row <= source.rect.bottom; row++)
        for (const column of columns)
          if (source.sheet.cells[at(row, column)]?.formula)
            return { state: "unverified" };
    }
    return {
      state:
        (await pivotFingerprint(book, pivot)) === pivot.refreshed.fingerprint
          ? "current"
          : "stale",
    };
  } catch (error) {
    return { state: "error", message: error.message };
  }
}

const same = (a, b) =>
  jsonStringify(a ?? null, { pretty: false, sortKeys: true }) ===
  jsonStringify(b ?? null, { pretty: false, sortKeys: true });
// Keeps a cell's direct formatting when the pivot writes over it or clears it.
function keepStyle(existing, cell) {
  if (cell) return existing?.style ? { ...cell, style: existing.style } : cell;
  return existing?.style ? { style: existing.style } : null;
}
// Cell edits that place a computed pivot at its anchor, after checking the
// output range it would own. `previous` is the committed definition (absent
// for a new pivot); its rectangle is released. Returns the edits and the next
// definition, stamped with the source fingerprint.
export function pivotEdits(
  book,
  pivot,
  computed,
  { previous, fingerprint, at: time },
) {
  const anchor = parseRange(pivot.output.ref),
    rect = {
      top: anchor.top,
      left: anchor.left,
      bottom: anchor.top + computed.height - 1,
      right: anchor.left + computed.width - 1,
    };
  if (rect.bottom > ROWS || rect.right > COLUMNS)
    fail("The pivot would extend past the edge of the sheet. Move its output.");
  const sheet = book.sheets.find((s) => s.id === pivot.output.sheetId),
    cells = sheet.cells,
    released =
      previous && previous.output.sheetId === pivot.output.sheetId
        ? parseRange(previous.output.ref)
        : null;
  for (const other of book.pivots ?? []) {
    if (other.id === pivot.id || other.output.sheetId !== pivot.output.sheetId)
      continue;
    if (overlaps(parseRange(other.output.ref), rect))
      fail(
        `The pivot would overlap pivot "${pivotLabel(other)}" (${other.output.ref}). Move one of them.`,
      );
  }
  if (pivot.source.sheetId === pivot.output.sheetId) {
    const source = resolveSource(book, pivot).rect;
    if (overlaps(source, rect))
      fail(`The pivot output ${rangeRef(rect)} would overlap its own source.`);
  }
  const conflicts = [];
  for (let row = rect.top; row <= rect.bottom; row++)
    for (let column = rect.left; column <= rect.right; column++) {
      if (released && inside(released, row, column)) continue;
      const cell = cells[at(row, column)];
      if (cell && (cell.input || cell.formula)) {
        conflicts.push(at(row, column));
        if (conflicts.length > 3) break;
      }
    }
  if (conflicts.length)
    fail(
      `The pivot needs ${rangeRef(rect)} on "${sheet.name}", but ${conflicts.slice(0, 3).join(", ")}${conflicts.length > 3 ? " and other cells" : ""} already hold data. Clear them or move the pivot.`,
    );
  const sourceCells = book.sheets.find(
      (s) => s.id === pivot.source.sheetId,
    ).cells,
    edits = [],
    written = new Map();
  for (const [r, c, generated] of computed.cells) {
    const { formatRef, ...cell } = generated,
      format = formatRef ? sourceCells[formatRef]?.format : undefined;
    written.set(
      at(rect.top + r, rect.left + c),
      format ? { ...cell, format } : cell,
    );
  }
  const change = (sheetId, ref, existing, cell) => {
    const next = keepStyle(existing, cell);
    if (!same(existing, next)) edits.push({ sheetId, ref, cell: next });
  };
  for (let row = rect.top; row <= rect.bottom; row++)
    for (let column = rect.left; column <= rect.right; column++) {
      const ref = at(row, column);
      change(sheet.id, ref, cells[ref], written.get(ref) ?? null);
    }
  if (previous) {
    const old = parseRange(previous.output.ref),
      oldSheet = book.sheets.find((s) => s.id === previous.output.sheetId);
    for (let row = old.top; row <= old.bottom; row++)
      for (let column = old.left; column <= old.right; column++) {
        if (oldSheet.id === sheet.id && inside(rect, row, column)) continue;
        const ref = at(row, column);
        if (oldSheet.cells[ref])
          change(oldSheet.id, ref, oldSheet.cells[ref], null);
      }
  }
  return {
    edits,
    pivot: {
      ...pivot,
      output: { sheetId: pivot.output.sheetId, ref: rangeRef(rect) },
      refreshed: { fingerprint, at: time },
    },
  };
}
// Clears the values a pivot wrote, keeping direct formatting.
export function pivotRemovalEdits(book, pivot) {
  const sheet = book.sheets.find((s) => s.id === pivot.output.sheetId),
    r = parseRange(pivot.output.ref),
    edits = [];
  for (let row = r.top; row <= r.bottom; row++)
    for (let column = r.left; column <= r.right; column++) {
      const ref = at(row, column),
        existing = sheet.cells[ref];
      if (!existing) continue;
      const next = keepStyle(existing, null);
      if (!same(existing, next))
        edits.push({ sheetId: sheet.id, ref, cell: next });
    }
  return edits;
}
// Distinct typed values of one field, sorted, for the filter editor.
export function fieldItems(
  book,
  pivot,
  name,
  { limit = MAX_FILTER_VALUES, formulaResultsCurrent, ...options } = {},
) {
  const source = resolveSource(book, pivot, {
      ...options,
      formulaResultsCurrent,
    }),
    column = fieldColumn(source, name),
    items = new Map();
  let truncated = false;
  for (let row = source.rect.top + 1; row <= source.rect.bottom; row++) {
    const cell = source.sheet.cells[at(row, column)];
    // Unresolved formulas are not blanks: the list is withheld until the
    // results are current.
    if (cell?.formula && (!cell.result || formulaResultsCurrent === false))
      return { items: [], truncated: false, unresolved: true };
    if (truncated) continue;
    const v = typedValue(cell) ?? { type: "blank" },
      key = itemKey(v);
    if (!items.has(key)) {
      if (items.size >= limit) {
        truncated = true;
        continue;
      }
      items.set(key, isBlank(v) ? { type: "blank" } : v);
    }
  }
  return {
    items: [...items.values()].sort(compareItems),
    truncated,
    unresolved: false,
  };
}
