// CSV import (T15): decoding, delimiter sniffing, RFC 4180 parsing and typed
// values. Pure functions shared by the lazy import chunk and Node tests.
// Locale ambiguity is reported, never guessed: the person chooses the
// decimal separator or the date order before anything is inserted.
// A1 address of a 1-based row and column (no workbook import: this module
// is bundled into the import chunk).
export function address(row, column) {
  let name = "";
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name + row;
}

export const CSV_LIMITS = {
  bytes: 64 * 1024 * 1024,
  cells: 2_000_000,
  rows: 1_048_576,
  columns: 16_384,
};
export const ENCODINGS = [
  ["utf-8", "UTF-8"],
  ["windows-1252", "Western (Windows-1252)"],
  ["macintosh", "Western (Mac OS Roman)"],
  ["iso-8859-15", "Western (ISO-8859-15)"],
  ["utf-16le", "UTF-16 LE"],
  ["utf-16be", "UTF-16 BE"],
];
export const DELIMITERS = [
  [",", "Comma"],
  [";", "Semicolon"],
  ["\t", "Tab"],
  ["|", "Vertical bar"],
];
export const COLUMN_TYPES = ["auto", "text", "number", "date", "boolean"];

// ---- decoding ----
// A byte-order mark decides; otherwise strict UTF-8, and Windows-1252 (what
// Excel for Windows writes for "CSV") when the bytes are not UTF-8.
export function decodeCSV(bytes, encoding = "auto") {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view.length > CSV_LIMITS.bytes)
    throw new Error(
      `The file is larger than ${CSV_LIMITS.bytes / 1024 / 1024} MB, the import limit.`,
    );
  let chosen = encoding,
    fallback = false;
  if (encoding === "auto") {
    if (view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf)
      chosen = "utf-8";
    else if (view[0] === 0xff && view[1] === 0xfe) chosen = "utf-16le";
    else if (view[0] === 0xfe && view[1] === 0xff) chosen = "utf-16be";
    else {
      try {
        return {
          text: new TextDecoder("utf-8", { fatal: true }).decode(view),
          encoding: "utf-8",
          fallback: false,
        };
      } catch {
        chosen = "windows-1252";
        fallback = true;
      }
    }
  }
  if (!ENCODINGS.some(([name]) => name === chosen))
    throw new Error(`Unsupported encoding ${chosen}`);
  return {
    text: new TextDecoder(chosen).decode(view),
    encoding: chosen,
    fallback,
  };
}

