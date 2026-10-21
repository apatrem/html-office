import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readModel, writeModel } from "../model/document.mjs";
import { validateWorkbook, fingerprint } from "../model/workbook.mjs";
const source = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
const fixture = () => structuredClone(source);
const styled = () => {
  const book = fixture();
  const inputs = book.sheets[0];
  inputs.cells.B2.cellStyle = "assumption";
  inputs.cells.B2.style = {
    bold: true,
    italic: false,
    fontSize: 12.5,
    fontFamily: "Georgia",
    color: "#C00000",
    background: { theme: "accent1", tint: 0.6 },
    border: {
      bottom: { style: "double", color: { theme: "ink" } },
      top: { style: "thin" },
    },
    align: { horizontal: "centerContinuous", vertical: "center", wrap: true },
  };
  inputs.cells.B2.link = { url: "https://example.org/notes?id=1" };
  // A style-only cell: blank for formulas, still part of the document.
  inputs.cells.D9 = { style: { border: { left: { style: "medium" } } } };
  inputs.cells.D10 = { link: { sheetId: "inputs", ref: "B2" } };
  inputs.columns = {
    B: { width: 140, style: { bold: true } },
    AA: { width: 64 },
  };
  inputs.rows = {
    1: { height: 32, customHeight: true },
    4: { style: { italic: true } },
  };
  book.namedStyles = [
    { id: "s-margin", name: "Margin", style: { background: "#E2EFDA" } },
  ];
  inputs.cells.B3 = { ...inputs.cells.B3, cellStyle: "s-margin" };
  return book;
};

test("manual formatting, cell styles, links and axes round-trip through the document", async () => {
  const book = styled();
  assert.equal(validateWorkbook(book), book);
  const reopened = readModel(writeModel(book));
  assert.deepEqual(reopened, book);
  // Presentation only: formatting never changes the calculation fingerprint.
  assert.equal(await fingerprint(book), await fingerprint(fixture()));
});

test("built-in and custom cell styles are the only accepted references", () => {
  for (const name of [
    "normal",
    "header",
    "rowHeader",
    "good",
    "heading2",
    "accent3-40",
    "hyperlink",
  ]) {
    const book = fixture();
    book.sheets[0].cells.B2.cellStyle = name;
    validateWorkbook(book);
  }
  const unknown = fixture();
  unknown.sheets[0].cells.B2.cellStyle = "input";
  assert.throws(() => validateWorkbook(unknown), /cell style/);
  const reserved = fixture();
  reserved.namedStyles = [{ id: "good", name: "Mine", style: {} }];
  assert.throws(() => validateWorkbook(reserved), /reserved/);
  const duplicate = fixture();
  duplicate.namedStyles = [
    { id: "a", name: "Same", style: {} },
    { id: "b", name: " same ", style: {} },
  ];
  assert.throws(() => validateWorkbook(duplicate), /name/);
});

test("invalid style values are rejected with explicit reasons", () => {
  const cases = [
    [{ fontSize: 0 }, /Font size/],
    [{ fontSize: 12.3 }, /Font size/],
    [{ fontFamily: "Arial; color:red" }, /font family/],
    [{ color: "red" }, /font colour/],
    [{ background: { theme: "brand" } }, /theme colour/],
    [{ background: { theme: "acc", tint: 2 } }, /tint/],
    [{ border: { diagonal: { style: "thin" } } }, /unknown field diagonal/],
    [{ border: { top: { style: "hair" } } }, /border style/],
    [{ align: { horizontal: "justify" } }, /horizontal/],
    [{ align: { vertical: "distributed" } }, /vertical/],
    [{ underline: "double" }, /underline/],
    [{ indent: 2 }, /unknown field indent/],
  ];
  for (const [style, reason] of cases) {
    const book = fixture();
    book.sheets[0].cells.B2.style = style;
    assert.throws(() => validateWorkbook(book), reason, JSON.stringify(style));
  }
});

