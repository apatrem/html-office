import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import init, { Model } from "../engine/vendor/ironcalc.mjs";
import { EngineSession } from "../engine/adapter.mjs";
await init({
  module_or_path: await readFile(
    new URL("../engine/vendor/ironcalc.wasm", import.meta.url),
  ),
});
const book = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
test("sheet creation and quoted renames return canonical formulas and survive a fresh engine load", async () => {
  const session = new EngineSession({ Model }),
    source = structuredClone(book);
  source.names = [{ name: "Participants", sheetId: "inputs", ref: "B2" }];
  source.sheets[1].cells.C2 = { formula: "=Participants+Inputs!B3" };
  try {
    session.load(source);
    const renamed = await session.organize({
      type: "rename",
      sheetId: "inputs",
      name: "Next year's Inputs",
    });
    const formula = renamed.formulas.find(
      (f) => f.sheetId === "summary" && f.ref === "B2",
    );
    assert.equal(
      formula.formula,
      "='Next year''s Inputs'!B2*'Next year''s Inputs'!B3",
    );
    assert.equal(
      renamed.results.find((r) => r.ref === "B2").result.value,
      2500,
    );
    const fresh = structuredClone(session.book);
    session.load(fresh);
    assert.equal(
      (await session.calculateDelta()).results.find((r) => r.ref === "C2")
        .result.value,
      125,
    );
    const groupId = session.book.groups.find(
      (g) => g.kind === "calculations",
    ).id;
    await session.organize({
      type: "create",
      id: "new_sheet",
      name: "Forecast",
      groupId,
    });
    assert.equal(session.book.sheets[2].id, "new_sheet");
    assert.equal(session.book.sheets[0].id, "inputs");
    session.edit("new_sheet", "A1", { formula: "='Next year''s Inputs'!B2*2" });
    assert.equal(
      (await session.calculateDelta()).results.find(
        (r) => r.sheetId === "new_sheet",
      ).result.value,
      200,
    );
  } finally {
    session.dispose();
  }
});
test("raw values retain full precision and distinguish text, errors, Boolean and blank", () => {
  const engine = new Model("types", "en", "UTC", "en");
  try {
    engine.pauseEvaluation();
    const cases = [
      ["=1/3", ["number", 1 / 3]],
      ["=0.1+0.2", ["number", 0.1 + 0.2]],
      ["=TRUE()", ["boolean", true]],
      ["'0012", ["text", "0012"]],
      ["'", ["text", ""]],
      ["=1/0", ["error", "#DIV/0!"]],
      ["=DATE(2026,1,1)", ["number", 46023]],
      ["=NA()", ["error", "#N/A"]],
    ];
    cases.forEach(([input], i) => engine.setUserInput(0, i + 1, 1, input));
    engine.resumeEvaluation();
    engine.evaluate();
    cases.forEach(([, expected], i) =>
      assert.deepEqual(engine.getCellValue(0, i + 1, 1), expected),
    );
    assert.deepEqual(engine.getCellValue(0, 100, 1), ["blank", undefined]);
    assert.notEqual(engine.getFormattedCellValue(0, 1, 1), String(1 / 3));
  } finally {
    engine.free();
  }
});
test("canonical model survives evaluation and cross-sheet edit, without binary authority", async () => {
  const session = new EngineSession({ Model });
  try {
    session.load(book);
    const first = await session.calculate();
    assert.deepEqual(first.sheets[0], book.sheets[0]);
    assert.equal(first.sheets[1].cells.B2.result.value, 2500);
    session.edit("inputs", "B2", {
      ...book.sheets[0].cells.B2,
      input: { type: "number", value: 140 },
    });
    const edited = await session.calculate();
    assert.equal(edited.sheets[1].cells.B2.result.value, 3500);
    assert.equal(edited.sheets[1].cells.B3.result.value, 25);
    assert.notEqual(first.snapshot.fingerprint, edited.snapshot.fingerprint);
    assert.deepEqual(book.sheets[0].cells.B2.input.value, 100);
    session.load(first);
    assert.equal(
      (await session.calculate()).sheets[1].cells.B2.result.value,
      2500,
    );
  } finally {
    session.dispose();
  }
});
test("typed input precision, named ranges and valid spreadsheet errors cross the adapter boundary", async () => {
  const source = structuredClone(book);
  source.names.push({ name: "Unit_Fee", sheetId: "inputs", ref: "B3" });
  source.sheets[0].cells.C1 = {
    input: { type: "number", value: 1.2345678901234567 },
  };
  source.sheets[0].cells.C2 = { input: { type: "number", value: -0 } };
  source.sheets[0].cells.C3 = { input: { type: "error", value: "#REF!" } };
  source.sheets[1].cells.C1 = { formula: "=Inputs!C1" };
  source.sheets[1].cells.C2 = { formula: "=Unit_Fee*Inputs!B2" };
  source.sheets[1].cells.C3 = { formula: "=Inputs!C3+1" };
  source.sheets[1].cells.DZ2001 = { formula: "=Inputs!C1+1" };
  const session = new EngineSession({ Model });
  try {
    session.load(source);
    const result = await session.calculate();
    assert.equal(result.sheets[1].cells.C1.result.value, 1.2345678901234567);
    assert.equal(result.sheets[1].cells.C2.result.value, 2500);
    assert.deepEqual(result.sheets[1].cells.C3.result, {
      type: "error",
      value: "#REF!",
    });
    assert.ok(Object.is(session.result(0, "C2").value, -0));
    assert.equal(
      result.sheets[1].cells.DZ2001.result.value,
      1.2345678901234567 + 1,
    );
  } finally {
    session.dispose();
  }
});
test("batch edits preflight the whole transaction and recalculate linked results once", async () => {
  const session = new EngineSession({ Model });
  try {
    session.load(book);
    assert.throws(
      () =>
        session.editMany([
          {
            sheetId: "inputs",
            ref: "B2",
            cell: { input: { type: "number", value: 140 } },
          },
          {
            sheetId: "unknown",
            ref: "B3",
            cell: { input: { type: "number", value: 30 } },
          },
        ]),
      /sheet/i,
    );
    assert.equal(
      (await session.calculate()).sheets[1].cells.B2.result.value,
      2500,
    );
    session.editMany([
      {
        sheetId: "inputs",
        ref: "B2",
        cell: { input: { type: "number", value: 140 } },
      },
      {
        sheetId: "inputs",
        ref: "B3",
        cell: { input: { type: "number", value: 30 } },
      },
    ]);
    assert.equal(
      (await session.calculate()).sheets[1].cells.B2.result.value,
      4200,
    );
    session.editMany([{ sheetId: "inputs", ref: "B3", cell: null }]);
    assert.equal("B3" in (await session.calculate()).sheets[0].cells, false);
  } finally {
    session.dispose();
  }
});
