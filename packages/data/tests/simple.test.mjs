import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import init, { Model } from "../engine/vendor/ironcalc.mjs";
import { EngineSession } from "../engine/adapter.mjs";
import { analyse, evaluateSimple } from "../bench/storage/simple.mjs";
await init({
  module_or_path: await readFile(
    new URL("../engine/vendor/ironcalc.wasm", import.meta.url),
  ),
});
test("eligible dependencies are conservative; no fallback to cached non-simple results", async () => {
  const book = JSON.parse(
    await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
  );
  const cells = book.sheets[1].cells;
  cells.C1 = { formula: "=NPV(0.1,B2:B3)" };
  cells.C2 = { formula: "=C1+1" };
  cells.C3 = { formula: "=SUM(B2:B3)" };
  cells.C4 = { formula: "=ROUND(B2,2)" };
  const a = analyse(book);
  assert.equal(a.eligible.has("summary!C2"), false);
  assert.equal(a.eligible.has("summary!C3"), true);
  assert.equal(a.classes["round-if"], 1);
  const session = new EngineSession({ Model });
  try {
    session.load(book);
    const calculated = await session.calculate();
    const values = evaluateSimple(calculated, a);
    for (const [key, value] of values) {
      const e = a.formulas.get(key);
      assert.deepEqual(
        value,
        calculated.sheets.find((s) => s.id === e.sheetId).cells[e.ref].result,
      );
    }
  } finally {
    session.dispose();
  }
});
test("cycles, unsupported syntax and unknown names remain engine-only", async () => {
  const book = JSON.parse(
    await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
  );
  const c = book.sheets[1].cells;
  c.C1 = { formula: "=C2" };
  c.C2 = { formula: "=C1" };
  c.C3 = { formula: "=UnknownName+1" };
  c.C4 = { formula: "=2^3" };
  const a = analyse(book);
  for (const ref of ["C1", "C2", "C3", "C4"])
    assert.equal(a.eligible.has("summary!" + ref), false);
});
