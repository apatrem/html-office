// Review defect 4: typing into a cell and pasting read text with the CSV
// import's readers, under the workbook locale; nothing is guessed.
import test from "node:test";
import assert from "node:assert/strict";
import {
  conventions,
  readEntry,
  readTyped,
  numberText,
} from "../model/entry.mjs";
import { parsePaste } from "../model/clipboard.mjs";

const us = conventions("en-US"),
  fr = conventions("fr-FR");

test("a locale gives its decimal mark and day/month order", () => {
  assert.deepEqual(us, { decimal: "point", order: "mdy" });
  assert.deepEqual(fr, { decimal: "comma", order: "dmy" });
  assert.deepEqual(conventions("en-GB"), { decimal: "point", order: "dmy" });
  assert.deepEqual(conventions("de-DE"), { decimal: "comma", order: "dmy" });
  // Year first: only ISO dates read.
  assert.deepEqual(conventions("ja-JP"), { decimal: "point", order: null });
  assert.equal(conventions("sv-SE").order, null);
});

test("text typed into an empty cell is read by what it says", () => {
  const kind = (text, conv = us) => readEntry(text, conv).kind;
  assert.equal(kind(""), "blank");
  assert.equal(kind("  "), "blank");
  assert.equal(kind("=A1*2"), "formula");
  assert.equal(kind("="), "text");
  assert.equal(kind("42"), "number");
  assert.equal(kind("-3.5"), "number");
  assert.equal(kind("1,234.5"), "number");
  assert.equal(kind("1e3"), "number");
  assert.equal(kind("TRUE"), "boolean");
  assert.equal(kind("3 apples"), "text");
  assert.equal(kind("0x10"), "text");
  assert.equal(kind("007"), "text");
  assert.equal(kind("12345678901234567"), "text");
  assert.equal(kind("1,5"), "text");
  assert.equal(kind("1,5", fr), "number");
  assert.equal(kind("1.5", fr), "text");
  assert.equal(kind("2026-03-04"), "date");
  assert.equal(kind("04/03/2026"), "date");
  assert.equal(kind("31/02/2026"), "text");
  assert.deepEqual(readEntry("50%", us), {
    kind: "number",
    input: { type: "number", value: 0.5 },
    format: { kind: "percent", digits: 0 },
  });
  assert.deepEqual(readEntry("3,5 %", fr).input, {
    type: "number",
    value: 0.035,
  });
  assert.deepEqual(readEntry("$1,234.50", us).format, {
    kind: "currency",
    currency: "USD",
    digits: 2,
  });
});

test("dates follow the locale's order and never guess without one", () => {
  const march = readEntry("2026-03-04", us).input.value;
  assert.deepEqual(readEntry("03/04/2026", us).input, {
    type: "date",
    value: march,
  });
  assert.deepEqual(readEntry("04/03/2026", fr).input, {
    type: "date",
    value: march,
  });
  // A two-digit year follows Excel: 00-29 are 20xx.
  assert.equal(readEntry("03/04/26", us).input.value, march);
  assert.equal(readEntry("03/04/26", us).format.kind, "date");
  // Year-first locales read ISO only: 03/04/2026 stays text there.
  const ja = conventions("ja-JP");
  assert.equal(readEntry("2026-03-04", ja).kind, "date");
  assert.equal(readEntry("03/04/2026", ja).kind, "text");
});

