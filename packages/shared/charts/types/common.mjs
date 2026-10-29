// Helpers shared by the chart types.

export const nf = (d = 1, fixed = false) => new Intl.NumberFormat('en-US', { maximumFractionDigits: d, minimumFractionDigits: fixed ? d : 0 });

// decimals sets the number of decimals shown (otherwise: up to 1 decimal).
export function fmt(v, data) {
  if (v === null || v === undefined || v === '') return '';
  const s = nf(data.decimals ?? 1, data.decimals !== undefined).format(v);
  return (data.prefix || '') + s + (data.suffix || '');
}

export function base(theme) {
  return {
    animation: false,
    textStyle: { fontFamily: theme.font, color: theme.ink, fontSize: 13 },
    grid: { left: 8, right: 24, top: 28, bottom: 8, containLabel: true }
  };
}

// Category labels: every label, wrapped to its share of a 680 px axis (at least 56 px), while they fit
// at that width (up to 12 categories). Longer series let ECharts thin them to the axis's real length; it
// measures one line, so they stay on one line, cut at 120 px to keep a horizontal bar chart's gutter.
export const axisCat = (theme, extra = {}) => {
  const n = (extra.data || []).length || 1;
  const labels = n * 56 <= 680 ? { interval: 0, width: Math.max(56, Math.floor(680 / n) - 12), overflow: 'break' }
    : { interval: 'auto', width: 120, overflow: 'truncate' };
  return {
    type: 'category',
    axisTick: { show: false },
    axisLine: { lineStyle: { color: theme.ink } },
    ...extra,
    axisLabel: { color: theme.t2, fontSize: 12.5, ...labels, lineHeight: 16, ...(extra.axisLabel || {}) }
  };
};

export const axisVal = (theme, extra = {}) => ({
  type: 'value',
  splitLine: { show: false },
  axisLine: { show: false },
  axisTick: { show: false },
  axisLabel: { show: false },
  ...extra
});

// Series colours: accent, then series 2, series 3, then neutral tints.
export const seriesColor = (theme, i) => [theme.acc, theme.mid, theme.lig, theme.bd, theme.t2][i % 5];

export function req(data, keys) {
  const err = [];
  if (!isObject(data)) return ['Data must be a JSON object'];
  for (const k of keys) if (data[k] === undefined || data[k] === null || data[k] === '') err.push(`Missing field "${k}"`);
  if (data.unit !== undefined && (typeof data.unit !== 'string' || !data.unit.trim())) err.push('unit: non-empty text required');
  if (data.decimals !== undefined && (!Number.isInteger(data.decimals) || data.decimals < 0 || data.decimals > 20)) err.push('decimals: integer between 0 and 20 required');
  return err;
}
export const isObject = d => !!d && typeof d === 'object' && !Array.isArray(d);
export const finite = v => typeof v === 'number' && Number.isFinite(v);
export function records(d, key, err) {
  if (!Array.isArray(d[key]) || !d[key].length) { err.push(`"${key}": non-empty array required`); return []; }
  if (d[key].some(x => !isObject(x))) { err.push(`"${key}": each entry must be an object`); return []; }
  return d[key];
}

// Generic categories × series tables, shared by columns, bars, stacked bars and lines.
export const categoryTable = {
  columns: d => ['Category', ...(d.series || []).map(s => s.name || '')],
  toRows: d => (d.categories || []).map((c, i) => [c, ...(d.series || []).map(s => s.values?.[i] ?? '')]),
  fromRows(rows, headers, d) {
    const series = headers.slice(1).map((name, j) => ({ ...(d.series?.[j] || {}), name, values: rows.map(r => num(r[j + 1])) }));
    return { ...d, categories: rows.map(r => r[0]), series };
  },
  canAddColumn: true
};

export function validateCategory(d) {
  const err = req(d, ['unit', 'categories', 'series']);
  if (!isObject(d)) return err;
  const ss = records(d, 'series', err);
  if (!Array.isArray(d.categories) || !d.categories.length || d.categories.some(c => typeof c !== 'string' || !c.trim()))
    err.push('categories: non-empty array of labels required');
  else {
    ss.forEach((s, i) => {
      if (!Array.isArray(s.values) || s.values.length !== d.categories.length)
        err.push(`series ${i + 1}: ${s.values?.length ?? 0} values for ${d.categories.length} categories`);
      if (Array.isArray(s.values) && s.values.some(v => v !== null && !finite(v))) err.push(`series ${i + 1}: finite numbers or null (missing value) required`);
    });
  }
  return err;
}

// Yes/no table cells (waterfall totals, Gantt highlights): y, n, or blank when the field is absent.
export const flag = v => (v === true ? 'y' : v === false ? 'n' : '');
export function flagOf(v) {
  const s = String(v ?? '').trim();
  if (/^(o|oui|y|yes|1|x|true)$/i.test(s)) return true;
  if (/^(n|no|non|0|false)$/i.test(s)) return false;
  return undefined;
}

export function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}
