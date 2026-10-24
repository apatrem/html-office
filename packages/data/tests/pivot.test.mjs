import test from "node:test";
import assert from "node:assert/strict";
import {
  computePivot,
  pivotEdits,
  pivotRemovalEdits,
  pivotFingerprint,
  pivotState,
  validatePivots,
  ownerRects,
  pivotOwner,
  fieldItems,
  compareItems,
  checkPivot,
  resolveSource,
} from "../model/pivot.mjs";
import { validateWorkbook, VERSION } from "../model/workbook.mjs";
import { shiftWorkbook, validateStructure } from "../model/structure.mjs";
import { readModel, writeModel } from "../model/document.mjs";
import { pivotWorkbook } from "../fixtures/pivots.mjs";

const t = (value) => ({ input: { type: "text", value } });
const n = (value) => ({ input: { type: "number", value } });
function book(rows, pivot = {}) {
  const cells = {};
  rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell === undefined) return;
      cells[`${"ABCDEFGH"[c]}${r + 1}`] =
        cell === null
          ? { input: { type: "blank" } }
          : typeof cell === "object"
            ? cell
            : typeof cell === "number"
              ? n(cell)
              : t(cell);
    }),
  );
  return {
    version: VERSION,
    id: "b",
    title: "b",
    dateSystem: "excel1900",
    locale: "en-US",
    sheets: [
      { id: "data", name: "Data", cells },
      { id: "out", name: "Out", cells: {} },
    ],
    groups: [],
    names: [],
    pivots: [
      {
        id: "p",
        source: { sheetId: "data" },
        output: { sheetId: "out", ref: "B2" },
        rows: [],
        columns: [],
        filters: [],
        values: [],
        ...pivot,
      },
    ],
  };
}
// The computed table as rows of displayed scalars ("" for an empty position,
// "·" for a style-only cell).
function table(b, pivot = b.pivots[0]) {
  const out = computePivot(b, pivot),
    rows = Array.from({ length: out.height }, () => Array(out.width).fill(""));
  for (const [r, c, cell] of out.cells)
    rows[r][c] = cell.input
      ? cell.input.type === "blank"
        ? "blank"
        : cell.input.value
      : "·";
  return rows;
}
const sales = [
  ["Region", "Quarter", "Revenue", "Units"],
  ["North", "Q1", 100, 10],
  ["North", "Q2", 80, 8],
  ["South", "Q1", 40, 4],
  ["North", "Q1", 50, 5],
  ["South", "Q2", 60, 6],
];

test("rows × columns with SUM and totals from records", () => {
  const b = book(sales, {
    rows: ["Region"],
    columns: ["Quarter"],
    values: [{ field: "Revenue", aggregate: "sum" }],
  });
  validateWorkbook(b);
  assert.deepEqual(table(b), [
    ["Quarter", "Q1", "Q2", "Total"],
    ["Region", "Sum of Revenue", "Sum of Revenue", "Sum of Revenue"],
    ["North", 150, 80, 230],
    ["South", 40, 60, 100],
    ["Total", 190, 140, 330],
  ]);
});

test("COUNT counts non-blank values; AVERAGE totals average records", () => {
  const b = book(
    [
      ["Region", "Value"],
      ["A", 1],
      ["A", 2],
      ["A", 6],
      ["B", 10],
      ["B", "n/a"],
      ["C", "text only"],
      ["C", null],
    ],
    {
      rows: ["Region"],
      values: [
        { field: "Value", aggregate: "count" },
        { field: "Value", aggregate: "average" },
        { field: "Value", aggregate: "sum" },
      ],
    },
  );
  assert.deepEqual(table(b), [
    ["Region", "Count of Value", "Average of Value", "Sum of Value"],
    ["A", 3, 3, 9],
    ["B", 2, 10, 10],
    ["C", 1, "#DIV/0!", 0],
    // (1+2+6+10)/4, not the average of the group averages.
    ["Total", 6, 4.75, 19],
  ]);
});

test("errors propagate into SUM and AVERAGE in source order, not COUNT", () => {
  const b = book(
    [
      ["K", "V"],
      ["a", 1],
      ["a", { input: { type: "error", value: "#N/A" } }],
      ["a", { input: { type: "error", value: "#REF!" } }],
      ["b", 2],
    ],
    {
      rows: ["K"],
      values: [
        { field: "V", aggregate: "sum" },
        { field: "V", aggregate: "count" },
      ],
    },
  );
  assert.deepEqual(table(b).slice(1), [
    ["a", "#N/A", 3],
    ["b", 2, 1],
    ["Total", "#N/A", 4],
  ]);
});

