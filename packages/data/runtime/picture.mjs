// Download PNG of the selection (F06, ADR-010): a picture drawn from the model
// with the grid's own rules (displayed values, catalogue and direct
// formatting, borders, alignment, overflow, wrap, conditional highlights and
// bars, sizes; no headers). Colours and fonts are read from cells styled like
// the grid's, then drawn on a canvas with the same primitives an SVG would
// hold (no foreignObject), so the charte's fonts apply. Engine-free: saved
// results are used, and stale ones add a warning band inside the image.
import { address } from "../model/workbook.mjs";
import {
  cellClasses,
  effectiveStyle,
  resolveEdge,
} from "../model/formatting.mjs";
import {
  rectangle,
  ROWS,
  COLUMNS,
  ROW_HEIGHT,
  COLUMN_WIDTH,
} from "../model/navigation.mjs";
import { sheetAxes } from "../model/axis.mjs";
import { display, usedBounds } from "./view.mjs";
import { paint, generalAlign, spill, LINE } from "./grid.mjs";

export const MAX_PICTURE_CELLS = 5000,
  MAX_PICTURE_SIDE = 8000,
  // Canvas area every browser accepts (Safari's limit is about 16.7 MP).
  MAX_PICTURE_PIXELS = 16000000;
const SIZES = {
  rows: ROWS,
  columns: COLUMNS,
  height: ROW_HEIGHT,
  width: COLUMN_WIDTH,
};
const PAD = 6,
  LINE_HEIGHT = 22,
  // Warning band: 12 px bold lines, 16 px apart, 6 px padding.
  NOTICE_LINE = 16;
export const STALE_NOTICE =
  "Saved results may be out of date. Recalculate before sharing.";
const columnName = (col) => address(1, col).replace(/\d+$/, "");

// Whole rows or columns are cut to the sheet's used range.
export function pictureBounds(selection, sheet) {
  const r = rectangle(selection.anchor, selection.focus),
    used = usedBounds(sheet);
  if (r.bottom === ROWS) r.bottom = Math.max(r.top, used.rows);
  if (r.right === COLUMNS) r.right = Math.max(r.left, used.columns);
  return r;
}

// Size in CSS pixels, the device scale (2×, or 1× when 2× would be too large)
// and the reason a selection is refused, if it is.
export function pictureSize(bounds, { rows, columns }, band = 0) {
  const cells =
      (bounds.bottom - bounds.top + 1) * (bounds.right - bounds.left + 1),
    width = columns.start(bounds.right + 1) - columns.start(bounds.left),
    height = rows.start(bounds.bottom + 1) - rows.start(bounds.top) + band,
    scale = width * height * 4 <= MAX_PICTURE_PIXELS ? 2 : 1;
  const refused =
    cells > MAX_PICTURE_CELLS ||
    width > MAX_PICTURE_SIDE ||
    height > MAX_PICTURE_SIDE ||
    width * height > MAX_PICTURE_PIXELS
      ? `The selection is too large for a picture (${cells.toLocaleString("en-US")} cells, ${width.toLocaleString("en-US")} × ${height.toLocaleString("en-US")} px; the limit is ${MAX_PICTURE_CELLS.toLocaleString("en-US")} cells and ${MAX_PICTURE_SIDE.toLocaleString("en-US")} px). Select a smaller range, or print the sheet to PDF.`
      : "";
  return { cells, width, height, scale, refused };
}

// Text cut to a width with an ellipsis, like CSS text-overflow.
export function fitText(text, width, measure) {
  if (measure(text) <= width) return text;
  let lo = 0,
    hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(text.slice(0, mid) + "…") <= width) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + "…";
}

