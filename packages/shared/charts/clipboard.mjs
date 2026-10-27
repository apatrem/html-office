// Charts on the clipboard (ADR-013 §4): the envelope's chart member, its limits, the chart's data as
// a portable table, and the untrusted SVG preview rebuilt from an allow-list in the SVG namespace.
import { registry } from './index.mjs';
import { strictValidate } from './schema.mjs';
import { ClipboardError, plainObject } from '../clipboard/errors.mjs';
import { parseInert } from '../clipboard/read.mjs';

// Chart JSON and the pasted preview as string length (UTF-16 code units), and data points per chart.
export const CHART_LIMITS = { json: 2 ** 20, points: 10000, svg: 2 * 2 ** 20 };
const fail = message => { throw new ClipboardError(message); };

export function chartPoints(type, data) {
  if (data.categories) return (data.series || []).reduce((n, s) => n + (s.values?.length ?? 0), 0);
  return (data.items || data.points || data.tasks || []).length;
}

// The chart member of an envelope, validated whole: the type, the strict schema, then the type's own
// validation. Unknown members of `chart` are ignored, as in the envelope; a preview over its limit
// is dropped (the chart is redrawn from its data).
export function readChart(chart) {
  if (!plainObject(chart)) fail('clipboard chart: expected an object');
  const { type, data, svg } = chart;
  if (typeof type !== 'string' || !Object.hasOwn(registry, type)) fail(`clipboard chart: unknown type "${String(type).slice(0, 32)}"`);
  if (JSON.stringify(data ?? null).length > CHART_LIMITS.json) fail('clipboard chart: the chart data is too large');
  const errors = strictValidate(type, data);
  if (errors.length) fail(`clipboard chart: ${errors.slice(0, 3).join('; ')}`);
  if (chartPoints(type, data) > CHART_LIMITS.points) fail(`clipboard chart: more than ${CHART_LIMITS.points.toLocaleString('en-US')} data points`);
  return { type, data: JSON.parse(JSON.stringify(data)), svg: typeof svg === 'string' && svg.length <= CHART_LIMITS.svg ? svg : null };
}

// The chart's data as a portable table: the adapter's header row, then its rows; numbers are typed.
export function chartTable(type, data) {
  const t = registry[type].table;
  const cell = v => (v === '' || v === null || v === undefined ? null
    : typeof v === 'number' ? { text: String(v), value: { type: 'number', value: v } } : { text: String(v) });
  return { rows: [t.columns(data).map(text => ({ text: String(text), header: true })), ...t.toRows(data).map(row => row.map(cell))], headerRows: 1 };
}
export const chartText = (type, data) => {
  const table = chartTable(type, data);
  const quote = s => (/[\t\r\n"]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s);
  return [...(data.title ? [data.title] : []), ...table.rows.map(row => row.map(c => quote(c?.text ?? '')).join('\t'))].join('\n');
};

// ---------- the untrusted preview ----------
const SVG = 'http://www.w3.org/2000/svg';
const ELEMENTS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs',
  'clipPath', 'linearGradient', 'radialGradient', 'stop']);
const ATTRIBUTES = new Set(['id', 'viewBox', 'preserveAspectRatio', 'transform',
  'd', 'x', 'y', 'dx', 'dy', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'points',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-opacity', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'opacity', 'paint-order',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline',
  'clip-path', 'clipPathUnits', 'gradientUnits', 'gradientTransform', 'fx', 'fy', 'offset', 'stop-color', 'stop-opacity']);
