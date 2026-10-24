import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import init, { Model } from "../engine/vendor/ironcalc.mjs";
import { EngineSession } from "../engine/adapter.mjs";
import { pivotEdits, pivotState } from "../model/pivot.mjs";
import { VERSION } from "../model/workbook.mjs";
import { pivotWorkbook, RECORDS } from "../fixtures/pivots.mjs";
await init({
  module_or_path: await readFile(
    new URL("../engine/vendor/ironcalc.wasm", import.meta.url),
  ),
});
const value = (computed, row, column) =>
  computed.cells.find(([r, c]) => r === row && c === column)?.[2].input.value;

test("pivot sums and averages are the doubles IronCalc's SUM and AVERAGE give", async () => {
  const values = [
      0.1,
      0.2,
      0.3,
      1e16,
      1,
      1,
      -1e16,
      3.3,
      1e-17,
      7.1,
      -2.2,
      0.7,
      1e100,
      1,
      -1e100,
      2.675,
      1 / 3,
      2 / 3,
    ],
    data = { A1: { input: { type: "text", value: "K" } } },
    checks = {};
  data.B1 = { input: { type: "text", value: "V" } };
  const groups = { a: [], b: [], c: [] };
  values.forEach((v, i) => {
    const key = "abc"[(i * 7) % 3],
      row = i + 2;
    data[`A${row}`] = { input: { type: "text", value: key } };
    data[`B${row}`] = { input: { type: "number", value: v } };
    groups[key].push(`Data!B${row}`);
  });
  Object.entries(groups).forEach(([key, refs], i) => {
    checks[`A${i + 1}`] = { formula: `=SUM(${refs.join(",")})` };
    checks[`B${i + 1}`] = { formula: `=AVERAGE(${refs.join(",")})` };
  });
  checks.A4 = { formula: `=SUM(Data!B2:B${values.length + 1})` };
  const pivot = {
    id: "p",
    source: { sheetId: "data" },
    output: { sheetId: "out", ref: "A1" },
    rows: ["K"],
    columns: [],
    filters: [],
    values: [
      { field: "V", aggregate: "sum" },
      { field: "V", aggregate: "average" },
    ],
  };
  const book = {
    version: VERSION,
    id: "precision",
    title: "Precision",
    dateSystem: "excel1900",
    locale: "en-US",
    sheets: [
      { id: "data", name: "Data", cells: data },
      { id: "checks", name: "Checks", cells: checks },
      { id: "out", name: "Out", cells: {} },
    ],
    groups: [],
    names: [],
    pivots: [pivot],
  };
  const session = new EngineSession({ Model });
  try {
    session.load(book);
    const computed = await session.pivot(pivot),
      results = session.book.sheets[1].cells;
    ["a", "b", "c"].forEach((key, i) => {
      assert.equal(value(computed, 1 + i, 0), key);
      assert.ok(
        Object.is(value(computed, 1 + i, 1), results[`A${i + 1}`].result.value),
        `SUM ${key}`,
      );
      assert.ok(
        Object.is(value(computed, 1 + i, 2), results[`B${i + 1}`].result.value),
        `AVERAGE ${key}`,
      );
    });
    assert.ok(Object.is(value(computed, 4, 1), results.A4.result.value));
  } finally {
    session.dispose();
  }
});

test("refresh follows scenario formulas through the engine and feeds dependents", async () => {
  const book = pivotWorkbook(),
    pivot = book.pivots[0],
    session = new EngineSession({ Model });
  // A formula reading the pivot's grand total.
  book.sheets[0].cells.H1 = { formula: "=SUM(B5:E9)" };
  try {
    session.load(book);
    const base = await session.pivot(pivot);
    // Rows: East, North, South, (blank); columns: Q1, Q2, Total.
    assert.deepEqual(
      base.cells
        .filter(([r]) => r >= 2)
        .map(([r, c, cell]) => [r, c, cell.input?.value ?? null]),
      [
        [2, 0, "East"],
        [2, 1, 30],
        [2, 3, 30],
        [3, 0, "North"],
        [3, 1, 150],
        [3, 2, 80],
        [3, 3, 230],
        [4, 0, "South"],
        [4, 1, 40],
        [4, 2, 80.5],
        [4, 3, 120.5],
        [5, 0, "(blank)"],
        [5, 2, 10],
        [5, 3, 10],
        [6, 0, "Total"],
        [6, 1, 220],
        [6, 2, 170.5],
        [6, 3, 390.5],
      ],
    );
    const first = pivotEdits(book, pivot, base, {
      fingerprint: base.fingerprint,
      at: new Date().toISOString(),
    });
    assert.equal(first.pivot.output.ref, "B3:E9");
    // The source currency format reaches value cells; labels stay text.
    const total = first.edits.find((e) => e.ref === "E9").cell;
    assert.deepEqual(total.format, {
      kind: "currency",
      currency: "EUR",
      digits: 2,
    });
    session.editMany(first.edits);
    let delta = await session.calculateDelta();
    assert.equal(
      delta.results.find((r) => r.sheetId === "summary" && r.ref === "H1")
        .result.value,
      390.5 * 4,
    );
    session.book.pivots = [first.pivot];
    assert.equal(
      (
        await pivotState(session.book, first.pivot, {
          formulaResultsCurrent: true,
        })
      ).state,
      "current",
    );
    // Switching the scenario changes Adjusted: the pivot is stale until refreshed.
    session.editMany([
      {
        sheetId: "inputs",
        ref: "B1",
        cell: { input: { type: "text", value: "Upside" } },
      },
    ]);
    await session.calculateDelta();
    assert.equal(
      (
        await pivotState(session.book, first.pivot, {
          formulaResultsCurrent: true,
        })
      ).state,
      "stale",
    );
    const upside = await session.pivot(first.pivot);
    // Each record's Adjusted value is IronCalc's product; the pivot adds them in
    // source order.
    assert.equal(
      upside.cells.find(([r, c]) => r === 6 && c === 3)[2].input.value,
      RECORDS.reduce((sum, record) => sum + record[4] * 1.1, 0),
    );
    assert.notEqual(upside.fingerprint, base.fingerprint);
  } finally {
    session.dispose();
  }
});
