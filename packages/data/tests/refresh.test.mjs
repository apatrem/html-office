// Refresh planning (T16): column matching, explicit resolutions, row count
// changes, kept formatting, conflicts outside the range and dependents.
import test from "node:test";
import assert from "node:assert/strict";
import { readCSV } from "../model/csv.mjs";
import {
  planRefresh,
  matchColumns,
  overwrittenEdits,
} from "../model/refresh.mjs";
import { dependents, references } from "../model/dependents.mjs";
import { shiftWorkbook } from "../model/structure.mjs";
import { validateSources } from "../model/sources.mjs";
import { typesFor } from "../runtime/refresh.mjs";

const read = (text, options) =>
  readCSV(new TextEncoder().encode(text), options);
function imported(text) {
  const r = read(text);
  return {
    cells: structuredClone(r.cells),
    source: {
      ref: `A1:${String.fromCharCode(64 + r.width)}${r.height}`,
      options: { header: r.header },
      columns: r.columns.map((c) => ({ name: c.name, type: c.type })),
    },
  };
}
const value = (cell) => cell?.input?.value;
const edit = (plan, ref) => plan.edits.find((e) => e.ref === ref);

test("columns match by header, then by explicit resolution", () => {
  const m = matchColumns(["A", "B", "C"], ["C", "A", "D"], { header: true });
  assert.deepEqual(
    m.columns.map((c) => [c.name, c.to, c.status]),
    [
      ["A", 1, "matched"],
      ["B", null, "missing"],
      ["C", 0, "matched"],
    ],
  );
  assert.deepEqual(m.added, [{ to: 2, name: "D" }]);
  const renamed = matchColumns(["A", "B", "C"], ["C", "A", "D"], {
    header: true,
    resolutions: { 1: { kind: "map", to: 2 } },
  });
  assert.equal(renamed.columns[1].status, "renamed");
  assert.deepEqual(renamed.added, []);
  // A column already matched cannot be taken again.
  const taken = matchColumns(["A", "B"], ["A"], {
    header: true,
    resolutions: { 1: { kind: "map", to: 0 } },
  });
  assert.equal(taken.columns[1].status, "missing");
  // A column cleared by an earlier refresh has no name and stays cleared.
  assert.equal(
    matchColumns(["A", ""], ["A"], { header: true }).columns[1].status,
    "cleared",
  );
  // Without headers, position decides.
  const positional = matchColumns(["A", "B"], ["A", "B", "C"], {
    header: false,
  });
  assert.deepEqual(positional.added, [{ to: 2, name: "C" }]);
});

test("reordered, renamed, missing and added columns; more rows", () => {
  const { cells, source } = imported("Region,Units,Note\nNord,1,a\nSud,2,b\n");
  cells.B2.format = { kind: "number", digits: 2 };
  cells.A2.style = { bold: true };
  const fresh = read("Units,Area,Extra\n1,Nord,x\n5,Sud,y\n7,Est,z\n");
  const blocked = planRefresh({ sheet: { cells }, source, fresh });
  assert.deepEqual(
    blocked.unresolved.map((c) => c.name),
    ["Region", "Note"],
  );
  const plan = planRefresh({
    sheet: { cells },
    source,
    fresh,
    resolutions: { 0: { kind: "map", to: 1 }, 2: { kind: "clear" } },
  });
  assert.deepEqual(plan.unresolved, []);
  assert.deepEqual(
    plan.columns.map((c) => [c.letter, c.name, c.status, c.from]),
    [
      ["A", "Region", "renamed", "Area"],
      ["B", "Units", "matched", "Units"],
      ["C", "Note", "cleared", null],
      ["D", "Extra", "added", "Extra"],
    ],
  );
  assert.equal(plan.ref, "A1:D4");
  assert.deepEqual(plan.rows, { before: 3, after: 4 });
  // Position kept, value from the renamed column, formatting kept.
  assert.equal(edit(plan, "A2"), undefined, "unchanged Nord with its style");
  assert.deepEqual(edit(plan, "A4").cell, {
    input: { type: "text", value: "Est" },
  });
  assert.deepEqual(edit(plan, "B3").cell, {
    input: { type: "number", value: 5 },
  });
  assert.equal(edit(plan, "B2"), undefined, "same value, same chosen format");
  assert.equal(edit(plan, "C1").cell, null);
  assert.equal(edit(plan, "C2").cell, null);
  assert.equal(value(edit(plan, "D1").cell), "Extra");
  assert.equal(edit(plan, "D1").cell.cellStyle, "header");
  assert.equal(value(edit(plan, "D4").cell), "z");
  assert.equal(plan.columns[1].changed, 2);
});

