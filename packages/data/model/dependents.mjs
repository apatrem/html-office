// What a refresh reaches (T16): the formulas that read the refreshed range,
// the formulas that read those in turn (on any sheet, directly or through a
// named range), and the pivot tables, charts and named ranges over a changed
// cell. Formula text is scanned for references, never evaluated: INDIRECT
// counts as reading the refreshed range, OFFSET as reading the whole sheet
// of each reference it takes. The walk stops after LIMIT reader checks, so
// the dialog stays quick on a large workbook; the result then says so.
import { parseAddress, parseRange } from "./workbook.mjs";

const ROWS = 1048576,
  COLUMNS = 16384,
  WHOLE = { top: 1, left: 1, bottom: ROWS, right: COLUMNS },
  LIMIT = 5000000,
  // The reader index buckets small ranges by blocks of BH rows × BW
  // columns, tall ones by bands of BW columns, wide ones by bands of BH rows.
  BH = 16,
  BW = 8,
  BLOCKS = COLUMNS / BW,
  // A cell as one number: row × KEY + column.
  KEY = COLUMNS + 1;
const REF =
    /(?:\$?[A-Za-z]{1,3}\$?[1-9]\d{0,6}(?::\$?[A-Za-z]{1,3}\$?[1-9]\d{0,6})?|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?[1-9]\d{0,6}:\$?[1-9]\d{0,6})(?![\p{L}\p{N}_.!(])/uy,
  WORD = /[A-Za-z_\\¡-￿][\w.¡-￿]*/uy;
const meets = (a, b) =>
  a.top <= b.bottom &&
  b.top <= a.bottom &&
  a.left <= b.right &&
  b.left <= a.right;
// A1, A1:B2, A:B or 1:2 as a rectangle; null when out of the grid (XFE1 is
// a name, not a cell).
function rect(token) {
  const [a, b = a] = token.replaceAll("$", "").toUpperCase().split(":");
  if (/^\d+$/.test(a)) {
    const top = Math.min(a, b),
      bottom = Math.max(a, b);
    return bottom > ROWS ? null : { top, left: 1, bottom, right: COLUMNS };
  }
  const tall = !/\d/.test(a);
  try {
    const p = parseAddress(tall ? `${a}1` : a),
      q = parseAddress(tall ? `${b}1` : b);
    return {
      top: tall ? 1 : Math.min(p.row, q.row),
      left: Math.min(p.column, q.column),
      bottom: tall ? ROWS : Math.max(p.row, q.row),
      right: Math.max(p.column, q.column),
    };
  } catch {
    return null;
  }
}
// The references of a formula: {sheet (lower-case name, or null for its
// own sheet), rect} ranges, the lower-case names it may read, and whether
// it calls INDIRECT or OFFSET.
export function references(formula) {
  const refs = [],
    names = [];
  let i = 0,
    sheet = null,
    indirect = false,
    offset = false;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === '"') {
      let j = i + 1;
      while (
        j < formula.length &&
        !(formula[j] === '"' && formula[j + 1] !== '"')
      )
        j += formula[j] === '"' ? 2 : 1;
      i = j + 1;
      sheet = null;
      continue;
    }
    if (ch === "'") {
      let j = i + 1,
        name = "";
      while (
        j < formula.length &&
        !(formula[j] === "'" && formula[j + 1] !== "'")
      ) {
        name += formula[j];
        j += formula[j] === "'" ? 2 : 1;
      }
      i = j + 1;
      sheet = formula[i] === "!" ? name.toLowerCase() : null;
      if (sheet !== null) i++;
      continue;
    }
    if (i === 0 || !/[\p{L}\p{N}_.$\\]/u.test(formula[i - 1])) {
      REF.lastIndex = i;
      const m = REF.exec(formula),
        r = m && rect(m[0]);
      if (r) {
        refs.push({ sheet, rect: r });
        i += m[0].length;
        sheet = null;
        continue;
      }
      WORD.lastIndex = i;
      const w = WORD.exec(formula);
      if (w) {
        const end = i + w[0].length,
          word = w[0].toLowerCase();
        if (formula[end] === "!") {
          sheet = word;
          i = end + 1;
          continue;
        }
        if (/^\s*\(/.test(formula.slice(end, end + 16))) {
          if (word === "indirect") indirect = true;
          if (word === "offset") offset = true;
          // Sheet!Name would be a sheet-scoped name; Data's are workbook-wide.
        } else if (sheet === null) names.push(word);
        i = end;
        sheet = null;
        continue;
      }
    }
    i++;
    sheet = null;
  }
  return { refs, names, indirect, offset };
}
function register(readers, { sheetId, rect }, n) {
  let r = readers.get(sheetId);
  if (!r)
    readers.set(
      sheetId,
      (r = { blocks: new Map(), columns: new Map(), rows: new Map(), all: [] }),
    );
  const entry = { n, rect },
    add = (map, key) => {
      const list = map.get(key);
      if (list) list.push(entry);
      else map.set(key, [entry]);
    },
    top = Math.floor((rect.top - 1) / BH),
    bottom = Math.floor((rect.bottom - 1) / BH),
    left = Math.floor((rect.left - 1) / BW),
    right = Math.floor((rect.right - 1) / BW);
  if ((bottom - top + 1) * (right - left + 1) <= 16) {
    for (let y = top; y <= bottom; y++)
      for (let x = left; x <= right; x++) add(r.blocks, y * BLOCKS + x);
  } else if (right - left < 4)
    for (let x = left; x <= right; x++) add(r.columns, x);
  else if (bottom - top < 64)
    for (let y = top; y <= bottom; y++) add(r.rows, y);
  else r.all.push(entry);
}
// Every formula of the workbook with the ranges it reads, and an index from
// a cell to the formulas whose ranges hold it. Built once per dialog.
export function formulaGraph(book) {
  const ids = new Map(book.sheets.map((s) => [s.name.toLowerCase(), s.id])),
    named = new Map(),
    formulas = [],
    readers = new Map();
  for (const n of book.names ?? [])
    if (n.ref !== "#REF!")
      named.set(n.name.toLowerCase(), {
        sheetId: n.sheetId,
        rect: parseRange(n.ref),
      });
  for (const s of book.sheets)
    for (const [ref, cell] of Object.entries(s.cells)) {
      if (!cell.formula) continue;
      const found = references(cell.formula),
        reads = [];
      for (const { sheet, rect } of found.refs) {
        const id = sheet === null ? s.id : ids.get(sheet);
        if (id) reads.push({ sheetId: id, rect: found.offset ? WHOLE : rect });
      }
      for (const name of found.names) {
        const target = named.get(name);
        if (target)
          reads.push(
            found.offset ? { sheetId: target.sheetId, rect: WHOLE } : target,
          );
      }
      const n = formulas.length;
      formulas.push({
        sheet: s,
        ...parseAddress(ref),
        reads,
        indirect: found.indirect,
      });
      for (const read of reads) register(readers, read, n);
    }
  return { formulas, readers };
}
// What changes when `refs` (the source range before and after a refresh;
// none: the whole sheet) of the sheet change. Formulas are grouped by sheet,
// in the order the walk reaches them: `direct` of them read the refreshed
// range, the others follow formulas on the `through` sheets (or on their
// own). `partial` when the walk stopped after `limit` reader checks.
export function dependents(
  book,
  sheetId,
  refs = [],
  graph = formulaGraph(book),
  limit = LIMIT,
) {
  const rects = refs.filter((r) => r && r !== "#REF!").map(parseRange),
    region = rects.length
      ? {
          top: Math.min(...rects.map((r) => r.top)),
          left: Math.min(...rects.map((r) => r.left)),
          bottom: Math.max(...rects.map((r) => r.bottom)),
          right: Math.max(...rects.map((r) => r.right)),
        }
      : WHOLE,
    { formulas, readers } = graph,
    // Per formula: undefined while unreached, null when it reads the
    // refreshed range, else the sheet of the formula it follows.
    via = new Array(formulas.length),
    queue = [],
    live = new Map();
  let work = 0;
  formulas.forEach((f, n) => {
    work += f.reads.length;
    if (
      f.indirect ||
      (f.sheet.id === sheetId &&
        meets(region, {
          top: f.row,
          left: f.column,
          bottom: f.row,
          right: f.column,
        })) ||
      f.reads.some((r) => r.sheetId === sheetId && meets(r.rect, region))
    ) {
      via[n] = null;
      queue.push(n);
    }
  });
  let k = 0;
  for (; k < queue.length && work <= limit; k++) {
    const f = formulas[queue[k]],
      r = readers.get(f.sheet.id);
    if (!r) continue;
    const y = Math.floor((f.row - 1) / BH),
      x = Math.floor((f.column - 1) / BW);
    for (const list of [
      r.blocks.get(y * BLOCKS + x),
      r.columns.get(x),
      r.rows.get(y),
      r.all,
    ]) {
      if (!list) continue;
      // Entries of formulas already reached leave this walk's copy of the
      // list, so a range read by many of them is checked once per formula.
      const entries = live.get(list) ?? list,
        kept = [];
      work += entries.length;
      for (const entry of entries) {
        if (via[entry.n] !== undefined) continue;
        const { n, rect } = entry;
        if (
          rect.top <= f.row &&
          f.row <= rect.bottom &&
          rect.left <= f.column &&
          f.column <= rect.right
        ) {
          via[n] = f.sheet;
          queue.push(n);
        } else kept.push(entry);
      }
      if (kept.length < entries.length) live.set(list, kept);
    }
  }
  const sheets = new Map(),
    // Changed formula cells by sheet ID, as keys.
    changed = new Map();
  for (const n of queue) {
    const f = formulas[n];
    let s = sheets.get(f.sheet);
    if (!s)
      sheets.set(
        f.sheet,
        (s = { sheetName: f.sheet.name, count: 0, direct: 0, through: [] }),
      );
    s.count++;
    if (via[n] === null) s.direct++;
    else if (via[n] !== f.sheet && !s.through.includes(via[n].name))
      s.through.push(via[n].name);
    let keys = changed.get(f.sheet.id);
    if (!keys) changed.set(f.sheet.id, (keys = new Set()));
    keys.add(f.row * KEY + f.column);
  }
  // Whether a range (no ref: a pivot source over the whole sheet) holds a
  // changed cell: in the refreshed range, or a formula reached, through
  // whichever is shorter.
  const touched = ({ sheetId: id, ref }) => {
    if (ref === "#REF!") return false;
    const r = ref === undefined ? WHOLE : parseRange(ref),
      keys = changed.get(id);
    if (id === sheetId && meets(r, region)) return true;
    if (!keys) return false;
    if ((r.bottom - r.top + 1) * (r.right - r.left + 1) < keys.size) {
      for (let row = r.top; row <= r.bottom; row++)
        for (let column = r.left; column <= r.right; column++)
          if (keys.has(row * KEY + column)) return true;
      return false;
    }
    for (const key of keys) {
      const row = Math.floor(key / KEY),
        column = key % KEY;
      if (
        row >= r.top &&
        row <= r.bottom &&
        column >= r.left &&
        column <= r.right
      )
        return true;
    }
    return false;
  };
  return {
    formulas: [...sheets.values()],
    pivots: (book.pivots ?? []).filter((p) => touched(p.source)),
    charts: (book.charts ?? []).filter((c) => touched(c.source)),
    names: (book.names ?? []).filter(touched).map((n) => n.name),
    conditional: (book.conditionalFormats ?? []).filter(
      (rule) => rule.sheetId === sheetId,
    ).length,
    dropdowns: (book.validations ?? []).filter(
      (rule) =>
        rule.sheetId === sheetId ||
        (rule.source.kind === "range" && rule.source.sheetId === sheetId),
    ).length,
    partial: k < queue.length,
  };
}
