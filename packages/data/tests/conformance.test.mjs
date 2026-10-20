import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import init, { Model } from "../engine/vendor/ironcalc.mjs";
import { EngineSession } from "../engine/adapter.mjs";
import { readModel, writeModel } from "../model/document.mjs";
import {
  CONFORMANCE_FAMILIES,
  conformanceFixture,
  conformanceDifferences,
} from "../fixtures/conformance.mjs";
await init({
  module_or_path: await readFile(
    new URL("../engine/vendor/ironcalc.wasm", import.meta.url),
  ),
});
for (const family of CONFORMANCE_FAMILIES)
  test(`${family}: frozen reference values, typed errors and canonical round trip`, async () => {
    const { book, fixture } = await conformanceFixture(family),
      session = new EngineSession({ Model });
    try {
      session.load(book);
      const result = await session.calculate();
      assert.deepEqual(conformanceDifferences(result, fixture), []);
      const saved = readModel(writeModel(result));
      session.load(saved);
      assert.deepEqual(
        conformanceDifferences(await session.calculate(), fixture),
        [],
      );
      const delta = await session.structure({
        sheetId: "case_1",
        axis: "row",
        action: "insert",
        index: 1,
        count: 1,
      });
      assert.deepEqual(
        delta.results.find((r) => r.sheetId === "case_1" && r.ref === "H2")
          .result,
        fixture.cases[0].expected,
      );
      assert.equal(
        session.book.sheets[0].cells.H2.formula,
        fixture.cases[0].afterRowInsertion ?? fixture.cases[0].formula,
      );
    } finally {
      session.dispose();
    }
  });
