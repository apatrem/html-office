// Stacked bars (or 100 %): composition by category.
import { base, axisCat, axisVal, seriesColor, fmt, validateCategory, categoryTable } from './common.mjs';

export default {
  label: 'Stacked bars',
  validate: validateCategory,
  table: categoryTable,
  toOption(d, t) {
    const horiz = !!d.horizontal;
    const totals = d.categories.map((_, i) => d.series.reduce((a, s) => a + (Number(s.values[i]) || 0), 0));
    const val = (v, i) => (d.percent ? (totals[i] ? (100 * (Number(v) || 0)) / totals[i] : 0) : v);
    const maxTot = d.percent ? 100 : Math.max(...totals);
    const dd = d.percent ? { ...d, suffix: ' %', decimals: 0 } : d;
    const series = d.series.map((s, j) => {
      const c = seriesColor(t, j);
      const dark = j < 2;
      return {
        type: 'bar', name: s.name, stack: 'total', barMaxWidth: horiz ? 30 : 64,
        itemStyle: { color: c, borderColor: t.w, borderWidth: 1 },
        label: { show: true, position: 'inside', color: dark ? t.w : t.ink, fontSize: 12.5,
          formatter: p => (Math.abs(p.value) < maxTot * 0.06 ? '' : fmt(p.value, dd)) },
        data: s.values.map((v, i) => val(v, i))
      };
    });
    if (!d.percent && d.totals !== false) {
      series.push({
        type: 'bar', name: '__total', stack: 'total', silent: true, itemStyle: { color: 'transparent' },
        label: { show: true, position: horiz ? 'right' : 'top', color: t.ink, fontWeight: 700, fontSize: 13,
          formatter: p => fmt(totals[p.dataIndex], d) },
        data: totals.map(() => 0)
      });
    }
    const cat = axisCat(t, { data: d.categories, inverse: horiz, axisLabel: horiz ? { color: t.ink, fontSize: 13 } : {} });
    return {
      ...base(t),
      legend: { top: 0, left: 0, icon: 'rect', itemWidth: 10, itemHeight: 10, textStyle: { color: t.t2 },
        data: d.series.map(s => s.name) },
      grid: { ...base(t).grid, top: 36, right: horiz ? 56 : 24 },
      xAxis: horiz ? axisVal(t, { max: d.percent ? 100 : undefined }) : cat,
      yAxis: horiz ? cat : axisVal(t, { max: d.percent ? 100 : undefined }),
      series
    };
  }
};
