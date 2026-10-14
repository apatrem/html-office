// Editor: selection (Selecto), moving and resizing with snapping (Moveable),
// alignment, in-place text, theme formatting, data panel, keyboard.
import Moveable from 'moveable';
import Selecto from 'selecto';
import { state, slides, items, isContent, slideOf, begin, commit, apply, detach, getPos, setPos, undo, redo,
  setClass, sanitize, FORMAT_GROUPS, newId, applyDeck, insertSlideHTML, cleanSlideHTML, emit, resolveAssets, markDirty, persistDraft } from './model.js';
import { slideHTML, ELEMENTS, chartHTML, SHAPES, shapeHTML } from './templates.js';
import { registry, readData, renderChart, echartsReady, loadECharts, refreshCaches } from './charts.js';
import { banner, present, go, ui } from './view.js';

const GRID = 8;
const CONTENT = { x: 64, y: 44, w: 1152, h: 624 };
const SIZES = ['fs-s', 'fs-m', 'fs-l', 'fs-xl', 'fs-xxl'], SIZE_PX = [13, 16, 20, 26, 34];
const ALL_DIR = { left: true, top: true, right: true, bottom: true, center: true, middle: true };

let moveable, selecto, H = {};
let targets = [], selSlide = null, editing = null, gesture = null, buttonDown = false;

export const editingMode = () => document.body.classList.contains('hs-editing');
export const selection = () => targets.filter(el => el.isConnected);
const refresh = () => { if (moveable && selection().length) moveable.updateRect(); };

// ---------- selection ----------
function setTargets(list) {
  list = list.filter(el => el && el.isConnected);
  const slide = list.length ? slideOf(list[0]) : null;
  list = list.filter(el => slideOf(el) === slide);
  selSlide = slide;
  if (slide) {
    setCurrent(slide);
    moveable.snapContainer = slide;
    moveable.elementGuidelines = items(slide).filter(el => !list.includes(el));
    moveable.keepRatio = list.length === 1 && list[0].tagName === 'IMG';
  }
  targets = list;
  moveable.target = list;
  selecto.setSelectedTargets(list);
  notify();
}
// Toolbar context: slide only, or selected element(s) / element being typed in
function notify() {
  const els = editing ? [editing.el] : selection();
  emit('selection', {
    kind: els.length ? 'el' : 'slide',
    chart: els.length === 1 && els[0].matches('figure.chart'),
    table: els.length === 1 && !!tableOf(els[0])
  });
}
const tableOf = el => (el.matches('table') ? el : el.querySelector(':scope > table'));
export function clearSel() { if (moveable) setTargets([]); }

// ---------- Moveable gestures: detaching, positions, undo ----------
function startGesture(list) {
  const slide = slideOf(list[0]);
  const wasDetached = slide.hasAttribute('data-detached');
  const tok = begin(slide);
  if (!wasDetached) detach(slide);
  gesture = { slide, tok, wasDetached, moved: false, start: new Map(list.map(el => [el, getPos(el)])) };
}
function endGesture() {
  const g = gesture;
  gesture = null;
  if (!g) return;
  if (!g.moved) {
    // simple click: the slide is not detached
    if (!g.wasDetached) { g.slide.removeAttribute('data-detached'); items(g.slide).forEach(el => el.removeAttribute('style')); }
    refresh();
    return;
  }
  commit(g.tok);
  H.resizeCharts(g.slide);
  refresh();
}
function moveBy(ev) {
  const r = gesture.start.get(ev.target);
  setPos(ev.target, { ...r, x: r.x + ev.beforeDist[0], y: r.y + ev.beforeDist[1] });
  gesture.moved = true;
}
function resizeTo(ev) {
  const r = gesture.start.get(ev.target);
  setPos(ev.target, { x: r.x + ev.drag.beforeDist[0], y: r.y + ev.drag.beforeDist[1], w: ev.width, h: ev.height });
  gesture.moved = true;
}

