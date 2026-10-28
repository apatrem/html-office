// Print / PDF of the selected sheet (T19): a print-only view built from the
// model with the grid's own rules (displayed values, catalogue and direct
// formatting, borders with the shared-edge rule, alignment, overflow, wrap,
// conditional highlights and data bars, sizes), as F06 draws a picture. The
// sheet becomes a table whose first rows repeat on every page; charts follow
// it as their saved SVG drawings. No editor chrome, no engine, no network.
// Stale saved results add the F06 warning band at the top.
import { address, parseAddress } from "../model/workbook.mjs";
import {
  cellClasses,
  effectiveStyle,
  resolveEdge,
  colorCSS,
} from "../model/formatting.mjs";
import {
  ROWS,
  COLUMNS,
  ROW_HEIGHT,
  COLUMN_WIDTH,
} from "../model/navigation.mjs";
import { sheetAxes } from "../model/axis.mjs";
import { display } from "./view.mjs";
import { paint, generalAlign, spill, LINE } from "./grid.mjs";
import { STALE_NOTICE } from "./picture.mjs";

export const MAX_PRINT_CELLS = 50000,
  // Browsers repeat a table header only while it is short (Chromium: a
  // quarter of the page), so at most five rows repeat.
  MAX_REPEAT_ROWS = 5;
const SIZES = {
  rows: ROWS,
  columns: COLUMNS,
  height: ROW_HEIGHT,
  width: COLUMN_WIDTH,
};
// Paper in millimetres and the page margin; CSS pixels are 96 per inch.
export const PAPER = {
  A4: { width: 210, height: 297 },
  Letter: { width: 215.9, height: 279.4 },
};
const MARGIN = 12,
  px = (mm) => (mm * 96) / 25.4;
// Letter is the default paper where it is the usual one.
export const defaultPaper = (locale) =>
  /-(US|CA|MX|PH|CL|CO|VE|PR)$/i.test(locale) ? "Letter" : "A4";
const columnName = (col) => address(1, col).replace(/\d+$/, "");

// Printable width of a page in CSS pixels.
export function printableWidth(paper, orientation) {
  const { width, height } = PAPER[paper];
  return px((orientation === "landscape" ? height : width) - 2 * MARGIN);
}

// Printable height of a page in CSS pixels.
export function printableHeight(paper, orientation) {
  const { width, height } = PAPER[paper];
  return px((orientation === "landscape" ? width : height) - 2 * MARGIN);
}

// How many of the first rows can repeat: browsers repeat a table header
// only while it is at most a quarter of the page high (CSS Tables 3), at
// the scale it prints.
export function repeatLimit(sheet, { paper, orientation, scale = 1 }) {
  const { rows } = sheetAxes(sheet, SIZES),
    quarter = printableHeight(paper, orientation) / 4;
  let count = 0,
    height = 0;
  while (count < MAX_REPEAT_ROWS) {
    height += rows.size(count + 1) * scale;
    if (height > quarter) break;
    count++;
  }
  return count;
}

// The rows at the top that repeat: leading rows whose filled cells all use
// the header cell style (none when the first row has no header cell).
export function headerRows(sheet, columns) {
  let count = 0;
  for (let row = 1; row <= MAX_REPEAT_ROWS; row++) {
    let header = false,
      other = false;
    for (let col = 1; col <= columns; col++) {
      const cell = sheet.cells[address(row, col)];
      if (!cell?.formula && (!cell?.input || cell.input.type === "blank"))
        continue;
      if (cell.cellStyle === "header") header = true;
      else other = true;
    }
    if (!header || other) break;
    count = row;
  }
  return count;
}

// The printed range: from A1 to the last cell record (style-only cells
// included, so a filled or bordered area prints); none for an empty sheet.
export function printBounds(sheet) {
  let rows = 0,
    columns = 0;
  for (const ref of Object.keys(sheet.cells)) {
    const p = parseAddress(ref);
    rows = Math.max(rows, p.row);
    columns = Math.max(columns, p.column);
  }
  return { rows, columns };
}

