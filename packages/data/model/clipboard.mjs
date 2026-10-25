import {
  parseAddress,
  parseRange,
  address,
  validateCell,
  validateFormat,
} from "./workbook.mjs";
import { effectiveStyle, BUILTIN_CELL_STYLES } from "./formatting.mjs";
import { COLUMN_WIDTH } from "./navigation.mjs";
export const LIMIT = 2000000;
const qualifier = "(?:(?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?";
const token = new RegExp(
  `^(${qualifier})(\\$?[A-Za-z]{1,3}\\$?[1-9]\\d{0,6}|\\$?[A-Za-z]{1,3}:\\$?[A-Za-z]{1,3}|\\$?[1-9]\\d{0,6}:\\$?[1-9]\\d{0,6})(?![\\p{L}\\p{N}_.!(])`,
  "u",
);
function shiftPart(part, rows, cols) {
  const cell = /^(\$?)([A-Za-z]+)(\$?)(\d+)$/.exec(part);
  if (cell) {
    const p = parseAddress(cell[2].toUpperCase() + cell[4]);
    const ref = address(
      p.row + (cell[3] ? 0 : rows),
      p.column + (cell[1] ? 0 : cols),
    );
    const split = /^([A-Z]+)(\d+)$/.exec(ref);
    return cell[1] + split[1] + cell[3] + split[2];
  }
  if (/^\$?\d+$/.test(part)) {
    const n = Number(part.replace("$", "")) + (part.startsWith("$") ? 0 : rows);
    address(n, 1);
    return (part.startsWith("$") ? "$" : "") + n;
  }
  const fixed = part.startsWith("$"),
    p = parseAddress(part.replace("$", "").toUpperCase() + "1");
  return (
    (fixed ? "$" : "") +
    address(1, p.column + (fixed ? 0 : cols)).replace(/\d+$/, "")
  );
}
// Reference relocation only. IronCalc remains the sole formula evaluator.
export function translateFormula(formula, rows, cols) {
  let out = "",
    i = 0;
  while (i < formula.length) {
    if (formula[i] === '"') {
      const start = i++;
      while (i < formula.length) {
        if (formula[i++] === '"') {
          if (formula[i] === '"') i++;
          else break;
        }
      }
      out += formula.slice(start, i);
      continue;
    }
    const match =
      (i === 0 || !/[\p{L}\p{N}_.]/u.test(formula[i - 1])) &&
      token.exec(formula.slice(i));
    if (match) {
      // A1-shaped tokens beyond cell bounds can be defined names (e.g. XFE1).
      try {
        for (const part of match[2].split(":")) {
          const original = part.replaceAll("$", "").toUpperCase();
          if (/^[A-Z]+[0-9]+$/.test(original)) parseAddress(original);
          else if (/^[0-9]+$/.test(original)) address(Number(original), 1);
          else parseAddress(original + "1");
        }
      } catch {
        out += match[0];
        i += match[0].length;
        continue;
      }
      try {
        out +=
          match[1] +
          match[2]
            .split(":")
            .map((p) => shiftPart(p, rows, cols))
            .join(":");
      } catch {
        out += match[1] + "#REF!";
      }
      i += match[0].length;
    } else out += formula[i++];
  }
  return out;
}
export function parseDelimited(text, delimiter = "\t") {
  const rows = [],
    row = [];
  let value = "",
    quoted = false,
    closed = false;
  function field() {
    row.push(value);
    value = "";
    closed = false;
  }
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
      } else value += c;
    } else if (c === delimiter) field();
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      field();
      rows.push(row.splice(0));
    } else if (c === '"' && !value && !closed) quoted = true;
    else {
      if (closed) throw new Error("Unexpected content after a closing quote");
      value += c;
    }
  }
  if (quoted) throw new Error("Unclosed quoted field");
  if (value || closed || row.length || !rows.length) {
    field();
    rows.push(row);
  }
  return rows;
}
function markdown(text) {
  const lines = text.trim().split(/\r?\n/),
    rows = lines.map((line) => {
      const items = [];
      let value = "",
        escaped = false;
      line = line.trim();
      for (const c of line) {
        if (escaped) {
          const n = c.charCodeAt(0),
            punctuation =
              (n >= 33 && n <= 47) ||
              (n >= 58 && n <= 64) ||
              (n >= 91 && n <= 96) ||
              (n >= 123 && n <= 126);
          value += (punctuation ? "" : "\\") + c;
          escaped = false;
        } else if (c === "\\") escaped = true;
        else if (c === "|") {
          items.push(value.trim());
          value = "";
        } else value += c;
      }
      if (escaped) value += "\\";
      items.push(value.trim());
      if (line.startsWith("|")) items.shift();
      if (line.endsWith("|") && items.at(-1) === "") items.pop();
      return items;
    });
  if (rows.length < 2 || !rows[1].every((c) => /^:?-+:?$/.test(c)))
    throw new Error("Markdown needs a header and separator row");
  rows.splice(1, 1);
  return rows;
}
function typed(text, typing) {
  if (typing === "text") return { type: "text", value: text };
  if (text === "") return { type: "blank" };
  if (/^(TRUE|FALSE)$/i.test(text))
    return { type: "boolean", value: text.toUpperCase() === "TRUE" };
  const date = /^(\d{1,4})[-/](\d{1,2})[-/](\d{1,4})$/.exec(text);
  const ambiguousNumber =
    /^[+-]?[\d .,\u00a0\u202f]+$/.test(text) && /[, \u00a0\u202f]/.test(text);
  if ((date || ambiguousNumber) && typing === "auto")
    throw new Error(
      `Ambiguous value ${JSON.stringify(text)}. Choose text, US or European typing before applying.`,
    );
  if (date) {
    let y, m, d;
    if (date[1].length === 4) [y, m, d] = date.slice(1).map(Number);
    else {
      y = Number(date[3]);
      [m, d] =
        typing === "fr-FR"
          ? [Number(date[2]), Number(date[1])]
          : [Number(date[1]), Number(date[2])];
    }
    const value = new Date(Date.UTC(2000, m - 1, d));
    value.setUTCFullYear(y);
    if (y < 1900 || m !== value.getUTCMonth() + 1 || d !== value.getUTCDate())
      throw new Error(`Invalid date: ${text}`);
    return {
      type: "date",
      value:
        (value - Date.UTC(1899, 11, 31)) / 86400000 +
        (value >= Date.UTC(1900, 2, 1) ? 1 : 0),
    };
  }
  if (/^[+-]?0\d/.test(text)) return { type: "text", value: text };
  let normal = text;
  if (ambiguousNumber) {
    const pattern =
      typing === "fr-FR"
        ? /^[+-]?(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:,\d+)?$/
        : /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
    if (!pattern.test(text))
      throw new Error(`Invalid ${typing} number: ${text}`);
    normal =
      typing === "fr-FR"
        ? text.replace(/[ \u00a0\u202f]/g, "").replace(",", ".")
        : text.replaceAll(",", "");
  }
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(normal)) {
    const n = Number(normal);
    if (Number.isFinite(n) && (!Number.isInteger(n) || Number.isSafeInteger(n)))
      return { type: "number", value: n };
  }
  return { type: "text", value: text };
}
function rectangular(rows) {
  if (
    !rows.length ||
    !rows[0].length ||
    rows.some((r) => r.length !== rows[0].length)
  )
    throw new Error("Expected a rectangular table");
  if (rows.length * rows[0].length > LIMIT)
    throw new Error(`Range exceeds ${LIMIT} clipboard cells`);
}
export function parsePaste(text, { syntax = "auto", typing = "auto" } = {}) {
  if (typeof text !== "string") throw new Error("Clipboard needs plain text");
  if (
    !["auto", "tsv", "csv", "markdown"].includes(syntax) ||
    !["auto", "text", "en-US", "fr-FR"].includes(typing)
  )
    throw new Error("Unsupported paste format");
  if (syntax === "auto") {
    const second = text.trim().split(/\r?\n/)[1] ?? "";
    const separator =
      second.includes("|") &&
      second
        .split("|")
        .filter((c) => c.trim())
        .every((c) => /^:?-+:?$/.test(c.trim()));
    syntax = /^\s*\|/.test(text) || separator ? "markdown" : "tsv";
  }
  const rows =
    syntax === "markdown"
      ? markdown(text)
      : parseDelimited(text, syntax === "csv" ? "," : "\t");
  rectangular(rows);
  return rows.map((row) =>
    row.map((value) => ({ input: typed(value, typing) })),
  );
}
export function copyRange(sheet, ref) {
  const r = parseRange(ref),
    cells = [];
  if ((r.bottom - r.top + 1) * (r.right - r.left + 1) > LIMIT)
    throw new Error(`Range exceeds ${LIMIT} clipboard cells`);
  let links = null;
  for (let row = r.top; row <= r.bottom; row++) {
    const line = [];
    for (let col = r.left; col <= r.right; col++) {
      const ref = address(row, col);
      line.push(structuredClone(sheet.cells[ref] ?? null));
      // Sheet-level links travel with their cells (as in Excel).
      const link = sheet.links?.[ref];
      if (link) {
        links ??= {};
        links[`${row - r.top},${col - r.left}`] = structuredClone(link);
      }
    }
    cells.push(line);
  }
  return {
    schema: "html-office-range/1",
    origin: { row: r.top, column: r.left },
    cells,
    ...(links ? { links } : {}),
  };
}
export function rangePatches(sheetId, start, cells, { origin } = {}) {
  rectangular(cells);
  const p = parseAddress(start);
  address(p.row + cells.length - 1, p.column + cells[0].length - 1);
  if (origin) address(origin.row, origin.column);
  const patches = [];
  cells.forEach((row, r) =>
    row.forEach((value, c) => {
      const cell = structuredClone(value);
      if (cell !== null) {
        validateCell(cell);
        if (cell.formula && origin) {
          cell.formula = translateFormula(
            cell.formula,
            p.row - origin.row,
            p.column - origin.column,
          );
          delete cell.result;
        }
      }
      patches.push({ sheetId, ref: address(p.row + r, p.column + c), cell });
    }),
  );
  return patches;
}
export function fillRange(sheet, ref, direction) {
  if (!["down", "right"].includes(direction))
    throw new Error("Unsupported fill direction");
  const r = parseRange(ref),
    copied = copyRange(
      sheet,
      direction === "down"
        ? `${address(r.top, r.left)}:${address(r.top, r.right)}`
        : `${address(r.top, r.left)}:${address(r.bottom, r.left)}`,
    ),
    patches = [];
  const rows = r.bottom - r.top + 1,
    cols = r.right - r.left + 1;
  if (rows * cols > LIMIT)
    throw new Error(`Range exceeds ${LIMIT} clipboard cells`);
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const cell = structuredClone(
        copied.cells[direction === "down" ? 0 : row][
          direction === "down" ? col : 0
        ],
      );
      if (cell?.formula) {
        cell.formula = translateFormula(
          cell.formula,
          direction === "down" ? row : 0,
          direction === "right" ? col : 0,
        );
        delete cell.result;
      }
      patches.push({
        sheetId: sheet.id,
        ref: address(r.top + row, r.left + col),
        cell,
      });
    }
  return patches;
}

