// Fictional chart fixtures (T18): a small sales table for chart commands and
// a workbook with many charts for lazy ECharts instances.
import { VERSION } from "../model/workbook.mjs";

const text = (value, cellStyle = "normal") => ({
  input: { type: "text", value },
  cellStyle,
});
const number = (value) => ({ input: { type: "number", value } });

function base(id, cells, charts) {
  return {
    version: VERSION,
    id,
    title: "Fictional chart workbook",
    dateSystem: "excel1900",
    locale: "en-US",
    sheets: [
      { id: "data", name: "Data", cells },
      { id: "notes", name: "Notes", cells: { A1: text("Notes") } },
    ],
    groups: [],
    names: [],
    metadata: { fictional: true },
    ...(charts ? { charts } : {}),
  };
}

export function salesWorkbook() {
  const cells = {
    A1: text("Region", "header"),
    B1: text("Sales", "header"),
    C1: text("Costs", "header"),
    D1: text("Margin", "header"),
  };
  [
    ["North", 120, 80],
    ["South", 90, 70],
    ["West", 150, 95],
  ].forEach(([region, sales, costs], i) => {
    const r = i + 2;
    cells[`A${r}`] = text(region);
    cells[`B${r}`] = number(sales);
    cells[`C${r}`] = number(costs);
    cells[`D${r}`] = { formula: `=B${r}-C${r}` };
  });
  return base("fictional-sales-charts", cells);
}

// `count` column charts stacked down the sheet, every `step` rows.
export function manyCharts(count = 40, step = 10) {
  const cells = {
    A1: text("Item", "header"),
    B1: text("Value", "header"),
    A2: text("One"),
    B2: number(1),
    A3: text("Two"),
    B3: number(2),
  };
  const charts = Array.from({ length: count }, (_, i) => ({
    id: `c${i + 1}`,
    sheetId: "data",
    anchor: `D${1 + i * step}`,
    width: 320,
    height: 200,
    type: "column",
    options: { title: `Chart ${i + 1}`, unit: "units" },
    source: { sheetId: "data", ref: "A1:B3" },
  }));
  return base("fictional-many-charts", cells, charts);
}
