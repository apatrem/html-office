// Data charts (T18): validation, bindings over typed cells, structural moves.
import test from "node:test";
import assert from "node:assert/strict";
import {
  validateCharts,
  chartData,
  chartOption,
  chartRevision,
  MAX_PREVIEW,
  shiftAnchor,
  isoDate,
  plotSize,
  nextChartId,
  MAX_CHARTS,
} from "../model/charts.mjs";
import { validateWorkbook, VERSION } from "../model/workbook.mjs";
import { shiftWorkbook, inverseStructure } from "../model/structure.mjs";
import { readModel, writeModel } from "../model/document.mjs";
import { display } from "../runtime/view.mjs";

const n = (value, extra = {}) => ({
  input: { type: "number", value },
  ...extra,
});
const t = (value) => ({ input: { type: "text", value } });
const f = (formula, result) => ({ formula, ...(result ? { result } : {}) });
function workbook(charts, cells) {
  return {
    version: VERSION,
    id: "charts",
    title: "Charts",
    dateSystem: "excel1900",
    locale: "en-US",
    sheets: [
      {
        id: "data",
        name: "Data",
        cells: cells ?? {
          A1: t("Month"),
          B1: t("Revenue"),
          C1: t("Costs"),
          A2: t("Jan"),
          B2: n(0.1 + 0.2, { format: { kind: "number", digits: 0 } }),
          C2: n(-0),
          A3: t("Feb"),
          B3: f("=B2*2", { type: "number", value: 0.6000000000000001 }),
          C3: t("n/a"),
        },
      },
      { id: "dash", name: "Dashboard", cells: {} },
    ],
    groups: [],
    names: [],
    ...(charts ? { charts } : {}),
  };
}
const chart = (extra = {}) => ({
  id: "revenue",
  sheetId: "dash",
  anchor: "B2",
  width: 560,
  height: 320,
  type: "column",
  options: { title: "Revenue", unit: "EUR" },
  source: { sheetId: "data", ref: "A1:C3" },
  ...extra,
});
const label = (cell) => display(cell, "en-US");

test("a valid chart passes workbook validation and round-trips through the document", () => {
  const book = workbook([
    chart({ preview: { svg: "<svg></svg>", revision: "a".repeat(64) } }),
  ]);
  assert.equal(validateWorkbook(book), book);
  assert.deepEqual(readModel(writeModel(book)).charts, book.charts);
});

test("chart definitions are validated field by field", () => {
  const invalid = [
    [{ extra: 1 }, /unknown field extra/],
    [{ id: "1x" }, /chart ID/],
    [{ sheetId: "nope" }, /unknown sheet/],
    [{ anchor: "B2:C3" }, /one cell/],
    [{ width: 100 }, /width/],
    [{ height: 1601 }, /height/],
    [{ type: "pie" }, /unknown type/],
    [{ type: "constructor" }, /unknown type/],
    [{ options: { title: 3 } }, /title: string required/],
    [{ options: { categories: ["A"] } }, /categories: unknown field/],
    [{ options: undefined }, /Options: object required/],
    [{ source: { sheetId: "data", ref: "A1:C3", x: 1 } }, /unknown field/],
    [{ source: { sheetId: "gone", ref: "A1" } }, /unknown source sheet/],
    [{ source: { sheetId: "data", ref: "A0" } }, /./],
    [{ preview: { svg: "<div>", revision: "a".repeat(64) } }, /preview/],
    [{ preview: { svg: "<svg/>", revision: "x" } }, /preview/],
  ];
  for (const [patch, error] of invalid)
    assert.throws(
      () => validateCharts(workbook([chart(patch)])),
      error,
      JSON.stringify(patch),
    );
  assert.throws(
    () => validateCharts(workbook([chart(), chart()])),
    /Duplicate/,
  );
  assert.throws(
    () =>
      validateCharts(
        workbook(
          Array.from({ length: MAX_CHARTS + 1 }, (_, i) =>
            chart({ id: `c${i}` }),
          ),
        ),
      ),
    /at most/,
  );
  assert.doesNotThrow(() =>
    validateCharts(
      workbook([chart({ source: { sheetId: "data", ref: "#REF!" } })]),
    ),
  );
});

