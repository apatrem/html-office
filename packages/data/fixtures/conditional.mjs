import { scenarioWorkbook } from "./scenarios.mjs";
export function conditionalWorkbook() {
  const book = scenarioWorkbook();
  book.id = "fictional-conditional-ui";
  book.title = "Fictional conditional profit analysis";
  const rule = (id, ref, operator, threshold, style) => ({
    id,
    sheetId: "summary",
    ref,
    kind: "highlight",
    condition: { operator, values: [{ type: "number", value: threshold }] },
    style,
  });
  book.conditionalFormats = [
    rule("positive", "B2", "gte", 300, {
      fill: "lig",
      color: "acc",
      bold: true,
    }),
    rule("negative", "B2", "lt", 100, {
      fill: "alert",
    }),
    rule("baseline", "B1:B2", "gte", 0, { fill: "tint" }),
  ];
  return book;
}
