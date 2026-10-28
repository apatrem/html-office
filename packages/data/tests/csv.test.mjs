// CSV import model (T15): decoding, delimiters, RFC 4180 fields, typed
// values, locale ambiguity, source metadata and structural shifts.
import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeCSV,
  sniffDelimiter,
  parseCSV,
  parseNumber,
  parseDate,
  readCSV,
} from "../model/csv.mjs";
import { validateSources } from "../model/sources.mjs";
import { columnFingerprints, fileDigest } from "../model/source-digest.mjs";
import { validateWorkbook } from "../model/workbook.mjs";
import { shiftWorkbook } from "../model/structure.mjs";
import { writeModel, readModel } from "../model/document.mjs";
import { sheetName } from "../runtime/import.mjs";

const utf8 = (s) => new TextEncoder().encode(s);
const read = (s, options) => readCSV(utf8(s), options);
const input = (r, ref) => r.cells[ref]?.input;

test("decoding: BOMs, strict UTF-8, Windows-1252 fallback and explicit encodings", () => {
  assert.equal(decodeCSV(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])).text, "a");
  const le = decodeCSV(new Uint8Array([0xff, 0xfe, 0xe9, 0x00]));
  assert.deepEqual([le.text, le.encoding], ["é", "utf-16le"]);
  const be = decodeCSV(new Uint8Array([0xfe, 0xff, 0x00, 0xe9]));
  assert.deepEqual([be.text, be.encoding], ["é", "utf-16be"]);
  // "Café;Élan" as Windows-1252 (Excel for Windows, French "CSV").
  const latin = new Uint8Array([
    0x43, 0x61, 0x66, 0xe9, 0x3b, 0xc9, 0x6c, 0x61, 0x6e,
  ]);
  const fallback = decodeCSV(latin);
  assert.deepEqual(
    [fallback.text, fallback.encoding, fallback.fallback],
    ["Café;Élan", "windows-1252", true],
  );
  // Mac OS Roman é is 0x8E.
  assert.equal(decodeCSV(new Uint8Array([0x8e]), "macintosh").text, "é");
  assert.equal(decodeCSV(utf8("日本語,😀")).text, "日本語,😀");
  assert.throws(
    () => decodeCSV(new Uint8Array(1), "ebcdic"),
    /Unsupported encoding/,
  );
  const r = readCSV(latin);
  assert.match(r.diagnostics[0], /not UTF-8; it was read as Western/);
});

test("delimiters: sniffing, sep= lines and explicit choice", () => {
  assert.equal(sniffDelimiter("a,b,c\n1,2,3\n"), ",");
  assert.equal(sniffDelimiter("a;b;c\n1,5;2,5;3\n"), ";");
  assert.equal(sniffDelimiter("a\tb\n1\t2\n"), "\t");
  assert.equal(sniffDelimiter("a|b\n1|2\n"), "|");
  // A quoted delimiter does not count.
  assert.equal(sniffDelimiter('name;note\nA;"x, y, z"\nB;"p, q"\n'), ";");
  assert.equal(sniffDelimiter("single\ncolumn\n"), ",");
  const sep = read("sep=;\na;b\n1;2\n");
  assert.equal(sep.delimiter, ";");
  assert.equal(input(sep, "A1").value, "a");
  assert.match(sep.diagnostics.join(" "), /sep=;/);
  assert.equal(read("a;b\n1;2\n", { delimiter: "," }).width, 1);
});

