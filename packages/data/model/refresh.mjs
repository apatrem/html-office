// Refreshing an imported source from a replacement file (T16). Pure: the
// plan compares the source range as it is now with the newly read file,
// names what changes, what needs a decision and what a refresh would
// overwrite, and yields the cell edits of one undoable step.
import { address } from "./csv.mjs";

const fail = (message) => {
  throw new Error(message);
};
function bounds(ref) {
  const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(ref);
  if (!m) fail(`The source range ${ref} no longer exists.`);
  const column = (letters) =>
    [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  return {
    left: column(m[1]),
    top: Number(m[2]),
    right: column(m[3] ?? m[1]),
    bottom: Number(m[4] ?? m[2]),
  };
}
const same = (a, b) =>
  a?.type === b?.type &&
  (a?.value === b?.value || Object.is(a?.value, b?.value)) &&
  !(Object.is(a?.value, -0) !== Object.is(b?.value, -0));
const KEEP = ["cellStyle", "format", "style"];
// The refreshed cell: the file's typed value (or formula, from an XLSX
// file), with the presentation the
// person gave the cell (a number format they chose wins over the one typing
// inferred). A header cell keeps the header style.
function merged(old, next) {
  const cell = next.formula ? { formula: next.formula } : { input: next.input };
  for (const key of KEEP) {
    const value = old?.[key] ?? next[key];
    if (value !== undefined) cell[key] = value;
  }
  return cell;
}
function equalCell(a, b) {
  if (!a || !b) return a === b;
  if (a.formula || b.formula) {
    if (a.formula !== b.formula) return false;
  } else if (!same(a.input, b.input)) return false;
  for (const key of KEEP)
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false;
  return true;
}
// Column correspondence. With header rows on both sides, columns match by
// exact header text (in order for duplicates); otherwise by position.
// resolutions[oldIndex] settles an old column the new file lacks:
// {kind:"map", to:newIndex} (renamed), {kind:"clear"} or {kind:"keep"}.
export function matchColumns(oldNames, newNames, { header, resolutions = {} }) {
  const used = new Set(),
    columns = oldNames.map((name, i) => {
      let to = -1;
      if (header) {
        to = newNames.findIndex((n, j) => n === name && !used.has(j));
      } else if (i < newNames.length) to = i;
      if (to >= 0) used.add(to);
      return { index: i, name, to: to >= 0 ? to : null, status: "matched" };
    });
  for (const column of columns) {
    if (column.to !== null) continue;
    const r = resolutions[column.index];
    if (
      r?.kind === "map" &&
      Number.isInteger(r.to) &&
      !used.has(r.to) &&
      r.to < newNames.length
    ) {
      column.to = r.to;
      column.status = "renamed";
      used.add(r.to);
    } else if (r?.kind === "clear" || r?.kind === "keep")
      column.status = r.kind === "clear" ? "cleared" : "kept";
    // A column a previous refresh cleared has no name and stays cleared.
    else if (header && column.name === "") column.status = "cleared";
    else column.status = "missing";
  }
  const added = newNames
    .map((name, j) => ({ to: j, name }))
    .filter(({ to }) => !used.has(to));
  return { columns, added };
}
// The plan for one source. `sheet` is the source sheet's cells as they are;
// `fresh` is readCSV's result, or mapSheet's for an XLSX sheet, for the
// replacement file;
// `edited` lists the indexes of source columns whose fingerprint no longer
// matches (hand edits since the import).
export function planRefresh({
  sheet,
  source,
  fresh,
  resolutions,
  edited = [],
}) {
  if (source.ref === "#REF!")
    fail("The source range was deleted. Import the file again instead.");
  const r = bounds(source.ref),
    oldWidth = r.right - r.left + 1,
    header = source.options.header && fresh.header,
    oldNames = Array.from(
      { length: oldWidth },
      (_, i) =>
        source.columns[i]?.name ?? address(1, r.left + i).replace(/\d+$/, ""),
    ),
    { columns, added } = matchColumns(
      oldNames,
      fresh.columns.map((c) => c.name),
      { header, resolutions },
    ),
    unresolved = columns.filter((c) => c.status === "missing");
  // Layout: old columns keep their positions (formulas that read them by
  // position stay right); added columns follow on the right.
  const layout = [
    ...columns.map((c) => ({ ...c, at: c.index })),
    ...added.map((a, k) => ({
      index: null,
      name: a.name,
      to: a.to,
      status: "added",
      at: oldWidth + k,
    })),
  ];
  const width = layout.length,
    height = fresh.height,
    oldHeight = r.bottom - r.top + 1,
    bottom = r.top + Math.max(height, oldHeight) - 1,
    right = r.left + width - 1;
  const edits = [],
    perColumn = layout.map(() => ({ changed: 0, samples: [] })),
    conflicts = [];
  // Rows below or columns right of the old range that the refresh would
  // write must be empty.
  const occupied = (ref) => !!sheet.cells[ref];
  for (let row = r.top; row <= r.top + height - 1; row++)
    for (let col = r.left; col <= right; col++)
      if (
        (row > r.bottom || col > r.right) &&
        occupied(address(row, col)) &&
        conflicts.length < 20
      )
        conflicts.push(address(row, col));
  for (const column of layout) {
    const col = r.left + column.at,
      stats = perColumn[layout.indexOf(column)];
    for (let row = r.top; row <= bottom; row++) {
      const ref = address(row, col),
        old = sheet.cells[ref] ?? null,
        inside = row <= r.bottom && col <= r.right;
      let next;
      if (column.status === "kept") {
        if (row - r.top < height) continue;
        // A kept column keeps its values only beside the new rows.
        next = null;
      } else if (column.to === null || row - r.top >= height) next = null;
      else {
        const incoming = fresh.cells[address(row - r.top + 1, column.to + 1)];
        next = incoming ? merged(old, incoming) : null;
        if (!incoming && old && (old.cellStyle || old.style || old.format)) {
          // An emptied cell keeps its formatting as a style-only cell.
          const kept = {};
          for (const key of KEEP)
            if (old[key] !== undefined) kept[key] = old[key];
          next = kept;
        }
      }
      if (!inside && next === null) continue;
      if (equalCell(old, next)) continue;
      edits.push({ ref, cell: next });
      if (!equalValue(old, next)) {
        stats.changed++;
        if (stats.samples.length < 5)
          stats.samples.push({ ref, before: old, after: next });
      }
    }
  }
  const newRef = `${address(r.top, r.left)}:${address(r.top + height - 1, right)}`;
  return {
    header,
    columns: layout.map((c, i) => ({
      index: c.index,
      name: c.name,
      status: c.status,
      from: c.to === null ? null : fresh.columns[c.to].name,
      letter: address(1, r.left + c.at).replace(/\d+$/, ""),
      edited: c.index !== null && edited.includes(c.index),
      ...perColumn[i],
    })),
    unresolved,
    conflicts,
    edits,
    ref: newRef,
    rows: { before: oldHeight, after: height },
  };
}
function equalValue(a, b) {
  const va = a?.formula ? { formula: a.formula } : a?.input,
    vb = b?.formula ? { formula: b.formula } : b?.input;
  if (!va || va.type === "blank") return !vb || vb.type === "blank";
  if (va.formula || vb?.formula) return va.formula === vb?.formula;
  return same(va, vb);
}
// Formulas, pivots, charts, conditional rules and dropdowns that read the
// source sheet: what the refresh will recalculate or mark out of date.
export function dependents(book, sheetId) {
  const sheet = book.sheets.find((s) => s.id === sheetId),
    name = sheet.name.toLowerCase(),
    quoted = `'${name.replaceAll("'", "''")}'!`,
    plain = `${name}!`,
    // Only a name without spaces or punctuation may appear unquoted.
    simple = /^[a-z_][\w.]*$/i.test(name),
    formulas = new Map();
  for (const s of book.sheets)
    for (const cell of Object.values(s.cells)) {
      if (!cell.formula) continue;
      const text = cell.formula.toLowerCase();
      if (
        s.id === sheetId ||
        text.includes(quoted) ||
        (simple &&
          new RegExp(
            `(^|[^\\w.'])${plain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
          ).test(text))
      )
        formulas.set(s.name, (formulas.get(s.name) ?? 0) + 1);
    }
  return {
    formulas: [...formulas].map(([sheetName, count]) => ({ sheetName, count })),
    pivots: (book.pivots ?? []).filter((p) => p.source.sheetId === sheetId),
    charts: (book.charts ?? []).filter((c) => c.source.sheetId === sheetId),
    conditional: (book.conditionalFormats ?? []).filter(
      (rule) => rule.sheetId === sheetId,
    ).length,
    dropdowns: (book.validations ?? []).filter(
      (rule) =>
        rule.sheetId === sheetId ||
        (rule.source.kind === "range" && rule.source.sheetId === sheetId),
    ).length,
  };
}
