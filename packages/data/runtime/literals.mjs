// Browser-derived state only: canonical readModel callers keep ordinary independent
// mutable cells. Editor commands replace whole cells, so identical styled inputs can
// safely reuse frozen literals and reduce GC work on large imported tables.
// Sharing is limited to cells made only of these fields, so any other or
// future presentation field (style, link…) keeps the cell independent.
const CELL_KEYS = ["input", "cellStyle", "format"],
  FORMAT_KEYS = [
    "kind",
    "digits",
    "currency",
    "dateStyle",
    "scale",
    "negative",
  ];
const only = (value, keys) => {
  for (const key in value) if (!keys.includes(key)) return false;
  return true;
};
export function compactInputs(book, limit = 8192) {
  const types = new Map(),
    negativeZero = Symbol("negative zero");
  let count = 0;
  for (const sheet of book.sheets)
    for (const ref of Object.keys(sheet.cells)) {
      const cell = sheet.cells[ref],
        value = cell.input;
      const format = cell.format;
      if (
        !value ||
        !only(cell, CELL_KEYS) ||
        (format && !only(format, FORMAT_KEYS)) ||
        (typeof value.value === "string" && value.value.length > 1024)
      )
        continue;
      const style = [
        value.type,
        cell.cellStyle ?? "",
        ...FORMAT_KEYS.map((key) => format?.[key] ?? ""),
      ].join("|");
      let cache = types.get(style);
      if (!cache) {
        if (count >= limit) continue;
        types.set(style, (cache = new Map()));
      }
      const key = Object.is(value.value, -0) ? negativeZero : value.value,
        existing = cache.get(key);
      if (existing) sheet.cells[ref] = existing;
      else if (count < limit) {
        Object.freeze(value);
        if (format) Object.freeze(format);
        cache.set(key, Object.freeze(cell));
        count++;
      }
    }
  return book;
}