function initMoveable() {
  moveable = new Moveable(document.body, {
    target: [], draggable: true, resizable: true, keepRatio: false, origin: false,
    throttleDrag: 0, throttleResize: 0,
    renderDirections: ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'],
    snappable: true, snapGridWidth: GRID, snapGridHeight: GRID, snapThreshold: 6,
    snapDirections: ALL_DIR, elementSnapDirections: ALL_DIR, snapGap: true,
    isDisplaySnapDigit: true, isDisplayInnerSnapDigit: false,
    verticalGuidelines: [64, 640, 1216], horizontalGuidelines: [44, 360, 668],
    bounds: { left: 0, top: 0, right: 0, bottom: 0, position: 'css' }
  });
  moveable
    .on('dragStart', e => startGesture([e.target]))
    .on('drag', moveBy)
    .on('dragEnd', endGesture)
    .on('dragGroupStart', e => startGesture(e.targets))
    .on('dragGroup', e => e.events.forEach(moveBy))
    .on('dragGroupEnd', endGesture)
    .on('resizeStart', e => startGesture([e.target]))
    .on('resize', resizeTo)
    .on('resizeEnd', endGesture)
    .on('resizeGroupStart', e => startGesture(e.targets))
    .on('resizeGroup', e => e.events.forEach(resizeTo))
    .on('resizeGroupEnd', endGesture);
}

function initSelecto() {
  selecto = new Selecto({
    container: document.body, dragContainer: state.main,
    selectableTargets: ['main#deck > section.slide > [data-id]'],
    selectByClick: true, selectFromInside: false, toggleContinueSelect: ['shift'],
    hitRate: 0, ratio: 0
  });
  selecto.on('dragStart', e => {
    const t = e.inputEvent.target;
    if (!editingMode() || t.closest('[contenteditable]') || moveable.isMoveableElement(t) ||
        selection().some(el => el === t || el.contains(t))) { e.stop(); return; }
    if (editing) stopText();
    const s = t.closest('section.slide');
    if (s) setCurrent(s);
  }).on('selectEnd', e => {
    const origin = e.inputEvent && e.inputEvent.target && e.inputEvent.target.closest && e.inputEvent.target.closest('section.slide');
    let list = e.selected;
    if (origin) list = list.filter(el => slideOf(el) === origin);
    setTargets(list);
    if (e.isDragStart && selection().length) {
      e.inputEvent.preventDefault();
      // chain the drag only while the button is still down (otherwise a simple click would leave a gesture open)
      moveable.waitToChangeTarget().then(() => { if (buttonDown) moveable.dragStart(e.inputEvent); });
    }
  });
}

// ---------- texte ----------
function startText(el, e) {
  if (el.matches('figure.chart')) return openData(el);
  if (el.matches('.rule, img')) return;
  if (editing) stopText();
  setTargets([]);
  editing = { el, tok: begin(slideOf(el)) };
  el.setAttribute('contenteditable', 'true');
  el.setAttribute('spellcheck', 'true');
  el.focus();
  if (e && document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (r) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  }
  el.addEventListener('blur', stopText, { once: true });
  el.addEventListener('input', markDirty);
  notify();
}
export function stopText() {
  if (!editing) return;
  const { el, tok } = editing;
  editing = null;
  el.removeEventListener('input', markDirty);
  el.removeAttribute('contenteditable');
  el.removeAttribute('spellcheck');
  sanitize(el);
  commit(tok);
  if (editingMode() && el.isConnected) setTargets([el]); else notify();
}