test("a category binding uses header names, displayed labels and full-precision numbers", () => {
  const book = workbook(),
    { data, errors, issues, formulas } = chartData(book, chart(), label);
  assert.deepEqual(errors, []);
  assert.deepEqual(data, {
    title: "Revenue",
    unit: "EUR",
    categories: ["Jan", "Feb"],
    series: [
      { name: "Revenue", values: [0.30000000000000004, 0.6000000000000001] },
      { name: "Costs", values: [0, null] },
    ],
  });
  assert.deepEqual(issues, [{ ref: "C3", kind: "text" }]);
  assert.equal(formulas, true);
});

test("missing formula results and blanks become missing points", () => {
  const book = workbook(undefined, {
    A1: t("K"),
    B1: t("V"),
    A2: t("x"),
    B2: f("=1"),
    A3: t("y"),
  });
  const { data, issues } = chartData(
    book,
    chart({ source: { sheetId: "data", ref: "A1:B3" } }),
    label,
  );
  assert.deepEqual(data.series[0].values, [null, null]);
  assert.deepEqual(issues, [
    { ref: "B2", kind: "missing" },
    { ref: "B3", kind: "blank" },
  ]);
});

test("waterfall, bubble and Gantt bindings follow their adapters", () => {
  const book = workbook(undefined, {
    A1: t("Step"),
    B1: t("Value"),
    C1: t("Total"),
    A2: t("Start"),
    B2: n(10),
    C2: { input: { type: "boolean", value: true } },
    A3: t("Up"),
    B3: n(2),
    A4: t("End"),
    C4: t("y"),
    E1: t("Task"),
    F1: t("Start"),
    G1: t("End"),
    E2: t("Build"),
    F2: { input: { type: "date", value: 46054 } },
    G2: n(46080, { format: { kind: "date" } }),
    E3: t("Launch"),
    F3: t("2026-04"),
  });
  const w = chartData(
    book,
    chart({
      type: "waterfall",
      options: { unit: "h" },
      source: { sheetId: "data", ref: "A1:C4" },
    }),
    label,
  );
  assert.deepEqual(w.errors, []);
  assert.deepEqual(w.data.items, [
    { label: "Start", value: 10, total: true },
    { label: "Up", value: 2 },
    { label: "End", total: true },
  ]);
  const g = chartData(
    book,
    chart({
      type: "gantt",
      options: {},
      source: { sheetId: "data", ref: "E1:G3" },
    }),
    label,
  );
  assert.deepEqual(g.errors, []);
  assert.deepEqual(g.data.tasks, [
    { name: "Build", start: "2026-02-01", end: "2026-02-27" },
    { name: "Launch", start: "2026-04" },
  ]);
  // A bubble needs every number; problems name the cells.
  const b = chartData(
    book,
    chart({
      type: "bubble",
      options: { unit: "h", xLabel: "X", yLabel: "Y" },
      source: { sheetId: "data", ref: "A1:D3" },
    }),
    label,
  );
  assert.equal(
    b.errors.at(-1),
    "Check C2 (TRUE/FALSE), D2 (blank), C3 (blank), D3 (blank).",
  );
});

test("shape problems are reported instead of drawing", () => {
  const book = workbook();
  for (const [ref, type, message] of [
    ["A1:C1", "column", /header row and data rows/],
    ["A1:A3", "column", /at least 2 columns/],
    ["A1:B3", "waterfall", /3–3 columns/],
    ["#REF!", "line", /deleted/],
  ])
    assert.match(
      chartData(
        book,
        chart({
          type,
          options: { unit: "u" },
          source: { sheetId: "data", ref },
        }),
        label,
      ).errors[0],
      message,
    );
});

