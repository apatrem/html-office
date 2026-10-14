// Chart rendering: ECharts (CDN, pinned version) when available, otherwise the cached SVG.
import { ECHARTS_URL, ECHARTS_INTEGRITY } from './model.js';
import column from '../charts/column.js';
import hbar from '../charts/hbar.js';
import stacked from '../charts/stacked.js';
import line from '../charts/line.js';
import waterfall from '../charts/waterfall.js';
import bubble from '../charts/bubble.js';
import gantt from '../charts/gantt.js';

export const registry = { column, hbar, stacked, line, waterfall, bubble, gantt };
const instances = new WeakMap();
let loading = null;

export function theme() {
  const cs = getComputedStyle(document.documentElement);
  const g = n => cs.getPropertyValue('--' + n).trim();
  return { ink: g('ink'), acc: g('acc'), mid: g('mid'), lig: g('lig'), alert: g('alert'), t2: g('t2'),
    bd: g('bd'), w: g('bg') || '#fff', font: g('font') || 'Arial, sans-serif' };
}

export function echartsReady() { return !!window.echarts; }

export function loadECharts(timeout = 8000) {
  if (window.echarts) return Promise.resolve(window.echarts);
  if (loading) return loading;
  loading = new Promise(resolve => {
    const s = document.createElement('script');
    s.integrity = ECHARTS_INTEGRITY;
    s.crossOrigin = 'anonymous';
    s.src = ECHARTS_URL;
    s.setAttribute('data-ui', '');
    s.onload = () => resolve(window.echarts || null);
    s.onerror = () => resolve(null);
    setTimeout(() => resolve(window.echarts || null), timeout);
    document.head.appendChild(s);
  });
  return loading;
}

export function readData(fig) {
  const s = fig.querySelector(':scope > script[type="application/json"]');
  if (!s) return { error: 'Missing JSON data' };
  try { return { data: JSON.parse(s.textContent) }; } catch (e) { return { error: 'Invalid JSON: ' + e.message }; }
}

export function validate(fig) {
  const def = registry[fig.dataset.type];
  if (!def) return [`Unknown chart type "${fig.dataset.type}"`];
  const { data, error } = readData(fig);
  if (error) return [error];
  return def.validate(data);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  e.setAttribute('data-ui', '');
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function renderChart(fig) {
  disposeChart(fig);
  fig.querySelectorAll(':scope > [data-ui]').forEach(n => n.remove());
  const def = registry[fig.dataset.type];
  const { data, error } = readData(fig);
  const head = el('div', 'hs-chart-head');
  if (data && data.title) head.appendChild(el('p', 'exh', data.title));
  if (data && data.unit) head.appendChild(el('div', 'hs-unit', data.unit));
  fig.prepend(head);
  const plot = el('div', 'hs-plot');
  head.after(plot);
  const errs = error ? [error] : (def ? def.validate(data) : [`Unknown type "${fig.dataset.type}"`]);
  if (errs.length) {
    fig.classList.remove('live');
    plot.appendChild(el('div', 'hs-chart-msg', 'Invalid chart: ' + errs.join(' ; ')));
    return;
  }
  if (!window.echarts) {
    fig.classList.remove('live');
    if (!fig.querySelector(':scope > svg.render')) plot.appendChild(el('div', 'hs-chart-msg', 'Chart unavailable: ECharts not loaded (offline).'));
    else plot.remove();
    return;
  }
  fig.classList.add('live');
  try {
    const inst = window.echarts.init(plot, null, { renderer: 'svg' });
    inst.setOption(def.toOption(data, theme()));
    instances.set(fig, inst);
  } catch (e) {
    fig.classList.remove('live');
    plot.appendChild(el('div', 'hs-chart-msg', 'Rendering failed: ' + e.message));
  }
}

export function disposeChart(fig) {
  const inst = instances.get(fig);
  if (inst) { inst.dispose(); instances.delete(fig); }
}

export function resizeCharts(root) {
  root.querySelectorAll('figure.chart').forEach(fig => { const i = instances.get(fig); if (i) i.resize(); });
}

// Updates the cached SVG of every chart drawn by ECharts.
export function refreshCaches(root) {
  root.querySelectorAll('figure.chart.live').forEach(fig => {
    const svg = fig.querySelector(':scope > .hs-plot svg');
    if (!svg) return;
    const w = svg.getAttribute('width') || svg.clientWidth, h = svg.getAttribute('height') || svg.clientHeight;
    const c = svg.cloneNode(true);
    c.setAttribute('class', 'render');
    c.setAttribute('viewBox', `0 0 ${parseFloat(w)} ${parseFloat(h)}`);
    c.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    c.removeAttribute('width'); c.removeAttribute('height');
    c.removeAttribute('style');
    const old = fig.querySelector(':scope > svg.render');
    if (old) old.replaceWith(c); else fig.appendChild(c);
  });
}
