import test from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../packages/shared/charts/index.mjs';
import { chartHTML } from '../src/engine/templates.js';
import { seriesColor } from '../packages/shared/charts/types/common.mjs';
import { CHARTES } from '../packages/shared/themes/chartes.mjs';
import * as echarts from 'echarts';

for (const [type, def] of Object.entries(registry)) {
  test(`${type}: valid example and invalid roots`, () => {
    const d = JSON.parse(chartHTML(type).match(/<script[^>]*>(.*?)<\/script>/s)[1]);
    assert.deepEqual(def.validate(d), []);
    for (const bad of [null, [], 'wrong', 4]) assert.ok(def.validate(bad).length);
  });
}
test('category charts reject types, empty arrays and non-numeric values; null is an explicit gap', () => {
  const v = registry.column.validate;
  for (const d of [
    {unit:'€', categories:'wrong', series:'wrong'},
    {unit:'€', categories:[], series:[]},
    {unit:'€', categories:['A'], series:[null]},
    {unit:'€', categories:['A'], series:[{values:['wrong']}]},
    {unit:'€', categories:['A'], series:[{values:[Infinity]}]}
  ]) assert.ok(v(d).length, JSON.stringify(d));
  assert.deepEqual(v({unit:'€',categories:['A'],series:[{values:[null]}]}), []);
});
test('Gantt rejects impossible dates and reversed intervals', () => {
  for (const task of [null, {start:'2026-99-99'}, {start:'2026-02-30'}, {start:'2026-04',end:'2026-03'}])
    assert.ok(registry.gantt.validate({tasks:[task]}).length);
  assert.deepEqual(registry.gantt.validate({tasks:[{start:'2024-02-29',end:'2024-02-29'}]}), []);
});
test('waterfall and bubbles reject missing or invalid numbers', () => {
  assert.ok(registry.waterfall.validate({unit:'€',items:[{total:true,value:'wrong'}]}).length);
  assert.ok(registry.waterfall.validate({unit:'€',items:[{total:true},{}]}).length);
  assert.ok(registry.bubble.validate({unit:'€',xLabel:'X',yLabel:'Y',points:[{x:null,y:1,size:2}]}).length);
  assert.ok(registry.bubble.validate({unit:'€',xLabel:'X',yLabel:'Y',points:[null]}).length);
});

// SVG output, drawn by the pinned ECharts in server-side mode: bars and legend swatches carry their series index.
const charteTheme = c => ({ ink: c.ink, acc: c.acc, mid: c.mid, lig: c.lig, alert: c.alert, t2: c.t2, bd: c.bd, w: c.bg, font: 'Arial' });
function svgOf(type, data, theme = charteTheme(CHARTES.blue), width = 680, height = 300) {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height });
  try { chart.setOption(registry[type].toOption(data, theme)); return chart.renderToSVGString(); } finally { chart.dispose(); }
}
const fills = (svg, kind) => [...svg.matchAll(/<path [^>]*>/g)]
  .map(([tag]) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(a => [a[1], a[2]])))
  .filter(a => a.ecmeta_ssr_type === kind && a.fill !== 'transparent' && a.fill !== 'none')
  .map(a => ({ series: Number(a.ecmeta_series_index), fill: a.fill }));
// Full month names are wider than 56 px: a wrapped label would not show as one text.
const months = Array.from({ length: 24 }, (_, i) => `${['January','February','March','April','May','June','July','August','September','October','November','December'][i % 12]} ${2025 + Math.floor(i / 12)}`);
const shown = (svg, categories) => categories.filter(c => svg.includes(`>${c}</text>`));
const monthly = { unit: '€k', categories: months, series: [{ name: 'Revenue', values: months.map((_, i) => 100 + i) }, { name: 'Costs', values: months.map((_, i) => 80 + i) }] };

for (const type of ['column', 'line']) {
  test(`${type}: 24 monthly labels are thinned at a regular step, all kept on an axis wide enough`, () => {
    const labels = shown(svgOf(type, monthly), months);
    assert.ok(labels.length > 1 && labels.length < 24, `${labels.length} of 24 labels`);
    const idx = labels.map(l => months.indexOf(l)), step = idx[1] - idx[0];
    assert.equal(idx[0], 0);
    assert.ok(idx.every((x, k) => x === k * step), `regular step: ${idx}`);
    assert.deepEqual(shown(svgOf(type, monthly, undefined, 3000), months), months);
  });
}
test('long labels on a long horizontal axis are cut to one line, keeping the plot', () => {
  const names = Array.from({ length: 13 }, (_, i) => `Revenue for product ${i + 1} sold to Western Europe customers through independent retail distributors`);
  const data = { unit: '€k', categories: names, series: [{ name: 'A', values: names.map((_, i) => 10 + i) }, { name: 'B', values: names.map((_, i) => 5 + i) }] };
  for (const [type, d] of [['hbar', data], ['stacked', { ...data, horizontal: true }]]) {
    const svg = svgOf(type, d, undefined, 544, 400);
    const bars = [...svg.matchAll(/<path d="M([\d.]+) [\d.]+l([\d.]+) 0[^"]*"[^>]*ecmeta_ssr_type="chart"/g)].map(m => [Number(m[1]), Number(m[2])]);
    assert.ok(bars.length && bars.every(([x, w]) => x >= 0 && x + w <= 544), `${type}: bars inside the chart`);
    assert.ok(Math.min(...bars.map(([x]) => x)) <= 160, `${type}: label gutter at most 160 px`);
    assert.ok(!names.some(c => svg.includes(`>${c}</text>`)) && svg.includes('...</text>'), `${type}: labels cut with an ellipsis`);
  }
});
test('up to 12 categories every label is kept and wrapped to its share of the axis, as before', () => {
  const t = charteTheme(CHARTES.blue);
  for (let n = 1; n <= 12; n++) {
    const { axisLabel } = registry.column.toOption({ unit: '€', categories: months.slice(0, n), series: [{ values: Array(n).fill(1) }] }, t).xAxis;
    assert.equal(axisLabel.interval, 0);
    assert.equal(axisLabel.width, Math.max(56, Math.floor(680 / n) - 12));
    assert.equal(axisLabel.overflow, 'break');
  }
  const year = { unit: '€k', categories: months.slice(0, 12).map(m => m.slice(0, 3) + m.slice(-5)), series: [{ name: 'A', values: Array(12).fill(1) }] };
  for (const type of ['column', 'line']) assert.deepEqual(shown(svgOf(type, year), year.categories), year.categories);
});
test('legend swatches have the colours of their series in every built-in charte', () => {
  const data = { unit: '€k', categories: ['North', 'South', 'East'],
    series: [{ name: 'Y1', values: [1, 2, 3] }, { name: 'Y2', values: [2, 3, 4] }, { name: 'Y3', values: [3, 1, 2] }] };
  for (const [name, charte] of Object.entries(CHARTES)) {
    const t = charteTheme(charte);
    for (const [type, d] of [['column', data], ['hbar', data], ['stacked', data], ['stacked', { ...data, horizontal: true }]]) {
      const svg = svgOf(type, d, t), legend = fills(svg, 'legend'), bars = fills(svg, 'chart');
      assert.equal(legend.length, 3, `${name} ${type}: three swatches`);
      for (const { series, fill } of legend) {
        assert.equal(fill, seriesColor(t, series), `${name} ${type}: swatch ${series}`);
        const own = bars.filter(b => b.series === series);
        assert.ok(own.length && own.every(b => b.fill === fill), `${name} ${type}: bars of series ${series} are ${fill}`);
      }
    }
  }
});
