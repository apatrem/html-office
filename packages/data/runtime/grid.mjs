import { address, parseAddress } from "../model/workbook.mjs";
import { cellClasses } from "../model/formatting.mjs";
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
import { display, usedBounds } from "./view.mjs";
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
  plane.style.width = `${L + COLUMNS * W}px`;
  plane.style.height = `${H + ROWS * H}px`;
  root.replaceChildren(plane);
  function draw() {
    frame = null;
    const sheet = getSheet(),
      r = rectangle(anchor, focus),
      v = viewport({
        top: root.scrollTop,
        left: root.scrollLeft,
        height: root.clientHeight,
        width: root.clientWidth,
      });
    const fragment = document.createDocumentFragment();
    function node(tag, text, x, y, width, cls) {
      const el = document.createElement(tag);
      el.textContent = text;
      el.className = cls;
      Object.assign(el.style, {
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${H}px`,
      });
      fragment.append(el);
      return el;
    }
    for (let row = v.top; row <= v.bottom; row++) {
      const line = node("div", "", 0, row * H, L + COLUMNS * W, "grid-row");
      line.setAttribute("role", "row");
      line.setAttribute("aria-rowindex", row);
      // Cells remain descendants of their semantic row, with row-relative coordinates.
      for (let col = v.left; col <= v.right; col++) {
        const ref = address(row, col),
          cell = sheet.cells[ref] ?? {},
          text = display(cell, getLocale()),
          selected =
            row >= r.top && row <= r.bottom && col >= r.left && col <= r.right;
        const b = node(
          "button",
          text || "\u00a0",
          L + (col - 1) * W,
          0,
          W,
          `grid-cell ${cellClasses(cell, !!sheet.links?.[ref])}`,
        );
        line.append(b);
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
      }
      const head = node(
        "div",
        String(row),
        root.scrollLeft,
        row * H,
        L,
        "grid-row-head",
      );
      head.setAttribute("role", "rowheader");
      head.dataset.row = row;
    }
    for (let col = v.left; col <= v.right; col++) {
      const head = node(
        "div",
        address(1, col).replace(/\d+$/, ""),
        L + (col - 1) * W,
        root.scrollTop,
        W,
        "grid-column-head",
      );
      head.setAttribute("role", "columnheader");
      head.dataset.column = col;
    }
    node("div", "", root.scrollLeft, root.scrollTop, L, "grid-corner");
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
        x = L + (p.column - 1) * W,
        y = p.row * H;
      if (y < root.scrollTop + H) root.scrollTop = y - H;
      else if (y + H > root.scrollTop + root.clientHeight)
        root.scrollTop = y + H - root.clientHeight;
      if (x < root.scrollLeft + L) root.scrollLeft = x - L;
      else if (x + W > root.scrollLeft + root.clientWidth)
        root.scrollLeft = x + W - root.clientWidth;
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
