// Physical HTML document format; the validated sparse engine model is derived.
import {
  VERSION,
  validateWorkbook,
  parseAddress,
  address,
} from "./workbook.mjs";
import { jsonStringify } from "./json.mjs";
export const DOCUMENT_VERSION = "html-data/0.2";
const MAX_SLOTS = 2000000;
const types = ["number", "text", "date", "boolean", "error", "blank"];
const record = (value, allowed) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected storage object");
  if (allowed && Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error("Unknown storage field");
};

export function writeModel(book, { pretty = true } = {}) {
  validateWorkbook(book);
  const document = { ...book, version: DOCUMENT_VERSION, sheets: [] };
  for (const sheet of book.sheets) {
    if (sheet.metadata?.layout !== "table") {
      document.sheets.push(sheet);
      continue;
    }
    const inputs = Object.entries(sheet.cells).filter(([, c]) => c.input);
    let height = 0,
      width = 0;
    for (const [ref] of inputs) {
      const p = parseAddress(ref);
      height = Math.max(height, p.row);
      width = Math.max(width, p.column);
    }
    // Explicit table intent plus bounded density avoids expanding freeform sheets.
    if (
      !height ||
      height * width > MAX_SLOTS ||
      inputs.length / (height * width) < 0.6
    ) {
      document.sheets.push(sheet);
      continue;
    }
    const counts = Array.from({ length: width }, () => new Map());
    for (const [ref, { input }] of inputs) {
      const column = parseAddress(ref).column - 1;
      counts[column].set(input.type, (counts[column].get(input.type) ?? 0) + 1);
    }
    const columnTypes = counts.map(
      (c) => [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "text",
    );
    const table = {
      encoding: "rows",
      height,
      width,
      columnTypes,
      data: Array.from({ length: height }, () => Array(width).fill(null)),
      overrides: {},
      cellMetadata: {},
    };
    for (const [ref, cell] of inputs) {
      const { row, column } = parseAddress(ref),
        { input, ...metadata } = cell;
      if (input.type === "blank" || input.type !== columnTypes[column - 1]) {
        table.overrides[ref] = cell;
      } else {
        table.data[row - 1][column - 1] = input.value;
        if (Object.keys(metadata).length) table.cellMetadata[ref] = metadata;
      }
    }
    document.sheets.push({
      ...sheet,
      cells: Object.fromEntries(
        Object.entries(sheet.cells).filter(([, c]) => !c.input),
      ),
      table,
    });
  }
  return jsonStringify(document, { pretty, compactArrays: true });
}

export function readModel(text) {
  const document = JSON.parse(text);
  if (document.version === VERSION) return validateWorkbook(document);
  if (document.version !== DOCUMENT_VERSION || !Array.isArray(document.sheets))
    throw new Error("Unknown document version");
  const book = { ...document, version: VERSION, sheets: [] };
  for (const sheet of document.sheets) {
    if (!Object.hasOwn(sheet, "table")) {
      book.sheets.push(sheet);
      continue;
    }
    const { table, ...rest } = sheet;
    record(table, [
      "encoding",
      "height",
      "width",
      "columnTypes",
      "data",
      "overrides",
      "cellMetadata",
    ]);
    const { height, width, columnTypes, data, overrides, cellMetadata } = table;
    if (
      table.encoding !== "rows" ||
      !Number.isInteger(height) ||
      !Number.isInteger(width) ||
      height < 1 ||
      height > 1048576 ||
      width < 1 ||
      width > 16384 ||
      height * width > MAX_SLOTS ||
      !Array.isArray(columnTypes) ||
      columnTypes.length !== width ||
      !columnTypes.every((t) => types.includes(t)) ||
      !Array.isArray(data) ||
      data.length !== height ||
      data.some((row) => !Array.isArray(row) || row.length !== width)
    )
      throw new Error("Invalid row table shape or schema");
    record(overrides);
    record(cellMetadata);
    record(rest.cells);
    const cells = { ...rest.cells };
    for (const [ref, cell] of Object.entries(cells)) {
      const p = parseAddress(ref);
      if (p.row <= height && p.column <= width && cell.input)
        throw new Error("Table inputs must be in data or overrides");
    }
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const value = data[r][c];
        if (value === null) continue;
        const ref = address(r + 1, c + 1);
        if (Object.hasOwn(cells, ref) || Object.hasOwn(overrides, ref))
          throw new Error("Multiple sources for one cell");
        cells[ref] = {
          ...cellMetadata[ref],
          input: { type: columnTypes[c], value },
        };
      }
    }
    for (const [ref, cell] of Object.entries(overrides)) {
      const p = parseAddress(ref);
      if (
        p.row > height ||
        p.column > width ||
        Object.hasOwn(cells, ref) ||
        !cell?.input ||
        cell.formula !== undefined ||
        cell.result !== undefined
      )
        throw new Error("Invalid/conflicting typed override");
      cells[ref] = cell;
    }
    for (const [ref, metadata] of Object.entries(cellMetadata)) {
      parseAddress(ref);
      record(metadata, ["role", "format"]);
      if (!cells[ref]?.input || Object.hasOwn(overrides, ref))
        throw new Error("Orphan or duplicate table metadata");
    }
    book.sheets.push({ ...rest, cells });
  }
  return validateWorkbook(book);
}
