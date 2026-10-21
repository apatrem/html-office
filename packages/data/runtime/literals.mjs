// Browser-derived state only: canonical readModel callers keep ordinary independent
// mutable cells. Editor commands replace whole cells, so identical styled inputs can
// safely reuse frozen literals and reduce GC work on large imported tables.
export function compactInputs(book, limit = 8192) {
  const types = new Map(),
    negativeZero = Symbol("negative zero");
  let count = 0;
  for (const sheet of book.sheets)
    for (const ref of Object.keys(sheet.cells)) {
      const cell = sheet.cells[ref],
        value = cell.input;
      if (
        !value ||
        cell.formula ||
        cell.result ||
        (typeof value.value === "string" && value.value.length > 1024)
      )
        continue;
      const format = cell.format,
        style = [
          value.type,
          cell.cellStyle ?? "",
          format?.kind ?? "",
          format?.digits ?? "",
          format?.currency ?? "",
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
