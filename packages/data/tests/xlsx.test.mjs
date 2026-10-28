// XLSX import (T15, ADR-015): workbooks written with SheetJS, read with the
// pinned mini build through the same summary the worker produces, mapped to
// Data cells with honest diagnostics.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import {
  READ_OPTIONS,
  XLSX_LIMITS,
  summarise,
  mapWorkbook,
  mapSheet,
  rewriteFormula,
  numberFormat,
  differences,
  uniqueName,
} from "../model/xlsx.mjs";
import { validateSources } from "../model/sources.mjs";
import { planRefresh } from "../model/refresh.mjs";
import { XLSX_FILE, verifyXLSX } from "../tools/xlsx-library.mjs";
import { workerParts } from "../runtime/xlsx-reader.mjs";

const require = createRequire(import.meta.url),
  writer = require("xlsx"),
  mini = require(XLSX_FILE.pathname);

function build(sheets, { names = [], date1904 = false, parts = {} } = {}) {
  const wb = writer.utils.book_new();
  for (const [name, cells, extra = {}] of sheets) {
    const ws = {};
    let right = 0,
      bottom = 0;
    for (const [ref, cell] of Object.entries(cells)) {
      ws[ref] = cell;
      const { r, c } = writer.utils.decode_cell(ref);
      right = Math.max(right, c);
      bottom = Math.max(bottom, r);
    }
    ws["!ref"] = writer.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: bottom, c: right },
    });
    Object.assign(ws, extra);
    writer.utils.book_append_sheet(wb, ws, name);
  }
  wb.Workbook = { Names: names, WBProps: { date1904 } };
  let bytes = writer.write(wb, { type: "buffer", bookType: "xlsx" });
  if (Object.keys(parts).length) {
    const zip = writer.CFB.read(bytes, { type: "buffer" });
    for (const [path, content] of Object.entries(parts)) {
      const index = zip.FullPaths.findIndex((p) => p.endsWith(path));
      if (index >= 0) zip.FileIndex[index].content = Buffer.from(content);
      else writer.CFB.utils.cfb_add(zip, path, Buffer.from(content));
    }
    bytes = writer.CFB.write(zip, { type: "buffer", fileType: "zip" });
  }
  return bytes;
}
const read = (bytes) =>
  summarise(
    mini,
    mini.read(bytes, { ...READ_OPTIONS, type: "buffer" }),
    XLSX_LIMITS,
  );
const book = (names = [], sheetNames = ["Summary"]) => ({
  sheets: sheetNames.map((name, i) => ({ id: `s${i}`, name, cells: {} })),
  names,
});

test("the vendored SheetJS file is the pinned CDN build", () => {
  const vendored = readFileSync(XLSX_FILE);
  verifyXLSX(vendored, "0.20.3");
  // The same bytes as the npm tarball from cdn.sheetjs.com (lockfile
  // integrity) that the assessment converter uses.
  assert.deepEqual(
    vendored,
    readFileSync(require.resolve("xlsx/dist/xlsx.mini.min.js")),
  );
  assert.throws(
    () => verifyXLSX(Buffer.concat([vendored, Buffer.from(" ")]), "0.20.3"),
    /differs from the approved digest/,
  );
});

