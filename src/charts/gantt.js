// Gantt: sequence of activities. tasks: [{name, start, end, group, highlight}]
// Dates 'YYYY-MM' (whole month) or 'YYYY-MM-DD'. Without an end (or end = start): milestone.
import { base, req, isObject, records } from './common.js';

const MOIS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function parse(s, end) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!m) return null;
  const y = +m[1], mo = +m[2] - 1;
  const day = m[3] ? +m[3] : 1;
  const date = new Date(0); date.setUTCFullYear(y, mo, day);
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo || date.getUTCDate() !== day) return null;
  if (m[3]) return date.getTime() + (end ? 864e5 : 0);
  return end ? Date.UTC(y, mo + 1, 1) : Date.UTC(y, mo, 1);
}

export default {
  label: 'Gantt',
  validate(d) {
    const err = req(d, ['tasks']);
    if (!isObject(d)) return err;
    records(d, 'tasks', err).forEach((x, i) => {
      if (parse(x.start) === null) err.push(`task ${i + 1}: invalid start (YYYY-MM or YYYY-MM-DD)`);
      if (x.end && parse(x.end, true) === null) err.push(`task ${i + 1}: invalid end`);
      if (x.end && parse(x.start) !== null && parse(x.end, true) !== null && parse(x.end, true) <= parse(x.start)) err.push(`task ${i + 1}: end precedes start`);
    });
    return err;
  },
  table: {
    columns: () => ['Task', 'Start', 'End', 'Group'],
    toRows: d => (d.tasks || []).map(x => [x.name, x.start, x.end || '', x.group || '']),
    fromRows: (rows, _h, d) => ({ ...d, tasks: rows.map(r => {
      const x = { name: r[0], start: String(r[1]).trim() };
      if (String(r[2]).trim()) x.end = String(r[2]).trim();
      if (String(r[3]).trim()) x.group = String(r[3]).trim();
      return x;
    }) })
  },
  toOption(d, t) {
    const groups = [...new Set(d.tasks.map(x => x.group).filter(Boolean))];
    const pal = [t.acc, t.mid, t.lig, t.t2];
    const rows = d.tasks.map((x, i) => {
      const s = parse(x.start), e = x.end && x.end !== x.start ? parse(x.end, true) : null;
      const col = x.highlight ? t.alert : (groups.length ? pal[groups.indexOf(x.group) % pal.length] : t.acc);
      return { i, s, e, col, name: x.name };
    });
    const lo = Math.min(...rows.map(r => r.s)), hi = Math.max(...rows.map(r => r.e || r.s));
    return {
      ...base(t),
      grid: { left: 8, right: 24, top: 32, bottom: 8, containLabel: true },
      legend: groups.length ? { top: 0, right: 0, icon: 'rect', itemWidth: 10, itemHeight: 10, textStyle: { color: t.t2 }, data: groups } : undefined,
      xAxis: { type: 'time', position: 'top', min: lo, max: hi, splitNumber: 8,
        axisLine: { lineStyle: { color: t.ink } }, axisTick: { show: false },
        axisLabel: { color: t.t2, fontSize: 12, formatter: v => { const dt = new Date(v); return `${MOIS[dt.getUTCMonth()]} ${String(dt.getUTCFullYear()).slice(2)}`; } },
        splitLine: { show: true, lineStyle: { color: t.bd, type: 'dashed' } } },
      yAxis: { type: 'category', inverse: true, data: d.tasks.map(x => x.name), axisTick: { show: false },
        axisLine: { show: false }, axisLabel: { color: t.ink, fontSize: 13 } },
      series: [
        { type: 'custom', silent: true,
          encode: { x: [1, 2], y: 0 },
          data: rows.map(r => [r.i, r.s, r.e ?? r.s, r.e ? 0 : 1]),
          renderItem(params, api) {
            const y = api.value(0), s = api.coord([api.value(1), y]), e = api.coord([api.value(2), y]);
            const h = Math.min(18, api.size([0, 1])[1] * 0.55);
            const col = rows[params.dataIndex].col;
            if (api.value(3)) {
              const r = h * 0.62;
              return { type: 'polygon', shape: { points: [[s[0], s[1] - r], [s[0] + r, s[1]], [s[0], s[1] + r], [s[0] - r, s[1]]] }, style: { fill: t.ink } };
            }
            return { type: 'rect', shape: { x: s[0], y: s[1] - h / 2, width: Math.max(2, e[0] - s[0]), height: h }, style: { fill: col } };
          } },
        ...groups.map((g, k) => ({ type: 'bar', name: g, data: [], itemStyle: { color: pal[k % pal.length] } }))
      ]
    };
  }
};
