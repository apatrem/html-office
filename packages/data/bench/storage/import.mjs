// Assessment-only converter. It does not claim Excel import fidelity or run macros.
import XLSX from "xlsx";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  VERSION,
  ERRORS,
  validateWorkbook,
  stringifyWorkbook,
} from "../../model/workbook.mjs";
const errorCode = {
  0: "#NULL!",
  7: "#DIV/0!",
  15: "#VALUE!",
  23: "#REF!",
  29: "#NAME?",
  36: "#NUM!",
  42: "#N/A",
};
export function convertWorkbook(
  bytes,
  { id = "assessment", rowLimit = 0 } = {},
) {
  const source = XLSX.read(bytes, {
    type: "buffer",
    cellFormula: true,
    cellNF: true,
    cellStyles: false,
    cellDates: false,
    bookVBA: false,
    sheetRows: rowLimit,
  });
  const counts = new Map(),
    note = (kind, n = 1) => counts.set(kind, (counts.get(kind) ?? 0) + n);
  const date1904 = !!source.Workbook?.WBProps?.date1904;
  if (date1904) note("date1904");
  const book = {
    version: VERSION,
    id,
    title: "Locally measured source workbook",
    dateSystem: "excel1900",
    locale: "en-US",
    sheets: [],
    groups: [],
    names: [],
    metadata: { assessmentOnly: true },
  };
  for (const [index, name] of source.SheetNames.entries()) {
    const sheet = source.Sheets[name],
      cells = {};
    if (sheet["!merges"]?.length) note("mergedCells", sheet["!merges"].length);
    if (sheet["!fullref"]) note("rowLimit");
    for (const [ref, c] of Object.entries(sheet)) {
      if (ref.startsWith("!")) continue;
      if (c.l) note("hyperlinks");
      if (c.c) note("comments");
      let typed;
      if (c.t === "n") {
        const date = XLSX.SSF.is_date(c.z ?? "");
        typed = {
          type: date ? "date" : "number",
          value: c.v + (date && date1904 ? 1462 : 0),
        };
      } else if (c.t === "b") typed = { type: "boolean", value: c.v };
      else if (c.t === "e") {
        const value = errorCode[c.v];
        typed = {
          type: "error",
          value: ERRORS.includes(value) ? value : "#ERROR!",
        };
        if (!value) note("unsupportedErrorCode");
      } else if (c.t === "z" || c.v === undefined) typed = { type: "blank" };
      else typed = { type: "text", value: String(c.v) };
      const cell = {};
      if (c.f) {
        cell.formula = "=" + c.f;
        cell.result = typed;
        if (/\[[^\]]*\]|https?:|\b(?:WEBSERVICE|HYPERLINK)\s*\(/i.test(c.f))
          note("externalOrStructuredFormula");
        if (c.F) note("arrayFormula");
      } else cell.input = typed;
      if (typed.type === "date") cell.format = { kind: "date" };
      cells[ref] = cell;
    }
    book.sheets.push({ id: `sheet-${index + 1}`, name, cells });
  }
  if (source.Workbook?.Names?.length)
    note("sourceDefinedNames", source.Workbook.Names.length);
  // Retain source names for formula evaluation where their contract is a simple rectangle.
  for (const n of source.Workbook?.Names ?? []) {
    const match =
      /^(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(
        n.Ref.replace(/^=/, ""),
      );
    const name = match && (match[1]?.replaceAll("''", "'") ?? match[2]),
      sheet = book.sheets.find((s) => s.name === name);
    if (
      match &&
      sheet &&
      /^[A-Za-z][\w-]{0,79}$/.test(n.Name) &&
      n.Sheet === undefined
    ) {
      book.names.push({
        name: n.Name,
        sheetId: sheet.id,
        ref: `${match[3]}${match[4]}${match[5] ? `:${match[5]}${match[6]}` : ""}`,
      });
    } else note("unsupportedDefinedName");
  }
  validateWorkbook(book);
  return {
    book,
    diagnostics: [...counts].map(([kind, count]) => ({ kind, count })),
    sourceSheetCount: source.SheetNames.length,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output)
    throw new Error("Usage: node import.mjs source.xlsx local-output.json");
  const result = convertWorkbook(await readFile(input));
  await writeFile(output, stringifyWorkbook(result.book) + "\n");
  console.log(
    JSON.stringify({
      sourceSheetCount: result.sourceSheetCount,
      diagnostics: result.diagnostics,
    }),
  );
}
