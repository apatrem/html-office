// T19 print layout: printed range, repeated header rows, paper defaults, and
// wide sheets fitted or split into pages across with repeated columns.
import test from "node:test";
import assert from "node:assert/strict";
import {
  printBounds,
  headerRows,
  printLayout,
  printableWidth,
  defaultPaper,
  bestOrientation,
  MAX_PRINT_CELLS,
  MIN_FIT_SCALE,
  repeatLimit,
} from "../runtime/print.mjs";
import { COLUMN_WIDTH } from "../model/navigation.mjs";

const text = (value, cellStyle) => ({
  input: { type: "text", value },
  ...(cellStyle ? { cellStyle } : {}),
});
const sheetOf = (cells, extra = {}) => ({ name: "S", cells, ...extra });

test("the printed range runs from A1 to the last cell record", () => {
  assert.deepEqual(printBounds(sheetOf({})), { rows: 0, columns: 0 });
  assert.deepEqual(
    printBounds(sheetOf({ B3: text("x"), D2: { cellStyle: "header" } })),
    { rows: 3, columns: 4 },
  );
  assert.match(
    printLayout(sheetOf({}), { paper: "A4", orientation: "portrait" }).refused,
    /S is empty/,
  );
});

test("leading header-styled rows repeat", () => {
  assert.equal(
    headerRows(
      sheetOf({
        A1: text("Title", "header"),
        A2: text("Sub", "header"),
        B2: { cellStyle: "header" },
        A3: text("Data"),
      }),
      3,
    ),
    2,
  );
  assert.equal(headerRows(sheetOf({ A1: text("Plain") }), 1), 0);
  // A header row mixing other cells does not repeat.
  assert.equal(
    headerRows(sheetOf({ A1: text("H", "header"), B1: text("x") }), 2),
    0,
  );
});

test("paper follows the locale; widths are the page less 12 mm margins", () => {
  assert.equal(defaultPaper("en-US"), "Letter");
  assert.equal(defaultPaper("fr-CA"), "Letter");
  assert.equal(defaultPaper("fr-FR"), "A4");
  assert.equal(defaultPaper("en-GB"), "A4");
  assert.equal(Math.round(printableWidth("A4", "portrait")), 703);
  assert.equal(Math.round(printableWidth("A4", "landscape")), 1032);
  assert.equal(Math.round(printableWidth("Letter", "landscape")), 965);
});

function wideSheet(columns) {
  const cells = {};
  for (let c = 1; c <= columns; c++)
    cells[`${String.fromCharCode(64 + c)}1`] = text(`C${c}`);
  return sheetOf(cells);
}

test("a sheet that fits prints in one band at full size", () => {
  const layout = printLayout(wideSheet(5), {
    paper: "A4",
    orientation: "portrait",
  });
  assert.equal(layout.wide, "fit");
  assert.equal(layout.bands.length, 1);
  assert.equal(layout.scale, 1);
  assert.equal(bestOrientation(wideSheet(5), "A4"), "portrait");
  assert.equal(bestOrientation(wideSheet(9), "A4"), "landscape");
});

test("slightly wide sheets fit; very wide ones split with repeated columns", () => {
  const page = printableWidth("A4", "landscape"),
    fits = Math.ceil(page / COLUMN_WIDTH) + 1,
    fitted = printLayout(wideSheet(fits), {
      paper: "A4",
      orientation: "landscape",
    });
  assert.equal(fitted.wide, "fit");
  assert.ok(fitted.scale < 1 && fitted.scale >= MIN_FIT_SCALE);
  const split = printLayout(wideSheet(26), {
    paper: "A4",
    orientation: "landscape",
  });
  assert.equal(split.wide, "split");
  assert.equal(split.scale, 1);
  assert.ok(split.bands.length >= 3);
  const seen = new Set();
  for (const band of split.bands) {
    assert.equal(band.columns[0], 1, "column A starts every band");
    assert.ok(band.width <= page);
    band.columns.slice(1).forEach((col) => seen.add(col));
  }
  assert.equal(seen.size, 25, "every other column prints exactly once");
  const none = printLayout(wideSheet(26), {
    paper: "A4",
    orientation: "landscape",
    repeatColumns: 0,
  });
  assert.ok(none.bands.length < split.bands.length + 1);
  assert.equal(none.bands[1].columns[0] > 1, true);
  // Forced fit: one band, scaled below the legible threshold.
  const forced = printLayout(wideSheet(26), {
    paper: "A4",
    orientation: "landscape",
    wide: "fit",
  });
  assert.equal(forced.bands.length, 1);
  assert.ok(forced.scale < MIN_FIT_SCALE);
});

test("huge sheets are refused with a pointer to CSV", () => {
  const layout = printLayout(sheetOf({ A1: text("a"), J10000: text("z") }), {
    paper: "A4",
    orientation: "portrait",
    wide: "fit",
  });
  assert.ok(10 * 10000 > MAX_PRINT_CELLS);
  assert.match(layout.refused, /too large to print.*Export it as CSV/);
});

test("repeated rows stay within a quarter of the printed page", () => {
  const tall = sheetOf(
    { A1: text("H", "header") },
    {
      rows: {
        1: { height: 60 },
        2: { height: 60 },
        3: { height: 60 },
        4: { height: 60 },
        5: { height: 60 },
      },
    },
  );
  // Letter landscape: 191.9 mm high, a quarter is about 181 px.
  assert.equal(
    repeatLimit(tall, { paper: "Letter", orientation: "landscape" }),
    3,
  );
  assert.equal(
    repeatLimit(tall, {
      paper: "Letter",
      orientation: "landscape",
      scale: 0.6,
    }),
    5,
  );
  assert.equal(
    repeatLimit(sheetOf({}), { paper: "A4", orientation: "portrait" }),
    5,
  );
});
