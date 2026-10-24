// Waterfall : pont entre deux valeurs.
// items: [{label, value, total}] — total:true = level bar (value optional), otherwise a change.
import { base, axisCat, axisVal, fmt, req, num, isObject, records, finite } from './common.mjs';

function compute(items) {
  let level = 0;
  return items.map((it, i) => {
    if (it.total) {
      if (it.value !== undefined && it.value !== null && it.value !== '') level = Number(it.value);
      return { ...it, i, base: 0, size: level, level, kind: 'total' };
    }
    const v = Number(it.value) || 0;
    const b = Math.min(level, level + v);
    level += v;
    return { ...it, i, base: b, size: Math.abs(v), level, delta: v, kind: v >= 0 ? 'up' : 'down' };
  });
}

export default {
  label: 'Waterfall',
  validate(d) {
    const err = req(d, ['unit', 'items']);
    if (!isObject(d)) return err;
    const list = records(d, 'items', err);
    if (!list.some(x => x.total === true)) err.push('At least one total bar required');
    list.forEach((x, i) => {
      if (x.total !== undefined && typeof x.total !== 'boolean') err.push(`bar ${i + 1}: total must be a boolean`);
      if (!(x.total === true && (x.value === undefined || x.value === null || x.value === '')) && !finite(x.value))
        err.push(`bar ${i + 1}: finite numeric value required`);
    });
    return err;
  },
  table: {
    columns: () => ['Label', 'Value', 'Total (y/n)'],
    toRows: d => (d.items || []).map(x => [x.label, x.value ?? '', x.total ? 'y' : 'n']),
    fromRows: (rows, _h, d) => ({ ...d, items: rows.map(r => {
      const total = /^(o|oui|y|yes|1|x)$/i.test(String(r[2]).trim());
      const it = { label: r[0], value: num(r[1]) };
      if (total) it.total = true;
      return it;
    }) })
  },
  toOption(d, t) {
    const rows = compute(d.items);
    const upBad = d.increase !== 'good';
    const colOf = r => r.kind === 'total' ? (r.i === 0 ? t.mid : t.acc)
      : (r.kind === 'up' ? (upBad ? t.alert : t.mid) : (upBad ? t.mid : t.alert));
    const labelOf = r => r.kind === 'total' ? fmt(r.level, d) : (r.delta > 0 ? '+' : '−') + fmt(Math.abs(r.delta), d);
    return {
      ...base(t),
      grid: { ...base(t).grid, top: 30 },
      xAxis: axisCat(t, { data: rows.map(r => r.label) }),
      yAxis: axisVal(t),
      series: [
        { type: 'bar', stack: 'w', silent: true, itemStyle: { color: 'transparent' }, data: rows.map(r => r.base), barWidth: '56%' },
        { type: 'bar', stack: 'w', barWidth: '56%',
          data: rows.map(r => ({ value: r.size, itemStyle: { color: colOf(r) },
            label: { show: true, position: 'top', fontWeight: 700, fontSize: 13,
              color: r.kind === 'total' ? t.ink : colOf(r), formatter: () => labelOf(r) } })) },
        { type: 'custom', silent: true, z: 1,
          data: rows.slice(0, -1).map(r => [r.i, r.level]),
          renderItem(params, api) {
            const i = api.value(0), lv = api.value(1);
            const a = api.coord([i, lv]), b = api.coord([i + 1, lv]);
            const w = api.size([1, 0])[0] * 0.28;
            return { type: 'line', shape: { x1: a[0] + w, y1: a[1], x2: b[0] - w, y2: b[1] },
              style: { stroke: t.bd, lineWidth: 1, lineDash: [3, 3] } };
          } }
      ]
    };
  }
};