// ---- Portable tables (ADR-013 §3) ----
const fail = (message) => {
  throw new Error(message);
};
const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
// A range from the clipboard is untrusted: its shape is checked whole before
// any cell is (rangePatches validates each cell, pastedLinks each link).
export function validateRange(range) {
  if (!record(range)) fail("Invalid range clipboard data");
  for (const key of Object.keys(range))
    if (!["schema", "origin", "cells", "links"].includes(key))
      fail(`Unknown range field ${key}`);
  if (range.schema !== "html-office-range/1")
    fail("Unsupported range clipboard format");
  const { origin, cells, links } = range;
  if (
    !record(origin) ||
    Object.keys(origin).length !== 2 ||
    !Number.isInteger(origin.row) ||
    !Number.isInteger(origin.column)
  )
    fail("Invalid range origin");
  address(origin.row, origin.column);
  if (!Array.isArray(cells) || !cells.every(Array.isArray))
    fail("Invalid range cells");
  rectangular(cells);
  if (!cells.every((row) => row.every((cell) => cell === null || record(cell))))
    fail("Invalid range cells");
  if (links !== undefined) {
    if (!record(links)) fail("Invalid range links");
    for (const key of Object.keys(links)) {
      const m = /^(0|[1-9]\d*),(0|[1-9]\d*)$/.exec(key);
      if (!m || +m[1] >= cells.length || +m[2] >= cells[0].length)
        fail("Invalid range link position");
    }
  }
  return range;
}

