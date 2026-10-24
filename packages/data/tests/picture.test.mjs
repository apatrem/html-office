import test from "node:test";
import assert from "node:assert/strict";
import {
  fitText,
  wrapLines,
  pictureBounds,
  pictureSize,
  MAX_PICTURE_CELLS,
} from "../runtime/picture.mjs";
import { sheetAxes } from "../model/axis.mjs";

// One unit per character: easy widths to reason about.
const measure = (s) => s.length;
const SIZES = { rows: 1048576, columns: 16384, height: 23, width: 100 };

test("text is cut with an ellipsis like text-overflow", () => {
  assert.equal(fitText("short", 10, measure), "short");
  assert.equal(fitText("a longer label", 8, measure), "a longe…");
  assert.equal(fitText("abc", 0, measure), "…");
});

test("wrapped text breaks at spaces, then inside long words, and keeps newlines", () => {
  assert.deepEqual(wrapLines("one two three", 8, measure), [
    "one two",
    "three",
  ]);
  assert.deepEqual(wrapLines("abcdefghij", 4, measure), ["abcd", "efgh", "ij"]);
  assert.deepEqual(wrapLines("a\n\nb", 4, measure), ["a", "", "b"]);
});

test("whole rows and columns are cut to the used range", () => {
  const sheet = { cells: { B7: {}, E2: {} } };
  assert.deepEqual(pictureBounds({ anchor: "C1048576", focus: "C1" }, sheet), {
    top: 1,
    left: 3,
    bottom: 7,
    right: 3,
  });
  assert.deepEqual(pictureBounds({ anchor: "XFD3", focus: "A3" }, sheet), {
    top: 3,
    left: 1,
    bottom: 3,
    right: 5,
  });
  // A whole column past the used rows keeps its first row.
  assert.deepEqual(
    pictureBounds({ anchor: "A1048576", focus: "A20" }, sheet).bottom,
    20,
  );
});

test("picture size follows row and column sizes; large selections are refused", () => {
  const axes = sheetAxes(
    { rows: { 2: { height: 50 } }, columns: { B: { width: 180 } } },
    SIZES,
  );
  const size = pictureSize({ top: 1, left: 1, bottom: 3, right: 2 }, axes, 28);
  assert.deepEqual(
    { ...size, refused: !!size.refused },
    {
      cells: 6,
      width: 280,
      height: 23 + 50 + 23 + 28,
      scale: 2,
      refused: false,
    },
  );
  const plain = sheetAxes({}, SIZES);
  assert.match(
    pictureSize(
      { top: 1, left: 1, bottom: MAX_PICTURE_CELLS + 1, right: 1 },
      plain,
    ).refused,
    /5,001 cells/,
  );
  // 80 columns are 8,000 px; 81 are too wide.
  assert.equal(
    pictureSize({ top: 1, left: 1, bottom: 1, right: 80 }, plain).refused,
    "",
  );
  assert.match(
    pictureSize({ top: 1, left: 1, bottom: 1, right: 81 }, plain).refused,
    /8,100 × 23 px/,
  );
  // Past 2× the canvas area limit the picture is drawn at 1×.
  const wide = pictureSize({ top: 1, left: 1, bottom: 60, right: 80 }, plain);
  assert.equal(wide.scale, 1);
  assert.equal(wide.refused, "");
});