// ---- parsing ----
// Excel writes "sep=;" as a first line when asked to name the delimiter.
export function separatorLine(text) {
  const match = /^sep=(.)\r?\n/.exec(text);
  return match ? { delimiter: match[1], length: match[0].length } : null;
}
// Fields per record over the first records, quote-aware.
function fieldCounts(text, delimiter, records = 50) {
  const counts = [];
  let fields = 1,
    quoted = false,
    i = 0;
  for (; i < text.length && counts.length < records; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') i++;
        else quoted = false;
      }
    } else if (c === '"') quoted = true;
    else if (c === delimiter) fields++;
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      counts.push(fields);
      fields = 1;
    }
  }
  if (i >= text.length && (fields > 1 || counts.length === 0))
    counts.push(fields);
  return counts;
}
// The delimiter whose field count is the most consistent over the first
// records, then the one giving more columns. On a tie, tab, then semicolon,
// then comma: a decimal comma inside values ("2026;1,5") splits as evenly as
// the real delimiter. One column: a comma.
export function sniffDelimiter(text) {
  let best = { delimiter: ",", score: -1, width: 1 };
  for (const delimiter of ["\t", ";", ",", "|"]) {
    const counts = fieldCounts(text, delimiter);
    if (!counts.length) continue;
    const frequency = new Map();
    for (const n of counts) frequency.set(n, (frequency.get(n) ?? 0) + 1);
    const [width, hits] = [...frequency].sort(
      (a, b) => b[1] - a[1] || b[0] - a[0],
    )[0];
    if (width < 2) continue;
    const score = hits / counts.length;
    if (
      score > best.score + 1e-9 ||
      (Math.abs(score - best.score) <= 1e-9 && width > best.width)
    )
      best = { delimiter, score, width };
  }
  return best.delimiter;
}
// RFC 4180 with Excel's leniency: a quote inside an unquoted field is a
// literal character, and text after a closing quote joins the field (both
// counted). An unclosed quote fails with its line, since it would swallow
// the rest of the file. Trailing empty lines are dropped.
export function parseCSV(
  text,
  delimiter,
  { maxCells = CSV_LIMITS.cells } = {},
) {
  if (delimiter.length !== 1 || /["\r\n]/.test(delimiter))
    throw new Error("Choose a single delimiter character other than a quote.");
  const rows = [],
    stats = { multiline: 0, strayQuotes: 0 };
  let row = [],
    value = "",
    quoted = false,
    closed = false,
    multiline = false,
    line = 1,
    quoteLine = 0,
    cells = 0,
    width = 0;
  const field = () => {
    row.push(value);
    if (multiline) stats.multiline++;
    value = "";
    closed = multiline = false;
  };
  const record = () => {
    cells += row.length;
    width = Math.max(width, row.length);
    if (cells > maxCells || width * rows.length > maxCells)
      throw new Error(
        `The file has more than ${maxCells.toLocaleString("en-US")} cells, the import limit.`,
      );
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else if (c === "\r" || c === "\n") {
        // Line breaks inside a field are stored as "\n", as Excel does.
        if (c === "\r" && text[i + 1] === "\n") i++;
        line++;
        multiline = true;
        value += "\n";
      } else value += c;
    } else if (c === delimiter) field();
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      line++;
      field();
      record();
    } else if (c === '"' && !value && !closed) {
      quoted = true;
      quoteLine = line;
    } else {
      if (c === '"' || closed) stats.strayQuotes++;
      value += c;
      closed = false;
    }
  }
  if (quoted)
    throw new Error(
      `A quoted field opened on line ${quoteLine} is never closed. Check the delimiter, or fix the file.`,
    );
  if (value || closed || row.length) {
    field();
    record();
  }
  while (rows.length && rows.at(-1).every((v) => v === "")) rows.pop();
  if (rows.length > CSV_LIMITS.rows)
    throw new Error(
      `The file has more than ${CSV_LIMITS.rows.toLocaleString("en-US")} rows, the import limit.`,
    );
  if (width > CSV_LIMITS.columns)
    throw new Error(
      `The file has more than ${CSV_LIMITS.columns.toLocaleString("en-US")} columns, the import limit.`,
    );
  if (rows.length * width > maxCells)
    throw new Error(
      `The table is larger than ${maxCells.toLocaleString("en-US")} cells, the import limit.`,
    );
  return { rows, width, stats };
}

