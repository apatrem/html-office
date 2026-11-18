// F-02 readable multi-step formulas: every formula of the documented example
// (examples/valid/formulas.json) against independent hand-derived results,
// and the documented limits. Orders (fictional): North Tea 120/4, South
// Coffee 80/2, North Coffee 45/3, East Tea 200/5, South Tea 60/1, East
// Coffee 95/2; Amount totals 600, Units 17.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { recalculate } from "../tools/engine-node.mjs";
import { validateWorkbook } from "../model/workbook.mjs";

const example = async () =>
  JSON.parse(
    await readFile(
      new URL("../examples/valid/formulas.json", import.meta.url),
      "utf8",
    ),
  );
// A cell's result, or its spilled values row by row.
function values(cell) {
  if (cell.spill)
    return cell.spill.results.map((row) => row.map((v) => v.value));
  return cell.result.value;
}

test("the readable-formulas example gives the hand-derived results", async () => {
  const book = await recalculate(await example()),
    cells = book.sheets.find((s) => s.id === "summary").cells,
    expected = {
      // SORT(UNIQUE(Region)): the regions once, in order.
      A2: [["East"], ["North"], ["South"]],
      // MAP over the spilled regions: East 200+95, North 120+45, South 80+60.
      B2: [[295], [165], [140]],
      C2: [[7], [7], [3]],
      // LET names the total once: 295/600, 165/600, 140/600 to 3 places.
      D2: [[0.492], [0.275], [0.233]],
      // FILTER keeps orders of at least 95, in source order.
      F2: [["Tea"], ["Tea"], ["Coffee"]],
      G2: [[120], [45]],
      // TAKE(SORTBY(...)) keeps the two largest orders, whole rows.
      F7: [
        ["East", "Tea", 200],
        ["North", "Tea", 120],
      ],
      B7: 200,
      B8: "none",
      // search_mode -1 finds the last Coffee order.
      B9: 95,
      // A LAMBDA named by LET: 600/17 = 35.294…
      B10: 35.29,
      B11: 165,
      B12: 6,
      // BYROW: Amount/Units for each order.
      B14: [[30], [40], [15], [40], [60], [47.5]],
    };
  for (const [ref, value] of Object.entries(expected))
    assert.deepEqual(values(cells[ref]), value, ref);
  validateWorkbook(book);
});

test("documented limits of the pinned engine", async () => {
  const book = await example(),
    cells = book.sheets.find((s) => s.id === "summary").cells;
  Object.assign(cells, {
    // GROUPBY and PIVOTBY do not exist: pivot tables replace them.
    J1: { formula: "=GROUPBY(Region,Amount,SUM)" },
    J2: { formula: "=PIVOTBY(Region,Product,Amount,SUM)" },
    // Structured table references are not formulas IronCalc reads.
    J3: { formula: "=SUM(Orders[Amount])" },
    // A LET or LAMBDA name equal to a function or a named range fails.
    J4: { formula: "=LET(price,LAMBDA(x,x*2),price(3))" },
    J5: { formula: "=LET(amount,5,amount*2)" },
    // Criteria given as an array are not lifted: use MAP per criterion.
    J6: { formula: '=SUMIFS(Amount,Region,{"East";"North"})' },
    // ROUND over an array is not implemented: round inside MAP.
    J7: { formula: "=ROUND(Amount/3,1)" },
  });
  const result = (await recalculate(book)).sheets[0].cells,
    of = (ref) => result[ref].result.value;
  assert.equal(of("J1"), "#NAME?");
  assert.equal(of("J2"), "#NAME?");
  assert.equal(of("J3"), "#ERROR!");
  assert.equal(of("J4"), "#ERROR!");
  assert.equal(of("J5"), "#VALUE!");
  assert.equal(of("J6"), 0);
  assert.equal(result.J6.spill, undefined);
  assert.equal(of("J7"), "#N/IMPL");
  // Named ranges are rectangles: a named LAMBDA cannot be saved.
  book.names.push({ name: "Ratio", sheetId: "orders", ref: "LAMBDA(a,b,a/b)" });
  assert.throws(() => validateWorkbook(book));
});
