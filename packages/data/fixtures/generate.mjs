import { VERSION, address } from "../model/workbook.mjs";
const input = (
  value,
  role = "normal",
  format = { kind: "number", digits: 0 },
) => ({
  input: { type: typeof value === "string" ? "text" : "number", value },
  role,
  format,
});
const formula = (value, format = { kind: "number", digits: 0 }) => ({
  formula: value,
  role: "calculation",
  format,
});
const money = { kind: "currency", currency: "EUR", digits: 0 },
  percent = { kind: "percent", digits: 1 };
function base(id, title, sheets) {
  return {
    version: VERSION,
    id,
    title,
    dateSystem: "excel1900",
    locale: "en-US",
    sheets,
    groups: [],
    names: [],
    metadata: { fictional: true },
  };
}
export function pnl() {
  const summary = { id: "summary", name: "Summary", cells: {} },
    assumptions = { id: "inputs", name: "Inputs", cells: {} },
    raw = { id: "raw", name: "Actuals", cells: {} },
    calc = { id: "calc", name: "Calculations", cells: {} };
  const book = base(
    "community-learning-pnl",
    "Community Learning — fictional 24-month P&L",
    [summary, assumptions, raw, calc],
  );
  book.groups = [
    { id: "summary-group", name: "Summary", sheetIds: ["summary"] },
    { id: "inputs-group", name: "Inputs / Hypotheses", sheetIds: ["inputs"] },
    { id: "raw-group", name: "Raw Data", sheetIds: ["raw"] },
    { id: "calc-group", name: "Calculations", sheetIds: ["calc"] },
  ];
  const a = assumptions.cells;
  for (const [row, label, value, f] of [
    [2, "Monthly participant growth", 0.02, percent],
    [3, "Fee per participant", 25, money],
    [4, "Variable cost per participant", 8, money],
    [5, "Monthly fixed costs", 1500, money],
    [6, "Tax rate", 0.2, percent],
    [7, "Annual discount rate", 0.1, percent],
    [8, "Initial investment", 10000, money],
  ]) {
    a[`A${row}`] = input(label, "rowHeader");
    a[`B${row}`] = input(value, "assumption", f);
  }
  a.A1 = input("Planning assumptions", "header");
  raw.cells.A1 = input("Month", "header");
  raw.cells.B1 = input("Participants", "header");
  for (let m = 0; m < 12; m++) {
    raw.cells[`A${m + 2}`] = input(m + 1);
    raw.cells[`B${m + 2}`] = input(100 + m * 5);
  }
  const labels = {
    1: "Monthly P&L",
    2: "Period",
    3: "Participants",
    4: "Revenue",
    5: "Variable costs",
    6: "Contribution",
    7: "Fixed costs",
    8: "Operating profit",
    9: "Tax",
    10: "Net income",
    11: "Operating margin",
    12: "Operating cash flow",
  };
  for (const [r, label] of Object.entries(labels))
    calc.cells[`A${r}`] = input(
      label,
      Number(r) === 1 ? "header" : "rowHeader",
    );
  let totalRevenue = 0,
    totalIncome = 0,
    expectedNPV = -10000,
    last = 155;
  for (let m = 0; m < 24; m++) {
    const col = address(1, m + 2).replace("1", ""),
      previous = address(1, m + 1).replace("1", ""),
      c = calc.cells;
    c[`${col}1`] = input(
      m < 12 ? `Actual ${m + 1}` : `Forecast ${m - 11}`,
      "header",
    );
    c[`${col}2`] = input(m + 1);
    c[`${col}3`] = formula(
      m < 12 ? `=Actuals!B${m + 2}` : `=${previous}3*(1+Inputs!$B$2)`,
    );
    for (const [r, expression, f] of [
      [4, `${col}3*Inputs!$B$3`, money],
      [5, `${col}3*Inputs!$B$4`, money],
      [6, `${col}4-${col}5`, money],
      [7, "Inputs!$B$5", money],
      [8, `${col}6-${col}7`, money],
      [9, `MAX(0,${col}8*Inputs!$B$6)`, money],
      [10, `${col}8-${col}9`, money],
      [11, `IFERROR(${col}8/${col}4,0)`, percent],
      [12, `${col}10`, money],
    ])
      c[`${col}${r}`] = formula("=" + expression, f);
    const participants = m < 12 ? 100 + m * 5 : (last *= 1.02);
    totalRevenue += participants * 25;
    const op = participants * 17 - 1500;
    totalIncome += op - Math.max(0, op * 0.2);
    expectedNPV += (op - Math.max(0, op * 0.2)) / 1.1 ** ((m + 1) / 12);
  }
  for (const [r, label, f] of [
    [2, "Total revenue", "=SUM(Calculations!B4:Y4)"],
    [3, "Net income", "=SUM(Calculations!B10:Y10)"],
    [
      4,
      "Cash flow NPV (initial investment separate)",
      "=NPV((1+Inputs!B7)^(1/12)-1,Calculations!B12:Y12)-Inputs!B8",
    ],
  ]) {
    summary.cells[`A${r}`] = input(label, "rowHeader");
    summary.cells[`B${r}`] = formula(f, money);
  }
  summary.cells.A1 = input("24-month business review", "header");
  book.metadata.benchmark = {
    kind: "pnl",
    months: 24,
    actualMonths: 12,
    forecastMonths: 12,
    expectedRevenue: totalRevenue,
    expectedNetIncome: totalIncome,
    expectedNPV,
  };
  return book;
}
export function large({
  rows = 50000,
  columns = 8,
  preaggregate = false,
} = {}) {
  if (![2, 8].includes(columns))
    throw new Error("Use the explicit 2- or 8-column fixture");
  const raw = { id: "raw", name: "Raw", cells: {} },
    calc = { id: "calc", name: "Calculations", cells: {} },
    summary = { id: "summary", name: "Summary", cells: {} };
  const book = base(
    `large-${rows}-${columns}-${preaggregate ? "reused" : "scans"}`,
    `Fictional ${rows.toLocaleString("en-US")}-row dataset`,
    [raw, calc, summary],
  );
  let expected = 0;
  for (let r = 1; r <= rows; r++) {
    const region = ["North", "South", "West", "East"][(r - 1) % 4],
      visits = (r % 10) + 1,
      revenue = visits * 25;
    const values =
      columns === 2
        ? [region, revenue]
        : [
            r,
            region,
            ((r - 1) % 12) + 1,
            visits,
            25,
            revenue,
            (r % 7) * 3,
            "Community programme",
          ];
    values.forEach((value, c) => (raw.cells[address(r, c + 1)] = input(value)));
    if (region === "North") expected += revenue;
  }
  const valueCol = columns === 2 ? "B" : "F",
    regionCol = columns === 2 ? "A" : "B";
  const aggregate = `SUMIFS(Raw!${valueCol}1:${valueCol}${rows},Raw!${regionCol}1:${regionCol}${rows},"North")`;
  if (preaggregate) summary.cells.B2 = formula("=" + aggregate);
  for (let r = 1; r <= 1000; r++)
    calc.cells[`A${r}`] = formula(
      preaggregate ? "=Summary!$B$2" : "=" + aggregate,
    );
  book.metadata.benchmark = {
    kind: "large",
    rows,
    populatedColumns: columns,
    formulaCount: preaggregate ? 1001 : 1000,
    fullRangeScans: preaggregate ? 1 : 1000,
    preaggregate,
    expectedTotal: expected,
    editedRawCell: `${valueCol}1`,
    editedInitialValue: 50,
  };
  return book;
}
export function lookup() {
  const book = large({ rows: 2000, columns: 8, preaggregate: true });
  book.id = "lookup-fixture";
  book.title = "Fictional programme lookup model";
  const c = book.sheets[1].cells;
  for (let r = 1; r <= 1000; r++)
    c[`A${r}`] = formula(`=XLOOKUP(${r},Raw!A1:A2000,Raw!F1:F2000)`);
  book.metadata.benchmark = {
    kind: "lookup",
    rows: 2000,
    lookupFormulas: 1000,
  };
  return book;
}