// Non-empty text selection in the element being edited
function textRange() {
  if (!editing) return null;
  const s = getSelection();
  if (!s.rangeCount) return null;
  const r = s.getRangeAt(0);
  return !r.collapsed && editing.el.contains(r.commonAncestorContainer) ? r : null;
}
// Colour applied to part of the text: every text node touched is wrapped in a <span class="c-…">.
function wrapColor(range, cls) {
  const root = range.commonAncestorContainer.nodeType === 3 ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts = [];
  while (w.nextNode()) {
    const n = w.currentNode;
    if (!range.intersectsNode(n)) continue;
    const a = n === range.startContainer ? range.startOffset : 0;
    const b = n === range.endContainer ? range.endOffset : n.length;
    if (b > a) parts.push([n, a, b]);
  }
  const made = parts.map(([n, a, b]) => {
    if (b < n.length) n.splitText(b);
    const t = a > 0 ? n.splitText(a) : n;
    const sp = document.createElement('span');
    sp.className = cls;
    t.replaceWith(sp);
    sp.appendChild(t);
    return sp;
  });
  if (made.length) {
    const r = document.createRange();
    r.setStartBefore(made[0]); r.setEndAfter(made[made.length - 1]);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
}

// ---------- element formatting (theme classes) ----------
function formatEls(fn) {
  if (editing) { fn(editing.el); markDirty(); return; } // history when the text ends, draft immediately
  const els = selection();
  if (!els.length) return banner('Select one or more elements first.', [], 2500);
  apply({ type: 'mutate', slide: selSlide, els, fn });
  refresh();
}
export function bold() {
  if (textRange()) return document.execCommand('bold');
  formatEls(el => setClass(el, 'bold', el.classList.contains('t-bold') ? null : 't-bold'));
}
export function italic() {
  if (textRange()) return document.execCommand('italic');
  formatEls(el => setClass(el, 'italic', el.classList.contains('t-italic') ? null : 't-italic'));
}
export function color(cls) {
  const r = textRange();
  if (r) { wrapColor(r, cls); markDirty(); return; }
  formatEls(el => setClass(el, 'c', cls === 'c-ink' ? null : cls));
}
export function fill(cls) { formatEls(el => setClass(el, 'bg', cls)); }
export function textAlign(cls) { formatEls(el => setClass(el, 'ta', el.classList.contains(cls) ? null : cls)); }
export function size(step) {
  formatEls(el => {
    let cur = SIZES.findIndex(c => el.classList.contains(c));
    if (cur < 0) {
      const px = parseFloat(getComputedStyle(el).fontSize) || 16;
      cur = SIZE_PX.reduce((best, v, i) => (Math.abs(v - px) < Math.abs(SIZE_PX[best] - px) ? i : best), 0);
    }
    setClass(el, 'fs', SIZES[Math.max(0, Math.min(SIZES.length - 1, cur + step))]);
  });
}
export function clearFormat() {
  formatEls(el => FORMAT_GROUPS.forEach(g => setClass(el, g, null)));
  if (editing) { const r = textRange(); if (r) document.execCommand('removeFormat'); }
}

// ---------- disposition ----------
function withSlide(fn) {
  const list = selection();
  if (!list.length || !selSlide) return banner('Select one or more elements first.', [], 2500);
  const tok = begin(selSlide);
  detach(selSlide);
  fn(list.map(el => ({ el, r: getPos(el) })));
  commit(tok);
  refresh();
}
const bbox = rs => {
  const x = Math.min(...rs.map(r => r.x)), y = Math.min(...rs.map(r => r.y));
  return { x, y, w: Math.max(...rs.map(r => r.x + r.w)) - x, h: Math.max(...rs.map(r => r.y + r.h)) - y };
};
export function align(how) {
  withSlide(list => {
    const ref = list.length > 1 ? bbox(list.map(i => i.r)) : CONTENT;
    list.forEach(({ el, r }) => {
      const n = { ...r };
      if (how === 'left') n.x = ref.x;
      if (how === 'hcenter') n.x = ref.x + ref.w / 2 - r.w / 2;
      if (how === 'right') n.x = ref.x + ref.w - r.w;
      if (how === 'top') n.y = ref.y;
      if (how === 'vcenter') n.y = ref.y + ref.h / 2 - r.h / 2;
      if (how === 'bottom') n.y = ref.y + ref.h - r.h;
      setPos(el, n);
    });
  });
}
export function distribute(axis) {
  if (selection().length < 3) return banner('Select at least three elements (Shift-click or selection rectangle).', [], 3000);
  withSlide(list => {
    const [p, d] = axis === 'x' ? ['x', 'w'] : ['y', 'h'];
    list.sort((a, b) => a.r[p] - b.r[p]);
    const first = list[0].r, last = list[list.length - 1].r;
    const gap = (last[p] + last[d] - first[p] - list.reduce((a, i) => a + i.r[d], 0)) / (list.length - 1);
    let cur = first[p];
    list.forEach(({ el, r }) => { setPos(el, { ...r, [p]: cur }); cur += r[d] + gap; });
  });
}
const nudge = (dx, dy) => withSlide(list => list.forEach(({ el, r }) => setPos(el, { ...r, x: r.x + dx, y: r.y + dy })));
export function zorder(dir) {
  const els = selection();
  if (!els.length) return banner('Select an element first.', [], 2500);
  apply({ type: 'zorder', slide: selSlide, els: dir > 0 ? els.slice().reverse() : els, dir });
  refresh();
}
export function relayout() {
  const slide = selSlide || state.current;
  if (!slide) return banner('Cliquez d\'abord dans une slide.', [], 2500);
  if (!slide.hasAttribute('data-detached')) return banner('This slide already follows its layout.', [], 2500);
  clearSel();
  apply({ type: 'relayout', slide });
  H.resizeCharts(slide);
}
export function removeSel() {
  const els = selection();
  if (!els.length) return;
  const slide = selSlide;
  clearSel();
  apply({ type: 'remove', slide, els });
}
export function duplicateSel() {
  const els = selection();
  if (!els.length) return;
  const op = apply({ type: 'duplicate', slide: selSlide, els });
  if (op) { op.created.forEach(c => { if (c.matches('figure.chart')) renderChart(c); }); setTargets(op.created); }
}

// ---------- slide courante ----------
export function setCurrent(slide) {
  if (!slide || slide === state.current && slide.classList.contains('hs-focus')) return;
  slides().forEach(x => x.classList.remove('hs-focus'));
  state.current = slide;
  slide.classList.add('hs-focus');
  emit('current', slide);
}
// Current slide: the last one touched, otherwise the one at the centre of the screen.
export function currentSlide() {
  if (state.current && state.current.isConnected) return state.current;
  const mid = innerHeight / 2;
  const s = slides().find(x => { const r = x.getBoundingClientRect(); return r.top <= mid && r.bottom >= mid; }) || slides()[0];
  if (s) setCurrent(s);
  return s;
}

// ---------- inserting elements ----------
const fromHTML = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
function placeNew(slide, el, w, h) {
  const taken = items(slide).filter(x => x !== el).map(getPos);
  let x = Math.round((1280 - w) / 2 / GRID) * GRID, y = 224;
  while (taken.some(r => r.x === x && r.y === y)) { x += 16; y += 16; }
  setPos(el, { x, y, w, h });
}
function insertNode(html, w, h) {
  const slide = currentSlide();
  if (!slide) return null;
  if (editing) stopText();
  const tok = begin(slide);
  detach(slide);
  const el = fromHTML(html);
  el.dataset.id = newId();
  slide.appendChild(el);
  placeNew(slide, el, w, h);
  return { slide, el, tok };
}
export function insertElement(kind) {
  const [, html, w, h] = ELEMENTS[kind];
  const r = insertNode(html, w, h);
  if (!r) return;
  commit(r.tok);
  setTargets([r.el]);
  if (!r.el.matches('.arrow, .rule')) {
    startText(r.el);
    const sel = getSelection(), range = document.createRange();
    range.selectNodeContents(r.el);
    sel.removeAllRanges(); sel.addRange(range);
  }
}
export function insertShape(key) {
  const def = SHAPES.find(x => x[0] === key);
  if (!def) return;
  const r = insertNode(shapeHTML(key), def[2], def[3]);
  if (!r) return;
  commit(r.tok);
  setTargets([r.el]);
}

// ---------- tables: rows and columns ----------
// Acts on the cell holding the caret (while typing), otherwise on the last row / column.
export function tableOp(kind) {
  const host = editing ? editing.el : selection()[0];
  const table = host && tableOf(host);
  if (!table) return banner('Select a table.', [], 2500);
  const sel = getSelection();
  const anchor = editing && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
  const cell = anchor && table.contains(anchor) ? (anchor.nodeType === 1 ? anchor : anchor.parentElement).closest('td, th') : null;
  const rows = [...table.rows];
  const row = cell ? cell.parentElement : rows[rows.length - 1];
  const col = cell ? cell.cellIndex : row.cells.length - 1;
  let focus = null;
  const fn = () => {
    if (kind === 'row+') {
      // template: the current row, or the first data row when the caret is in the header
      const model = row.querySelector('th') ? (rows.find(r => !r.querySelector('th') && !r.classList.contains('tot')) || row) : row;
      const nr = model.cloneNode(true);
      nr.classList.remove('tot');
      if (!nr.getAttribute('class')) nr.removeAttribute('class');
      [...nr.cells].forEach(c => { c.textContent = ''; c.appendChild(document.createElement('br')); });
      // no row added below the total row: it stays last
      (row.classList.contains('tot') ? row.before(nr) : row.after(nr));
      focus = nr.cells[Math.min(col, nr.cells.length - 1)];
    } else if (kind === 'row-') {
      if (rows.length <= 2) return banner('Un tableau garde au moins deux lignes.', [], 2500);
      focus = (row.nextElementSibling || row.previousElementSibling)?.cells[col] || null;
      row.remove();
    } else if (kind === 'col+') {
      rows.forEach(r => {
        const c = r.cells[Math.min(col, r.cells.length - 1)];
        const nc = c.cloneNode(false);
        nc.appendChild(document.createElement('br'));
        c.after(nc);
        if (r === row) focus = nc;
      });
    } else if (kind === 'col-') {
      if (row.cells.length <= 1) return banner('Un tableau garde au moins une colonne.', [], 2500);
      rows.forEach(r => { const c = r.cells[Math.min(col, r.cells.length - 1)]; if (c) c.remove(); });
      focus = row.cells[Math.max(0, col - 1)] || null;
    }
    // detached slide: enlarge the frame if the table overflows
    if (host.hasAttribute('style')) {
      const p = getPos(host), hh = Math.ceil(host.offsetHeight), ww = Math.ceil(host.offsetWidth);
      if (hh > p.h || ww > p.w) setPos(host, { ...p, h: Math.max(p.h, hh), w: Math.max(p.w, ww) });
    }
  };
  if (editing) {
    fn(); // recorded with the text being typed (a single undo step)
    markDirty();
    if (focus) { const r = document.createRange(); r.selectNodeContents(focus); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); }
  } else {
    apply({ type: 'mutate', slide: slideOf(host), els: [host], fn });
    refresh();
  }
}