test("structural edits move the anchor and the data range; undo restores both", () => {
  const book = workbook([chart({ source: { sheetId: "dash", ref: "B5:D9" } })]);
  const insert = {
    sheetId: "dash",
    axis: "row",
    action: "insert",
    index: 1,
    count: 2,
  };
  const moved = shiftWorkbook(book, insert);
  assert.equal(moved.charts[0].anchor, "B4");
  assert.equal(moved.charts[0].source.ref, "B7:D11");
  assert.deepEqual(
    shiftWorkbook(moved, inverseStructure(insert)).charts,
    book.charts,
  );
  const deleteColumns = {
    sheetId: "dash",
    axis: "column",
    action: "delete",
    index: 2,
    count: 3,
  };
  const deleted = shiftWorkbook(book, deleteColumns);
  assert.equal(deleted.charts[0].anchor, "B2");
  assert.equal(deleted.charts[0].source.ref, "#REF!");
  // Another sheet's edits leave the chart alone.
  const other = shiftWorkbook(book, { ...insert, sheetId: "data" });
  assert.deepEqual(other.charts, book.charts);
});

test("anchors move like cells and stay on the sheet", () => {
  const cmd = (action, index, count, axis = "row") => ({
    sheetId: "s",
    axis,
    action,
    index,
    count,
  });
  assert.equal(shiftAnchor("C5", cmd("insert", 5, 1)), "C6");
  assert.equal(shiftAnchor("C5", cmd("insert", 6, 1)), "C5");
  assert.equal(shiftAnchor("C5", cmd("delete", 3, 2)), "C3");
  assert.equal(shiftAnchor("C5", cmd("delete", 4, 5)), "C4");
  assert.equal(shiftAnchor("C1048576", cmd("insert", 1, 3)), "C1048576");
  assert.equal(shiftAnchor("C5", cmd("delete", 1, 2, "column")), "A5");
});

test("revisions follow the drawn data, size and theme only", async () => {
  const c = chart(),
    data = chartData(workbook(), c, label).data,
    base = await chartRevision(c, data);
  assert.match(base, /^[a-f0-9]{64}$/);
  assert.equal(await chartRevision({ ...c, anchor: "Z9" }, data), base);
  assert.notEqual(await chartRevision({ ...c, width: 561 }, data), base);
  assert.notEqual(await chartRevision(c, data, { acc: "#9E1B32" }), base);
  assert.notEqual(
    await chartRevision(c, { ...data, categories: ["Jan", "Mar"] }),
    base,
  );
});

test("helpers: ISO dates, plot size and new IDs", () => {
  assert.equal(isoDate(1), "1900-01-01");
  assert.equal(isoDate(59), "1900-02-28");
  assert.equal(isoDate(60), "1900-02-29");
  assert.equal(isoDate(61), "1900-03-01");
  assert.equal(isoDate(46054.75), "2026-02-01");
  assert.equal(isoDate(0), null);
  assert.equal(isoDate(2958466), null);
  assert.equal(isoDate(1e10), null);
  assert.deepEqual(plotSize(chart()), { width: 544, height: 262 });
  assert.deepEqual(plotSize(chart({ options: {} })), {
    width: 544,
    height: 304,
  });
  assert.equal(nextChartId(workbook([chart({ id: "chart2" })])), "chart3");
  assert.equal(nextChartId(workbook()), "chart1");
});

