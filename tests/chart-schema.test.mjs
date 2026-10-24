// Strict chart schemas and lossless table adapters (ADR-013 §4, X03).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registry } from '../packages/shared/charts/index.mjs';
import { schemas, checkSchema, strictValidate } from '../packages/shared/charts/schema.mjs';
import { chartHTML } from '../src/engine/templates.js';

const json = html => [...html.matchAll(/<figure class="chart[^"]*" data-type="(\w+)"[^>]*>\s*<script type="application\/json">([\s\S]*?)<\/script>/g)]
  .map(m => [m[1], JSON.parse(m[2])]);

test('every chart type has a strict schema', () => {
  assert.deepEqual(Object.keys(schemas).sort(), Object.keys(registry).sort());
});

test('templates and the distributed example decks pass the strict schemas', () => {
  const charts = Object.keys(registry).flatMap(type => json(chartHTML(type)));
  for (const f of ['catalogue', 'community-garden'])
    charts.push(...json(fs.readFileSync(new URL(`../plugin/skills/html-slides/examples/${f}.html`, import.meta.url), 'utf8')));
  assert.ok(charts.length > 10);
  for (const [type, d] of charts) assert.deepEqual(strictValidate(type, d), [], `${type}: ${JSON.stringify(d)}`);
});

test('strict schemas reject unknown fields and wrong types at every depth', () => {
  const cat = { unit: 'h', categories: ['A'], series: [{ name: 'S', values: [1] }] };
  for (const [type, d, msg] of [
    ['column', { ...cat, colour: 'red' }, 'colour: unknown field'],
    ['column', { ...cat, title: 4 }, 'title: string required'],
    ['column', { ...cat, series: [{ name: 2, values: [1] }] }, 'series[0].name: string required'],
    ['column', { ...cat, series: [{ name: 'S', values: [1], color: '#f00' }] }, 'series[0].color: unknown field'],
    ['column', { ...cat, categories: [1] }, 'categories[0]: string required'],
    ['column', { ...cat, highlight: true }, 'highlight: integer or string required'],
    ['column', { ...cat, decimals: 1.5 }, 'decimals: integer required'],
    ['line', { ...cat, labels: 'some' }, 'labels: "last" | "all" | "none" required'],
    ['stacked', { ...cat, percent: 'yes' }, 'percent: boolean required'],
    ['hbar', { ...cat, percent: true }, 'percent: unknown field'],
    ['waterfall', { unit: 'h', items: [{ label: 'A', value: '3', total: true }] }, 'items[0].value: finite number or null or "" required'],
    ['waterfall', { unit: 'h', increase: 'up', items: [{ label: 'A', total: true }] }, 'increase: "good" | "bad" required'],
    ['bubble', { unit: 'h', xLabel: 'X', yLabel: 'Y', highlight: {}, points: [{ name: 'P', x: 1, y: 1, size: 1 }] }, 'highlight: integer or string or array required'],
    ['bubble', { unit: 'h', xLabel: 'X', yLabel: 'Y', highlight: [true], points: [{ name: 'P', x: 1, y: 1, size: 1 }] }, 'highlight[0]: integer or string required'],
    ['gantt', { tasks: [{ name: 'T', start: '2027-01', highlight: 'y' }] }, 'tasks[0].highlight: boolean required'],
    ['gantt', { tasks: [{ name: 'T', start: '2027-01', owner: 'Ann' }] }, 'tasks[0].owner: unknown field'],
    ['gantt', [], 'Data: object required'],
    ['pie', {}, 'Unknown chart type "pie"'],
    ['constructor', {}, 'Unknown chart type "constructor"'],
    ['__proto__', {}, 'Unknown chart type "__proto__"'],
    ['toString', {}, 'Unknown chart type "toString"']
  ]) assert.ok(strictValidate(type, d).includes(msg), `${type} ${JSON.stringify(d)} → ${JSON.stringify(strictValidate(type, d))}`);
  assert.deepEqual(checkSchema('column', { ...cat, title: undefined }), [], 'an undefined field is absent');
});

// One chart per type using every per-item field the type knows.
const full = {
  column: { title: 'T', unit: 'h', decimals: 0, prefix: '+', suffix: ' h', highlight: 1,
    categories: ['A', 'B', 'true'], series: [{ name: 'S1', values: [1, null, 2.5] }, { name: 'S2', values: [-3, 4, 0] }] },
  hbar: { unit: '%', categories: ['A', 'B'], series: [{ name: 'S', values: [0.125, 1e-7] }], highlight: 'B' },
  stacked: { unit: 'h', percent: true, horizontal: true, totals: false, categories: ['A'], series: [{ name: 'S1', values: [1] }, { name: 'S2', values: [null] }] },
  line: { unit: 'h', labels: 'all', scale: true, categories: ['Jan', 'Feb'], series: [{ name: 'S', values: [1, 2] }] },
  waterfall: { unit: 'h', increase: 'good', items: [{ label: 'Start', value: 20, total: true }, { label: 'Up', value: 6, total: false },
    { label: 'Down', value: -2.25 }, { label: 'End', total: true }] },
  bubble: { unit: 'h', xLabel: 'X', yLabel: 'Y', xUnit: 'd', yUnit: 'p', xRef: 3, yRef: 15, highlight: ['P1', 1],
    points: [{ name: 'P1', x: 2, y: 24, size: 12 }, { name: 'P2', x: -1, y: 0.5, size: 0 }] },
  gantt: { title: 'Plan', tasks: [{ name: 'Prepare', start: '2027-02', end: '2027-03-15', group: 'G1', highlight: true },
    { name: 'Milestone', start: '2027-06', highlight: false }, { name: 'Plant', start: '2027-04-01', end: '2027-05', group: ' G1 ' }, { name: 'Gap', start: '2027-07', group: ' ' }] }
};

test('table adapters round-trip every per-item field, from typed cells and from text cells', () => {
  assert.deepEqual(Object.keys(full).sort(), Object.keys(registry).sort());
  for (const [type, d] of Object.entries(full)) {
    assert.deepEqual(strictValidate(type, d), [], type);
    const { table } = registry[type];
    const headers = table.columns(d), rows = table.toRows(d);
    assert.ok(rows.every(r => r.length === headers.length), `${type}: one cell per column`);
    assert.deepEqual(table.fromRows(rows, headers, d), d, `${type}: typed cells`);
    const text = rows.map(r => r.map(v => String(v ?? '')));
    assert.deepEqual(table.fromRows(text, headers, d), d, `${type}: text cells`);
    // Chart-level options are not part of the table: an empty base keeps only what the rows carry.
    const bare = table.fromRows(rows, headers, {});
    assert.deepEqual(Object.keys(bare).filter(k => d[k] !== undefined && JSON.stringify(bare[k]) !== JSON.stringify(d[k])), [], type);
  }
});

test('Gantt keeps a task highlight through its table', () => {
  const { table } = registry.gantt;
  assert.deepEqual(table.columns(full.gantt), ['Task', 'Start', 'End', 'Group', 'Highlight (y/n)']);
  assert.deepEqual(table.toRows(full.gantt).map(r => r[4]), ['y', 'n', '', '']);
  const back = table.fromRows([['Prepare', '2027-02', '', '', 'yes'], ['Other', '2027-03', '', '', 'n'], ['Last', '2027-04', '', '', '']], [], {});
  assert.deepEqual(back.tasks, [{ name: 'Prepare', start: '2027-02', highlight: true }, { name: 'Other', start: '2027-03', highlight: false },
    { name: 'Last', start: '2027-04' }]);
  // Typed Boolean cells (Data bindings) read like y/n.
  assert.deepEqual(table.fromRows([['T', '2027-01', '', '', true], ['U', '2027-01', '', '', false]], [], {}).tasks.map(t => t.highlight), [true, false]);
  // The Slides data panel drops rows whose cells are all blank: an absent highlight adds no cell.
  assert.ok(table.toRows({ tasks: [{ name: 'T', start: '2027-01' }] })[0].slice(2).every(v => v === ''));
});

test('waterfall keeps a total without value absent instead of null', () => {
  const { table } = registry.waterfall;
  const back = table.fromRows([['End', '', 'y'], ['Gap', '', 'n'], ['Other', '', '']], [], {});
  assert.deepEqual(back.items, [{ label: 'End', total: true }, { label: 'Gap', total: false }, { label: 'Other' }]);
  assert.ok(registry.waterfall.validate({ unit: 'h', ...back }).includes('bar 2: finite numeric value required'));
});

test('equivalent spellings of a missing total value normalise to absent and draw the same chart', () => {
  const { table, toOption } = registry.waterfall, t = { ink: '#000', acc: '#f00', mid: '#0f0', lig: '#00f', alert: '#f0f', t2: '#666', bd: '#ccc', w: '#fff', font: 'Arial' };
  const draw = d => JSON.stringify(toOption(d, t));
  for (const value of [null, '']) {
    const d = { unit: 'h', items: [{ label: 'Start', value: 2, total: true }, { label: 'Up', value: 1 }, { label: 'End', value, total: true }] };
    assert.deepEqual(strictValidate('waterfall', d), []);
    const back = table.fromRows(table.toRows(d), table.columns(d), d);
    assert.deepEqual(back.items[2], { label: 'End', total: true });
    assert.equal(draw(back), draw(d));
  }
});

test('chart-level options exclude the fields the table adapter writes', async () => {
  const { checkOptions, dataFields } = await import('../packages/shared/charts/schema.mjs');
  assert.deepEqual(Object.keys(dataFields).sort(), Object.keys(registry).sort());
  assert.deepEqual(checkOptions('stacked', { title: 'T', unit: '%', percent: true }), []);
  assert.deepEqual(checkOptions('column', { categories: ['A'] }), ['categories: unknown field']);
  assert.deepEqual(checkOptions('gantt', { tasks: [] }), ['tasks: unknown field']);
  assert.deepEqual(checkOptions('line', 'x'), ['Options: object required']);
  assert.deepEqual(checkOptions('constructor', {}), ['Unknown chart type "constructor"']);
});
