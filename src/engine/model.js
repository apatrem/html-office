// V1 : état fondé sur le DOM, transactions et historique par instantanés HTML.
// La collaboration V2 nécessitera un modèle indépendant et des opérations sérialisables.

export const VERSION = typeof __ENGINE_VERSION__ === 'undefined' ? 'dev' : __ENGINE_VERSION__;
export {ECHARTS_URL,ECHARTS_INTEGRITY} from '../echarts.js';

export const state = {
  main: null,
  undo: [],
  redo: [],
  dirty: false,
  revision: 0,
  handle: null,
  bodyClass: '',
  current: null,
  listeners: {}
};

export function on(evt, fn) { (state.listeners[evt] ||= []).push(fn); }
export function emit(evt, arg) { (state.listeners[evt] || []).forEach(fn => fn(arg)); }

export const slides = () => [...state.main.querySelectorAll(':scope > section.slide')];
export const isContent = el => el && el.parentElement && el.parentElement.matches('section.slide') &&
  !el.hasAttribute('data-ui') && el.tagName !== 'ASIDE';
export const items = slide => [...slide.children].filter(isContent);
export const slideOf = el => el.closest('section.slide');

// ---------- identifiants stables ----------
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

// ---------- nettoyage (retire tout ce qui est d'exécution) ----------
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

// ---------- opérations ----------
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
  // Mutation générique d'éléments (classes de mise en forme, etc.)
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

// ---------- mise en forme : groupes de classes exclusives ----------
export const GROUPS = { fs: /^fs-/, ta: /^ta-/, c: /^c-/, bg: /^bg-/, bold: /^t-bold$/, italic: /^t-italic$/ };
export function setClass(el, group, cls) {
  [...el.classList].filter(c => GROUPS[group].test(c)).forEach(c => el.classList.remove(c));
  if (cls) el.classList.add(cls);
  if (el.getAttribute('class') === '') el.removeAttribute('class');
}
export const FORMAT_GROUPS = Object.keys(GROUPS);

// Nettoie le HTML produit par l'édition de texte : pas de style, pas de <font>,
// <span> seulement avec une classe de la charte.
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
// Fige la mise en page : chaque élément reçoit sa position calculée.
export function detach(slide) {
  if (slide.hasAttribute('data-detached')) return;
  // largeur et hauteur arrondies au pixel supérieur : un texte qui tenait juste ne doit pas passer à la ligne
  const list = items(slide).map(el => { const r = measure(slide, el); return { el, r: { ...r, w: Math.ceil(r.w - 0.01) + 1, h: Math.ceil(r.h - 0.01) } }; });
  slide.setAttribute('data-detached', '');
  list.forEach(({ el, r }) => setPos(el, r));
}

// ---------- opérations sur le deck (structure, pied de page) ----------
const deckState = () => ({ html: cleanMainHTML(), footer: state.main.dataset.footer || '' });
export function beginDeck() { return { before: deckState() }; }
export function commitDeck(tok) {
  const after = deckState();
  if (after.html === tok.before.html && after.footer === tok.before.footer) return false;
  state.undo.push({ deck: true, before: tok.before, after });
  if (state.undo.length > 200) state.undo.shift();
  state.redo = [];
  markDirty();
  emit('deck');
  return true;
}
export function applyDeck(fn) { const tok = beginDeck(); const r = fn(); commitDeck(tok); return r; }
function restoreDeck(d) {
  state.main.innerHTML = d.html;
  state.main.dataset.footer = d.footer;
  emit('deck');
}
export function nextSlideId() {
  let n = 0;
  slides().forEach(s => { const m = /^s(\d+)$/.exec(s.id); if (m) n = Math.max(n, +m[1]); });
  let id;
  do { id = 's' + String(++n).padStart(2, '0'); } while (document.getElementById(id));
  return id;
}
// Insère une slide (HTML d'une <section>) après `after` (ou en fin de deck) ; attribue les identifiants.
export function insertSlideHTML(html, after) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  const s = t.content.firstElementChild;
  s.id = nextSlideId();
  items(s).forEach(el => { el.dataset.id = newId(); });
  if (after) after.after(s); else state.main.appendChild(s);
  return s;
}

