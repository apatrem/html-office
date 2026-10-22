import {
  parseAddress,
  parseRange,
  address,
  validateCell,
} from "./workbook.mjs";
const LIMIT = 2000000;
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
