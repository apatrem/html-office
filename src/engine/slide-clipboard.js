// Whole slides on the shared clipboard (ADR-013, V1-01). A slide is copied as the html-office
// envelope (kind "slide": its cleaned HTML and the images it uses), with simple HTML and an outline
// for other applications. A pasted slide is untrusted: it is parsed inert and rebuilt node by node
// from the format's own vocabulary, so it takes this deck's theme and nothing else from its source.
// Clipboard nodes are never inserted into the deck.
import { SCHEMA, LIMITS, ClipboardError, writeClipboard, parseInert } from '../../packages/shared/clipboard/index.mjs';
import { plainObject } from '../../packages/shared/clipboard/errors.mjs';
import { readData, previewOf } from '../../packages/shared/charts/index.mjs';
import { readChart, chartTable, sanitizeSVG, CHART_LIMITS } from '../../packages/shared/charts/clipboard.mjs';
import { FORMAT_VERSION, CONTENT_CLASSES, assetProblem } from '../format.js';
import { cleanNode, readAssets, jsonForScript, sanitize, setPos } from './model.js';
import { LAYOUTS, SHAPE_KEYS } from './templates.js';

// String lengths (UTF-16 code units) checked before parsing; an image is its base64 text.
export const SLIDE_LIMITS = { html: 4 * 2 ** 20, nodes: 20000, depth: 32, assets: 32, asset: 8 * 2 ** 20 };
const fail = message => { throw new ClipboardError(message); };
const HTML = 'http://www.w3.org/1999/xhtml';

// ---------- copying ----------
// For other applications: the slide's text as simple HTML (headings, paragraphs, lists and tables,
// without classes, styles, pictures or notes). A chart gives its title and its data table.
const PLAIN = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'b', 'i', 'strong', 'em', 'u', 's', 'sub', 'sup', 'small']);
const INLINE = new Set(['span', 'a', 'font', 'code', 'mark', 'abbr', 'cite', 'q']);
const escape = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
function chartPlain(fig) {
  const { data } = readData(fig), rows = chartTable(fig.dataset.type, data).rows;
  return (data.title ? `<p>${escape(data.title)}</p>` : '') + '<table>' + rows.map(row => '<tr>' + row.map(c => {
    const tag = c?.header ? 'th' : 'td';
    return `<${tag}>${escape(c?.text ?? '')}</${tag}>`;
  }).join('') + '</tr>').join('') + '</table>';
}
function plainHTML(node) {
  let out = '';
  for (const n of node.childNodes) {
    if (n.nodeType === 3) out += escape(n.data);
    if (n.nodeType !== 1) continue;
    const tag = n.localName;
    if (tag === 'br') out += '<br>';
    else if (tag === 'figure' && n.classList.contains('chart')) out += chartPlain(n);
    else if (tag === 'img') out += n.alt ? `<p>[Image: ${escape(n.alt)}]</p>` : '';
    else if (!/^(aside|script|style|svg|colgroup)$/.test(tag)) {
      const inner = plainHTML(n), spans = /^t[dh]$/.test(tag) ? (n.colSpan > 1 ? ` colspan="${n.colSpan}"` : '') + (n.rowSpan > 1 ? ` rowspan="${n.rowSpan}"` : '') : '';
      // a figure label under its figure (kpi) stays on its own line
      if (PLAIN.has(tag)) out += (tag === 'small' ? '<br>' : '') + `<${tag}${spans}>${inner}</${tag}>`;
      else out += INLINE.has(tag) || !inner.trim() || /<(p|h\d|ul|ol|table|blockquote)[ >]/.test(inner) ? inner : `<p>${inner}</p>`;
    }
  }
  return out;
}
// The same content as an outline: one line per block, "- " before list items, table rows as TSV.
function outline(html) {
  const lines = [];
  let line = '';
  const flush = () => { line = line.replace(/\s+/g, ' ').trim(); if (line && line !== '-') lines.push(line); line = ''; };
  const walk = node => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) line += n.data;
      else if (n.localName === 'br') flush();
      else if (n.localName === 'tr') { flush(); lines.push([...n.children].map(c => c.textContent.replace(/\s+/g, ' ').trim()).join('\t')); }
      else if (/^(p|h\d|li|blockquote|ul|ol|table|thead|tbody|tfoot)$/.test(n.localName)) { flush(); if (n.localName === 'li') line = '- '; walk(n); flush(); }
      else walk(n);
    }
  };
  walk(parseInert(html));
  flush();
  return lines.join('\n');
}

