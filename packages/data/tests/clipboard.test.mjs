import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDelimited,
  translateFormula,
  parsePaste,
  rangePatches,
  copyRange,
  fillRange,
} from "../model/clipboard.mjs";
test("copy adjusts mixed/absolute, quoted cross-sheet and whole-row/column references without changing strings or functions", () => {
  assert.equal(
    translateFormula(
      "=A1+$B2+C$3+$D$4+'A1'!B2+Sheet1!C3+\"A1\"+LOG10(A1)",
      2,
      3,
    ),
    "=D3+$B4+F$3+$D$4+'A1'!E4+Sheet1!F5+\"A1\"+LOG10(D3)",
  );
  assert.equal(
    translateFormula("=SUM(A:C)+SUM($2:4)+A1!B2", 1, 1),
    "=SUM(B:D)+SUM($2:5)+A1!C3",
  );
  assert.equal(translateFormula("=A1+B$1+$A1", -1, -1), "=#REF!+A$1+#REF!");
  assert.equal(
    translateFormula('="say ""A1"""&\'O\'\'Brien\'!A1', 1, 0),
    '="say ""A1"""&\'O\'\'Brien\'!A2',
  );
});
test("Excel TSV keeps quoted multiline text, leading zeros and formula-like strings literal", () => {
  const values = parsePaste('0012\t2.5\tTRUE\n"a\tb\nc"\t=SUM(A1)\t', {});
  assert.deepEqual(
    values[0].map((c) => c.input),
    [
      { type: "text", value: "0012" },
      { type: "number", value: 2.5 },
      { type: "boolean", value: true },
    ],
  );
  assert.equal(values[1][0].input.value, "a\tb\nc");
  assert.equal(values[1][1].input.value, "=SUM(A1)");
  assert.equal(values[1][2].input.type, "blank");
});
test("Markdown tables preserve escaped pipes and reject malformed rectangles atomically", () => {
  const rows = parsePaste("| Name | Value |\n| --- | ---: |\n| a\\|b | 2 |", {
    syntax: "markdown",
  });
  assert.equal(
    parsePaste("Name | Value\n--- | ---\nx | 2")[1][1].input.value,
    2,
  );
  assert.equal(rows[1][0].input.value, "a|b");
  assert.equal(rows[1][1].input.value, 2);
  assert.throws(() => parsePaste("a\tb\nc"), /rectangular/);
  assert.throws(() => parsePaste('"unfinished\ttext'), /quote/i);
});
test("ambiguous locale and dates require an explicit typing choice", () => {
  assert.throws(() => parsePaste("1,234\t01/02/2026"), /ambiguous/i);
  assert.throws(() => parsePaste("01/02/2026"), /ambiguous/i);
  assert.equal(
    parsePaste("1,234", { typing: "en-US" })[0][0].input.value,
    1234,
  );
  assert.equal(
    parsePaste("1,234", { typing: "fr-FR" })[0][0].input.value,
    1.234,
  );
  assert.equal(
    parsePaste("01/02/2026", { typing: "text" })[0][0].input.type,
    "text",
  );
  const us = parsePaste("01/02/2026", { typing: "en-US" })[0][0].input,
    fr = parsePaste("01/02/2026", { typing: "fr-FR" })[0][0].input;
  assert.equal(us.type, "date");
  assert.equal(fr.value - us.value, 30);
  assert.throws(() => parsePaste("31/02/2026", { typing: "fr-FR" }), /date/i);
});
test("internal copy/fill preserve types and styles and shift formulas across a rectangular target", () => {
  const sheet = {
    id: "one",
    cells: {
      A1: { input: { type: "text", value: "001" }, cellStyle: "header" },
      B1: { formula: "=$A1+1", format: { kind: "number", digits: 2 } },
    },
  };
  const copied = copyRange(sheet, "A1:B1"),
    patches = rangePatches("two", "C3", copied.cells, {
      origin: copied.origin,
    });
  assert.equal(patches[0].cell.input.value, "001");
  assert.equal(patches[0].cell.cellStyle, "header");
  assert.equal(patches[1].cell.formula, "=$A3+1");
  const fill = fillRange(sheet, "B1:B3", "down");
  assert.equal(fill[1].cell.formula, "=$A2+1");
  assert.equal(fill[2].cell.formula, "=$A3+1");
  assert.throws(() => rangePatches("two", "XFD1048576", [[{}, {}]]), /bounds/);
});

