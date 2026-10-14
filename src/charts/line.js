// Lignes : série temporelle longue (> 6 périodes).
import { base, axisCat, seriesColor, fmt, validateCategory, categoryTable } from './common.js';

export default {
  label: 'Lines',
  validate: validateCategory,
  table: categoryTable,
  toOption(d, t) {
    const mode = d.labels || 'last';
    return {
      ...base(t),
      grid: { ...base(t).grid, right: 120, top: 24 },
      xAxis: axisCat(t, { data: d.categories, boundaryGap: false }),
      yAxis: { type: 'value', scale: !!d.scale, axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: t.t2, fontSize: 12, formatter: v => fmt(v, d) },
        splitLine: { lineStyle: { color: t.bd, type: 'dashed' } } },
      series: d.series.map((s, j) => {
        const c = d.highlight === undefined ? seriesColor(t, j) : (j === d.highlight ? t.acc : t.lig);
        return {
          type: 'line', name: s.name, data: s.values, symbol: 'circle', symbolSize: 6, showSymbol: mode === 'all',
          lineStyle: { width: j === (d.highlight ?? 0) ? 3 : 2, color: c }, itemStyle: { color: c },
          label: { show: mode === 'all', position: 'top', color: t.ink, fontSize: 12, formatter: p => fmt(p.value, d) },
          endLabel: { show: mode !== 'none', color: c, fontWeight: 700, fontSize: 12.5,
            formatter: p => `${fmt(p.value, d)}  ${s.name || ''}` }
        };
      })
    };
  }
};