test("links accept only web/mail URLs or existing sheets", () => {
  for (const url of [
    "javascript:alert(1)",
    "file:///etc/hosts",
    "data:text/html,x",
    "ftp://x.org",
    "https://",
  ]) {
    const book = fixture();
    book.sheets[0].cells.B2.link = { url };
    assert.throws(() => validateWorkbook(book), /link/i, url);
  }
  const mail = fixture();
  mail.sheets[0].cells.B2.link = { url: "mailto:team@example.org" };
  validateWorkbook(mail);
  const broken = fixture();
  broken.sheets[0].cells.B2.link = { sheetId: "inputs", ref: "#REF!" };
  validateWorkbook(broken);
  const missing = fixture();
  missing.sheets[0].cells.B2.link = { sheetId: "nope", ref: "A1" };
  assert.throws(() => validateWorkbook(missing), /link sheet/);
});

test("row and column entries are bounded and explicit", () => {
  const cases = [
    [{ rows: { 0: { height: 20 } } }, /row key/],
    [{ rows: { 1048577: { height: 20 } } }, /bounds/],
    [{ columns: { XFE: { width: 20 } } }, /bounds/],
    [{ columns: { b: { width: 20 } } }, /column key/],
    [{ columns: { B: {} } }, /Empty/],
    [{ columns: { B: { width: 0 } } }, /width/],
    [{ rows: { 2: { height: 601 } } }, /height/],
    [{ rows: { 2: { customHeight: true } } }, /customHeight/],
    [{ columns: { B: { height: 20 } } }, /unknown field height/],
  ];
  for (const [axes, reason] of cases) {
    const book = fixture();
    Object.assign(book.sheets[0], axes);
    assert.throws(() => validateWorkbook(book), reason, JSON.stringify(axes));
  }
});

test("enriched number-format presets are validated against their kind", () => {
  const ok = [
    { kind: "date", dateStyle: "long" },
    {
      kind: "number",
      digits: 1,
      scale: "millions",
      negative: "redParentheses",
    },
    { kind: "currency", currency: "EUR", digits: 0, scale: "thousands" },
    { kind: "percent", digits: 1, negative: "parentheses" },
  ];
  for (const format of ok) {
    const book = fixture();
    book.sheets[0].cells.B2.format = format;
    validateWorkbook(book);
  }
  const bad = [
    { kind: "number", dateStyle: "long" },
    { kind: "percent", scale: "millions" },
    { kind: "date", negative: "red" },
    { kind: "number", scale: "billions" },
    { kind: "number", code: "#,##0" },
  ];
  for (const format of bad) {
    const book = fixture();
    book.sheets[0].cells.B2.format = format;
    assert.throws(
      () => validateWorkbook(book),
      /format|unknown field/i,
      JSON.stringify(format),
    );
  }
});

test("row tables keep style, link and cell style metadata beside array values", () => {
  const book = fixture();
  const raw = {
    id: "raw",
    name: "Raw",
    metadata: { layout: "table" },
    cells: {
      A1: {
        input: { type: "text", value: "a" },
        style: { bold: true },
        link: { url: "https://example.org" },
      },
      A2: { input: { type: "text", value: "b" }, cellStyle: "good" },
      C1: { style: { background: "#FFFF00" } },
    },
  };
  book.sheets.push(raw);
  const text = writeModel(book);
  const stored = JSON.parse(text).sheets.find((s) => s.id === "raw");
  assert.equal(stored.table.encoding, "rows");
  assert.deepEqual(stored.table.cellMetadata.A1, {
    style: { bold: true },
    link: { url: "https://example.org" },
  });
  assert.deepEqual(
    stored.cells.C1,
    raw.cells.C1,
    "style-only cells stay sparse",
  );
  assert.deepEqual(readModel(text), book);
});

