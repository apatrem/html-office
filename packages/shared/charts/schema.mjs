// Strict chart schemas (ADR-013 §4): an allow-list of fields and types per chart type, checked recursively.
// Chart JSON from another document (clipboard) must pass strictValidate; decks keep using validate.
import { registry } from './index.mjs';

// Kept out of the type modules so the Slides engine bundle does not carry them.
const shared = { title: 'string', unit: 'string', decimals: 'integer', prefix: 'string', suffix: 'string',
  highlight: { any: ['integer', 'string'] } };
const category = { ...shared, categories: { array: 'string' },
  series: { array: { object: { name: 'string', values: { array: { any: ['number', 'null'] } } } } } };

export const schemas = {
  column: { object: category },
  hbar: { object: category },
  stacked: { object: { ...category, percent: 'boolean', horizontal: 'boolean', totals: 'boolean' } },
  line: { object: { ...category, labels: { enum: ['last', 'all', 'none'] }, scale: 'boolean' } },
  waterfall: { object: { ...shared, increase: { enum: ['good', 'bad'] },
    items: { array: { object: { label: 'string', value: { any: ['number', 'null', { enum: [''] }] }, total: 'boolean' } } } } },
  bubble: { object: { ...shared, xLabel: 'string', yLabel: 'string', xUnit: 'string', yUnit: 'string', xRef: 'number', yRef: 'number',
    highlight: { any: ['integer', 'string', { array: { any: ['integer', 'string'] } }] },
    points: { array: { object: { name: 'string', x: 'number', y: 'number', size: 'number' } } } } },
  gantt: { object: { ...shared,
    tasks: { array: { object: { name: 'string', start: 'string', end: 'string', group: 'string', highlight: 'boolean' } } } } }
};

// A spec is 'string' | 'number' (finite) | 'integer' | 'boolean' | 'null',
// { array: spec }, { object: { field: spec } } (no other field allowed), { any: [spec] } or { enum: [values] }.
function matches(v, spec) {
  if (spec === 'string') return typeof v === 'string';
  if (spec === 'number') return typeof v === 'number' && Number.isFinite(v);
  if (spec === 'integer') return Number.isInteger(v);
  if (spec === 'boolean') return typeof v === 'boolean';
  if (spec === 'null') return v === null;
  if (spec.array) return Array.isArray(v);
  if (spec.object) return !!v && typeof v === 'object' && !Array.isArray(v);
  if (spec.any) return spec.any.some(s => matches(v, s));
  if (spec.enum) return spec.enum.includes(v);
  return false;
}

function describe(spec) {
  if (typeof spec === 'string') return spec === 'number' ? 'finite number' : spec;
  if (spec.array) return 'array';
  if (spec.object) return 'object';
  if (spec.any) return spec.any.map(describe).join(' or ');
  return spec.enum.map(v => JSON.stringify(v)).join(' | ');
}

function check(v, spec, path, err) {
  if (!matches(v, spec)) { err.push(`${path}: ${describe(spec)} required`); return; }
  if (spec.array) v.forEach((x, i) => check(x, spec.array, `${path}[${i}]`, err));
  else if (spec.object) {
    for (const [k, x] of Object.entries(v)) {
      const p = path ? `${path}.${k}` : k;
      if (!Object.hasOwn(spec.object, k)) err.push(`${p}: unknown field`);
      else if (x !== undefined) check(x, spec.object[k], p, err);
    }
  } else if (spec.any) {
    const s = spec.any.find(s => matches(v, s));
    if (s.array || s.object) check(v, s, path, err);
  }
}

export function checkSchema(type, data) {
  if (!Object.hasOwn(schemas, type)) return [`Unknown chart type "${type}"`];
  const spec = schemas[type];
  const err = [];
  check(data, spec, '', err);
  return err.map(e => (e.startsWith(':') ? 'Data' + e : e));
}

// The fields a type's table adapter writes; every other field is a chart-level option.
export const dataFields = { column: ['categories', 'series'], hbar: ['categories', 'series'], stacked: ['categories', 'series'],
  line: ['categories', 'series'], waterfall: ['items'], bubble: ['points'], gantt: ['tasks'] };

// Chart-level options alone, as a Data chart stores them beside its binding (ADR-013 §4).
export function checkOptions(type, options) {
  if (!Object.hasOwn(schemas, type)) return [`Unknown chart type "${type}"`];
  const fields = { ...schemas[type].object };
  for (const key of dataFields[type]) delete fields[key];
  const err = [];
  check(options, { object: fields }, '', err);
  return err.map(e => (e.startsWith(':') ? 'Options' + e : e));
}

// Schema first, then the type's own validation (required fields, ranges, dates).
export function strictValidate(type, data) {
  const err = checkSchema(type, data);
  return err.length ? err : registry[type].validate(data);
}