// Lines of the stale-results notice (cells use the browser's own line
// breaking): spaces first, then inside words that do not fit.
export function wrapLines(text, width, measure) {
  const lines = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/(?<= )/)) {
      if (measure(line + word.trimEnd()) <= width) {
        line += word;
        continue;
      }
      if (line) lines.push(line.trimEnd());
      line = "";
      for (const ch of word) {
        if (line && measure(line + ch) > width && ch !== " ") {
          lines.push(line);
          line = "";
        }
        line += ch;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

const visible = (colour) =>
  colour && colour !== "transparent" && !/rgba\(.*,\s*0\)$/.test(colour);

// Lines of a laid-out text node, with where each starts relative to `left`
// (the browser's own breaking and alignment): each paragraph is cut where
// the next character starts a lower line (binary search over character
// boxes). A final line break adds no line, as in CSS.
function layoutLines(span, left) {
  const node = span?.firstChild;
  if (!node?.data) return [];
  const range = document.createRange(),
    top = (i) => {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      return range.getClientRects()[0]?.top ?? -Infinity;
    },
    lines = [],
    paragraphs = node.data.replace(/\n$/, "").split("\n");
  let start = 0;
  for (const paragraph of paragraphs) {
    const end = start + paragraph.length;
    if (!paragraph) lines.push({ text: "", x: 0 });
    let from = start;
    while (from < end) {
      const line = top(from);
      let lo = from + 1,
        hi = end;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (top(mid) > line + 1) hi = mid;
        else lo = mid + 1;
      }
      // The line's own left edge (its visible characters as a whole, so
      // right-to-left runs start where they are drawn).
      const text = node.data.slice(from, lo),
        visible = text.trimEnd().length || 1;
      range.setStart(node, from);
      range.setEnd(node, from + visible);
      const edges = [...range.getClientRects()].map((rect) => rect.left);
      lines.push({
        text,
        x: (edges.length ? Math.min(...edges) : left) - left,
      });
      from = lo;
    }
    start = end + 1;
  }
  return lines;
}

export function setupPicture({
  getBook,
  getSheet,
  getSelection,
  decorate,
  isStale,
  status,
}) {
  // Each cell styled like the grid's (classes, direct formatting and
  // conditional formatting), inside #grid so its rules apply; read once.
  // Wrapped cells are laid out at their real size, and their lines are read
  // back from the browser's own line breaking.
  function probe(sheet, bounds, styleAt, locale, { rows, columns }) {
    const root = document.getElementById("grid"),
      host = document.createElement("div"),
      found = new Map();
    host.className = "picture-probe";
    host.setAttribute("aria-hidden", "true");
    for (let row = bounds.top; row <= bounds.bottom; row++)
      for (let col = bounds.left; col <= bounds.right; col++) {
        const ref = address(row, col),
          cell = sheet.cells[ref] ?? {},
          b = document.createElement("div"),
          span = document.createElement("span");
        b.className = `grid-cell ${cellClasses(cell, !!sheet.links?.[ref])}`;
        b.style.width = `${columns.size(col)}px`;
        b.style.height = `${rows.size(row)}px`;
        // Alignment as the grid sets it, for the browser's line layout.
        const align = styleAt(row, col)?.align ?? {};
        b.dataset.align =
          align.horizontal && align.horizontal !== "general"
            ? align.horizontal
            : generalAlign(cell);
        if (align.wrap) b.classList.add("wrap");
        span.className = "cell-text";
        span.textContent = display(cell, locale);
        b.append(span);
        paint(b, styleAt(row, col), cell);
        decorate(b, sheet.id, ref, cell);
        host.append(b);
        found.set(ref, b);
      }
    root.append(host);
    try {
      const read = new Map();
      for (const [ref, b] of found) {
        const css = getComputedStyle(b),
          fill = b.querySelector(".data-bar-fill"),
          axis = b.querySelector(".data-bar-axis");
        read.set(ref, {
          background: css.backgroundColor,
          color: css.color,
          font: `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`,
          underline: css.textDecorationLine.includes("underline"),
          gridLine: css.borderRightColor,
          lines: b.classList.contains("wrap")
            ? layoutLines(
                b.querySelector(".cell-text"),
                b.getBoundingClientRect().left,
              )
            : null,
          bar: fill && {
            left: parseFloat(fill.style.left),
            width: parseFloat(fill.style.width),
            color: getComputedStyle(fill).backgroundColor,
            opacity: +getComputedStyle(fill).opacity,
            axis: axis && parseFloat(axis.style.left),
            axisColor: axis && getComputedStyle(axis).borderLeftColor,
          },
        });
      }
      return read;
    } finally {
      host.remove();
    }
  }

  async function download() {
    const book = getBook(),
      sheet = getSheet(),
      selection = getSelection(),
      axes = sheetAxes(sheet, SIZES),
      { rows, columns } = axes,
      bounds = pictureBounds(selection, sheet);
    // Refused before any per-cell work: a whole empty sheet is 17 billion
    // cells.
    const early = pictureSize(bounds, axes);
    if (early.refused) return status(early.refused);
    let formulas = false;
    for (let row = bounds.top; row <= bounds.bottom && !formulas; row++)
      for (let col = bounds.left; col <= bounds.right; col++)
        if (sheet.cells[address(row, col)]?.formula) {
          formulas = true;
          break;
        }
    // The stale-results notice wraps to the picture's width.
    const stale = isStale(formulas),
      family = getComputedStyle(document.getElementById("grid")).fontFamily,
      scratch = document.createElement("canvas").getContext("2d");
    scratch.font = `bold 12px ${family}`;
    const notice = stale
        ? wrapLines(
            STALE_NOTICE,
            Math.max(
              1,
              columns.start(bounds.right + 1) -
                columns.start(bounds.left) -
                2 * PAD,
            ),
            (s) => scratch.measureText(s).width,
          )
        : [],
      band = notice.length && notice.length * NOTICE_LINE + 2 * PAD,
      size = pictureSize(bounds, axes, band);
    if (size.refused) return status(size.refused);
    const locale = book.locale,
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
    const filled = (row, col) =>
      col >= 1 &&
      col <= COLUMNS &&
      !!display(sheet.cells[address(row, col)], locale);
    await document.fonts?.ready;
    const looks = probe(sheet, bounds, styleAt, locale, axes);
    const canvas = document.createElement("canvas");
    canvas.width = size.width * size.scale;
    canvas.height = size.height * size.scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(size.scale, size.scale);
    const top = band,
      x = (col) => columns.start(col) - columns.start(bounds.left),
      y = (row) => top + rows.start(row) - rows.start(bounds.top);
    // Backgrounds and data bars.
    const page = getComputedStyle(document.getElementById("grid"));
    ctx.fillStyle = visible(page.backgroundColor)
      ? page.backgroundColor
      : "#fff";
    ctx.fillRect(0, 0, size.width, size.height);
    for (let row = bounds.top; row <= bounds.bottom; row++)
      for (let col = bounds.left; col <= bounds.right; col++) {
        const look = looks.get(address(row, col)),
          w = columns.size(col),
          h = rows.size(row);
        if (visible(look.background)) {
          ctx.fillStyle = look.background;
          ctx.fillRect(x(col), y(row), w, h);
        }
        if (look.bar) {
          const inner = w - 1;
          ctx.globalAlpha = look.bar.opacity;
          ctx.fillStyle = look.bar.color;
          ctx.fillRect(
            x(col) + (inner * look.bar.left) / 100,
            y(row) + 4,
            (inner * look.bar.width) / 100,
            h - 9,
          );
          ctx.globalAlpha = 0.6;
          ctx.fillStyle = look.bar.axisColor;
          ctx.fillRect(
            Math.round(x(col) + (inner * look.bar.axis) / 100),
            y(row) + 2,
            1,
            h - 5,
          );
          ctx.globalAlpha = 1;
        }
      }
    // Grid lines as displayed (Grid lines off hides them), with a frame.
    const gridLine = looks.get(address(bounds.top, bounds.left)).gridLine;
    if (visible(gridLine)) {
      ctx.fillStyle = gridLine;
      for (let col = bounds.left; col <= bounds.right; col++)
        ctx.fillRect(x(col + 1) - 1, top, 1, size.height - top);
      for (let row = bounds.top; row <= bounds.bottom; row++)
        ctx.fillRect(0, y(row + 1) - 1, size.width, 1);
      ctx.fillRect(0, top, 1, size.height - top);
      ctx.fillRect(0, top, size.width, 1);
    }
    // Text: bottom-aligned 22 px lines, padded 6 px, clipped to its box.
    for (let row = bounds.top; row <= bounds.bottom; row++)
      for (let col = bounds.left; col <= bounds.right; col++) {
        const ref = address(row, col),
          cell = sheet.cells[ref],
          text = display(cell, locale);
        if (!text) continue;
        const look = looks.get(ref),
          style = styleAt(row, col),
          align = style?.align ?? {},
          horizontal =
            align.horizontal && align.horizontal !== "general"
              ? align.horizontal
              : generalAlign(cell),
          w = columns.size(col),
          h = rows.size(row);
        ctx.font = look.font;
        const measure = (s) => ctx.measureText(s).width,
          metrics = ctx.measureText("Hg"),
          ascent =
            metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent,
          descent =
            metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent,
          baseline = (LINE_HEIGHT - ascent - descent) / 2 + ascent;
        // The text box: the cell's content box (6 px padding, a 1 px border
        // right and below), or the overflow span the grid positions over
        // its neighbours.
        let left = x(col) + PAD,
          width = w - 2 * PAD - 1,
          spilled = false,
          lines;
        const bottom = y(row) + h - 1;
        if (align.wrap)
          // Where the browser placed each wrapped line.
          lines = look.lines.map((line) => ({
            text: line.text.trimEnd(),
            at: x(col) + line.x,
          }));
        else {
          if (
            horizontal === "centerContinuous" ||
            generalAlign(cell) === "left"
          ) {
            const { before, after } = spill(row, col, horizontal, {
              filled,
              styleAt,
              size: columns.size,
            });
            if (before || after) {
              left -= before;
              width = w + before + after - 2 * PAD;
              spilled = true;
            }
          }
          // white-space: pre keeps line breaks (a final one adds no line);
          // each line is cut alone, and a line too long for its box starts
          // at its left edge whatever the alignment, like CSS.
          lines = text
            .replace(/\n$/, "")
            .split("\n")
            .map((whole) => {
              const shown = fitText(whole, width, measure),
                advance = measure(shown);
              return {
                text: shown,
                at:
                  shown !== whole || horizontal === "left"
                    ? left
                    : horizontal === "right"
                      ? left + width - advance
                      : left + (width - advance) / 2,
              };
            });
        }
        // Wrapped text shows its first lines (max-height: 100%); unwrapped
        // text its last ones, bottom-aligned.
        const first = align.wrap
          ? bottom - Math.min(lines.length * LINE_HEIGHT, h - 1)
          : bottom - lines.length * LINE_HEIGHT;
        // Cells clip their text; an overflow span is visible above and below
        // its row, so only the picture's edges clip it.
        ctx.save();
        ctx.beginPath();
        if (spilled) ctx.rect(left, top, width, size.height - top);
        else ctx.rect(left, y(row), width, bottom - y(row));
        ctx.clip();
        ctx.fillStyle = look.color;
        ctx.textBaseline = "alphabetic";
        lines.forEach(({ text: line, at }, i) => {
          const base = first + i * LINE_HEIGHT + baseline;
          ctx.fillText(line, at, base);
          if (look.underline)
            ctx.fillRect(at, base + Math.max(1, descent / 3), measure(line), 1);
        });
        ctx.restore();
      }
    // Borders: each shared edge once, heavier line winning (ADR-010); edges
    // on the picture's outline are drawn inside it.
    const side = (row, col, name) => styleAt(row, col)?.border?.[name];
    function edge(found, at, from, length, vertical, inward) {
      if (!found) return;
      const [px, kind] = LINE[found.style],
        start =
          inward === "start"
            ? at
            : inward === "end"
              ? at - px
              : at - Math.ceil(px / 2);
      ctx.fillStyle = border(found.color);
      const bar = (offset, thickness) =>
        vertical
          ? ctx.fillRect(start + offset, from, thickness, length)
          : ctx.fillRect(from, start + offset, length, thickness);
      if (kind === "double") {
        bar(0, 1);
        bar(px - 1, 1);
      } else bar(0, px);
    }
    const tokens = getComputedStyle(document.documentElement),
      border = (token) =>
        tokens.getPropertyValue(`--${token}`).trim() || "#000";
    for (let row = bounds.top - 1; row <= bounds.bottom; row++)
      for (let col = bounds.left - 1; col <= bounds.right; col++) {
        if (col >= bounds.left)
          edge(
            resolveEdge(side(row, col, "bottom"), side(row + 1, col, "top")),
            y(row + 1),
            x(col),
            columns.size(col),
            false,
            row < bounds.top ? "start" : row === bounds.bottom ? "end" : null,
          );
        if (row >= bounds.top)
          edge(
            resolveEdge(side(row, col, "right"), side(row, col + 1, "left")),
            x(col + 1),
            y(row),
            rows.size(row),
            true,
            col < bounds.left ? "start" : col === bounds.right ? "end" : null,
          );
      }
    // Stale results: a warning band inside the image.
    if (band) {
      ctx.fillStyle = border("alert");
      ctx.fillRect(0, 0, size.width, band);
      ctx.fillStyle = border("bg");
      ctx.font = scratch.font;
      ctx.textBaseline = "middle";
      notice.forEach((line, i) =>
        ctx.fillText(line, PAD, PAD + (i + 0.5) * NOTICE_LINE),
      );
    }
    const range =
        bounds.top === bounds.bottom && bounds.left === bounds.right
          ? address(bounds.top, bounds.left)
          : `${address(bounds.top, bounds.left)}:${address(bounds.bottom, bounds.right)}`,
      blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
    if (!blob)
      return status(
        "The picture could not be created. Select a smaller range.",
      );
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `${[book.id, sheet.name, range.replace(":", "-")]
      .join("-")
      .replace(/[^\p{L}\p{N}._-]+/gu, "_")}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(
      `PNG download requested: ${sheet.name}!${range}, ${size.width.toLocaleString("en-US")} × ${size.height.toLocaleString("en-US")} px${stale ? ", with a stale-results warning" : ""}.`,
    );
  }
  return { download };
}