export async function insertChart(type) {
  if (!echartsReady()) await loadECharts();
  if (!echartsReady()) return banner('Chart insertion requires ECharts (internet connection or an offline bundle).', [], 5000);
  const r = insertNode(chartHTML(type), 640, 360);
  if (!r) return;
  if (!r.slide.querySelector(':scope > .source')) {
    const src = fromHTML('<p class="source">Source: to be completed</p>');
    src.dataset.id = newId();
    r.slide.appendChild(src);
    setPos(src, { x: 64, y: 648, w: 1152, h: 16 });
  }
  commit(r.tok);
  renderChart(r.el);
  setTargets([r.el]);
  openData(r.el);
}
// Image picked from disk: reduced to at most 1,600 px wide, WebP when possible, embedded in the file.
async function shrink(file) {
  const toB64 = blob => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
  if (file.type === 'image/svg+xml') {
    const url = URL.createObjectURL(file), img = new Image();
    await new Promise(res => { img.onload = res; img.onerror = res; img.src = url; });
    return { type: file.type, data: await toB64(file), w: img.naturalWidth || 400, h: img.naturalHeight || 300 };
  }
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  let blob = await new Promise(res => c.toBlob(res, 'image/webp', 0.82));
  if (!blob || blob.type !== 'image/webp') blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
  return { type: blob.type, data: await toB64(blob), w: c.width, h: c.height };
}
function addAsset(a) {
  const s = document.getElementById('assets');
  const all = JSON.parse((s && s.textContent) || '{}');
  let n = 1;
  while (all['a' + n]) n++;
  all['a' + n] = a;
  s.textContent = JSON.stringify(all);
  return 'a' + n;
}
export async function insertImageFile(file) {
  if (!file) return;
  const img = await shrink(file);
  const id = addAsset({ type: img.type, data: img.data });
  const alt = (window.prompt('Image description (alt text for LLMs and screen readers):', file.name.replace(/\.[^.]+$/, '')) || file.name).replace(/"/g, '');
  const k = Math.min(1, 560 / img.w, 360 / img.h);
  const r = insertNode(`<img data-asset="${id}" alt="${alt}">`, Math.round(img.w * k), Math.round(img.h * k));
  if (!r) return;
  resolveAssets(r.slide);
  commit(r.tok);
  setTargets([r.el]);
}
export function insertImage() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
  input.onchange = () => insertImageFile(input.files[0]);
  input.click();
}