test("a type chosen in the formula bar reads its text or says what is wrong", () => {
  const number = (text, conv = us) => readTyped(text, "number", conv).input;
  assert.deepEqual(number("50%"), { type: "number", value: 0.5 });
  assert.deepEqual(number("1,5", fr), { type: "number", value: 1.5 });
  assert.deepEqual(readTyped("50%", "number", us).format, {
    kind: "percent",
    digits: 0,
  });
  assert.throws(() => number("0x10"), /"0x10" is not a number/);
  // The fallback keeps the locale's mark and stays finite.
  assert.throws(() => number("1.5", fr), /not a number \(use ","/);
  assert.throws(() => number("1e309"), /not a number/);
  assert.throws(() => number("3 apples"), /not a number/);
  assert.throws(() => number("1,5"), /not a number \(use "\." for decimals/);
  // What the bar shows for a stored number always reads back as a number.
  assert.deepEqual(number("007"), { type: "number", value: 7 });
  assert.deepEqual(number("1234567890123456"), {
    type: "number",
    value: 1234567890123456,
  });
  assert.deepEqual(number("1,2345678901234568e+21", fr), {
    type: "number",
    value: 1.2345678901234568e21,
  });
  assert.throws(() => number("Infinity"), /not a number/);
  assert.deepEqual(readTyped("2026-03-04", "date", us).input.type, "date");
  assert.deepEqual(readTyped("46023", "date", us).input, {
    type: "date",
    value: 46023,
  });
  assert.throws(() => readTyped("soon", "date", us), /not a date/);
  assert.deepEqual(readTyped("vrai", "boolean", fr).input, {
    type: "boolean",
    value: true,
  });
  assert.throws(() => readTyped("yes", "boolean", us), /TRUE or FALSE/);
  assert.deepEqual(readTyped("hello", "text", us).input, {
    type: "text",
    value: "hello",
  });
  assert.deepEqual(readTyped("42", "text", us).input, {
    type: "text",
    value: "42",
  });
  // An empty text clears the cell of any type; " " is text content.
  for (const type of ["number", "text", "date", "boolean", "blank"])
    assert.deepEqual(readTyped("", type, us).input, { type: "blank" }, type);
  assert.equal(readTyped(" ", "text", us).input.value, " ");
  assert.equal(readTyped("=A1", "blank", us).kind, "formula");
});

test("a number shows as it is read back: the locale's mark, full precision", () => {
  assert.equal(numberText(1.5, us), "1.5");
  assert.equal(numberText(1.5, fr), "1,5");
  assert.equal(numberText(0.30000000000000004, fr), "0,30000000000000004");
  assert.equal(numberText(1e-7, fr), "1e-7");
  for (const value of [1.5, -0.25, 1e21, 123456789.125, 1e-7])
    for (const conv of [us, fr])
      assert.equal(
        readTyped(numberText(value, conv), "number", conv).input.value,
        value,
      );
});

test("paste reads with the same readers: two-digit years, grouped European numbers, ISO", () => {
  const input = (text, typing) => parsePaste(text, { typing })[0][0].input;
  assert.deepEqual(input("03/04/26", "en-US"), input("04/03/2026", "fr-FR"));
  assert.equal(input("03/04/26", "en-US").type, "date");
  assert.deepEqual(input("1.234,56", "fr-FR"), {
    type: "number",
    value: 1234.56,
  });
  assert.deepEqual(input("1 234,5", "fr-FR"), {
    type: "number",
    value: 1234.5,
  });
  assert.deepEqual(input("1,234.5", "en-US"), {
    type: "number",
    value: 1234.5,
  });
  // A year written first is unambiguous, so Automatic reads it.
  assert.equal(input("2026-03-04", "auto").type, "date");
  // Still asked, never guessed.
  assert.throws(() => input("03/04/2026", "auto"), /Ambiguous/);
  assert.throws(() => input("1.234,56", "auto"), /Ambiguous/);
  assert.throws(() => input("1.234,56", "en-US"), /Invalid en-US number/);
  assert.throws(() => input("31/02/2026", "fr-FR"), /Invalid date/);
  assert.equal(input("007", "fr-FR").type, "text");
});

test("a pasted typographic minus or parenthesised amount stays text, as before", () => {
  const input = (text) => parsePaste(text, { typing: "en-US" })[0][0].input;
  assert.deepEqual(input("\u22128"), { type: "text", value: "\u22128" });
  assert.deepEqual(input("(5,000)"), { type: "text", value: "(5,000)" });
  assert.deepEqual(input("-8"), { type: "number", value: -8 });
});
