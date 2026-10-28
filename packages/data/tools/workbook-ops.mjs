// Range tooling on the canonical workbook (T20): inspect, validated patches,
// error reports an LLM can act on, and the preservation check that proves an
// edit changed only what it was asked to change. Engine-free; recalculation
// lives in engine-node.mjs.
import {
  address,
  parseAddress,
  parseRange,
  validateCell,
  validateWorkbook,
  VERSION,
} from "../model/workbook.mjs";
import { DOCUMENT_VERSION } from "../model/document.mjs";
import { ownerRects, pivotOwner, pivotLabel } from "../model/pivot.mjs";
import { assertScenarioInputs } from "../model/validation.mjs";
import { snapshotState } from "../model/snapshots.mjs";
import { display } from "../runtime/view.mjs";
import { jsonStringify } from "../model/json.mjs";

export const MAX_INSPECT_CELLS = 5000,
  MAX_PATCH_CELLS = 2000000;
// Workbook fields a patch may replace as a whole ("set").
export const SETTABLE = [
  "validations",
  "scenario",
  "conditionalFormats",
  "pivots",
  "charts",
  "names",
  "groups",
  "locale",
  "theme",
  "font",
  "metadata",
];
const PRESENTATION = ["cellStyle", "format", "style"];

// A sheet by stable ID or by name.
export function findSheet(book, key) {
  return (
    book.sheets.find((s) => s.id === key) ??
    book.sheets.find((s) => s.name === key) ??
    null
  );
}

// "Sheet!A1:B2", "A1:B2" (with a default sheet) or "A1".
export function parseTarget(book, text, sheetKey) {
  let ref = String(text ?? ""),
    key = sheetKey;
  const bang = ref.lastIndexOf("!");
  if (bang >= 0) {
    key = ref
      .slice(0, bang)
      .replace(/^'(.*)'$/, "$1")
      .replace(/''/g, "'");
    ref = ref.slice(bang + 1);
  }
  const sheet = key === undefined ? book.sheets[0] : findSheet(book, key);
  if (!sheet) throw new Error(`Unknown sheet "${key}".`);
  const range = ref.includes(":") ? parseRange(ref) : null,
    point = range ? null : parseAddress(ref),
    rect = range ?? {
      top: point.row,
      left: point.column,
      bottom: point.row,
      right: point.column,
    };
  return { sheet, rect };
}

const used = (sheet) => {
  let rows = 0,
    columns = 0,
    formulas = 0,
    inputs = 0;
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    const p = parseAddress(ref);
    rows = Math.max(rows, p.row);
    columns = Math.max(columns, p.column);
    if (cell.formula) formulas++;
    else if (cell.input) inputs++;
  }
  return { rows, columns, formulas, inputs };
};

// What the workbook holds, without its cells.
export async function summary(book) {
  const state = await snapshotState(book);
  return {
    id: book.id,
    title: book.title,
    locale: book.locale,
    results: state.state,
    missingResults: state.missing.length,
    sheets: book.sheets.map((sheet) => {
      const u = used(sheet);
      return {
        id: sheet.id,
        name: sheet.name,
        range: u.rows ? `A1:${address(u.rows, u.columns)}` : null,
        inputs: u.inputs,
        formulas: u.formulas,
        ...(sheet.metadata?.layout ? { layout: sheet.metadata.layout } : {}),
      };
    }),
    groups: (book.groups ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      sheetIds: g.sheetIds,
    })),
    names: book.names ?? [],
    dropdowns: book.validations?.length ?? 0,
    scenario: book.scenario ?? null,
    conditionalFormats: book.conditionalFormats?.length ?? 0,
    pivots: (book.pivots ?? []).map((p) => ({
      id: p.id,
      name: pivotLabel(p),
      output: p.output,
      refreshed: !!p.refreshed,
    })),
    charts: (book.charts ?? []).map((c) => ({
      id: c.id,
      type: c.type,
      sheetId: c.sheetId,
      anchor: c.anchor,
      source: c.source,
      preview: !!c.preview,
    })),
  };
}

