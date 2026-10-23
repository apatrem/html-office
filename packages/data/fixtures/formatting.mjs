// Fictional workbook exercising every ADR-012 rendering rule (F02).
export function formattingWorkbook() {
  const text = (value, extra = {}) => ({
    input: { type: "text", value },
    ...extra,
  });
  const number = (value, extra = {}) => ({
    input: { type: "number", value },
    ...extra,
  });
  const thin = { style: "thin", color: "ink" };
  return {
    version: "html-data/0.1",
    id: "fictional-formatting",
    title: "Fictional formatting showcase",
    dateSystem: "excel1900",
    locale: "en-US",
    font: "georgia",
    names: [],
    metadata: { fictional: true },
    conditionalFormats: [
      {
        id: "north",
        sheetId: "show",
        ref: "A3",
        kind: "highlight",
        condition: {
          operator: "eq",
          values: [{ type: "text", value: "North" }],
        },
        style: { fill: "dark" },
      },
      {
        id: "south",
        sheetId: "show",
        ref: "A4",
        kind: "highlight",
        condition: {
          operator: "eq",
          values: [{ type: "text", value: "South" }],
        },
        style: { fill: "tint" },
      },
      {
        id: "region",
        sheetId: "show",
        ref: "A2",
        kind: "highlight",
        condition: {
          operator: "eq",
          values: [{ type: "text", value: "Region" }],
        },
        style: { fill: "tint" },
      },
      {
        id: "loss",
        sheetId: "show",
        ref: "D10",
        kind: "highlight",
        condition: { operator: "lt", values: [{ type: "number", value: 0 }] },
        style: { fill: "lig" },
      },
      {
        id: "bars",
        sheetId: "show",
        ref: "B3:B4",
        kind: "dataBar",
        scale: { kind: "auto" },
        positive: "acc",
        negative: "alert",
      },
    ],
    groups: [
      { id: "main", name: "Summary", kind: "summary", sheetIds: ["show"] },
    ],
    sheets: [
      {
        id: "show",
        name: "Showcase",
        columns: { A: { width: 180 }, C: { style: { fill: "tint" } } },
        rows: { 6: { height: 50 }, 8: { style: { italic: true } } },
        cells: {
          A1: text("Quarterly review across all regions", {
            cellStyle: "title",
            style: {
              border: {
                top: { style: "thin", color: "acc" },
                left: { style: "thin", color: "acc" },
              },
            },
          }),
          A2: text("Region", { cellStyle: "header" }),
          B2: text("Revenue", {
            cellStyle: "header",
            style: { align: { horizontal: "right" } },
          }),
          C2: text("Margin", {
            cellStyle: "header",
            style: { align: { horizontal: "right" } },
          }),
          A3: text("North", { style: { bold: true, color: "acc" } }),
          B3: number(1234567, {
            format: {
              kind: "currency",
              currency: "EUR",
              digits: 1,
              scale: "millions",
            },
          }),
          C3: number(-0.042, {
            format: { kind: "percent", digits: 1, negative: "redParentheses" },
          }),
          A4: text("South", { style: { fill: "dark" } }),
          B4: number(98765, {
            format: { kind: "number", digits: 0, scale: "thousands" },
            style: { border: { bottom: { style: "medium", color: "acc" } } },
          }),
          C4: number(45292, { format: { kind: "date", dateStyle: "long" } }),
          A5: text("Total", { cellStyle: "total" }),
          B5: number(1333332, {
            cellStyle: "total",
            format: { kind: "number", digits: 0 },
          }),
          C5: text("ok", {
            cellStyle: "output",
            style: { align: { horizontal: "center" } },
          }),
          A6: text(
            "A wrapped note that runs over several lines in a taller row",
            { style: { align: { wrap: true } } },
          ),
          B6: text("Centred across", {
            style: {
              align: { horizontal: "centerContinuous" },
              border: { top: thin, bottom: thin },
            },
          }),
          C6: {
            style: {
              align: { horizontal: "centerContinuous" },
              border: { top: thin, bottom: thin },
            },
          },
          A8: text(
            "Row style: italic, with text overflowing into empty neighbours",
          ),
          B9: text("Right-aligned overflow to the left", {
            style: { align: { horizontal: "right" } },
          }),
          A10: { input: { type: "boolean", value: true } },
          D10: number(-12, {
            format: { kind: "number", digits: 0, negative: "red" },
            style: { fill: "dark" },
          }),
          D13: number(42, {
            style: { align: { horizontal: "centerContinuous" } },
          }),
          E13: { style: { align: { horizontal: "centerContinuous" } } },
          F13: { style: { align: { horizontal: "centerContinuous" } } },
        },
      },
    ],
  };
}
