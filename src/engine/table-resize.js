// Dragging the border between two columns of a slide table (FORMAT.md › Tables): the column left
// of the border and the table's frame change by the same amount, and the other columns keep
// their widths. The frame stops at the slide's right edge; a column stays at least 24 px wide.
// The frame's own handles (Moveable) still size the table's outer edges. The first move detaches
// the slide, as moving or resizing an element does. Releasing the pointer is one undo step;
// Escape, another pointer's release, the window losing focus or a cancelled pointer undo it.
import { state, begin, commit, detach, getPos, setPos, replaceSlide } from './model.js';
import { tableGrid, columnWidths, setColumnWidths, wholePercents } from './tables.js';

const EDGE = 4, SLIDE_W = 1280, MIN_COL = 24;
let active = null;

// The slide's child that holds the table: its frame.
const hostOf = table => { let el = table; while (el.parentElement && !el.parentElement.matches('section.slide')) el = el.parentElement; return el; };

// The inner border under the pointer: {table, c (the column left of it), g (its grid)}, or null.
function borderAt(e) {
  const cell = e.target.closest?.('td, th'), table = cell?.closest('table.t');
  if (!table || !state.main.contains(table) || !table.closest('section.slide')) return null;
  const g = tableGrid(table), a = g.anchors.find(x => x.cell === cell);
  if (!a || g.width < 2) return null;
  const box = cell.getBoundingClientRect();
  const b = Math.abs(e.clientX - box.right) <= EDGE ? a.c + a.cs : Math.abs(e.clientX - box.left) <= EDGE ? a.c : 0;
  return b > 0 && b < g.width ? { table, c: b - 1, g } : null;
}

// Column widths in slide pixels, from the borders the cells show; a border hidden by merged cells
// is placed by the saved percentages, the other columns sharing what is left evenly.
function measureColumns(table, g, k) {
  const edges = Array(g.width + 1).fill(null), box = table.getBoundingClientRect();
  edges[0] = box.left;
  for (const a of g.anchors) {
    const r = a.cell.getBoundingClientRect();
    edges[a.c] ??= r.left;
    edges[a.c + a.cs] ??= r.right;
  }
  edges[g.width] ??= box.right;
  const saved = columnWidths(table), px = box.width;
  for (let i = 1; i < g.width; i++) if (edges[i] === null) {
    let j = i;
    while (edges[j] === null) j++;
    const span = saved.slice(i - 1, j).map(w => (w ? (w / 100) * px : null));
    const gap = edges[j] - edges[i - 1], known = span.reduce((s, w) => s + (w ?? 0), 0), unknown = span.filter(w => w === null).length;
    edges[i] = edges[i - 1] + (unknown ? span[0] ?? Math.max(0, gap - known) / unknown : (span[0] * gap) / known);
  }
  return edges.slice(1).map((e, i) => Math.max(1, (e - edges[i]) / k));
}

function start(e, b, hooks) {
  const { table, c, g } = b, slide = table.closest('section.slide'), host = hostOf(table);
  const k = slide.getBoundingClientRect().width / SLIDE_W;
  const widths = measureColumns(table, g, k), x0 = e.clientX, pointer = e.pointerId;
  const tok = begin(slide), wasDetached = slide.hasAttribute('data-detached');
  let p0 = null;
  const least = Math.min(widths[c], MIN_COL) - widths[c];
  const move = ev => {
    if (ev.pointerId !== pointer) return;
    if (!(ev.buttons & 1)) return end(false);
    const dx = (ev.clientX - x0) / k;
    if (!p0) {
      if (Math.abs(dx) < 2) return; // a click near a border changes nothing
      if (!wasDetached) detach(slide);
      p0 = getPos(host);
    }
    const delta = Math.round(Math.min(Math.max(dx, least), SLIDE_W - (p0.x + p0.w)));
    const next = widths.slice();
    next[c] = widths[c] + delta;
    setPos(host, { ...p0, w: p0.w + delta });
    setColumnWidths(table, wholePercents(next));
    // a table that wraps taller gets a taller frame
    const h = Math.ceil(host.offsetHeight);
    if (h > p0.h) setPos(host, { ...getPos(host), h });
    hooks.refresh();
  };
  const listeners = [
    ['pointermove', move],
    ['pointerup', ev => ev.pointerId === pointer && end(true)],
    ['pointercancel', ev => ev.pointerId === pointer && end(false)],
    ['blur', ev => ev.target === window && end(false)],
    // While dragging, keys do nothing but Escape, which cancels.
    ['keydown', ev => { ev.preventDefault(); ev.stopPropagation(); if (ev.key === 'Escape') end(false); }]
  ];
  const end = keep => {
    if (active !== end) return;
    active = null;
    for (const [type, f] of listeners) removeEventListener(type, f, true);
    document.body.classList.remove('hs-col-dragging');
    if (!p0) return;
    if (keep) commit(tok);
    else replaceSlide(tok.id, tok.before);
    hooks.done(keep ? host : null);
  };
  active = end;
  for (const [type, f] of listeners) addEventListener(type, f, true);
  document.body.classList.add('hs-col-dragging');
}

// hooks: editing() (the editor accepts pointer edits), refresh() (redraw the selection's
// handles), done(host) (after a drag: the table's frame, or null when it was cancelled).
export function initTableResize(hooks) {
  state.main.addEventListener('pointermove', e => {
    if (e.buttons || active) return;
    document.body.classList.toggle('hs-col-resize', e.pointerType !== 'touch' && hooks.editing() && !!borderAt(e));
  });
  state.main.addEventListener('pointerleave', () => document.body.classList.remove('hs-col-resize'));
  // Before Selecto and Moveable, which would select or move the table: a press on a border is ours.
  addEventListener('pointerdown', e => {
    if (active || e.button !== 0 || e.pointerType === 'touch' || !hooks.editing()) return;
    const b = borderAt(e);
    if (!b) return;
    e.preventDefault(); // no compatibility mouse events, no caret, no text selection
    e.stopPropagation();
    start(e, b, hooks);
  }, true);
}