// ---------- slide operations ----------
function deckOp(fn) {
  if (editing) stopText();
  clearSel();
  const focus = applyDeck(fn);
  if (focus && focus.isConnected) { setCurrent(focus); focus.scrollIntoView({ block: 'center' }); }
}
export function newSlide(layout) { deckOp(() => insertSlideHTML(slideHTML(layout), currentSlide())); }
export function duplicateSlide() { const cur = currentSlide(); if (cur) deckOp(() => insertSlideHTML(cleanSlideHTML(cur), cur)); }
export function deleteSlide() {
  const cur = currentSlide();
  if (!cur) return;
  if (slides().length < 2) return banner('Cannot delete the last slide.', [], 2500);
  const next = cur.nextElementSibling && cur.nextElementSibling.matches('section.slide') ? cur.nextElementSibling : slides()[slides().indexOf(cur) - 1];
  deckOp(() => { cur.remove(); return next; });
  banner('Slide deleted.', [['Cancel', () => { clearSel(); undo(); }]], 5000);
}
export function moveSlide(dir) {
  const cur = currentSlide(), all = slides(), i = all.indexOf(cur), j = i + dir;
  if (!cur || j < 0 || j >= all.length) return;
  deckOp(() => { if (dir < 0) all[j].before(cur); else all[j].after(cur); return cur; });
}
export function moveSlideTo(slide, ref, after) {
  if (!slide || !ref || slide === ref) return;
  deckOp(() => { if (after) ref.after(slide); else ref.before(slide); return slide; });
}
export function goSlide(slide, scroll) {
  if (editing) stopText();
  clearSel();
  setCurrent(slide);
  if (scroll) slide.scrollIntoView({ block: 'center', behavior: 'instant' });
}
export function setLayout(layout) {
  const slide = currentSlide();
  if (!slide) return;
  if (editing) stopText();
  clearSel();
  apply({ type: 'mutate', slide, els: [slide], fn: s => {
    s.removeAttribute('data-detached');
    items(s).forEach(el => el.removeAttribute('style'));
    s.dataset.layout = layout;
  } });
  H.resizeCharts(slide);
}
export function footerPanel() {
  const slide = currentSlide();
  const wrap = ui('div', 'hs-panel'), box = document.createElement('div');
  wrap.appendChild(box);
  box.innerHTML = '<h2>Footer</h2><label>Footer text (all slides; page numbers are added automatically)</label>';
  const input = document.createElement('input');
  input.value = state.main.dataset.footer || '';
  const lab = document.createElement('label');
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.style.width = 'auto'; cb.checked = !!(slide && slide.hasAttribute('data-nofoot'));
  lab.append(cb, ' Hide the footer on slide ' + (slides().indexOf(slide) + 1));
  const bar = document.createElement('div'); bar.className = 'hs-row';
  const close = () => wrap.remove();
  const b = (t, fn, cls) => { const x = document.createElement('button'); x.textContent = t; if (cls) x.className = cls; x.onclick = fn; bar.appendChild(x); };
  b('Cancel', close);
  b('Apply', () => {
    close();
    deckOp(() => { state.main.dataset.footer = input.value.trim(); if (slide) slide.toggleAttribute('data-nofoot', cb.checked); return slide; });
  }, 'primary');
  box.append(input, lab, bar);
  wrap.addEventListener('pointerdown', e => { if (e.target === wrap) close(); });
  document.body.appendChild(wrap);
  input.focus();
}

