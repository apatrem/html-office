export function scenarioWorkbook() {
  const text = (value) => ({ input: { type: "text", value } });
  const number = (value) => ({
    input: { type: "number", value },
    role: "assumption",
    format: { kind: "percent", digits: 1 },
  });
  const money = (formula) => ({
    formula,
    role: "calculation",
    format: { kind: "currency", currency: "EUR", digits: 2 },
  });
  return {
    version: "html-data/0.1",
    id: "fictional-scenarios-ui",
    title: "Fictional scenario analysis",
    dateSystem: "excel1900",
    locale: "en-US",
    names: [],
    metadata: { fictional: true },
    groups: [
      {
        id: "summary_group",
        name: "Summary",
        kind: "summary",
        sheetIds: ["summary"],
      },
      {
        id: "inputs_group",
        name: "Inputs / Hypotheses",
        kind: "inputs",
        sheetIds: ["inputs"],
      },
      { id: "raw_group", name: "Raw Data", kind: "raw", sheetIds: [] },
      {
        id: "calc_group",
        name: "Calculations",
        kind: "calculations",
        sheetIds: [],
      },
    ],
    sheets: [
      {
        id: "summary",
        name: "Summary",
        cells: {
          A1: { ...text("Revenue"), role: "rowHeader" },
          B1: money("=1000*(1+Inputs!B8)"),
          A2: { ...text("Profit"), role: "rowHeader" },
          B2: money("=B1*Inputs!C8"),
          D1: text("Currency"),
          D2: text("EUR"),
          F1: text("Selected rate"),
          F2: number(0.2),
        },
      },
      {
        id: "inputs",
        name: "Inputs",
        cells: {
          A1: text("Scenario"),
          B1: { ...text("Base"), role: "assumption" },
          A3: { ...text("Case"), role: "header" },
          B3: { ...text("Growth"), role: "header" },
          C3: { ...text("Margin"), role: "header" },
          A4: text("Base"),
          A5: text("Upside"),
          A6: text("Downside"),
          B4: number(0.1),
          B5: number(0.2),
          B6: number(-0.05),
          C4: number(0.2),
          C5: number(0.25),
          C6: number(0.1),
          B8: { formula: "=XLOOKUP(B1,A4:A6,B4:B6)" },
          C8: { formula: "=XLOOKUP(B1,A4:A6,C4:C6)" },
          B10: { formula: "=B8" },
          B11: { formula: "=C8" },
        },
      },
    ],
    validations: [
      {
        id: "scenario",
        sheetId: "inputs",
        ref: "B1",
        source: { kind: "range", sheetId: "inputs", ref: "A4:A6" },
      },
      {
        id: "currency",
        sheetId: "summary",
        ref: "D2",
        source: {
          kind: "list",
          values: ["EUR", "USD"].map((value) => ({ type: "text", value })),
        },
      },
      {
        id: "rate",
        sheetId: "summary",
        ref: "F2",
        source: { kind: "range", sheetId: "inputs", ref: "B10:B11" },
      },
    ],
    scenario: { validationId: "scenario" },
  };
}
