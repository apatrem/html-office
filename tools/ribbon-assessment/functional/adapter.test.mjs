import test from "node:test";
import assert from "node:assert/strict";
import { fromNumberFormat, toNumberFormat } from "./formats.mjs";
import { hexWithTintToRgb } from "./ui-helpers.mjs";

test("supported format round trips preserve kind, currency and precision", () => {
  for (const f of [
    { kind: "general" },
    { kind: "number", digits: 3 },
    { kind: "percent", digits: 0 },
    { kind: "currency", digits: 2, currency: "EUR" },
    { kind: "accounting", digits: 4, currency: "USD" },
    { kind: "date" },
  ]) {
    assert.deepEqual(fromNumberFormat(toNumberFormat(f)), f);
  }
  assert.deepEqual(fromNumberFormat('"£"#,##0.00'), {
    kind: "currency",
    digits: 2,
    currency: "GBP",
  });
});
test("unsupported number format strings reject instead of approximating", () => {
  for (const s of [
    "0.00E+00",
    "dddd, mmmm d, yyyy",
    "0;[Red]-0",
    "# ?/?",
    "0." + "0".repeat(16),
  ])
    assert.throws(() => fromNumberFormat(s));
});
test("engine-free tint matches pinned IronCalc golden cases", () => {
  for (const [color, tint, want] of [
    ["#8064A2", 0.8, "#E5DFEC"],
    ["#8064A2", 0.6, "#CBBFD9"],
    ["#8064A2", 0.4, "#B3A3C8"],
    ["#FFFFFF", -1, "#000000"],
    ["#000000", 1, "#FFFFFF"],
    ["#123456", 0, "#123456"],
  ])
    assert.equal(hexWithTintToRgb(color, tint), want);
});
