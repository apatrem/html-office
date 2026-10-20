import {
  address,
  parseAddress,
  parseRange,
  validateValidations,
  MAX_DROPDOWN_VALUES,
} from "./workbook.mjs";
export const MAX_DROPDOWN_SOURCE_CELLS = 10000;
export function setValidation(book, definition) {
  const rules = [...(book.validations ?? [])],
    index = rules.findIndex((r) => r.id === definition.id);
  if (index < 0) rules.push(structuredClone(definition));
  else rules[index] = structuredClone(definition);
  const next = { ...book, validations: rules };
  validateValidations(next);
  return next;
}
export function removeValidation(book, id) {
  if (!book.validations?.some((r) => r.id === id))
    throw new Error("Unknown validation ID");
  const next = {
    ...book,
    validations: book.validations.filter((r) => r.id !== id),
  };
  if (next.scenario?.validationId === id) delete next.scenario;
  return next;
}
export function configureScenario(book, validationId) {
  const next = { ...book };
  if (validationId === null) delete next.scenario;
  else next.scenario = { validationId };
  validateValidations(next);
  return next;
}
const valueKey = (value) => JSON.stringify([value.type, value.value]);
const unavailable = (state, message, reason) => ({
  ...(reason ? { reason } : {}),
  state,
  message,
  values: [],
  editable: false,
});
export function validationChoices(
  book,
  rule,
  { snapshotCurrent = false } = {},
) {
  if (rule.ref === "#REF!")
    return unavailable("broken", "The dropdown target was deleted.");
  const values = [],
    seen = new Set();
  const append = (value) => {
    const key = valueKey(value);
    if (!seen.has(key)) {
      seen.add(key);
      values.push(value);
    }
    return values.length <= MAX_DROPDOWN_VALUES;
  };
  if (rule.source.kind === "list") rule.source.values.forEach(append);
  else {
    if (rule.source.ref === "#REF!")
      return unavailable("broken", "The list source was deleted.");
    const rect = parseRange(rule.source.ref),
      sheet = book.sheets.find((s) => s.id === rule.source.sheetId);
    if (
      (rect.bottom - rect.top + 1) * (rect.right - rect.left + 1) >
      MAX_DROPDOWN_SOURCE_CELLS
    )
      return unavailable(
        "too-large",
        "List sources support at most 10,000 cells.",
      );
    for (let row = rect.top; row <= rect.bottom; row++)
      for (let column = rect.left; column <= rect.right; column++) {
        const cell = sheet.cells[address(row, column)];
        if (cell?.formula && (!snapshotCurrent || !cell.result))
          return unavailable(
            "unresolved",
            "Recalculate to resolve the list source.",
            cell.result ? "stale" : "missing",
          );
        const value = cell?.formula ? cell.result : cell?.input;
        if (value?.type === "error")
          return unavailable(
            "unresolved",
            "The list source contains an error.",
            "error",
          );
        if (
          !value ||
          value.type === "blank" ||
          (value.type === "text" && value.value === "")
        )
          continue;
        if (!append(value))
          return unavailable(
            "too-large",
            "Dropdowns support at most 1,000 distinct choices.",
          );
      }
  }
  return values.length
    ? { state: "ready", values }
    : unavailable("empty", "The list source has no values.");
}
export function validationForCell(book, sheetId, ref) {
  const cell = parseAddress(ref);
  return book.validations?.find((rule) => {
    if (rule.sheetId !== sheetId || rule.ref === "#REF!") return false;
    const r = parseRange(rule.ref);
    return (
      cell.row >= r.top &&
      cell.row <= r.bottom &&
      cell.column >= r.left &&
      cell.column <= r.right
    );
  });
}
export function validationStatus(book, rule, ref, options = {}) {
  const choices = validationChoices(book, rule, options);
  if (choices.state !== "ready") return choices;
  const p = parseAddress(ref),
    r = parseRange(rule.ref);
  if (
    p.row < r.top ||
    p.row > r.bottom ||
    p.column < r.left ||
    p.column > r.right
  )
    throw new Error("Cell is outside the validation target");
  const cell = book.sheets.find((s) => s.id === rule.sheetId).cells[ref];
  if (cell?.formula && (!options.snapshotCurrent || !cell.result))
    return unavailable(
      "unresolved",
      "Recalculate to resolve the current value.",
      cell.result ? "stale" : "missing",
    );
  const value = cell?.formula
    ? cell.result
    : (cell?.input ?? { type: "blank" });
  return {
    ...choices,
    state: choices.values.some((v) => valueKey(v) === valueKey(value))
      ? "valid"
      : "invalid",
    value,
    editable: !cell?.formula,
  };
}

export function scenarioTarget(book) {
  const rule = book.validations?.find(
    (r) => r.id === book.scenario?.validationId,
  );
  if (!rule) return null;
  if (rule.ref === "#REF!") return { sheetId: rule.sheetId, ref: "#REF!" };
  const rect = parseRange(rule.ref);
  return { sheetId: rule.sheetId, ref: address(rect.top, rect.left) };
}
export function assertScenarioInputs(book, edits) {
  const target = scenarioTarget(book);
  if (!target || target.ref === "#REF!") return;
  for (let i = edits.length - 1; i >= 0; i--)
    if (edits[i].sheetId === target.sheetId && edits[i].ref === target.ref) {
      if (edits[i].cell?.formula)
        throw new Error("Scenario selector must be an input cell");
      return;
    }
}
