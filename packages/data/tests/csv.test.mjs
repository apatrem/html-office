// T19 CSV export: values from A1, escaping, locale policy, formula-like text
// and missing results, read back with an independent RFC 4180 parser.
import test from "node:test";
import assert from "node:assert/strict";
import {
  sheetCSV,
  csvBounds,
  isoDate,
  neutralise,
  quote,
  regionalSeparators,
  MAX_CSV_FIELDS,
} from "../runtime/csv.mjs";
import { parseCSV } from "./csv-parse.mjs";

const text = (value) => ({ input: { type: "text", value } });
const number = (value, format) => ({
  input: { type: "number", value },
  ...(format ? { format } : {}),
});

test("separators follow the locale's decimal mark", () => {
  assert.deepEqual(regionalSeparators("en-US"), {
    separator: ",",
    decimal: ".",
  });
  assert.deepEqual(regionalSeparators("en-GB"), {
    separator: ",",
    decimal: ".",
  });
  for (const locale of ["fr-FR", "de-DE", "es-ES", "it-IT", "pt-BR"])
    assert.deepEqual(regionalSeparators(locale), {
      separator: ";",
      decimal: ",",
    });
});

test("fields are quoted only when needed, with quotes doubled", () => {
  assert.equal(quote("plain", ","), "plain");
  assert.equal(quote("a,b", ","), '"a,b"');
  assert.equal(quote("a,b", ";"), "a,b");
  assert.equal(quote("a;b", ";"), '"a;b"');
  assert.equal(quote('say "hi"', ","), '"say ""hi"""');
  assert.equal(quote("two\nlines", ","), '"two\nlines"');
  assert.equal(quote("cr\rhere", ","), '"cr\rhere"');
  assert.equal(quote(" padded ", ","), '" padded "');
  assert.equal(quote("", ","), "");
});

test("formula-like text gets a leading apostrophe; other text is kept", () => {
  for (const value of [
    "=1+1",
    "+33 1 23",
    "-5",
    "@SUM(A1)",
    "\tTab",
    "\rCR",
    '  =HYPERLINK("x")',
    "＝1+1",
    "　=1",
  ])
    assert.equal(neutralise(value), `'${value}`, JSON.stringify(value));
  for (const value of ["Revenue", "a=b", "3-2", "", "#N/A", "'quoted"])
    assert.equal(neutralise(value), value);
});

test("dates are ISO, with the 1900 leap day and times to the second", () => {
  assert.equal(isoDate(1), "1900-01-01");
  assert.equal(isoDate(59), "1900-02-28");
  assert.equal(isoDate(60), "1900-02-29");
  assert.equal(isoDate(61), "1900-03-01");
  assert.equal(isoDate(45000), "2023-03-15");
  assert.equal(isoDate(45000.5), "2023-03-15 12:00:00");
  assert.equal(isoDate(45000.999999), "2023-03-16");
  assert.equal(isoDate(0), "1899-12-31");
  assert.equal(isoDate(2958465), "9999-12-31");
});

test("the exported rectangle runs from A1 to the last filled cell", () => {
  assert.deepEqual(csvBounds({ cells: {} }), { rows: 0, columns: 0 });
  assert.deepEqual(
    csvBounds({
      cells: {
        C4: text("x"),
        B9: { formula: "=1" },
        // Style-only cells and explicit blanks do not extend it.
        Z99: { cellStyle: "header" },
        Y50: { input: { type: "blank" } },
      },
    }),
    { rows: 9, columns: 3 },
  );
});

const sheet = {
  cells: {
    A1: text("Label"),
    B1: text("Amount"),
    C1: text("Date"),
    D1: text("Flag"),
    A2: text('Quote "and", comma; semi'),
    B2: number(-1234.5, { kind: "currency", currency: "EUR", digits: 2 }),
    C2: number(45000, { kind: "date" }),
    D2: { input: { type: "boolean", value: true } },
    A3: text("=cmd|' /C calc'!A0"),
    B3: { formula: "=B2*2", result: { type: "number", value: -2469 } },
    C3: { formula: "=1/0", result: { type: "error", value: "#DIV/0!" } },
    D3: { formula: "=NOPE()" },
    A4: text("Two\r\nlines"),
    B4: number(0.000001234, { kind: "percent", digits: 1 }),
    C4: number(1e21),
    D4: { formula: '=""', result: { type: "text", value: "-neg" } },
    A6: text("après"),
  },
};

test("calculated values read back typed and unformatted (en-US)", () => {
  const csv = sheetCSV(sheet, { locale: "en-US" });
  assert.ok(csv.text.startsWith("﻿"), "UTF-8 BOM");
  assert.match(csv.text, /\r\n$/);
  assert.equal(csv.missing, 1);
  assert.equal(csv.neutralised, 2);
  const rows = parseCSV(csv.text, ",");
  assert.equal(rows.length, 6);
  assert.ok(rows.every((row) => row.length === 4));
  assert.deepEqual(rows, [
    ["Label", "Amount", "Date", "Flag"],
    ['Quote "and", comma; semi', "-1234.5", "2023-03-15", "TRUE"],
    ["'=cmd|' /C calc'!A0", "-2469", "#DIV/0!", ""],
    ["Two\r\nlines", "0.000001234", "1e+21", "'-neg"],
    ["", "", "", ""],
    ["après", "", "", ""],
  ]);
  // No formula or style text appears anywhere.
  assert.doesNotMatch(csv.text, /=B2\*2|=NOPE|EUR|currency/);
  for (const [field, value] of [
    [rows[1][1], -1234.5],
    [rows[2][1], -2469],
    [rows[3][1], 0.000001234],
    [rows[3][2], 1e21],
  ])
    assert.equal(Number(field), value);
});

test("a decimal-comma locale uses semicolons and decimal commas", () => {
  const csv = sheetCSV(sheet, { locale: "fr-FR" });
  assert.equal(csv.separator, ";");
  const rows = parseCSV(csv.text, ";");
  assert.deepEqual(rows[1], [
    'Quote "and", comma; semi',
    "-1234,5",
    "2023-03-15",
    "TRUE",
  ]);
  assert.equal(rows[3][1], "0,000001234");
  assert.equal(Number(rows[1][1].replace(",", ".")), -1234.5);
  // Chosen separators override the locale.
  const international = sheetCSV(sheet, {
    locale: "fr-FR",
    separator: ",",
    decimal: ".",
  });
  assert.equal(parseCSV(international.text, ",")[1][1], "-1234.5");
});

test("displayed text matches the grid, still neutralised", () => {
  const rows = parseCSV(
    sheetCSV(sheet, { locale: "en-US", values: false }).text,
  );
  assert.deepEqual(rows[1], [
    'Quote "and", comma; semi',
    "-€1,234.50",
    "03/15/2023",
    "TRUE",
  ]);
  assert.equal(rows[2][0], "'=cmd|' /C calc'!A0");
  assert.equal(rows[3][1], "0.0%");
  const fr = parseCSV(
    sheetCSV(sheet, { locale: "fr-FR", values: false }).text,
    ";",
  );
  assert.equal(fr[1][1], "-1 234,50 €");
  assert.equal(fr[1][2], "15/03/2023");
});

test("huge sparse sheets are refused before building text", () => {
  const csv = sheetCSV({ cells: { A1: text("a"), XFD1048576: text("z") } });
  assert.match(csv.refused, /too large for CSV/);
  assert.equal(csv.text, undefined);
  assert.ok(16384 * 1048576 > MAX_CSV_FIELDS);
});
