// V1: DOM-based state, transactions and history as HTML snapshots.
// V2 collaboration will need an independent model and serialisable operations.

export const VERSION = typeof __ENGINE_VERSION__ === 'undefined' ? 'dev' : __ENGINE_VERSION__;
// Imported here first so the bundled engine keeps its module order.
export {ECHARTS_URL,ECHARTS_INTEGRITY} from '../../packages/shared/charts/echarts.mjs';
import { ACTIVE_TAGS, attributeProblem, assetProblem } from '../format.js';

export const state = {
  main: null,
  undo: [],
  redo: [],
  dirty: false,
  revision: 0,
  handle: null,
  bodyClass: '',
  current: null,
  base: '',
  savedBase: null,
  draftRevision: -1,
  listeners: {}
};

export function on(evt, fn) { (state.listeners[evt] ||= []).push(fn); }
export function emit(evt, arg) { (state.listeners[evt] || []).forEach(fn => fn(arg)); }

export const slides = () => [...state.main.querySelectorAll(':scope > section.slide')];
export const isContent = el => el && el.parentElement && el.parentElement.matches('section.slide') &&
  !el.hasAttribute('data-ui') && el.tagName !== 'ASIDE';
export const items = slide => [...slide.children].filter(isContent);
export const slideOf = el => el.closest('section.slide');

// ---------- stable identifiers ----------
let maxId = 0;
export function ensureIds() {
  for (const el of state.main.querySelectorAll('[data-id]')) {
    const m = /^e(\d+)$/.exec(el.dataset.id);
    if (m) maxId = Math.max(maxId, +m[1]);
  }
  slides().forEach((s, i) => {
    if (!s.id) s.id = 's' + String(i + 1).padStart(2, '0');
    items(s).forEach(el => { if (!el.dataset.id) el.dataset.id = newId(); });
  });
}
export const newId = () => 'e' + (++maxId);

// ---------- cleaning (removes everything that belongs to the runtime) ----------
export function cleanNode(root) {
  root.querySelectorAll('[data-ui]').forEach(n => n.remove());
  for (const el of [root, ...root.querySelectorAll('*')]) {
    el.removeAttribute('contenteditable');
    el.removeAttribute('spellcheck');
    if (el.classList) {
      el.classList.remove('live', 'hs-sel', 'hs-editing', 'hs-current', 'hs-focus');
      if (el.getAttribute('class') === '') el.removeAttribute('class');
    }
    if (el.matches && el.matches('img[data-asset]')) el.removeAttribute('src');
    if (el.matches?.('script[type="application/json"]')) el.textContent = el.textContent.replace(/</g, '\\u003c');
  }
  return root;
}
export function cleanSlideHTML(slide) { return cleanNode(slide.cloneNode(true)).outerHTML; }
export function cleanMainHTML() { return cleanNode(state.main.cloneNode(true)).innerHTML; }

// ---------- operations ----------
export function begin(slide) { return { slide, id: slide.id, before: cleanSlideHTML(slide) }; }
export function commit(tok) {
  const slide = state.main.querySelector('#' + CSS.escape(tok.id)) || tok.slide;
  const after = cleanSlideHTML(slide);
  if (after === tok.before) return false;
  state.undo.push({ id: tok.id, before: tok.before, after });
  if (state.undo.length > 200) state.undo.shift();
  state.redo = [];
  markDirty();
  emit('change', slide);
  return true;
}

