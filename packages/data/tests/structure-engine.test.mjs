import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import init, { Model } from "../engine/vendor/ironcalc.mjs";
import { EngineSession } from "../engine/adapter.mjs";
import { readModel, writeModel } from "../model/document.mjs";
await init({
  module_or_path: await readFile(
    new URL("../engine/vendor/ironcalc.wasm", import.meta.url),
  ),
});
const fixture = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
for (const axis of ["row", "column"])
  test(`${axis} insertion/deletion returns engine reference rewrites and reloadable broken names`, async () => {
    const book = structuredClone(fixture);
    book.names = [{ name: "Metric", sheetId: "inputs", ref: "B2" }];
    book.sheets[1].cells.C2 = { formula: "=Metric+Inputs!$B$2+Inputs!B$3" };
    book.sheets[1].cells.D2 = { formula: "=Metric" };
    const session = new EngineSession({ Model });
    try {
      session.load(book);
      assert.equal(
        (await session.calculate()).sheets[1].cells.C2.result.value,
        225,
      );
      const insert = {
        sheetId: "inputs",
        axis,
        action: "insert",
        index: 2,
        count: 1,
      };
      const delta = await session.structure(insert),
        moved = axis === "row" ? "B3" : "C2";
      assert.equal(session.book.names[0].ref, moved);
      assert.equal(
        delta.results.find((r) => r.sheetId === "summary" && r.ref === "C2")
          .result.value,
        225,
      );
      assert.match(
        delta.formulas.find((r) => r.sheetId === "summary" && r.ref === "C2")
          .formula,
        axis === "row" ? /\$B\$3/ : /\$C\$2/,
      );
      const removed = await session.structure({
        ...insert,
        action: "delete",
        index: 3,
      });
      assert.equal(session.book.names[0].ref, "#REF!");
      assert.deepEqual(
        removed.results.find((r) => r.sheetId === "summary" && r.ref === "D2")
          .result,
        { type: "error", value: "#REF!" },
      );
      const saved = writeModel(session.book);
      assert.equal(saved.includes("__office_"), false);
      const restored = readModel(saved);
      assert.equal(restored.sheets[1].cells.D2.formula, "=Metric");
      session.load(restored);
      const reopened = await session.calculate();
      assert.deepEqual(reopened.sheets[1].cells.D2.result, {
        type: "error",
        value: "#REF!",
      });
      assert.deepEqual(book.names, [
        { name: "Metric", sheetId: "inputs", ref: "B2" },
      ]);
    } finally {
      session.dispose();
    }
  });
test("a partially deleted named range keeps the remaining values", async () => {
  const book = structuredClone(fixture);
  book.names = [{ name: "Block", sheetId: "inputs", ref: "A1:B3" }];
  book.sheets[1].cells.C1 = { formula: "=SUM(Block)" };
  const session = new EngineSession({ Model });
  try {
    session.load(book);
    await session.structure({
      sheetId: "inputs",
      axis: "row",
      action: "delete",
      index: 2,
      count: 1,
    });
    assert.equal(session.book.names[0].ref, "A1:B2");
    assert.equal(session.book.sheets[1].cells.C1.result.value, 25);
  } finally {
    session.dispose();
  }
});

// Review defect 2: IronCalc turns the deleted end of a range into #REF!
// (=SUM(A2:#REF!), =SUM(#REF!:A3)) and an interior deletion into a shorter
// range. Data shrinks a range as Excel does: it breaks only when all of it
// is deleted.
const cells = {
  A1: 1,
  A2: 2,
  A3: 3,
  A4: 4,
  B1: 10,
  C1: 20,
  D1: 30,
  B2: 5,
};
const sheetOne = () =>
  Object.fromEntries(
    Object.entries(cells).map(([ref, value]) => [
      ref,
      { input: { type: "number", value } },
    ]),
  );