// The cells of a rectangle: stored record and displayed text, empty cells
// left out.
export function inspectRange(book, target, sheetKey) {
  const { sheet, rect } = parseTarget(book, target, sheetKey),
    count = (rect.bottom - rect.top + 1) * (rect.right - rect.left + 1);
  if (count > MAX_INSPECT_CELLS)
    throw new Error(
      `Inspect at most ${MAX_INSPECT_CELLS} cells per call (${count} requested). Inspect a smaller range.`,
    );
  const cells = [];
  for (let row = rect.top; row <= rect.bottom; row++)
    for (let col = rect.left; col <= rect.right; col++) {
      const ref = address(row, col),
        cell = sheet.cells[ref];
      if (cell) cells.push({ ref, cell, shown: display(cell, book.locale) });
    }
  return {
    sheetId: sheet.id,
    sheet: sheet.name,
    range: `${address(rect.top, rect.left)}:${address(rect.bottom, rect.right)}`,
    cells,
  };
}

// Typed input from a JSON scalar in a "rows" block.
function scalar(value, where) {
  if (value === null) return null;
  if (typeof value === "number") return { input: { type: "number", value } };
  if (typeof value === "boolean") return { input: { type: "boolean", value } };
  if (typeof value === "string") return { input: { type: "text", value } };
  throw new Error(
    `${where}: rows hold JSON numbers, strings, booleans or null; write a typed cell in "edits" for dates, errors or formulas.`,
  );
}

const isObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);