test("typed grouping: no case folding or coercion, signed zeros equal, blanks last", () => {
  const b = book(
    [
      ["K", "V"],
      ["north", 1],
      ["North", 1],
      [5, 1],
      ["5", 1],
      [0, 1],
      [-0, 1],
      [undefined, 1],
      [null, 1],
      [{ input: { type: "boolean", value: true } }, 1],
      [{ input: { type: "date", value: 45000 } }, 1],
      ["", 1],
      [{ input: { type: "error", value: "#N/A" } }, 1],
    ],
    { rows: ["K"], values: [{ field: "V", aggregate: "count" }] },
  );
  const rows = table(b);
  assert.deepEqual(
    rows.slice(1, -1).map((r) => [r[0], r[1]]),
    [
      [0, 2],
      [5, 1],
      [45000, 1],
      ["", 1],
      ["5", 1],
      ["North", 1],
      ["north", 1],
      [true, 1],
      ["#N/A", 1],
      ["(blank)", 2],
    ],
  );
  assert.equal(rows.at(-1)[1], 12);
  assert.ok(
    compareItems({ type: "text", value: "b" }, { type: "text", value: "A" }) >
      0,
  );
});

test("filters keep typed include lists; empty results leave values empty", () => {
  const filtered = book(sales, {
    rows: ["Region"],
    filters: [{ field: "Quarter", values: [{ type: "text", value: "Q1" }] }],
    values: [{ field: "Revenue", aggregate: "sum" }],
  });
  assert.deepEqual(table(filtered), [
    ["Region", "Sum of Revenue"],
    ["North", 150],
    ["South", 40],
    ["Total", 190],
  ]);
  const none = book(sales, {
    rows: ["Region"],
    columns: ["Quarter"],
    filters: [{ field: "Quarter", values: [{ type: "text", value: "Q9" }] }],
    values: [{ field: "Revenue", aggregate: "sum" }],
  });
  // The filtered field cannot also be a column; use another one.
  assert.throws(() => validateWorkbook(none), /appear once/);
  none.pivots[0].columns = [];
  assert.deepEqual(table(none), [
    ["Region", "Sum of Revenue"],
    ["Total", "·"],
  ]);
});

test("layouts without row or column fields and with two column fields", () => {
  const columnsOnly = book(sales, {
    columns: ["Quarter"],
    values: [{ field: "Units", aggregate: "sum" }],
  });
  assert.deepEqual(table(columnsOnly), [
    ["Quarter", "Q1", "Q2", "Total"],
    ["·", "Sum of Units", "Sum of Units", "Sum of Units"],
    ["Total", 19, 14, 33],
  ]);
  const totalOnly = book(sales, {
    values: [
      { field: "Units", aggregate: "sum" },
      { field: "Revenue", aggregate: "average" },
    ],
  });
  assert.deepEqual(table(totalOnly), [
    ["·", "Sum of Units", "Average of Revenue"],
    ["Total", 33, 66],
  ]);
  const twoColumns = book(sales, {
    rows: ["Region"],
    columns: ["Quarter", "Units"],
    values: [{ field: "Revenue", aggregate: "sum" }],
  });
  const rows = table(twoColumns);
  assert.equal(rows.length, 2 + 1 + 2 + 1);
  assert.deepEqual(rows[0].slice(0, 3), ["Quarter", "Q1", "Q1"]);
  assert.deepEqual(rows[1].slice(0, 3), ["Units", 4, 5]);
  assert.deepEqual(rows.at(-1).at(-1), 330);
});

test("validation rejects unsafe definitions", () => {
  const ok = book(sales, {
    rows: ["Region"],
    values: [{ field: "Revenue", aggregate: "sum" }],
  });
  validateWorkbook(ok);
  const bad = (patch, pattern) => {
    const b = structuredClone(ok);
    patch(b);
    assert.throws(() => validatePivots(b), pattern);
  };
  bad((b) => (b.pivots[0].values = []), /1–8 values/);
  bad(
    (b) => (b.pivots[0].values[0].aggregate = "max"),
    /sum, count or average/,
  );
  bad((b) => (b.pivots[0].output.sheetId = "data"), /another sheet/);
  bad((b) => (b.pivots[0].output.ref = "#REF!"), /Invalid address/);
  bad((b) => (b.pivots[0].colour = "x"), /unknown field colour/);
  bad(
    (b) =>
      b.pivots.push({
        ...structuredClone(b.pivots[0]),
        id: "q",
        output: { sheetId: "out", ref: "B2" },
      }),
    /cannot overlap/,
  );
  bad(
    (b) =>
      Object.assign(b.pivots[0], {
        source: { sheetId: "data", ref: "A1:D6" },
        output: { sheetId: "data", ref: "C3" },
      }),
    /own source/,
  );
  bad(
    (b) => (b.pivots[0].refreshed = { fingerprint: "x", at: "now" }),
    /refresh stamp/,
  );
});

