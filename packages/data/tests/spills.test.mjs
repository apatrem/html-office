// F-01 spilled array results: detection in the engine adapter, the saved
// `spill` field, readers (cellAt, CSV, clipboard, pivots, inspect) and the
// edits that must drop or keep a spill.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EngineSession } from "../engine/adapter.mjs";
import { loadEngine, recalculate } from "../tools/engine-node.mjs";
import { validateWorkbook } from "../model/workbook.mjs";
import { readModel, writeModel } from "../model/document.mjs";
import {
  applyResults,
  cellAt,
  readView,
  spillAt,
  spillBounds,
} from "../model/spills.mjs";
import { shiftWorkbook } from "../model/structure.mjs";
import { EditHistory, captureCells } from "../model/history.mjs";
import { copyRange, rangePatches } from "../model/clipboard.mjs";
import { sheetCSV } from "../runtime/csv.mjs";
import {
  inspectRange,
  compactRange,
  applyPatch,
} from "../tools/workbook-ops.mjs";

const workbook = (cells, extra = {}) => ({
  version: "html-data/0.1",
  id: "fictional-spills",
  title: "Fictional spill test",
  dateSystem: "excel1900",
  locale: "en-US",
  groups: [],
  names: [],
  sheets: [{ id: "s", name: "Sales", cells }],
  ...extra,
});
const formulas = (map) =>
  Object.fromEntries(
    Object.entries(map).map(([ref, formula]) => [ref, { formula }]),
  );
async function spills(cells) {
  const session = new EngineSession(await loadEngine());
  try {
    session.load(workbook(cells));
    const { results } = await session.calculateDelta();
    validateWorkbook(session.book);
    return Object.fromEntries(
      results.map((r) => [
        r.ref,
        r.spill
          ? [
              r.spill.ref,
              r.spill.results.map((line) => line.map((v) => v.value)),
            ]
          : r.result.value,
      ]),
    );
  } finally {
    session.dispose();
  }
}

test("the adapter saves each spilled array on its anchor", async () => {
  assert.deepEqual(
    await spills({
      A1: { input: { type: "number", value: 1 } },
      A2: { input: { type: "number", value: 3 } },
      C1: { formula: "=SEQUENCE(3)" },
      D1: { formula: "=A1:A2*2" },
      E1: { formula: "={1,2;3,4}" },
      H1: { formula: '=IF(A1:A2>2,"big",FALSE)' },
      H4: { formula: "=SUM(C1#)" },
    }),
    {
      C1: ["C1:C3", [[1], [2], [3]]],
      D1: ["D1:D2", [[2], [6]]],
      E1: [
        "E1:F2",
        [
          [1, 2],
          [3, 4],
        ],
      ],
      H1: ["H1:H2", [[false], ["big"]]],
      H4: 6,
    },
  );
});

test("an occupied target gives #SPILL!; blanks and formatting do not block", async () => {
  assert.deepEqual(
    await spills({
      A1: { formula: "=SEQUENCE(3)" },
      A3: { input: { type: "text", value: "x" } },
      C1: { formula: "=SEQUENCE(3)" },
      C2: { input: { type: "blank" } },
      C3: { format: { kind: "percent" } },
    }),
    {
      A1: "#SPILL!",
      C1: ["C1:C3", [[1], [2], [3]]],
    },
  );
});

test("spills passing along another anchor's row or column are measured exactly", async () => {
  // B10's neighbour B11 and C5's neighbour C6 belong to other spills; B1's
  // and A2's layouts read the same values two ways.
  assert.deepEqual(
    await spills(
      formulas({
        B10: "=7",
        A11: "=SEQUENCE(1,3)",
        C5: "=1",
        A6: "=SEQUENCE(1,3)",
        F10: "=SEQUENCE(2)",
        G9: "=3",
      }),
    ),
    {
      B10: 7,
      A11: ["A11:C11", [[1, 2, 3]]],
      C5: 1,
      A6: ["A6:C6", [[1, 2, 3]]],
      F10: ["F10:F11", [[1], [2]]],
      G9: 3,
    },
  );
  assert.deepEqual(
    await spills(formulas({ B1: "=SEQUENCE(2,1,5,-3)", A2: "=1" })),
    { B1: ["B1:B2", [[5], [2]]], A2: 1 },
  );
  assert.deepEqual(await spills(formulas({ B1: "=5", A2: "=SEQUENCE(1,2)" })), {
    B1: 5,
    A2: ["A2:B2", [[1, 2]]],
  });
});