// ---- values ----
const CURRENCIES = { $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY" };
const SPACE = /[\s  ]/g;
// Thousands may be grouped with spaces under both conventions (so "1 234"
// says nothing about the decimal separator), with commas under the decimal
// point and with points under the decimal comma; one kind per value.
const NUMBER = {
  point:
    /^(?:(\d{1,3}(?:([, \u00a0\u202f])\d{3})(?:\2\d{3})*)|(\d*))(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/,
  comma:
    /^(?:(\d{1,3}(?:([ \u00a0\u202f.])\d{3})(?:\2\d{3})*)|(\d*))(?:,(\d+))?(?:[eE]([+-]?\d+))?$/,
};
// A number under one decimal convention, or null. Thousands separators,
// one currency symbol, a sign or accounting parentheses and a trailing
// percent sign are read; leading zeros and integers over 15 digits are
// reported, so codes and identifiers stay text.
export function parseNumber(raw, decimal) {
  let s = raw.trim();
  if (!s || s.length > 64 || !/\d/.test(s)) return null;
  let negative = false,
    currency,
    percent = false;
  const paren = /^\((.+)\)$/.exec(s);
  if (paren) {
    negative = true;
    s = paren[1].trim();
  }
  const sign = /^([+\-−])\s*/.exec(s);
  if (sign) {
    if (paren) return null;
    negative = sign[1] !== "+";
    s = s.slice(sign[0].length);
  }
  const prefix = /^([$€£¥])\s?/.exec(s);
  if (prefix) {
    currency = CURRENCIES[prefix[1]];
    s = s.slice(prefix[0].length);
  }
  if (!paren && !sign && !prefix) {
    const late = /^([+\-−])\s*/.exec(s);
    if (late) return null;
  }
  const suffix = /[\s  ]?([$€£¥%])$/.exec(s);
  if (suffix) {
    if (suffix[1] === "%") percent = true;
    else if (currency) return null;
    else currency = CURRENCIES[suffix[1]];
    s = s.slice(0, -suffix[0].length);
  }
  if (currency && percent) return null;
  const m = NUMBER[decimal].exec(s);
  if (!m) return null;
  const [grouped, , plain, fraction, exponent] = m.slice(1);
  const integer = grouped ?? plain ?? "";
  if (!integer && !fraction) return null;
  const digits = integer.replace(/\D/g, "");
  // Codes and identifiers: a leading zero (grouped or not), or more integer
  // digits than a double holds exactly, whatever follows them.
  if (/^0\d/.test(digits)) return { leadingZero: true };
  if (digits.length > 15) return { tooLong: true };
  let value = Number(
    `${digits || "0"}${fraction ? "." + fraction : ""}${exponent ? "e" + exponent : ""}`,
  );
  if (!Number.isFinite(value)) return null;
  if (negative) value = -value;
  const result = {};
  if (percent) {
    result.value = Number((value / 100).toPrecision(15));
    result.format = {
      kind: "percent",
      digits: Math.min(fraction?.length ?? 0, 15),
    };
  } else result.value = value;
  if (currency)
    result.format = {
      kind: "currency",
      currency,
      digits: Math.min(fraction?.length ?? 0, 15),
    };
  if (grouped && !currency && !percent)
    result.format = {
      kind: "number",
      digits: Math.min(fraction?.length ?? 0, 15),
    };
  return result;
}
// Excel 1900 serial without Date objects (days from the civil calendar),
// with Excel's fictitious 29 February 1900 between serials 59 and 61.
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function serial(y, m, d) {
  if (y < 1900 || y > 9999 || m < 1 || m > 12 || d < 1) return null;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  if (d > MONTH_DAYS[m - 1] + (m === 2 && leap ? 1 : 0)) return null;
  const yy = m <= 2 ? y - 1 : y,
    era = Math.floor(yy / 400),
    yoe = yy - era * 400,
    doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1,
    doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy,
    days = era * 146097 + doe - 719468 + 25568; // 1899-12-31 is day 0
  return days + (days >= 60 ? 1 : 0);
}
function clock(h, min, sec, meridiem) {
  let hour = Number(h);
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (/p/i.test(meridiem) ? 12 : 0);
  }
  const minute = Number(min),
    second = Number(sec ?? 0);
  if (hour > 23 || minute > 59 || !(second < 60)) return null;
  return (hour * 3600 + minute * 60 + second) / 86400;
}
const ISO =
  /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d{1,9})?))?)?$/;
const YMD = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/;
const DAY_FIRST_OR_MONTH_FIRST =
  /^(\d{1,2})([/.\-])(\d{1,2})\2(\d{4}|\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s?([AaPp][Mm]))?)?$/;
// A date serial under one order ("dmy" or "mdy"), or null. ISO and
// year-first dates read the same under both. Two-digit years follow Excel:
// 00–29 are 2000–2029, 30–99 are 1930–1999.
export function parseDate(raw, order) {
  const s = raw.trim();
  if (s.length < 6 || s.length > 32 || !/^\d/.test(s)) return null;
  let m = ISO.exec(s);
  if (m) {
    const day = serial(+m[1], +m[2], +m[3]);
    if (day === null) return null;
    if (m[4] === undefined) return day;
    const time = clock(m[4], m[5], m[6]);
    return time === null ? null : day + time;
  }
  m = YMD.exec(s);
  if (m) return serial(+m[1], +m[2], +m[3]);
  m = DAY_FIRST_OR_MONTH_FIRST.exec(s);
  if (!m) return null;
  let year = Number(m[4]);
  if (m[4].length === 2) year += year < 30 ? 2000 : 1900;
  const [d, mo] = order === "dmy" ? [+m[1], +m[3]] : [+m[3], +m[1]],
    day = serial(year, mo, d);
  if (day === null) return null;
  if (m[5] === undefined) return day;
  const time = clock(m[5], m[6], m[7], m[8]);
  return time === null ? null : day + time;
}
const BOOLEANS = { true: true, false: false, vrai: true, faux: false };
export function parseBoolean(raw) {
  if (raw.length > 8 || !/^\s*[tfvTFV]/.test(raw)) return null;
  const value = BOOLEANS[raw.trim().toLowerCase()];
  return value === undefined ? null : value;
}