// Full-precision values for text/plain: "." decimals, TRUE/FALSE, error
// codes, and ISO dates (ADR-013 §3).
export function isoDate(serial) {
  const day = Math.floor(serial);
  if (day < 1 || day > 2958465) return String(serial);
  if (day === 60) return "1900-02-29";
  const date = new Date(
      Date.UTC(1899, 11, 31) +
        (day > 60 ? day - 1 : day) * 86400000 +
        Math.round((serial - day) * 86400000),
    ),
    text = date.toISOString();
  return serial === day ? text.slice(0, 10) : text.slice(0, 19);
}
export function plainValue(cell) {
  const v = cell?.formula ? cell.result : cell?.input;
  if (!v || v.type === "blank") return "";
  if (v.type === "boolean") return v.value ? "TRUE" : "FALSE";
  if (
    v.type === "date" ||
    (v.type === "number" && cell.format?.kind === "date")
  )
    return isoDate(v.value);
  return String(v.value);
}

const columnName = (col) => address(1, col).replace(/\d+$/, "");
const generalAlign = (input) =>
  !input || input.type === "text" || input.type === "blank"
    ? "left"
    : input.type === "boolean" || input.type === "error"
      ? "center"
      : "right";
// A Data range as a portable table: displayed text, typed value and format,
// header and total rows, token appearance, URL links and widths. `text` is
// the grid's display(cell, locale); `red` tells the red negative presets.
export function rangeTable(sheet, ref, { text, red }) {
  const r = parseRange(ref),
    rows = [];
  let widths = [];
  for (let col = r.left; col <= r.right; col++)
    widths.push(sheet.columns?.[columnName(col)]?.width ?? COLUMN_WIDTH);
  for (let row = r.top; row <= r.bottom; row++) {
    const line = [];
    for (let col = r.left; col <= r.right; col++) {
      const at = address(row, col),
        cell = sheet.cells[at],
        style = effectiveStyle(
          cell?.cellStyle,
          sheet.columns?.[columnName(col)]?.style,
          sheet.rows?.[row]?.style,
          cell?.style,
        ),
        link = sheet.links?.[at],
        v = cell?.formula ? cell.result : cell?.input,
        slot = { text: cell ? text(cell) : "" };
      if (v && v.type !== "blank")
        slot.value = { type: v.type, value: v.value };
      if (cell?.format) slot.format = structuredClone(cell.format);
      if (cell?.cellStyle && cell.cellStyle !== "normal")
        slot.cellStyle = cell.cellStyle;
      for (const key of ["bold", "italic"])
        if (style?.[key] !== undefined) slot[key] = style[key];
      const color = style?.color ?? (cell && red(cell) ? "alert" : undefined);
      if (color) slot.color = color;
      if (style?.fill && style.fill !== "none") slot.fill = style.fill;
      const h = style?.align?.horizontal;
      if (["left", "center", "right"].includes(h)) slot.align = h;
      else if (h === "centerContinuous") slot.align = "center";
      else if (generalAlign(v) === "right") slot.align = "right";
      if (link?.url) slot.link = { url: link.url };
      const empty =
        slot.text === "" &&
        Object.keys(slot).length === 1 &&
        h !== "centerContinuous";
      line.push(empty ? null : { slot, continuous: h === "centerContinuous" });
    }
    // Centre across selection: a run of empty centerContinuous cells after
    // a centred value becomes a colspan.
    for (let c = 0; c < line.length; c++) {
      const anchor = line[c];
      if (!anchor?.continuous || anchor.slot.text === "") continue;
      let end = c + 1;
      // HTML's colspan limit; the rest of a longer run stays empty.
      while (
        end < line.length &&
        end - c < 1000 &&
        line[end]?.continuous &&
        line[end].slot.text === ""
      )
        end++;
      if (end - c > 1) {
        anchor.slot.colspan = end - c;
        for (let j = c + 1; j < end; j++) line[j] = { covered: true };
        c = end - 1;
      }
    }
    rows.push(
      line.map((item) =>
        item?.covered ? { covered: true } : (item?.slot ?? null),
      ),
    );
  }
  const only = (row, style) =>
    row.some((slot) => slot?.cellStyle === style) &&
    row.every((slot) => !slot || slot.covered || slot.cellStyle === style);
  let headerRows = 0;
  while (headerRows < rows.length && only(rows[headerRows], "header"))
    headerRows++;
  const total = widths.reduce((a, b) => a + b, 0),
    table = {
      rows,
      columns: widths.map((w) => ({ width: +((w / total) * 100).toFixed(2) })),
    };
  if (headerRows) {
    table.headerRows = headerRows;
    for (const row of rows.slice(0, headerRows))
      for (const slot of row) if (slot && !slot.covered) slot.header = true;
  }
  const totals = rows.flatMap((row, i) =>
    i >= headerRows && only(row, "total") ? [i] : [],
  );
  if (totals.length) table.totalRows = totals;
  return table;
}