test("missing and duplicate fields, deleted sources and missing results explain themselves", () => {
  const b = book(
    [
      ["Region", "Region", "V"],
      ["a", "b", 1],
    ],
    {
      rows: ["Region"],
      values: [{ field: "V", aggregate: "sum" }],
    },
  );
  assert.throws(
    () => computePivot(b, b.pivots[0]),
    /More than one source column/,
  );
  b.pivots[0].rows = ["Zone"];
  assert.throws(() => computePivot(b, b.pivots[0]), /no column named "Zone"/);
  b.pivots[0].rows = [];
  b.pivots[0].source.ref = "#REF!";
  assert.throws(() => computePivot(b, b.pivots[0]), /was deleted/);
  b.pivots[0].source = { sheetId: "data" };
  b.sheets[0].cells.C2 = { formula: "=1+1" };
  assert.throws(() => computePivot(b, b.pivots[0]), /no calculated result/);
});

test("pivotEdits owns its range: collisions, release, styles and shrinking", () => {
  const b = book(sales, {
    rows: ["Region"],
    values: [{ field: "Revenue", aggregate: "sum" }],
  });
  const out = b.sheets[1].cells;
  out.C3 = n(1);
  const computed = computePivot(b, b.pivots[0]),
    stamp = { fingerprint: "a".repeat(64), at: "2026-10-24T00:00:00.000Z" };
  assert.throws(
    () => pivotEdits(b, b.pivots[0], computed, stamp),
    /needs B2:C5 on "Out", but C3 already hold data/,
  );
  delete out.C3;
  out.B4 = { style: { bold: true } };
  const first = pivotEdits(b, b.pivots[0], computed, stamp);
  assert.equal(first.pivot.output.ref, "B2:C5");
  for (const edit of first.edits) out[edit.ref] = edit.cell;
  assert.deepEqual(out.B4, {
    input: { type: "text", value: "South" },
    cellStyle: "rowHeader",
    style: { bold: true },
  });
  b.pivots[0] = first.pivot;
  // Refreshing over its own cells is allowed; a filter shrinks the table.
  const narrower = {
    ...first.pivot,
    filters: [{ field: "Region", values: [{ type: "text", value: "North" }] }],
  };
  narrower.rows = [];
  const second = pivotEdits(b, narrower, computePivot(b, narrower), {
    previous: first.pivot,
    ...stamp,
  });
  assert.equal(second.pivot.output.ref, "B2:C3");
  for (const edit of second.edits)
    if (edit.cell === null) delete out[edit.ref];
    else out[edit.ref] = edit.cell;
  assert.equal(out.C5, undefined);
  assert.deepEqual(out.B4, { style: { bold: true } });
  // Moving to another anchor releases the old range.
  const moved = { ...second.pivot, output: { sheetId: "out", ref: "F10" } },
    third = pivotEdits(b, moved, computePivot(b, moved), {
      previous: second.pivot,
      ...stamp,
    });
  assert.ok(third.edits.some((e) => e.ref === "B2" && e.cell === null));
  assert.ok(
    third.edits.some((e) => e.ref === "G11" && e.cell.input?.value === 230),
  );
  // A second pivot cannot grow into another's output.
  b.pivots = [
    second.pivot,
    { ...narrower, id: "q", output: { sheetId: "out", ref: "B1" } },
  ];
  assert.throws(
    () => pivotEdits(b, b.pivots[1], computePivot(b, b.pivots[1]), stamp),
    /overlap pivot "p"/,
  );
  const removal = pivotRemovalEdits(b, second.pivot);
  assert.ok(removal.every((e) => e.cell === null || !e.cell.input));
});

test("ownership lookup", () => {
  const b = book(sales, { values: [{ field: "Revenue", aggregate: "sum" }] });
  b.pivots[0].output.ref = "B2:D5";
  const rects = ownerRects(b);
  assert.equal(pivotOwner(rects, "out", "C3")?.id, "p");
  assert.equal(pivotOwner(rects, "out", "E3"), undefined);
  assert.equal(pivotOwner(rects, "data", "C3"), undefined);
});