const REFERENCE = new Set(['fill', 'stroke', 'clip-path']);
const MAX_NODES = 200000, MAX_DEPTH = 64, MAX_VALUE = 2 ** 20;
// Strict values for the font declarations ECharts writes in `style` on text (ADR-013 §4, X02c).
const SIZE = /^(\d{1,3}(?:\.\d{1,4})?)px$/, FAMILY = /^[A-Za-z0-9 ,'"-]{1,120}$/, WEIGHT = /^(normal|bold|[1-9]00)$/;
const COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*)?\)|none|transparent)$/;
const size = v => { const m = SIZE.exec(v); return m && +m[1] >= 1 && +m[1] <= 400 ? v : null; };
function fontStyle(style) {
  const out = {};
  for (const part of style.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    const name = part.slice(0, at).trim().toLowerCase(), value = part.slice(at + 1).trim();
    if (value.length > 200 || /url\(|expression|\\|@|\/\*|[<>]/i.test(value)) continue;
    if (name === 'font-size' && size(value)) out['font-size'] = value;
    else if (name === 'font-family' && FAMILY.test(value)) out['font-family'] = value;
    else if (name === 'font-weight' && WEIGHT.test(value)) out['font-weight'] = value;
    else if (name === 'fill' && COLOR.test(value)) out.fill = value;
    else if (name === 'font') {
      // [style] [weight] size[/line-height] family
      const m = /^(?:(?:normal|italic|oblique)\s+)?(?:(normal|bold|[1-9]00)\s+)?(\d{1,3}(?:\.\d{1,4})?px)(?:\/\S+)?\s+(.+)$/.exec(value);
      if (m && size(m[2]) && FAMILY.test(m[3])) Object.assign(out, { 'font-size': m[2], 'font-family': m[3], ...(m[1] ? { 'font-weight': m[1] } : {}) });
    }
  }
  return out;
}
const safeValue = (name, value) => {
  if (value.length > (name === 'd' || name === 'points' ? MAX_VALUE : 1000) || /[<>\\]/.test(value)) return false;
  if (name === 'fill' || name === 'stroke' || name === 'stop-color') return COLOR.test(value) || /^url\(#[\w-]{1,64}\)$/.test(value) && name !== 'stop-color';
  if (name === 'clip-path') return /^url\(#[\w-]{1,64}\)$/.test(value) || value === 'none';
  if (name === 'id') return /^[\w-]{1,64}$/.test(value);
  if (name === 'font-family') return FAMILY.test(value);
  return !/url\(|expression|@|\/\*|javascript:/i.test(value);
};

// Returns a new svg.render element built in this document, or null when nothing usable remains.
// Every id gets the per-paste `prefix`; url(#id) to an id of this SVG follows it, any other
// reference is removed.
export function sanitizeSVG(text, { prefix, parse = parseInert } = {}) {
  if (typeof text !== 'string' || text.length > CHART_LIMITS.svg) return null;
  const source = [...parse(text).childNodes].find(n => n.nodeType === 1);
  if (!source || source.localName !== 'svg' || source.namespaceURI !== SVG) return null;
  const allowed = n => n.nodeType === 1 && n.namespaceURI === SVG && ELEMENTS.has(n.localName);
  // ids first, so that references can be checked
  const ids = new Set(), stack = [[source, 0]];
  let count = 0;
  while (stack.length) {
    const [n, depth] = stack.pop();
    if (++count > MAX_NODES) return null;
    const id = n.getAttribute('id');
    if (id && safeValue('id', id)) ids.add(id);
    if (depth < MAX_DEPTH) for (const c of n.children) if (allowed(c)) stack.push([c, depth + 1]);
  }
  const rewrite = value => {
    const m = /^url\(#([\w-]{1,64})\)$/.exec(value);
    return m ? (ids.has(m[1]) ? `url(#${prefix}${m[1]})` : null) : value;
  };
  const build = (n, depth) => {
    const out = document.createElementNS(SVG, n.localName);
    for (const a of n.attributes) {
      if (a.namespaceURI || !ATTRIBUTES.has(a.name) || !safeValue(a.name, a.value)) continue;
      let value = a.name === 'id' ? prefix + a.value : a.value;
      if (REFERENCE.has(a.name) && (value = rewrite(value)) === null) continue;
      out.setAttribute(a.name, value);
    }
    if (n.localName === 'text' || n.localName === 'tspan') {
      const font = fontStyle(n.getAttribute('style') || '');
      for (const [k, v] of Object.entries(font)) out.setAttribute(k, v);
    }
    if (depth >= MAX_DEPTH) return out;
    for (const c of n.childNodes) {
      if (allowed(c)) out.appendChild(build(c, depth + 1));
      else if (c.nodeType === 3 && (n.localName === 'text' || n.localName === 'tspan')) out.appendChild(document.createTextNode(c.data));
    }
    return out;
  };
  const svg = build(source, 0);
  if (!svg.getAttribute('viewBox')) {
    const w = parseFloat(source.getAttribute('width')), h = parseFloat(source.getAttribute('height'));
    if (!(w > 0 && h > 0)) return null;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  for (const k of ['width', 'height']) svg.removeAttribute(k);
  svg.setAttribute('class', 'render');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  return svg;
}