// ---------- annuler / rétablir ----------
export function undo() { step(state.undo, state.redo, 'before'); }
export function redo() { step(state.redo, state.undo, 'after'); }
function step(from, to, key) {
  const rec = from.pop();
  if (!rec) return;
  to.push(rec);
  if (rec.deck) restoreDeck(rec[key]); else replaceSlide(rec.id, rec[key]);
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

// ---------- état « modifié » et brouillon ----------
const draftKey = () => 'html-slides:' + location.pathname;
export const jsonForScript = value => JSON.stringify(value).replace(/</g, '\\u003c');
function draftState() {
  const main = cleanNode(state.main.cloneNode(true)); main.removeAttribute('style');
  return { format: 1, main: main.outerHTML, assets: usedAssets() };
}
export function persistDraft() {
  try { localStorage.setItem(draftKey(), JSON.stringify({ t: Date.now(), ...draftState() })); } catch (e) {
    emit('draft-error');
  }
}
export function markDirty() {
  state.revision++;
  state.dirty = true;
  emit('dirty', true);
  persistDraft();
}
export function markSaved(revision = state.revision) {
  if (revision !== state.revision) return false;
  state.dirty = false;
  emit('dirty', false);
  try { localStorage.removeItem(draftKey()); } catch (e) { /* rien */ }
  return true;
}
export function readDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(draftKey()) || 'null');
    if (d?.format === 1 && typeof d.main === 'string') {
      const current = draftState();
      return d.main !== current.main || JSON.stringify(d.assets) !== JSON.stringify(current.assets) ? d : null;
    }
    return d && typeof d.html === 'string' && d.html !== cleanMainHTML() ? d : null; // brouillons 0.4
  }
  catch (e) { return null; }
}
export function dropDraft() { try { localStorage.removeItem(draftKey()); } catch (e) { /* rien */ } }
export function restoreDraft(d) {
  if (d.format === 1) {
    const t = document.createElement('template'); t.innerHTML = d.main;
    const saved = t.content.firstElementChild;
    if (!saved?.matches('main#deck')) throw new Error('Brouillon invalide');
    [...state.main.attributes].filter(a => a.name !== 'style').forEach(a => state.main.removeAttribute(a.name));
    [...saved.attributes].forEach(a => state.main.setAttribute(a.name, a.value));
    state.main.innerHTML = saved.innerHTML;
    document.getElementById('assets').textContent = jsonForScript(d.assets || {});
  } else state.main.innerHTML = d.html;
  state.undo = []; state.redo = []; state.current = null;
  ensureIds(); emit('deck'); markDirty();
}

// ---------- ressources (images, polices) ----------
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

// ---------- sérialisation ----------
// On enregistre uniquement les nœuds d'origine du fichier (capturés au chargement) :
// tout ce que le moteur, Moveable ou Selecto ajoutent à la page en est exclu.
export function captureShell() {
  state.shell = {
    html: [...document.documentElement.attributes].map(a => [a.name, a.value]),
    head: [...document.head.children],
    body: [...document.body.children]
  };
}
const attrs = list => list.map(([n, v]) => ` ${n}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('');
export function serialize(refreshCaches) {
  if (refreshCaches) refreshCaches();
  const sh = state.shell;
  const head = sh.head.filter(n => n.isConnected).map(n => n.outerHTML).join('\n');
  // ressources : on n'enregistre que celles encore utilisées (les autres restent en mémoire pour l'annulation)
  const body = sh.body.filter(n => n.isConnected).map(n => {
    if (n.id === 'assets') {
      return `<script id="assets" type="application/json">${jsonForScript(usedAssets())}</script>`;
    }
    if (n !== state.main) return n.outerHTML;
    const c = cleanNode(n.cloneNode(true));
    c.removeAttribute('style');
    return c.outerHTML;
  }).join('\n');
  const bodyAttrs = state.bodyClass ? attrs([['class', state.bodyClass]]) : '';
  return `<!doctype html>\n<html${attrs(sh.html)}>\n<head>\n${head}\n</head>\n<body${bodyAttrs}>\n${body}\n</body>\n</html>\n`;
}