test("fewer rows clear the tail; kept columns stay beside the new rows", () => {
  const { cells, source } = imported("K,V,Memo\na,1,m1\nb,2,m2\nc,3,m3\n");
  const fresh = read("K,V\na,10\n");
  const plan = planRefresh({
    sheet: { cells },
    source,
    fresh,
    resolutions: { 2: { kind: "keep" } },
  });
  assert.equal(plan.ref, "A1:C2");
  assert.equal(value(edit(plan, "B2").cell), 10);
  for (const ref of ["A3", "B3", "A4", "B4", "C3", "C4"])
    assert.equal(edit(plan, ref).cell, null, ref);
  assert.equal(edit(plan, "C2"), undefined, "kept");
});

test("an emptied cell keeps its formatting; occupied cells outside the range block", () => {
  const { cells, source } = imported("K,V\na,1\n");
  cells.B2.format = { kind: "percent", digits: 0 };
  cells.A4 = { formula: "=SUM(B2:B3)" };
  const plan = planRefresh({
    sheet: { cells },
    source,
    fresh: read("K,V\na,\nb,2\nc,3\n"),
  });
  assert.deepEqual(edit(plan, "B2").cell, {
    format: { kind: "percent", digits: 0 },
  });
  assert.deepEqual(plan.conflicts, ["A4"]);
});

test("hand edits are reported per column; a deleted range refuses", () => {
  const { cells, source } = imported("K,V\na,1\n");
  const plan = planRefresh({
    sheet: { cells },
    source,
    fresh: read("K,V\na,1\n"),
    edited: [1],
  });
  assert.deepEqual(
    plan.columns.map((c) => c.edited),
    [false, true],
  );
  assert.deepEqual(plan.edits, []);
  assert.throws(
    () =>
      planRefresh({
        sheet: { cells },
        source: { ...source, ref: "#REF!" },
        fresh: read("K\n1\n"),
      }),
    /range was deleted/,
  );
});

test("dependents: formulas by sheet, pivots, charts, rules and dropdowns", () => {
  const book = {
    sheets: [
      { id: "raw", name: "Ventes 2026", cells: { D1: { formula: "=B2*2" } } },
      {
        id: "sum",
        name: "Summary",
        cells: {
          A1: { formula: "=SUM('Ventes 2026'!B:B)" },
          A2: { formula: "=SUM(Other!B:B)" },
          A3: { formula: '="ventes 2026!x"' },
        },
      },
    ],
    pivots: [{ source: { sheetId: "raw" } }, { source: { sheetId: "sum" } }],
    charts: [{ source: { sheetId: "raw" } }],
    conditionalFormats: [{ sheetId: "raw" }],
    validations: [
      { sheetId: "sum", source: { kind: "range", sheetId: "raw" } },
    ],
  };
  const d = dependents(book, "raw");
  assert.deepEqual(d.formulas, [
    { sheetName: "Ventes 2026", count: 1, direct: 1, through: [] },
    { sheetName: "Summary", count: 1, direct: 1, through: [] },
  ]);
  // The pivot over Summary reads its changed A1.
  assert.equal(d.pivots.length, 2);
  assert.equal(d.charts.length, 1);
  assert.equal(d.conditional, 1);
  assert.equal(d.dropdowns, 1);
});