// ---- analysis ----
// Cheap rejections before the full parsers, which dominate large files: a
// value that cannot start a number, and plain integers, which read the same
// under every convention.
const NUMERIC_START = /^[\s\u00a0]*[\d+\-\u2212($€£¥.,]/,
  PLAIN_INTEGER = /^(?:0|[1-9]\d{0,14})$/;
const sameNumber = (a, b) =>
  a && b && a.value === b.value && a.value !== undefined;
// What one value says about the file's conventions.
function evidence(text, counts, examples, r, c) {
  if (!NUMERIC_START.test(text)) return;
  const s = text.trim();
  if (PLAIN_INTEGER.test(s)) return;
  const point = parseNumber(s, "point"),
    comma = parseNumber(s, "comma");
  const pv = point?.value !== undefined,
    cv = comma?.value !== undefined;
  if (pv && !cv) counts.point++;
  else if (cv && !pv) counts.comma++;
  else if (pv && cv && !sameNumber(point, comma)) {
    counts.decimalAmbiguous++;
    examples.decimal ??= { text: s, ref: address(r + 1, c + 1) };
  }
  // ISO and year-first dates read the same in both orders.
  if (!/^\d{1,2}[/.\-]/.test(s)) return;
  const dmy = parseDate(s, "dmy"),
    mdy = parseDate(s, "mdy");
  if (dmy !== null && mdy === null) counts.dmy++;
  else if (mdy !== null && dmy === null) counts.mdy++;
  else if (dmy !== null && dmy !== mdy) {
    counts.dateAmbiguous++;
    examples.dates ??= { text: s, ref: address(r + 1, c + 1) };
  }
}
// A convention resolved from the evidence, or "ask" with the reason.
function resolve(choice, a, b, ambiguous, [nameA, nameB]) {
  if (choice !== "auto") return { value: choice };
  if (a && b) return { value: "ask", conflict: true };
  if (a) return { value: nameA, detected: true };
  if (b) return { value: nameB, detected: true };
  if (ambiguous) return { value: "ask" };
  return { value: nameA };
}
const columnLetter = (c) => address(1, c + 1).replace(/\d+$/, "");
// Typed value of one field under resolved conventions and a column type.
// Returns {input, format?} or {text, reason} when the field stays text.
export function typeValue(text, type, { decimal, dates, guard }) {
  if (text === "") return null;
  // A guarded automatic column (leading zeros, long identifiers) is text.
  if (type === "text" || (type === "auto" && guard))
    return { input: { type: "text", value: text } };
  if ((type === "auto" || type === "number") && PLAIN_INTEGER.test(text))
    return { input: { type: "number", value: Number(text) } };
  const kinds = type === "auto" ? ["boolean", "date", "number"] : [type];
  for (const kind of kinds) {
    if (kind === "boolean") {
      const b = parseBoolean(text);
      if (b !== null) return { input: { type: "boolean", value: b } };
    } else if (kind === "date" && dates !== "ask") {
      const d = parseDate(text, dates);
      if (d !== null) return { input: { type: "date", value: d } };
    } else if (kind === "number" && decimal !== "ask") {
      const n = parseNumber(text, decimal);
      if (n?.value !== undefined) {
        const cell = { input: { type: "number", value: n.value } };
        if (n.format) cell.format = n.format;
        return cell;
      }
      if (type === "number" && (n?.leadingZero || n?.tooLong)) {
        const plain = Number(text.trim().replace(/^\+/, ""));
        if (Number.isFinite(plain) && /^[+-]?\d+$/.test(text.trim()))
          return { input: { type: "number", value: plain } };
      }
    }
  }
  return { input: { type: "text", value: text } };
}
// Reads parsed rows into a typed preview: header, conventions, column
// types, cells (sparse A1 map at the sheet origin) and diagnostics.
// options: {header:"auto"|true|false, decimal:"auto"|"point"|"comma",
// dates:"auto"|"dmy"|"mdy", columns:[type per column]}.
export function analyseCSV(
  { rows, width, stats = {} },
  { header = "auto", decimal = "auto", dates = "auto", columns = [] } = {},
) {
  if (!rows.length || !width) throw new Error("The file has no data.");
  const counts = {
      point: 0,
      comma: 0,
      decimalAmbiguous: 0,
      dmy: 0,
      mdy: 0,
      dateAmbiguous: 0,
    },
    examples = {},
    ragged = rows.filter((row) => row.length !== width).length;
  // A first row of distinct non-empty labels over data of another kind is a
  // header; with only text, a first row of distinct labels still is. A label
  // is something that reads as text under every convention.
  const first = rows[0],
    looksTyped = (text) =>
      ["point", "comma"].some(
        (d) =>
          typeValue(text, "auto", { decimal: d, dates: "dmy" })?.input.type !==
          "text",
      ),
    labels =
      first.length === width &&
      first.every((v) => v.trim() && !looksTyped(v)) &&
      new Set(first.map((v) => v.trim())).size === first.length,
    hasHeader = header === "auto" ? labels && rows.length > 1 : header === true;
  const body = hasHeader ? 1 : 0;
  // Leading zeros or long integers (under either convention) keep a whole
  // automatic column as text.
  const guards = Array.from({ length: width }, () => null);
  for (let r = body; r < rows.length; r++)
    for (let c = 0; c < rows[r].length; c++) {
      const text = rows[r][c];
      if (!text || guards[c] || !NUMERIC_START.test(text)) continue;
      for (const d of ["point", "comma"]) {
        const n = parseNumber(text, d);
        if (n?.leadingZero)
          guards[c] = { reason: "leadingZero", text: text.trim() };
        else if (n?.tooLong)
          guards[c] = { reason: "tooLong", text: text.trim() };
        if (guards[c]) break;
      }
    }
  // Only values that will be typed say anything about the conventions: not
  // the header, nor columns kept as text (by a guard or by the person).
  const typed = Array.from({ length: width }, (_, c) => {
    const type = COLUMN_TYPES.includes(columns[c]) ? columns[c] : "auto";
    return type === "auto" ? !guards[c] : type === "number" || type === "date";
  });
  for (let r = body; r < rows.length; r++)
    for (let c = 0; c < rows[r].length; c++)
      if (rows[r][c] && typed[c]) evidence(rows[r][c], counts, examples, r, c);
  const resolvedDecimal = resolve(
      decimal,
      counts.point,
      counts.comma,
      counts.decimalAmbiguous,
      ["point", "comma"],
    ),
    resolvedDates = resolve(
      dates,
      counts.dmy,
      counts.mdy,
      counts.dateAmbiguous,
      ["dmy", "mdy"],
    );
  const conventions = {
    decimal: resolvedDecimal.value,
    dates: resolvedDates.value,
  };
  const columnInfo = Array.from({ length: width }, (_, c) => ({
    letter: columnLetter(c),
    name: hasHeader
      ? (first[c] ?? "").trim() || columnLetter(c)
      : columnLetter(c),
    type: COLUMN_TYPES.includes(columns[c]) ? columns[c] : "auto",
    guard: guards[c],
    kinds: { number: 0, date: 0, boolean: 0, text: 0 },
    exceptions: 0,
  }));
  const cells = {},
    diagnostics = [],
    formulaLike = { count: 0, ref: null };
  let empty = 0;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const text = row[c],
        ref = columnInfo[c].letter + (r + 1);
      if (text === "") {
        empty++;
        continue;
      }
      if (r < body) {
        cells[ref] = {
          input: { type: "text", value: text },
          cellStyle: "header",
        };
        continue;
      }
      const info = columnInfo[c],
        cell = typeValue(text, info.type, {
          ...conventions,
          guard: !!info.guard,
        });
      info.kinds[cell.input.type]++;
      if (
        info.type !== "auto" &&
        info.type !== "text" &&
        cell.input.type === "text"
      )
        info.exceptions++;
      if (cell.input.type === "text" && /^[=@]|^[+\-]\D/.test(text.trim())) {
        formulaLike.count++;
        formulaLike.ref ??= ref;
      }
      cells[ref] = cell;
    }
  }
  for (const info of columnInfo) {
    const k = info.kinds,
      typed = Object.entries(k).filter(([kind, n]) => n && kind !== "text");
    info.detected =
      info.type !== "auto"
        ? info.type
        : !typed.length
          ? "text"
          : typed.sort((a, b) => b[1] - a[1])[0][0];
    if (info.type === "auto" && info.detected !== "text")
      info.exceptions = k.text;
  }
  // Diagnostics: what was decided for the person, and what Data cannot hold.
  if (stats.multiline)
    diagnostics.push(
      `${plural(stats.multiline, "field spans", "fields span")} several lines (kept as multiline text).`,
    );
  if (stats.strayQuotes)
    diagnostics.push(
      `${plural(stats.strayQuotes, "quote character", "quote characters")} outside a quoted field ${stats.strayQuotes === 1 ? "was" : "were"} kept as text.`,
    );
  if (ragged)
    diagnostics.push(
      `${plural(ragged, "row has", "rows have")} fewer fields than the widest row (${width}); missing fields are empty.`,
    );
  for (const info of columnInfo) {
    if (info.guard && info.type === "auto")
      diagnostics.push(
        info.guard.reason === "leadingZero"
          ? `Column ${info.letter} (${info.name}) is kept as text: values such as "${info.guard.text}" have leading zeros.`
          : `Column ${info.letter} (${info.name}) is kept as text: values such as "${info.guard.text}" have more than 15 digits.`,
      );
    if (info.exceptions && info.detected !== "text")
      diagnostics.push(
        `Column ${info.letter} (${info.name}): ${plural(info.exceptions, "value is", "values are")} not ${KIND_LABEL[info.detected]} and stay${info.exceptions === 1 ? "s" : ""} text.`,
      );
  }
  if (formulaLike.count)
    diagnostics.push(
      `${plural(formulaLike.count, "value starts", "values start")} like a formula (first at ${formulaLike.ref}); imported values are always literal text, never formulas.`,
    );
  const ambiguity = [];
  if (resolvedDecimal.value === "ask")
    ambiguity.push({
      kind: "decimal",
      conflict: !!resolvedDecimal.conflict,
      example: examples.decimal,
      message: resolvedDecimal.conflict
        ? "The file mixes decimal points and decimal commas. Choose the decimal separator."
        : `"${examples.decimal.text}" (${examples.decimal.ref}) could be read with a decimal point or a decimal comma. Choose the decimal separator.`,
    });
  if (resolvedDates.value === "ask")
    ambiguity.push({
      kind: "dates",
      conflict: !!resolvedDates.conflict,
      example: examples.dates,
      message: resolvedDates.conflict
        ? "The file mixes day-first and month-first dates. Choose the date order."
        : `"${examples.dates.text}" (${examples.dates.ref}) could be day/month or month/day. Choose the date order.`,
    });
  return {
    header: hasHeader,
    conventions,
    detected: {
      decimal: resolvedDecimal.detected ? resolvedDecimal.value : null,
      dates: resolvedDates.detected ? resolvedDates.value : null,
    },
    ambiguity,
    columns: columnInfo.map(({ letter, name, type, detected, exceptions }) => ({
      letter,
      name,
      type,
      detected,
      exceptions,
    })),
    height: rows.length,
    width,
    cells,
    empty,
    diagnostics,
  };
}
const KIND_LABEL = {
  number: "numbers",
  date: "dates",
  boolean: "TRUE/FALSE",
};
function plural(n, one, many) {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

// Everything from bytes: decode, find the delimiter, parse and type.
// options adds {encoding:"auto"|name, delimiter:"auto"|char} to analyseCSV's.
export function readCSV(bytes, options = {}) {
  const decoded = decodeCSV(bytes, options.encoding ?? "auto");
  let text = decoded.text;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const sep = separatorLine(text);
  if (sep) text = text.slice(sep.length);
  const delimiter =
    options.delimiter && options.delimiter !== "auto"
      ? options.delimiter
      : (sep?.delimiter ?? sniffDelimiter(text));
  const parsed = parseCSV(text, delimiter),
    analysis = analyseCSV(parsed, options),
    notes = [];
  if (decoded.fallback)
    notes.push(
      "The file is not UTF-8; it was read as Western (Windows-1252). Check accented letters in the preview, or choose another encoding.",
    );
  if (sep)
    notes.push(
      `The file's first line names its delimiter (sep=${sep.delimiter === "\t" ? "tab" : sep.delimiter}).`,
    );
  analysis.diagnostics.unshift(...notes);
  return {
    ...analysis,
    encoding: decoded.encoding,
    delimiter,
  };
}