test("out-of-range dates and unreadable data are chart problems, not exceptions", () => {
  const book = workbook(undefined, {
    A1: t("Task"),
    B1: t("Start"),
    A2: t("Far"),
    B2: { input: { type: "date", value: 1e10 } },
  });
  const g = chartData(
    book,
    chart({
      type: "gantt",
      options: {},
      source: { sheetId: "data", ref: "A1:B2" },
    }),
    label,
  );
  assert.ok(g.errors.length);
  assert.match(g.errors.at(-1), /B2 \(date outside 1900–9999\)/);
  // An unsupported end would otherwise make the task a milestone.
  const end = chartData(
    workbook(undefined, {
      A1: t("Task"),
      B1: t("Start"),
      C1: t("End"),
      A2: t("Long"),
      B2: { input: { type: "date", value: 46054 } },
      C2: { input: { type: "date", value: 1e10 } },
    }),
    chart({
      type: "gantt",
      options: {},
      source: { sheetId: "data", ref: "A1:C2" },
    }),
    label,
  );
  assert.deepEqual(end.errors, [
    "Dates must be between 1900 and 9999.",
    "Check C2 (date outside 1900–9999).",
  ]);
  const broken = chartData(workbook(), chart(), () => {
    throw new Error("no label");
  });
  assert.deepEqual(broken.errors, ["Its data cannot be read: no label"]);
});

test("formula headers count as formulas for freshness", () => {
  const book = workbook(undefined, {
    A1: t("K"),
    B1: f("=X1", { type: "text", value: "Old name" }),
    A2: t("x"),
    B2: n(1),
  });
  const result = chartData(
    book,
    chart({ source: { sheetId: "data", ref: "A1:B2" } }),
    label,
  );
  assert.equal(result.formulas, true);
  assert.equal(result.data.series[0].name, "Old name");
});

test("Data options carry no interactive state a preview could capture", () => {
  const c = chart(),
    { data } = chartData(workbook(), c, label),
    option = chartOption(c, data, {
      ink: "#000",
      acc: "#111",
      mid: "#222",
      lig: "#333",
      alert: "#444",
      t2: "#555",
      bd: "#666",
      w: "#fff",
      font: "Arial",
    });
  assert.equal(option.legend.selectedMode, false);
  assert.ok(option.series.every((s) => s.silent === true));
});

test("build previews follow the charte, and oversized drawings are not kept", async () => {
  const { renderPreviews } = await import("../tools/chart-previews.mjs");
  const css = (acc) =>
    `:root{--ink:#000;--acc:${acc};--mid:#456;--lig:#789;--alert:#a00;--t2:#555;--bd:#ddd;--bg:#fff;--font:Arial}`;
  const { cssTheme } = await import("../tools/chart-previews.mjs");
  // Aliases resolve as the browser computes them; a token the charte leaves
  // out reads as "", as getPropertyValue() returns it.
  assert.deepEqual(
    cssTheme(
      ":root{--brand:#14517A;--acc:var(--brand);--mid:var(--missing, #456 );--lig:var(--missing,var(--brand));--font:var(--face);--face:Arial}",
    ),
    {
      ink: "",
      acc: "#14517A",
      mid: "#456",
      lig: "#14517A",
      alert: "",
      t2: "",
      bd: "",
      w: "#fff",
      font: "Arial",
    },
  );
  const book = workbook([chart()]);
  const first = await renderPreviews(book, css("#14517A"));
  assert.ok(first.charts[0].preview.svg.includes("#14517A"));
  const same = await renderPreviews(first, css("#14517A"));
  assert.equal(same.charts[0].preview, first.charts[0].preview);
  const rebranded = await renderPreviews(first, css("#9E1B32"));
  assert.notEqual(
    rebranded.charts[0].preview.revision,
    first.charts[0].preview.revision,
  );
  assert.ok(rebranded.charts[0].preview.svg.includes("#9E1B32"));
  // 9,999 columns of bars draw far more than the stored limit.
  const cells = { A1: t("K"), B1: t("V") };
  for (let r = 2; r <= 10000; r++) {
    cells[`A${r}`] = t(`k${r}`);
    cells[`B${r}`] = n(r);
  }
  const big = await renderPreviews(
    workbook(
      [
        chart({
          source: { sheetId: "data", ref: "A1:B10000" },
          preview: first.charts[0].preview,
        }),
      ],
      cells,
    ),
    css("#14517A"),
  );
  assert.equal(big.charts[0].preview, undefined, "no preview over the limit");
  assert.ok(MAX_PREVIEW > 0);
});
