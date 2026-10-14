import test from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../src/engine/charts.js';
import { chartHTML } from '../src/engine/templates.js';

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