test("structural edits move row/column formatting and internal links; undo restores them", async () => {
  const { shiftWorkbook, structureBeforeRefs, captureHead } = await import(
    "../model/structure.mjs"
  );
  const { EditHistory, captureCells } = await import("../model/history.mjs");
  const book = fixture();
  const inputs = book.sheets[0];
  inputs.rows = {
    2: { height: 30 },
    3: { style: { bold: true } },
    9: { height: 40, customHeight: true },
  };
  inputs.columns = { B: { width: 120 }, D: { style: { italic: true } } };
  inputs.cells.D20 = { link: { sheetId: "inputs", ref: "B3" } };
  book.sheets[1].cells.D1 = { link: { sheetId: "inputs", ref: "A2:B3" } };
  book.sheets[1].cells.D2 = { link: { sheetId: "summary", ref: "A1" } };

  const insert = shiftWorkbook(book, {
    sheetId: "inputs",
    axis: "row",
    action: "insert",
    index: 3,
    count: 2,
  });
  assert.deepEqual(Object.keys(insert.sheets[0].rows), ["2", "5", "11"]);
  assert.equal(insert.sheets[0].cells.D22.link.ref, "B5");
  assert.equal(insert.sheets[1].cells.D1.link.ref, "A2:B5");
  assert.equal(
    insert.sheets[1].cells.D2,
    book.sheets[1].cells.D2,
    "links elsewhere unchanged",
  );
  assert.deepEqual(
    insert.sheets[0].columns,
    inputs.columns,
    "row edits keep columns",
  );

  const columns = shiftWorkbook(book, {
    sheetId: "inputs",
    axis: "column",
    action: "delete",
    index: 3,
    count: 1,
  });
  assert.deepEqual(columns.sheets[0].columns, {
    B: { width: 120 },
    C: { style: { italic: true } },
  });

  const command = {
    sheetId: "inputs",
    axis: "row",
    action: "delete",
    index: 2,
    count: 2,
  };
  const before = captureCells(book, structureBeforeRefs(book, command)),
    headBefore = captureHead(book),
    next = shiftWorkbook(book, command);
  assert.deepEqual(next.sheets[0].rows, {
    7: { height: 40, customHeight: true },
  });
  assert.equal(next.sheets[0].cells.D18.link.ref, "#REF!");
  assert.equal(next.sheets[1].cells.D1.link.ref, "#REF!");
  validateWorkbook(next);
  assert.deepEqual(readModel(writeModel(next)), next);

  const history = new EditHistory();
  history.record({
    structure: command,
    before,
    after: [],
    headBefore,
    headAfter: captureHead(next),
  });
  const working = structuredClone(next);
  history.undo(working);
  assert.deepEqual(working.sheets, book.sheets);
  history.redo(working);
  assert.deepEqual(working.sheets, next.sheets);
  // Formatting-only metadata stays outside the calculation fingerprint.
  assert.equal(
    await fingerprint(insert),
    await fingerprint(
      shiftWorkbook(fixture(), {
        sheetId: "inputs",
        axis: "row",
        action: "insert",
        index: 3,
        count: 2,
      }),
    ),
  );
});

test("formatting pushed past the grid edge is dropped instead of blocking an insert", async () => {
  const { shiftWorkbook } = await import("../model/structure.mjs");
  const book = fixture();
  book.sheets[0].rows = { 1048576: { height: 20 }, 10: { height: 30 } };
  book.sheets[0].columns = { XFD: { width: 90 } };
  const rows = shiftWorkbook(book, {
    sheetId: "inputs",
    axis: "row",
    action: "insert",
    index: 5,
    count: 1,
  });
  assert.deepEqual(rows.sheets[0].rows, { 11: { height: 30 } });
  const columns = shiftWorkbook(book, {
    sheetId: "inputs",
    axis: "column",
    action: "insert",
    index: 1,
    count: 1,
  });
  assert.equal(columns.sheets[0].columns, undefined);
  validateWorkbook(rows);
});