// Writes every flavour from one copy event; throws a ClipboardError when the slide cannot be copied.
// The deck is not touched: the drawn charts' previews are put in a copy of the slide, as a saved
// file holds them. A writer never produces what a reader refuses: the copy is read back first.
export function copySlide(data, slide) {
  const clone = cleanNode(slide.cloneNode(true)), live = [...slide.querySelectorAll('figure.chart')];
  clone.removeAttribute('id');
  clone.querySelectorAll('figure.chart').forEach((fig, i) => {
    const fresh = previewOf(live[i]);
    if (fresh) { fig.querySelector(':scope > svg.render')?.remove(); fig.appendChild(fresh); }
    const svg = fig.querySelector(':scope > svg.render');
    if (svg && svg.outerHTML.length > CHART_LIMITS.svg) svg.remove();
  });
  const all = readAssets(), assets = {};
  for (const img of clone.querySelectorAll('img[data-asset]')) {
    const id = img.dataset.asset, a = Object.hasOwn(all, id) ? all[id] : null;
    if (a && typeof a === 'object' && a.kind !== 'font') assets[id] = { type: a.type, data: a.data };
  }
  const html = clone.outerHTML;
  if (html.length > SLIDE_LIMITS.html) fail('the slide is too large to copy');
  const content = { html, ...(Object.keys(assets).length ? { assets } : {}) };
  readSlide(content);
  if (Object.values(assets).reduce((n, a) => n + a.data.length, 2 * html.length) > LIMITS.json - 2 ** 20) fail('the slide and its images are too large for the clipboard');
  const body = plainHTML(clone) || '<p>Slide</p>';
  return writeClipboard(data, { envelope: { schema: SCHEMA, kind: 'slide', source: { product: 'slides', format: FORMAT_VERSION }, slide: content },
    section: body, text: outline(body) });
}

// ---------- reading ----------
// Elements a slide's content is made of; any other gives way to what it holds (a div when it is a
// direct child of the slide and holds text), and these are left out with what they hold.
const TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'span', 'ul', 'ol', 'li', 'b', 'i', 'strong', 'em', 'u', 's', 'sub', 'sup', 'small',
  'br', 'hr', 'blockquote', 'code', 'pre', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col', 'figure', 'figcaption', 'img']);
const DROPPED = new Set(['script', 'style', 'template', 'title', 'noscript', 'iframe', 'object', 'applet', 'video', 'audio', 'canvas', 'select', 'textarea',
  'button', 'aside']);
