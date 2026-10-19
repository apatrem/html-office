import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeWorkbook,
  decodeWorkbook,
  csvParse,
  csvStringify,
  safeJSON,
} from "../bench/storage/encodings.mjs";
import { VERSION } from "../model/workbook.mjs";
const fixture = () => ({
  version: VERSION,
  id: "typed",
  title: "Types",
  dateSystem: "excel1900",
  locale: "en-US",
  groups: [],
  names: [],
  metadata: { keep: "exact" },
  sheets: [
    {
      id: "raw",
      name: "Raw",
      cells: {
        A1: { input: { type: "text", value: "0012" } },
        B1: { input: { type: "number", value: 1 / 3 } },
        C1: { input: { type: "boolean", value: true } },
        A2: {
          input: {
            type: "text",
            value: 'comma, quote " and\nnewline\ttab </script> café',
          },
        },
        B2: { input: { type: "date", value: 46023 }, format: { kind: "date" } },
        C2: { input: { type: "blank" } },
        A3: { input: { type: "text", value: "" } },
        C3: { input: { type: "error", value: "#REF!" } },
        A4: { input: { type: "text", value: "end" } },
      },
    },
    {
      id: "calc",
      name: "Calculations",
      cells: {
        A1: { formula: "=Raw!B1*3", result: { type: "number", value: 1 } },
        Z500: { input: { type: "number", value: 12 } },
      },
    },
  ],
});
for (const encoding of ["per-cell", "rows", "columns", "csv", "tsv"])
  test(`${encoding}: typed values, holes, formulas and sparse cells round-trip`, () => {
    const book = fixture(),
      encoded = encodeWorkbook(book, encoding, { minimumDensity: 0.2 }),
      decoded = decodeWorkbook(JSON.parse(JSON.stringify(encoded)));
    assert.deepEqual(decoded, book);
    const raw = decoded.sheets[0].cells;
    assert.equal(raw.B3, undefined);
    assert.deepEqual(raw.C2.input, { type: "blank" });
    assert.deepEqual(raw.A3.input, { type: "text", value: "" });
  });
test("CSV parser rejects malformed quoting and retains separators/newlines", () => {
  const rows = [
    ["a,b", 'a"b', "\r\n", ""],
    ["tab\t", "0012", "café", "</script>"],
  ];
  assert.deepEqual(csvParse(csvStringify(rows, ","), ","), rows);
  assert.deepEqual(csvParse(csvStringify(rows, "\t"), "\t"), rows);
  for (const bad of ['"unclosed', '"closed"junk,field', 'unquoted"quote,x'])
    assert.throws(() => csvParse(bad, ","));
});

for (const encoding of ["per-cell", "rows", "columns", "csv", "tsv"])
  test(`${encoding}: signed zero and extreme doubles survive serialized round trips`, () => {
    const book = fixture();
    book.sheets[0].cells.B1.input = { type: "number", value: -0 };
    book.sheets[0].cells.B2.input = { type: "number", value: Number.MIN_VALUE };
    book.sheets[0].cells.B3 = {
      input: { type: "number", value: Number.MAX_VALUE },
    };
    const decoded = decodeWorkbook(
      JSON.parse(
        safeJSON(encodeWorkbook(book, encoding, { minimumDensity: 0.2 })),
      ),
    );
    assert.ok(Object.is(decoded.sheets[0].cells.B1.input.value, -0));
    assert.equal(decoded.sheets[0].cells.B2.input.value, Number.MIN_VALUE);
    assert.equal(decoded.sheets[0].cells.B3.input.value, Number.MAX_VALUE);
  });
test("experimental blocks reject orphan metadata, duplicate sources and extra column vectors", () => {
  const original = encodeWorkbook(fixture(), "columns", {
    minimumDensity: 0.2,
  });
  for (const mutate of [
    (c) => (c.sheets[0].table.cellMetadata.Z99 = { role: "header" }),
    (c) => c.sheets[0].table.data.push([]),
    (c) => (c.sheets[0].table.unrecognised = "do not discard"),
    (c) =>
      (c.sheets[0].table.overrides.B1 = {
        input: { type: "number", value: 12 },
      }),
  ]) {
    const c = structuredClone(original);
    mutate(c);
    assert.throws(() => decodeWorkbook(c));
  }
});
