import { jsonStringify } from "./json.mjs";
// Normalized sparse model used by the engine. Physical HTML uses document.mjs.
export const VERSION = "html-data/0.1";
export const ERRORS = [
  "#REF!",
  "#DIV/0!",
  "#VALUE!",
  "#NAME?",
  "#N/A",
  "#NUM!",
  "#ERROR!",
  "#N/IMPL",
  "#NULL!",
  "#SPILL!",
  "#CALC!",
  "#CIRC!",
];
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
export function parseAddress(ref) {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(ref);
  if (!match) fail(`Invalid address: ${ref}`);
  const column = [...match[1]].reduce(
      (n, c) => n * 26 + c.charCodeAt(0) - 64,
      0,
    ),
    row = Number(match[2]);
  if (column > 16384 || row > 1048576) fail(`Address out of bounds: ${ref}`);
  return { row, column };
}
export function address(row, column) {
  let name = "";
  const original = column;
  while (column > 0) {
    name = String.fromCharCode(65 + ((column - 1) % 26)) + name;
    column = Math.floor((column - 1) / 26);
  }
  const result = `${name}${row}`;
  const parsed = parseAddress(result);
  if (parsed.column !== original) fail("Invalid column");
  return result;
}
export function parseRange(ref) {
  if (typeof ref !== "string") fail("Expected range");
  const parts = ref.split(":");
  if (parts.length > 2) fail("Invalid range");
  const first = parseAddress(parts[0]),
    last = parseAddress(parts[1] ?? parts[0]);
  if (first.row > last.row || first.column > last.column)
    fail("Inverted range");
  return {
    top: first.row,
    left: first.column,
    bottom: last.row,
    right: last.column,
  };
}
export function validateValue(value) {
  fields(value, ["type", "value"], "value");
  const { type, value: v } = value;
  if (type === "blank") {
    if ("value" in value) fail("Blank has no value");
    return;
  }
  if (type === "number" || type === "date") {
    if (typeof v !== "number" || !Number.isFinite(v))
      fail("Expected finite number");
    return;
  }
  if (type === "text") {
    if (typeof v !== "string") fail("Expected text");
    return;
  }
  if (type === "boolean") {
    if (typeof v !== "boolean") fail("Expected Boolean");
    return;
  }
  if (type === "error" && ERRORS.includes(v)) return;
  fail(`Invalid typed value: ${type}`);
}
export function validateCell(cell) {
  fields(cell, ["input", "formula", "result", "format", "role"], "cell");
  if (cell.formula !== undefined) {
    if (
      typeof cell.formula !== "string" ||
      !cell.formula.startsWith("=") ||
      cell.formula.length < 2
    )
      fail("Formula requires =");
    if (cell.input !== undefined) fail("Cell cannot contain input and formula");
  }
  if (cell.input !== undefined) validateValue(cell.input);
  if (cell.result !== undefined) {
    if (!cell.formula) fail("Result requires formula");
    validateValue(cell.result);
  }
  if (
    cell.role !== undefined &&
    !["header", "rowHeader", "assumption", "calculation", "normal"].includes(
      cell.role,
    )
  )
    fail("Invalid role");
  if (cell.format !== undefined) {
    fields(cell.format, ["kind", "digits", "currency"], "format");
    if (
      ![
        "general",
        "number",
        "currency",
        "accounting",
        "date",
        "percent",
      ].includes(cell.format.kind)
    )
      fail("Invalid format");
    if (
      cell.format.digits !== undefined &&
      (!Number.isInteger(cell.format.digits) ||
        cell.format.digits < 0 ||
        cell.format.digits > 15)
    )
      fail("Invalid digits");
    if (
      cell.format.currency !== undefined &&
      !/^[A-Z]{3}$/.test(cell.format.currency)
    )
      fail("Invalid currency");
  }
}
function jsonData(value) {
  if (value === null || ["string", "boolean"].includes(typeof value)) return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach(jsonData);
    return;
  }
  if (object(value)) {
    for (const [key, v] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key))
        fail("Reserved key");
      jsonData(v);
    }
    return;
  }
  fail("Non-JSON data");
}
export function validateWorkbook(book) {
  jsonData(book);
  fields(
    book,
    [
      "version",
      "id",
      "title",
      "dateSystem",
      "locale",
      "sheets",
      "groups",
      "names",
      "snapshot",
      "metadata",
    ],
    "workbook",
  );
  if (
    book.version !== VERSION ||
    !id(book.id) ||
    typeof book.title !== "string" ||
    book.dateSystem !== "excel1900" ||
    book.locale !== "en-US"
  )
    fail("Invalid workbook header");
  if (!Array.isArray(book.sheets) || book.sheets.length === 0)
    fail("Expected sheets");
  const ids = new Set(),
    names = new Set();
  for (const sheet of book.sheets) {
    fields(sheet, ["id", "name", "cells", "metadata"], "sheet");
    if (!id(sheet.id) || ids.has(sheet.id)) fail("Duplicate/invalid sheet ID");
    ids.add(sheet.id);
    if (
      typeof sheet.name !== "string" ||
      !sheet.name.trim() ||
      sheet.name.length > 31 ||
      /[\\/*?:\[\]]/.test(sheet.name) ||
      names.has(sheet.name.toLowerCase())
    )
      fail("Duplicate/invalid sheet name");
    names.add(sheet.name.toLowerCase());
    if (!object(sheet.cells)) fail("Expected sparse cells");
    for (const [ref, cell] of Object.entries(sheet.cells)) {
      parseAddress(ref);
      validateCell(cell);
    }
  }
  if (!Array.isArray(book.groups) || !Array.isArray(book.names))
    fail("Expected groups and names");
  const groupIds = new Set(),
    grouped = new Set();
  for (const group of book.groups) {
    fields(group, ["id", "name", "sheetIds"], "group");
    if (
      !id(group.id) ||
      groupIds.has(group.id) ||
      typeof group.name !== "string" ||
      !Array.isArray(group.sheetIds)
    )
      fail("Invalid group");
    groupIds.add(group.id);
    for (const sheetId of group.sheetIds) {
      if (!ids.has(sheetId) || grouped.has(sheetId))
        fail("Invalid grouped sheet");
      grouped.add(sheetId);
    }
  }
  const named = new Set();
  for (const name of book.names) {
    fields(name, ["name", "sheetId", "ref"], "named range");
    if (
      !id(name.name) ||
      named.has(name.name.toLowerCase()) ||
      !ids.has(name.sheetId)
    )
      fail("Invalid named range");
    named.add(name.name.toLowerCase());
    if (name.ref !== "#REF!") parseRange(name.ref);
  }
  if (book.snapshot !== undefined) {
    fields(
      book.snapshot,
      ["engine", "fingerprint", "calculatedAt"],
      "snapshot",
    );
    if (
      typeof book.snapshot.engine !== "string" ||
      !/^[a-f0-9]{64}$/.test(book.snapshot.fingerprint) ||
      !Number.isFinite(Date.parse(book.snapshot.calculatedAt))
    )
      fail("Invalid snapshot");
  }
  return book;
}
export function stringifyWorkbook(book, pretty = true) {
  validateWorkbook(book);
  return jsonStringify(book, { pretty });
}
export const parseWorkbook = (text) => validateWorkbook(JSON.parse(text));
function stable(value) {
  return jsonStringify(value, { pretty: false, sortKeys: true });
}
export async function fingerprint(book) {
  const relevant = {
    dateSystem: book.dateSystem,
    names: book.names,
    sheets: book.sheets.map((s) => ({
      id: s.id,
      name: s.name,
      cells: Object.fromEntries(
        Object.entries(s.cells)
          .filter(([, c]) => c.input || c.formula)
          .map(([ref, c]) => [
            ref,
            c.formula ? { formula: c.formula } : { input: c.input },
          ]),
      ),
    })),
  };
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stable(relevant)),
  );
  return [...new Uint8Array(digest)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export function setCell(book, sheetId, ref, cell) {
  parseAddress(ref);
  validateCell(cell);
  const next = structuredClone(book),
    sheet = next.sheets.find((s) => s.id === sheetId);
  if (!sheet) fail("Unknown sheet ID");
  sheet.cells[ref] = structuredClone(cell);
  return validateWorkbook(next);
}