const OPS = {
  detach(op) { detach(op.slide); },
  relayout(op) {
    op.slide.removeAttribute('data-detached');
    items(op.slide).forEach(el => { if (el.hasAttribute('style')) el.removeAttribute('style'); });
  },
  remove(op) { op.els.forEach(el => el.remove()); },
  duplicate(op) {
    if (!op.slide.hasAttribute('data-detached')) detach(op.slide);
    op.created = op.els.map(el => {
      const c = el.cloneNode(true);
      c.querySelectorAll('[data-ui]').forEach(n => n.remove());
      c.classList.remove('live', 'hs-sel');
      c.dataset.id = newId();
      setPos(c, { x: num(el, '--x') + 16, y: num(el, '--y') + 16, w: num(el, '--w'), h: num(el, '--h') });
      el.after(c);
      return c;
    });
  },
  zorder(op) {
    op.els.forEach(el => {
      if (op.dir > 0) { const n = nextContent(el); if (n) n.after(el); }
      else { const p = prevContent(el); if (p) p.before(el); }
    });
  },
  // Generic element mutation (formatting classes, etc.)
  mutate(op) { op.els.forEach(op.fn); },
  chartData(op) {
    const s = op.fig.querySelector(':scope > script[type="application/json"]');
    s.textContent = JSON.stringify(op.data);
  },
  positions(op) { op.list.forEach(({ el, r }) => setPos(el, r)); }
};

export function apply(op) {
  const tok = begin(op.slide);
  OPS[op.type](op);
  const changed = commit(tok);
  return changed ? op : null;
}

function nextContent(el) { let n = el.nextElementSibling; while (n && !isContent(n)) n = n.nextElementSibling; return n; }
function prevContent(el) { let n = el.previousElementSibling; while (n && !isContent(n)) n = n.previousElementSibling; return n; }

// ---------- formatting: groups of mutually exclusive classes ----------
export const GROUPS = { fs: /^fs-/, ta: /^ta-/, c: /^c-/, bg: /^bg-/, bold: /^t-bold$/, italic: /^t-italic$/ };
export function setClass(el, group, cls) {
  [...el.classList].filter(c => GROUPS[group].test(c)).forEach(c => el.classList.remove(c));
  if (cls) el.classList.add(cls);
  if (el.getAttribute('class') === '') el.removeAttribute('class');
}
export const FORMAT_GROUPS = Object.keys(GROUPS);

// Cleans the HTML produced by text editing: no style, no <font>,
// <span> only with a theme class.
const INLINE_CLASS = /^(c-(ink|acc|mid|alert|t2|bg)|hl|neg|t2)$/;
const unwrap = n => n.replaceWith(...n.childNodes);
export function sanitize(root) {
  root.querySelectorAll('*').forEach(n => {
    n.removeAttribute('style');
    if (n.tagName === 'FONT') return unwrap(n);
    if (n.tagName === 'SPAN') {
      const keep = [...n.classList].filter(c => INLINE_CLASS.test(c));
      if (!keep.length) return unwrap(n);
      n.className = keep.join(' ');
    }
  });
  root.querySelectorAll('span').forEach(sp => {
    if (!sp.textContent) sp.remove();
    else if (sp.childNodes.length === 1 && sp.firstChild.nodeType === 1 && sp.firstChild.tagName === 'SPAN') unwrap(sp);
  });
  root.querySelectorAll('b:empty, i:empty, strong:empty, em:empty').forEach(n => n.remove());
  root.normalize();
}

// ---------- positions ----------
export const num = (el, v) => parseFloat(el.style.getPropertyValue(v)) || 0;
export function getPos(el) { return { x: num(el, '--x'), y: num(el, '--y'), w: num(el, '--w'), h: num(el, '--h') }; }
export function setPos(el, r) {
  const R = v => Math.round(v);
  el.setAttribute('style', `--x:${R(r.x)};--y:${R(r.y)};--w:${R(Math.max(8, r.w))};--h:${R(Math.max(8, r.h))}`);
}
export function measure(slide, el) {
  const sr = slide.getBoundingClientRect(), k = sr.width / 1280, r = el.getBoundingClientRect();
  return { x: (r.left - sr.left) / k, y: (r.top - sr.top) / k, w: r.width / k, h: r.height / k };
}
// Freezes the layout: every element receives its computed position.
export function detach(slide) {
  if (slide.hasAttribute('data-detached')) return;
  // width and height rounded up to the pixel: text that just fitted must not wrap
  const list = items(slide).map(el => { const r = measure(slide, el); return { el, r: { ...r, w: Math.ceil(r.w - 0.01) + 1, h: Math.ceil(r.h - 0.01) } }; });
  slide.setAttribute('data-detached', '');
  list.forEach(({ el, r }) => setPos(el, r));
}

