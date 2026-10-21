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
  // A style-only cell: blank for formulas, still part of the document.
  inputs.cells.D9 = { style: { border: { left: { style: "medium" } } } };
  // Links live per sheet, keyed by cell; a link needs no cell record.
  inputs.links = {
    B2: { url: "https://example.org/notes?id=1" },
    D10: { sheetId: "inputs", ref: "B2" },
  };
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
    book.sheets[0].links = { B2: { url } };
    assert.throws(() => validateWorkbook(book), /link/i, url);
  }
  const mail = fixture();
  mail.sheets[0].links = { B2: { url: "mailto:team@example.org" } };
  validateWorkbook(mail);
  const broken = fixture();
  broken.sheets[0].links = { B2: { sheetId: "inputs", ref: "#REF!" } };
  validateWorkbook(broken);
  const missing = fixture();
  missing.sheets[0].links = { B2: { sheetId: "nope", ref: "A1" } };
  assert.throws(() => validateWorkbook(missing), /link sheet/);
  const badKey = fixture();
  badKey.sheets[0].links = { b2: { url: "https://example.org" } };
  assert.throws(() => validateWorkbook(badKey), /address/i);
  const onCell = fixture();
  onCell.sheets[0].cells.B2.link = { url: "https://example.org" };
  assert.throws(() => validateWorkbook(onCell), /unknown field link/);
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

