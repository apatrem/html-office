// The Export sheet as CSV dialog (T19): value policy, separators and, when
// saved results are stale or missing, the explicit choice to recalculate
// first or export them as saved.
import { h } from "../../shared/shell/dom.mjs";
import { field, modal } from "../../shared/shell/dialogs.mjs";
import { address } from "../model/workbook.mjs";
import { sheetCSV, regionalSeparators } from "./csv.mjs";

const NAMES = { ",": "comma", ";": "semicolon" };

export function setupCSV({
  getBook,
  getSheet,
  needsResolution,
  pending,
  recalculate,
  status,
}) {
  function download(sheet, options, stale) {
    const book = getBook(),
      csv = sheetCSV(sheet, { ...options, locale: book.locale });
    if (csv.refused) return status(csv.refused);
    if (!csv.rows) return status(`${sheet.name} has no values to export.`);
    const url = URL.createObjectURL(
        new Blob([csv.text], { type: "text/csv;charset=utf-8" }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = `${[book.id, sheet.name, ...(stale ? ["stale"] : [])]
      .join("-")
      .replace(/[^\p{L}\p{N}._-]+/gu, "_")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const notes = [
      options.values ? "calculated values" : "displayed text",
      `${NAMES[csv.separator]}-separated`,
      ...(options.values ? [`decimal ${NAMES[csv.decimal] ?? "point"}`] : []),
      ...(csv.neutralised
        ? [
            `${csv.neutralised} formula-like text${csv.neutralised > 1 ? "s" : ""} prefixed with an apostrophe`,
          ]
        : []),
      ...(stale ? ["saved results not recalculated"] : []),
      ...(csv.missing
        ? [
            `${csv.missing} formula${csv.missing > 1 ? "s" : ""} without a result left empty`,
          ]
        : []),
    ];
    status(
      `CSV download requested: ${sheet.name}!A1:${address(csv.rows, csv.columns)}, ${csv.rows.toLocaleString("en-US")} × ${csv.columns.toLocaleString("en-US")}; ${notes.join(", ")}.`,
    );
  }

  function open() {
    const book = getBook(),
      sheet = getSheet(),
      regional = regionalSeparators(book.locale),
      problem = needsResolution(sheet),
      content = h(
        "select",
        {},
        h("option", { value: "values" }, "Calculated values (unformatted)"),
        h("option", { value: "display" }, "Displayed text (as formatted)"),
      ),
      separators = h(
        "select",
        {},
        h(
          "option",
          { value: "regional" },
          regional.separator === ";"
            ? `Semicolons, decimal comma (${book.locale})`
            : `Commas, decimal point (${book.locale})`,
        ),
        h(
          "option",
          { value: regional.separator === ";" ? "comma" : "semicolon" },
          regional.separator === ";"
            ? "Commas, decimal point"
            : "Semicolons, decimal comma",
        ),
      );
    const choice = () => ({
        values: content.value === "values",
        ...(separators.value === "regional"
          ? regional
          : separators.value === "comma"
            ? { separator: ",", decimal: "." }
            : { separator: ";", decimal: "," }),
      }),
      button = (label, kind, run) =>
        h(
          "button",
          {
            type: "button",
            class: `sh-b sh-t sh-${kind}`,
            onclick: () => {
              const options = choice();
              dialog.close(label);
              run(options);
            },
          },
          label,
        );
    const dialog = modal(
      "Export sheet as CSV",
      [
        h(
          "p",
          {},
          `${sheet.name}, from A1 to its last filled cell. Formulas, formatting and charts are not exported; text starting with =, +, - or @ gets a leading apostrophe so spreadsheets do not run it.`,
        ),
        field("Values", content),
        field("Separators", separators),
        ...(problem
          ? [h("p", { class: "csv-warning", role: "alert" }, problem)]
          : []),
        ...(pending()
          ? [
              h(
                "p",
                { class: "csv-warning" },
                "An edit that was not calculated is not part of the workbook yet and is not exported. Retry it first to include it.",
              ),
            ]
          : []),
      ],
      [
        h("span", { class: "sh-spacer" }),
        h(
          "button",
          {
            type: "button",
            class: "sh-b sh-t sh-ghost",
            onclick: () => dialog.close("cancel"),
          },
          "Cancel",
        ),
        ...(problem
          ? [
              button("Export saved values", "ghost", (options) =>
                download(sheet, options, true),
              ),
              button("Recalculate and export", "primary", async (options) => {
                if (!(await recalculate())) return;
                const left = needsResolution(sheet);
                if (left) return status(`CSV not exported: ${left}`);
                download(getSheet(), options, false);
              }),
            ]
          : [
              button("Export CSV", "primary", (options) =>
                download(sheet, options, false),
              ),
            ]),
      ],
    );
  }
  return { open };
}