test("RFC 4180: quoted delimiters, doubled quotes, multiline fields, CRLF and ragged rows", () => {
  const { rows, width, stats } = parseCSV(
    'id,text\r\n1,"a, b"\r\n2,"say ""hi"""\r\n3,"line 1\r\nline 2"\r\n4\r\n\r\n',
    ",",
  );
  assert.equal(width, 2);
  assert.deepEqual(rows, [
    ["id", "text"],
    ["1", "a, b"],
    ["2", 'say "hi"'],
    ["3", "line 1\nline 2"],
    ["4"],
  ]);
  assert.equal(stats.multiline, 1);
  // Excel's leniency: a quote inside an unquoted field is literal.
  const lenient = parseCSV('a,5" pipe,"x"y\n', ",");
  assert.deepEqual(lenient.rows[0], ["a", '5" pipe', "xy"]);
  assert.equal(lenient.stats.strayQuotes, 2);
  assert.throws(
    () => parseCSV('a,b\n1,"open\n2,3\n', ","),
    /opened on line 2 is never closed/,
  );
  assert.throws(() => parseCSV("a,b\n", '"'), /single delimiter/);
  const ragged = read("a,b,c\n1,2\n3,4,5\n");
  assert.match(ragged.diagnostics.join(" "), /1 row has fewer fields/);
  assert.equal(ragged.cells.C2, undefined);
});

test("limits: cells, rows and columns are refused rather than truncated", () => {
  assert.throws(
    () => parseCSV("a,b,c\n1,2,3\n", ",", { maxCells: 5 }),
    /more than 5 cells/,
  );
  assert.throws(
    () => parseCSV("a\nb\nc,d,e,f\n", ",", { maxCells: 10 }),
    /larger than 10 cells|more than 10 cells/,
  );
});

test("numbers: conventions, grouping, signs, currency, percent and guards", () => {
  const n = (s, d) => parseNumber(s, d);
  assert.deepEqual(n("1234.5", "point"), { value: 1234.5 });
  assert.deepEqual(n("1,234.50", "point"), {
    value: 1234.5,
    format: { kind: "number", digits: 2 },
  });
  assert.equal(n("1234,5", "point"), null);
  assert.deepEqual(n("1 234,50", "comma"), {
    value: 1234.5,
    format: { kind: "number", digits: 2 },
  });
  assert.equal(n("1 234,5", "comma").value, 1234.5);
  assert.equal(n("1.234.567,8", "comma").value, 1234567.8);
  assert.equal(n("1 234.567,8", "comma"), null, "mixed group separators");
  assert.equal(n("-12.5", "point").value, -12.5);
  assert.equal(n("−12,5", "comma").value, -12.5);
  assert.equal(n("(1,234.00)", "point").value, -1234);
  assert.deepEqual(n("$1,234.50", "point"), {
    value: 1234.5,
    format: { kind: "currency", currency: "USD", digits: 2 },
  });
  assert.deepEqual(n("1 234,50 €", "comma"), {
    value: 1234.5,
    format: { kind: "currency", currency: "EUR", digits: 2 },
  });
  assert.deepEqual(n("12,5 %", "comma"), {
    value: 0.125,
    format: { kind: "percent", digits: 1 },
  });
  assert.equal(n("1.5E+10", "point").value, 1.5e10);
  assert.equal(n("1,5E+10", "comma").value, 1.5e10);
  assert.equal(n(".5", "point").value, 0.5);
  assert.equal(n("0.5", "point").value, 0.5);
  assert.equal(n("0", "point").value, 0);
  assert.deepEqual(n("0012", "point"), { leadingZero: true });
  assert.deepEqual(n("1234567890123456", "point"), { tooLong: true });
  for (const text of ["", "abc", "12abc", "1-2", "$12$", "--1", "1.2.3", "€5%"])
    assert.equal(n(text, "point"), null, text);
});

