import { jsonStringify } from "../../model/json.mjs";
// Experimental, lossless storage candidates. These are not adopted document formats.
import {
  address,
  parseAddress,
  validateWorkbook,
} from "../../model/workbook.mjs";
export function csvStringify(rows, delimiter = ",") {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const text = String(value);
          return /["\r\n]/.test(text) || text.includes(delimiter)
            ? `"${text.replaceAll('"', '""')}"`
            : text;
        })
        .join(delimiter),
    )
    .join("\n");
}
export function csvParse(text, delimiter = ",") {
  const rows = [];
  let row = [],
    field = "",
    quoted = false,
    closed = false;
  const finish = () => {
    row.push(field);
    field = "";
    closed = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
      continue;
    }
    if (c === delimiter) {
      finish();
      continue;
    }
    if (c === "\r" || c === "\n") {
      finish();
      rows.push(row);
      row = [];
      if (c === "\r" && text[i + 1] === "\n") i++;
      continue;
    }
    if (closed) throw new Error("Unexpected text after closing CSV quote");
    if (c === '"') {
      if (field) throw new Error("Quote inside unquoted CSV field");
      quoted = true;
    } else field += c;
  }
  if (quoted) throw new Error("Unclosed CSV field");
  if (
    row.length ||
    field ||
    closed ||
    !text ||
    !["\n", "\r"].includes(text.at(-1))
  ) {
    finish();
    rows.push(row);
  }
  return rows;
}
export function encodeWorkbook(
  book,
  encoding = "per-cell",
  { minimumDensity = 0.6, maxSlots = 2000000 } = {},
) {
  validateWorkbook(book);
  if (encoding === "per-cell") return book;
  if (!["rows", "columns", "csv", "tsv"].includes(encoding))
    throw new Error("Unknown encoding");
  const next = {
    ...book,
    storageExperiment: { version: 1, encoding },
    sheets: [],
  };
  for (const sheet of book.sheets) {
    const entries = Object.entries(sheet.cells).filter(([, c]) => c.input);
    let height = 0,
      width = 0;
    for (const [ref] of entries) {
      const p = parseAddress(ref);
      height = Math.max(height, p.row);
      width = Math.max(width, p.column);
    }
    if (
      !height ||
      height * width > maxSlots ||
      entries.length / (height * width) < minimumDensity
    ) {
      next.sheets.push(sheet);
      continue;
    }
    const counts = Array.from({ length: width }, () => new Map());
    for (const [ref, cell] of entries) {
      const col = parseAddress(ref).column - 1,
        type = cell.input.type;
      counts[col].set(type, (counts[col].get(type) ?? 0) + 1);
    }
    const columnTypes = counts.map(
      (c) => [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "text",
    );
    const rows = Array.from({ length: height }, () => Array(width).fill(null)),
      overrides = {},
      cellMetadata = {};
    for (const [ref, cell] of entries) {
      const { row, column } = parseAddress(ref),
        { input, ...extra } = cell;
      if (
        input.type === "blank" ||
        input.value === "" ||
        input.type !== columnTypes[column - 1]
      ) {
        overrides[ref] = cell;
        continue;
      }
      rows[row - 1][column - 1] = input.value;
      if (Object.keys(extra).length) cellMetadata[ref] = extra;
    }
    let data = rows;
    if (encoding === "columns")
      data = Array.from({ length: width }, (_, c) => rows.map((row) => row[c]));
    if (encoding === "csv" || encoding === "tsv")
      data = csvStringify(
        rows.map((row) =>
          row.map((v) =>
            v === null ? "" : Object.is(v, -0) ? "-0" : String(v),
          ),
        ),
        encoding === "csv" ? "," : "\t",
      );
    next.sheets.push({
      ...sheet,
      cells: Object.fromEntries(
        Object.entries(sheet.cells).filter(([, c]) => !c.input),
      ),
      table: {
        encoding,
        height,
        width,
        columnTypes,
        data,
        overrides,
        cellMetadata,
      },
    });
  }
  return next;
}
function record(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected storage object");
  if (allowed)
    for (const key of Object.keys(value))
      if (!allowed.includes(key)) throw new Error("Unknown storage field");
}
export function decodeWorkbook(candidate) {
  if (!candidate.storageExperiment)
    return validateWorkbook(structuredClone(candidate));
  record(candidate.storageExperiment, ["version", "encoding"]);
  if (candidate.storageExperiment.version !== 1)
    throw new Error("Unknown experimental version");
  const next = { ...candidate, sheets: [] };
  delete next.storageExperiment;
  for (const sheet of candidate.sheets) {
    if (!sheet.table) {
      next.sheets.push(structuredClone(sheet));
      continue;
    }
    const { table, ...rest } = sheet,
      { height, width, columnTypes, encoding } = table;
    if (
      !Number.isInteger(height) ||
      !Number.isInteger(width) ||
      height < 1 ||
      width < 1 ||
      height * width > 2000000 ||
      columnTypes.length !== width
    )
      throw new Error("Invalid table shape");
    record(table, [
      "encoding",
      "height",
      "width",
      "columnTypes",
      "data",
      "overrides",
      "cellMetadata",
    ]);
    record(table.overrides);
    record(table.cellMetadata);
    if (
      height > 1048576 ||
      width > 16384 ||
      !columnTypes.every((type) =>
        ["number", "text", "date", "boolean", "error", "blank"].includes(type),
      )
    )
      throw new Error("Invalid typed table schema");
    if (
      encoding === "columns" &&
      (!Array.isArray(table.data) ||
        table.data.length !== width ||
        table.data.some((col) => !Array.isArray(col) || col.length !== height))
    )
      throw new Error("Invalid column vectors");
    let rows = table.data;
    if (encoding === "columns")
      rows = Array.from({ length: height }, (_, r) =>
        Array.from({ length: width }, (_, c) => table.data[c]?.[r]),
      );
    else if (encoding === "csv" || encoding === "tsv")
      rows = csvParse(table.data, encoding === "csv" ? "," : "\t");
    else if (encoding !== "rows") throw new Error("Unknown table encoding");
    if (
      rows.length !== height ||
      rows.some((row) => !Array.isArray(row) || row.length !== width)
    )
      throw new Error("Table dimensions do not match schema");
    const cells = structuredClone(rest.cells);
    for (let r = 0; r < height; r++)
      for (let c = 0; c < width; c++) {
        let value = rows[r][c];
        const empty =
          value === null ||
          ((encoding === "csv" || encoding === "tsv") && value === "");
        if (empty) continue;
        const ref = address(r + 1, c + 1),
          type = columnTypes[c];
        if (cells[ref] || table.overrides[ref])
          throw new Error("Multiple sources for one cell");
        if (encoding === "csv" || encoding === "tsv") {
          if (type === "number" || type === "date") {
            if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))
              throw new Error("Invalid numeric CSV field");
            value = Number(value);
          } else if (type === "boolean") {
            if (value !== "true" && value !== "false")
              throw new Error("Invalid Boolean CSV field");
            value = value === "true";
          }
        }
        cells[ref] = { ...table.cellMetadata[ref], input: { type, value } };
      }
    for (const [ref, cell] of Object.entries(table.overrides)) {
      const p = parseAddress(ref);
      if (p.row > height || p.column > width || cells[ref])
        throw new Error("Invalid/conflicting table override");
      if (!cell.input || cell.formula || cell.result)
        throw new Error("Override must contain one typed input");
      cells[ref] = structuredClone(cell);
    }
    for (const [ref, meta] of Object.entries(table.cellMetadata)) {
      parseAddress(ref);
      record(meta, ["cellStyle", "format"]);
      if (!cells[ref]?.input || table.overrides[ref])
        throw new Error("Orphan or duplicate table metadata");
    }
    next.sheets.push({ ...rest, cells });
  }
  return validateWorkbook(next);
}
export const safeJSON = (value) =>
  jsonStringify(value, { pretty: true, compactArrays: true });
