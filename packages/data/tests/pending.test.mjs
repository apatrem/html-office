import test from "node:test";
import assert from "node:assert/strict";
import { overlayDraft, draftPatches } from "../model/pending.mjs";
const book = {
  sheets: [
    {
      id: "main",
      cells: {
        A1: {
          input: { type: "number", value: 10 },
          format: { kind: "number", digits: 2 },
        },
        B1: { input: { type: "text", value: "old" } },
        C1: { formula: "=A1*2", result: { type: "number", value: 20 } },
      },
    },
    { id: "keep", cells: {} },
  ],
  snapshot: { fingerprint: "old" },
};
test("pending range drafts overlay all attempts atomically while preserving the committed model", () => {
  const edits = [
      {
        sheetId: "main",
        ref: "A1",
        cell: { input: { type: "number", value: -0 } },
        preserveFormat: false,
      },
      { sheetId: "main", ref: "B1", cell: null },
    ],
    draft = overlayDraft(book, edits);
  assert.equal(Object.is(draft.sheets[0].cells.A1.input.value, -0), true);
  assert.equal(draft.sheets[0].cells.A1.format, undefined);
  assert.equal("B1" in draft.sheets[0].cells, false);
  assert.equal(draft.snapshot, undefined);
  assert.equal(book.sheets[0].cells.A1.input.value, 10);
  assert.equal(draft.sheets[1], book.sheets[1]);
});
test("single pending edits retain formatting applied after failure; copied ranges retain their explicit formats", () => {
  const edit = {
    sheetId: "main",
    ref: "A1",
    cell: {
      input: { type: "number", value: 42 },
      format: { kind: "percent", digits: 1 },
    },
  };
  assert.deepEqual(draftPatches(book, edit)[0].cell.format, {
    kind: "number",
    digits: 2,
  });
  assert.deepEqual(
    draftPatches(book, [{ ...edit, preserveFormat: false }])[0].cell.format,
    { kind: "percent", digits: 1 },
  );
  assert.equal(overlayDraft(book, []), book);
});