test("dates: ISO, day-first, month-first, two-digit years and times", () => {
  assert.equal(parseDate("2026-10-28", "mdy"), 46323);
  assert.equal(parseDate("2026/10/28", "dmy"), 46323);
  assert.equal(parseDate("28/10/2026", "dmy"), 46323);
  assert.equal(parseDate("28/10/2026", "mdy"), null);
  assert.equal(parseDate("10/28/2026", "mdy"), 46323);
  assert.equal(parseDate("28.10.2026", "dmy"), 46323);
  assert.equal(parseDate("28-10-26", "dmy"), 46323);
  assert.equal(parseDate("01/01/30", "dmy"), parseDate("1930-01-01", "dmy"));
  assert.equal(parseDate("2026-10-28 18:00", "dmy"), 46323.75);
  assert.equal(parseDate("2026-10-28T06:00:00", "dmy"), 46323.25);
  assert.equal(parseDate("10/28/2026 6:00 PM", "mdy"), 46323.75);
  assert.equal(parseDate("1900-03-01", "dmy"), 61);
  for (const text of [
    "2026-02-30",
    "31/04/2026",
    "1899-12-31",
    "2026-10-28Z",
    "25:00",
    "2026-10-28 24:00",
  ])
    assert.equal(parseDate(text, "dmy"), null, text);
});

test("typing: header, leading zeros, Unicode, formula-like text, booleans and blanks", () => {
  const r = read(
    'Code,Ville,Montant,Actif,Note\n0012,Zürich,12.5,TRUE,"=HYPERLINK(""x"")"\n0345,東京 😀,,false,+cmd\n',
  );
  assert.equal(r.header, true);
  assert.deepEqual(input(r, "A1"), { type: "text", value: "Code" });
  assert.equal(r.cells.A1.cellStyle, "header");
  assert.deepEqual(input(r, "A2"), { type: "text", value: "0012" });
  assert.deepEqual(input(r, "B3"), { type: "text", value: "東京 😀" });
  assert.deepEqual(input(r, "C2"), { type: "number", value: 12.5 });
  assert.equal(r.cells.C3, undefined, "an empty field is no cell");
  assert.deepEqual(input(r, "D2"), { type: "boolean", value: true });
  assert.deepEqual(input(r, "D3"), { type: "boolean", value: false });
  assert.deepEqual(input(r, "E2"), { type: "text", value: '=HYPERLINK("x")' });
  assert.deepEqual(input(r, "E3"), { type: "text", value: "+cmd" });
  assert.equal(r.columns[0].detected, "text");
  assert.match(
    r.diagnostics.join(" "),
    /Column A \(Code\) is kept as text: values such as "0012"/,
  );
  assert.match(r.diagnostics.join(" "), /2 values start like a formula/);
  // A column forced to Number drops the leading zeros.
  const forced = read("Code\n0012\nx\n", { columns: ["number"] });
  assert.deepEqual(input(forced, "A2"), { type: "number", value: 12 });
  assert.deepEqual(input(forced, "A3"), { type: "text", value: "x" });
  assert.equal(forced.columns[0].exceptions, 1);
  // Text forces every value, numbers included.
  const text = read("A,B\n1,2\n", { columns: ["text"] });
  assert.deepEqual(input(text, "A2"), { type: "text", value: "1" });
  assert.deepEqual(input(text, "B2"), { type: "number", value: 2 });
  // No header when the first row holds data.
  const data = read("1,2\n3,4\n");
  assert.equal(data.header, false);
  assert.deepEqual(input(data, "A1"), { type: "number", value: 1 });
  assert.equal(
    read("1,2\n3,4\n", { header: true }).cells.A1.cellStyle,
    "header",
  );
});

