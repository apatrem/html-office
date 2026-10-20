import {
  parseAddress,
  parseRange,
  validateConditionalFormats,
} from "./workbook.mjs";
export function setConditionalFormat(book, rule) {
  const rules = [...(book.conditionalFormats ?? [])],
    index = rules.findIndex((r) => r.id === rule.id);
  if (index < 0) rules.push(structuredClone(rule));
  else rules[index] = structuredClone(rule);
  const next = { ...book, conditionalFormats: rules };
  validateConditionalFormats(next);
  return next;
}
export function removeConditionalFormat(book, id) {
  if (!book.conditionalFormats?.some((r) => r.id === id))
    throw new Error("Unknown conditional format ID");
  return {
    ...book,
    conditionalFormats: book.conditionalFormats.filter((r) => r.id !== id),
  };
}
export function moveConditionalFormat(book, id, index) {
  const rules = [...(book.conditionalFormats ?? [])],
    from = rules.findIndex((r) => r.id === id);
  if (
    from < 0 ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= rules.length
  )
    throw new Error("Invalid conditional format position");
  rules.splice(index, 0, rules.splice(from, 1)[0]);
  return { ...book, conditionalFormats: rules };
}
const valueOf = (cell) =>
  cell?.formula ? (cell.result ?? null) : (cell?.input ?? { type: "blank" });
const numeric = (value) => value && ["number", "date"].includes(value.type);
const includes = (r, p) =>
  p.row >= r.top &&
  p.row <= r.bottom &&
  p.column >= r.left &&
  p.column <= r.right;
export function compileConditionalFormats(book) {
  const sheets = new Map();
  for (const rule of book.conditionalFormats ?? []) {
    if (rule.ref === "#REF!") continue;
    if (!sheets.has(rule.sheetId)) sheets.set(rule.sheetId, []);
    sheets.get(rule.sheetId).push({ rule, rect: parseRange(rule.ref) });
  }
  return sheets;
}
export function matchesCondition(value, { operator, values }) {
  if (!value) return false;
  if (operator === "isError") return value.type === "error";
  if (operator === "isBlank") return value.type === "blank";
  const first = values[0];
  if (value.type === "error" && first.type !== "error") return false;
  const equal = value.type === first.type && value.value === first.value;
  if (operator === "eq") return equal;
  if (operator === "ne") return !equal;
  if (value.type !== first.type) return false;
  if (operator === "contains") return value.value.includes(first.value);
  if (operator === "gt") return value.value > first.value;
  if (operator === "gte") return value.value >= first.value;
  if (operator === "lt") return value.value < first.value;
  if (operator === "lte") return value.value <= first.value;
  const inside = value.value >= first.value && value.value <= values[1].value;
  return operator === "between" ? inside : !inside;
}
// Scan populated cells, never the potentially Excel-sized blank rectangle. This
// pure summary can run in a worker; overrides recover canonical cells under a draft.
export function conditionalScales(book, { overrides = [] } = {}) {
  const compiled = compileConditionalFormats(book),
    scales = {},
    bySheet = new Map();
  for (const edit of overrides) {
    if (!bySheet.has(edit.sheetId)) bySheet.set(edit.sheetId, new Map());
    bySheet.get(edit.sheetId).set(edit.ref, edit.cell);
  }
  for (const sheet of book.sheets) {
    const rules = (compiled.get(sheet.id) ?? []).filter(
      ({ rule }) => rule.kind === "dataBar",
    );
    for (const { rule } of rules)
      scales[rule.id] =
        rule.scale.kind === "fixed"
          ? { min: rule.scale.min, max: rule.scale.max }
          : { min: 0, max: 0, count: 0 };
    const automatic = rules.filter(({ rule }) => rule.scale.kind === "auto");
    if (!automatic.length) continue;
    const replacements = bySheet.get(sheet.id);
    function inspect(ref, cell) {
      const value = valueOf(cell);
      if (!numeric(value)) return;
      const point = parseAddress(ref);
      for (const { rule, rect } of automatic)
        if (includes(rect, point)) {
          const scale = scales[rule.id];
          scale.min = Math.min(scale.min, value.value);
          scale.max = Math.max(scale.max, value.value);
          scale.count++;
        }
    }
    for (const ref in sheet.cells)
      inspect(
        ref,
        replacements?.has(ref) ? replacements.get(ref) : sheet.cells[ref],
      );
    for (const [ref, cell] of replacements ?? [])
      if (!Object.hasOwn(sheet.cells, ref)) inspect(ref, cell);
  }
  return scales;
}
export function dataBarGeometry(value, { min, max }) {
  if (min === max) return { axis: 0, left: 0, width: 0, negative: false };
  // Normalize before subtracting to avoid overflow for finite ±1e308 values.
  const magnitude = Math.max(Math.abs(min), Math.abs(max)),
    low = min / magnitude,
    span = max / magnitude - low;
  const position = (v) =>
    Math.min(1, Math.max(0, (v / magnitude - low) / span)) * 100;
  const axis = position(0),
    end = position(value);
  return {
    axis,
    left: Math.min(axis, end),
    width: Math.abs(end - axis),
    negative: value < 0,
  };
}
export function conditionalPresentation(
  compiled,
  sheetId,
  ref,
  cell,
  scales = {},
) {
  let barMatched = false;
  const result = {},
    point = parseAddress(ref),
    value = valueOf(cell);
  for (const { rule, rect } of compiled.get(sheetId) ?? []) {
    if (!includes(rect, point)) continue;
    if (
      rule.kind === "highlight" &&
      !result.highlight &&
      matchesCondition(value, rule.condition)
    )
      result.highlight = rule.style;
    if (rule.kind === "dataBar" && !barMatched && numeric(value)) {
      barMatched = true;
      if (Object.hasOwn(scales, rule.id)) {
        const bar = dataBarGeometry(value.value, scales[rule.id]);
        result.bar = {
          ...bar,
          color: bar.negative ? rule.negativeColor : rule.positiveColor,
        };
      }
    }
  }
  return result;
}
