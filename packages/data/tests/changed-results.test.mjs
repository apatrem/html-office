// Review defect 7: an edit recorded in history holds the results that changed,
// not every formula of the workbook (264 KB per edit on the acceptance one).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EngineSession } from "../engine/adapter.mjs";
import { loadEngine } from "../tools/engine-node.mjs";
import { changedResults, applyResults } from "../model/spills.mjs";
import { captureCells } from "../model/history.mjs";

test("only changed results and the edited cells go into an edit's history entry", async () => {
  const book = JSON.parse(
      await readFile(new URL("../acceptance/model.json", import.meta.url)),
    ),
    session = new EngineSession(await loadEngine());
  try {
    session.load(book);
    const base = await session.calculate(),
      formulas = base.sheets.flatMap((s) =>
        Object.values(s.cells).filter((c) => c.formula),
      ).length;
    assert.ok(
      formulas > 500,
      `the acceptance workbook has ${formulas} formulas`,
    );
    // Change an input that few formulas read: the best of a few candidates.
    const inputs = base.sheets.flatMap((s) =>
      Object.entries(s.cells)
        .filter(([, c]) => c.input?.type === "number")
        .map(([ref, c]) => ({ sheet: s, ref, cell: c })),
    );
    let best;
    for (const { sheet, ref, cell } of inputs
      .filter((_, i) => i % 23 === 0)
      .slice(0, 12)) {
      session.load(base);
      const edits = [
        {
          sheetId: sheet.id,
          ref,
          cell: {
            ...cell,
            input: { type: "number", value: cell.input.value + 1 },
          },
        },
      ];
      session.editMany(edits);
      const delta = await session.calculateDelta(),
        changed = changedResults(base, edits, delta.results);
      if (!best || changed.length < best.changed.length)
        best = { sheet, ref, edits, delta, changed };
    }
    const { sheet, ref, edits, delta, changed } = best;
    assert.equal(
      delta.results.length,
      formulas,
      "the engine reports every formula",
    );
    assert.ok(
      changed.length < formulas / 5,
      `${changed.length} of ${formulas}`,
    );
    const refs = [...edits, ...changed],
      entry = {
        before: captureCells(base, refs),
        after: captureCells(base, refs),
      };
    const everything = [...edits, ...delta.results],
      all = JSON.stringify({
        before: captureCells(base, everything),
        after: captureCells(base, everything),
      }).length;
    assert.ok(JSON.stringify(entry).length < all / 2);
    // Applying the shorter list gives the same workbook as applying all.
    const shortcut = structuredClone(base),
      full = structuredClone(base);
    for (const target of [shortcut, full])
      target.sheets.find((s) => s.id === sheet.id).cells[ref] = edits[0].cell;
    applyResults(shortcut, changed);
    applyResults(full, delta.results);
    assert.deepEqual(shortcut, full);
    // An edited formula keeps its result even when that result is unchanged.
    const formula = Object.entries(base.sheets[0].cells).find(
        ([, c]) => c.formula,
      ),
      same = changedResults(
        base,
        [{ sheetId: base.sheets[0].id, ref: formula[0] }],
        [
          {
            sheetId: base.sheets[0].id,
            ref: formula[0],
            result: formula[1].result,
          },
        ],
      );
    assert.equal(same.length, 1);
    assert.equal(
      changedResults(
        base,
        [],
        [
          {
            sheetId: base.sheets[0].id,
            ref: formula[0],
            result: formula[1].result,
          },
        ],
      ).length,
      0,
    );
  } finally {
    session.dispose();
  }
});