test("BYROW applies a LAMBDA per row; an array-valued LAMBDA gives #VALUE!", async () => {
  // F-03: the earlier probe's #VALUE! came from a LAMBDA returning the row
  // (or a 1×1 array such as r*2), not from BYROW itself.
  const data = {
    A1: { input: { type: "number", value: 1 } },
    B1: { input: { type: "number", value: 2 } },
    A2: { input: { type: "number", value: 3 } },
    B2: { input: { type: "number", value: 4 } },
  };
  assert.deepEqual(
    await spills({
      ...data,
      D1: { formula: "=BYROW(A1:B2,LAMBDA(r,SUM(r)))" },
      E1: { formula: "=BYCOL(A1:B2,LAMBDA(c,MAX(c)))" },
      E4: { formula: "=BYROW(A1:B2,LAMBDA(r,INDEX(r,1,2)*10))" },
      G4: { formula: "=BYROW(A1:A2,LAMBDA(r,r*2))" },
      I4: { formula: "=BYROW(A1:B2,SUM)" },
    }),
    {
      D1: ["D1:D2", [[3], [7]]],
      E1: ["E1:F1", [[3, 4]]],
      E4: ["E4:E5", [[20], [40]]],
      G4: ["G4:G5", [["#VALUE!"], ["#VALUE!"]]],
      I4: "#NAME?",
    },
  );
});

test("saved spills validate, round-trip and reload identically", async () => {
  const book = await recalculate(
    JSON.parse(
      await readFile(new URL("../fixtures/spills.json", import.meta.url)),
    ),
  );
  const cells = book.sheets[0].cells;
  assert.equal(cells.G1.spill.ref, "G1:H2");
  assert.deepEqual(readModel(writeModel(book)), book);
  // A table sheet keeps its anchors sparse; spill cells are null positions.
  book.sheets[0].metadata = { layout: "table" };
  const payload = JSON.parse(writeModel(book));
  assert.equal(payload.sheets[0].table.encoding, "rows");
  assert.deepEqual(readModel(writeModel(book)), book);
  // Files written before F-01 (no spill field) remain readable.
  const legacy = structuredClone(book);
  for (const cell of Object.values(legacy.sheets[0].cells)) delete cell.spill;
  assert.doesNotThrow(() => readModel(writeModel(legacy)));
});

test("spill records are checked", async () => {
  const valid = () =>
    workbook({
      A1: {
        formula: "=SEQUENCE(2)",
        result: { type: "number", value: 1 },
        spill: {
          ref: "A1:A2",
          results: [
            [{ type: "number", value: 1 }],
            [{ type: "number", value: 2 }],
          ],
        },
      },
    });
  assert.doesNotThrow(() => validateWorkbook(valid()));
  const broken = [
    [(c) => (c.spill.ref = "A2:A3"), /must start at A1/],
    [(c) => (c.spill.ref = "A1"), /Invalid spill range/],
    [(c) => (c.spill.ref = "A1:A1"), /Invalid spill range|at least 2/],
    [(c) => c.spill.results.pop(), /must match/],
    [(c) => (c.spill.results[0][0].value = 9), /start with its result/],
    [(c) => (c.spill.results[1][0] = { type: "number" }), /finite number/],
    [(c) => delete c.result, /requires a formula result/],
    [(c) => (c.spill.extra = 1), /unknown field extra/],
  ];
  for (const [change, message] of broken) {
    const book = valid();
    change(book.sheets[0].cells.A1);
    assert.throws(() => validateWorkbook(book), message);
  }
  const overlapping = valid();
  overlapping.sheets[0].cells.B1 = structuredClone(
    overlapping.sheets[0].cells.A1,
  );
  overlapping.sheets[0].cells.B1.spill.ref = "B1:B2";
  assert.doesNotThrow(() => validateWorkbook(overlapping));
  overlapping.sheets[0].cells.B1.spill = {
    ref: "B1:B2",
    results: [[{ type: "number", value: 1 }], [{ type: "number", value: 2 }]],
  };
  overlapping.sheets[0].cells.A1.spill = {
    ref: "A1:B2",
    results: [
      [
        { type: "number", value: 1 },
        { type: "number", value: 1 },
      ],
      [
        { type: "number", value: 2 },
        { type: "number", value: 2 },
      ],
    ],
  };
  assert.throws(() => validateWorkbook(overlapping), /cannot overlap/);
});