// ---------- data panel ----------
export function dataPanel() {
  const fig = selection().find(el => el.matches('figure.chart'));
  if (!fig) return banner('Select a chart.', [], 2500);
  openData(fig);
}
function openData(fig) {
  if (!echartsReady()) return banner('Editing chart data requires ECharts (internet connection or an offline bundle).', [], 5000);
  const def = registry[fig.dataset.type];
  const { data, error } = readData(fig);
  if (!def || error) return banner('Unreadable chart: ' + (error || 'unknown type'), [], 4000);
  const tbl = def.table;
  let headers = tbl.columns(data), rows = tbl.toRows(data);
  const wrap = document.createElement('div');
  wrap.className = 'hs-panel';
  wrap.setAttribute('data-ui', '');
  const box = document.createElement('div');
  wrap.appendChild(box);
  const field = (label, value) => {
    const l = document.createElement('label'); l.textContent = label;
    const i = document.createElement('input'); i.value = value ?? '';
    box.append(l, i); return i;
  };
  box.insertAdjacentHTML('beforeend', `<h2>Data · ${def.label}</h2>`);
  const fTitle = field('Chart title', data.title);
  const fUnit = field('Unit', data.unit);
  const fHl = field('Highlight (row number starting at 1, or name; blank = none)',
    data.highlight === undefined ? '' : (typeof data.highlight === 'number' ? data.highlight + 1 : data.highlight));
  const table = document.createElement('table');
  const err = document.createElement('div'); err.className = 'err';
  const json = document.createElement('textarea'); json.style.display = 'none';
  const renderTable = () => {
    table.innerHTML = '';
    const tr = table.insertRow();
    headers.forEach((h, j) => { const th = document.createElement('th'); const i = document.createElement('input'); i.value = h; i.readOnly = !(tbl.canAddColumn && j > 0); th.appendChild(i); tr.appendChild(th); });
    rows.forEach(r => { const row = table.insertRow(); headers.forEach((_, j) => { const c = row.insertCell(); const i = document.createElement('input'); i.value = r[j] ?? ''; c.appendChild(i); }); });
  };
  const readTable = () => {
    const trs = [...table.rows];
    headers = [...trs[0].querySelectorAll('input')].map(i => i.value);
    rows = trs.slice(1).map(tr => [...tr.querySelectorAll('input')].map(i => i.value));
  };
  renderTable();
  box.append(table);
  const bar = document.createElement('div'); bar.className = 'hs-row';
  const b = (label, fn, cls) => { const x = document.createElement('button'); x.textContent = label; if (cls) x.className = cls; x.onclick = fn; bar.appendChild(x); };
  b('+ row', () => { readTable(); rows.push(headers.map(() => '')); renderTable(); });
  b('− row', () => { readTable(); rows.pop(); renderTable(); });
  if (tbl.canAddColumn) {
    b('+ series', () => { readTable(); headers.push('Series ' + headers.length); rows.forEach(r => r.push('')); renderTable(); });
    b('− series', () => { readTable(); if (headers.length > 2) { headers.pop(); rows.forEach(r => r.pop()); } renderTable(); });
  }
  b('Advanced JSON', () => { const on = json.style.display === 'none'; json.style.display = on ? 'block' : 'none'; table.style.display = on ? 'none' : ''; if (on) json.value = JSON.stringify(data, null, 2); });
  const close = () => wrap.remove();
  b('Cancel', close);
  b('Apply', () => {
    let nd;
    try {
      if (json.style.display !== 'none') nd = JSON.parse(json.value);
      else {
        readTable();
        nd = tbl.fromRows(rows.filter(r => r.some(v => String(v).trim() !== '')), headers, data);
        nd.title = fTitle.value.trim() || undefined;
        nd.unit = fUnit.value.trim() || undefined;
        const hv = fHl.value.trim();
        if (!hv) delete nd.highlight;
        else nd.highlight = /^\d+$/.test(hv) ? Number(hv) - 1 : hv;
      }
    } catch (x) { err.textContent = 'Invalid JSON: ' + x.message; return; }
    const errs = def.validate(nd);
    if (errs.length) { err.textContent = errs.join(' ; '); return; }
    close();
    apply({ type: 'chartData', slide: slideOf(fig), fig, data: JSON.parse(JSON.stringify(nd)) });
    renderChart(fig);
    refreshCaches(slideOf(fig)); persistDraft();
    refresh();
  }, 'primary');
  box.append(json, bar, err);
  wrap.addEventListener('pointerdown', e => { if (e.target === wrap) close(); });
  document.body.appendChild(wrap);
}

