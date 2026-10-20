import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import init, { Model } from "../engine/vendor/ironcalc.mjs";
import { EngineSession } from "../engine/adapter.mjs";
import { readModel, writeModel } from "../model/document.mjs";
import { snapshotState } from "../model/snapshots.mjs";
import { validationChoices, validationStatus } from "../model/validation.mjs";
await init({
  module_or_path: await readFile(
    new URL("../engine/vendor/ironcalc.wasm", import.meta.url),
  ),
});
const original = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
const input = (value) => ({
  input: { type: typeof value === "number" ? "number" : "text", value },
});
function fixture() {
  const book = structuredClone(original);
  book.id = "fictional-scenarios";
  book.title = "Fictional shared scenario model";
  book.sheets[0].cells = {
    A1: input("Scenario"),
    B1: input("Base"),
    A4: input("Base"),
    A5: input("Upside"),
    A6: input("Downside"),
    B4: input(0.1),
    B5: input(0.2),
    B6: input(-0.05),
    C4: input(0.2),
    C5: input(0.25),
    C6: input(0.1),
    B8: { formula: "=XLOOKUP(B1,A4:A6,B4:B6)" },
    C8: { formula: "=XLOOKUP(B1,A4:A6,C4:C6)" },
    B10: { formula: "=B8" },
    B11: { formula: "=C8" },
  };
  book.sheets[1].cells = {
    B1: { formula: "=1000*(1+Inputs!B8)" },
    B2: { formula: "=B1*Inputs!C8" },
    C2: input(0.2),
  };
  book.validations = [
    {
      id: "scenario",
      sheetId: "inputs",
      ref: "B1",
      source: {
        kind: "list",
        values: ["Base", "Upside", "Downside"].map((value) => ({
          type: "text",
          value,
        })),
      },
    },
    {
      id: "dependent",
      sheetId: "summary",
      ref: "C2",
      source: { kind: "range", sheetId: "inputs", ref: "B10:B11" },
    },
  ];
  book.scenario = { validationId: "scenario" };
  return book;
}
test("Base/Upside/Downside recalculate one shared model and dependent choices without copying assumptions", async () => {
  const session = new EngineSession({ Model }),
    source = fixture();
  try {
    session.load(source);
    for (const [name, revenue, profit, choices, valid] of [
      ["Base", 1100, 220, [0.1, 0.2], true],
      ["Upside", 1200, 300, [0.2, 0.25], true],
      ["Downside", 950, 95, [-0.05, 0.1], false],
    ]) {
      session.edit("inputs", "B1", input(name));
      const result = await session.calculate();
      assert.equal(result.sheets.length, 2);
      assert.equal(result.sheets[1].cells.B1.result.value, revenue);
      assert.equal(result.sheets[1].cells.B2.result.value, profit);
      assert.deepEqual(
        validationChoices(result, result.validations[1], {
          snapshotCurrent: true,
        }).values.map((v) => v.value),
        choices,
      );
      assert.equal(
        validationStatus(result, result.validations[1], "C2", {
          snapshotCurrent: true,
        }).state,
        valid ? "valid" : "invalid",
      );
      for (const ref of ["A4", "A5", "A6", "B4", "B5", "B6", "C4", "C5", "C6"])
        assert.deepEqual(
          result.sheets[0].cells[ref],
          source.sheets[0].cells[ref],
        );
      const saved = readModel(writeModel(result));
      assert.equal((await snapshotState(saved)).state, "current");
      session.load(saved);
      assert.equal(
        (await session.calculate()).sheets[1].cells.B2.result.value,
        profit,
      );
    }
  } finally {
    session.dispose();
  }
});
test("engine row edits persist relocated selector/source bindings, and deletion exposes a broken selector", async () => {
  const session = new EngineSession({ Model });
  try {
    session.load(fixture());
    await session.calculate();
    await session.structure({
      sheetId: "inputs",
      axis: "row",
      action: "insert",
      index: 1,
      count: 1,
    });
    assert.equal(session.book.validations[0].ref, "B2");
    assert.equal(session.book.validations[1].source.ref, "B11:B12");
    session.edit("inputs", "B2", input("Downside"));
    const changed = await session.calculate();
    assert.equal(changed.sheets[1].cells.B2.result.value, 95);
    session.load(readModel(writeModel(changed)));
    await session.structure({
      sheetId: "inputs",
      axis: "row",
      action: "delete",
      index: 2,
      count: 1,
    });
    assert.equal(session.book.validations[0].ref, "#REF!");
    assert.equal(
      validationStatus(session.book, session.book.validations[0], "#REF!")
        .state,
      "broken",
    );
    assert.deepEqual(session.book.sheets[1].cells.B2.result, {
      type: "error",
      value: "#REF!",
    });
    assert.equal(
      (await snapshotState(readModel(writeModel(session.book)))).state,
      "current",
    );
  } finally {
    session.dispose();
  }
});

test("scenario selector input constraints reject whole formula batches and metadata sync is atomic", async () => {
  const session = new EngineSession({ Model }),
    original = fixture();
  try {
    session.load(original);
    await session.calculate();
    assert.throws(
      () =>
        session.editMany([
          { sheetId: "inputs", ref: "B4", cell: input(99) },
          { sheetId: "inputs", ref: "B1", cell: { formula: '="Base"' } },
        ]),
      /selector.*input/i,
    );
    assert.equal(session.book.sheets[0].cells.B4.input.value, 0.1);
    assert.equal(
      (await session.calculate()).sheets[1].cells.B2.result.value,
      220,
    );
    session.configureValidations({ validations: [], scenario: null });
    session.edit("inputs", "B1", { formula: '="Base"' });
    await session.calculate();
    assert.throws(
      () =>
        session.configureValidations({
          validations: original.validations,
          scenario: original.scenario,
        }),
      /selector.*input/i,
    );
    assert.deepEqual(session.book.validations, []);
    assert.equal(session.book.scenario, undefined);
    session.edit("inputs", "B1", input("Base"));
    session.configureValidations({
      validations: original.validations,
      scenario: original.scenario,
    });
    const restored = await session.calculate();
    assert.equal(restored.scenario.validationId, "scenario");
    assert.equal(restored.sheets[1].cells.B2.result.value, 220);
  } finally {
    session.dispose();
  }
});