const CLASSES = new Set(CONTENT_CLASSES.filter(c => c !== 'slide'));
const NOTES = ['notes', 'to-ai'];
const GEOMETRY = /^--([xywh])\s*:\s*(-?\d{1,5}(?:\.\d{1,3})?)$/;
function geometry(style) {
  const r = {};
  for (const part of (style || '').split(';')) { const m = GEOMETRY.exec(part.trim()); if (m) r[m[1]] = +m[2]; }
  return ['x', 'y', 'w', 'h'].every(k => k in r) ? r : null;
}
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// The slide member of an envelope as a new section built in this document, with the images it
// uses (`assets`, keyed as its img[data-asset] still are: the caller stores them and renames the
// references) and what to tell the user. Throws a ClipboardError when the paste must be refused:
// content over a limit, a malformed image, an invalid chart, or a newer format.
// preview: keep each chart's saved preview, rebuilt from the SVG allow-list with ids starting with
// `prefix` (ECharts is not there to draw it).
export function readSlide(slide, { source = {}, preview = false, prefix = 'p' } = {}) {
  if (parseInt(source.format, 10) > parseInt(FORMAT_VERSION, 10))
    fail(`the slide comes from a newer html-slides format (${source.format}): upgrade this deck's editor to paste it`);
  if (!plainObject(slide) || typeof slide.html !== 'string') fail('clipboard slide: no slide content');
  if (slide.html.length > SLIDE_LIMITS.html) fail('clipboard slide: the slide is too large');
  const given = slide.assets ?? {};
  if (!plainObject(given)) fail('clipboard slide: assets must be an object');
  const roots = [...parseInert(slide.html).childNodes].filter(n => n.nodeType === 1), src = roots[0];
  if (roots.length !== 1 || src.namespaceURI !== HTML || src.localName !== 'section' || !src.classList.contains('slide')) fail('clipboard slide: expected one slide');
  if (src.querySelectorAll('*').length > SLIDE_LIMITS.nodes) fail('clipboard slide: the slide holds too many elements');

  const out = document.createElement('section'), assets = new Map(), detached = src.hasAttribute('data-detached'), notices = [];
  let left = 0, images = 0, charts = 0;
  out.className = src.classList.contains('dark') ? 'slide dark' : 'slide';
  const layout = src.getAttribute('data-layout');
  if (layout !== null) {
    const known = LAYOUTS.some(([key]) => key === layout);
    out.dataset.layout = known ? layout : 'default';
    if (!known) notices.push(`Its layout "${layout.slice(0, 32)}" is unknown here: the default layout is used.`);
  }
  for (const flag of ['data-detached', 'data-nofoot']) if (src.hasAttribute(flag)) out.setAttribute(flag, '');

  const build = (n, depth, top) => {
    if (n.nodeType === 3) return top ? [] : [document.createTextNode(n.data)];
    if (n.nodeType !== 1) return [];
    if (depth > SLIDE_LIMITS.depth) fail('clipboard slide: the content is nested too deeply');
    const tag = n.localName, html = n.namespaceURI === HTML, note = top && html && tag === 'aside' && NOTES.some(c => n.classList.contains(c));
    if (!html || DROPPED.has(tag) && !note) { left++; return []; }
    const known = TAGS.has(tag) || note;
    if (!known) left++;
    if (!known && !top) return [...n.childNodes].flatMap(c => build(c, depth + 1, false));
    if (!known && !n.textContent.trim()) return [];
    const el = document.createElement(known ? tag : 'div');
    for (const c of n.classList) if (CLASSES.has(c) && (note || !NOTES.includes(c))) el.classList.add(c);
    if (top && detached && !note) { const r = geometry(n.getAttribute('style')); if (r) setPos(el, r); }
    if (el.classList.contains('shape')) {
      const shape = n.getAttribute('data-shape'), ok = SHAPE_KEYS.includes(shape);
      el.dataset.shape = ok ? shape : 'rect';
      if (!ok) left++;
    }
    if (tag === 'td' || tag === 'th') for (const name of ['colspan', 'rowspan']) {
      const v = n.getAttribute(name)?.trim();
      if (v && /^[1-9]\d{0,2}$/.test(v)) el.setAttribute(name, v);
    }
    if (tag === 'col' && /^([1-9]\d?|100)$/.test(n.getAttribute('data-width') ?? '')) el.setAttribute('data-width', n.getAttribute('data-width'));
    if (tag === 'img') {
      const id = n.getAttribute('data-asset');
      if (!id || !Object.hasOwn(given, id)) { images++; return []; }
      const a = given[id];
      if (assetProblem(id, a) || a.kind === 'font') fail('clipboard slide: an image is malformed');
      if (a.data.length > SLIDE_LIMITS.asset) fail(`clipboard slide: an image is larger than ${Math.round(SLIDE_LIMITS.asset * 3 / 4 / 2 ** 20)} MB`);
      assets.set(id, { type: a.type, data: a.data });
      if (assets.size > SLIDE_LIMITS.assets) fail(`clipboard slide: more than ${SLIDE_LIMITS.assets} images`);
      el.dataset.asset = id;
      el.alt = (n.getAttribute('alt') ?? '').slice(0, 2000);
      return [el];
    }
    if (tag === 'figure' && el.classList.contains('chart')) {
      const kids = [...n.children], script = kids.find(c => c.localName === 'script' && c.getAttribute('type') === 'application/json');
      let data;
      try { data = JSON.parse(script.textContent); } catch (e) { fail('clipboard slide: a chart has no readable data'); }
      const svg = preview ? kids.find(c => c.localName === 'svg' && c.classList.contains('render'))?.outerHTML : null;
      const chart = readChart({ type: n.getAttribute('data-type'), data, ...(svg ? { svg } : {}) });
      el.dataset.type = chart.type;
      const json = el.appendChild(document.createElement('script'));
      json.type = 'application/json';
      json.textContent = jsonForScript(chart.data);
      const shown = chart.svg && sanitizeSVG(chart.svg, { prefix: `${prefix}${(charts++).toString(36)}-` });
      if (shown) el.appendChild(shown);
      return [el];
    }
    for (const c of n.childNodes) el.append(...build(c, depth + 1, false));
    return [el];
  };
  for (const n of src.childNodes) {
    if (n.nodeType === 3 && n.data.trim()) left++;
    for (const el of build(n, 1, true)) { sanitize(el); out.appendChild(el); }
  }
  if (images) notices.push(`${count(images, 'image was', 'images were')} not carried over.`);
  if (left) notices.push(`${count(left, 'item', 'items')} outside the slide format ${left === 1 ? 'was' : 'were'} simplified or left out.`);
  return { node: out, assets, notices };
}
