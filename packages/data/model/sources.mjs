// Imported sources (T15): where a range of the workbook came from, kept in
// the file so it never needs the original path. The values themselves live
// in ordinary cells; a source only describes them (FORMAT.md › Sources).
import { parseRange } from "./workbook.mjs";

export const MAX_SOURCES = 100;
const fail = (message) => {
  throw new Error(`Invalid source: ${message}`);
};
const object = (v) =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
function fields(value, allowed, where) {
  if (!object(value)) fail(`${where} must be an object`);
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) fail(`${where} has unknown field ${key}`);
}
const id = (v) => typeof v === "string" && /^[a-zA-Z][\w-]{0,79}$/.test(v);
const iso = (v) =>
  typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v));
const hex64 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const CSV_OPTIONS = {
  encoding: (v) =>
    [
      "utf-8",
      "windows-1252",
      "macintosh",
      "iso-8859-15",
      "utf-16le",
      "utf-16be",
    ].includes(v),
  delimiter: (v) => [",", ";", "\t", "|"].includes(v),
  header: (v) => typeof v === "boolean",
  decimal: (v) => ["point", "comma"].includes(v),
  dates: (v) => ["dmy", "mdy"].includes(v),
};
// An XLSX source is one worksheet of the file, by its name there.
const XLSX_OPTIONS = {
  sheet: (v) => typeof v === "string" && v.length >= 1 && v.length <= 31,
  header: (v) => typeof v === "boolean",
};
const OPTIONS = { csv: CSV_OPTIONS, xlsx: XLSX_OPTIONS };
const TYPES = ["auto", "text", "number", "date", "boolean"];
export function validateSources(book) {
  const sources = book.sources;
  if (sources === undefined) return;
  if (!Array.isArray(sources) || sources.length > MAX_SOURCES)
    fail(`expected at most ${MAX_SOURCES} sources`);
  const ids = new Set(),
    sheets = new Set(book.sheets.map((s) => s.id));
  for (const source of sources) {
    fields(
      source,
      [
        "id",
        "sheetId",
        "ref",
        "kind",
        "file",
        "importedAt",
        "options",
        "columns",
      ],
      "source",
    );
    if (!id(source.id) || ids.has(source.id)) fail("duplicate or invalid ID");
    ids.add(source.id);
    if (!sheets.has(source.sheetId)) fail(`unknown sheet ${source.sheetId}`);
    if (source.ref !== "#REF!") parseRange(source.ref);
    const options = Object.hasOwn(OPTIONS, source.kind)
      ? OPTIONS[source.kind]
      : fail(`unsupported kind ${source.kind}`);
    fields(source.file, ["name", "bytes", "modified", "sha256"], "file");
    const { name, bytes, modified, sha256 } = source.file;
    if (typeof name !== "string" || !name || name.length > 255)
      fail("file name must be 1–255 characters");
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      fail("file bytes must be a whole number");
    if (modified !== undefined && !iso(modified))
      fail("file modified must be an ISO date");
    if (!hex64(sha256)) fail("file sha256 must be 64 hex digits");
    if (!iso(source.importedAt)) fail("importedAt must be an ISO date");
    fields(source.options, Object.keys(options), "options");
    for (const [key, check] of Object.entries(options))
      if (!check(source.options[key])) fail(`invalid option ${key}`);
    if (
      !Array.isArray(source.columns) ||
      !source.columns.length ||
      source.columns.length > 16384
    )
      fail("expected 1–16,384 columns");
    for (const column of source.columns) {
      fields(column, ["name", "type", "fingerprint"], "column");
      if (typeof column.name !== "string" || column.name.length > 255)
        fail("column name must be text of at most 255 characters");
      if (!TYPES.includes(column.type)) fail(`invalid column type`);
      if (!hex64(column.fingerprint))
        fail("column fingerprint must be 64 hex digits");
    }
  }
}
