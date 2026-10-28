// Refresh planning (T16): column matching, explicit resolutions, row count
// changes, kept formatting, conflicts outside the range and dependents.
import test from "node:test";
import assert from "node:assert/strict";
import { readCSV } from "../model/csv.mjs";
import {
  planRefresh,
  matchColumns,
  dependents,
  overwrittenEdits,
} from "../model/refresh.mjs";
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
    { sheetName: "Ventes 2026", count: 1 },
    { sheetName: "Summary", count: 1 },
  ]);
  assert.equal(d.pivots.length, 1);
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
    { sheetName: "Summary", count: 1 },
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