// Codex review of #81.
test("a column inserted in the source range is tracked and left alone", () => {
  const { cells, source } = imported("K,V\na,1\n");
  const book = {
    sheets: [{ id: "raw", name: "Raw", cells }],
    names: [],
    sources: [
      {
        ...source,
        id: "source-1",
        sheetId: "raw",
        columns: source.columns.map((c) => ({
          ...c,
          fingerprint: "0".repeat(64),
        })),
      },
    ],
  };
  const insert = {
    sheetId: "raw",
    axis: "column",
    action: "insert",
    index: 2,
    count: 1,
  };
  const moved = shiftWorkbook(book, insert).sources[0];
  assert.equal(moved.ref, "A1:C2");
  assert.deepEqual(
    moved.columns.map((c) => c.name ?? "inserted"),
    ["K", "inserted", "V"],
  );
  // Columns shift in the sheet: V now lives in C.
  const shifted = {
    A1: cells.A1,
    A2: cells.A2,
    B2: { formula: "=C2*2" },
    C1: cells.B1,
    C2: cells.B2,
  };
  const plan = planRefresh({
    sheet: { cells: shifted },
    source: moved,
    fresh: read("K,V\na,10\n"),
  });
  assert.deepEqual(plan.unresolved, []);
  assert.deepEqual(
    plan.columns.map((c) => [c.letter, c.status]),
    [
      ["A", "matched"],
      ["B", "inserted"],
      ["C", "matched"],
    ],
  );
  assert.deepEqual(
    plan.edits.map((e) => [e.ref, e.cell]),
    [["C2", { input: { type: "number", value: 10 } }]],
  );
  // Deleting it drops it from the list again; deleting the range keeps it.
  const deleted = shiftWorkbook(
    { ...book, sources: [moved] },
    { sheetId: "raw", axis: "column", action: "delete", index: 2, count: 1 },
  ).sources[0];
  assert.deepEqual(
    deleted.columns.map((c) => c.name),
    ["K", "V"],
  );
  const gone = shiftWorkbook(book, {
    sheetId: "raw",
    axis: "column",
    action: "delete",
    index: 1,
    count: 2,
  }).sources[0];
  assert.equal(gone.ref, "#REF!");
  assert.equal(gone.columns.length, 2);
  validateSources({
    ...book,
    sources: [
      {
        ...moved,
        kind: "csv",
        file: { name: "a.csv", bytes: 1, sha256: "a".repeat(64) },
        importedAt: "2026-10-28T10:00:00.000Z",
        options: {
          encoding: "utf-8",
          delimiter: ",",
          header: true,
          decimal: "point",
          dates: "dmy",
        },
      },
    ],
  });
});

test("hand edits in a kept column losing rows need a confirmation", () => {
  const { cells, source } = imported("K,Memo\na,m1\nb,m2\n");
  const plan = planRefresh({
    sheet: { cells },
    source,
    fresh: read("K\na\n"),
    resolutions: { 1: { kind: "keep" } },
    edited: [1],
  });
  assert.equal(edit(plan, "B3").cell, null);
  assert.deepEqual(
    overwrittenEdits(plan).map((c) => c.name),
    ["Memo"],
  );
});

test("repeated header names keep their own column types", () => {
  const source = {
    columns: [
      { name: "Code", type: "text" },
      { inserted: true },
      { name: "Code", type: "number" },
    ],
  };
  assert.deepEqual(typesFor(source, ["Code", "Code", "Other"]), [
    "text",
    "number",
    "auto",
  ]);
});

test("formulas reading the sheet through a named range are dependents", () => {
  const book = {
    sheets: [
      { id: "raw", name: "Raw", cells: {} },
      {
        id: "sum",
        name: "Summary",
        cells: {
          A1: { formula: "=SUM(Sales)" },
          A2: { formula: '="Sales"' },
          A3: { formula: "=SalesTax(1)" },
        },
      },
    ],
    names: [{ name: "Sales", sheetId: "raw", ref: "B2:B3" }],
  };
  assert.deepEqual(dependents(book, "raw").formulas, [
    { sheetName: "Summary", count: 1, direct: 1, through: [] },
  ]);
});

// Codex re-verification of #81.
test("a renamed column is read with the type of the column it replaces", () => {
  const source = { columns: [{ name: "Old", type: "text" }] };
  assert.deepEqual(typesFor(source, ["New"]), ["auto"]);
  assert.deepEqual(typesFor(source, ["New"], { 0: { kind: "map", to: 0 } }), [
    "text",
  ]);
  const fresh = read("New\n123\n", {
    columns: typesFor(source, ["New"], { 0: { kind: "map", to: 0 } }),
  });
  assert.deepEqual(fresh.cells.A2.input, { type: "text", value: "123" });
});

test("a quoted sheet name holding a range name is not a dependent", () => {
  const book = {
    sheets: [
      { id: "raw", name: "Raw", cells: {} },
      {
        id: "sum",
        name: "Summary",
        cells: { A1: { formula: "='Budget Sales 2026'!A1" } },
      },
    ],
    names: [{ name: "Sales", sheetId: "raw", ref: "B2:B3" }],
  };
  assert.deepEqual(dependents(book, "raw").formulas, []);
});

