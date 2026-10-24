// Horizontal bars : classement.
import { base, axisCat, axisVal, seriesColor, fmt, validateCategory, categoryTable } from './common.mjs';

export default {
  label: 'Horizontal bars',
  validate: validateCategory,
  table: categoryTable,
  toOption(d, t) {
    const multi = d.series.length > 1;
    return {
      ...base(t),
      legend: multi ? { top: 0, left: 0, icon: 'rect', itemWidth: 10, itemHeight: 10, textStyle: { color: t.t2 } } : undefined,
      grid: { ...base(t).grid, top: multi ? 32 : 8, right: 56 },
      yAxis: axisCat(t, { data: d.categories, inverse: true, axisLabel: { color: t.ink, fontSize: 13 } }),
      xAxis: axisVal(t),
      series: d.series.map((s, j) => ({
        type: 'bar', name: s.name, barMaxWidth: 28, barGap: '15%',
        label: { show: true, position: 'right', color: t.ink, fontWeight: 700, fontSize: 13, formatter: p => fmt(p.value, d) },
        data: s.values.map((v, i) => ({
          value: v,
          itemStyle: { color: !multi && d.highlight !== undefined ? (i === d.highlight ? t.acc : t.lig) : seriesColor(t, j) }
        }))
      }))
    };
  }
};
