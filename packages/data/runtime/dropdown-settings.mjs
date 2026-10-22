import {
  setValidation,
  removeValidation,
  configureScenario,
  validationForCell,
} from "../model/validation.mjs";
export function setupDropdownSettings({
  getBook,
  getSheetId,
  getSelection,
  busy,
  apply,
  status,
}) {
  const $ = (id) => document.getElementById(id),
    dialog = $("dropdown-dialog");
  let id, original;
  function draw() {
    const waiting = busy();
    for (const field of dialog.querySelectorAll("button,input,select,textarea"))
      field.disabled = waiting;
    $("dropdown-list-fields").hidden =
      $("dropdown-source-kind").value !== "list";
    $("dropdown-range-fields").hidden =
      $("dropdown-source-kind").value !== "range";
    $("dropdown-list-type").querySelector('[value="keep"]').disabled =
      original?.source.kind !== "list";
    $("dropdown-list-values").disabled =
      waiting || ["keep", "blank"].includes($("dropdown-list-type").value);
    $("dropdown-remove").disabled = waiting || !original;
  }
  function populate() {
    const book = getBook();
    original = book.validations?.find(
      (r) => r.id === $("dropdown-definition").value,
    );
    id = original?.id ?? `dropdown_${crypto.randomUUID()}`;
    for (const field of ["dropdown-target-sheet", "dropdown-source-sheet"])
      $(field).replaceChildren(
        ...book.sheets.map((sheet) => new Option(sheet.name, sheet.id)),
      );
    $("dropdown-target-sheet").value = original?.sheetId ?? getSheetId();
    $("dropdown-target-ref").value = original?.ref ?? getSelection().focus;
    $("dropdown-source-kind").value = original?.source.kind ?? "list";
    $("dropdown-source-sheet").value = original?.source.sheetId ?? getSheetId();
    $("dropdown-source-ref").value = original?.source.ref ?? "A1:A3";
    $("dropdown-list-type").value =
      original?.source.kind === "list" ? "keep" : "text";
    $("dropdown-list-values").value =
      original?.source.values
        ?.map((v) => (v.type === "blank" ? "(blank)" : String(v.value)))
        .join("\n") ?? "";
    $("dropdown-scenario").checked =
      original?.id === book.scenario?.validationId && !!original;
    $("dropdown-context").textContent = original
      ? "Edit this definition or remove it. Cell values are preserved."
      : "Create a list for the selected cell or another explicit range.";
    draw();
  }
  function open() {
    const book = getBook(),
      rule = validationForCell(book, getSheetId(), getSelection().focus);
    $("dropdown-definition").replaceChildren(
      new Option("New dropdown", ""),
      ...(book.validations ?? []).map(
        (r) =>
          new Option(
            `${book.sheets.find((s) => s.id === r.sheetId).name}!${r.ref}${r.id === book.scenario?.validationId ? " (scenario)" : ""}`,
            r.id,
          ),
      ),
    );
    $("dropdown-definition").value = rule?.id ?? "";
    populate();
    dialog.showModal();
    $("dropdown-definition").focus();
  }
  $("dropdown-definition").onchange = populate;
  $("dropdown-source-kind").onchange = draw;
  $("dropdown-list-type").onchange = draw;
  $("dropdown-close").onclick = () => dialog.close();
  function values() {
    const type = $("dropdown-list-type").value;
    if (type === "keep") {
      if (original?.source.kind !== "list")
        throw new Error("Choose a list value type.");
      return structuredClone(original.source.values);
    }
    if (type === "blank") return [{ type }];
    return $("dropdown-list-values")
      .value.split(/\r?\n/)
      .map((text) => {
        if (type === "text") return { type, value: text };
        if (type === "boolean") {
          if (!["TRUE", "FALSE"].includes(text.toUpperCase()))
            throw new Error("Each boolean choice must be TRUE or FALSE.");
          return { type, value: text.toUpperCase() === "TRUE" };
        }
        if (!text.trim() || !Number.isFinite(Number(text)))
          throw new Error(
            "Each number/date choice must be a finite number using a decimal point.",
          );
        return { type, value: Number(text) };
      });
  }
  async function run(remove = false) {
    if (busy()) return;
    try {
      let next = getBook();
      if (remove) next = removeValidation(next, id);
      else {
        if (next.scenario?.validationId === id)
          next = configureScenario(next, null);
        next = setValidation(next, {
          id,
          sheetId: $("dropdown-target-sheet").value,
          ref: $("dropdown-target-ref").value.trim().toUpperCase(),
          source:
            $("dropdown-source-kind").value === "list"
              ? { kind: "list", values: values() }
              : {
                  kind: "range",
                  sheetId: $("dropdown-source-sheet").value,
                  ref: $("dropdown-source-ref").value.trim().toUpperCase(),
                },
        });
        if ($("dropdown-scenario").checked) next = configureScenario(next, id);
      }
      dialog.close();
      const ok = await apply(next);
      if (ok) $("grid").focus();
      else {
        $("dropdown-context").textContent = $("status").textContent;
        dialog.showModal();
      }
    } catch (error) {
      $("dropdown-context").textContent = error.message;
      status(`Dropdown settings not applied: ${error.message}`);
    }
  }
  $("dropdown-save").onclick = () => void run();
  $("dropdown-remove").onclick = () => void run(true);
  return { draw, open };
}
