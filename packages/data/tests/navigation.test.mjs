import test from "node:test";
import assert from "node:assert/strict";
import { rectangle, navigate, viewport } from "../model/navigation.mjs";
test("selection normalises reversed rectangular endpoints", () => {
  assert.deepEqual(rectangle("D8", "B2"), {
    top: 2,
    left: 2,
    bottom: 8,
    right: 4,
  });
});
test("navigation clamps Excel bounds and supports pages, Home and used-range End", () => {
  assert.equal(navigate("A1", "ArrowLeft"), "A1");
  assert.equal(navigate("XFD1048576", "ArrowDown"), "XFD1048576");
  assert.equal(navigate("D10", "Home"), "A10");
  assert.equal(navigate("D10", "Home", { command: true }), "A1");
  assert.equal(
    navigate("D10", "End", {
      command: true,
      used: { rows: 100000, columns: 8 },
    }),
    "H100000",
  );
  assert.equal(navigate("D10", "PageDown", { pageRows: 20 }), "D30");
  assert.equal(navigate("D10", "Tab", { shift: true }), "C10");
});
test("a large-sheet viewport stays bounded at distant scroll positions", () => {
  const v = viewport({ top: 2800000, left: 14000, height: 500, width: 1000 });
  assert.ok(v.bottom - v.top < 30);
  assert.ok(v.right - v.left < 16);
  assert.ok(v.top > 99000);
  assert.ok(v.left > 90);
});
test("variable row and column sizes give cumulative offsets and lookups", async () => {
  const { createAxis, sheetAxes } = await import("../model/axis.mjs");
  const axis = createAxis(
    23,
    1048576,
    new Map([
      [3, 50],
      [10, 1],
      [1048576, 100],
    ]),
  );
  assert.equal(axis.start(1), 0);
  assert.equal(axis.start(3), 46);
  assert.equal(axis.start(4), 96);
  assert.equal(axis.start(11), 96 + 6 * 23 + 1);
  assert.equal(axis.size(3), 50);
  assert.equal(axis.total, 1048576 * 23 + 27 - 22 + 77);
  assert.equal(axis.indexAt(0), 1);
  assert.equal(axis.indexAt(46), 3);
  assert.equal(axis.indexAt(95), 3);
  assert.equal(axis.indexAt(96), 4);
  assert.equal(axis.indexAt(axis.total + 500), 1048576);
  const sheet = { rows: { 2: { height: 40 } }, columns: { B: { width: 200 } } };
  const axes = sheetAxes(sheet, {
    rows: 1048576,
    columns: 16384,
    height: 23,
    width: 100,
  });
  assert.equal(axes.rows.start(3), 63);
  assert.equal(axes.columns.start(3), 300);
  assert.equal(
    sheetAxes(sheet, { rows: 1048576, columns: 16384, height: 23, width: 100 }),
    axes,
  );
  const v = viewport({ top: 0, left: 0, height: 100, width: 250 }, axes);
  assert.equal(v.right, 4);
});
test("tiny stored sizes keep the rendered viewport within its budget", async () => {
  const { createAxis } = await import("../model/axis.mjs");
  const { MAX_VIEW_ROWS, MAX_VIEW_COLUMNS } = await import(
    "../model/navigation.mjs"
  );
  const tiny = new Map(Array.from({ length: 1000 }, (_, i) => [i + 1, 1]));
  const v = viewport(
    { top: 0, left: 0, height: 600, width: 1000 },
    {
      rows: createAxis(23, 1048576, tiny),
      columns: createAxis(100, 16384, tiny),
    },
  );
  assert.equal(v.bottom - v.top + 1, MAX_VIEW_ROWS);
  assert.equal(v.right - v.left + 1, MAX_VIEW_COLUMNS);
});
