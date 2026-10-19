import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import init, { Model } from "../engine/vendor/ironcalc.mjs";
import { encodeWorkbook, decodeWorkbook } from "../bench/storage/encodings.mjs";
import { structuralEdit, writeCell } from "../bench/storage/operations.mjs";
await init({
  module_or_path: await readFile(
    new URL("../engine/vendor/ironcalc.wasm", import.meta.url),
  ),
});
const fixture = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
for (const encoding of ["per-cell", "rows", "columns", "csv", "tsv"])
  test(`${encoding}: range write and row/column edits preserve cross-sheet references`, async () => {
    let book = decodeWorkbook(encodeWorkbook(fixture, encoding));
    writeCell(book, "inputs", "B2", { input: { type: "number", value: 140 } });
    book = await structuralEdit(
      book,
      { Model },
      { sheetId: "inputs", axis: "row", index: 2 },
    );
    assert.equal(book.sheets[0].cells.B3.input.value, 140);
    assert.equal(book.sheets[1].cells.B2.formula, "=Inputs!B3*Inputs!B4");
    assert.equal(book.sheets[1].cells.B2.result.value, 3500);
    book = decodeWorkbook(encodeWorkbook(book, encoding));
    book = await structuralEdit(
      book,
      { Model },
      { sheetId: "inputs", axis: "column", index: 1 },
    );
    assert.equal(book.sheets[1].cells.B2.formula, "=Inputs!C3*Inputs!C4");
    book = await structuralEdit(
      book,
      { Model },
      { sheetId: "inputs", axis: "row", index: 3, remove: true },
    );
    assert.equal(book.sheets[1].cells.B2.result.type, "error");
    assert.match(book.sheets[1].cells.B2.formula, /#REF!/);
    assert.deepEqual(book.metadata, fixture.metadata);
  });
