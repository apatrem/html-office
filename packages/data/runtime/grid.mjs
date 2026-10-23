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
// chosen (explicit: a colour or the red negative preset) or derived from the
// fill (auto).
function paint(element, style, cell) {
  const chosen = style?.color ?? (negativeRed(cell) ? "alert" : null);
  if (style) {
    if (style.bold !== undefined)
      element.style.fontWeight = style.bold ? "bold" : "normal";
    if (style.italic !== undefined)
      element.style.fontStyle = style.italic ? "italic" : "normal";
    if (style.fill) {
      element.style.backgroundColor = fillCSS(style.fill);
      // Text follows the fill unless chosen: white on dark fills; ink when a
      // light fill replaces the header style's dark one.
      if (!chosen && DARK_FILLS.includes(style.fill)) {
        element.style.color = colorCSS("bg");
        element.dataset.textColor = "auto";
      } else if (!chosen && cell.cellStyle === "header") {
        element.style.color = colorCSS("ink");
        element.dataset.textColor = "auto";
      }
    }
  }
  if (chosen) {
    element.style.color = colorCSS(chosen);
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
    // F03 hooks: intercept(event) handles a key first; onSelectEnd(event,
    // ref, moved) after a pointer selection; onContextMenu({kind, index,
    // element}); onResize(column, width) and onAutoFit(column).
    intercept,
    onSelectEnd,
    onContextMenu,
    onResize,
    onAutoFit,
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
    // `outer` edges (the sheet's top and left) are drawn inside the first
    // row or column so the sticky headers do not cover them.
    function edge(side, left, top, length, vertical, outer = false) {
      if (!side) return;
      const [px, kind] = LINE[side.style],
        el = document.createElement("div"),
        shift = outer ? 0 : Math.ceil(px / 2);
      el.className = "grid-edge";
      Object.assign(el.style, {
        left: `${vertical ? left - shift : left}px`,
        top: `${vertical ? top : top - shift}px`,
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
            row === 0,
          );
        if (row >= v.top)
          edge(
            resolveEdge(side(row, col, "right"), side(row, col + 1, "left")),
            x(col + 1),
            y(row),
            rows.size(row),
            true,
            col === 0,
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
  // Whole rows and columns: anchor at the far end, active cell at the start.
  function selectRange(from, to, { scroll = true } = {}) {
    anchor = from;
    select(to, { extend: true, scroll });
  }
  const rowRange = (row, extend) =>
    selectRange(
      extend ? anchor.replace(/^[A-Z]+/, "XFD") : `XFD${row}`,
      `A${row}`,
      { scroll: false },
    );
  const columnRange = (col, extend) => {
    const name = address(1, col).replace(/\d+$/, "");
    selectRange(
      extend ? anchor.replace(/\d+$/, String(ROWS)) : `${name}${ROWS}`,
      `${name}1`,
      { scroll: false },
    );
  };
  let resizing = null,
    moved = false;
  const edgeOf = (event) => {
    const head = event.target.closest("[data-column]");
    if (!head) return null;
    const box = head.getBoundingClientRect();
    if (event.clientX > box.right - 5) return +head.dataset.column;
    if (event.clientX < box.left + 4 && +head.dataset.column > 1)
      return +head.dataset.column - 1;
    return null;
  };
  root.addEventListener("pointerdown", (event) => {
    if (busy() || event.button !== 0) return;
    const edge = edgeOf(event);
    if (edge !== null && onResize) {
      event.preventDefault();
      const start = axes().columns.size(edge),
        guide = document.createElement("div");
      guide.className = "resize-guide";
      guide.style.height = `${root.clientHeight}px`;
      root.append(guide);
      resizing = { column: edge, x: event.clientX, start, width: start, guide };
      root.setPointerCapture?.(event.pointerId);
      return;
    }
    const rowHead = event.target.closest("[data-row]"),
      columnHead = event.target.closest("[data-column]");
    if (rowHead || columnHead) {
      event.preventDefault();
      root.focus({ preventScroll: true });
      drag = rowHead ? "row" : "column";
      if (rowHead) rowRange(+rowHead.dataset.row, event.shiftKey);
      else columnRange(+columnHead.dataset.column, event.shiftKey);
      return;
    }
    const b = event.target.closest("[data-cell]");
    if (!b) return;
    event.preventDefault();
    root.focus({ preventScroll: true });
    drag = "cell";
    moved = false;
    select(b.dataset.cell, { extend: event.shiftKey });
  });
  root.addEventListener("pointermove", (event) => {
    if (resizing) {
      resizing.width = Math.max(
        8,
        Math.min(2000, resizing.start + event.clientX - resizing.x),
      );
      const head = root.querySelector(`[data-column="${resizing.column}"]`);
      if (head) {
        const box = head.getBoundingClientRect(),
          grid = root.getBoundingClientRect();
        resizing.guide.style.left = `${box.left - grid.left + root.scrollLeft + resizing.width}px`;
        resizing.guide.style.top = `${root.scrollTop}px`;
      }
      return;
    }
    root.classList.toggle("over-edge", edgeOf(event) !== null);
    if (!drag || !event.buttons || busy()) return;
    if (drag === "row") {
      const head = event.target.closest("[data-row]");
      if (head) select(`A${head.dataset.row}`, { extend: true, scroll: false });
      return;
    }
    if (drag === "column") {
      const head = event.target.closest("[data-column]");
      if (head)
        select(`${address(1, +head.dataset.column).replace(/\d+$/, "")}1`, {
          extend: true,
          scroll: false,
        });
      return;
    }
    const b = event.target.closest("[data-cell]");
    if (b && b.dataset.cell !== focus) {
      moved = true;
      select(b.dataset.cell, { extend: true, scroll: false });
    }
  });
  window.addEventListener("pointerup", (event) => {
    if (resizing) {
      const { column, width, start, guide } = resizing;
      resizing = null;
      guide.remove();
      if (Math.round(width) !== start) onResize(column, Math.round(width));
      return;
    }
    const was = drag;
    drag = false;
    if (was === "cell" || was === "row" || was === "column")
      onSelectEnd?.(event, focus, moved || was !== "cell");
  });
  root.addEventListener("dblclick", (event) => {
    const edge = edgeOf(event);
    if (edge !== null && onAutoFit && !busy()) return onAutoFit(edge);
    if (event.target.closest("[data-cell]") && !busy()) onEdit();
  });
  root.addEventListener("contextmenu", (event) => {
    if (busy() || !onContextMenu) return;
    const rowHead = event.target.closest("[data-row]"),
      columnHead = event.target.closest("[data-column]"),
      b = event.target.closest("[data-cell]");
    if (!rowHead && !columnHead && !b) return;
    event.preventDefault();
    const r = rectangle(anchor, focus);
    if (rowHead) {
      const row = +rowHead.dataset.row;
      if (
        !(
          r.left === 1 &&
          r.right === COLUMNS &&
          row >= r.top &&
          row <= r.bottom
        )
      )
        rowRange(row, false);
      onContextMenu({ kind: "row", element: rowHead });
    } else if (columnHead) {
      const col = +columnHead.dataset.column;
      if (
        !(r.top === 1 && r.bottom === ROWS && col >= r.left && col <= r.right)
      )
        columnRange(col, false);
      onContextMenu({ kind: "column", element: columnHead });
    } else {
      const p = parseAddress(b.dataset.cell);
      if (
        !(
          p.row >= r.top &&
          p.row <= r.bottom &&
          p.column >= r.left &&
          p.column <= r.right
        )
      )
        select(b.dataset.cell);
      onContextMenu({
        kind: "cell",
        element: root.querySelector(`#grid-${focus}`) ?? b,
      });
    }
  });
  root.addEventListener("keydown", (event) => {
    if (busy() || intercept?.(event)) return;
    const command = event.ctrlKey || event.metaKey;
    // Excel shortcuts: Shift+Space selects rows, Ctrl+Space columns;
    // Shift+F10 or the context-menu key opens the cell menu.
    if (
      event.key === " " &&
      (event.shiftKey || event.ctrlKey) &&
      !event.metaKey
    ) {
      event.preventDefault();
      const r = rectangle(anchor, focus);
      if (event.ctrlKey)
        selectRange(
          `${address(1, r.right).replace(/\d+$/, "")}${ROWS}`,
          `${address(1, r.left).replace(/\d+$/, "")}1`,
          { scroll: false },
        );
      else selectRange(`XFD${r.bottom}`, `A${r.top}`, { scroll: false });
      return;
    }
    if (
      event.key === "ContextMenu" ||
      (event.key === "F10" && event.shiftKey)
    ) {
      event.preventDefault();
      onContextMenu?.({
        kind: "cell",
        element: root.querySelector(`#grid-${focus}`) ?? root,
      });
      return;
    }
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
    selectRange,
    get selection() {
      return { anchor, focus, ...rectangle(anchor, focus) };
    },
  };
}