const row = (index, count = 1) => ({
  axis: "row",
  action: "delete",
  index,
  count,
});
const column = (index, count = 1) => ({
  axis: "column",
  action: "delete",
  index,
  count,
});
// [formula, command, formula after, value after]
const rangeCases = [
  ["=SUM(Sheet1!A2:A3)", row(3), "=SUM(Sheet1!A2)", 2],
  ["=SUM(Sheet1!A2:A3)", row(2), "=SUM(Sheet1!A2)", 3],
  ["=SUM(Sheet1!A2:A3)", row(2, 2), "=SUM(#REF!)", "#REF!"],
  ["=SUM(Sheet1!A2:A3)", row(1, 2), "=SUM(Sheet1!A1)", 3],
  ["=SUM(Sheet1!A2:A4)", row(2), "=SUM(Sheet1!A2:A3)", 7],
  ["=SUM(Sheet1!A2:A4)", row(3), "=SUM(Sheet1!A2:A3)", 6],
  ["=SUM(Sheet1!A2:A4)", row(4), "=SUM(Sheet1!A2:A3)", 5],
  // Written backwards, it is the same range.
  ["=SUM(Sheet1!A4:A2)", row(4), "=SUM(Sheet1!A2:A3)", 5],
  ["=SUM(Sheet1!A2:A4)", row(3, 2), "=SUM(Sheet1!A2)", 2],
  ["=SUM(Sheet1!A2:A4)", row(1, 3), "=SUM(Sheet1!A1)", 4],
  ["=SUM(Sheet1!$A$2:$A$4)", row(4), "=SUM(Sheet1!$A$2:$A$3)", 5],
  ["=SUM(Sheet1!A$2:A$4)", row(2), "=SUM(Sheet1!A$2:A$3)", 7],
  ["=SUM(Sheet1!A2:B3)", row(3), "=SUM(Sheet1!A2:B2)", 7],
  ["=SUM(Sheet1!A1:B2)", row(1), "=SUM(Sheet1!A1:B1)", 7],
  ["=SUM('Sheet1'!A2:A3)", row(3), "=SUM(Sheet1!A2)", 2],
  [
    '=SUM(Sheet1!A2:A3)+SUM(Sheet1!A3:A4)&"A2:A3"',
    row(3),
    '=SUM(Sheet1!A2)+SUM(Sheet1!A3)&"A2:A3"',
    "6A2:A3",
  ],
  ["=SUM(Sheet1!B1:D1)", column(2), "=SUM(Sheet1!B1:C1)", 50],
  ["=SUM(Sheet1!B1:D1)", column(4), "=SUM(Sheet1!B1:C1)", 30],
  ["=SUM(Sheet1!B1:D1)", column(1, 2), "=SUM(Sheet1!A1:B1)", 50],
  ["=SUM(Sheet1!B1:D1)", column(2, 3), "=SUM(#REF!)", "#REF!"],
  ["=SUM(Sheet1!$B$1:$D$1)", column(4), "=SUM(Sheet1!$B$1:$C$1)", 30],
  ["=SUM(Sheet1!B:D)", column(2), "=SUM(Sheet1!B:C)", 50],
  ["=SUM(Sheet1!B:D)", column(4), "=SUM(Sheet1!B:C)", 35],
  ["=SUM(Sheet1!2:4)", row(2), "=SUM(Sheet1!2:3)", 7],
  ["=SUM(Sheet1!2:4)", row(4), "=SUM(Sheet1!2:3)", 10],
  // Unchanged: another sheet, a single cell, an insertion, a range already broken.
  ["=SUM(Other!B1:B2)", row(1), "=SUM(Other!B1:B2)", 0],
  ["=Sheet1!A3", row(3), "=#REF!", "#REF!"],
  [
    "=SUM(Sheet1!A1:A2)",
    { axis: "row", action: "insert", index: 2, count: 1 },
    "=SUM(Sheet1!A1:A3)",
    3,
  ],
];
for (const [formula, command, expected, value] of rangeCases)
  test(`deleting ${command.axis} ${command.index}+${command.count} turns ${formula} into ${expected}`, async () => {
    const book = structuredClone(fixture);
    book.sheets[0].name = "Sheet1";
    book.sheets[1].name = "Other";
    book.sheets[0].cells = sheetOne();
    book.sheets[1].cells = { A1: { formula } };
    const session = new EngineSession({ Model });
    try {
      session.load(book);
      const delta = await session.structure({ sheetId: "inputs", ...command });
      assert.equal(delta.formulas[0].formula, expected);
      assert.equal(session.book.sheets[1].cells.A1.formula, expected);
      const result = session.book.sheets[1].cells.A1.result;
      assert.deepEqual(
        result,
        typeof value === "number"
          ? { type: "number", value }
          : value.startsWith("#")
            ? { type: "error", value }
            : { type: "text", value },
      );
      // The saved text reloads to the same result.
      const reloaded = new EngineSession({ Model });
      try {
        reloaded.load(readModel(writeModel(session.book)));
        assert.deepEqual(
          (await reloaded.calculate()).sheets[1].cells.A1.result,
          result,
        );
      } finally {
        reloaded.dispose();
      }
    } finally {
      session.dispose();
    }
  });

test("a sheet name with accents or other letters does not hide a range from the repair", async () => {
  const book = structuredClone(fixture);
  book.sheets[0].name = "Réel";
  book.sheets[0].cells = sheetOne();
  book.sheets[1].cells = { A1: { formula: "=SUM(Réel!A2:A4)" } };
  const session = new EngineSession({ Model });
  try {
    session.load(book);
    const delta = await session.structure({ sheetId: "inputs", ...row(4) });
    assert.equal(delta.formulas[0].formula, "=SUM(Réel!A2:A3)");
    assert.equal(session.book.sheets[1].cells.A1.result.value, 5);
  } finally {
    session.dispose();
  }
});