test("structural edits move pivots whole and refuse splits", () => {
  const b = book(sales, { values: [{ field: "Revenue", aggregate: "sum" }] });
  b.pivots[0].source.ref = "A1:D6";
  b.pivots[0].output.ref = "B3:D6";
  const command = (sheetId, axis, action, index, count = 1) => ({
    sheetId,
    axis,
    action,
    index,
    count,
  });
  const down = shiftWorkbook(b, command("out", "row", "insert", 2));
  assert.equal(down.pivots[0].output.ref, "B4:D7");
  const right = shiftWorkbook(b, command("out", "column", "insert", 1, 2));
  assert.equal(right.pivots[0].output.ref, "D3:F6");
  assert.equal(
    shiftWorkbook(b, command("out", "row", "insert", 7)).pivots[0].output.ref,
    "B3:D6",
  );
  for (const [axis, action, index] of [
    ["row", "insert", 4],
    ["row", "delete", 6],
    ["column", "delete", 2],
    ["column", "insert", 3],
  ])
    assert.throws(
      () => validateStructure(command("out", axis, action, index), b),
      /split pivot|remove part of pivot/,
    );
  const source = shiftWorkbook(b, command("data", "row", "delete", 3, 2));
  assert.equal(source.pivots[0].source.ref, "A1:D4");
  const gone = shiftWorkbook(b, command("data", "column", "delete", 1, 4));
  assert.equal(gone.pivots[0].source.ref, "#REF!");
});

test("fingerprint follows values, not position; state is derived", async () => {
  const b = book(sales, {
    rows: ["Region"],
    values: [{ field: "Revenue", aggregate: "sum" }],
  });
  b.pivots[0].source.ref = "A1:D6";
  assert.deepEqual(await pivotState(b, b.pivots[0]), { state: "never" });
  const fingerprint = await pivotFingerprint(b, b.pivots[0]);
  b.pivots[0].refreshed = { fingerprint, at: "2026-10-24T00:00:00.000Z" };
  assert.equal((await pivotState(b, b.pivots[0])).state, "current");
  const shifted = shiftWorkbook(b, {
    sheetId: "data",
    axis: "row",
    action: "insert",
    index: 1,
    count: 3,
  });
  assert.equal(await pivotFingerprint(shifted, shifted.pivots[0]), fingerprint);
  // An empty record inside the source does not change the revision either.
  const gap = shiftWorkbook(b, {
    sheetId: "data",
    axis: "row",
    action: "insert",
    index: 3,
    count: 1,
  });
  assert.equal(await pivotFingerprint(gap, gap.pivots[0]), fingerprint);
  // An unused column's value does not count; a used one does.
  b.sheets[0].cells.D2 = n(99);
  assert.equal((await pivotState(b, b.pivots[0])).state, "current");
  b.sheets[0].cells.C2 = n(101);
  assert.equal((await pivotState(b, b.pivots[0])).state, "stale");
  b.sheets[0].cells.C2 = {
    formula: "=100",
    result: { type: "number", value: 100 },
  };
  assert.equal((await pivotState(b, b.pivots[0])).state, "unverified");
  assert.equal(
    (await pivotState(b, b.pivots[0], { formulaResultsCurrent: true })).state,
    "current",
  );
  b.pivots[0].rows = ["Zone"];
  assert.equal((await pivotState(b, b.pivots[0])).state, "error");
});

test("definitions round-trip through the 0.2 document with a row-table source", () => {
  const b = pivotWorkbook();
  const text = writeModel(b),
    stored = JSON.parse(text);
  assert.ok(stored.sheets.find((s) => s.id === "sales").table);
  const back = readModel(text);
  assert.deepEqual(back.pivots, b.pivots);
  // Whole-sheet source: the table's used range, header in row 1.
  const items = fieldItems(back, back.pivots[0], "Region").items;
  assert.deepEqual(
    items.map((v) => v.value ?? "blank"),
    ["East", "North", "South", "blank"],
  );
});

test("review: stored outputs are bounded and unrefreshed pivots own only their anchor", () => {
  const b = book(sales, { values: [{ field: "Revenue", aggregate: "sum" }] });
  b.pivots[0].output.ref = "B3:C5";
  assert.throws(() => validatePivots(b), /owns only its anchor/);
  b.pivots[0].refreshed = {
    fingerprint: "a".repeat(64),
    at: "2026-10-24T00:00:00.000Z",
  };
  validatePivots(b);
  b.pivots[0].output.ref = "A1:XFD1048576";
  assert.throws(() => validatePivots(b), /cannot exceed 200000 cells/);
});