test("sheets, typed values, formulas across sheets and named ranges", () => {
  const bytes = build(
    [
      [
        "Ventes",
        {
          A1: { t: "s", v: "Région" },
          B1: { t: "s", v: "Code" },
          C1: { t: "s", v: "Montant" },
          D1: { t: "s", v: "Date" },
          E1: { t: "s", v: "OK" },
          A2: { t: "s", v: "Nord" },
          B2: { t: "s", v: "0012" },
          C2: { t: "n", v: 1234.5, z: "#,##0.00" },
          D2: { t: "n", v: 46323, z: "dd/mm/yyyy" },
          E2: { t: "b", v: true },
          A3: { t: "s", v: "Sud" },
          B3: { t: "s", v: "0345" },
          C3: { t: "n", v: 0.125, z: "0.0%" },
          D3: { t: "n", v: 46054.5, z: "yyyy-mm-dd hh:mm" },
          E3: { t: "e", v: 7 },
          C4: { t: "n", f: "SUM(C2:C3)", v: 1234.625 },
          D4: { t: "n", v: 0.75, z: "h:mm" },
        },
      ],
      [
        "Summary",
        {
          A1: { t: "s", v: "Total" },
          B1: { t: "n", f: "Ventes!C4*2", v: 2469.25 },
          B2: { t: "s", f: '"Ventes!"&Ventes!A2', v: "Ventes!Nord" },
          B3: { t: "n", f: "SUM(Total)", v: 1234.625 },
        },
      ],
      ["Empty", {}],
    ],
    {
      names: [
        { Name: "Total", Ref: "Ventes!$C$4" },
        { Name: "Local", Ref: "Ventes!$A$1", Sheet: 0 },
        { Name: "_xlnm.Print_Area", Ref: "Ventes!$A$1:$E$4", Sheet: 0 },
        { Name: "Taken", Ref: "Ventes!$A$2" },
      ],
    },
  );
  const summary = read(bytes);
  assert.deepEqual(
    summary.sheets.map((s) => [s.name, s.cells.length]),
    [
      ["Ventes", 17],
      ["Summary", 4],
      ["Empty", 0],
    ],
  );
  const result = mapWorkbook(summary, {
    chosen: [0, 1],
    book: book([{ name: "taken" }]),
  });
  const [ventes, sum] = result.sheets;
  assert.equal(ventes.name, "Ventes");
  // The workbook already has "Summary": renamed, and formulas follow.
  assert.equal(sum.name, "Summary (2)");
  assert.equal(ventes.header, true);
  assert.deepEqual(
    ventes.columns.map((c) => c.name),
    ["Région", "Code", "Montant", "Date", "OK"],
  );
  assert.deepEqual(ventes.cells.A1, {
    input: { type: "text", value: "Région" },
    cellStyle: "header",
  });
  assert.deepEqual(ventes.cells.B2.input, { type: "text", value: "0012" });
  assert.deepEqual(ventes.cells.C2, {
    input: { type: "number", value: 1234.5 },
    format: { kind: "number", digits: 2 },
  });
  assert.deepEqual(ventes.cells.C3.format, { kind: "percent", digits: 1 });
  assert.deepEqual(ventes.cells.D2, {
    input: { type: "date", value: 46323 },
    format: { kind: "date" },
  });
  assert.equal(ventes.cells.D3.input.value, 46054.5);
  // A time of day stays a number: Data has no time-only format.
  assert.deepEqual(ventes.cells.D4, { input: { type: "number", value: 0.75 } });
  assert.deepEqual(ventes.cells.E2.input, { type: "boolean", value: true });
  assert.deepEqual(ventes.cells.E3.input, { type: "error", value: "#DIV/0!" });
  assert.deepEqual(ventes.cells.C4, {
    formula: "=SUM(C2:C3)",
    result: { type: "number", value: 1234.625 },
  });
  assert.equal(sum.cells.B1.formula, "=Ventes!C4*2");
  // Text inside a string literal is not a sheet reference.
  assert.equal(sum.cells.B2.formula, '="Ventes!"&Ventes!A2');
  assert.deepEqual(result.names, [
    { name: "Total", sheet: "Ventes", ref: "C4" },
  ]);
  assert.match(
    result.diagnostics.join("\n"),
    /2 named ranges are not imported \(Local, Taken\)/,
  );
  assert.match(
    result.diagnostics.join("\n"),
    /"Summary" is imported as "Summary \(2\)"/,
  );
  assert.match(
    result.diagnostics.join("\n"),
    /1 time of day is kept as a fraction/,
  );
  // Formulas into a renamed sheet are rewritten with its new name.
  const renamed = mapWorkbook(summary, {
    chosen: [0, 1],
    book: book([], ["Ventes"]),
  });
  assert.equal(renamed.sheets[0].name, "Ventes (2)");
  assert.equal(renamed.sheets[1].cells.B1.formula, "='Ventes (2)'!C4*2");
  assert.equal(
    renamed.sheets[1].cells.B2.formula,
    `="Ventes!"&'Ventes (2)'!A2`,
  );
  // A sheet left out: formulas reading it keep their saved values.
  const alone = mapWorkbook(summary, { chosen: [1], book: book([]) });
  assert.deepEqual(alone.sheets[0].cells.B1, {
    input: { type: "number", value: 2469.25 },
  });
  assert.deepEqual(alone.sheets[0].kept, { sheet: 2 });
  assert.match(
    alone.diagnostics[0],
    /^2 formulas are imported as the value saved in the file: 2 formulas read a sheet that is not imported\.$/,
  );
  assert.deepEqual(alone.names, []);
});