test("readers see spilled cells; a cell's own input wins", async () => {
  const book = await recalculate(
      JSON.parse(
        await readFile(new URL("../fixtures/spills.json", import.meta.url)),
      ),
    ),
    sheet = book.sheets[0];
  assert.deepEqual(spillAt(sheet, "D3"), {
    anchor: "D1",
    value: { type: "number", value: 3 },
  });
  assert.deepEqual(cellAt(sheet, "E2"), {
    format: { kind: "number", digits: 1 },
    formula: "=B2:B5*2",
    result: { type: "number", value: 160 },
    spilledFrom: "E1",
  });
  assert.equal(cellAt(sheet, "D1"), sheet.cells.D1);
  assert.deepEqual(spillBounds(sheet), { rows: 4, columns: 8 });
  assert.equal(readView(sheet).cells.H2.result.value, 200);
  // Copying copies spilled values as values.
  const copied = copyRange(sheet, "D1:E2");
  assert.deepEqual(copied.cells[1][0], { input: { type: "number", value: 2 } });
  assert.deepEqual(copied.cells[1][1], {
    format: { kind: "number", digits: 1 },
    input: { type: "number", value: 160 },
  });
  assert.equal(copied.cells[0][0].spill, undefined);
  const pasted = rangePatches("s", "J1", [[sheet.cells.D1]], {
    origin: { row: 1, column: 4 },
  });
  assert.equal(pasted[0].cell.spill, undefined);
  // CSV export includes spilled values and their extent.
  const csv = sheetCSV(sheet).text.split("\r\n");
  assert.equal(csv[1], "North,120,,2,160,North,East,200");
  assert.equal(csv[3], "North,45,,4,400,,,");
  // A cell's own input inside a spill is shown instead.
  sheet.cells.D3 = { input: { type: "text", value: "mine" } };
  assert.equal(cellAt(sheet, "D3").input.value, "mine");
});

test("the spill index follows results, replaced anchors and history", async () => {
  const book = await recalculate(workbook(formulas({ A1: "=SEQUENCE(3)" }))),
    sheet = book.sheets[0];
  assert.equal(cellAt(sheet, "A3").result.value, 3);
  const before = captureCells(book, [{ sheetId: "s", ref: "A1" }]);
  // Replacing the anchor removes its spill at once.
  sheet.cells.A1 = { formula: "=SEQUENCE(2)" };
  assert.equal(cellAt(sheet, "A3"), undefined);
  applyResults(book, [
    {
      sheetId: "s",
      ref: "A1",
      result: { type: "number", value: 1 },
      spill: {
        ref: "A1:A2",
        results: [
          [{ type: "number", value: 1 }],
          [{ type: "number", value: 2 }],
        ],
      },
    },
  ]);
  assert.equal(cellAt(sheet, "A2").result.value, 2);
  const history = new EditHistory();
  history.record({
    before,
    after: captureCells(book, [{ sheetId: "s", ref: "A1" }]),
  });
  history.undo(book);
  assert.equal(cellAt(sheet, "A3").result.value, 3);
  history.redo(book);
  assert.equal(cellAt(sheet, "A3"), undefined);
  applyResults(book, [
    { sheetId: "s", ref: "A1", result: { type: "error", value: "#SPILL!" } },
  ]);
  assert.equal(sheet.cells.A1.spill, undefined);
  assert.equal(cellAt(sheet, "A2"), undefined);
});

test("row and column shifts drop the moved sheet's spills until recalculation", async () => {
  const book = await recalculate(
      workbook(formulas({ A1: "=SEQUENCE(3)", C1: "=SEQUENCE(1,2)" })),
    ),
    next = shiftWorkbook(book, {
      sheetId: "s",
      axis: "row",
      action: "delete",
      index: 2,
      count: 1,
    });
  assert.equal(next.sheets[0].cells.A1.spill, undefined);
  assert.equal(next.sheets[0].cells.A1.result.value, 1);
  assert.equal(book.sheets[0].cells.A1.spill.ref, "A1:A3");
  assert.doesNotThrow(() => validateWorkbook(next));
  const recalculated = await recalculate(next);
  assert.equal(recalculated.sheets[0].cells.A1.spill.ref, "A1:A3");
});

test("inspect names the anchor of spilled cells; patches cannot write spills", async () => {
  const book = await recalculate(workbook(formulas({ A1: "=SEQUENCE(2)" }))),
    range = inspectRange(book, "Sales!A1:A2");
  assert.deepEqual(range.cells[1], {
    ref: "A2",
    cell: { result: { type: "number", value: 2 }, spilledFrom: "A1" },
    shown: "2",
  });
  assert.match(compactRange(range, "current"), /A2 +\(spilled from A1\) +2/);
  const patched = applyPatch(book, {
    edits: [
      {
        sheet: "Sales",
        ref: "A1",
        cell: { spill: { ref: "A1:A2", results: [] } },
      },
    ],
  });
  assert.match(patched.errors.join("\n"), /do not write "spill"/);
});

