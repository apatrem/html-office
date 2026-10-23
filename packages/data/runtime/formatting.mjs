// Formatting commands (F03): emphasis, colours, borders, alignment, wrap,
// column widths with command-time row heights, the style painter and links.
// Engine-free; each command is one history entry through `publish`.
import { address, parseAddress, parseRange } from "../model/workbook.mjs";
import {
  MAX_FORMAT_CELLS,
  applyStylePatch,
  borderPatch,
  inheritedStyle,
  settle,
  PRESENTATION_FIELDS,
} from "../model/formatting.mjs";
import {
  ROWS,
  COLUMNS,
  ROW_HEIGHT,
  COLUMN_WIDTH,
} from "../model/navigation.mjs";
import { display } from "./view.mjs";

const columnName = (col) => address(1, col).replace(/\d+$/, "");
const MAX_ROW_HEIGHT = 600,
  MIN_COLUMN_WIDTH = 8,
  MAX_COLUMN_WIDTH = 2000,
  // A width command over more columns than this applies to the active column.
  MAX_WIDTH_COLUMNS = 1000;

export function setupFormatting({
  getBook,
  getSheet,
  grid,
  busy,
  status,
  publish,
  locate,
}) {
  const probe = document.createElement("div");
  probe.className = "measure-probe";
  probe.setAttribute("aria-hidden", "true");
  document.getElementById("grid").append(probe);

  // Whole rows or whole columns write row/column styles (ADR-010 storage).
  function scope() {
    const r = grid.selection,
      columns = r.top === 1 && r.bottom === ROWS,
      rows = !columns && r.left === 1 && r.right === COLUMNS;
    return { ...r, kind: columns ? "columns" : rows ? "rows" : "cells" };
  }
  const inside = (r, ref) => {
    const p = parseAddress(ref);
    return (
      p.row >= r.top &&
      p.row <= r.bottom &&
      p.column >= r.left &&
      p.column <= r.right
    );
  };
  // Cells a command writes: the rectangle, or only populated cells of whole
  // rows or columns. Refused above MAX_FORMAT_CELLS individual cells.
  function targetRefs(r = scope()) {
    if (r.kind !== "cells")
      return Object.keys(getSheet().cells).filter((ref) => inside(r, ref));
    const count = (r.bottom - r.top + 1) * (r.right - r.left + 1);
    if (count > MAX_FORMAT_CELLS)
      throw new Error(
        `the selection has ${count.toLocaleString("en-US")} cells; select whole rows or columns to format more than ${MAX_FORMAT_CELLS.toLocaleString("en-US")}`,
      );
    const refs = [];
    for (let row = r.top; row <= r.bottom; row++)
      for (let col = r.left; col <= r.right; col++)
        refs.push(address(row, col));
    return refs;
  }
  const layers = (sheet, row, col) => [
    sheet.columns?.[columnName(col)]?.style,
    sheet.rows?.[row]?.style,
  ];
  // What the active cell shows: toolbar states and toggles start from it.
  function current() {
    const sheet = getSheet(),
      ref = grid.selection.focus,
      p = parseAddress(ref),
      cell = sheet.cells[ref] ?? {},
      inherited = inheritedStyle(
        cell.cellStyle,
        ...layers(sheet, p.row, p.column),
      );
    return {
      ...inherited,
      ...cell.style,
      align: { ...inherited.align, ...cell.style?.align },
    };
  }
  // Applies `patchFor(at)` (a style patch for a position in the selection).
  function style(patchFor, { label = "Formatting", wrap = false } = {}) {
    if (busy()) return;
    try {
      const r = scope(),
        sheet = getSheet(),
        refs = targetRefs(r),
        // Where a cell sits in the selection: whole rows have no left/right
        // edge and whole columns no top/bottom one (they are inner sides).
        at = (row, col) => ({
          top: r.kind !== "columns" && row === r.top,
          bottom: r.kind !== "columns" && row === r.bottom,
          left: r.kind !== "rows" && col === r.left,
          right: r.kind !== "rows" && col === r.right,
        });
      let axis;
      if (r.kind !== "cells") {
        const key = r.kind,
          entries = { ...sheet[key] };
        const [from, to] =
          key === "rows" ? [r.top, r.bottom] : [r.left, r.right];
        if (to - from + 1 > MAX_FORMAT_CELLS)
          throw new Error("select fewer rows or columns");
        for (let i = from; i <= to; i++) {
          const name = key === "rows" ? String(i) : columnName(i),
            position = key === "rows" ? at(i, 0) : at(0, i),
            next = applyStylePatch(
              entries[name]?.style,
              settle(patchFor(position, {}), inheritedStyle()),
            ),
            entry = { ...entries[name], style: next };
          if (!next) delete entry.style;
          if (Object.keys(entry).length) entries[name] = entry;
          else delete entries[name];
        }
        axis = { [key]: Object.keys(entries).length ? entries : undefined };
      }
      const view = { ...sheet, ...axis };
      const transform = (cell, ref) => {
        const p = parseAddress(ref),
          inherited = inheritedStyle(
            cell.cellStyle,
            ...layers(view, p.row, p.column),
          ),
          position = at(p.row, p.column),
          next = applyStylePatch(
            cell.style,
            settle(patchFor(position, inherited), inherited),
          ),
          { style: _, ...rest } = cell;
        return next ? { ...rest, style: next } : rest;
      };
      publish({
        refs,
        transform,
        label,
        sheetPatch:
          axis || wrap
            ? (s) => {
                const fields = { ...axis };
                if (wrap) {
                  const preview = { ...s, ...axis, cells: { ...s.cells } };
                  for (const ref of refs)
                    preview.cells[ref] = transform(s.cells[ref] ?? {}, ref);
                  fields.rows = rowHeights(
                    preview,
                    new Set(refs.map((ref) => parseAddress(ref).row)),
                  );
                }
                return fields;
              }
            : undefined,
      });
    } catch (error) {
      status(`${label} not applied: ${error.message}`);
    }
  }
  // ---- command-time row heights (ADR-012 §7) ----
  function measure(cell, width, effective) {
    probe.textContent = display(cell, getBook().locale);
    probe.style.width = `${Math.max(1, width - 12)}px`;
    probe.style.fontWeight = effective.bold ? "bold" : "normal";
    probe.style.fontStyle = effective.italic ? "italic" : "normal";
    probe.style.whiteSpace = "pre-wrap";
    return probe.scrollHeight;
  }
  function textWidth(cell, effective) {
    probe.textContent = display(cell, getBook().locale);
    probe.style.width = "auto";
    probe.style.whiteSpace = "pre";
    probe.style.fontWeight = effective.bold ? "bold" : "normal";
    probe.style.fontStyle = effective.italic ? "italic" : "normal";
    return Math.ceil(probe.scrollWidth);
  }
  const effectiveOf = (sheet, ref, cell) => {
    const p = parseAddress(ref),
      inherited = inheritedStyle(
        cell.cellStyle,
        ...layers(sheet, p.row, p.column),
      ),
      own = cell.style ?? {};
    return {
      ...inherited,
      ...own,
      align: { ...inherited.align, ...own.align },
    };
  };
  // Rows grow to fit wrapped cells, or return to the standard height.
  function rowHeights(sheet, rows) {
    const widths = (col) =>
      sheet.columns?.[columnName(col)]?.width ?? COLUMN_WIDTH;
    const needed = new Map([...rows].map((row) => [row, ROW_HEIGHT]));
    for (const [ref, cell] of Object.entries(sheet.cells)) {
      const p = parseAddress(ref);
      if (!needed.has(p.row)) continue;
      const effective = effectiveOf(sheet, ref, cell);
      if (!effective.align?.wrap) continue;
      needed.set(
        p.row,
        Math.max(
          needed.get(p.row),
          Math.min(
            MAX_ROW_HEIGHT,
            measure(cell, widths(p.column), effective) + 1,
          ),
        ),
      );
    }
    const entries = { ...sheet.rows };
    for (const [row, height] of needed) {
      const entry = { ...entries[row] };
      if (height > ROW_HEIGHT) entry.height = height;
      else delete entry.height;
      if (Object.keys(entry).length) entries[row] = entry;
      else delete entries[row];
    }
    return Object.keys(entries).length ? entries : undefined;
  }
  // Value edits re-measure rows holding wrapped cells (ADR-012 §7): the rows,
  // per sheet, where an edited cell wraps before or after the edit.
  function wrappedRows(book, edits) {
    const rows = new Map();
    for (const edit of edits) {
      const sheet = book.sheets.find((s) => s.id === edit.sheetId),
        wraps = (cell) =>
          !!cell && !!effectiveOf(sheet, edit.ref, cell).align?.wrap;
      if (!sheet || !(wraps(edit.cell) || wraps(sheet.cells[edit.ref])))
        continue;
      if (!rows.has(sheet.id)) rows.set(sheet.id, new Set());
      rows.get(sheet.id).add(parseAddress(edit.ref).row);
    }
    return rows;
  }
  const withRowHeights = (book, rows) => ({
    ...book,
    sheets: book.sheets.map((sheet) => {
      if (!rows.has(sheet.id)) return sheet;
      const next = { ...sheet, rows: rowHeights(sheet, rows.get(sheet.id)) };
      if (!next.rows) delete next.rows;
      return next;
    }),
  });
  // ---- column widths ----
  function selectedColumns() {
    const r = grid.selection;
    if (r.right - r.left + 1 > MAX_WIDTH_COLUMNS)
      return [parseAddress(r.focus).column];
    return Array.from({ length: r.right - r.left + 1 }, (_, i) => r.left + i);
  }
  // A dragged or auto-fitted header edge acts on the whole selection when its
  // column is selected, otherwise on that column only.
  function columnsFor(column) {
    const selected = selectedColumns();
    return column === undefined || selected.includes(column)
      ? selected
      : [column];
  }
  function setWidths(widthOf, label, column) {
    if (busy()) return;
    const columns = columnsFor(column);
    publish({
      label,
      sheetPatch: (sheet) => {
        const entries = { ...sheet.columns };
        for (const col of columns) {
          const name = columnName(col),
            width = widthOf(col, sheet),
            entry = { ...entries[name] };
          if (width === undefined || width === COLUMN_WIDTH) delete entry.width;
          else
            entry.width = Math.max(
              MIN_COLUMN_WIDTH,
              Math.min(MAX_COLUMN_WIDTH, Math.round(width)),
            );
          if (Object.keys(entry).length) entries[name] = entry;
          else delete entries[name];
        }
        const view = { ...sheet, columns: entries },
          rows = new Set(
            Object.keys(sheet.cells)
              .map((ref) => parseAddress(ref))
              .filter((p) => columns.includes(p.column))
              .map((p) => p.row),
          );
        return {
          columns: Object.keys(entries).length ? entries : undefined,
          rows: rowHeights(view, rows),
        };
      },
    });
  }
  const columnWidth = (px, column) =>
    setWidths(() => px, "Column width", column);
  // Auto-fit: the widest unwrapped displayed value, or the standard width.
  const autoFit = (column) =>
    setWidths(
      (col, sheet) => {
        let widest = 0;
        for (const [ref, cell] of Object.entries(sheet.cells)) {
          if (parseAddress(ref).column !== col) continue;
          const effective = effectiveOf(sheet, ref, cell);
          if (effective.align?.wrap || !display(cell, getBook().locale))
            continue;
          widest = Math.max(widest, textWidth(cell, effective) + 14);
        }
        return widest ? Math.max(24, widest) : undefined;
      },
      "Column width",
      column,
    );
  const widthOf = (col) =>
    getSheet().columns?.[columnName(col)]?.width ?? COLUMN_WIDTH;

  // ---- style painter: copy the selection's formatting, then paint ----
  let pattern = null;
  function startPainter() {
    const r = scope();
    if (r.kind !== "cells") {
      status(
        "Copy style works on a range of cells, not whole rows or columns.",
      );
      return;
    }
    try {
      targetRefs(r);
    } catch (error) {
      return status(`Copy style not available: ${error.message}`);
    }
    const sheet = getSheet();
    pattern = [];
    for (let row = r.top; row <= r.bottom; row++) {
      const line = [];
      for (let col = r.left; col <= r.right; col++) {
        const cell = sheet.cells[address(row, col)] ?? {};
        line.push(
          Object.fromEntries(
            PRESENTATION_FIELDS.filter((key) => cell[key] !== undefined).map(
              (key) => [key, structuredClone(cell[key])],
            ),
          ),
        );
      }
      pattern.push(line);
    }
    status(
      "Copy style: select the cells to format, then release the pointer or press Enter. Escape cancels.",
    );
  }
  function paint() {
    if (!pattern) return false;
    const source = pattern,
      r = scope();
    pattern = null;
    if (r.kind !== "cells") {
      status("Copy style applies to a range of cells.");
      return true;
    }
    publish({
      refs: targetRefs(r),
      label: "Formatting",
      transform: (cell, ref) => {
        const p = parseAddress(ref),
          line = source[(p.row - r.top) % source.length],
          look = line[(p.column - r.left) % line.length],
          rest = Object.fromEntries(
            Object.entries(cell).filter(
              ([key]) => !PRESENTATION_FIELDS.includes(key),
            ),
          );
        return { ...rest, ...structuredClone(look) };
      },
    });
    return true;
  }
  function cancelPainter() {
    if (!pattern) return false;
    pattern = null;
    status("Copy style cancelled.");
    return true;
  }

  // Clear formatting: cell style, number format and direct style; row or
  // column styles for whole rows or columns. Values, links and widths stay;
  // row heights return to what remaining wrapped cells need.
  function clear() {
    if (busy()) return;
    try {
      const r = scope(),
        refs = targetRefs(r),
        transform = (cell) =>
          Object.fromEntries(
            Object.entries(cell).filter(
              ([key]) => !PRESENTATION_FIELDS.includes(key),
            ),
          );
      publish({
        refs,
        transform,
        sheetPatch: (sheet) => {
          const fields = {};
          if (r.kind !== "cells") {
            const key = r.kind,
              entries = { ...sheet[key] };
            for (const [name, entry] of Object.entries(entries)) {
              const index =
                key === "rows" ? Number(name) : parseAddress(name + "1").column;
              const [from, to] =
                key === "rows" ? [r.top, r.bottom] : [r.left, r.right];
              if (index < from || index > to || !entry.style) continue;
              const { style: _, ...rest } = entry;
              if (Object.keys(rest).length) entries[name] = rest;
              else delete entries[name];
            }
            fields[key] = Object.keys(entries).length ? entries : undefined;
          }
          const preview = { ...sheet, ...fields, cells: { ...sheet.cells } };
          for (const ref of refs) {
            const next = transform(preview.cells[ref] ?? {});
            if (Object.keys(next).length) preview.cells[ref] = next;
            else delete preview.cells[ref];
          }
          fields.rows = rowHeights(
            preview,
            new Set(refs.map((ref) => parseAddress(ref).row)),
          );
          return fields;
        },
      });
    } catch (error) {
      status(`Formatting not applied: ${error.message}`);
    }
  }

  // ---- links (per sheet, ADR-010) ----
  function setLink(ref, link) {
    return publish({
      label: "Link",
      sheetPatch: (sheet) => {
        const links = { ...sheet.links };
        if (link) links[ref] = link;
        else delete links[ref];
        return { links: Object.keys(links).length ? links : undefined };
      },
    });
  }
  function openLink(link) {
    if (link.url) window.open(link.url, "_blank", "noopener,noreferrer");
    else if (link.ref === "#REF!")
      status(
        "This link's target was deleted. Undo the deletion to restore it.",
      );
    else locate(link.sheetId, parseRange(link.ref));
  }

  return {
    targetRefs,
    current,
    clear,
    toggle: (name) =>
      style(() => ({ [name]: !current()[name] }), { label: "Formatting" }),
    color: (kind, token) =>
      style(() => ({ [kind === "fill" ? "fill" : "color"]: token })),
    borders: ({ preset, style: line, color }) =>
      style((position, inherited) =>
        borderPatch(preset, position, { style: line, color }, inherited.border),
      ),
    align: (value) => {
      const next = current().align?.horizontal === value ? "general" : value;
      style(() => ({ align: { horizontal: next } }));
    },
    wrap: () =>
      style(() => ({ align: { wrap: !current().align?.wrap } }), {
        wrap: true,
      }),
    columnWidth,
    autoFit,
    widthOf,
    rowHeights,
    wrappedRows,
    withRowHeights,
    painting: () => !!pattern,
    startPainter,
    paint,
    cancelPainter,
    setLink,
    openLink,
  };
}
