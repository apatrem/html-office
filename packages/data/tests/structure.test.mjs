import test from "node:test";
import assert from "node:assert/strict";
import {
  shiftRange,
  shiftWorkbook,
  inverseStructure,
} from "../model/structure.mjs";
const operation = {
  sheetId: "main",
  axis: "row",
  action: "insert",
  index: 2,
  count: 2,
};
const book = {
  sheets: [
    {
      id: "main",
      name: "Main",
      cells: {
        A1: { input: { type: "number", value: 1 } },
        B2: { input: { type: "text", value: "move" } },
        C5: { formula: "=A1+B2", result: { type: "number", value: 1 } },
      },
    },
    { id: "keep", name: "Keep", cells: {} },
  ],
  names: [{ name: "Block", sheetId: "main", ref: "A1:B3" }],
  snapshot: { fingerprint: "old" },
};
test("insert/delete shifts cell positions and named ranges without duplicating input values", () => {
  const next = shiftWorkbook(book, operation);
  assert.equal(next.sheets[0].cells.B4, book.sheets[0].cells.B2);
  assert.equal(next.sheets[0].cells.B2, undefined);
  assert.equal(next.names[0].ref, "A1:B5");
  assert.equal(next.snapshot, undefined);
  assert.equal(next.sheets[1], book.sheets[1]);
  const restored = shiftWorkbook(next, inverseStructure(operation));
  assert.deepEqual(restored.sheets, book.sheets);
  assert.deepEqual(restored.names, book.names);
});
test("range deletion shrinks surviving intervals and marks an entirely deleted binding REF", () => {
  const remove = { ...operation, action: "delete", index: 2, count: 2 };
  assert.equal(shiftRange("A1:B5", remove), "A1:B3");
  assert.equal(shiftRange("A2:B3", remove), "#REF!");
  assert.equal(shiftRange("A3:B6", remove), "A2:B4");
  assert.equal(shiftRange("#REF!", operation), "#REF!");
  assert.equal(shiftRange("B2:D5", { ...remove, axis: "column" }), "B2:B5");
});
test("invalid commands and overflow fail before changing the source", () => {
  assert.throws(
    () => shiftWorkbook(book, { ...operation, count: 0 }),
    /count/i,
  );
  assert.throws(
    () => shiftWorkbook(book, { ...operation, sheetId: "missing" }),
    /sheet/i,
  );
  const edge = structuredClone(book);
  edge.sheets[0].cells.XFD1048576 = { input: { type: "number", value: 1 } };
  assert.throws(() => shiftWorkbook(edge, operation), /bounds/i);
  assert.equal(edge.sheets[0].cells.XFD1048576.input.value, 1);
});
