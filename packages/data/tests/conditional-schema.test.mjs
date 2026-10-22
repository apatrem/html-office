import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readModel, writeModel } from "../model/document.mjs";
import { validateWorkbook, fingerprint } from "../model/workbook.mjs";
import { shiftWorkbook, captureHead } from "../model/structure.mjs";
import { EditHistory } from "../model/history.mjs";
const source = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
export const highlight = () => ({
  id: "high",
  sheetId: "inputs",
  ref: "B2:B4",
  kind: "highlight",
  condition: { operator: "gte", values: [{ type: "number", value: 100 }] },
  style: { fill: "tint", color: "alert", bold: true },
});
export const bar = () => ({
  id: "bar",
  sheetId: "inputs",
  ref: "B2:B4",
  kind: "dataBar",
  scale: { kind: "auto" },
  positive: "acc",
  negative: "alert",
});
const fixture = () => ({
  ...structuredClone(source),
  conditionalFormats: [highlight(), bar()],
});
test("ordered conditional rules survive canonical round trips and do not alter calculation fingerprints", async () => {
  const book = fixture();
  assert.equal(validateWorkbook(book), book);
  assert.deepEqual(readModel(writeModel(book)), book);
  assert.equal(await fingerprint(book), await fingerprint(source));
  const fixed = bar();
  fixed.scale = { kind: "fixed", min: -100, max: 200 };
  book.conditionalFormats.push({ ...fixed, id: "fixed", ref: "D1" });
  assert.deepEqual(readModel(writeModel(book)), book);
});
test("conditional definitions reject unsafe styles, ambiguous identity and invalid ranges/scales/conditions", () => {
  const changes = [
    (b) => (b.conditionalFormats = null),
    (b) => (b.conditionalFormats[0].condition.values = Array(1)),
    (b) => b.conditionalFormats.push(highlight()),
    (b) => (b.conditionalFormats[0].sheetId = "missing"),
    (b) => (b.conditionalFormats[0].ref = "A0"),
    (b) => (b.conditionalFormats[0].style.fill = "url(https://example.com/x)"),
    (b) => (b.conditionalFormats[0].style.position = "fixed"),
    (b) => (b.conditionalFormats[0].condition.operator = "formula"),
    (b) => (b.conditionalFormats[0].condition.values = []),
    (b) =>
      (b.conditionalFormats[0].condition.values = [
        { type: "text", value: "100" },
      ]),
    (b) =>
      (b.conditionalFormats[0].condition = {
        operator: "between",
        values: [
          { type: "number", value: 2 },
          { type: "number", value: 1 },
        ],
      }),
    (b) => (b.conditionalFormats[1].scale = { kind: "fixed", min: 1, max: 10 }),
    (b) => (b.conditionalFormats[1].scale = { kind: "fixed", min: 0, max: 0 }),
    (b) => (b.conditionalFormats[1].positive = "red;position:fixed"),
    (b) =>
      (b.conditionalFormats = Array.from({ length: 101 }, (_, i) => ({
        ...bar(),
        id: `bar_${i}`,
      }))),
  ];
  for (const change of changes) {
    const book = fixture();
    change(book);
    assert.throws(() => validateWorkbook(book));
  }
});
test("conditional targets shift/shrink/become inactive and metadata history restores rule order and full definitions", () => {
  const book = fixture(),
    before = captureHead(book),
    command = {
      sheetId: "inputs",
      axis: "row",
      action: "delete",
      index: 2,
      count: 3,
    },
    next = shiftWorkbook(book, command);
  assert.equal(next.conditionalFormats[0].ref, "#REF!");
  assert.equal(next.conditionalFormats[1].ref, "#REF!");
  assert.deepEqual(readModel(writeModel(next)), next);
  const history = new EditHistory();
  history.record({
    before: [],
    after: [],
    headBefore: before,
    headAfter: captureHead(next),
  });
  history.undo(next);
  assert.deepEqual(next.conditionalFormats, book.conditionalFormats);
  history.redo(next);
  assert.equal(next.conditionalFormats[0].ref, "#REF!");
  const partial = shiftWorkbook(book, { ...command, index: 3, count: 1 });
  assert.equal(partial.conditionalFormats[0].ref, "B2:B3");
  const insert = shiftWorkbook(book, {
    ...command,
    action: "insert",
    index: 2,
    count: 2,
  });
  assert.equal(insert.conditionalFormats[1].ref, "B4:B6");
});
