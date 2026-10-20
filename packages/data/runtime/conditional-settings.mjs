import {
  setConditionalFormat,
  removeConditionalFormat,
  moveConditionalFormat,
} from "../model/conditional.mjs";
import { address } from "../model/workbook.mjs";
export function setupConditionalSettings({
  getBook,
  getSheetId,
  getSelection,
  busy,
  apply,
  status,
}) {
  const $ = (id) => document.getElementById(id),
    dialog = $("conditional-dialog");
  let id,
    original,
    dirty = false;
  const highlights = () =>
    (getBook().conditionalFormats ?? []).filter((r) => r.kind === "highlight");
  function draw() {
    for (const field of dialog.querySelectorAll("button,input,select,textarea"))
      field.disabled = busy();
    const unary = ["isBlank", "isError"].includes(
        $("conditional-operator").value,
      ),
      between = ["between", "notBetween"].includes(
        $("conditional-operator").value,
      );
    $("conditional-values").hidden = unary;
    $("conditional-type").disabled = busy() || unary;
    $("conditional-upper-label").hidden = !between;
    $("conditional-background").disabled =
      busy() || !$("conditional-use-background").checked;
    $("conditional-color").disabled =
      busy() || !$("conditional-use-color").checked;
    const rules = highlights(),
      index = rules.findIndex((r) => r.id === id);
    $("conditional-remove").disabled = busy() || !original;
    $("conditional-earlier").disabled = busy() || dirty || index <= 0;
    $("conditional-later").disabled =
      busy() || dirty || index < 0 || index === rules.length - 1;
  }
  const text = (value) =>
    value?.type === "blank"
      ? ""
      : Object.is(value?.value, -0)
        ? "-0"
        : String(value?.value ?? "");
  function populate() {
    const book = getBook();
    original = highlights().find((r) => r.id === $("conditional-rule").value);
    id = original?.id ?? `conditional_${crypto.randomUUID()}`;
    dirty = false;
    $("conditional-sheet").replaceChildren(
      ...book.sheets.map((s) => new Option(s.name, s.id)),
    );
    $("conditional-sheet").value = original?.sheetId ?? getSheetId();
    const r = getSelection(),
      start = address(r.top, r.left),
      end = address(r.bottom, r.right);
    $("conditional-ref").value =
      original?.ref ?? (start === end ? start : `${start}:${end}`);
    $("conditional-operator").value = original?.condition.operator ?? "eq";
    $("conditional-type").value =
      original?.condition.values[0]?.type ?? "number";
    $("conditional-value").value = original
      ? text(original.condition.values[0])
      : "0";
    $("conditional-upper").value = original
      ? text(original.condition.values[1])
      : "100";
    $("conditional-use-background").checked =
      !original || Object.hasOwn(original.style, "background");
    $("conditional-background").value = original?.style.background ?? "#FFEB9C";
    $("conditional-use-color").checked =
      !!original && Object.hasOwn(original.style, "color");
    $("conditional-color").value = original?.style.color ?? "#000000";
    $("conditional-bold").value =
      original?.style.bold === undefined
        ? "inherit"
        : original.style.bold
          ? "bold"
          : "normal";
    $("conditional-context").textContent =
      "Highlights change appearance while preserving cell values and number formats.";
    draw();
  }
  function options(selected = "") {
    const book = getBook();
    $("conditional-rule").replaceChildren(
      new Option("New highlight", ""),
      ...highlights().map(
        (r, i) =>
          new Option(
            `${i + 1}. ${book.sheets.find((s) => s.id === r.sheetId).name}!${r.ref} · ${r.condition.operator}`,
            r.id,
          ),
      ),
    );
    $("conditional-rule").value = selected;
    populate();
  }
  $("manage-conditional").onclick = () => {
    options();
    dialog.showModal();
    $("conditional-rule").focus();
  };
  $("conditional-rule").onchange = populate;
  $("conditional-close").onclick = () => dialog.close();
  dialog.addEventListener("input", (event) => {
    if (event.target.id === "conditional-rule") return;
    dirty = true;
    draw();
  });
  function value(input) {
    const type = $("conditional-type").value,
      raw = $(input).value;
    if (type === "blank") return { type };
    if (type === "text" || type === "error") return { type, value: raw };
    if (type === "boolean") {
      if (!["TRUE", "FALSE"].includes(raw.toUpperCase()))
        throw new Error("Enter TRUE or FALSE.");
      return { type, value: raw.toUpperCase() === "TRUE" };
    }
    if (!raw.trim() || !Number.isFinite(Number(raw)))
      throw new Error("Enter a finite number or date serial.");
    return { type, value: Number(raw) };
  }
  async function run(action) {
    if (busy()) return;
    try {
      const book = getBook();
      let next;
      if (action === "remove") next = removeConditionalFormat(book, id);
      else if (action === "earlier" || action === "later") {
        if (dirty) throw new Error("Save rule edits before changing priority.");
        const rules = highlights(),
          index = rules.findIndex((r) => r.id === id),
          other = rules[index + (action === "earlier" ? -1 : 1)];
        if (!other) throw new Error("Rule is already at the end.");
        next = moveConditionalFormat(
          book,
          id,
          book.conditionalFormats.findIndex((r) => r.id === other.id),
        );
      } else {
        const operator = $("conditional-operator").value,
          values = ["isBlank", "isError"].includes(operator)
            ? []
            : [value("conditional-value")];
        if (["between", "notBetween"].includes(operator))
          values.push(value("conditional-upper"));
        const style = {};
        if ($("conditional-use-background").checked)
          style.background = $("conditional-background").value.trim();
        if ($("conditional-use-color").checked)
          style.color = $("conditional-color").value.trim();
        if ($("conditional-bold").value !== "inherit")
          style.bold = $("conditional-bold").value === "bold";
        if (!Object.keys(style).length)
          throw new Error("Choose a background, text color or font weight.");
        next = setConditionalFormat(book, {
          id,
          sheetId: $("conditional-sheet").value,
          ref: $("conditional-ref").value.trim().toUpperCase(),
          kind: "highlight",
          condition: { operator, values },
          style,
        });
      }
      const reorder = ["earlier", "later"].includes(action);
      if (!reorder) dialog.close();
      const ok = await apply(next);
      if (ok) {
        if (reorder) options(id);
        else $("grid").focus();
      } else {
        $("conditional-context").textContent = $("status").textContent;
        if (!dialog.open) dialog.showModal();
      }
    } catch (error) {
      $("conditional-context").textContent = error.message;
      status(`Conditional formatting not applied: ${error.message}`);
    }
  }
  for (const action of ["save", "remove", "earlier", "later"])
    $(`conditional-${action}`).onclick = () => void run(action);
  return { draw };
}