// Below this scale printed text gets hard to read: wide sheets are split
// into pages across instead.
export const MIN_FIT_SCALE = 0.6,
  MAX_REPEAT_COLUMNS = 5;

// What a print of the sheet holds: its range from A1, and the column bands
// printed one after another, each with its scale. `wide` is "fit" (one band
// scaled to the page width) or "split" (bands of whole columns at full size,
// each starting with the `repeatColumns` first columns); the default fits
// unless that needs less than MIN_FIT_SCALE.
export function printLayout(
  sheet,
  { paper, orientation, wide, repeatColumns = 1 },
) {
  const { rows, columns } = printBounds(sheet),
    axes = sheetAxes(sheet, SIZES),
    size = (col) => axes.columns.size(col),
    width = axes.columns.start(columns + 1) - axes.columns.start(1),
    page = printableWidth(paper, orientation),
    fit = Math.min(1, page / Math.max(1, width)),
    cells = rows * columns;
  wide ??= fit >= MIN_FIT_SCALE ? "fit" : "split";
  const all = Array.from({ length: columns }, (_, i) => i + 1),
    band = (cols) => {
      const w = cols.reduce((sum, col) => sum + size(col), 0);
      return { columns: cols, width: w, scale: Math.min(1, page / w) };
    };
  let bands = [band(all)];
  if (wide === "split" && fit < 1) {
    const fixed = all.slice(0, Math.min(repeatColumns, columns - 1)),
      start = fixed.reduce((sum, col) => sum + size(col), 0);
    bands = [];
    let current = [];
    for (const col of all.slice(fixed.length)) {
      const used = start + current.reduce((sum, c) => sum + size(c), 0);
      if (current.length && used + size(col) > page) {
        bands.push(band([...fixed, ...current]));
        current = [];
      }
      current.push(col);
    }
    if (current.length) bands.push(band([...fixed, ...current]));
  }
  const printed = rows * bands.reduce((n, b) => n + b.columns.length, 0);
  return {
    rows,
    columns,
    width,
    wide,
    bands,
    scale: Math.min(...bands.map((b) => b.scale)),
    refused: !cells
      ? `${sheet.name} is empty: there is nothing to print.`
      : printed > MAX_PRINT_CELLS
        ? `This sheet is too large to print (${cells.toLocaleString("en-US")} cells from A1 to ${address(rows, columns)}; the limit is ${MAX_PRINT_CELLS.toLocaleString("en-US")}). Export it as CSV instead.`
        : "",
  };
}

// The orientation that needs the least scaling.
export const bestOrientation = (sheet, paper) =>
  printLayout(sheet, { paper, orientation: "portrait", wide: "fit" }).scale < 1
    ? "landscape"
    : "portrait";