// ---------- deck operations (structure, footer, theme, font) ----------
// Deck attributes of main#deck recorded with the structure; absent is null.
const DECK_DATA = ['footer', 'theme', 'font'];
const deckState = () => ({ html: cleanMainHTML(), ...Object.fromEntries(DECK_DATA.map(k => [k, state.main.dataset[k] ?? null])) });
export function beginDeck() { return { before: deckState() }; }
export function commitDeck(tok) {
  const after = deckState();
  if (['html', ...DECK_DATA].every(k => after[k] === tok.before[k])) return false;
  state.undo.push({ deck: true, before: tok.before, after });
  if (state.undo.length > 200) state.undo.shift();
  state.redo = [];
  markDirty();
  emit('deck');
  return true;
}
export function applyDeck(fn) { const tok = beginDeck(); const r = fn(); commitDeck(tok); return r; }
// An attribute-only entry (theme, font, footer text) keeps the slides and the current slide.
function restoreDeck(d, attributesOnly) {
  if (!attributesOnly) state.main.innerHTML = d.html;
  for (const k of DECK_DATA) setDeckData(k, d[k]);
  emit('deck');
}
function setData(data, key, value) { if (value === null || value === undefined) delete data[key]; else data[key] = value; }
export const setDeckData = (key, value) => setData(state.main.dataset, key, value);
// The theme and font are stored on main#deck and mirrored on the root element, where the overlay
// rules apply (view.js), so that thumbnails, colour swatches and charts follow them too. The root
// attributes are runtime state: serialize() writes the root attributes the file was opened with.
export const look = () => (state.main.dataset.theme || '') + '/' + (state.main.dataset.font || '');
export function syncLook() {
  const root = document.documentElement.dataset;
  for (const k of ['theme', 'font']) setData(root, k, state.main.dataset[k] || null);
}
export function nextSlideId() {
  let n = 0;
  slides().forEach(s => { const m = /^s(\d+)$/.exec(s.id); if (m) n = Math.max(n, +m[1]); });
  let id;
  do { id = 's' + String(++n).padStart(2, '0'); } while (document.getElementById(id));
  return id;
}
// Inserts a slide (HTML of a <section>) after `after` (or at the end of the deck); assigns identifiers.
export function insertSlideHTML(html, after) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  const s = t.content.firstElementChild;
  s.id = nextSlideId();
  items(s).forEach(el => { el.dataset.id = newId(); });
  if (after) after.after(s); else state.main.appendChild(s);
  return s;
}

// ---------- undo / redo ----------
export function undo() { step(state.undo, state.redo, 'before'); }
export function redo() { step(state.redo, state.undo, 'after'); }
function step(from, to, key) {
  const rec = from.pop();
  if (!rec) return;
  to.push(rec);
  if (rec.deck) restoreDeck(rec[key], rec.before.html === rec.after.html); else replaceSlide(rec.id, rec[key]);
  markDirty();
}
export function replaceSlide(id, html) {
  const old = state.main.querySelector('#' + CSS.escape(id));
  if (!old) return;
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  const fresh = t.content.firstElementChild;
  old.replaceWith(fresh);
  emit('replaced', fresh);
}

