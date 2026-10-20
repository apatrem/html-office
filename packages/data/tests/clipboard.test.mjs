import test from "node:test";
import assert from "node:assert/strict";
import {
  translateFormula,
  parsePaste,
  rangePatches,
  copyRange,
  fillRange,
} from "../model/clipboard.mjs";
test("copy adjusts mixed/absolute, quoted cross-sheet and whole-row/column references without changing strings or functions", () => {
  assert.equal(
    translateFormula(
      "=A1+$B2+C$3+$D$4+'A1'!B2+Sheet1!C3+\"A1\"+LOG10(A1)",
      2,
      3,
    ),
    "=D3+$B4+F$3+$D$4+'A1'!E4+Sheet1!F5+\"A1\"+LOG10(D3)",
  );
  assert.equal(
    translateFormula("=SUM(A:C)+SUM($2:4)+A1!B2", 1, 1),
    "=SUM(B:D)+SUM($2:5)+A1!C3",
  );
  assert.equal(translateFormula("=A1+B$1+$A1", -1, -1), "=#REF!+A$1+#REF!");
  assert.equal(
    translateFormula('="say ""A1"""&\'O\'\'Brien\'!A1', 1, 0),
    '="say ""A1"""&\'O\'\'Brien\'!A2',
  );
});
test("Excel TSV keeps quoted multiline text, leading zeros and formula-like strings literal", () => {
  const values = parsePaste('0012\t2.5\tTRUE\n"a\tb\nc"\t=SUM(A1)\t', {});
  assert.deepEqual(
    values[0].map((c) => c.input),
    [
      { type: "text", value: "0012" },
      { type: "number", value: 2.5 },
      { type: "boolean", value: true },
    ],
  );
  assert.equal(values[1][0].input.value, "a\tb\nc");
  assert.equal(values[1][1].input.value, "=SUM(A1)");
  assert.equal(values[1][2].input.type, "blank");
});
test("Markdown tables preserve escaped pipes and reject malformed rectangles atomically", () => {
  const rows = parsePaste("| Name | Value |\n| --- | ---: |\n| a\\|b | 2 |", {
    syntax: "markdown",
  });
  assert.equal(
    parsePaste("Name | Value\n--- | ---\nx | 2")[1][1].input.value,
    2,
  );
  assert.equal(rows[1][0].input.value, "a|b");
  assert.equal(rows[1][1].input.value, 2);
  assert.throws(() => parsePaste("a\tb\nc"), /rectangular/);
  assert.throws(() => parsePaste('"unfinished\ttext'), /quote/i);
});
test("ambiguous locale and dates require an explicit typing choice", () => {
  assert.throws(() => parsePaste("1,234\t01/02/2026"), /ambiguous/i);
  assert.throws(() => parsePaste("01/02/2026"), /ambiguous/i);
  assert.equal(
    parsePaste("1,234", { typing: "en-US" })[0][0].input.value,
    1234,
  );
  assert.equal(
    parsePaste("1,234", { typing: "fr-FR" })[0][0].input.value,
    1.234,
  );
  assert.equal(
    parsePaste("01/02/2026", { typing: "text" })[0][0].input.type,
    "text",
  );
  const us = parsePaste("01/02/2026", { typing: "en-US" })[0][0].input,
    fr = parsePaste("01/02/2026", { typing: "fr-FR" })[0][0].input;
  assert.equal(us.type, "date");
  assert.equal(fr.value - us.value, 30);
  assert.throws(() => parsePaste("31/02/2026", { typing: "fr-FR" }), /date/i);
});
test("internal copy/fill preserve types and styles and shift formulas across a rectangular target", () => {
  const sheet = {
    id: "one",
    cells: {
      A1: { input: { type: "text", value: "001" }, role: "header" },
      B1: { formula: "=$A1+1", format: { kind: "number", digits: 2 } },
    },
  };
  const copied = copyRange(sheet, "A1:B1"),
    patches = rangePatches("two", "C3", copied.cells, {
      origin: copied.origin,
    });
  assert.equal(patches[0].cell.input.value, "001");
  assert.equal(patches[0].cell.role, "header");
  assert.equal(patches[1].cell.formula, "=$A3+1");
  const fill = fillRange(sheet, "B1:B3", "down");
  assert.equal(fill[1].cell.formula, "=$A2+1");
  assert.equal(fill[2].cell.formula, "=$A3+1");
  assert.throws(() => rangePatches("two", "XFD1048576", [[{}, {}]]), /bounds/);
});
