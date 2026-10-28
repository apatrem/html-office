// The Print / PDF dialog (T19): paper, orientation, repeated rows and
// charts, with the scale that fits the page width; Print opens the browser's
// print dialog on the print view, where Save as PDF is offered.
import { h } from "../../shared/shell/dom.mjs";
import { field, modal } from "../../shared/shell/dialogs.mjs";
import { address } from "../model/workbook.mjs";
import {
  PAPER,
  MAX_REPEAT_ROWS,
  MAX_REPEAT_COLUMNS,
  bestOrientation,
  defaultPaper,
  headerRows,
  printLayout,
} from "./print.mjs";

export function setupPrintDialog({ getBook, getSheet, print, stale, status }) {
  function open() {
    const book = getBook(),
      sheet = getSheet(),
      paper = h(
        "select",
        {},
        ...Object.keys(PAPER).map((name) => h("option", { value: name }, name)),
      ),
      orientation = h(
        "select",
        {},
        h("option", { value: "portrait" }, "Portrait"),
        h("option", { value: "landscape" }, "Landscape"),
      ),
      wide = h(
        "select",
        {},
        h("option", { value: "fit" }, "Fit to the page width"),
        h("option", { value: "split" }, "Split into pages across"),
      ),
      repeat = h("input", {
        type: "number",
        min: "0",
        max: String(MAX_REPEAT_ROWS),
        step: "1",
      }),
      repeatColumns = h("input", {
        type: "number",
        min: "0",
        max: String(MAX_REPEAT_COLUMNS),
        step: "1",
        value: "1",
      }),
      charts = h("input", { type: "checkbox", checked: "" }),
      fit = h("p", { class: "print-fit", role: "status" }),
      hasCharts = (book.charts ?? []).some((c) => c.sheetId === sheet.id);
    paper.value = defaultPaper(book.locale);
    orientation.value = bestOrientation(sheet, paper.value);
    const first = printLayout(sheet, {
      paper: paper.value,
      orientation: orientation.value,
    });
    wide.value = first.wide;
    repeat.value = String(headerRows(sheet, first.columns));
    const whole = (input, max) => {
      const value = Number(input.value),
        ok = Number.isInteger(value) && value >= 0 && value <= max;
      input.setAttribute("aria-invalid", String(!ok));
      input.closest(".sh-fld").querySelector(".sh-err").textContent = ok
        ? ""
        : `Enter a whole number from 0 to ${max}.`;
      return ok;
    };
    const options = () => ({
      paper: paper.value,
      orientation: orientation.value,
      wide: wide.value,
      repeat: Number(repeat.value),
      repeatColumns: Number(repeatColumns.value),
      includeCharts: charts.checked,
    });
    const check = () => {
      const ok =
        whole(repeat, MAX_REPEAT_ROWS) &
        whole(repeatColumns, MAX_REPEAT_COLUMNS);
      repeatColumns.disabled = wide.value !== "split";
      const layout = ok ? printLayout(sheet, options()) : null,
        across = layout?.bands.length ?? 1;
      fit.textContent = !layout
        ? ""
        : layout.refused ||
          `${sheet.name}!A1:${address(layout.rows, layout.columns)}${
            across > 1 ? ` on ${across} pages across` : ""
          }, ${
            layout.scale < 1
              ? `scaled to ${Math.floor(layout.scale * 100)}% to fit the page width`
              : "at full size"
          }.`;
      button.disabled = !layout || !!layout.refused;
      return !button.disabled;
    };
    const button = h(
      "button",
      { type: "button", class: "sh-b sh-t sh-primary" },
      "Print",
    );
    const dialog = modal(
      "Print / PDF",
      [
        field("Paper", paper),
        field("Orientation", orientation),
        field("Wide sheets", wide),
        field("Repeat rows at top", repeat),
        field("Repeat columns at left", repeatColumns),
        ...(hasCharts
          ? [
              h(
                "label",
                { class: "checkbox-label" },
                charts,
                " Print charts after the table",
              ),
            ]
          : []),
        fit,
        ...(stale(sheet)
          ? [
              h(
                "p",
                { class: "csv-warning", role: "alert" },
                "Saved results may be out of date: the printout carries a warning. Recalculate first (Data › Recalculate) to print current values.",
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
        button,
      ],
    );
    for (const control of [paper, orientation, wide, repeat, repeatColumns])
      control.addEventListener("input", check);
    button.addEventListener("click", () => {
      if (!check()) return;
      const chosen = options();
      dialog.close("print");
      const refused = print.build(chosen);
      if (refused) return status(refused);
      status(
        `Print view ready: ${sheet.name} on ${chosen.paper} ${chosen.orientation}. Choose Save as PDF in the print dialog for a PDF.`,
      );
      // The view stays until the browser's print dialog closes (afterprint).
      window.print();
    });
    check();
  }
  return { open };
}