// ---------- clavier ----------
function onKey(e) {
  const mod = e.metaKey || e.ctrlKey, k = e.key;
  if (k === 'Alt' && moveable) moveable.snappable = false; // Alt: free move, no snapping
  if (k === 'Shift' && moveable) moveable.keepRatio = true; // Shift: keep proportions
  if (mod && k.toLowerCase() === 's') { e.preventDefault(); H.save(); return; }
  if (editing) {
    if (k === 'Escape') editing.el.blur();
    return; // native Cmd+B / Cmd+I in text
  }
  if (e.target.closest && e.target.closest('input, textarea, .hs-panel')) return;
  if (document.body.classList.contains('hs-present')) {
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) { e.preventDefault(); go(1); }
    if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); go(-1); }
    if (k === 'Escape') present(false);
    return;
  }
  if (!mod && k.toLowerCase() === 'e') { H.toggleEdit(); return; }
  if (!mod && k.toLowerCase() === 'p') { present(true); return; }
  if (k === '?') { H.help(); return; }
  if (!editingMode()) return;
  if (mod && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(); return; }
  if (mod && k.toLowerCase() === 'b') { e.preventDefault(); bold(); return; }
  if (mod && k.toLowerCase() === 'i') { e.preventDefault(); italic(); return; }
  if (mod && k === ']') { e.preventDefault(); zorder(1); return; }
  if (mod && k === '[') { e.preventDefault(); zorder(-1); return; }
  if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); removeSel(); return; }
  if (k === 'Escape') { clearSel(); return; }
  if (k === 'Enter' && selection().length === 1) { e.preventDefault(); startText(selection()[0]); return; }
  const step = e.altKey ? 1 : GRID;
  const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (arrows[k] && selection().length) { e.preventDefault(); nudge(...arrows[k]); }
}

