// Row heights and column widths over Excel-sized axes (F02): a default size,
// sparse overrides, cumulative offsets and index lookup without materialising
// a million entries. start(i) is the offset of index i from the axis origin.
import { parseAddress } from "./workbook.mjs";

export function createAxis(size, count, overrides = new Map()) {
  const keys = [...overrides.keys()]
    .filter((key) => key >= 1 && key <= count)
    .sort((a, b) => a - b);
  // prefix[n]: total size change of the first n overridden indexes.
  const prefix = [0];
  for (const key of keys)
    prefix.push(prefix.at(-1) + overrides.get(key) - size);
  // Number of overridden indexes below i.
  function below(i) {
    let lo = 0,
      hi = keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (keys[mid] < i) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  const start = (i) => (i - 1) * size + prefix[below(i)];
  return {
    count,
    size: (i) => overrides.get(i) ?? size,
    start,
    total: start(count + 1),
    // The index whose span contains offset px (clamped to the axis).
    indexAt(px) {
      let lo = 1,
        hi = count;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (start(mid) <= px) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
  };
}

// Axes of a sheet from its rows.N.height and columns.X.width entries, cached
// per rows/columns object (structural edits and size commands replace them).
const cache = new WeakMap();
const NONE = {};
export function sheetAxes(sheet, { rows, columns, height, width }) {
  const key = sheet.rows ?? NONE,
    other = sheet.columns ?? NONE;
  const hit = cache.get(key)?.get(other);
  if (hit) return hit;
  const sizes = (entries, field, index) =>
    new Map(
      Object.entries(entries ?? {})
        .filter(([, entry]) => entry[field] !== undefined)
        .map(([name, entry]) => [index(name), entry[field]]),
    );
  const axes = {
    rows: createAxis(height, rows, sizes(sheet.rows, "height", Number)),
    columns: createAxis(
      width,
      columns,
      sizes(sheet.columns, "width", (name) => parseAddress(name + "1").column),
    ),
  };
  if (!cache.has(key)) cache.set(key, new WeakMap());
  cache.get(key).set(other, axes);
  return axes;
}