// Values-first typing of a pasted table's text (Data's paste dialog rules):
// ISO dates are unambiguous, and a trailing % gives a percent.
function typeText(text, typing) {
  if (typing !== "text" && /^\d{4}-\d{2}-\d{2}$/.test(text))
    return { input: typed(text, "en-US") };
  const percent = typing === "text" ? null : /^(.*\d)\s?%$/.exec(text);
  if (percent) {
    // An ambiguous number before the % asks, like any other cell.
    const inner = typed(percent[1], typing);
    if (inner.type === "number") {
      const separator = typing === "fr-FR" ? "," : ".",
        digits = percent[1].split(separator)[1]?.replace(/\D/g, "").length ?? 0;
      return {
        input: {
          type: "number",
          value: Number((inner.value / 100).toPrecision(15)),
        },
        format: { kind: "percent", digits: Math.min(digits, 15) },
      };
    }
  }
  return { input: typed(text, typing) };
}
const BOLD = ["title", "header", "output", "total", "alert"],
  ITALIC = ["note"];
// A portable table as Data cells at its own origin. Untyped text follows
// the paste dialog; with typing "auto" an ambiguous cell is reported, not
// guessed. Merges and rich text Data cannot hold are counted.
export function tableCells(table, { typing = "auto" } = {}) {
  const rows = table.rows,
    height = rows.length,
    width = rows[0].length;
  if (height * width > LIMIT)
    throw new Error(`Range exceeds ${LIMIT} clipboard cells`);
  const header = (r) => r < (table.headerRows ?? 0),
    totals = new Set(table.totalRows ?? []),
    counts = { merged: 0, flattened: 0, links: 0 },
    links = {},
    // Covered slots take their anchor's look; a header row's horizontal
    // merge becomes centre across selection (Excel's equivalent).
    covers = new Map();
  let ambiguous = null;
  rows.forEach((row, r) =>
    row.forEach((slot, c) => {
      if (!slot || slot.covered || !(slot.colspan > 1 || slot.rowspan > 1))
        return;
      counts.merged++;
      const across =
        (header(r) || slot.header) && !(slot.rowspan > 1) && slot.colspan > 1;
      for (let i = r; i < r + (slot.rowspan ?? 1); i++)
        for (let j = c; j < c + (slot.colspan ?? 1); j++)
          covers.set(`${i},${j}`, { slot, across, anchor: i === r && j === c });
    }),
  );
  const cells = rows.map((row, r) =>
    row.map((slot, c) => {
      const cover = covers.get(`${r},${c}`),
        source = slot?.covered ? cover?.slot : slot,
        isHeader = header(r) || !!source?.header,
        cellStyle =
          source?.cellStyle && BUILTIN_CELL_STYLES.includes(source.cellStyle)
            ? source.cellStyle
            : isHeader
              ? "header"
              : totals.has(r)
                ? "total"
                : undefined,
        cell = { input: { type: "blank" } };
      if (cellStyle && cellStyle !== "normal") cell.cellStyle = cellStyle;
      if (!source) return cell;
      const style = {};
      if (source.fill && source.fill !== "none") style.fill = source.fill;
      if (cover?.across) style.align = { horizontal: "centerContinuous" };
      // A supplied format is checked even where it is not used.
      if (source.format) validateFormat(source.format);
      if (slot?.covered) {
        if (Object.keys(style).length) cell.style = style;
        return cell;
      }
      if (slot.value) {
        cell.input = { type: slot.value.type, value: slot.value.value };
        if (slot.format) cell.format = structuredClone(slot.format);
      } else {
        let result;
        try {
          result = typeText(slot.text, typing);
        } catch (error) {
          if (typing !== "auto") throw error;
          ambiguous ??= error.message;
          result = { input: { type: "text", value: slot.text } };
        }
        cell.input = result.input;
        if (result.format) cell.format = result.format;
      }
      let { bold, italic } = slot,
        link = slot.link?.url;
      if (slot.runs) {
        counts.flattened++;
        const visible = slot.runs.filter((run) => run.text.trim());
        bold = visible.every((run) => run.bold) || undefined;
        italic = visible.every((run) => run.italic) || undefined;
        const urls = new Set(slot.runs.map((run) => run.link?.url));
        if (urls.size === 1 && !urls.has(undefined)) link = [...urls][0];
        else counts.links += [...urls].filter(Boolean).length;
      }
      if (bold !== undefined && bold !== BOLD.includes(cellStyle))
        style.bold = bold;
      if (italic !== undefined && italic !== ITALIC.includes(cellStyle))
        style.italic = italic;
      if (slot.color) style.color = slot.color;
      const align = slot.align ?? table.columns?.[c]?.align;
      if (align && !cover?.across && align !== generalAlign(cell.input))
        style.align = { horizontal: align };
      if (Object.keys(style).length) cell.style = style;
      if (link) links[`${r},${c}`] = { url: link };
      return cell;
    }),
  );
  return { cells, links, counts, ambiguous };
}