export function setupPrint({
  getBook,
  getSheet,
  decorate,
  isStale,
  // True while a pivot table writing to the sheet is not known to be current
  // (its analysis pending or failed).
  pivotsUnverified = () => false,
  gridLines,
  fontFamily,
  charts,
}) {
  let view = null,
    page = null;

  // The sheet as a table: each cell a div styled like the grid's, inside a
  // cell of the table's own size; borders drawn over the cells.
  function table(sheet, band, rowCount, repeat, locale) {
    const { rows, columns } = sheetAxes(sheet, SIZES),
      styles = new Map();
    function styleAt(row, col) {
      if (row < 1 || col < 1 || row > ROWS || col > COLUMNS) return null;
      const key = row * 20000 + col;
      if (!styles.has(key)) {
        const cell = sheet.cells[address(row, col)];
        styles.set(
          key,
          effectiveStyle(
            cell?.cellStyle,
            sheet.columns?.[columnName(col)]?.style,
            sheet.rows?.[row]?.style,
            cell?.style,
          ),
        );
      }
      return styles.get(key);
    }
    // Text overflows only into the band's own columns (as Excel clips at its
    // print area).
    const inBand = new Set(band.columns);
    const filled = (row, col) =>
      col < 1 ||
      !inBand.has(col) ||
      !!display(sheet.cells[address(row, col)], locale);
    const side = (row, col, name) => styleAt(row, col)?.border?.[name];
    function edge(td, found, vertical, at, outer) {
      if (!found) return;
      const [size, kind] = LINE[found.style],
        el = document.createElement("div"),
        shift = outer ? 0 : Math.ceil(size / 2);
      el.className = "print-edge";
      Object.assign(el.style, {
        [vertical ? "left" : "top"]: `${at - shift}px`,
        [vertical ? "top" : "left"]: "0",
        [vertical ? "height" : "width"]: "100%",
        [vertical ? "borderLeft" : "borderTop"]:
          `${size}px ${kind} ${colorCSS(found.color)}`,
      });
      td.append(el);
    }
    const element = document.createElement("table"),
      colgroup = document.createElement("colgroup"),
      head = document.createElement("thead"),
      body = document.createElement("tbody");
    element.className = "print-table";
    element.style.width = `${band.width}px`;
    if (band.scale < 1) element.style.zoom = String(band.scale);
    for (const col of band.columns) {
      const c = document.createElement("col");
      c.style.width = `${columns.size(col)}px`;
      colgroup.append(c);
    }
    for (let row = 1; row <= rowCount; row++) {
      const tr = document.createElement("tr"),
        height = rows.size(row);
      tr.style.height = `${height}px`;
      band.columns.forEach((col, i) => {
        const ref = address(row, col),
          cell = sheet.cells[ref] ?? {},
          text = display(cell, locale),
          style = styleAt(row, col),
          td = document.createElement("td"),
          b = document.createElement("div"),
          span = document.createElement("span");
        b.className = `grid-cell ${cellClasses(cell, !!sheet.links?.[ref])}`;
        b.style.width = `${columns.size(col)}px`;
        b.style.height = `${height}px`;
        span.className = "cell-text";
        span.textContent = text;
        b.append(span);
        const align = style?.align ?? {},
          horizontal =
            align.horizontal && align.horizontal !== "general"
              ? align.horizontal
              : generalAlign(cell);
        b.dataset.align = horizontal;
        if (align.wrap) b.classList.add("wrap");
        else if (
          text &&
          (horizontal === "centerContinuous" || generalAlign(cell) === "left")
        ) {
          // Overflow into empty neighbours, as the grid draws it.
          const { before, after } = spill(row, col, horizontal, {
            filled,
            styleAt,
            size: columns.size,
          });
          if (before || after) {
            b.classList.add("overflow");
            Object.assign(span.style, {
              left: `${6 - before}px`,
              width: `${columns.size(col) + before + after - 12}px`,
            });
          }
        }
        paint(b, style, cell);
        decorate(b, sheet.id, ref, cell);
        td.append(b);
        // Each shared edge once (heavier wins): the bottom and right edges
        // of every cell, and the outline's top and left inside it.
        edge(
          td,
          resolveEdge(side(row, col, "bottom"), side(row + 1, col, "top")),
          false,
          height,
          false,
        );
        // At a jump between columns (after the repeated ones), the edge
        // between the printed neighbours is drawn once, as the next one's
        // left edge.
        const next = band.columns[i + 1],
          prev = band.columns[i - 1];
        if (next === undefined || next === col + 1)
          edge(
            td,
            resolveEdge(side(row, col, "right"), side(row, col + 1, "left")),
            true,
            columns.size(col),
            false,
          );
        if (row === 1)
          edge(
            td,
            resolveEdge(side(row - 1, col, "bottom"), side(row, col, "top")),
            false,
            0,
            true,
          );
        // The band's first column has the outline's left edge.
        if (i === 0 || prev !== col - 1)
          edge(
            td,
            resolveEdge(
              side(row, i === 0 ? col - 1 : prev, "right"),
              side(row, col, "left"),
            ),
            true,
            0,
            i === 0,
          );
        tr.append(td);
      });
      (row <= repeat ? head : body).append(tr);
    }
    element.append(colgroup);
    if (head.childElementCount) element.append(head);
    element.append(body);
    return element;
  }

  // Charts of the sheet, after its table, as the drawings shown on screen
  // (a live drawing or the saved SVG preview), each kept on one page.
  function chartSection(sheet) {
    const items = charts.printable(sheet.id);
    if (!items.length) return null;
    const section = document.createElement("section");
    section.className = "print-charts";
    for (const item of items) {
      const figure = document.createElement("figure");
      figure.className = "print-chart";
      if (item.title) {
        const title = document.createElement("p");
        title.className = "data-chart-title";
        title.textContent = item.title;
        figure.append(title);
      }
      if (item.unit) {
        const unit = document.createElement("p");
        unit.className = "data-chart-unit";
        unit.textContent = item.unit;
        figure.append(unit);
      }
      if (item.src) {
        const img = document.createElement("img");
        img.src = item.src;
        img.alt = item.label;
        img.width = item.width;
        img.height = item.height;
        figure.append(img);
      }
      if (item.note) {
        const note = document.createElement("p");
        note.className = "print-chart-note";
        note.textContent = item.note;
        figure.append(note);
      }
      section.append(figure);
    }
    return section;
  }

  function clear() {
    view?.remove();
    page?.remove();
    view = page = null;
    document.documentElement.classList.remove("printing");
  }

  // Builds the print view; returns a refusal message, or "". Options left
  // out take the defaults the dialog proposes.
  function build({
    paper = defaultPaper(getBook().locale),
    orientation,
    wide,
    repeat,
    repeatColumns = 1,
    includeCharts = true,
  } = {}) {
    clear();
    const book = getBook(),
      sheet = getSheet();
    orientation ??= bestOrientation(sheet, paper);
    const layout = printLayout(sheet, {
      paper,
      orientation,
      wide,
      repeatColumns,
    });
    if (layout.refused) return layout.refused;
    repeat ??= headerRows(sheet, layout.columns);
    repeat = Math.max(
      0,
      Math.min(
        repeat,
        repeatLimit(sheet, { paper, orientation, scale: layout.scale }),
        layout.rows - 1,
      ),
    );
    let formulas = false;
    for (const cell of Object.values(sheet.cells))
      if (cell.formula) {
        formulas = true;
        break;
      }
    view = document.createElement("div");
    view.id = "print-view";
    view.classList.toggle("no-grid-lines", !gridLines());
    view.style.fontFamily = fontFamily();
    const title = document.createElement("header");
    title.className = "print-title";
    title.textContent = book.title
      ? `${book.title} — ${sheet.name}`
      : sheet.name;
    view.append(title);
    const tables = layout.bands.map((band) =>
      table(sheet, band, layout.rows, repeat, book.locale),
    );
    // Stale results, or a pivot table out of date (its cells carry a mark).
    if (
      isStale(formulas) ||
      pivotsUnverified(sheet.id) ||
      tables.some((t) => t.querySelector(".pivot-stale"))
    ) {
      const band = document.createElement("p");
      band.className = "print-stale";
      band.textContent = STALE_NOTICE;
      view.append(band);
    }
    view.append(...tables);
    const section = includeCharts ? chartSection(sheet) : null;
    if (section) view.append(section);
    page = document.createElement("style");
    page.id = "print-page";
    page.textContent = `@page{size:${paper} ${orientation};margin:${MARGIN}mm}`;
    document.head.append(page);
    document.body.append(view);
    document.documentElement.classList.add("printing");
    return "";
  }
  // The browser's own Print (its menu) prints the sheet with the defaults;
  // a refused sheet prints the reason rather than the editor's viewport.
  addEventListener("beforeprint", () => {
    if (view) return;
    const refused = build();
    if (!refused) return;
    view = document.createElement("div");
    view.id = "print-view";
    const reason = document.createElement("p");
    reason.className = "print-stale";
    reason.textContent = refused;
    view.append(reason);
    document.body.append(view);
    document.documentElement.classList.add("printing");
  });
  addEventListener("afterprint", clear);
  return { build, clear };
}
