import { jsonStringify } from "./json.mjs";
import {
  validateStyle,
  validateSheetLinks,
  checkReferences,
  BUILTIN_CELL_STYLES,
  FONTS,
  THEMES,
  TEXT_COLORS,
  FILLS,
  validateAxes,
} from "./formatting.mjs";
import { validatePivots } from "./pivot.mjs";
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
function supportedLocale(value) {
  if (typeof value !== "string" || value.length > 64) return false;
  try {
    return Intl.NumberFormat.supportedLocalesOf([value]).length === 1;
  } catch {
    return false;
  }
}
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
// Number format presets, shared by cells and cell-style definitions.
export function validateFormat(format) {
  fields(
    format,
    ["kind", "digits", "currency", "dateStyle", "scale", "negative"],
    "format",
  );
  if (
    ![
      "general",
      "number",
      "currency",
      "accounting",
      "date",
      "percent",
    ].includes(format.kind)
  )
    fail("Invalid format");
  if (
    format.digits !== undefined &&
    (!Number.isInteger(format.digits) ||
      format.digits < 0 ||
      format.digits > 15)
  )
    fail("Invalid digits");
  if (format.currency !== undefined && !/^[A-Z]{3}$/.test(format.currency))
    fail("Invalid currency");
  const { kind, dateStyle, scale, negative } = format;
  if (
    dateStyle !== undefined &&
    (kind !== "date" || !["short", "long"].includes(dateStyle))
  )
    fail("Invalid date format style");
  if (
    scale !== undefined &&
    (!["number", "currency", "accounting"].includes(kind) ||
      !["thousands", "millions"].includes(scale))
  )
    fail("Invalid format scale");
  if (
    negative !== undefined &&
    (!["number", "currency", "accounting", "percent"].includes(kind) ||
      !["minus", "parentheses", "red", "redParentheses"].includes(negative))
  )
    fail("Invalid negative number format");
}
// With a workbook, also checks the cell's catalogue and sheet references.
export function validateCell(cell, book) {
  fields(
    cell,
    ["input", "formula", "result", "format", "cellStyle", "style"],
    "cell",
  );
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
  // Catalogue membership (built-in or custom) is checked by validateWorkbook.
  if (cell.cellStyle !== undefined && !id(cell.cellStyle))
    fail("Invalid cell style");
  if (cell.style !== undefined) validateStyle(cell.style);
  if (cell.format !== undefined) validateFormat(cell.format);
  if (book) checkReferences(book, cell);
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
export const MAX_VALIDATIONS = 1000;
export const MAX_DROPDOWN_VALUES = 1000;
// Metadata-only validation is also used by editor commands, avoiding a whole-table
// validation scan when the command only replaces dropdown definitions.
export function validateValidations(book) {
  const rules = book.validations === undefined ? [] : book.validations;
  if (!Array.isArray(rules) || rules.length > MAX_VALIDATIONS)
    fail("Expected at most 1,000 validation definitions");
  const ids = new Set(),
    targets = [],
    sheetIds = new Set(book.sheets.map((s) => s.id));
  for (const rule of rules) {
    fields(rule, ["id", "sheetId", "ref", "source"], "validation");
    if (!id(rule.id) || ids.has(rule.id) || !sheetIds.has(rule.sheetId))
      fail("Duplicate/invalid validation ID or sheet");
    ids.add(rule.id);
    if (rule.ref !== "#REF!") {
      const rect = parseRange(rule.ref);
      for (const previous of targets)
        if (
          previous.sheetId === rule.sheetId &&
          rect.top <= previous.bottom &&
          rect.bottom >= previous.top &&
          rect.left <= previous.right &&
          rect.right >= previous.left
        )
          fail("Validation target ranges cannot overlap");
      targets.push({ ...rect, sheetId: rule.sheetId });
    }
    const source = rule.source;
    if (source?.kind === "list") {
      fields(source, ["kind", "values"], "validation list");
      if (
        !Array.isArray(source.values) ||
        !source.values.length ||
        source.values.length > MAX_DROPDOWN_VALUES
      )
        fail("Validation lists require 1–1,000 typed choices");
      for (const value of source.values) {
        validateValue(value);
        if (value.type === "error") fail("Validation choices cannot be errors");
      }
    } else if (source?.kind === "range") {
      fields(source, ["kind", "sheetId", "ref"], "validation source");
      if (!sheetIds.has(source.sheetId))
        fail("Invalid validation source sheet");
      if (source.ref !== "#REF!") parseRange(source.ref);
    } else fail("Invalid validation source kind");
  }
  if (book.scenario !== undefined) {
    fields(book.scenario, ["validationId"], "scenario");
    const rule = rules.find((r) => r.id === book.scenario.validationId);
    if (!rule) fail("Scenario requires an existing validation ID");
    if (rule.ref !== "#REF!") {
      const target = parseRange(rule.ref);
      if (target.top !== target.bottom || target.left !== target.right)
        fail("Scenario selector must be one cell");
      const sheet = book.sheets.find((s) => s.id === rule.sheetId);
      if (sheet.cells[address(target.top, target.left)]?.formula)
        fail("Scenario selector must be an input cell");
    }
  }
}
export const MAX_CONDITIONAL_FORMATS = 100;
export function validateConditionalFormats(book) {
  const rules =
    book.conditionalFormats === undefined ? [] : book.conditionalFormats;
  if (!Array.isArray(rules) || rules.length > MAX_CONDITIONAL_FORMATS)
    fail("Invalid conditional format count");
  const seen = new Set();
  for (const rule of rules) {
    fields(
      rule,
      [
        "id",
        "sheetId",
        "ref",
        "kind",
        ...(rule?.kind === "highlight"
          ? ["condition", "style"]
          : ["scale", "positive", "negative"]),
      ],
      "conditional format",
    );
    if (
      !id(rule.id) ||
      seen.has(rule.id) ||
      !book.sheets.some((s) => s.id === rule.sheetId)
    )
      fail("Invalid conditional format identity");
    seen.add(rule.id);
    if (rule.ref !== "#REF!") parseRange(rule.ref);
    if (rule.kind === "highlight") {
      fields(rule.condition, ["operator", "values"], "highlight condition");
      const { operator, values } = rule.condition;
      if (!Array.isArray(values)) fail("Expected typed condition values");
      for (const value of values) validateValue(value);
      const count = ["isBlank", "isError"].includes(operator)
        ? 0
        : ["between", "notBetween"].includes(operator)
          ? 2
          : ["eq", "ne", "gt", "gte", "lt", "lte", "contains"].includes(
                operator,
              )
            ? 1
            : -1;
      if (values.length !== count)
        fail("Invalid highlight operator/value count");
      if (
        ["gt", "gte", "lt", "lte", "between", "notBetween"].includes(operator)
      ) {
        if (
          !values.every(
            (v) =>
              ["number", "date"].includes(v.type) && v.type === values[0].type,
          )
        )
          fail("Ordered conditions need one numeric/date type");
        if (count === 2 && values[0].value > values[1].value)
          fail("Inverted condition bounds");
      }
      if (operator === "contains" && values[0].type !== "text")
        fail("Contains requires text");
      // Charte tokens only (ADR-012), so highlights follow the theme.
      fields(
        rule.style,
        ["fill", "color", "bold", "italic"],
        "highlight style",
      );
      if (
        !Object.keys(rule.style).length ||
        (Object.hasOwn(rule.style, "fill") &&
          !FILLS.includes(rule.style.fill)) ||
        (Object.hasOwn(rule.style, "color") &&
          !TEXT_COLORS.includes(rule.style.color)) ||
        ["bold", "italic"].some(
          (key) =>
            Object.hasOwn(rule.style, key) &&
            typeof rule.style[key] !== "boolean",
        )
      )
        fail("Invalid highlight style");
    } else if (rule.kind === "dataBar") {
      fields(
        rule.scale,
        rule.scale?.kind === "auto" ? ["kind"] : ["kind", "min", "max"],
        "data bar scale",
      );
      if (
        rule.scale.kind !== "auto" &&
        (rule.scale.kind !== "fixed" ||
          !Number.isFinite(rule.scale.min) ||
          !Number.isFinite(rule.scale.max) ||
          rule.scale.min > 0 ||
          rule.scale.max < 0 ||
          rule.scale.min >= rule.scale.max)
      )
        fail("Invalid data bar scale; fixed bounds must include zero");
      if (
        !TEXT_COLORS.includes(rule.positive) ||
        !TEXT_COLORS.includes(rule.negative)
      )
        fail("Invalid data bar colour token");
    } else fail("Invalid conditional format kind");
  }
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
      "validations",
      "scenario",
      "conditionalFormats",
      "pivots",
      "font",
      "theme",
    ],
    "workbook",
  );
  if (
    book.version !== VERSION ||
    !id(book.id) ||
    typeof book.title !== "string" ||
    book.dateSystem !== "excel1900" ||
    !supportedLocale(book.locale)
  )
    fail("Invalid workbook header");
  if (!Array.isArray(book.sheets) || book.sheets.length === 0)
    fail("Expected sheets");
  const ids = new Set(),
    names = new Set();
  // Single pass over cells: the style catalogue and sheet IDs are known first.
  if (
    book.font !== undefined &&
    (typeof book.font !== "string" || !Object.hasOwn(FONTS, book.font))
  )
    fail(`Invalid document font: use one of ${Object.keys(FONTS).join(", ")}`);
  if (
    book.theme !== undefined &&
    (typeof book.theme !== "string" || !THEMES.includes(book.theme))
  )
    fail(`Invalid theme: use one of ${THEMES.join(", ")}`);
  const cellStyles = new Set(BUILTIN_CELL_STYLES),
    sheetIds = new Set(book.sheets.map((s) => s?.id));
  for (const sheet of book.sheets) {
    fields(
      sheet,
      ["id", "name", "cells", "metadata", "rows", "columns", "links"],
      "sheet",
    );
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
      if (cell.cellStyle !== undefined && !cellStyles.has(cell.cellStyle))
        fail(`Unknown cell style: ${cell.cellStyle}`);
    }
    validateAxes(sheet);
    validateSheetLinks(sheet, sheetIds);
  }
  if (!Array.isArray(book.groups) || !Array.isArray(book.names))
    fail("Expected groups and names");
  const groupIds = new Set(),
    grouped = new Set();
  for (const group of book.groups) {
    fields(group, ["id", "name", "sheetIds", "kind", "collapsed"], "group");
    if (
      !id(group.id) ||
      groupIds.has(group.id) ||
      typeof group.name !== "string" ||
      !Array.isArray(group.sheetIds)
    )
      fail("Invalid group");
    if (
      group.kind !== undefined &&
      !["summary", "inputs", "raw", "calculations"].includes(group.kind)
    )
      fail("Invalid group kind");
    if (group.collapsed !== undefined && typeof group.collapsed !== "boolean")
      fail("Invalid collapsed state");
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
  validateValidations(book);
  validateConditionalFormats(book);
  validatePivots(book);
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
