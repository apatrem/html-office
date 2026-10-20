import test from "node:test";
import assert from "node:assert/strict";
import {
  conditionalScales,
  dataBarGeometry,
  compileConditionalFormats,
  conditionalPresentation,
  matchesCondition,
  setConditionalFormat,
  removeConditionalFormat,
  moveConditionalFormat,
} from "../model/conditional.mjs";
const n = (value) => ({ type: "number", value }),
  text = (value) => ({ type: "text", value });
const high = (id = "high") => ({
  id,
  sheetId: "s",
  ref: "A1:A8",
  kind: "highlight",
  condition: { operator: "gte", values: [n(10)] },
  style: { background: "#FFFF00" },
});
const bar = (id = "bar") => ({
  id,
  sheetId: "s",
  ref: "A1:A8",
  kind: "dataBar",
  scale: { kind: "auto" },
  positiveColor: "#0000FF",
  negativeColor: "#FF0000",
});
const fixture = () => ({
  sheets: [
    {
      id: "s",
      cells: {
        A1: { input: n(-100) },
        A2: { input: n(50) },
        A3: { input: n(0) },
        A4: { input: { type: "blank" } },
        A5: { input: text("1000") },
        A6: { formula: "=1/0", result: { type: "error", value: "#DIV/0!" } },
        A7: { formula: "=20", result: n(20) },
        A8: { formula: "=1" },
        B1: { input: n(10000) },
      },
    },
  ],
  conditionalFormats: [high(), bar()],
});
test("data bar scales inspect only numeric/date values in explicit ranges, including saved formula results", () => {
  const book = fixture();
  assert.deepEqual(conditionalScales(book), {
    bar: { min: -100, max: 50, count: 4 },
  });
  const scales = conditionalScales(book, {
    overrides: [
      { sheetId: "s", ref: "A1", cell: { input: n(-20) } },
      { sheetId: "s", ref: "A2", cell: null },
      {
        sheetId: "s",
        ref: "A8",
        cell: { input: { type: "date", value: 100 } },
      },
    ],
  });
  assert.deepEqual(scales, { bar: { min: -20, max: 100, count: 4 } });
  assert.equal(book.sheets[0].cells.A1.input.value, -100);
});
test("bars have a zero axis, clamp fixed bounds and handle negative, positive, zero and constant ranges", () => {
  const negative = dataBarGeometry(-100, { min: -100, max: 50 });
  assert.ok(Math.abs(negative.axis - 200 / 3) < 1e-12);
  assert.equal(negative.left, 0);
  assert.ok(Math.abs(negative.width - 200 / 3) < 1e-12);
  assert.equal(negative.negative, true);
  const positive = dataBarGeometry(50, { min: -100, max: 50 });
  assert.ok(Math.abs(positive.left - 200 / 3) < 1e-12);
  assert.ok(Math.abs(positive.width - 100 / 3) < 1e-12);
  assert.deepEqual(dataBarGeometry(10, { min: 0, max: 10 }), {
    axis: 0,
    left: 0,
    width: 100,
    negative: false,
  });
  assert.deepEqual(dataBarGeometry(-10, { min: -10, max: 0 }), {
    axis: 100,
    left: 0,
    width: 100,
    negative: true,
  });
  assert.deepEqual(dataBarGeometry(-0, { min: 0, max: 0 }), {
    axis: 0,
    left: 0,
    width: 0,
    negative: false,
  });
  assert.equal(dataBarGeometry(1000, { min: -20, max: 20 }).width, 50);
  assert.equal(dataBarGeometry(-1000, { min: -20, max: 20 }).width, 50);
  const extreme = dataBarGeometry(1e308, { min: -1e308, max: 1e308 });
  assert.deepEqual(extreme, { axis: 50, left: 50, width: 50, negative: false });
});
test("conditions preserve types, blank/empty/missing distinctions, error rules and inclusive boundaries", () => {
  assert.equal(
    matchesCondition(n(10), { operator: "between", values: [n(10), n(20)] }),
    true,
  );
  assert.equal(
    matchesCondition(n(20), { operator: "between", values: [n(10), n(20)] }),
    true,
  );
  assert.equal(matchesCondition(text("10"), high().condition), false);
  assert.equal(
    matchesCondition({ type: "blank" }, { operator: "isBlank", values: [] }),
    true,
  );
  assert.equal(
    matchesCondition(text(""), { operator: "isBlank", values: [] }),
    false,
  );
  assert.equal(
    matchesCondition(null, { operator: "isBlank", values: [] }),
    false,
  );
  assert.equal(
    matchesCondition(
      { type: "error", value: "#N/A" },
      { operator: "isError", values: [] },
    ),
    true,
  );
  assert.equal(
    matchesCondition(
      { type: "error", value: "#N/A" },
      { operator: "ne", values: [n(10)] },
    ),
    false,
  );
  assert.equal(
    matchesCondition(text("North"), {
      operator: "contains",
      values: [text("orth")],
    }),
    true,
  );
  assert.equal(
    matchesCondition(text("North"), {
      operator: "contains",
      values: [text("ORTH")],
    }),
    false,
  );
  assert.equal(
    matchesCondition(n(-0), { operator: "eq", values: [n(0)] }),
    true,
  );
  assert.equal(
    matchesCondition(
      { type: "date", value: 10 },
      { operator: "eq", values: [n(10)] },
    ),
    false,
  );
});
test("ordered highlights and bars compose independently, and only the first matching rule of each kind wins", () => {
  const book = fixture(),
    first = high("first"),
    second = { ...high("second"), style: { color: "#111111" } };
  book.conditionalFormats = [first, second, bar()];
  const compiled = compileConditionalFormats(book),
    scales = conditionalScales(book);
  const result = conditionalPresentation(
    compiled,
    "s",
    "A2",
    book.sheets[0].cells.A2,
    scales,
  );
  assert.deepEqual(result.highlight, first.style);
  assert.equal(result.bar.color, "#0000FF");
  assert.equal(
    conditionalPresentation(
      compiled,
      "s",
      "A6",
      book.sheets[0].cells.A6,
      scales,
    ).bar,
    undefined,
  );
  assert.deepEqual(
    conditionalPresentation(
      compiled,
      "s",
      "B1",
      book.sheets[0].cells.B1,
      scales,
    ),
    {},
  );
  book.conditionalFormats[0].ref = "#REF!";
  assert.deepEqual(
    conditionalPresentation(
      compileConditionalFormats(book),
      "s",
      "A2",
      book.sheets[0].cells.A2,
      scales,
    ).highlight,
    second.style,
  );
});
test("metadata commands are atomic, keep cells shared and explicitly reorder/remove rules", () => {
  const book = fixture(),
    next = setConditionalFormat(book, high("extra"));
  assert.equal(next.sheets, book.sheets);
  assert.equal(book.conditionalFormats.length, 2);
  assert.deepEqual(
    moveConditionalFormat(next, "extra", 0).conditionalFormats.map((r) => r.id),
    ["extra", "high", "bar"],
  );
  assert.equal(
    removeConditionalFormat(next, "extra").conditionalFormats.length,
    2,
  );
  assert.throws(() => moveConditionalFormat(next, "extra", 4));
  assert.throws(() =>
    setConditionalFormat(book, { ...bar(), positiveColor: "url(x)" }),
  );
  assert.equal(book.conditionalFormats[1].positiveColor, "#0000FF");
});

