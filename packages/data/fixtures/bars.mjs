import { conditionalWorkbook } from "./conditional.mjs";
export function dataBarWorkbook() {
  const book = conditionalWorkbook(),
    sheet = book.sheets[0];
  for (const [ref, value] of Object.entries({
    F3: -100,
    F4: 50,
    F5: 0,
    F6: 200,
    F7: -25,
    H3: -100,
    H4: 50,
    H5: 200,
  }))
    sheet.cells[ref] = { input: { type: "number", value } };
  sheet.cells.F8 = { input: { type: "text", value: "" } };
  sheet.cells.F9 = { input: { type: "error", value: "#DIV/0!" } };
  sheet.cells.F10 = {
    input: { type: "date", value: 60 },
    format: { kind: "date" },
  };
  const bar = (id, ref, scale) => ({
    id,
    sheetId: "summary",
    ref,
    kind: "dataBar",
    scale,
    positiveColor: "acc",
    negativeColor: "alert",
  });
  book.conditionalFormats.push(
    bar("mixed", "F3:F10", { kind: "auto" }),
    bar("clipped", "H3:H5", { kind: "fixed", min: -100, max: 100 }),
    bar("profit", "B2", { kind: "auto" }),
  );
  return book;
}