test("row tables keep style and cell style metadata beside array values", () => {
  const book = fixture();
  const raw = {
    id: "raw",
    name: "Raw",
    metadata: { layout: "table" },
    cells: {
      A1: {
        input: { type: "text", value: "a" },
        style: { bold: true },
      },
      A2: { input: { type: "text", value: "b" }, cellStyle: "good" },
      C1: { style: { background: "#FFFF00" } },
    },
  };
  book.sheets.push(raw);
  const text = writeModel(book);
  const stored = JSON.parse(text).sheets.find((s) => s.id === "raw");
  assert.equal(stored.table.encoding, "rows");
  assert.deepEqual(stored.table.cellMetadata.A1, { style: { bold: true } });
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
  inputs.links = {
    D20: { sheetId: "inputs", ref: "B3" },
    B3: { url: "https://example.org/deleted-with-its-row" },
  };
  book.sheets[1].links = {
    D1: { sheetId: "inputs", ref: "A2:B3" },
    D2: { sheetId: "summary", ref: "A1" },
  };

  const insert = shiftWorkbook(book, {
    sheetId: "inputs",
    axis: "row",
    action: "insert",
    index: 3,
    count: 2,
  });
  assert.deepEqual(Object.keys(insert.sheets[0].rows), ["2", "5", "11"]);
  assert.deepEqual(insert.sheets[0].links, {
    D22: { sheetId: "inputs", ref: "B5" },
    B5: { url: "https://example.org/deleted-with-its-row" },
  });
  assert.equal(insert.sheets[1].links.D1.ref, "A2:B5");
  assert.equal(
    insert.sheets[1].links.D2,
    book.sheets[1].links.D2,
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
  assert.deepEqual(next.sheets[0].links, {
    D18: { sheetId: "inputs", ref: "#REF!" },
  });
  assert.equal(next.sheets[1].links.D1.ref, "#REF!");
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

test("relocating links never copies unrelated large sheets", async () => {
  const { shiftWorkbook } = await import("../model/structure.mjs");
  const book = fixture();
  const big = {};
  for (let r = 1; r <= 20000; r++)
    big["A" + r] = { input: { type: "number", value: r } };
  book.sheets.push({ id: "big", name: "Big", cells: big });
  const next = shiftWorkbook(book, {
    sheetId: "inputs",
    axis: "row",
    action: "insert",
    index: 1,
    count: 1,
  });
  assert.equal(
    next.sheets[2],
    book.sheets[2],
    "link-free sheet keeps identity",
  );
});

test("edit boundary rejects unknown cell styles; paste adaptation drops them", async () => {
  const { validateCell } = await import("../model/workbook.mjs");
  const { adaptReferences } = await import("../model/formatting.mjs");
  const book = fixture();
  book.namedStyles = [{ id: "s-known", name: "Known", style: {} }];
  const foreign = { input: { type: "number", value: 1 }, cellStyle: "s-other" };
  validateCell(foreign); // shape alone is valid
  assert.throws(() => validateCell(foreign, book), /Unknown cell style/);
  validateCell({ ...foreign, cellStyle: "s-known" }, book);
  validateCell({ ...foreign, cellStyle: "heading1" }, book);
  assert.deepEqual(adaptReferences(book, foreign), {
    cell: { input: { type: "number", value: 1 } },
    dropped: 1,
  });
  const known = { ...foreign, cellStyle: "s-known" };
  assert.equal(adaptReferences(book, known).cell, known);
  assert.throws(
    () =>
      validateCell({
        ...foreign,
        cellStyle: undefined,
        link: { url: "javascript:alert(1)" },
      }),
    /unknown field link/,
  );
});

test("cell styles may carry a number format; borders accept an explicit none", () => {
  const book = fixture();
  book.namedStyles = [
    {
      id: "s-pct",
      name: "Rate",
      style: { border: { top: { style: "none" }, bottom: { style: "thin" } } },
      format: { kind: "percent", digits: 1 },
    },
  ];
  book.sheets[0].cells.B2.cellStyle = "s-pct";
  book.sheets[0].rows = {
    2: { style: { border: { left: { style: "none" } } } },
  };
  validateWorkbook(book);
  assert.deepEqual(readModel(writeModel(book)), book);
  const badFormat = structuredClone(book);
  badFormat.namedStyles[0].format = { kind: "percent", scale: "millions" };
  assert.throws(() => validateWorkbook(badFormat), /scale/);
  const coloured = structuredClone(book);
  coloured.sheets[0].cells.B2.style = {
    border: { top: { style: "none", color: "#000000" } },
  };
  assert.throws(() => validateWorkbook(coloured), /none border/);
});

test("rich copy carries links; paste replaces target links atomically and safely", async () => {
  const { copyRange, rangePatches } = await import("../model/clipboard.mjs");
  const { pastedLinks, applyLinkEdits } = await import(
    "../model/formatting.mjs"
  );
  const { overlayDraft } = await import("../model/pending.mjs");
  const book = fixture();
  const inputs = book.sheets[0];
  inputs.links = {
    A2: { url: "https://example.org/source" },
    B3: { sheetId: "summary", ref: "B2" },
    D5: { url: "https://example.org/destination-kept" },
    D6: { url: "https://example.org/destination-replaced" },
  };
  const data = copyRange(inputs, "A2:B3");
  assert.deepEqual(data.links, {
    "0,0": { url: "https://example.org/source" },
    "1,1": { sheetId: "summary", ref: "B2" },
  });
  const edits = rangePatches("inputs", "C6", data.cells, {
    origin: data.origin,
  });
  const anchor = { row: 6, column: 3 };
  const { links, dropped } = pastedLinks(
    book,
    "inputs",
    edits,
    data.links,
    anchor,
  );
  assert.equal(dropped, 0);
  assert.deepEqual(links.get("C6"), { url: "https://example.org/source" });
  assert.equal(
    links.get("D6"),
    null,
    "target link without a source link is removed",
  );
  const withLinks = edits.map((edit) => ({
    ...edit,
    link: links.get(edit.ref),
  }));
  const pasted = applyLinkEdits(inputs, withLinks);
  assert.deepEqual(pasted.links, {
    A2: { url: "https://example.org/source" },
    B3: { sheetId: "summary", ref: "B2" },
    D5: { url: "https://example.org/destination-kept" },
    C6: { url: "https://example.org/source" },
    D7: { sheetId: "summary", ref: "B2" },
  });
  // A pending (uncalculated) paste saved as a draft includes its links.
  const draft = overlayDraft(book, withLinks);
  assert.deepEqual(draft.sheets[0].links, pasted.links);
  // Foreign payloads: unknown sheets are dropped, unsafe schemes rejected.
  const foreign = pastedLinks(
    book,
    "inputs",
    edits,
    { "0,0": { sheetId: "elsewhere", ref: "A1" } },
    anchor,
  );
  assert.equal(foreign.dropped, 1);
  assert.equal(foreign.links.get("C6"), null);
  assert.throws(
    () =>
      pastedLinks(
        book,
        "inputs",
        edits,
        { "0,0": { url: "javascript:alert(1)" } },
        anchor,
      ),
    /https, http or mailto/,
  );
});

test("rich paste rejects a result above the per-sheet link limit", async () => {
  const { pastedLinks } = await import("../model/formatting.mjs");
  const book = fixture();
  book.sheets[0].links = {};
  for (let r = 1; r <= 10000; r++)
    book.sheets[0].links["Z" + r] = { url: "https://example.org/" + r };
  validateWorkbook(book);
  const edits = [{ sheetId: "inputs", ref: "C6", cell: null }];
  const source = { "0,0": { url: "https://example.org/new" } };
  assert.throws(
    () => pastedLinks(book, "inputs", edits, source, { row: 6, column: 3 }),
    /10,000 links/,
  );
  // Replacing an existing link keeps the count unchanged.
  const replace = [{ sheetId: "inputs", ref: "Z1", cell: null }];
  pastedLinks(book, "inputs", replace, source, { row: 1, column: 26 });
});