test("locale: evidence decides, ambiguity asks and blocks, conflicts ask", () => {
  // French Excel: semicolons, decimal commas, day-first dates.
  const fr = read("Date;Montant\n28/10/2026;1 234,56\n01/02/2026;7,5\n");
  assert.deepEqual(fr.conventions, { decimal: "comma", dates: "dmy" });
  assert.deepEqual(fr.detected, { decimal: "comma", dates: "dmy" });
  assert.deepEqual(input(fr, "B2"), { type: "number", value: 1234.56 });
  assert.deepEqual(input(fr, "A3"), { type: "date", value: 46054 });
  // US Excel: points and month-first dates.
  const us = read('Date,Amount\n10/28/2026,"1,234.56"\n02/01/2026,7.5\n');
  assert.deepEqual(us.conventions, { decimal: "point", dates: "mdy" });
  assert.deepEqual(input(us, "A3"), { type: "date", value: 46054 });
  // UK: points with day-first dates.
  const uk = read("Date,Amount\n28/10/2026,1234.56\n");
  assert.deepEqual(uk.conventions, { decimal: "point", dates: "dmy" });
  // Only ambiguous values: the person chooses; nothing is guessed meanwhile.
  const ambiguous = read('Date,Amount\n03/04/2026,"1,234"\n');
  assert.deepEqual(ambiguous.conventions, { decimal: "ask", dates: "ask" });
  assert.deepEqual(
    ambiguous.ambiguity.map((a) => [a.kind, a.conflict, a.example.ref]),
    [
      ["decimal", false, "B2"],
      ["dates", false, "A2"],
    ],
  );
  assert.match(ambiguous.ambiguity[0].message, /"1,234" \(B2\) could be read/);
  assert.equal(input(ambiguous, "B2").type, "text");
  assert.equal(input(ambiguous, "A2").type, "text");
  const resolved = read('Date,Amount\n03/04/2026,"1,234"\n', {
    decimal: "comma",
    dates: "dmy",
  });
  assert.deepEqual(resolved.ambiguity, []);
  assert.deepEqual(input(resolved, "B2"), { type: "number", value: 1.234 });
  assert.deepEqual(input(resolved, "A2"), {
    type: "date",
    value: parseDate("2026-04-03", "dmy"),
  });
  // Mixed evidence is a conflict.
  const mixed = read("A;B\n1,5;2.5\n");
  assert.equal(mixed.ambiguity[0].conflict, true);
  assert.match(
    mixed.ambiguity[0].message,
    /mixes decimal points and decimal commas/,
  );
  // Plain integers need no choice.
  assert.deepEqual(read("A,B\n1,2\n").ambiguity, []);
});

test("source metadata validates, survives the document codec and shifts with structure", async () => {
  const cells = read("Region,Amount\nNord,1\nSud,2\n").cells,
    digests = await columnFingerprints(cells, "A1:B3"),
    again = await columnFingerprints(
      { ...cells, B2: { input: { type: "number", value: 5 } } },
      "A1:B3",
    );
  assert.equal(digests.length, 2);
  assert.equal(digests[0], again[0]);
  assert.notEqual(digests[1], again[1]);
  const book = {
    version: "html-data/0.1",
    id: "imp",
    title: "Import",
    dateSystem: "excel1900",
    locale: "en-US",
    sheets: [{ id: "raw", name: "Raw", metadata: { layout: "table" }, cells }],
    groups: [],
    names: [],
    sources: [
      {
        id: "source-1",
        sheetId: "raw",
        ref: "A1:B3",
        kind: "csv",
        file: {
          name: "sales.csv",
          bytes: 30,
          modified: "2026-10-28T09:00:00.000Z",
          sha256: await fileDigest(utf8("x")),
        },
        importedAt: "2026-10-28T10:00:00.000Z",
        options: {
          encoding: "utf-8",
          delimiter: ",",
          header: true,
          decimal: "point",
          dates: "dmy",
        },
        columns: [
          { name: "Region", type: "auto", fingerprint: digests[0] },
          { name: "Amount", type: "auto", fingerprint: digests[1] },
        ],
      },
    ],
  };
  validateWorkbook(book);
  const reopened = readModel(writeModel(book));
  assert.deepEqual(reopened.sources, book.sources);
  assert.equal(JSON.parse(writeModel(book)).sheets[0].table.encoding, "rows");
  const inserted = shiftWorkbook(book, {
    sheetId: "raw",
    axis: "row",
    action: "insert",
    index: 2,
    count: 2,
  });
  assert.equal(inserted.sources[0].ref, "A1:B5");
  const deleted = shiftWorkbook(book, {
    sheetId: "raw",
    axis: "column",
    action: "delete",
    index: 1,
    count: 2,
  });
  assert.equal(deleted.sources[0].ref, "#REF!");
  validateWorkbook(deleted);
  const bad = (change, pattern) => {
    const copy = structuredClone(book);
    change(copy.sources[0], copy);
    assert.throws(() => validateSources(copy), pattern);
  };
  bad((s) => (s.path = "/Users/x/sales.csv"), /unknown field path/);
  bad((s) => (s.sheetId = "nope"), /unknown sheet/);
  bad((s) => (s.kind = "url"), /unsupported kind/);
  bad((s) => (s.file.sha256 = "x"), /sha256/);
  bad((s) => (s.options.delimiter = ":"), /invalid option delimiter/);
  bad((s) => (s.columns[0].type = "currency"), /invalid column type/);
  bad((s, b) => b.sources.push({ ...s }), /duplicate or invalid ID/);
});

