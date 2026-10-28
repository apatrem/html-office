// XLSX import (T15, ADR-015). SheetJS CE parses the file in a worker that
// cannot reach the network (runtime/xlsx-reader.mjs); summarise() runs there
// and returns plain data. Everything else runs in the import chunk and maps
// that data to Data cells. What Data cannot hold is reported, never guessed:
// a formula Data cannot run is imported as the value the file saved.
import { address } from "./csv.mjs";

export const XLSX_LIMITS = {
  bytes: 64 * 1024 * 1024,
  cells: 2_000_000,
  rows: 1_048_576,
  columns: 16_384,
};
// SheetJS read options: formulas and number formats, no styles, no HTML, no
// macros (bookVBA), raw parts kept so unsupported content can be reported.
export const READ_OPTIONS = {
  type: "array",
  cellFormula: true,
  cellNF: true,
  cellStyles: false,
  cellHTML: false,
  cellText: false,
  cellDates: false,
  bookVBA: false,
  bookFiles: true,
  dense: true,
  sheetStubs: false,
  WTF: false,
};

// Runs inside the worker with the SheetJS global and the parsed workbook. It
// is serialised with Function.prototype.toString, so it uses nothing but its
// arguments and globals a worker has.
export function summarise(XLSX, wb, limits) {
  const files = wb.files || {},
    decoder = new TextDecoder(),
    text = (path) => {
      const file = files[path];
      return file && file.content ? decoder.decode(file.content) : "";
    },
    has = (pattern) => Object.keys(files).filter((p) => pattern.test(p)).length;
  // Worksheet parts by relationship ID, for features SheetJS does not parse.
  const targets = {};
  for (const [tag] of text("xl/_rels/workbook.xml.rels").matchAll(
    /<(?:\w+:)?Relationship\b[^>]*>/g,
  )) {
    const id = /\bId="([^"]*)"/.exec(tag),
      target = /\bTarget="([^"]*)"/.exec(tag);
    if (id && target)
      targets[id[1]] = target[1].startsWith("/")
        ? target[1].slice(1)
        : "xl/" + target[1];
  }
  const count = (xml, pattern) => (xml.match(pattern) || []).length;
  let total = 0;
  const sheets = wb.SheetNames.map((name, index) => {
    const sheet = wb.Sheets[name] || {},
      meta =
        (wb.Workbook && wb.Workbook.Sheets && wb.Workbook.Sheets[index]) || {},
      xml = text(targets[meta.id] || ""),
      formats = [],
      formatIndex = new Map(),
      cells = [],
      features = {
        merges: (sheet["!merges"] || []).length,
        comments: 0,
        hyperlinks: 0,
        conditional: count(xml, /<(?:\w+:)?conditionalFormatting\b/g),
        validation: count(xml, /<(?:\w+:)?dataValidation\b/g),
        tables: count(xml, /<(?:\w+:)?tablePart\b/g),
        drawings: count(xml, /<(?:\w+:)?drawing\b/g),
        protection: count(xml, /<(?:\w+:)?sheetProtection\b/g),
      };
    let height = 0,
      width = 0;
    (sheet["!data"] || []).forEach((row, r) => {
      if (!row) return;
      row.forEach((c, col) => {
        if (!c) return;
        if (c.l) features.hyperlinks++;
        if (c.c) features.comments++;
        if (c.t === "z" || (c.v === undefined && !c.f)) return;
        if (++total > limits.cells)
          throw new Error(
            `The workbook has more than ${limits.cells.toLocaleString("en-US")} cells, the import limit.`,
          );
        let z = -1;
        if (c.t === "n" && c.z && c.z !== "General") {
          if (!formatIndex.has(c.z)) {
            formatIndex.set(c.z, formats.length);
            formats.push({ code: c.z, date: !!XLSX.SSF.is_date(c.z) });
          }
          z = formatIndex.get(c.z);
        }
        cells.push([r, col, c.t, c.v, c.f, z, c.F ? 1 : 0]);
        height = Math.max(height, r + 1);
        width = Math.max(width, col + 1);
      });
    });
    return {
      name,
      type: sheet["!type"] || "sheet",
      hidden: !!meta.Hidden,
      height,
      width,
      cells,
      formats,
      features,
    };
  });
  const names = ((wb.Workbook && wb.Workbook.Names) || []).map((n) => ({
    name: String(n.Name),
    ref: String(n.Ref || ""),
    local: n.Sheet !== undefined && n.Sheet !== null,
  }));
  return {
    date1904: !!(
      wb.Workbook &&
      wb.Workbook.WBProps &&
      wb.Workbook.WBProps.date1904
    ),
    sheets,
    names,
    parts: {
      macros: has(/vbaProject\.bin$/i),
      externalLinks: has(/^xl\/externalLinks\/[^/]+\.xml$/i),
      pivots: has(/^xl\/pivotTables\/[^/]+\.xml$/i),
      charts: has(/^xl\/charts\/chart[^/]*\.xml$/i),
      images: has(/^xl\/media\//i),
      connections: has(/^xl\/(connections\.xml|queryTables\/)/i),
      embeddings: has(/^xl\/embeddings\//i),
      controls: has(/^xl\/activeX\//i),
      slicers: has(/^xl\/(slicers|timelines)\//i),
    },
  };
}

// Excel's error codes as SheetJS reports them.
const ERROR_CODES = {
  0: "#NULL!",
  7: "#DIV/0!",
  15: "#VALUE!",
  23: "#REF!",
  29: "#NAME?",
  36: "#NUM!",
  42: "#N/A",
};
const plural = (n, one, many) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

// Sheet name for an imported sheet: Data's rules (no leading or trailing
// apostrophe), unique in the workbook ignoring case, at most 31 characters.
export function uniqueName(base, taken) {
  const clean =
    base
      .replace(/[\\/*?:[\]]/g, " ")
      .replace(/^'+|'+$/g, "")
      .trim() || "Imported";
  let name = clean.slice(0, 31).trim(),
    n = 1;
  while (taken.has(name.toLowerCase())) {
    const suffix = ` (${++n})`;
    name = clean.slice(0, 31 - suffix.length).trim() + suffix;
  }
  taken.add(name.toLowerCase());
  return name;
}

// How a sheet name is written in a formula.
export function sheetPrefix(name) {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) &&
    !/^[A-Za-z]{1,3}\d+$/.test(name) &&
    !/^R\d*C\d*$/i.test(name)
    ? `${name}!`
    : `'${name.replaceAll("'", "''")}'!`;
}
// Rewrites the sheet references of a formula (SheetJS text, without "=")
// with `sheets`: lower-case original name → Data name, or null for a sheet
// that is not imported. Returns {formula} or {reason} when Data cannot run
// it: "external" (another workbook), "table" (structured reference), "3d"
// (a range across sheets) or "sheet" (a sheet not imported).
export function rewriteFormula(text, sheets) {
  let out = "",
    i = 0;
  const target = (name) => {
    if (name.includes("[")) return { reason: "external" };
    if (name.includes(":")) return { reason: "3d" };
    const to = sheets.get(name.toLowerCase());
    if (to === undefined || to === null) return { reason: "sheet" };
    return { prefix: to === name ? null : sheetPrefix(to) };
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && !(text[j] === '"' && text[j + 1] !== '"'))
        j += text[j] === '"' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === "'") {
      let j = i + 1,
        name = "";
      while (j < text.length) {
        if (text[j] === "'") {
          if (text[j + 1] !== "'") break;
          j++;
        }
        name += text[j++];
      }
      if (text[j + 1] !== "!") return { reason: "external" };
      const t = target(name);
      if (t.reason) return t;
      out += t.prefix ?? text.slice(i, j + 2);
      i = j + 2;
      continue;
    }
    if (ch === "[")
      return { reason: /^\[\d+\]/.test(text.slice(i)) ? "external" : "table" };
    const word = /^[A-Za-z_\\¡-￿][\w.¡-￿]*/.exec(text.slice(i, i + 300));
    if (word) {
      const end = i + word[0].length;
      if (text[end] === "!") {
        // Sheet1:Sheet3!A1 spans sheets.
        if (/[\w.]:$/.test(out)) return { reason: "3d" };
        const t = target(word[0]);
        if (t.reason) return t;
        out += t.prefix ?? word[0] + "!";
        i = end + 1;
      } else {
        out += word[0];
        i = end;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return { formula: out };
}

// A number format code as one of Data's presets, or null (General, text,
// or a custom code Data has no preset for).
const SYMBOLS = { "€": "EUR", $: "USD", "£": "GBP", "¥": "JPY" };
export function numberFormat(code) {
  const [first, negative = ""] = code.split(";"),
    plain = first
      .replace(/"[^"]*"/g, "")
      .replace(/\\./g, "")
      .replace(/_.|\*./g, " "),
    bare = plain.replace(/\[[^\]]*\]/g, ""),
    digits = Math.min(15, /\.([0#?]+)/.exec(bare)?.[1].length ?? 0);
  if (/^(General|@)$/i.test(code.trim())) return null;
  if (!/[0#]/.test(bare) || /[eE][+-]|\?\/|\//.test(bare)) return null;
  const format = {};
  const symbol =
    /\[\$([€$£¥])[^\]]*\]/.exec(first)?.[1] ??
    /"([€$£¥])"/.exec(first)?.[1] ??
    /[€$£¥]/.exec(bare)?.[0];
  if (bare.includes("%")) format.kind = "percent";
  else if (symbol) {
    format.kind = /\*/.test(first) ? "accounting" : "currency";
    format.currency = SYMBOLS[symbol];
  } else format.kind = "number";
  format.digits = digits;
  if (format.kind !== "percent") {
    const commas = /[0#](,+)(?![0#])/.exec(bare)?.[1].length ?? 0;
    if (commas === 1) format.scale = "thousands";
    else if (commas >= 2) format.scale = "millions";
  }
  if (negative) {
    const red = /\[red\]/i.test(negative),
      parentheses = /\(/.test(negative.replace(/"[^"]*"/g, ""));
    if (red || parentheses)
      format.negative = red
        ? parentheses
          ? "redParentheses"
          : "red"
        : "parentheses";
  }
  return format;
}
// Whether a date format shows only a time of day.
function timeOnly(code) {
  const bare = code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
  return !/[yd]/i.test(bare) && /[hs]/i.test(bare);
}

const REASONS = {
  sheet: (n) =>
    `${plural(n, "formula reads", "formulas read")} a sheet that is not imported`,
  external: (n) =>
    `${plural(n, "formula reads", "formulas read")} another workbook (external link)`,
  table: (n) =>
    `${plural(n, "formula uses", "formulas use")} Excel table references`,
  "3d": (n) => `${plural(n, "formula spans", "formulas span")} several sheets`,
  array: (n) => `${plural(n, "array formula", "array formulas")}`,
};
const PARTS = {
  macros: "Macros are not imported and never run.",
  externalLinks:
    "Links to other workbooks are not followed; formulas using them keep their saved values.",
  pivots:
    "Pivot tables are imported as their saved cells, not as pivot tables.",
  charts: "Charts are not imported.",
  images: "Pictures and shapes are not imported.",
  connections: "Data connections and queries are not imported and never run.",
  embeddings: "Embedded objects are not imported.",
  controls: "ActiveX controls are not imported and never run.",
  slicers: "Slicers and timelines are not imported.",
};
const FEATURES = {
  merges: (n) =>
    `${plural(n, "merged range is", "merged ranges are")} unmerged`,
  comments: (n) => `${plural(n, "comment is", "comments are")} not imported`,
  hyperlinks: (n) =>
    `${plural(n, "hyperlink is", "hyperlinks are")} not imported`,
  conditional: (n) =>
    `${plural(n, "conditional format is", "conditional formats are")} not imported`,
  validation: (n) =>
    `${plural(n, "data validation rule is", "data validation rules are")} not imported`,
  tables: (n) =>
    `${plural(n, "Excel table becomes", "Excel tables become")} plain cells`,
  drawings: () => "drawings are not imported",
  protection: () => "sheet protection is not imported",
};
export const importable = (sheet) =>
  sheet.type === "sheet" && sheet.cells.length > 0;

// Whether row 1 holds column names: every column with data has a text label
// there (no formula), and some later row holds a value that is not text.
function detectHeader(sheet) {
  if (sheet.height < 2) return false;
  const labels = new Map(),
    columns = new Set();
  let other = false;
  for (const [r, c, t, , f] of sheet.cells) {
    columns.add(c);
    if (r === 0) {
      if (f || !(t === "s" || t === "str")) return false;
      labels.set(c, true);
    } else if (!(t === "s" || t === "str")) other = true;
  }
  return other && [...columns].every((c) => labels.has(c));
}

// One sheet of the summary as Data cells. `sheets` maps lower-case original
// names to Data names (null: not imported); `header` is true, false or
// "auto". Returns {cells, height, width, header, columns, kept, counts}.
export function mapSheet(summary, index, { sheets, header = "auto" }) {
  const sheet = summary.sheets[index],
    hasHeader = header === "auto" ? detectHeader(sheet) : !!header,
    cells = {},
    kept = {},
    counts = { formulas: 0, values: 0, times: 0, formats: 0 },
    names = new Map();
  const typed = (t, v, z) => {
    if (t === "s" || t === "str") return { type: "text", value: String(v) };
    if (t === "b") return { type: "boolean", value: !!v };
    if (t === "e") return { type: "error", value: ERROR_CODES[v] ?? "#ERROR!" };
    if (t === "n" && Number.isFinite(v)) {
      const format = z >= 0 ? sheet.formats[z] : null;
      if (format?.date && !timeOnly(format.code))
        return {
          type: "date",
          value: v + (summary.date1904 ? 1462 : 0),
        };
      return { type: "number", value: v };
    }
    return null;
  };
  for (const [r, c, t, v, f, z, array] of sheet.cells) {
    const ref = address(r + 1, c + 1),
      value = v === undefined ? null : typed(t, v, z),
      cell = {};
    if (f) {
      const rewritten = array ? { reason: "array" } : rewriteFormula(f, sheets);
      if (rewritten.formula) {
        cell.formula = "=" + rewritten.formula;
        if (value) cell.result = value;
        counts.formulas++;
      } else {
        kept[rewritten.reason] = (kept[rewritten.reason] ?? 0) + 1;
        if (!value) continue;
        cell.input = value;
      }
    } else if (value) {
      cell.input = value;
      counts.values++;
    } else continue;
    if (t === "n" && z >= 0) {
      const format = sheet.formats[z];
      if (format.date) {
        if (timeOnly(format.code)) counts.times++;
        else cell.format = { kind: "date" };
      } else {
        const preset = numberFormat(format.code);
        if (preset) cell.format = preset;
        else counts.formats++;
      }
    }
    if (hasHeader && r === 0) {
      cell.cellStyle = "header";
      names.set(c, String(v ?? "").trim());
    }
    cells[ref] = cell;
  }
  const columns = Array.from({ length: sheet.width }, (_, c) => {
    const letter = address(1, c + 1).replace(/\d+$/, "");
    return { letter, name: (hasHeader && names.get(c)) || letter };
  });
  return {
    cells,
    height: sheet.height,
    width: sheet.width,
    header: hasHeader,
    columns,
    kept,
    counts,
  };
}

// Named ranges Data can hold: workbook-wide, one rectangle on an imported
// sheet, a valid and free name. Excel's own names (print areas, filters) are
// skipped silently.
export function mapNames(summary, { sheets, taken }) {
  const names = [],
    skipped = [];
  for (const n of summary.names) {
    if (/^_xlnm\./i.test(n.name)) continue;
    const m =
      /^(?:'((?:[^']|'')+)'|([^'!:[\]]+))!\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/.exec(
        n.ref.replace(/^=/, ""),
      );
    const sheet = m && (m[1]?.replaceAll("''", "'") ?? m[2]),
      to = sheet && sheets.get(sheet.toLowerCase());
    if (
      n.local ||
      !m ||
      !to ||
      !/^[a-zA-Z][\w-]{0,79}$/.test(n.name) ||
      taken.has(n.name.toLowerCase())
    ) {
      skipped.push(n.name);
      continue;
    }
    taken.add(n.name.toLowerCase());
    names.push({
      name: n.name,
      sheet: to,
      ref: `${m[3]}${m[4]}${m[5] ? `:${m[5]}${m[6]}` : ""}`,
    });
  }
  return { names, skipped };
}

// The import: chosen sheet indexes in file order, the workbook's sheet and
// range names. Returns the sheets to add (with their Data names), the named
// ranges and the diagnostics shown before anything changes.
export function mapWorkbook(summary, { chosen, header = "auto", book }) {
  const taken = new Set(book.sheets.map((s) => s.name.toLowerCase())),
    sheets = new Map(summary.sheets.map((s) => [s.name.toLowerCase(), null]));
  for (const index of chosen)
    sheets.set(
      summary.sheets[index].name.toLowerCase(),
      uniqueName(summary.sheets[index].name, taken),
    );
  const out = chosen.map((index) => ({
    index,
    original: summary.sheets[index].name,
    name: sheets.get(summary.sheets[index].name.toLowerCase()),
    ...mapSheet(summary, index, { sheets, header }),
  }));
  const { names, skipped } = mapNames(summary, {
    sheets,
    taken: new Set(book.names.map((n) => n.name.toLowerCase())),
  });
  return {
    sheets: out,
    names,
    diagnostics: diagnostics(summary, out, chosen, skipped),
  };
}

// `whole`: notes about the whole import (sheets left out, presentation);
// a refresh of one sheet leaves them out.
export function diagnostics(
  summary,
  mapped,
  chosen,
  skippedNames = [],
  whole = true,
) {
  const notes = [],
    kept = {};
  for (const s of mapped)
    for (const [reason, n] of Object.entries(s.kept))
      kept[reason] = (kept[reason] ?? 0) + n;
  const keptTotal = Object.values(kept).reduce((a, b) => a + b, 0);
  if (keptTotal)
    notes.push(
      `${plural(keptTotal, "formula is", "formulas are")} imported as the value saved in the file: ${Object.entries(
        kept,
      )
        .map(([reason, n]) => REASONS[reason](n))
        .join("; ")}.`,
    );
  for (const [part, text] of Object.entries(PARTS))
    if (summary.parts[part]) notes.push(text);
  for (const s of mapped) {
    const f = summary.sheets[s.index].features,
      found = Object.entries(FEATURES)
        .filter(([key]) => f[key])
        .map(([key, text]) => text(f[key]));
    if (found.length) notes.push(`"${s.original}": ${found.join("; ")}.`);
    if (s.counts.formats)
      notes.push(
        `"${s.original}": ${plural(s.counts.formats, "number has a custom format", "numbers have custom formats")} Data has no preset for; shown as General.`,
      );
    if (s.counts.times)
      notes.push(
        `"${s.original}": ${plural(s.counts.times, "time of day is", "times of day are")} kept as a fraction of a day (Data has no time-only format).`,
      );
    if (s.name !== s.original)
      notes.push(
        `"${s.original}" is imported as "${s.name}" (the workbook already has that name); formulas follow.`,
      );
  }
  if (summary.date1904)
    notes.push(
      "The file uses the 1904 date system; dates are converted to Data's 1900 system.",
    );
  if (skippedNames.length)
    notes.push(
      `${plural(skippedNames.length, "named range is", "named ranges are")} not imported (${skippedNames.slice(0, 5).join(", ")}${skippedNames.length > 5 ? "…" : ""}): Data keeps workbook-wide names of one range on an imported sheet.`,
    );
  if (!whole) return notes;
  const unchosen = summary.sheets.filter(
    (s, i) => importable(s) && !chosen.includes(i),
  ).length;
  if (unchosen)
    notes.push(`${plural(unchosen, "sheet is", "sheets are")} not imported.`);
  const other = summary.sheets.filter((s) => s.type !== "sheet").length;
  if (other)
    notes.push(
      `${plural(other, "chart or macro sheet is", "chart or macro sheets are")} not imported.`,
    );
  notes.push(
    "Fonts, colours, borders, column widths and row heights are not imported.",
  );
  return notes;
}

// After the engine recalculated the import: formulas whose result differs
// from the value the file saved (a function Data lacks, a name not
// imported…). `cells` maps sheetId → imported cells; `results` is the
// engine's [{sheetId, ref, result}].
export function differences(cells, results, sheetNames) {
  const found = [];
  const same = (a, b) => {
    if (a.type !== b.type) return false;
    if (typeof a.value === "number" && typeof b.value === "number")
      return (
        Math.abs(a.value - b.value) <=
        1e-9 * Math.max(1, Math.abs(a.value), Math.abs(b.value))
      );
    return a.value === b.value;
  };
  for (const r of results) {
    const saved = cells[r.sheetId]?.[r.ref]?.result;
    if (saved && r.result && !same(saved, r.result))
      found.push({ sheetId: r.sheetId, ref: r.ref, saved, now: r.result });
  }
  if (!found.length) return null;
  const show = (v) => (v.type === "blank" ? "(empty)" : String(v.value)),
    first = found[0];
  return `${plural(found.length, "formula gives", "formulas give")} a different result in Data than the value saved in the file, for example ${sheetPrefix(sheetNames[first.sheetId])}${first.ref}: ${show(first.saved)} in the file, ${show(first.now)} here. Check ${found.length === 1 ? "it" : "them"}.`;
}
