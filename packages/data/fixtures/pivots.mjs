// Fictional sales records for pivot tests and the large pivot benchmark. The
// Sales sheet is a dense row table; "Adjusted" is a formula column driven by
// the Base/Upside scenario on Inputs, so refresh must follow the engine.
import { VERSION } from "../model/workbook.mjs";
const text = (value, cellStyle) => ({
  input: { type: "text", value },
  ...(cellStyle ? { cellStyle } : {}),
});
const money = { kind: "currency", currency: "EUR", digits: 2 };
const number = (value, format) => ({
  input: { type: "number", value },
  ...(format ? { format } : {}),
});
export const RECORDS = [
  ["North", "Q1", "Online", 10, 100],
  ["North", "Q1", "Store", 5, 50],
  ["North", "Q2", "Online", 8, 80],
  ["South", "Q1", "Online", 4, 40],
  ["South", "Q2", "Store", 6, 60],
  ["South", "Q2", "Online", 2, 20.5],
  ["East", "Q1", "Store", 3, 30],
  [null, "Q2", "Online", 1, 10],
];
const REGIONS = ["North", "South", "East", "West", "Central"],
  QUARTERS = ["Q1", "Q2", "Q3", "Q4"],
  CHANNELS = ["Online", "Store", "Partner"];
// rows: generate that many deterministic records instead of RECORDS;
// formulas: false omits the Adjusted formula column (the pivot sums Revenue).
export function pivotWorkbook({ rows, formulas = true } = {}) {
  const records = rows
    ? Array.from({ length: rows }, (_, i) => [
        REGIONS[i % 5],
        QUARTERS[Math.floor(i / 5) % 4],
        CHANNELS[Math.floor(i / 20) % 3],
        1 + (i % 7),
        10 + ((i * 37) % 1000) / 4,
      ])
    : RECORDS;
  const sales = {
      id: "sales",
      name: "Sales",
      metadata: { layout: "table" },
      cells: {},
    },
    inputs = { id: "inputs", name: "Inputs", cells: {} },
    summary = { id: "summary", name: "Summary", cells: {} };
  ["Region", "Quarter", "Channel", "Units", "Revenue"].forEach(
    (label, i) => (sales.cells[`${"ABCDE"[i]}1`] = text(label, "header")),
  );
  if (formulas) sales.cells.F1 = text("Adjusted", "header");
  records.forEach(([region, quarter, channel, units, revenue], i) => {
    const row = i + 2;
    if (region !== null) sales.cells[`A${row}`] = text(region);
    sales.cells[`B${row}`] = text(quarter);
    sales.cells[`C${row}`] = text(channel);
    sales.cells[`D${row}`] = number(units);
    sales.cells[`E${row}`] = number(revenue, money);
    if (formulas)
      sales.cells[`F${row}`] = {
        formula: `=E${row}*Inputs!$B$2`,
        format: money,
      };
  });
  inputs.cells.A1 = text("Scenario", "rowHeader");
  inputs.cells.B1 = text("Base");
  inputs.cells.A2 = text("Revenue factor", "rowHeader");
  inputs.cells.B2 = { formula: '=IF(B1="Upside",1.1,1)' };
  summary.cells.A1 = text("Sales summary", "title");
  return {
    version: VERSION,
    id: "fictional-sales-pivots",
    title: "Fictional sales — pivot tables",
    dateSystem: "excel1900",
    locale: "en-US",
    sheets: [summary, inputs, sales],
    groups: [
      {
        id: "g-summary",
        name: "Summary",
        kind: "summary",
        sheetIds: ["summary"],
      },
      { id: "g-inputs", name: "Inputs", kind: "inputs", sheetIds: ["inputs"] },
      { id: "g-raw", name: "Raw Data", kind: "raw", sheetIds: ["sales"] },
    ],
    names: [],
    validations: [
      {
        id: "scenario",
        sheetId: "inputs",
        ref: "B1",
        source: {
          kind: "list",
          values: [
            { type: "text", value: "Base" },
            { type: "text", value: "Upside" },
          ],
        },
      },
    ],
    scenario: { validationId: "scenario" },
    pivots: [
      {
        id: "byRegion",
        name: "Revenue by region",
        source: { sheetId: "sales" },
        output: { sheetId: "summary", ref: "B3" },
        rows: ["Region"],
        columns: ["Quarter"],
        filters: [],
        values: [
          { field: formulas ? "Adjusted" : "Revenue", aggregate: "sum" },
        ],
      },
    ],
    metadata: { fictional: true },
  };
}