test("pivot tables and dropdown sources read spilled values", async () => {
  const { computePivot } = await import("../model/pivot.mjs"),
    { validationChoices } = await import("../model/validation.mjs");
  const book = await recalculate(
    workbook(
      {
        A1: {
          formula:
            '=HSTACK({"Region";"North";"South";"North"},{"Amount";1;2;4})',
        },
      },
      {
        pivots: [
          {
            id: "p",
            source: { sheetId: "s", ref: "A1:B4" },
            output: { sheetId: "s", ref: "D1" },
            rows: ["Region"],
            columns: [],
            filters: [],
            values: [{ field: "Amount", aggregate: "sum" }],
          },
        ],
      },
    ),
  );
  assert.equal(book.sheets[0].cells.A1.spill.ref, "A1:B4");
  const out = computePivot(book, book.pivots[0]),
    values = out.cells.map(([, , cell]) => cell.input?.value);
  assert.ok(values.includes("North") && values.includes(5));
  const choices = validationChoices(
    book,
    {
      id: "v",
      sheetId: "s",
      ref: "F9",
      source: { kind: "range", sheetId: "s", ref: "A2:A4" },
    },
    { snapshotCurrent: true },
  );
  assert.deepEqual(
    choices.values.map((v) => v.value),
    ["North", "South"],
  );
});

test("charts read a spilled block, header row included", async () => {
  const { chartTable } = await import("../model/charts.mjs"),
    { display } = await import("../runtime/view.mjs");
  const book = await recalculate(
    workbook({
      A1: { formula: '=VSTACK({"Region","Amount"},{"North",3;"South",5})' },
    }),
  );
  const table = chartTable(
    book,
    {
      id: "c",
      sheetId: "s",
      anchor: "E2",
      width: 400,
      height: 300,
      type: "column",
      options: { title: "Amount" },
      source: { sheetId: "s", ref: "A1:B3" },
    },
    (cell) => display(cell, "en-US"),
  );
  assert.deepEqual(table.headers, ["Region", "Amount"]);
  assert.deepEqual(table.rows, [
    ["North", 3],
    ["South", 5],
  ]);
  assert.equal(table.formulas, true);
});

test("plain formulas beside a spill are never measured again", async () => {
  const { scalarFormula } = await import("../engine/adapter.mjs");
  for (const formula of [
    "=B2*2",
    "=Sheet2!B2+$C$3",
    "='My sheet'!A1*2",
    '=IF(B2>0,ROUND(B2,1),"a:b")',
    "=SUM(B2,C2)",
  ])
    assert.equal(scalarFormula(formula), true, formula);
  for (const formula of [
    "=SUM(B2:B5)",
    "=SEQUENCE(3)",
    "=Amount*2",
    "=A1#",
    "={1,2}",
    "=LET(x,1,x)",
    '=INDIRECT("A1")',
    "=Sales[Amount]",
  ])
    assert.equal(scalarFormula(formula), false, formula);
  // B2:B4 are spill cells right of the helper formulas A2:A4; only A4,
  // which reads a range, is measured with the spill's anchor.
  const session = new EngineSession(await loadEngine());
  try {
    session.load(
      workbook({
        B1: { formula: "=SEQUENCE(4)" },
        A2: { formula: "=B2*2" },
        A3: { formula: "=IF(B3>2,B3,0)" },
        A4: { formula: "=SUM(B4:B4)" },
      }),
    );
    let measured = [];
    const measure = session.measure.bind(session);
    session.measure = (rects) => {
      measured = rects.map((r) => r.ref);
      return measure(rects);
    };
    const { results } = await session.calculateDelta();
    assert.deepEqual(measured, ["B1", "A4"]);
    assert.equal(results.find((r) => r.ref === "B1").spill.ref, "B1:B4");
    assert.equal(results.find((r) => r.ref === "A4").spill, undefined);
  } finally {
    session.dispose();
  }
});

// Review findings (Codex, first round), one regression each.
test("review: a name that looks like a cell is not a single-cell reference", async () => {
  const { scalarFormula } = await import("../engine/adapter.mjs");
  assert.equal(scalarFormula("=A0*2"), false);
  assert.equal(scalarFormula("=TAX2*2", new Set(["tax2"])), false);
  assert.equal(scalarFormula("=XFE1*2"), false);
  const session = new EngineSession(await loadEngine());
  try {
    const book = workbook({
      D1: { input: { type: "number", value: 10 } },
      D2: { input: { type: "number", value: 20 } },
      A1: { formula: "=A0*2" },
    });
    book.names = [{ name: "A0", sheetId: "s", ref: "D1:D2" }];
    session.load(book);
    const { results } = await session.calculateDelta();
    assert.equal(results.find((r) => r.ref === "A1").spill.ref, "A1:A2");
  } finally {
    session.dispose();
  }
});