// ---------- dirty state and draft ----------
const draftKey = () => 'html-slides:' + location.pathname;
export const jsonForScript = value => JSON.stringify(value).replace(/</g, '\\u003c');
function draftState() {
  const main = cleanNode(state.main.cloneNode(true)); main.removeAttribute('style');
  return { format: 1, main: main.outerHTML, assets: usedAssets() };
}
const draftFingerprint = d => fingerprint(d.main + JSON.stringify(d.assets));
// Fingerprint of the file as opened (cyrb53). A draft records the version it was made from,
// so a draft left by an earlier version of a file at the same path is recognised as foreign.
function fingerprint(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
export function captureBase() {
  state.base = draftFingerprint(draftState());
}
export function persistDraft() {
  try {
    localStorage.setItem(draftKey(), JSON.stringify({ t: Date.now(), base: state.base, savedBase: state.savedBase, ...draftState() }));
    state.draftRevision = state.revision;
  } catch (e) {
    state.draftRevision = -1;
    emit('draft-error');
  }
}
export function markDirty() {
  state.revision++;
  state.dirty = true;
  emit('dirty', true);
  persistDraft();
}
// `written` is the {main, assets} snapshot that serialize() put in the file, not the live DOM
// (which may have newer edits). The main HTML is parsed once more, as reopening the file would,
// so the fingerprint matches captureBase() on that file. The opened base is kept too: the picker
// may have saved a separate copy instead.
export function markSaved(revision = state.revision, written) {
  if (written) {
    const template = document.createElement('template');
    template.innerHTML = written.main;
    state.savedBase = draftFingerprint({ main: template.content.firstElementChild?.outerHTML ?? written.main, assets: written.assets });
  }
  if (revision !== state.revision) { persistDraft(); return false; }
  state.dirty = false;
  emit('dirty', false);
  try { localStorage.removeItem(draftKey()); } catch (e) { /* storage unavailable */ }
  return true;
}
// Download fallback: a copy was offered, but this file is unchanged. The draft is kept so that
// the edits can be restored if the download was cancelled or the copy is lost; without a stored
// draft for this revision the edits exist only in this tab, so the deck stays dirty.
export function markDownloaded(revision = state.revision) {
  if (revision !== state.revision || state.draftRevision !== revision) return false;
  state.dirty = false;
  emit('dirty', false);
  return true;
}
// Returns the stored draft when it differs from the open file. `foreign` is true when the draft
// was made from another version of the file at this path, and null when an earlier engine did not
// record which version it was made from.
export function readDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(draftKey()) || 'null');
    if (d?.format === 1 && typeof d.main === 'string') {
      const current = draftState();
      const differs = d.main !== current.main || JSON.stringify(d.assets) !== JSON.stringify(current.assets);
      const foreign = typeof d.base !== 'string' ? null : d.base !== state.base && d.savedBase !== state.base;
      return differs ? { ...d, foreign } : null;
    }
    return d && typeof d.html === 'string' && d.html !== cleanMainHTML() ? { ...d, foreign: null } : null; // 0.4 drafts
  }
  catch (e) { return null; }
}
export function dropDraft() { try { localStorage.removeItem(draftKey()); } catch (e) { /* storage unavailable */ } }
// Another local page can write this storage: a draft is untrusted input. It is parsed in an inert
// template and stripped of code and external resources before it reaches the document.
// Scripts and styles are removed in every namespace (SVG runs scripts and loads style URLs);
// title, meta and noscript only in HTML, so accessible SVG titles survive.
function scrubDraft(root) {
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const tag = el.localName.toLowerCase(), html = el.namespaceURI === 'http://www.w3.org/1999/xhtml';
    const chartData = tag === 'script' && el.getAttribute('type') === 'application/json' && el.parentElement?.matches('figure.chart');
    if (ACTIVE_TAGS.includes(tag) || ['script', 'style'].includes(tag) && !chartData || html && ['meta', 'title', 'noscript'].includes(tag) ||
      el.hasAttribute('data-ui')) {
      el.remove();
      continue;
    }
    for (const a of [...el.attributes])
      if (attributeProblem(a.name, a.value, html)) el.removeAttribute(a.name);
  }
}
const safeAssets = assets => Object.fromEntries(Object.entries(assets && typeof assets === 'object' ? assets : {})
  .filter(([k, a]) => !assetProblem(k, a)));
