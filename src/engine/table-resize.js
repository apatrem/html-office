// Dragging the border between two columns of a slide table (FORMAT.md › Tables): the column left
// of the border and the table's frame change by the same amount, and the other columns keep
// their widths. The frame stops at the slide's right edge; a column stays at least 24 px wide.
// The frame's own handles (Moveable) still size the table's outer edges. The first move detaches
// the slide, as moving or resizing an element does. Releasing the pointer is one undo step;
// Escape, another pointer's release, the window losing focus or a cancelled pointer undo it.
import { state, begin, commit, detach, getPos, setPos, replaceSlide } from './model.js';
import { tableGrid, columnWidths, setColumnWidths, wholePercents } from './tables.js';

const EDGE = 4, SLIDE_W = 1280, MIN_COL = 24;
let active = null, ended = 0;

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
  let p0 = null, good = 0;
  // The frame's own horizontal padding and borders, around a table it wraps.
  const cs = getComputedStyle(host), pad = host === table ? 0
    : ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((sum, p) => sum + parseFloat(cs[p]), 0);
  const least = Math.min(widths[c], MIN_COL);
  // The frame and the columns for a change of `delta` pixels: whole percentages by largest
  // remainders (each column off by under 1%), the dragged one at least `least` pixels.
  const apply = delta => {
    const w = p0.w + delta, total = widths.reduce((a, b) => a + b, 0) + delta;
    const next = widths.slice();
    next[c] = Math.max(1, widths[c] + delta);
    const cols = wholePercents(next);
    while ((cols[c] / 100) * total < least - 0.5) {
      const others = cols.map((p, i) => (i === c ? -1 : p)), widest = Math.max(...others);
      if (widest <= 1) return false;
      cols[others.indexOf(widest)]--;
      cols[c]++;
    }
    setPos(host, { ...p0, w });
    setColumnWidths(table, cols);
    // The table cannot be narrower than its content.
    return table.getBoundingClientRect().width / k <= w - pad + 1;
  };
  // The widest change towards `delta` that the content allows: growing always fits; shrinking
  // stops at the narrowest width that does, found by halving between it and the last that fitted.
  const fit = delta => {
    if (apply(delta)) return delta;
    if (delta >= good) { apply(good); return good; }
    let lo = delta, hi = good; // lo does not fit, hi does
    while (hi - lo > 1) {
      const mid = Math.round((lo + hi) / 2);
      if (apply(mid)) hi = mid; else lo = mid;
    }
    apply(hi);
    return hi;
  };
  const move = ev => {
    if (ev.pointerId !== pointer) return;
    if (!(ev.buttons & 1) || !table.isConnected) return end(false);
    const dx = (ev.clientX - x0) / k;
    if (!p0) {
      if (Math.abs(dx) < 2) return; // a click near a border changes nothing
      if (!wasDetached) detach(slide);
      p0 = getPos(host);
    }
    const delta = Math.round(Math.min(Math.max(dx, least - widths[c]), SLIDE_W - (p0.x + p0.w)));
    good = fit(delta);
    // a table that wraps taller gets a taller frame (its content may overflow a wrapper's height)
    const below = host === table ? 0 : parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth);
    const h = Math.ceil((table.getBoundingClientRect().bottom - host.getBoundingClientRect().top) / k + below);
    setPos(host, { ...getPos(host), h: Math.max(p0.h, h) });
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
    if (p0) ended = Date.now();
    for (const [type, f] of listeners) removeEventListener(type, f, true);
    document.body.classList.remove('hs-col-dragging');
    if (!p0 || !table.isConnected) return;
    if (keep) commit(tok);
    else replaceSlide(tok.id, tok.before);
    hooks.done(keep ? host : null);
  };
  active = end;
  for (const [type, f] of listeners) addEventListener(type, f, true);
  document.body.classList.add('hs-col-dragging');
}

// hooks: editing() (the editor accepts pointer edits), before() (ends typing), refresh() (redraw
// the selection's handles), done(host) (after a drag: the table's frame, or null when cancelled).
export function initTableResize(hooks) {
  state.main.addEventListener('pointermove', e => {
    if (e.buttons || active) return;
    document.body.classList.toggle('hs-col-resize', e.pointerType !== 'touch' && hooks.editing() && !!borderAt(e));
  });
  state.main.addEventListener('pointerleave', () => document.body.classList.remove('hs-col-resize'));
  // Before Selecto and Moveable, which would select or move the table: a press on a border is ours.
  // During a drag no other pointer starts anything (a selection, a move, a command), nor does the
  // click that ends it.
  const block = e => { if (active || Date.now() - ended < 400) { e.preventDefault(); e.stopPropagation(); } };
  for (const type of ['click', 'touchstart']) addEventListener(type, block, { capture: true, passive: false });
  addEventListener('pointerdown', e => {
    if (active) { e.preventDefault(); e.stopPropagation(); return; }
    if (e.button !== 0 || e.pointerType === 'touch' || !hooks.editing()) return;
    const b = borderAt(e);
    if (!b) return;
    e.preventDefault(); // no compatibility mouse events, no caret, no text selection
    e.stopPropagation();
    hooks.before(); // typing in a cell is committed first, an undo step of its own
    start(e, b, hooks);
  }, true);
}