test("A1-like defined names outside cell bounds remain names when copied", () => {
  assert.equal(translateFormula("=XFE1+A1", 1, 1), "=XFE1+B2");
  assert.equal(translateFormula("=A1048577+A1", 1, 1), "=A1048577+B2");
  assert.equal(translateFormula("=XFD1048576", 1, 1), "=#REF!");
});
test("a final closed quoted empty field remains an explicit row", () => {
  assert.deepEqual(parseDelimited('a\n""'), [["a"], [""]]);
  assert.deepEqual(parseDelimited('a\n""\n'), [["a"], [""]]);
  assert.equal(parsePaste('a\n""').length, 2);
});

// ---- Portable tables and the shared clipboard module (ADR-013, X02a) ----
import { readFileSync } from "node:fs";
import { address } from "../model/workbook.mjs";
import {
  rangeTable,
  tableCells,
  validateRange,
  plainValue,
  isoDate,
} from "../model/clipboard.mjs";
import { display, negativeRed } from "../runtime/view.mjs";
import {
  readTable,
  validateTable,
  tableHTML,
  readClipboard,
  TEXT_COLORS,
  FILLS,
  CELL_STYLES,
} from "../../shared/clipboard/index.mjs";
import {
  TEXT_COLORS as DATA_COLORS,
  FILLS as DATA_FILLS,
  BUILTIN_CELL_STYLES,
} from "../model/formatting.mjs";
import { parseInert } from "../../../tests/helpers/inert-dom.mjs";
const fixture = (name) =>
  readTable(
    parseInert(
      readFileSync(
        new URL(
          `../../shared/clipboard/fixtures/${name}.html`,
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  ).table;
const inputs = (cells) => cells.map((row) => row.map((c) => c.input));

test("the portable vocabulary is Data's", () => {
  assert.deepEqual(TEXT_COLORS, DATA_COLORS);
  assert.deepEqual(FILLS, DATA_FILLS);
  assert.deepEqual(CELL_STYLES, BUILTIN_CELL_STYLES);
});

test("a Data range becomes a portable table: display text, typed values, header and total rows, centre across selection", () => {
  const sheet = {
    id: "s",
    cells: {
      A1: {
        input: { type: "text", value: "Budget" },
        cellStyle: "header",
        style: { align: { horizontal: "centerContinuous" } },
      },
      B1: {
        cellStyle: "header",
        style: { align: { horizontal: "centerContinuous" } },
      },
      A2: {
        input: { type: "text", value: "North" },
        style: { bold: true, color: "acc" },
      },
      B2: {
        formula: "=1234.567*1",
        result: { type: "number", value: 1234.567 },
        format: { kind: "number", digits: 0 },
      },
      A3: { input: { type: "text", value: "Total" }, cellStyle: "total" },
      B3: {
        input: { type: "number", value: -5 },
        cellStyle: "total",
        format: { kind: "number", digits: 0, negative: "red" },
      },
    },
    columns: { A: { width: 300 } },
    links: {
      A2: { url: "https://example.com/n" },
      B2: { sheetId: "s", ref: "A1" },
    },
  };
  const t = rangeTable(sheet, "A1:B3", {
    text: (cell) => display(cell, "fr-FR"),
    red: negativeRed,
  });
  validateTable(t);
  assert.deepEqual(t.rows[0], [
    {
      text: "Budget",
      value: { type: "text", value: "Budget" },
      cellStyle: "header",
      align: "center",
      colspan: 2,
      header: true,
    },
    { covered: true },
  ]);
  assert.deepEqual(t.rows[1][0], {
    text: "North",
    value: { type: "text", value: "North" },
    bold: true,
    color: "acc",
    link: { url: "https://example.com/n" },
  });
  assert.deepEqual(t.rows[1][1], {
    text: "1 235",
    value: { type: "number", value: 1234.567 },
    format: { kind: "number", digits: 0 },
    align: "right",
  });
  assert.equal(
    t.rows[2][1].color,
    "alert",
    "red negatives are the alert colour",
  );
  assert.equal(t.headerRows, 1);
  assert.deepEqual(t.totalRows, [2]);
  assert.deepEqual(t.columns, [{ width: 75 }, { width: 25 }]);
  // Back into Data: typed values and formats are kept without asking; the
  // header merge becomes centre across selection again.
  const back = tableCells(t);
  assert.equal(back.ambiguous, null);
  assert.deepEqual(back.cells[0][1], {
    input: { type: "blank" },
    cellStyle: "header",
    style: { align: { horizontal: "centerContinuous" } },
  });
  assert.equal(back.cells[0][0].style.align.horizontal, "centerContinuous");
  assert.deepEqual(back.cells[1][1].input, { type: "number", value: 1234.567 });
  assert.deepEqual(back.cells[1][1].format, { kind: "number", digits: 0 });
  assert.deepEqual(back.cells[2][1].cellStyle, "total");
  assert.deepEqual(back.links, { "1,0": { url: "https://example.com/n" } });
});

test("Excel HTML: values-first typing; grouped numbers ask for a locale", () => {
  const t = fixture("excel-macos");
  assert.match(tableCells(t).ambiguous, /Ambiguous value "1,235"/);
  const { cells, counts } = tableCells(t, { typing: "en-US" });
  assert.deepEqual(inputs(cells)[2].slice(1, 5), [
    { type: "number", value: 1235 },
    { type: "number", value: 0.125 },
    { type: "date", value: 46054 },
    { type: "text", value: "0012" },
  ]);
  assert.deepEqual(cells[2][2].format, { kind: "percent", digits: 1 });
  assert.equal(
    cells[3][1].input.value,
    "(5,000)",
    "parentheses stay text, as in the dialog",
  );
  assert.deepEqual(cells[4][5].input, { type: "boolean", value: true });
  assert.deepEqual(cells[1][0].style, { bold: true });
  assert.equal(cells[2][5].input.value, "Line one\nline two");
  // The title's general merge keeps the value top-left.
  assert.equal(counts.merged, 1);
  assert.equal(cells[0][1].style, undefined);
});

test("Google Sheets (French) HTML with fr-FR typing", () => {
  const t = fixture("sheets-fr");
  assert.ok(tableCells(t).ambiguous);
  const { cells } = tableCells(t, { typing: "fr-FR" });
  assert.deepEqual(inputs(cells)[1].slice(1), [
    { type: "number", value: 1234.5 },
    { type: "number", value: 0.12 },
    { type: "date", value: 46054 },
  ]);
  assert.deepEqual(cells[1][2].format, { kind: "percent", digits: 0 });
  assert.deepEqual(inputs(cells)[2][1], { type: "number", value: -42 });
});

test("Word and Docs HTML: flattened runs, dropped links and merges are counted", () => {
  const word = tableCells(fixture("word-macos"));
  assert.equal(word.ambiguous, null);
  assert.equal(word.cells[1][0].input.value, "Revenue growth");
  assert.equal(word.cells[1][0].style, undefined);
  assert.deepEqual(word.counts, { merged: 0, flattened: 3, links: 1 });
  assert.deepEqual(word.links, { "2,0": { url: "https://example.org/costs" } });
  assert.deepEqual(word.cells[2][1].input, { type: "number", value: -1250 });
  const docs = tableCells(fixture("docs"));
  assert.equal(docs.ambiguous, null);
  assert.deepEqual(inputs(docs.cells)[1].slice(0, 2), [
    { type: "text", value: "Launch" },
    { type: "date", value: 46461 },
  ]);
  assert.deepEqual(inputs(docs.cells)[2], [
    { type: "text", value: "Budget" },
    { type: "number", value: 42000 },
    { type: "boolean", value: true },
  ]);
  assert.equal(docs.counts.merged, 2);
  assert.deepEqual(docs.cells[0][2].style, { italic: true });
});

test("th rows become header cells; text typing keeps everything as text", () => {
  const t = readTable(
    parseInert(
      "<table><tr><th>Code</th></tr><tr><td>0012</td></tr><tr><td>12%</td></tr></table>",
    ),
  ).table;
  const auto = tableCells(t),
    text = tableCells(t, { typing: "text" });
  assert.equal(auto.cells[0][0].cellStyle, "header");
  assert.equal(
    auto.cells[0][0].style,
    undefined,
    "bold comes from the header style",
  );
  assert.deepEqual(auto.cells[2][0].input, { type: "number", value: 0.12 });
  assert.deepEqual(text.cells[2][0].input, { type: "text", value: "12%" });
});

test("a Data range from the clipboard is validated whole", () => {
  const range = {
    schema: "html-office-range/1",
    origin: { row: 2, column: 2 },
    cells: [[{ input: { type: "number", value: 1 } }, null]],
    links: { "0,0": { url: "https://example.com" } },
  };
  assert.equal(
    validateRange(structuredClone(range)).schema,
    "html-office-range/1",
  );
  for (const change of [
    (r) => (r.schema = "html-office-range/2"),
    (r) => (r.origin = { row: 0, column: 1 }),
    (r) => (r.origin.extra = 1),
    (r) => (r.cells = [[1]]),
    (r) => (r.cells = [[null], [null, null]]),
    (r) => (r.links = { "0,5": { url: "https://example.com" } }),
    (r) => (r.links = JSON.parse('{"__proto__": {}}')),
    (r) => (r.extra = true),
  ]) {
    const r = structuredClone(range);
    change(r);
    assert.throws(() => validateRange(r), Error, change.toString());
  }
});

test("text/plain keeps full precision and writes ISO dates", () => {
  assert.equal(
    plainValue({
      input: { type: "number", value: 1234.567 },
      format: { kind: "number", digits: 0 },
    }),
    "1234.567",
  );
  assert.equal(
    plainValue({ input: { type: "date", value: 46054 } }),
    "2026-02-01",
  );
  assert.equal(
    plainValue({
      input: { type: "number", value: 46054 },
      format: { kind: "date" },
    }),
    "2026-02-01",
  );
  assert.equal(
    plainValue({
      formula: "=1/0",
      result: { type: "error", value: "#DIV/0!" },
    }),
    "#DIV/0!",
  );
  assert.equal(
    plainValue({ input: { type: "boolean", value: false } }),
    "FALSE",
  );
  assert.equal(isoDate(60), "1900-02-29");
  assert.equal(isoDate(61), "1900-03-01");
  assert.equal(isoDate(46054.5), "2026-02-01T12:00:00");
  assert.equal(isoDate(-1), "-1");
});

test("Data's own HTML without its attribute still pastes its displayed table", () => {
  const sheet = {
    id: "s",
    cells: {
      A1: { input: { type: "text", value: "Name" }, cellStyle: "header" },
      A2: {
        input: { type: "number", value: 0.5 },
        format: { kind: "percent", digits: 0 },
      },
    },
  };
  const t = rangeTable(sheet, "A1:A2", {
      text: (c) => display(c, "en-US"),
      red: negativeRed,
    }),
    html = tableHTML(t, { locale: "en-US" }),
    read = readClipboard(
      {
        types: ["text/html", "text/plain"],
        getData: (type) => (type === "text/html" ? html : ""),
      },
      { parse: parseInert },
    );
  assert.equal(read.source, "table");
  const { cells } = tableCells(read.table);
  assert.equal(cells[0][0].cellStyle, "header");
  assert.deepEqual(cells[1][0].input, { type: "number", value: 0.5 });
  assert.deepEqual(cells[1][0].format, { kind: "percent", digits: 0 });
});

test("review fixes: percents ask when ambiguous, formats are always checked, column alignment, long centre runs, header-only copies", () => {
  const one = (text) => ({ rows: [[{ text }]] });
  assert.match(tableCells(one("12,5%")).ambiguous, /Ambiguous value "12,5"/);
  assert.match(tableCells(one("1,234%")).ambiguous, /Ambiguous/);
  assert.deepEqual(tableCells(one("12,5%"), { typing: "fr-FR" }).cells[0][0], {
    input: { type: "number", value: 0.125 },
    format: { kind: "percent", digits: 1 },
  });
  assert.deepEqual(tableCells(one("5 kg%")).cells[0][0].input, {
    type: "text",
    value: "5 kg%",
  });
  assert.throws(
    () => tableCells({ rows: [[{ text: "x", format: { kind: "bogus" } }]] }),
    /Invalid format/,
  );
  const right = tableCells({
    rows: [[{ text: "a" }]],
    columns: [{ align: "right" }],
  });
  assert.deepEqual(right.cells[0][0].style, { align: { horizontal: "right" } });
  const cells = {
    A1: {
      input: { type: "text", value: "Wide" },
      cellStyle: "header",
      style: { align: { horizontal: "centerContinuous" } },
    },
  };
  for (let c = 2; c <= 1201; c++)
    cells[`${address(1, c)}`] = {
      style: { align: { horizontal: "centerContinuous" } },
    };
  const wide = rangeTable({ id: "s", cells }, "A1:AUF1", {
    text: (c) => display(c),
    red: negativeRed,
  });
  validateTable(wide);
  assert.equal(wide.rows[0][0].colspan, 1000);
  assert.equal(wide.rows[0][1000].covered, undefined);
  const head = rangeTable(
    {
      id: "s",
      cells: {
        A1: { input: { type: "text", value: "H" }, cellStyle: "header" },
      },
    },
    "A1",
    { text: (c) => display(c), red: negativeRed },
  );
  assert.equal(head.headerRows, 1);
  assert.equal(head.rows[0][0].header, true);
});