test("formulas Data cannot run keep their saved values, with reasons", () => {
  const sheets = new Map([
    ["data", "Data"],
    ["other", null],
  ]);
  assert.deepEqual(rewriteFormula("[1]Prices!A1*2", sheets), {
    reason: "external",
  });
  assert.deepEqual(rewriteFormula("'C:\\x\\[Book.xlsx]Prices'!A1", sheets), {
    reason: "external",
  });
  assert.deepEqual(rewriteFormula("SUM(Table1[Amount])", sheets), {
    reason: "table",
  });
  assert.deepEqual(rewriteFormula("SUM(Data:Other!A1)", sheets), {
    reason: "3d",
  });
  assert.deepEqual(rewriteFormula("SUM('Data:Other'!A1)", sheets), {
    reason: "3d",
  });
  assert.deepEqual(rewriteFormula("Other!A1", sheets), { reason: "sheet" });
  assert.deepEqual(
    rewriteFormula("'It''s'!A1", new Map([["it's", "It's 2"]])),
    {
      formula: "'It''s 2'!A1",
    },
  );
  assert.deepEqual(rewriteFormula('IF(A1="[x]",1,2)', sheets), {
    formula: 'IF(A1="[x]",1,2)',
  });
  const bytes = build([
    [
      "Data",
      {
        A1: { t: "n", v: 2 },
        A2: { t: "n", f: "[1]Prices!A1*2", v: 8 },
        A3: { t: "n", f: "SUM(Table1[Amount])", v: 9 },
        A4: { t: "n", f: "A1*3", F: "A4:A4", v: 6 },
        A5: { t: "n", f: "A1*4" },
      },
    ],
  ]);
  const mapped = mapSheet(read(bytes), 0, {
    sheets: new Map([["data", "Data"]]),
  });
  assert.deepEqual(mapped.kept, { external: 1, table: 1, array: 1 });
  assert.deepEqual(mapped.cells.A2, { input: { type: "number", value: 8 } });
  // A formula without a saved value is imported for Data to calculate.
  assert.deepEqual(mapped.cells.A5, { formula: "=A1*4" });
  assert.equal(mapped.header, false);
  assert.deepEqual(
    mapped.columns.map((c) => c.name),
    ["A"],
  );
});

test("number formats: Data presets or General", () => {
  assert.equal(numberFormat("General"), null);
  assert.equal(numberFormat("@"), null);
  assert.deepEqual(numberFormat("0"), { kind: "number", digits: 0 });
  assert.deepEqual(numberFormat("#,##0.000"), { kind: "number", digits: 3 });
  assert.deepEqual(numberFormat("0%"), { kind: "percent", digits: 0 });
  assert.deepEqual(numberFormat("#,##0.00 [$€-40C];-#,##0.00 [$€-40C]"), {
    kind: "currency",
    currency: "EUR",
    digits: 2,
  });
  assert.deepEqual(numberFormat('_("$"* #,##0.00_);_("$"* (#,##0.00)'), {
    kind: "accounting",
    currency: "USD",
    digits: 2,
    negative: "parentheses",
  });
  assert.deepEqual(numberFormat("#,##0,"), {
    kind: "number",
    digits: 0,
    scale: "thousands",
  });
  assert.deepEqual(numberFormat("0.0;[Red]-0.0"), {
    kind: "number",
    digits: 1,
    negative: "red",
  });
  assert.equal(numberFormat("0.00E+00"), null);
  assert.equal(numberFormat("# ?/?"), null);
});