// Applies a patch to a copy of the workbook. Every problem is reported, each
// with where it is ("edits[2] Inputs!B4: …"), so a corrected patch can be
// written in one pass. Returns {book, errors, touched}.
//
//   {"edits": [{"sheet": id|name, "ref": "B2", "cell": {...} | null}],
//    "rows":  [{"sheet": id|name, "at": "A2", "values": [[...], ...]}],
//    "set":   {"validations": [...], ...}}
//
// A cell edit replaces the value (input or formula); presentation fields it
// leaves out (cellStyle, format, style) are kept, and null removes one.
// `result` is never written by a patch: recalculation computes it.
export function applyPatch(book, patch) {
  const errors = [],
    next = structuredClone(book),
    touched = new Map();
  if (!isObject(patch)) return { errors: ["The patch must be a JSON object."] };
  for (const key of Object.keys(patch))
    if (!["edits", "rows", "set"].includes(key))
      errors.push(`Unknown patch field "${key}": use edits, rows or set.`);
  const edits = [],
    list = (key) => {
      if (patch[key] === undefined) return [];
      if (Array.isArray(patch[key])) return patch[key];
      errors.push(`"${key}" must be an array.`);
      return [];
    };
  list("edits").forEach((edit, i) => {
    const where = `edits[${i}]`;
    if (!isObject(edit))
      return errors.push(`${where}: expected {"sheet","ref","cell"}.`);
    const extra = Object.keys(edit).filter(
      (k) => !["sheet", "ref", "cell"].includes(k),
    );
    if (extra.length)
      return errors.push(`${where}: unknown field ${extra.join(", ")}.`);
    if (!("cell" in edit))
      return errors.push(
        `${where}: give "cell" (an object, or null to delete).`,
      );
    edits.push({ where, ...edit });
  });
  list("rows").forEach((block, i) => {
    const where = `rows[${i}]`;
    if (!isObject(block) || !Array.isArray(block.values))
      return errors.push(`${where}: expected {"sheet","at","values":[[...]]}.`);
    let at;
    try {
      at = parseAddress(block.at);
    } catch (error) {
      return errors.push(`${where}: ${error.message}`);
    }
    block.values.forEach((line, r) => {
      if (!Array.isArray(line))
        return errors.push(`${where}.values[${r}]: expected an array.`);
      line.forEach((value, c) => {
        // null leaves the cell as it is.
        if (value === null) return;
        try {
          edits.push({
            where: `${where}.values[${r}][${c}]`,
            sheet: block.sheet,
            ref: address(at.row + r, at.column + c),
            cell: scalar(value, `${where}.values[${r}][${c}]`),
          });
        } catch (error) {
          errors.push(error.message);
        }
      });
    });
  });
  if (edits.length > MAX_PATCH_CELLS)
    return {
      errors: [
        `The patch writes ${edits.length} cells; the limit is ${MAX_PATCH_CELLS}.`,
      ],
    };
  const rects = book.pivots?.length ? ownerRects(book) : null,
    engineEdits = [];
  for (const edit of edits) {
    const sheet = findSheet(next, edit.sheet);
    if (!sheet) {
      errors.push(`${edit.where}: unknown sheet "${edit.sheet}".`);
      continue;
    }
    let ref;
    try {
      ref = address(parseAddress(edit.ref).row, parseAddress(edit.ref).column);
    } catch (error) {
      errors.push(`${edit.where}: ${error.message}`);
      continue;
    }
    const at = `${edit.where} ${sheet.name}!${ref}`;
    if (edit.cell !== null && !isObject(edit.cell)) {
      errors.push(`${at}: "cell" must be an object or null.`);
      continue;
    }
    const owner = rects && pivotOwner(rects, sheet.id, ref);
    if (owner) {
      errors.push(
        `${at}: belongs to pivot table "${pivotLabel(owner)}"; change its definition and refresh instead.`,
      );
      continue;
    }
    if (edit.cell && Object.hasOwn(edit.cell, "result")) {
      errors.push(`${at}: do not write "result"; recalculation computes it.`);
      continue;
    }
    const existing = sheet.cells[ref];
    let cell = null;
    if (edit.cell) {
      cell = {};
      for (const key of PRESENTATION)
        if (existing?.[key] !== undefined) cell[key] = existing[key];
      for (const [key, value] of Object.entries(edit.cell))
        if (value === null && PRESENTATION.includes(key)) delete cell[key];
        else cell[key] = value;
      // Presentation-only edits keep the value, and its saved result.
      if (!("input" in edit.cell) && !("formula" in edit.cell)) {
        if (existing?.input) cell.input = existing.input;
        if (existing?.formula) cell.formula = existing.formula;
      }
      if (cell.formula && cell.formula === existing?.formula && existing.result)
        cell.result = existing.result;
      try {
        validateCell(cell, next);
      } catch (error) {
        errors.push(`${at}: ${error.message}`);
        continue;
      }
    }
    if (cell) sheet.cells[ref] = cell;
    else delete sheet.cells[ref];
    touched.set(`${sheet.id}!${ref}`, true);
    engineEdits.push({ sheetId: sheet.id, ref, cell });
  }
  if (patch.set !== undefined) {
    if (!isObject(patch.set)) errors.push('"set" must be an object.');
    else
      for (const [key, value] of Object.entries(patch.set)) {
        if (!SETTABLE.includes(key)) {
          errors.push(
            `set.${key}: not settable by a patch (allowed: ${SETTABLE.join(", ")}).`,
          );
          continue;
        }
        if (value === null) delete next[key];
        else next[key] = structuredClone(value);
      }
  }
  // Against the final scenario, after set.
  try {
    assertScenarioInputs(next, engineEdits);
  } catch (error) {
    errors.push(
      `scenario: ${error.message}; write the choice as a typed input.`,
    );
  }
  if (!errors.length)
    try {
      validateWorkbook(next);
    } catch (error) {
      errors.push(`workbook: ${error.message}`);
    }
  return errors.length ? { errors } : { book: next, errors, touched };
}

// Key order does not matter; signed zero does.
const canonical = (value) =>
  value === undefined
    ? "undefined"
    : jsonStringify(value, { pretty: false, sortKeys: true });
const same = (a, b) => canonical(a) === canonical(b);
const withoutResult = (cell) => {
  if (!cell) return null;
  const { result: _, ...rest } = cell;
  return rest;
};

// Derived caches inside definitions: chart previews, and the stamp and
// output extent a pivot refresh writes (its anchor cell is not a cache).
function withoutCaches(key, value) {
  if (!Array.isArray(value)) return value;
  if (key === "charts") return value.map(({ preview: _, ...chart }) => chart);
  if (key === "pivots")
    return value.map(({ refreshed: _, output, ...pivot }) => ({
      ...pivot,
      output: output && {
        sheetId: output.sheetId,
        anchor: String(output.ref).split(":")[0],
      },
    }));
  return value;
}

