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