test("sparse Excel-sized targets scan only populated cells and earlier missing scales never fall through to a later bar", () => {
  const book = fixture();
  book.conditionalFormats = [
    { ...bar(), ref: "A1:XFD1048576" },
    { ...bar("later"), scale: { kind: "fixed", min: -100, max: 100 } },
  ];
  const scales = conditionalScales(book);
  assert.deepEqual(scales.bar, { min: -100, max: 10000, count: 5 });
  assert.equal(
    conditionalPresentation(
      compileConditionalFormats(book),
      "s",
      "A2",
      book.sheets[0].cells.A2,
      { later: scales.later },
    ).bar,
    undefined,
  );
});
test("metadata commands reject explicit undefined styles", () => {
  const book = fixture();
  for (const key of ["background", "color", "bold"])
    assert.throws(() =>
      setConditionalFormat(book, { ...high(), style: { [key]: undefined } }),
    );
});
test("summary lookups require an own entry for prototype-shaped rule IDs", () => {
  const book = fixture();
  for (const id of ["constructor", "toString", "hasOwnProperty"]) {
    book.conditionalFormats = [bar(id)];
    const compiled = compileConditionalFormats(book);
    assert.equal(
      conditionalPresentation(compiled, "s", "A2", book.sheets[0].cells.A2, {})
        .bar,
      undefined,
    );
    assert.equal(
      conditionalPresentation(
        compiled,
        "s",
        "A2",
        book.sheets[0].cells.A2,
        conditionalScales(book),
      ).bar.color,
      "#0000FF",
    );
  }
});