export function toggleEdit() {
  const on = !editingMode();
  if (!on) { stopText(); clearSel(); }
  document.body.classList.toggle('hs-editing', on);
  if (on) currentSlide();
  emit('editing', on);
  window.dispatchEvent(new Event('resize'));
}

export function init(handlers) {
  H = handlers;
  initMoveable();
  initSelecto();
  state.main.addEventListener('dblclick', e => {
    if (!editingMode()) return;
    const slide = e.target.closest('section.slide');
    if (!slide) return;
    let el = e.target;
    while (el && el.parentElement !== slide) el = el.parentElement;
    if (el && isContent(el)) startText(el, e);
  });
  document.addEventListener('paste', e => {
    if (!editing) return;
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  });
  addEventListener('pointerdown', () => { buttonDown = true; }, true);
  state.main.addEventListener('pointerdown', e => { const sl = e.target.closest('section.slide'); if (sl) setCurrent(sl); }, true);
  addEventListener('pointerup', () => { buttonDown = false; }, true);
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', e => {
    if (e.key === 'Alt' && moveable) moveable.snappable = true;
    if (e.key === 'Shift' && moveable) moveable.keepRatio = selection().length === 1 && selection()[0].tagName === 'IMG';
  });
  addEventListener('resize', refresh);
  addEventListener('scroll', refresh, { passive: true });
  // while scrolling (without selection), the slide at the centre of the screen becomes current
  let raf = 0;
  addEventListener('scroll', () => {
    if (raf || !editingMode() || editing || selection().length) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const mid = innerHeight / 2;
      const s = slides().find(x => { const r = x.getBoundingClientRect(); return r.top <= mid && r.bottom >= mid; });
      if (s) setCurrent(s);
    });
  }, { passive: true });
}