test("review: rows populated only in unused columns are records; overflow is #NUM!", () => {
  const b = book(
    [
      ["K", "V", "Notes"],
      ["a", 1e308],
      ["a", 1e308],
      [undefined, undefined, "existing record"],
    ],
    {
      rows: ["K"],
      values: [
        { field: "V", aggregate: "sum" },
        { field: "V", aggregate: "average" },
        { field: "V", aggregate: "count" },
      ],
    },
  );
  assert.deepEqual(table(b).slice(1), [
    ["a", "#NUM!", "#NUM!", 2],
    ["(blank)", 0, "#DIV/0!", 0],
    ["Total", "#NUM!", "#NUM!", 2],
  ]);
});

test("review: unresolved header formulas and filter items wait for results", async () => {
  const b = book(
    [
      [{ formula: '="K"' }, "V"],
      ["a", 1],
      [{ formula: '="b"' }, 2],
    ],
    { values: [{ field: "V", aggregate: "sum" }], rows: ["K"] },
  );
  // The header names no field yet; the worker recalculates before resolving it.
  assert.equal(checkPivot(b, b.pivots[0]).unresolved, true);
  assert.throws(() => computePivot(b, b.pivots[0]), /no column named "K"/);
  b.sheets[0].cells.A1.result = { type: "text", value: "K" };
  assert.equal(
    checkPivot(b, b.pivots[0], { formulaResultsCurrent: false }).unresolved,
    true,
  );
  assert.equal(fieldItems(b, b.pivots[0], "K").unresolved, true);
  b.sheets[0].cells.A3.result = { type: "text", value: "b" };
  assert.deepEqual(
    fieldItems(b, b.pivots[0], "K", { formulaResultsCurrent: true }).items.map(
      (v) => v.value,
    ),
    ["a", "b"],
  );
  assert.equal(
    fieldItems(b, b.pivots[0], "K", { formulaResultsCurrent: false })
      .unresolved,
    true,
  );
});

test("review: oversized cached bounds fall back to the exact used range", () => {
  const b = book(sales, { values: [{ field: "Revenue", aggregate: "sum" }] });
  b.sheets[0].cells.XFD1000 = { style: { bold: true } };
  const bounds = () => ({ rows: 1000, columns: 16384 });
  assert.deepEqual(resolveSource(b, b.pivots[0], { bounds }).rect, {
    top: 1,
    left: 1,
    bottom: 6,
    right: 4,
  });
});

test("re-verification: unused-column formulas and unverified headers are not trusted", async () => {
  const b = book(
    [
      ["K", "V", "Notes"],
      ["a", 1],
      [undefined, undefined, { formula: '="note"', result: { type: "blank" } }],
    ],
    { rows: ["K"], values: [{ field: "V", aggregate: "sum" }] },
  );
  const fingerprint = await pivotFingerprint(b, b.pivots[0]);
  b.pivots[0].refreshed = { fingerprint, at: "2026-10-24T00:00:00.000Z" };
  assert.equal((await pivotState(b, b.pivots[0])).state, "unverified");
  assert.equal(
    (await pivotState(b, b.pivots[0], { formulaResultsCurrent: true })).state,
    "current",
  );
  b.sheets[0].cells.A1 = {
    formula: '="K"',
    result: { type: "text", value: "K" },
  };
  assert.equal(
    fieldItems(b, b.pivots[0], "K", { formulaResultsCurrent: false })
      .unresolved,
    true,
  );
});

test("whole-sheet sources leave out other pivots' outputs on their sheet", () => {
  const b = book(sales, {
    rows: ["Region"],
    values: [{ field: "Revenue", aggregate: "sum" }],
  });
  b.sheets[0].cells.G1 = t("Region");
  b.sheets[0].cells.H1 = t("Sum of Revenue");
  b.pivots.push({
    id: "q",
    source: { sheetId: "data", ref: "A1:D6" },
    output: { sheetId: "data", ref: "G1:H4" },
    rows: ["Region"],
    columns: [],
    filters: [],
    values: [{ field: "Revenue", aggregate: "sum" }],
    refreshed: { fingerprint: "a".repeat(64), at: "2026-10-24T00:00:00.000Z" },
  });
  validatePivots(b);
  assert.deepEqual(resolveSource(b, b.pivots[0]).rect, {
    top: 1,
    left: 1,
    bottom: 6,
    right: 4,
  });
  assert.equal(table(b).at(-1)[1], 330);
});
