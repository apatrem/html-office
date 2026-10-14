// Bulles : corrélation à trois dimensions (x, y, taille).
import { base, fmt, req, num, isObject, records, finite } from './common.js';

export default {
  label: 'Bubbles',
  validate(d) {
    const err = req(d, ['unit', 'points', 'xLabel', 'yLabel']);
    if (!isObject(d)) return err;
    records(d, 'points', err).forEach((p, i) => {
      if (![p.x, p.y, p.size].every(finite) || p.size < 0) err.push(`point ${i + 1}: x, y and size must be finite numbers; size >= 0`);
    });
    for (const k of ['xRef', 'yRef']) if (d[k] !== undefined && !finite(d[k])) err.push(`${k}: finite number required`);
    return err;
  },
  table: {
    columns: () => ['Name', 'X', 'Y', 'Size'],
    toRows: d => (d.points || []).map(p => [p.name, p.x, p.y, p.size]),
    fromRows: (rows, _h, d) => ({ ...d, points: rows.map(r => ({ name: r[0], x: num(r[1]), y: num(r[2]), size: num(r[3]) })) })
  },
  toOption(d, t) {
    const max = Math.max(...d.points.map(p => Math.abs(Number(p.size)) || 0), 1);
    const hl = d.highlight;
    const isHl = (p, i) => hl !== undefined && (Array.isArray(hl) ? hl.includes(p.name) || hl.includes(i) : hl === i || hl === p.name);
    const xs = d.points.map(p => Number(p.x)), x0 = Math.min(...xs), x1 = Math.max(...xs);
    const ax = (name, unit) => ({
      type: 'value', scale: true, name: unit ? `${name} (${unit})` : name, nameLocation: 'middle',
      nameTextStyle: { color: t.t2, fontSize: 12.5 },
      axisLine: { show: true, lineStyle: { color: t.ink } }, axisTick: { show: false },
      axisLabel: { color: t.t2, fontSize: 12 }, splitLine: { lineStyle: { color: t.bd, type: 'dashed' } }
    });
    const marks = [];
    if (d.xRef !== undefined) marks.push({ xAxis: d.xRef });
    if (d.yRef !== undefined) marks.push({ yAxis: d.yRef });
    return {
      ...base(t),
      grid: { left: 64, right: 48, top: 24, bottom: 56 },
      xAxis: { ...ax(d.xLabel, d.xUnit), nameGap: 32 },
      yAxis: { ...ax(d.yLabel, d.yUnit), nameGap: 44 },
      series: [{
        type: 'scatter',
        data: d.points.map((p, i) => ({
          name: p.name, value: [Number(p.x), Number(p.y), Number(p.size)],
          symbolSize: 12 + 52 * Math.sqrt(Math.abs(Number(p.size)) / max),
          itemStyle: { color: hl === undefined ? t.mid : (isHl(p, i) ? t.acc : t.lig), opacity: 0.85,
            borderColor: t.w, borderWidth: 1 },
          label: { show: true, position: Number(p.x) > x0 + 0.72 * (x1 - x0) ? 'left' : 'right', color: isHl(p, i) ? t.acc : t.ink, fontSize: 12.5,
            fontWeight: isHl(p, i) ? 700 : 400, formatter: () => `${p.name} · ${fmt(p.size, d)}` }
        })),
        markLine: marks.length ? { silent: true, symbol: 'none', label: { show: false },
          lineStyle: { color: t.t2, type: 'dashed', width: 1 }, data: marks } : undefined
      }]
    };
  }
};
