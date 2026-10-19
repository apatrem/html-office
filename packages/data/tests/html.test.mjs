import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readHTML, replaceHTML } from "../bench/storage/html.mjs";
import { safeJSON, encodeWorkbook } from "../bench/storage/encodings.mjs";
import { writeCell } from "../bench/storage/operations.mjs";
const book = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
for (const encoding of ["per-cell", "rows", "columns", "csv", "tsv"])
  test(`${encoding}: external bounded edit preserves HTML outside the payload byte-for-byte`, () => {
    const before =
        '<!doctype html>\n<!-- café — preserved -->\n<script type="application/json" id="workbook">',
      after = "</script>\n<script>/* unchanged runtime */</script>\n";
    const html = before + safeJSON(encodeWorkbook(book, encoding)) + after;
    const r = readHTML(html);
    writeCell(r.book, "inputs", "B2", {
      input: { type: "number", value: 140 },
    });
    const changed = replaceHTML(html, r, r.book);
    assert.ok(changed.startsWith(before) && changed.endsWith(after));
    assert.equal(readHTML(changed).book.sheets[0].cells.B2.input.value, 140);
    assert.deepEqual(readHTML(changed).book.sheets[1], book.sheets[1]);
  });
test("duplicate or active workbook payloads are rejected", () => {
  for (const html of [
    '<script id="workbook">{}</script>',
    '<script id="workbook" type="application/json">{}</script><script id="workbook" type="application/json">{}</script>',
  ])
    assert.throws(() => readHTML(html));
});
