import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateWorkbook } from "../model/workbook.mjs";
import { readModel, writeModel } from "../model/document.mjs";
const original = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
const rule = () => ({
  id: "regions",
  sheetId: "inputs",
  ref: "B2",
  source: {
    kind: "list",
    values: [
      { type: "text", value: "North" },
      { type: "text", value: "South" },
    ],
  },
});
const fixture = () => ({
  ...structuredClone(original),
  validations: [rule()],
  scenario: { validationId: "regions" },
});
test("typed static/range dropdowns and the single scenario selector survive canonical round trips", () => {
  const book = fixture();
  book.validations.push({
    id: "values",
    sheetId: "summary",
    ref: "D1:D3",
    source: { kind: "range", sheetId: "inputs", ref: "B2:B3" },
  });
  book.validations[0].source.values.push(
    { type: "number", value: -0 },
    { type: "date", value: 45351 },
    { type: "boolean", value: false },
    { type: "blank" },
  );
  assert.equal(validateWorkbook(book), book);
  assert.deepEqual(readModel(writeModel(book)), book);
  assert.equal(
    Object.is(
      readModel(writeModel(book)).validations[0].source.values[2].value,
      -0,
    ),
    true,
  );
  assert.equal(
    validateWorkbook(structuredClone(original)).validations,
    undefined,
  );
});
test("ambiguous IDs, overlapping targets and dangling scenario bindings are rejected", () => {
  const changes = [
    (b) =>
      (b.validations[0].source.values = Array.from({ length: 1001 }, () => ({
        type: "text",
        value: "Base",
      }))),
    (b) => (b.sheets[0].cells.B2 = { formula: "=1" }),
    (b) => (b.validations = null),
    (b) => b.validations.push({ ...rule(), ref: "D1" }),
    (b) => b.validations.push({ ...rule(), id: "other", ref: "B2:C4" }),
    (b) => (b.validations[0].sheetId = "missing"),
    (b) =>
      (b.validations[0].source = {
        kind: "range",
        sheetId: "missing",
        ref: "A1",
      }),
    (b) => (b.validations[0].source = { kind: "list", values: [] }),
    (b) =>
      b.validations[0].source.values.push({ type: "error", value: "#N/A" }),
    (b) => (b.validations[0].source.extra = true),
    (b) => (b.scenario.validationId = "missing"),
    (b) => (b.validations[0].ref = "B2:B3"),
    (b) => (b.validations[0].ref = "B0"),
  ];
  for (const change of changes) {
    const book = fixture();
    change(book);
    assert.throws(() => validateWorkbook(book));
  }
});
test("broken targets and list sources remain readable tombstones without selecting a replacement cell", () => {
  const book = fixture();
  book.validations[0].ref = "#REF!";
  book.validations.push({
    id: "broken_source",
    sheetId: "summary",
    ref: "A1",
    source: { kind: "range", sheetId: "inputs", ref: "#REF!" },
  });
  assert.deepEqual(readModel(writeModel(book)), book);
});
