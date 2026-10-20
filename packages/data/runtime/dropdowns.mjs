import {
  scenarioTarget,
  validationForCell,
  validationStatus,
} from "../model/validation.mjs";
import { display } from "./view.mjs";
export function setupDropdowns({
  getBook,
  getSheetId,
  getSelection,
  busy,
  isSnapshotCurrent,
  apply,
}) {
  const controls = [
    { select: document.getElementById("scenario-select"), scenario: true },
    { select: document.getElementById("dropdown-value"), scenario: false },
  ];
  function context(control) {
    const book = getBook(),
      target = control.scenario
        ? scenarioTarget(book)
        : { sheetId: getSheetId(), ref: getSelection().focus };
    const rule = control.scenario
      ? book.validations?.find((r) => r.id === book.scenario?.validationId)
      : validationForCell(book, target.sheetId, target.ref);
    return { book, target, rule };
  }
  function state({ book, target, rule }) {
    return target.ref === "#REF!"
      ? {
          state: "broken",
          message: "The selector was deleted. Undo the deletion to restore it.",
        }
      : validationStatus(book, rule, target.ref, {
          snapshotCurrent: isSnapshotCurrent(),
        });
  }
  function draw() {
    for (const control of controls) {
      const { select } = control,
        info = context(control),
        box = select.closest(".dropdown-control"),
        note = box.querySelector("small");
      box.hidden = !info.rule;
      if (!info.rule) continue;
      const value = state(info),
        cell = info.book.sheets.find((s) => s.id === info.target.sheetId).cells[
          info.target.ref
        ];
      select.replaceChildren();
      if (value.state !== "valid") {
        const option = new Option(
          value.state === "invalid"
            ? `${display(cell, info.book.locale) || "(blank)"} — outside list`
            : "Choices unavailable",
          "",
          true,
          true,
        );
        option.disabled = true;
        select.add(option);
      }
      for (const [index, choice] of (value.values ?? []).entries()) {
        const chosen =
          value.state === "valid" &&
          choice.type === value.value.type &&
          choice.value === value.value.value;
        select.add(
          new Option(
            display(
              { input: choice, format: cell?.format },
              info.book.locale,
            ) || "(blank)",
            String(index),
            chosen,
            chosen,
          ),
        );
      }
      select.disabled = busy() || !value.editable;
      select.setAttribute("aria-invalid", String(value.state === "invalid"));
      note.textContent =
        value.message ??
        (!value.editable
          ? "Calculated cell. Edit its formula or source instead."
          : value.state === "invalid"
            ? "The current value is outside the list. Choose a listed value or edit the cell."
            : "");
    }
  }
  for (const control of controls)
    control.select.onchange = async () => {
      if (busy()) return;
      const info = context(control);
      if (!info.rule) return;
      const value = state(info),
        index = Number(control.select.value);
      if (
        !value.editable ||
        control.select.value === "" ||
        !Number.isInteger(index) ||
        !value.values[index]
      )
        return draw();
      const cell = {
        ...info.book.sheets.find((s) => s.id === info.target.sheetId).cells[
          info.target.ref
        ],
        input: structuredClone(value.values[index]),
      };
      delete cell.formula;
      delete cell.result;
      await apply({
        edits: [{ ...info.target, cell, range: true }],
        selectionAfter: { sheetId: getSheetId(), ...getSelection() },
      });
      if (!busy() && !control.select.disabled) control.select.focus();
    };
  return { draw };
}
