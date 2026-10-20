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
      background: "#C6EFCE",
      color: "#006100",
      bold: true,
    }),
    rule("negative", "B2", "lt", 100, {
      background: "#FFC7CE",
      color: "#9C0006",
    }),
    rule("baseline", "B1:B2", "gte", 0, { background: "#FFEB9C" }),
  ];
  return book;
}
