import test from "node:test";
import assert from "node:assert/strict";
import { EditHistory, captureCells } from "../model/history.mjs";
function fixture() {
  return {
    sheets: [
      {
        id: "main",
        cells: {
          A1: { input: { type: "number", value: -0 } },
          B1: { formula: "=A1+1", result: { type: "number", value: 1 } },
          D9: { input: { type: "text", value: "keep" } },
        },
      },
    ],
  };
}
test("undo/redo restores typed cells, results, snapshots and selection without replacing unrelated cells", () => {
  const book = fixture(),
    history = new EditHistory(),
    refs = [
      { sheetId: "main", ref: "A1" },
      { sheetId: "main", ref: "B1" },
    ],
    unrelated = book.sheets[0].cells.D9;
  const before = captureCells(book, refs),
    selection = { sheetId: "main", anchor: "A1", focus: "B1" };
  book.sheets[0].cells.A1.input.value = 5;
  book.sheets[0].cells.B1.result.value = 6;
  const after = captureCells(book, refs);
  history.record({
    before,
    after,
    selectionBefore: selection,
    selectionAfter: selection,
    calculate: true,
    snapshotAfter: { engine: "test" },
  });
  assert.equal(history.canUndo, true);
  const undone = history.undo(book);
  assert.equal(Object.is(book.sheets[0].cells.A1.input.value, -0), true);
  assert.equal(book.sheets[0].cells.B1.result.value, 1);
  assert.equal(book.snapshot, undefined);
  assert.deepEqual(undone.selection, selection);
  assert.equal(book.sheets[0].cells.D9, unrelated);
  history.redo(book);
  assert.equal(book.sheets[0].cells.A1.input.value, 5);
  assert.equal(book.sheets[0].cells.B1.result.value, 6);
  assert.deepEqual(book.snapshot, { engine: "test" });
});
test("absent cells and redo invalidation survive repeated moves", () => {
  const book = fixture(),
    h = new EditHistory(),
    refs = [{ sheetId: "main", ref: "C1" }];
  const before = captureCells(book, refs);
  book.sheets[0].cells.C1 = { input: { type: "text", value: "new" } };
  h.record({ before, after: captureCells(book, refs) });
  h.undo(book);
  assert.equal("C1" in book.sheets[0].cells, false);
  h.redo(book);
  assert.equal(book.sheets[0].cells.C1.input.value, "new");
  h.undo(book);
  h.record({ before: [], after: [] });
  assert.equal(h.canRedo, false);
  h.clear();
  assert.equal(h.canUndo, false);
});
test("structural undo/redo moves inputs without storing the whole source sheet", async () => {
  const { shiftWorkbook, structureBeforeRefs } = await import(
    "../model/structure.mjs"
  );
  const { captureHead } = await import("../model/structure.mjs");
  const book = {
    id: "test",
    names: [{ name: "Point", sheetId: "main", ref: "A2" }],
    groups: [],
    sheets: [
      {
        id: "main",
        name: "Main",
        cells: {
          A1: { input: { type: "number", value: 1 } },
          A2: { input: { type: "number", value: 2 } },
          C3: { formula: "=SUM(A1:A2)", result: { type: "number", value: 3 } },
          D9: { input: { type: "text", value: "keep" } },
        },
      },
    ],
  };
  const original = structuredClone(book),
    h = new EditHistory(),
    command = {
      sheetId: "main",
      axis: "row",
      action: "delete",
      index: 2,
      count: 1,
    };
  const before = captureCells(book, structureBeforeRefs(book, command)),
    headBefore = captureHead(book),
    next = shiftWorkbook(book, command);
  next.sheets[0].cells.C2 = {
    formula: "=SUM(A1:#REF!)",
    result: { type: "error", value: "#REF!" },
  };
  const after = captureCells(next, [{ sheetId: "main", ref: "C2" }]);
  Object.assign(book, next);
  h.record({
    before,
    after,
    structure: command,
    headBefore,
    headAfter: captureHead(next),
    calculate: true,
  });
  const undone = h.undo(book);
  assert.deepEqual(book, original);
  assert.equal(undone.structure.action, "insert");
  h.redo(book);
  assert.equal(book.sheets[0].cells.A2, undefined);
  assert.equal(book.sheets[0].cells.D8.input.value, "keep");
  assert.equal(book.names[0].ref, "#REF!");
});