test("formula references: ranges, sheets, names and functions", () => {
  const r = references(
    "=SUM('It''s'!A1:B2,Plan!$C:$C,3:4)+Sales*XFE1+SUM(\"A1\")+Plan!Tax+LOG10(2)",
  );
  // XFE1 is past the last column: a name. Plan!Tax would be sheet-scoped.
  assert.deepEqual(r.operands, [
    { sheet: "it's", rect: { top: 1, left: 1, bottom: 2, right: 2 } },
    { sheet: "plan", rect: { top: 1, left: 3, bottom: 1048576, right: 3 } },
    { sheet: null, rect: { top: 3, left: 1, bottom: 4, right: 16384 } },
    { name: "sales" },
    { name: "xfe1" },
  ]);
  assert.equal(r.indirect, false);
  assert.deepEqual(references("=B5:A1").operands[0].rect, {
    top: 1,
    left: 1,
    bottom: 5,
    right: 2,
  });
  assert.equal(references('=INDIRECT("A"&B1)').indirect, true);
  assert.equal(references("=SUM(OFFSET(A1,1,0))").offset, true);
  // Codex review of #95: prefixed and spaced calls, range operators.
  assert.equal(references('=_xlfn.INDIRECT("Raw!A2")').indirect, true);
  assert.equal(references(`=OFFSET${" ".repeat(40)}(A1,1,0)`).offset, true);
  assert.deepEqual(
    references("=SUM(Start:End)+SUM(Raw!A1 : Raw!A3)").operands,
    [
      { name: "start" },
      { name: "end", join: true },
      { sheet: "raw", rect: { top: 1, left: 1, bottom: 1, right: 1 } },
      {
        sheet: "raw",
        rect: { top: 3, left: 1, bottom: 3, right: 1 },
        join: true,
      },
    ],
  );
  assert.deepEqual(references("=SUM(A1:INDEX(B:B,5))").operands, [
    { sheet: null, rect: { top: 1, left: 1, bottom: 1, right: 1 }, open: true },
    { sheet: null, rect: { top: 1, left: 2, bottom: 1048576, right: 2 } },
  ]);
});

// Codex review of #95.
test("range operators read every cell between their operands", () => {
  const book = {
    sheets: [
      { id: "raw", name: "Raw", cells: {} },
      {
        id: "calc",
        name: "Calc",
        cells: {
          A1: { formula: "=SUM(Start:End)" },
          A2: { formula: "=SUM(Raw!A1 : Raw!A3)" },
          A3: { formula: "=SUM(Raw!A1:INDEX(Raw!A:A,1))" },
          A4: { formula: '=_xlfn.INDIRECT("Raw!A2")' },
          A5: { formula: "=_xlfn.OFFSET(Raw!A3,-1,0)" },
          A6: { formula: "=SUM(Raw!A1,Raw!A3)" },
          A7: { formula: "=SUM(Start:(End))" },
          B1: { formula: "=A1" },
        },
      },
    ],
    names: [
      { name: "Start", sheetId: "raw", ref: "A1" },
      { name: "End", sheetId: "raw", ref: "A3" },
    ],
    charts: [{ source: { sheetId: "calc", ref: "B1:B2" } }],
  };
  // Only A2 changes: A6 reads A1 and A3 alone.
  const d = dependents(book, "raw", ["A2"]);
  assert.deepEqual(d.formulas, [
    { sheetName: "Calc", count: 7, direct: 6, through: [] },
  ]);
  assert.equal(d.charts.length, 1);
  // A sheet whose name starts like a function prefix is still a sheet.
  const prefixed = {
    sheets: [
      { id: "raw", name: "_xlfn.Raw", cells: {} },
      { id: "calc", name: "Calc", cells: { B1: { formula: "=_xlfn.Raw!A2" } } },
    ],
  };
  assert.equal(dependents(prefixed, "raw", ["A2"]).formulas.length, 1);
});

