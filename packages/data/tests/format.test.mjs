import test from "node:test";
import assert from "node:assert/strict";
import { display } from "../runtime/view.mjs";
import { validateWorkbook } from "../model/workbook.mjs";
import { readFile } from "node:fs/promises";
const number = (value, format) => ({
  input: { type: "number", value },
  format,
});
test("date display uses Excel 1900 serials, including its fictitious leap day, without changing data", () => {
  for (const [serial, expected] of [
    [0, "12/31/1899"],
    [1, "01/01/1900"],
    [59, "02/28/1900"],
    [60, "02/29/1900"],
    [61, "03/01/1900"],
    [45292.5, "01/01/2024"],
    [2958465, "12/31/9999"],
    [-1, "####"],
    [2958466, "####"],
  ]) {
    const cell = { input: { type: "date", value: serial } };
    assert.equal(display(cell), expected);
    assert.equal(cell.input.value, serial);
  }
  assert.equal(display(number(60, { kind: "date" }), "fr-FR"), "29/02/1900");
});
test("number, currency, accounting and percent formats preserve precision and respect display locale", () => {
  const cell = number(-1234.56789, {
    kind: "accounting",
    currency: "USD",
    digits: 2,
  });
  assert.equal(display(cell), "($1,234.57)");
  assert.equal(
    display(number(0.123456789, { kind: "percent", digits: 2 })),
    "12.35%",
  );
  assert.equal(
    display(number(1234.56789, { kind: "number", digits: 3 }), "fr-FR"),
    "1\u202f234,568",
  );
  assert.equal(display(number(-0, { kind: "number", digits: 2 })), "-0.00");
  assert.equal(cell.input.value, -1234.56789);
  assert.equal(
    display({
      formula: "=1/0",
      result: { type: "error", value: "#DIV/0!" },
      format: { kind: "currency" },
    }),
    "#DIV/0!",
  );
});
test("workbook locale is a supported Intl display locale, never a formula-language setting", async () => {
  const book = JSON.parse(
    await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
  );
  book.locale = "fr-FR";
  assert.equal(
    validateWorkbook(book).sheets[1].cells.B2.formula,
    "=Inputs!B2*Inputs!B3",
  );
  for (const locale of ["invalid", "<script>", "en_US", null]) {
    book.locale = locale;
    assert.throws(() => validateWorkbook(book), /header/);
  }
});
test("presets show long dates, k/M scales and negatives in parentheses or red", async () => {
  const { negativeRed } = await import("../runtime/view.mjs");
  assert.equal(
    display(number(45292, { kind: "date", dateStyle: "long" })),
    "January 1, 2024",
  );
  assert.equal(
    display(number(60, { kind: "date", dateStyle: "long" }), "fr-FR"),
    "29 février 1900",
  );
  assert.equal(
    display(
      number(3953.4, {
        kind: "currency",
        currency: "EUR",
        digits: 1,
        scale: "thousands",
      }),
    ),
    "€4.0k",
  );
  assert.equal(
    display(number(-2500000, { kind: "number", digits: 1, scale: "millions" })),
    "-2.5M",
  );
  const parentheses = number(-1234.5, {
    kind: "number",
    digits: 0,
    negative: "parentheses",
  });
  assert.equal(display(parentheses), "(1,235)");
  assert.equal(negativeRed(parentheses), false);
  const red = number(-12, {
    kind: "percent",
    digits: 0,
    negative: "redParentheses",
  });
  assert.equal(display(red), "(1,200%)");
  assert.equal(negativeRed(red), true);
  assert.equal(
    negativeRed(number(12, { kind: "number", negative: "red" })),
    false,
  );
  assert.equal(red.input.value, -12);
});
test("one sign policy: accounting parentheses by default, explicit minus, unsigned zero in parentheses", () => {
  const accounting = (value, extra = {}) =>
    number(value, { kind: "accounting", currency: "USD", digits: 2, ...extra });
  assert.equal(display(accounting(-1234.5)), "($1,234.50)");
  assert.equal(
    display(accounting(-1234.5, { negative: "minus" })),
    "-$1,234.50",
  );
  assert.match(display(accounting(-1234.5), "fr-FR"), /^\(1\s234,50\s\$US\)$/);
  assert.equal(
    display(number(-0, { kind: "number", digits: 2, negative: "parentheses" })),
    "0.00",
  );
  assert.equal(display(accounting(-0)), "$0.00");
});
