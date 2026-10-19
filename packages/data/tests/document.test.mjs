import test from "node:test";
import assert from "node:assert/strict";
import {
  parseWorkbook,
  stringifyWorkbook,
  fingerprint,
} from "../model/workbook.mjs";
import { readFile } from "node:fs/promises";
import { readModel, writeModel } from "../model/document.mjs";

const fixture = async () => {
  const book = parseWorkbook(
    await readFile(
      new URL("../fixtures/two-sheets.json", import.meta.url),
      "utf8",
    ),
  );
  book.sheets[0].metadata = { layout: "table", keep: "unchanged" };
  return book;
};
test("hybrid documents use row arrays only for declared tables and retain sparse formulas", async () => {
  const book = await fixture();
  const payload = JSON.parse(writeModel(book));
  assert.equal(payload.version, "html-data/0.2");
  assert.equal(payload.sheets[0].table.encoding, "rows");
  assert.equal(payload.sheets[1].table, undefined);
  assert.deepEqual(readModel(writeModel(book)), book);
  assert.equal(
    await fingerprint(readModel(writeModel(book))),
    await fingerprint(book),
  );
});
test("row arrays preserve signed zero, mixed types, blanks, missing cells and metadata", async () => {
  const book = await fixture(),
    cells = book.sheets[0].cells;
  cells.A1 = { input: { type: "text", value: "0012" } };
  cells.B1 = { input: { type: "number", value: -0 }, role: "assumption" };
  cells.A2 = { input: { type: "text", value: "" } };
  cells.B2 = { input: { type: "blank" } };
  cells.A3 = { input: { type: "text", value: "</script>\n café" } };
  cells.B3 = { input: { type: "date", value: 46023 } };
  cells.A4 = { input: { type: "error", value: "#N/A" } };
  cells.B4 = { input: { type: "boolean", value: false } };
  cells.A5 = { input: { type: "number", value: Number.MIN_VALUE } };
  const text = writeModel(book),
    payload = JSON.parse(text);
  assert.ok(payload.sheets[0].table);
  assert.ok(!text.includes("</script>"));
  assert.deepEqual(readModel(text), book);
  assert.ok(Object.is(readModel(text).sheets[0].cells.B1.input.value, -0));
});
test("legacy sparse documents remain readable and freeform models are not densified", async () => {
  const book = await fixture();
  delete book.sheets[0].metadata.layout;
  assert.deepEqual(readModel(stringifyWorkbook(book)), book);
  assert.ok(JSON.parse(writeModel(book)).sheets.every((s) => !s.table));
});
test("hybrid documents reject duplicate values, malformed dimensions and unknown fields", async () => {
  const payload = JSON.parse(writeModel(await fixture()));
  for (const mutate of [
    (p) => p.sheets[0].table.data[0].push(null),
    (p) => (p.sheets[0].table.encoding = "csv"),
    (p) => (p.sheets[0].table.unrecognised = 1),
    (p) => (p.sheets[0].table.cellMetadata.Z999 = { role: "header" }),
    (p) => (p.sheets[0].cells.B2 = { input: { type: "number", value: 20 } }),
    (p) =>
      (p.sheets[0].table.overrides.B2 = {
        input: { type: "number", value: 20 },
      }),
  ]) {
    const copy = structuredClone(payload);
    mutate(copy);
    assert.throws(() => readModel(JSON.stringify(copy)));
  }
});
test("sparse tables with distant outliers fall back without allocating a giant rectangle", async () => {
  const book = await fixture();
  book.sheets[0].cells.XFD1048576 = { input: { type: "number", value: 1 } };
  const text = writeModel(book);
  assert.equal(JSON.parse(text).sheets[0].table, undefined);
  assert.deepEqual(readModel(text), book);
});
