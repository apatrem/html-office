import { address, parseAddress } from "../model/workbook.mjs";
import {
  cellClasses,
  effectiveStyle,
  resolveEdge,
  colorCSS,
  fillCSS,
  DARK_FILLS,
} from "../model/formatting.mjs";
import {
  rectangle,
  navigate,
  viewport,
  ROWS,
  COLUMNS,
  ROW_HEIGHT as H,
  COLUMN_WIDTH as W,
  ROW_HEADER as L,
} from "../model/navigation.mjs";
import { sheetAxes } from "../model/axis.mjs";
import { display, negativeRed, usedBounds } from "./view.mjs";
const SIZES = { rows: ROWS, columns: COLUMNS, height: H, width: W };
// Unwrapped text overflows into at most this many empty neighbours (ADR-010).
const OVERFLOW = 20;
const LINE = {
  thin: [1, "solid"],
  medium: [2, "solid"],
  double: [3, "double"],
};
const columnName = (col) => address(1, col).replace(/\d+$/, "");
// Value kinds for general alignment: numbers and dates right, text left,
// booleans and errors centred.
function generalAlign(cell) {
  const v = cell.formula ? cell.result : cell.input;
  return !v || v.type === "text"
    ? "left"
    : v.type === "boolean" || v.type === "error"
      ? "center"
      : "right";
}
// Direct formatting as inline styles; catalogue classes stay underneath and
// conditional formatting is applied after, on top.
// data-text-color tells conditional formatting whether the text colour was
// chosen (explicit) or derived from a dark fill (auto).
function paint(element, style, cell) {
  if (negativeRed(cell)) {
    element.style.color = colorCSS("alert");
    element.dataset.textColor = "explicit";
  }
  if (!style) return;
  if (style.bold !== undefined)
    element.style.fontWeight = style.bold ? "bold" : "normal";
  if (style.italic !== undefined)
    element.style.fontStyle = style.italic ? "italic" : "normal";
  if (style.fill) {
    element.style.backgroundColor = fillCSS(style.fill);
    // Text follows the fill unless a colour is given: white on dark fills;
    // ink when a light fill replaces the header style's dark one.
    if (!style.color && DARK_FILLS.includes(style.fill)) {
      element.style.color = colorCSS("bg");
      element.dataset.textColor ??= "auto";
    } else if (!style.color && cell.cellStyle === "header") {
      element.style.color = colorCSS("ink");
      element.dataset.textColor ??= "auto";
    }
  }
  if (style.color) {
    element.style.color = colorCSS(style.color);
    element.dataset.textColor = "explicit";
  }
}
// One focusable grid, a bounded DOM viewport, and a single rectangular selection.
export function createGrid(
  root,
  {
    getSheet,
    getLocale = () => "en-US",
    busy,
    onSelect,
    onEdit,
    onCommand,
    decorateCell,
  },
) {
  let anchor = "B2",
    focus = "B2",
    frame,
    drag = false;
  root.tabIndex = 0;
  root.setAttribute("role", "grid");
  root.setAttribute("aria-rowcount", ROWS);
  root.setAttribute("aria-colcount", COLUMNS);
  const plane = document.createElement("div");
  plane.className = "grid-plane";
  root.replaceChildren(plane);
  const axes = () => sheetAxes(getSheet(), SIZES);
  function draw() {
    frame = null;
    const sheet = getSheet(),
      { rows, columns } = axes(),
      r = rectangle(anchor, focus),
      v = viewport(
        {
          top: root.scrollTop,
          left: root.scrollLeft,
          height: Math.max(0, root.clientHeight - H),
          width: Math.max(0, root.clientWidth - L),
        },
        { rows, columns },
      );
    const width = L + columns.total;
    plane.style.width = `${width}px`;
    plane.style.height = `${H + rows.total}px`;
    const fragment = document.createDocumentFragment(),
      locale = getLocale();
    function node(tag, text, x, y, w, h, cls) {
      const el = document.createElement(tag);
      el.textContent = text;
      el.className = cls;
      Object.assign(el.style, {
        left: `${x}px`,
        top: `${y}px`,
        width: `${w}px`,
        height: `${h}px`,
      });
      fragment.append(el);
      return el;
    }
    // Effective formatting of every cell in and around the viewport.
    const styles = new Map();
    // Outside the sheet (row or column 0, or past Excel's bounds) is unstyled.
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
    // Neighbours are read from the sheet, not the rendered columns, so the
    // result does not depend on the viewport.
    const filled = (row, col) =>
      col >= 1 &&
      col <= COLUMNS &&
      !!display(sheet.cells[address(row, col)], locale);
    const x = (col) => L + columns.start(col),
      y = (row) => H + rows.start(row);
    for (let row = v.top; row <= v.bottom; row++) {
      const height = rows.size(row),
        line = node("div", "", 0, y(row), width, height, "grid-row");
      line.setAttribute("role", "row");
      line.setAttribute("aria-rowindex", row);
      const cells = [];
      for (let col = v.left; col <= v.right; col++) {
        const ref = address(row, col),
          cell = sheet.cells[ref] ?? {},
          text = display(cell, locale);
        cells.push({ col, ref, cell, text, style: styleAt(row, col) });
      }
      // Cells remain descendants of their semantic row, with row-relative coordinates.
      cells.forEach((info, i) => {
        const { col, ref, cell, text, style } = info,
          selected =
            row >= r.top && row <= r.bottom && col >= r.left && col <= r.right,
          b = document.createElement("button"),
          span = document.createElement("span");
        b.className = `grid-cell ${cellClasses(cell, !!sheet.links?.[ref])}`;
        Object.assign(b.style, {
          left: `${x(col)}px`,
          top: "0px",
          width: `${columns.size(col)}px`,
          height: `${height}px`,
        });
        span.className = "cell-text";
        span.textContent = text || "\u00a0";
        b.append(span);
        line.append(b);
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
        )
          overflow(b, span, row, col, horizontal);
        paint(b, style, cell);
        b.dataset.cell = ref;
        b.id = `grid-${ref}`;
        b.tabIndex = -1;
        b.disabled = busy();
        b.setAttribute("role", "gridcell");
        b.setAttribute("aria-colindex", col);
        b.setAttribute("aria-label", `${ref}: ${text || "Empty"}`);
        b.setAttribute("aria-selected", selected);
        b.setAttribute("aria-pressed", ref === focus);
        b.title = `${ref}${cell.formula ? ` · ${cell.formula}` : ""}`;
        decorateCell?.(b, sheet.id, ref, cell);
      });
      const head = node(
        "div",
        String(row),
        root.scrollLeft,
        y(row),
        L,
        height,
        "grid-row-head",
      );
      head.setAttribute("role", "rowheader");
      head.dataset.row = row;
    }
    // Text overflows into empty neighbours (left text to the right, right
    // text to the left, centred text both ways); centre across selection
    // spans the following empty centerContinuous cells, for any value.
    function overflow(b, span, row, col, horizontal) {
      let before = 0,
        after = 0;
      if (horizontal === "centerContinuous") {
        for (
          let c = col + 1;
          c <= col + OVERFLOW &&
          c <= COLUMNS &&
          !filled(row, c) &&
          styleAt(row, c)?.align?.horizontal === "centerContinuous";
          c++
        )
          after += columns.size(c);
      } else {
        if (horizontal !== "right")
          for (
            let c = col + 1;
            c <= col + OVERFLOW && c <= COLUMNS && !filled(row, c);
            c++
          )
            after += columns.size(c);
        if (horizontal !== "left")
          for (
            let c = col - 1;
            c >= col - OVERFLOW && c >= 1 && !filled(row, c);
            c--
          )
            before += columns.size(c);
        if (horizontal === "center") before = after = Math.min(before, after);
      }
      if (!before && !after) return;
      b.classList.add("overflow");
      Object.assign(span.style, {
        left: `${6 - before}px`,
        width: `${columns.size(col) + before + after - 12}px`,
      });
    }
    // Borders: each shared edge drawn once, above the cells (ADR-010 rule).
    const edges = document.createElement("div");
    edges.className = "grid-edges";
    edges.setAttribute("aria-hidden", "true");
    function edge(side, left, top, length, vertical) {
      if (!side) return;
      const [px, kind] = LINE[side.style],
        el = document.createElement("div");
      el.className = "grid-edge";
      Object.assign(el.style, {
        left: `${vertical ? left - Math.ceil(px / 2) : left}px`,
        top: `${vertical ? top : top - Math.ceil(px / 2)}px`,
        [vertical ? "height" : "width"]: `${length}px`,
        [vertical ? "borderLeft" : "borderTop"]:
          `${px}px ${kind} ${colorCSS(side.color)}`,
      });
      edges.append(el);
    }
    const side = (row, col, name) => styleAt(row, col)?.border?.[name];
    for (let row = v.top - 1; row <= v.bottom; row++)
      for (let col = v.left - 1; col <= v.right; col++) {
        // Row 0 and column 0 give the sheet's top and left edges.
        if (col >= v.left)
          edge(
            resolveEdge(side(row, col, "bottom"), side(row + 1, col, "top")),
            x(col),
            y(row + 1),
            columns.size(col),
            false,
          );
        if (row >= v.top)
          edge(
            resolveEdge(side(row, col, "right"), side(row, col + 1, "left")),
            x(col + 1),
            y(row),
            rows.size(row),
            true,
          );
      }
    if (edges.childElementCount) fragment.append(edges);
    for (let col = v.left; col <= v.right; col++) {
      const head = node(
        "div",
        columnName(col),
        x(col),
        root.scrollTop,
        columns.size(col),
        H,
        "grid-column-head",
      );
      head.setAttribute("role", "columnheader");
      head.dataset.column = col;
    }
    node("div", "", root.scrollLeft, root.scrollTop, L, H, "grid-corner");
    plane.replaceChildren(fragment);
    markSelection();
  }
  function markSelection() {
    const sheet = getSheet(),
      r = rectangle(anchor, focus);
    for (const b of root.querySelectorAll("[data-cell]")) {
      const p = parseAddress(b.dataset.cell);
      b.setAttribute(
        "aria-selected",
        p.row >= r.top &&
          p.row <= r.bottom &&
          p.column >= r.left &&
          p.column <= r.right,
      );
      b.setAttribute("aria-pressed", b.dataset.cell === focus);
    }
    // Headers of the selected rows and columns are highlighted.
    for (const head of root.querySelectorAll("[data-row]"))
      head.classList.toggle(
        "in-selection",
        +head.dataset.row >= r.top && +head.dataset.row <= r.bottom,
      );
    for (const head of root.querySelectorAll("[data-column]"))
      head.classList.toggle(
        "in-selection",
        +head.dataset.column >= r.left && +head.dataset.column <= r.right,
      );
    root.setAttribute(
      "aria-label",
      `${sheet.name}, selected ${anchor === focus ? focus : anchor + ":" + focus}`,
    );
    if (root.querySelector(`#grid-${focus}`))
      root.setAttribute("aria-activedescendant", `grid-${focus}`);
    else root.removeAttribute("aria-activedescendant");
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(draw);
  }
  function select(ref, { extend = false, scroll = true, notify = true } = {}) {
    parseAddress(ref);
    if (!extend) anchor = ref;
    focus = ref;
    if (scroll) {
      const p = parseAddress(ref),
        { rows, columns } = axes(),
        x = L + columns.start(p.column),
        y = H + rows.start(p.row),
        w = columns.size(p.column),
        h = rows.size(p.row);
      if (y < root.scrollTop + H) root.scrollTop = y - H;
      else if (y + h > root.scrollTop + root.clientHeight)
        root.scrollTop = y + h - root.clientHeight;
      if (x < root.scrollLeft + L) root.scrollLeft = x - L;
      else if (x + w > root.scrollLeft + root.clientWidth)
        root.scrollLeft = x + w - root.clientWidth;
    }
    if (!root.querySelector(`#grid-${focus}`)) draw();
    else markSelection();
    if (notify) onSelect(ref);
  }
  root.addEventListener("scroll", schedule, { passive: true });
  new ResizeObserver(schedule).observe(root);
  root.addEventListener("pointerdown", (event) => {
    const b = event.target.closest("[data-cell]");
    if (!b || busy() || event.button !== 0) return;
    event.preventDefault();
    root.focus({ preventScroll: true });
    drag = true;
    select(b.dataset.cell, { extend: event.shiftKey });
  });
  root.addEventListener("pointermove", (event) => {
    if (!drag || !event.buttons || busy()) return;
    const b = event.target.closest("[data-cell]");
    if (b && b.dataset.cell !== focus)
      select(b.dataset.cell, { extend: true, scroll: false });
  });
  window.addEventListener("pointerup", () => (drag = false));
  root.addEventListener("dblclick", (event) => {
    if (event.target.closest("[data-cell]") && !busy()) onEdit();
  });
  root.addEventListener("keydown", (event) => {
    if (busy()) return;
    const command = event.ctrlKey || event.metaKey;
    if (command && ["z", "y", "c", "v"].includes(event.key.toLowerCase())) {
      onCommand?.(event);
      return;
    }
    if (
      [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Enter",
        "Home",
        "End",
        "PageUp",
        "PageDown",
      ].includes(event.key)
    ) {
      event.preventDefault();
      select(
        navigate(focus, event.key, {
          command,
          shift: event.shiftKey,
          pageRows: Math.max(1, Math.floor(root.clientHeight / H) - 1),
          used: usedBounds(getSheet()),
        }),
        {
          extend:
            event.shiftKey && event.key !== "Tab" && event.key !== "Enter",
        },
      );
    } else if (event.key === "F2") {
      event.preventDefault();
      onEdit();
    } else if (!command && !event.altKey && event.key.length === 1) {
      event.preventDefault();
      onEdit(event.key);
    }
  });
  return {
    draw,
    select,
    get selection() {
      return { anchor, focus, ...rectangle(anchor, focus) };
    },
  };
}