test("sheet names come from the file name, valid and unique", () => {
  const sheets = [{ name: "sales" }, { name: "Sales (2)" }];
  assert.equal(sheetName("Sales.csv", sheets), "Sales (3)");
  assert.equal(sheetName("Q3: [draft]?.CSV", []), "Q3 draft");
  assert.equal(sheetName(".csv", []), "Imported");
  assert.equal(sheetName("x".repeat(40) + ".csv", []).length, 31);
});

test("review: only typed body values decide the conventions", () => {
  // A text code column (leading zeros) must not decide the decimal point.
  const codes = read("Code;Amount\n0012;1,234\n1.23;2,345\n");
  assert.equal(codes.conventions.decimal, "ask");
  assert.equal(input(codes, "B2").type, "text");
  // Nor a column the person set to Text.
  const forced = read('Ref,Amount\n1.5,"1,234"\n', { columns: ["text"] });
  assert.equal(forced.conventions.decimal, "ask");
  // Nor numeric-looking headers (here the first row is data, no header).
  const numericHeader = read("1.5;Amount\nx;1,234\n", { header: true });
  assert.equal(numericHeader.conventions.decimal, "ask");
  // Space grouping reads the same under both conventions.
  const spaced = read("Count;Amount\n1 234;1,234\n");
  assert.equal(spaced.conventions.decimal, "ask");
  assert.equal(parseNumber("1 234.5", "point").value, 1234.5);
  assert.equal(parseNumber("1 234", "point").value, 1234);
});

test("review: identifiers keep every digit whatever their form", () => {
  assert.deepEqual(parseNumber("001.234", "comma"), { leadingZero: true });
  assert.deepEqual(parseNumber("001,234", "point"), { leadingZero: true });
  assert.deepEqual(parseNumber("9007199254740993.0", "point"), {
    tooLong: true,
  });
  assert.deepEqual(parseNumber("9007199254740993e0", "point"), {
    tooLong: true,
  });
  for (const text of ["001.234", "9007199254740993.0", "9007199254740993e0"]) {
    const r = read(`ID\n${text}\n`);
    assert.deepEqual(input(r, "A2"), { type: "text", value: text }, text);
    assert.match(r.diagnostics.join(" "), /Column A \(ID\) is kept as text/);
  }
});

test("review: fractional seconds are kept", () => {
  const whole = parseDate("2026-10-28T06:00:00", "dmy"),
    ms = parseDate("2026-10-28T06:00:00.999", "dmy");
  assert.ok(Math.abs((ms - whole) * 86400000 - 999) < 1e-3);
  assert.equal(parseDate("2026-10-28T06:00:60", "dmy"), null);
});

test("review: a decimal comma does not make the comma the delimiter", () => {
  assert.equal(sniffDelimiter("2026;1,5\n2027;2,5\n"), ";");
  const r = read("2026;1,5\n2027;2,5\n");
  assert.deepEqual(input(r, "B1"), { type: "number", value: 1.5 });
});
