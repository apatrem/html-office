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