// What changed between two workbooks outside the allowed cells: every
// changed cell (results aside), sheet and workbook field. `allow` is a list
// of {sheetId, rect}; `fields` the workbook fields a patch replaced. Caches
// may change: results, chart previews, pivot stamps, and the cells a pivot
// owns before or after (a refresh rewrites, grows or shrinks its output).
export function preservation(before, after, { allow = [], fields = [] } = {}) {
  const problems = [],
    allowed = (sheetId, ref) => {
      const p = parseAddress(ref);
      return allow.some(
        (a) =>
          a.sheetId === sheetId &&
          p.row >= a.rect.top &&
          p.row <= a.rect.bottom &&
          p.column >= a.rect.left &&
          p.column <= a.rect.right,
      );
    };
  const ids = (book) => book.sheets.map((s) => `${s.id}:${s.name}`).join(",");
  if (ids(before) !== ids(after))
    problems.push(
      `Sheets changed: ${ids(before)} became ${ids(after)} (IDs, names and order must be kept).`,
    );
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (["sheets", "snapshot", "version"].includes(key) || fields.includes(key))
      continue;
    if (!same(withoutCaches(key, before[key]), withoutCaches(key, after[key])))
      problems.push(`Workbook field "${key}" changed.`);
  }
  const owned = [before, after]
      .filter((book) => book.pivots?.length)
      .map((book) => ownerRects(book)),
    pivotCell = (sheetId, ref) =>
      owned.some((rects) => pivotOwner(rects, sheetId, ref));
  for (const sheet of before.sheets) {
    const other = after.sheets.find((s) => s.id === sheet.id);
    if (!other) continue;
    for (const key of new Set([...Object.keys(sheet), ...Object.keys(other)]))
      if (key !== "cells" && !same(sheet[key], other[key]))
        problems.push(`Sheet "${sheet.name}": field "${key}" changed.`);
    const refs = new Set([
      ...Object.keys(sheet.cells),
      ...Object.keys(other.cells),
    ]);
    let listed = 0,
      more = 0;
    for (const ref of refs) {
      if (
        same(withoutResult(sheet.cells[ref]), withoutResult(other.cells[ref]))
      )
        continue;
      if (allowed(sheet.id, ref) || pivotCell(sheet.id, ref)) continue;
      if (listed < 20) {
        problems.push(`${sheet.name}!${ref} changed without being requested.`);
        listed++;
      } else more++;
    }
    if (more)
      problems.push(`${sheet.name}: ${more} more unrequested cell changes.`);
  }
  return problems;
}

// A stored html-data/0.2 document with its row tables spread into cells,
// without validating, so each bad table value is reported at its address.
function spread(document) {
  if (document?.version !== DOCUMENT_VERSION) return document;
  const book = { ...document, version: VERSION, sheets: [] };
  for (const sheet of Array.isArray(document.sheets) ? document.sheets : []) {
    if (!sheet?.table) {
      book.sheets.push(sheet);
      continue;
    }
    const { table, ...rest } = sheet,
      cells = { ...(rest.cells ?? {}) };
    (Array.isArray(table.data) ? table.data : []).forEach((row, r) =>
      (Array.isArray(row) ? row : []).forEach((value, c) => {
        if (value === null) return;
        try {
          const ref = address(r + 1, c + 1);
          cells[ref] = {
            input: { type: table.columnTypes?.[c], value },
            ...(table.cellMetadata?.[ref] ?? {}),
          };
        } catch {
          // Outside the grid: the codec's own error reports it.
        }
      }),
    );
    Object.assign(cells, table.overrides ?? {});
    book.sheets.push({ ...rest, cells });
  }
  return book;
}

// Every invalid cell of a workbook that fails validation, with its address,
// then the workbook-level error: validation itself stops at the first one.
// Accepts the stored document (html-data/0.2) or the sparse model.
export function locateErrors(document) {
  const book = spread(document),
    errors = [];
  for (const sheet of book.sheets ?? [])
    for (const [ref, cell] of Object.entries(sheet.cells ?? {}))
      try {
        parseAddress(ref);
        validateCell(cell, book);
      } catch (error) {
        errors.push(`${sheet.name ?? sheet.id}!${ref}: ${error.message}`);
        if (errors.length >= 50) return errors;
      }
  try {
    validateWorkbook(structuredClone(book));
  } catch (error) {
    if (!errors.some((e) => e.endsWith(error.message)))
      errors.push(`workbook: ${error.message}`);
  }
  return errors;
}