test("1904 dates, hidden sheets and content Data does not import", () => {
  const sheetXML = (extra) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" s="1"><v>0</v></c></row></sheetData>${extra}</worksheet>`;
  const bytes = build(
    [
      [
        "Plan",
        {
          A1: { t: "n", v: 44861, z: "yyyy-mm-dd" },
          B1: { t: "s", v: "linked", l: { Target: "https://example.com" } },
          C1: { t: "s", v: "noted", c: [{ a: "me", t: "a comment" }] },
        },
        { "!merges": [{ s: { r: 0, c: 1 }, e: { r: 0, c: 2 } }] },
      ],
      ["Hidden", { A1: { t: "n", v: 1 } }],
    ],
    {
      date1904: true,
      parts: {
        "/xl/vbaProject.bin": "macro",
        "/xl/externalLinks/externalLink1.xml": "<externalLink/>",
        "/xl/charts/chart1.xml": "<chartSpace/>",
        "/xl/pivotTables/pivotTable1.xml": "<pivotTableDefinition/>",
        "/xl/connections.xml": "<connections/>",
        "/xl/worksheets/sheet2.xml": sheetXML(
          '<conditionalFormatting sqref="A1"><cfRule type="cellIs"/></conditionalFormatting><dataValidations count="1"><dataValidation sqref="A1"/></dataValidations>',
        ),
      },
    },
  );
  const summary = read(bytes);
  assert.equal(summary.date1904, true);
  assert.deepEqual(summary.parts, {
    macros: 1,
    externalLinks: 1,
    pivots: 1,
    charts: 1,
    images: 0,
    connections: 1,
    embeddings: 0,
    controls: 0,
    slicers: 0,
  });
  assert.equal(summary.sheets[0].features.merges, 1);
  assert.equal(summary.sheets[0].features.hyperlinks, 1);
  assert.equal(summary.sheets[0].features.comments, 1);
  assert.equal(summary.sheets[1].features.conditional, 1);
  assert.equal(summary.sheets[1].features.validation, 1);
  const result = mapWorkbook(summary, { chosen: [0, 1], book: book() });
  // 1904 serials move to the 1900 system.
  assert.deepEqual(result.sheets[0].cells.A1.input, {
    type: "date",
    value: 44861 + 1462,
  });
  const notes = result.diagnostics.join("\n");
  for (const pattern of [
    /Macros are not imported and never run\./,
    /Links to other workbooks are not followed/,
    /Pivot tables are imported as their saved cells/,
    /Charts are not imported\./,
    /Data connections and queries are not imported and never run\./,
    /"Plan": 1 merged range is unmerged; 1 comment is not imported; 1 hyperlink is not imported\./,
    /"Hidden": 1 conditional format is not imported; 1 data validation rule is not imported\./,
    /1904 date system/,
  ])
    assert.match(notes, pattern);
});

test("the worker script runs the summary in an isolated context", () => {
  const posted = [],
    self = {
      postMessage: (m) => posted.push(m),
      fetch: () => {
        throw new Error("network");
      },
    };
  const context = vm.createContext({ self, TextDecoder });
  vm.runInContext(
    workerParts(readFileSync(XLSX_FILE, "utf8")).join(""),
    context,
  );
  assert.equal(self.fetch, undefined, "network functions removed");
  self.onmessage({
    data: new Uint8Array(build([["S", { A1: { t: "n", v: 1 } }]])).buffer,
  });
  // Arrays from the other realm, compared by value.
  assert.deepEqual(
    JSON.parse(JSON.stringify(posted[0].summary.sheets[0].cells)),
    [[0, 0, "n", 1, null, -1, 0]],
  );
});