test("review: a probe size that leaves spilled cells out is not trusted", async () => {
  assert.deepEqual(
    await spills(formulas({ B1: "=SEQUENCE(4-SHEETS())", A2: "=SUM(D1:D1)" })),
    { B1: ["B1:B3", [[1], [2], [3]]], A2: 0 },
  );
});

test("review: long crossing runs are compared without their whole area", async () => {
  const started = performance.now();
  assert.deepEqual(
    Object.keys(
      await spills(
        formulas({
          C3: "=ROWS(A1:A1)",
          B4: "=SEQUENCE(3000,2)",
          D2: "=SEQUENCE(2,3000)",
        }),
      ),
    ),
    ["C3", "B4", "D2"],
  );
  assert.ok(performance.now() - started < 20000);
});

test("review: preservation ignores recalculated spills", async () => {
  const { preservation } = await import("../tools/workbook-ops.mjs");
  const before = await recalculate(
      workbook({
        B1: { input: { type: "number", value: 2 } },
        A1: { formula: "=SEQUENCE(B1)" },
      }),
    ),
    after = structuredClone(before);
  after.sheets[0].cells.B1.input.value = 3;
  const recalculated = await recalculate(after);
  assert.equal(recalculated.sheets[0].cells.A1.spill.ref, "A1:A3");
  const report = preservation(before, recalculated, { allow: ["Sales!B1"] });
  assert.equal(
    JSON.stringify(report).includes("A1"),
    false,
    JSON.stringify(report),
  );
});

test("review: readers built afresh see spills added without forgetSpills", async () => {
  const { conditionalScales } = await import("../model/conditional.mjs");
  const book = workbook(
    { A1: { input: { type: "number", value: 1 } } },
    {
      conditionalFormats: [
        {
          id: "bars",
          sheetId: "s",
          ref: "A1:A3",
          kind: "dataBar",
          scale: { kind: "auto" },
          positive: "acc",
          negative: "alert",
        },
      ],
    },
  );
  assert.equal(conditionalScales(book).bars.max, 1);
  // A worker replaces the record in place, as recovery does.
  const calculated = await recalculate(
    workbook({ A1: { formula: "=SEQUENCE(3)" } }),
  );
  book.sheets[0].cells.A1 = calculated.sheets[0].cells.A1;
  assert.equal(conditionalScales(book).bars.max, 3);
  // A pending replacement without its own value keeps the spilled value.
  assert.equal(
    conditionalScales(book, {
      overrides: [{ sheetId: "s", ref: "A3", cell: null }],
    }).bars.max,
    3,
  );
});

test("review: a pivot output may not cover spilled values", async () => {
  const { pivotEdits, computePivot } = await import("../model/pivot.mjs");
  const book = await recalculate(
    workbook(
      {
        A1: { input: { type: "text", value: "K" } },
        B1: { input: { type: "text", value: "V" } },
        A2: { input: { type: "text", value: "x" } },
        B2: { input: { type: "number", value: 1 } },
        D1: { formula: "=SEQUENCE(4,2)" },
      },
      {
        pivots: [
          {
            id: "p",
            source: { sheetId: "s", ref: "A1:B2" },
            output: { sheetId: "s", ref: "D2" },
            rows: ["K"],
            columns: [],
            filters: [],
            values: [{ field: "V", aggregate: "sum" }],
          },
        ],
      },
    ),
  );
  const pivot = book.pivots[0];
  assert.throws(
    () => pivotEdits(book, pivot, computePivot(book, pivot), {}),
    /D2, E2, D3 and other cells already hold data/,
  );
});

test("review: a spill view of many anchors is built in linear time", () => {
  const cells = {};
  for (let row = 1; row <= 10000; row++)
    cells[`A${row}`] = {
      formula: "=SEQUENCE(1,2)",
      result: { type: "number", value: 1 },
      spill: {
        ref: `A${row}:B${row}`,
        results: [
          [
            { type: "number", value: 1 },
            { type: "number", value: 2 },
          ],
        ],
      },
    };
  const started = performance.now(),
    view = readView({ id: "s", name: "S", cells });
  assert.equal(view.cells.B10000.result.value, 2);
  assert.ok(performance.now() - started < 500);
});
