// Vertical columns: short time series (≤ 6 periods) or comparison.
import { base, axisCat, axisVal, seriesColor, fmt, validateCategory, categoryTable } from './common.mjs';

export default {
  label: 'Columns',
  validate: validateCategory,
  table: categoryTable,
  toOption(d, t) {
    const multi = d.series.length > 1;
    return {
      ...base(t),
      legend: multi ? { top: 0, left: 0, icon: 'rect', itemWidth: 10, itemHeight: 10, textStyle: { color: t.t2 } } : undefined,
      grid: { ...base(t).grid, top: multi ? 36 : 28 },
      xAxis: axisCat(t, { data: d.categories }),
      yAxis: axisVal(t),
      series: d.series.map((s, j) => ({
        type: 'bar', name: s.name, barMaxWidth: 64, barGap: '12%',
        label: { show: true, position: 'top', color: t.ink, fontWeight: 700, fontSize: 13, formatter: p => fmt(p.value, d) },
        // The series colour is the legend swatch; each bar sets its own.
        itemStyle: { color: seriesColor(t, j) },
        data: s.values.map((v, i) => ({
          value: v,
          itemStyle: { color: !multi && d.highlight !== undefined ? (i === d.highlight ? t.acc : t.lig) : seriesColor(t, j) }
        }))
      }))
    };
  }
};