test("cell limit, names and xlsx sources", () => {
  const bytes = build([["S", { A1: { t: "n", v: 1 }, A2: { t: "n", v: 2 } }]]);
  assert.throws(
    () =>
      summarise(mini, mini.read(bytes, { ...READ_OPTIONS, type: "buffer" }), {
        cells: 1,
      }),
    /more than 1 cells/,
  );
  const taken = new Set(["data", "data (2)"]);
  assert.equal(uniqueName("Data", taken), "Data (3)");
  assert.equal(uniqueName("'Quoted'", taken), "Quoted");
  const source = {
    id: "source-1",
    sheetId: "s0",
    ref: "A1:B2",
    kind: "xlsx",
    file: { name: "a.xlsx", bytes: 10, sha256: "a".repeat(64) },
    importedAt: "2026-10-28T10:00:00.000Z",
    options: { sheet: "Ventes", header: true },
    columns: [{ name: "A", type: "auto", fingerprint: "b".repeat(64) }],
  };
  const withSource = (s) => ({ ...book(), sources: [s] });
  validateSources(withSource(source));
  assert.throws(
    () =>
      validateSources(
        withSource({
          ...source,
          options: { ...source.options, delimiter: "," },
        }),
      ),
    /unknown field delimiter/,
  );
  assert.throws(
    () => validateSources(withSource({ ...source, kind: "ods" })),
    /unsupported kind ods/,
  );
});

test("recalculated results that differ from the file are reported", () => {
  const cells = {
    s1: {
      B1: { formula: "=X()", result: { type: "number", value: 4 } },
      B2: { formula: "=A1", result: { type: "number", value: 0.1 + 0.2 } },
    },
  };
  assert.equal(
    differences(
      cells,
      [{ sheetId: "s1", ref: "B2", result: { type: "number", value: 0.3 } }],
      { s1: "Plan" },
    ),
    null,
  );
  assert.equal(
    differences(
      cells,
      [
        {
          sheetId: "s1",
          ref: "B1",
          result: { type: "error", value: "#NAME?" },
        },
        { sheetId: "s1", ref: "B2", result: { type: "number", value: 0.3 } },
      ],
      { s1: "Plan" },
    ),
    "1 formula gives a different result in Data than the value saved in the file, for example Plan!B1: 4 in the file, #NAME? here. Check it.",
  );
});

test("an XLSX refresh carries formulas and keeps presentation", () => {
  const sheet = {
    cells: {
      A1: { input: { type: "text", value: "K" }, cellStyle: "header" },
      B1: { input: { type: "text", value: "V" }, cellStyle: "header" },
      A2: { input: { type: "number", value: 1 } },
      B2: { formula: "=A2*2", result: { type: "number", value: 2 } },
      A3: { input: { type: "number", value: 2 } },
      B3: {
        formula: "=A3*2",
        result: { type: "number", value: 4 },
        format: { kind: "number", digits: 2 },
      },
    },
  };
  const bytes = build([
    [
      "Plan",
      {
        A1: { t: "s", v: "K" },
        B1: { t: "s", v: "V" },
        A2: { t: "n", v: 1 },
        B2: { t: "n", f: "A2*2", v: 2 },
        A3: { t: "n", v: 5 },
        B3: { t: "n", f: "A3*3", v: 15 },
      },
    ],
  ]);
  const fresh = mapSheet(read(bytes), 0, {
    sheets: new Map([["plan", "Plan"]]),
    header: true,
  });
  const plan = planRefresh({
    sheet,
    source: {
      ref: "A1:B3",
      options: { header: true },
      columns: [{ name: "K" }, { name: "V" }],
    },
    fresh,
  });
  assert.deepEqual(
    plan.edits.map((e) => [e.ref, e.cell]),
    [
      ["A3", { input: { type: "number", value: 5 } }],
      ["B3", { formula: "=A3*3", format: { kind: "number", digits: 2 } }],
    ],
  );
  assert.deepEqual(
    plan.columns.map((c) => c.changed),
    [1, 1],
  );
});