test("named ranges over many changed cells are checked within the budget", () => {
  const cells = {};
  for (let r = 1; r <= 20000; r++) cells[`A${r}`] = { formula: "=Raw!A1" };
  const book = {
    sheets: [
      { id: "raw", name: "Raw", cells: {} },
      { id: "calc", name: "Calc", cells },
    ],
    names: Array.from({ length: 2000 }, (_, i) => ({
      name: `N${i}`,
      sheetId: "calc",
      ref: i ? "B1:B20000" : "A20000:B20000",
    })),
  };
  const d = dependents(book, "raw", ["A1"]);
  assert.deepEqual(d.names, ["N0"]);
  assert.equal(d.partial, false);
  // Past the budget, the remaining ranges are not checked, and it says so.
  const short = dependents(book, "raw", ["A1"], undefined, 20000);
  assert.equal(short.formulas[0].count, 20000);
  assert.equal(short.partial, true);
});

// T21: the P&L and summary follow the formulas that read the import.
test("dependents follow formulas through sheets and named ranges", () => {
  const book = {
    sheets: [
      {
        id: "raw",
        name: "Raw",
        cells: {
          C2: { formula: "=B2*2" },
          Z1: { formula: "=1" },
        },
      },
      {
        id: "calc",
        name: "Calc",
        cells: {
          A1: { formula: "=SUM(Raw!B2:B3)" },
          A2: { formula: "=A1*2" },
          // Below the cell it reads: found however the cells are ordered.
          A9: { formula: "=A10+1" },
          A10: { formula: "=A2" },
          A5: { formula: "=Raw!Z1" },
        },
      },
      {
        id: "report",
        name: "Report",
        cells: {
          B1: { formula: "=Calc!A2" },
          B2: { formula: "=B1+1" },
          B3: { formula: "=Calc!A5" },
        },
      },
      {
        id: "sum",
        name: "Summary Q1",
        cells: {
          A1: { formula: "=Total*2" },
          A2: { formula: "='Report'!B2&\"Calc!A1\"" },
          A3: { formula: "=Rates" },
        },
      },
    ],
    names: [
      { name: "Total", sheetId: "calc", ref: "A2" },
      { name: "Rates", sheetId: "calc", ref: "D1:D3" },
      { name: "Gone", sheetId: "calc", ref: "#REF!" },
    ],
    pivots: [
      { source: { sheetId: "report", ref: "A1:B2" } },
      { source: { sheetId: "report", ref: "B3:C9" } },
      { source: { sheetId: "sum" } },
    ],
    charts: [
      { source: { sheetId: "calc", ref: "A5:B5" } },
      { source: { sheetId: "raw", ref: "A1:B3" } },
      { source: { sheetId: "raw", ref: "Y1:Z1" } },
    ],
  };
  const d = dependents(book, "raw", ["A1:B3", "A1:B4"]);
  // Raw!Z1 and the formulas reading it are outside the refreshed range.
  assert.deepEqual(d.formulas, [
    { sheetName: "Raw", count: 1, direct: 1, through: [] },
    { sheetName: "Calc", count: 4, direct: 1, through: [] },
    { sheetName: "Report", count: 2, direct: 0, through: ["Calc"] },
    {
      sheetName: "Summary Q1",
      count: 2,
      direct: 0,
      through: ["Calc", "Report"],
    },
  ]);
  assert.deepEqual(d.pivots, [book.pivots[0], book.pivots[2]]);
  assert.deepEqual(d.charts, [book.charts[1]]);
  assert.deepEqual(d.names, ["Total"]);
  assert.equal(d.partial, false);
  // Without a range, the whole sheet: Raw!Z1 and what follows it count.
  assert.deepEqual(
    dependents(book, "raw").formulas.map((f) => f.count),
    [2, 5, 3, 2],
  );
  // The walk stops after its budget and says so.
  const short = dependents(book, "raw", ["A1:B3"], undefined, 0);
  assert.equal(short.partial, true);
  assert.deepEqual(
    short.formulas.map((f) => f.sheetName),
    ["Raw", "Calc"],
  );
});

test("INDIRECT counts as reading the range, OFFSET its whole sheet", () => {
  const book = {
    sheets: [
      { id: "raw", name: "Raw", cells: {} },
      {
        id: "sum",
        name: "Summary",
        cells: {
          A1: { formula: '=INDIRECT("Raw!A1")' },
          A2: { formula: "=SUM(OFFSET(Raw!Z9,0,0,1,1))" },
          A3: { formula: "=Raw!Z9" },
        },
      },
    ],
  };
  assert.deepEqual(dependents(book, "raw", ["A1:B3"]).formulas, [
    { sheetName: "Summary", count: 2, direct: 2, through: [] },
  ]);
});
