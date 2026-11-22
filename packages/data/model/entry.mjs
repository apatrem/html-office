// Text typed into a cell (or pasted) becomes a typed value here, for the
// formula bar and for paste alike. The readers are the CSV import's
// (parseNumber, parseDate, parseBoolean); what changes is where the
// conventions come from: the workbook `locale` for typing, the person's
// choice for a paste. Nothing is guessed: a value that does not read as a
// number, date or Boolean under the convention stays text, and a leading
// zero or more than 15 digits (codes, identifiers) stays text too.
import { parseNumber, parseDate, parseBoolean } from "./csv.mjs";

// Decimal mark and day/month order of a locale. `order` is null where the
// locale writes the year first (only ISO dates are read there).
const known = new Map();
export function conventions(locale) {
  if (!known.has(locale)) known.set(locale, readConventions(locale));
  return known.get(locale);
}
function readConventions(locale) {
  let decimal = "point",
    order = null;
  try {
    decimal =
      new Intl.NumberFormat(locale)
        .formatToParts(1.1)
        .find((p) => p.type === "decimal")?.value === ","
        ? "comma"
        : "point";
    const parts = new Intl.DateTimeFormat(locale, { timeZone: "UTC" })
      .formatToParts(Date.UTC(2000, 10, 25))
      .map((p) => p.type);
    const day = parts.indexOf("day"),
      month = parts.indexOf("month"),
      year = parts.indexOf("year");
    if (year > day && year > month) order = day < month ? "dmy" : "mdy";
  } catch {
    // An unsupported locale never reaches here (the model refuses it).
  }
  return { decimal, order };
}

// The format a typed number brings (percent, currency, grouping), or none.
function numberEntry(text, { decimal }) {
  const parsed = parseNumber(text, decimal);
  if (!parsed || parsed.value === undefined) return null;
  return {
    input: { type: "number", value: parsed.value },
    ...(parsed.format && { format: parsed.format }),
  };
}
function dateEntry(text, { order }) {
  const value = order ? parseDate(text, order) : parseDate(text, "dmy");
  // Without a day/month order, only the unambiguous forms (year first) read.
  if (value === null || (!order && !/^\d{4}[-/.]/.test(text.trim())))
    return null;
  return {
    input: { type: "date", value },
    format: { kind: "date" },
  };
}

// What a text typed into an empty cell is: {kind, input?, format?}. `kind`
// is "blank", "formula", "number", "date", "boolean" or "text".
export function readEntry(text, conv) {
  if (!text.trim()) return { kind: "blank", input: { type: "blank" } };
  if (text.startsWith("=") && text.length > 1) return { kind: "formula" };
  const boolean = parseBoolean(text);
  if (boolean !== null)
    return { kind: "boolean", input: { type: "boolean", value: boolean } };
  const date = dateEntry(text, conv);
  // 2026-03-04 reads as a date; 2026 or 3-4 are numbers or text.
  if (date) return { kind: "date", ...date };
  const number = numberEntry(text, conv);
  if (number) return { kind: "number", ...number };
  return { kind: "text", input: { type: "text", value: text } };
}

// A text read as the type the person chose in the formula bar (any but
// "formula"). An empty text clears the cell, whatever its type; empty text
// itself is ="". Throws a message saying what was expected.
export function readTyped(text, type, conv) {
  if (text === "" || (!text.trim() && type !== "text"))
    return { input: { type: "blank" } };
  if (type === "error" || type === "text")
    return { input: { type, value: text } };
  if (type === "blank") return readEntry(text, conv);
  if (type === "boolean") {
    const value = parseBoolean(text);
    if (value === null) throw new Error("Enter TRUE or FALSE.");
    return { input: { type, value } };
  }
  if (type === "date") {
    const date = dateEntry(text, conv);
    if (date) return date;
  }
  const number = numberEntry(text, conv);
  if (number)
    return {
      input: { type, value: number.input.value },
      ...(type === "number" && number.format && { format: number.format }),
    };
  // A chosen number type takes what the bar shows for any stored number:
  // 17 digits, 1.2345678901234568e+21, a leading zero.
  const plain = conv.decimal === "comma" ? text.replace(",", ".") : text;
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(plain.trim()))
    return { input: { type, value: Number(plain) } };
  const hint =
    conv.decimal === "comma" ? 'use "," for decimals' : 'use "." for decimals';
  throw new Error(
    type === "date"
      ? `"${text}" is not a date: write it as 2026-03-04${conv.order ? `, ${conv.order === "dmy" ? "04/03/2026" : "03/04/2026"}` : ""} or as a day number.`
      : `"${text}" is not a number (${hint}, no letters). Choose the text input type to keep it as text.`,
  );
}

// A number as the formula bar shows it, so that applying it unchanged reads
// back the same value: the locale's decimal mark, full precision, no grouping.
export function numberText(value, { decimal }) {
  const text = String(value);
  return decimal === "comma" ? text.replace(".", ",") : text;
}