export function restoreDraft(d) {
  const t = document.createElement('template');
  t.innerHTML = d.format === 1 ? d.main : `<main id="deck">${d.html}</main>`;
  const saved = t.content.firstElementChild;
  if (!saved?.matches('main#deck')) throw new Error('Invalid draft');
  scrubDraft(saved);
  if (d.format === 1) {
    [...state.main.attributes].filter(a => a.name !== 'style').forEach(a => state.main.removeAttribute(a.name));
    [...saved.attributes].forEach(a => state.main.setAttribute(a.name, a.value));
    document.getElementById('assets').textContent = jsonForScript(safeAssets(d.assets));
  }
  // Move the scrubbed nodes themselves: serialising and parsing them again could produce a tree
  // that scrubDraft never inspected.
  state.main.replaceChildren(...saved.childNodes);
  state.undo = []; state.redo = []; state.current = null;
  ensureIds(); emit('deck'); markDirty();
}

// ---------- assets (images, fonts) ----------
export function readAssets() {
  const s = document.getElementById('assets');
  try { return s ? JSON.parse(s.textContent || '{}') : {}; } catch (e) { return {}; }
}
function usedAssets() {
  const used = new Set([...state.main.querySelectorAll('img[data-asset]')].map(i => i.dataset.asset));
  return Object.fromEntries(Object.entries(readAssets()).filter(([k, a]) => used.has(k) || a.kind === 'font'));
}
export function resolveAssets(root = document) {
  const assets = readAssets();
  root.querySelectorAll('img[data-asset]').forEach(img => {
    const a = assets[img.dataset.asset];
    if (a && a.data) img.src = `data:${a.type || 'image/png'};base64,${a.data}`;
  });
  if (root === document) {
    const css = Object.entries(assets).filter(([, a]) => a.kind === 'font')
      .map(([, a]) => `@font-face{font-family:"${a.family}";src:url(data:${a.type || 'font/woff2'};base64,${a.data});font-weight:${a.weight || 400};font-style:${a.style || 'normal'}}`).join('\n');
    if (css) { const st = document.createElement('style'); st.setAttribute('data-ui', ''); st.textContent = css; document.head.appendChild(st); }
  }
}

// ---------- serialisation ----------
// Only the original nodes of the file (captured on load) are saved:
// everything the engine, Moveable or Selecto add to the page is excluded.
export function captureShell() {
  state.shell = {
    html: [...document.documentElement.attributes].map(a => [a.name, a.value]),
    head: [...document.head.children],
    body: [...document.body.children]
  };
}
const attrs = list => list.map(([n, v]) => ` ${n}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('');
// `written`, when given, receives the cleaned main HTML and assets put in the file (see markSaved).
export function serialize(refreshCaches, written) {
  if (refreshCaches) refreshCaches();
  const sh = state.shell;
  const head = sh.head.filter(n => n.isConnected).map(n => n.outerHTML).join('\n');
  // assets: only those still in use are saved (the others stay in memory for undo)
  const assets = usedAssets();
  let main = '';
  const body = sh.body.filter(n => n.isConnected).map(n => {
    if (n.id === 'assets') {
      return `<script id="assets" type="application/json">${jsonForScript(assets)}</script>`;
    }
    if (n !== state.main) return n.outerHTML;
    const c = cleanNode(n.cloneNode(true));
    c.removeAttribute('style');
    return main = c.outerHTML;
  }).join('\n');
  if (written) Object.assign(written, { main, assets });
  const bodyAttrs = state.bodyClass ? attrs([['class', state.bodyClass]]) : '';
  return `<!doctype html>\n<html${attrs(sh.html)}>\n<head>\n${head}\n</head>\n<body${bodyAttrs}>\n${body}\n</body>\n</html>\n`;
}
