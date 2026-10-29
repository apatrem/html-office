#!/usr/bin/env node
// T21: writes the inputs of the fictional P&L acceptance workbook, as an
// author following the html-data skill would: the canonical model
// (model.json, built with `workbook.mjs new`), the two CSV files a person
// imports and refreshes in the browser, and the patch that links the
// imported records to the model (`workbook.mjs apply`). Every figure is
// invented. `--check` fails when a committed file differs from this script.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// ---- cells ----
const text = (value, cellStyle) => ({
  input: { type: "text", value },
  ...(cellStyle && { cellStyle }),
});
const number = (value, cellStyle, format) => ({
  input: { type: "number", value },
  ...(cellStyle && { cellStyle }),
  ...(format && { format }),
});
const formula = (expression, cellStyle = "calculation", format) => ({
  formula: expression,
  cellStyle,
  ...(format && { format }),
});
const EUR = { kind: "currency", currency: "EUR", digits: 0 },
  EUR2 = { kind: "currency", currency: "EUR", digits: 2 },
  KEUR = { kind: "currency", currency: "EUR", digits: 1, scale: "thousands" },
  CASH = {
    kind: "accounting",
    currency: "EUR",
    digits: 0,
    negative: "parentheses",
  },
  PCT = { kind: "percent", digits: 1 },
  INT = { kind: "number", digits: 0 },
  DATE = { kind: "date", dateStyle: "short" },
  DEC = { kind: "number", digits: 2 };

// Month columns: B is month 1 (January 2025), Y month 24 (December 2026).
const column = (n) => {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const month = (m) => column(m + 1);
const MONTHS = 24,
  ACTUAL = 12;

// ---- the fictional records (imported in the browser, never by tools) ----
export const STATIONS = ["North", "South", "East", "West"];
const BASE = { North: 520, South: 430, East: 360, West: 290 },
  SEASON = [0.55, 0.6, 0.8, 1, 1.2, 1.35, 1.5, 1.45, 1.15, 0.9, 0.65, 0.5],
  PLANS = { Member: 0.6, Casual: 0.4 };
const iso = (m) =>
  new Date(Date.UTC(2025, m + 1, 0)).toISOString().slice(0, 10);
// Notes test TRIM (edge and inner spaces) and CLEAN (a line break).
const NOTES = {
  "6/North/Member": "  Riverside   festival week  ",
  "11/West/Casual": "Storm damage\nWest dock closed",
  "3/East/Member": "Spring open day",
};
function records(version) {
  const rows = [];
  for (let m = 0; m < 12; m++)
    for (const station of STATIONS)
      for (const [plan, share] of Object.entries(PLANS)) {
        let rentals = Math.round(BASE[station] * SEASON[m] * share);
        // Version 2: late December registrations and an August correction.
        if (version === 2 && m === 11) rentals = Math.round(rentals * 1.12);
        if (
          version === 2 &&
          m === 7 &&
          station === "South" &&
          plan === "Casual"
        )
          rentals -= 25;
        rows.push([
          iso(m),
          station,
          plan,
          rentals,
          NOTES[`${m}/${station}/${plan}`] ?? "",
        ]);
      }
  // Version 2 adds the Harbour station, opened in October 2025.
  if (version === 2)
    for (const m of [9, 10, 11])
      for (const [plan, share] of Object.entries(PLANS))
        rows.push([
          iso(m),
          "Harbour",
          plan,
          Math.round(240 * SEASON[m] * share),
          "",
        ]);
  return rows;
}
const field = (v) =>
  typeof v === "string" && /[",\n]|^\s|\s$/.test(v)
    ? `"${v.replace(/"/g, '""')}"`
    : String(v);
export const csv = (version) =>
  [["Month", "Station", "Plan", "Rentals", "Note"], ...records(version)]
    .map((r) => r.map(field).join(","))
    .join("\r\n") + "\r\n";

// Monthly totals of version 1, typed into Monthly actuals before the import.
const monthlyTotals = () => {
  const totals = Array(12).fill(0);
  records(1).forEach(
    ([, , , rentals], i) => (totals[Math.floor(i / 8)] += rentals),
  );
  return totals;
};

// ---- the model ----
// Assumption rows, referenced by the formulas below.
const A = {
  scenario: 3,
  names: 5,
  growth: 6,
  price: 7,
  selGrowth: 9,
  selPrice: 10,
  first: 13,
  lastActual: 14,
  unitPrice: 15,
  unitCost: 16,
  fixed: 17,
  depreciation: 18,
  capex: 19,
  workingCapital: 20,
  tax: 21,
  discount: 22,
  investment: 23,
  monthlyRate: 24,
};
const $A = (key) => `Assumptions!$B$${A[key]}`;

function assumptions() {
  const c = {
    A1: text("Planning assumptions", "title"),
    A2: text("Yellow cells are inputs; change them to test the plan.", "note"),
    A3: text("Scenario", "rowHeader"),
    B3: text("Base", "assumption"),
    A5: text("Scenario values", "header"),
    B5: text("Base", "header"),
    C5: text("Low", "header"),
    D5: text("High", "header"),
    A6: text("Year-on-year rental growth", "rowHeader"),
    A7: text("Forecast price change", "rowHeader"),
    A9: text("Selected rental growth", "rowHeader"),
    B9: formula(
      `=INDEX(B${A.growth}:D${A.growth},MATCH(B${A.scenario},B${A.names}:D${A.names},0))`,
      "calculation",
      PCT,
    ),
    A10: text("Selected price change", "rowHeader"),
    B10: formula(
      `=IFS(B${A.scenario}="Base",B${A.price},B${A.scenario}="Low",C${A.price},B${A.scenario}="High",D${A.price})`,
      "calculation",
      PCT,
    ),
    A12: text("Operating assumptions", "header"),
    B12: text("Value", "header"),
  };
  [
    ["B", 0.08, 0.03],
    ["C", 0.02, 0],
    ["D", 0.15, 0.05],
  ].forEach(([col, growth, price]) => {
    c[`${col}${A.growth}`] = number(growth, "assumption", PCT);
    c[`${col}${A.price}`] = number(price, "assumption", PCT);
  });
  for (const [key, label, cell] of [
    ["first", "First month", number(45658, "assumption", DATE)],
    [
      "lastActual",
      "Last actual month end",
      formula(`=EOMONTH(B${A.first},11)`, "calculation", DATE),
    ],
    ["unitPrice", "Price per rental", number(6.5, "assumption", EUR2)],
    ["unitCost", "Variable cost per rental", number(1.4, "assumption", EUR2)],
    ["fixed", "Monthly fixed costs", number(6000, "assumption", EUR)],
    ["depreciation", "Monthly depreciation", number(1000, "assumption", EUR)],
    ["capex", "Monthly fleet capex", number(800, "assumption", EUR)],
    [
      "workingCapital",
      "Working capital (% of monthly revenue)",
      number(0.1, "assumption", PCT),
    ],
    [
      "tax",
      "Tax rate on monthly operating profit",
      number(0.25, "assumption", PCT),
    ],
    ["discount", "Annual discount rate", number(0.09, "assumption", PCT)],
    [
      "investment",
      "Initial investment (start of month 1)",
      number(20000, "assumption", EUR),
    ],
    [
      "monthlyRate",
      "Monthly discount rate",
      formula(`=(1+B${A.discount})^(1/12)-1`, "calculation", {
        kind: "percent",
        digits: 3,
      }),
    ],
  ]) {
    c[`A${A[key]}`] = text(label, "rowHeader");
    c[`B${A[key]}`] = cell;
  }
  return c;
}

function actuals() {
  const c = {
    A1: text("Month end", "header"),
    B1: text("Rentals", "header"),
  };
  monthlyTotals().forEach((total, m) => {
    c[`A${m + 2}`] = {
      input: {
        type: "number",
        value:
          45688 + [0, 28, 59, 89, 120, 150, 181, 212, 242, 273, 303, 334][m],
      },
      format: DATE,
    };
    c[`B${m + 2}`] = number(total, undefined, INT);
  });
  return c;
}

// P&L rows.
const P = {
  date: 2,
  period: 3,
  rentals: 4,
  price: 5,
  revenue: 6,
  variable: 7,
  contribution: 8,
  fixed: 9,
  ebitda: 10,
  depreciation: 11,
  operating: 12,
  tax: 13,
  net: 14,
  margin: 15,
};
function pnl() {
  const c = {
    A1: text("Monthly P&L (EUR)", "title"),
    A2: text("Month end", "header"),
    A3: text("Period", "rowHeader"),
    A4: text("Rentals", "rowHeader"),
    A5: text("Price per rental", "rowHeader"),
    A6: text("Revenue", "rowHeader"),
    A7: text("Variable costs", "rowHeader"),
    A8: text("Contribution", "rowHeader"),
    A9: text("Fixed costs", "rowHeader"),
    A10: text("EBITDA", "rowHeader"),
    A11: text("Depreciation", "rowHeader"),
    A12: text("Operating profit", "rowHeader"),
    A13: text("Tax", "rowHeader"),
    A14: text("Net income", "total"),
    A15: text("Operating margin", "rowHeader"),
  };
  for (let m = 1; m <= MONTHS; m++) {
    const x = month(m),
      actual = m <= ACTUAL;
    Object.assign(c, {
      [`${x}2`]: formula(
        m === 1 ? `=EOMONTH(${$A("first")},0)` : `=EOMONTH(${month(m - 1)}2,1)`,
        "header",
        DATE,
      ),
      [`${x}3`]: formula(`=IF(${x}2<=${$A("lastActual")},"Actual","Forecast")`),
      [`${x}4`]: formula(
        actual
          ? `=XLOOKUP(${x}$2,'Monthly actuals'!$A$2:$A$13,'Monthly actuals'!$B$2:$B$13)`
          : `=${month(m - 12)}4*(1+${$A("selGrowth")})`,
        "calculation",
        INT,
      ),
      [`${x}5`]: formula(
        actual
          ? `=${$A("unitPrice")}`
          : `=${$A("unitPrice")}*(1+${$A("selPrice")})`,
        "calculation",
        EUR2,
      ),
      [`${x}6`]: formula(`=${x}4*${x}5`, "calculation", EUR),
      [`${x}7`]: formula(`=${x}4*${$A("unitCost")}`, "calculation", EUR),
      [`${x}8`]: formula(`=${x}6-${x}7`, "calculation", EUR),
      [`${x}9`]: formula(`=${$A("fixed")}`, "calculation", EUR),
      [`${x}10`]: formula(`=${x}8-${x}9`, "calculation", EUR),
      [`${x}11`]: formula(`=${$A("depreciation")}`, "calculation", EUR),
      [`${x}12`]: formula(`=${x}10-${x}11`, "calculation", EUR),
      [`${x}13`]: formula(`=MAX(0,${x}12*${$A("tax")})`, "calculation", EUR),
      [`${x}14`]: formula(`=${x}12-${x}13`, "total", EUR),
      [`${x}15`]: formula(`=IFERROR(${x}12/${x}6,0)`, "calculation", PCT),
    });
  }
  return c;
}

function cash() {
  const c = {
    A1: text("Monthly cash flow (EUR)", "title"),
    A2: text("Month end", "header"),
    A3: text("Net income", "rowHeader"),
    A4: text("Add back depreciation", "rowHeader"),
    A5: text("Fleet capex", "rowHeader"),
    A6: text("Change in working capital", "rowHeader"),
    A7: text("Free cash flow", "total"),
    A8: text("Cumulative cash after the initial investment", "rowHeader"),
  };
  for (let m = 1; m <= MONTHS; m++) {
    const x = month(m),
      p = month(m - 1);
    Object.assign(c, {
      [`${x}2`]: formula(`='P&L'!${x}2`, "header", DATE),
      [`${x}3`]: formula(`='P&L'!${x}14`, "calculation", CASH),
      [`${x}4`]: formula(`='P&L'!${x}11`, "calculation", CASH),
      [`${x}5`]: formula(`=-${$A("capex")}`, "calculation", CASH),
      [`${x}6`]: formula(
        m === 1
          ? `=-${$A("workingCapital")}*'P&L'!${x}6`
          : `=-${$A("workingCapital")}*('P&L'!${x}6-'P&L'!${p}6)`,
        "calculation",
        CASH,
      ),
      [`${x}7`]: formula(`=SUM(${x}3:${x}6)`, "total", CASH),
      [`${x}8`]: formula(
        m === 1 ? `=${x}7-InitialInvestment` : `=${p}8+${x}7`,
        "calculation",
        CASH,
      ),
    });
  }
  return c;
}

// Summary rows 7–11: B actual year, C forecast year, D 24 months, E growth.
function summary() {
  const c = {
    A1: text("Fictional bike rental co-op: 24-month review", "title"),
    A2: text("Illustrative model: every figure is invented.", "note"),
    A4: text("Scenario", "rowHeader"),
    B4: formula(`=Assumptions!B${A.scenario}`, "output"),
    A6: text("EUR", "header"),
    B6: text("Actual 2025", "header"),
    C6: text("Forecast 2026", "header"),
    D6: text("24 months", "header"),
    E6: text("Growth", "header"),
  };
  [
    [7, "Rentals", "'P&L'!$B$4:$Y$4", INT],
    [8, "Revenue", "'P&L'!$B$6:$Y$6", KEUR],
    [9, "EBITDA", "'P&L'!$B$10:$Y$10", KEUR],
    [10, "Net income", "'P&L'!$B$14:$Y$14", KEUR],
    [11, "Free cash flow", "'Cash flow'!$B$7:$Y$7", KEUR],
  ].forEach(([r, label, range, format]) => {
    c[`A${r}`] = text(label, "rowHeader");
    c[`B${r}`] = formula(
      `=SUMIFS(${range},'P&L'!$B$3:$Y$3,"Actual")`,
      "calculation",
      format,
    );
    c[`C${r}`] = formula(
      `=SUMIFS(${range},'P&L'!$B$3:$Y$3,"Forecast")`,
      "calculation",
      format,
    );
    c[`D${r}`] = formula(`=SUM(${range})`, "output", format);
    c[`E${r}`] = formula(`=IFERROR(C${r}/B${r}-1,"")`, "calculation", PCT);
  });
  Object.assign(c, {
    A13: text("Cash-flow NPV (initial investment separate)", "rowHeader"),
    B13: formula(
      `=NPV(${$A("monthlyRate")},'Cash flow'!B7:Y7)-InitialInvestment`,
      "output",
      EUR,
    ),
    A14: text("Loss-making months", "rowHeader"),
    B14: formula(`=COUNTIF('P&L'!B14:Y14,"<0")`, "calculation", INT),
    A15: text("Average operating margin", "rowHeader"),
    B15: formula(`=AVERAGE('P&L'!B15:Y15)`, "calculation", PCT),
    A16: text("Lowest cumulative cash", "rowHeader"),
    B16: formula(`=MIN('Cash flow'!B8:Y8)`, "calculation", CASH),
    A18: text("Every reference function, applied to this model", "hyperlink"),
  });
  return c;
}

// Chart data blocks, header row first.
function chartData() {
  const c = {
    A1: text("Month", "header"),
    B1: text("Revenue", "header"),
    C1: text("Net income", "header"),
    E1: text("Item", "header"),
    F1: text("EUR", "header"),
    G1: text("Total", "header"),
    I1: text("Scenario", "header"),
    J1: text("2026 revenue", "header"),
    K1: text("2026 contribution", "header"),
  };
  for (let m = 1; m <= MONTHS; m++) {
    const x = month(m);
    c[`A${m + 1}`] = formula(`=TEXT('P&L'!${x}2,"mmm")`);
    c[`B${m + 1}`] = formula(`='P&L'!${x}6`, "calculation", EUR);
    c[`C${m + 1}`] = formula(`='P&L'!${x}14`, "calculation", EUR);
  }
  // 24-month bridge from revenue to net income.
  [
    ["Revenue", "=SUM('P&L'!B6:Y6)", true],
    ["Variable costs", "=-SUM('P&L'!B7:Y7)"],
    ["Fixed costs", "=-SUM('P&L'!B9:Y9)"],
    ["Depreciation", "=-SUM('P&L'!B11:Y11)"],
    ["Tax", "=-SUM('P&L'!B13:Y13)"],
    ["Net income", null, true],
  ].forEach(([label, expression, total], i) => {
    c[`E${i + 2}`] = text(label, "rowHeader");
    if (expression) c[`F${i + 2}`] = formula(expression, "calculation", EUR);
    if (total) c[`G${i + 2}`] = { input: { type: "boolean", value: true } };
  });
  // 2026 by scenario, without switching the selector: forecast rentals are
  // the 2025 month times (1 + growth), so the totals are linear.
  ["B", "C", "D"].forEach((col, i) => {
    const r = i + 2,
      rentals = `SUM('P&L'!$B$4:$M$4)*(1+Assumptions!${col}$${A.growth})`,
      price = `${$A("unitPrice")}*(1+Assumptions!${col}$${A.price})`;
    c[`I${r}`] = formula(`=Assumptions!${col}$${A.names}`, "rowHeader");
    c[`J${r}`] = formula(`=${rentals}*${price}`, "calculation", EUR);
    c[`K${r}`] = formula(
      `=${rentals}*(${price}-${$A("unitCost")})`,
      "calculation",
      EUR,
    );
  });
  return c;
}

// ---- the formula analysis: every function of the V1 formula contract ----
// [family, function, question, formula, format]. The rows reading the P&L
// are in the model; those reading the imported records come with the patch.
const PL = (row) => `'P&L'!B${row}:Y${row}`;
const MODEL_ANALYSIS = [
  ["Aggregation", "SUM", "Revenue over 24 months", `=SUM(${PL(6)})`, EUR],
  [
    "Aggregation",
    "SUMIF",
    "Forecast net income",
    `=SUMIF(${PL(3)},"Forecast",${PL(14)})`,
    EUR,
  ],
  [
    "Aggregation",
    "SUMIFS",
    "Actual revenue in months above €15,000",
    `=SUMIFS(${PL(6)},${PL(3)},"Actual",${PL(6)},">15000")`,
    EUR,
  ],
  [
    "Aggregation",
    "COUNT",
    "Months with a month-end date",
    `=COUNT(${PL(2)})`,
    INT,
  ],
  [
    "Aggregation",
    "COUNTIF",
    "Loss-making months",
    `=COUNTIF(${PL(14)},"<0")`,
    INT,
  ],
  [
    "Aggregation",
    "COUNTIFS",
    "Forecast months with a loss",
    `=COUNTIFS(${PL(3)},"Forecast",${PL(14)},"<0")`,
    INT,
  ],
  ["Aggregation", "COUNTA", "Labelled P&L lines", `=COUNTA('P&L'!A2:A20)`, INT],
  [
    "Aggregation",
    "AVERAGE",
    "Average monthly revenue",
    `=AVERAGE(${PL(6)})`,
    EUR,
  ],
  [
    "Aggregation",
    "AVERAGEIF",
    "Average actual monthly revenue",
    `=AVERAGEIF(${PL(3)},"Actual",${PL(6)})`,
    EUR,
  ],
  [
    "Aggregation",
    "AVERAGEIFS",
    "Average forecast revenue in profitable months",
    `=AVERAGEIFS(${PL(6)},${PL(3)},"Forecast",${PL(14)},">0")`,
    EUR,
  ],
  ["Aggregation", "MIN", "Lowest monthly net income", `=MIN(${PL(14)})`, EUR],
  ["Aggregation", "MAX", "Highest monthly net income", `=MAX(${PL(14)})`, EUR],
  [
    "Aggregation",
    "SUBTOTAL",
    "2025 EBITDA (SUBTOTAL 9)",
    `=SUBTOTAL(9,'P&L'!B10:M10)`,
    EUR,
  ],
  [
    "Logic",
    "IF",
    "Is the cash-flow NPV positive?",
    `=IF(Summary!B13>0,"Yes","No")`,
  ],
  [
    "Logic",
    "IFS",
    "Margin band of the last forecast month",
    `=IFS('P&L'!Y15>=0.2,"High",'P&L'!Y15>=0.1,"Medium",TRUE,"Low")`,
  ],
  [
    "Logic",
    "AND",
    "Revenue and net income both grow in 2026",
    `=AND(Summary!C8>Summary!B8,Summary!C10>Summary!B10)`,
  ],
  [
    "Logic",
    "OR",
    "A loss in any summer month of 2025",
    `=OR('P&L'!G14<0,'P&L'!H14<0,'P&L'!I14<0)`,
  ],
  [
    "Logic",
    "NOT",
    "Scenario other than Base",
    `=NOT(Assumptions!B${A.scenario}="Base")`,
  ],
  [
    "Logic",
    "IFERROR",
    "Net margin of July 2025",
    `=IFERROR('P&L'!H14/'P&L'!H6,0)`,
    PCT,
  ],
  [
    "Logic",
    "IFNA",
    "Month with revenue of exactly €10,000",
    `=IFNA(XLOOKUP(10000,${PL(6)},${PL(2)}),"none")`,
  ],
  [
    "Lookup",
    "XLOOKUP",
    "Month of the highest revenue",
    `=XLOOKUP(MAX(${PL(6)}),${PL(6)},${PL(2)})`,
    DATE,
  ],
  [
    "Lookup",
    "INDEX",
    "Net income in the month of the lowest revenue",
    `=INDEX(${PL(14)},MATCH(MIN(${PL(6)}),${PL(6)},0))`,
    EUR,
  ],
  [
    "Lookup",
    "MATCH",
    "Position of the first forecast month",
    `=MATCH("Forecast",${PL(3)},0)`,
    INT,
  ],
  [
    "Numbers",
    "ROUND",
    "Average monthly rentals, rounded",
    `=ROUND(AVERAGE(${PL(4)}),0)`,
    INT,
  ],
  [
    "Numbers",
    "ROUNDUP",
    "Bikes for the peak month at 30 rentals per bike",
    `=ROUNDUP(MAX(${PL(4)})/30,0)`,
    INT,
  ],
  [
    "Numbers",
    "ROUNDDOWN",
    "Whole thousands of 24-month net income",
    `=ROUNDDOWN(SUM(${PL(14)})/1000,0)`,
    INT,
  ],
  [
    "Numbers",
    "ABS",
    "Size of the worst monthly loss",
    `=ABS(MIN(${PL(14)}))`,
    EUR,
  ],
  [
    "Text",
    "CONCATENATE",
    "Report label",
    `=CONCATENATE("Scenario: ",Assumptions!B${A.scenario})`,
  ],
  [
    "Text",
    "TEXTJOIN",
    "Scenario names",
    `=TEXTJOIN(", ",TRUE,Assumptions!B${A.names}:D${A.names})`,
  ],
  [
    "Text",
    "LEFT",
    "Initial of the scenario",
    `=LEFT(Assumptions!B${A.scenario},1)`,
  ],
  [
    "Text",
    "RIGHT",
    "Year of the last forecast month, as text",
    `=RIGHT(TEXT('P&L'!Y2,"dd/mm/yyyy"),4)`,
  ],
  [
    "Text",
    "MID",
    "Month digits of the first forecast month",
    `=MID(TEXT('P&L'!N2,"yyyy-mm-dd"),6,2)`,
  ],
  [
    "Text",
    "LEN",
    "Characters in the scenario names",
    `=LEN(TEXTJOIN(", ",TRUE,Assumptions!B${A.names}:D${A.names}))`,
    INT,
  ],
  ["Text", "TEXT", "Cash-flow NPV as text", `=TEXT(Summary!B13,"#,##0")`],
  [
    "Text",
    "VALUE",
    "First forecast month number, from text",
    `=VALUE(MID(TEXT('P&L'!N2,"yyyy-mm-dd"),6,2))`,
    INT,
  ],
  [
    "Dates",
    "DATE",
    "First day of the first forecast month",
    `=DATE(YEAR('P&L'!N2),MONTH('P&L'!N2),1)`,
    DATE,
  ],
  [
    "Dates",
    "YEAR",
    "Year of the last actual month",
    `=YEAR(${$A("lastActual")})`,
  ],
  [
    "Dates",
    "MONTH",
    "Month number of the highest revenue",
    `=MONTH(XLOOKUP(MAX(${PL(6)}),${PL(6)},${PL(2)}))`,
    INT,
  ],
  [
    "Dates",
    "EDATE",
    "One year after the first month",
    `=EDATE(${$A("first")},12)`,
    DATE,
  ],
  [
    "Dates",
    "EOMONTH",
    "End of the forecast",
    `=EOMONTH(${$A("first")},23)`,
    DATE,
  ],
  ["Statistics", "MEDIAN", "Median monthly revenue", `=MEDIAN(${PL(6)})`, EUR],
  [
    "Statistics",
    "PERCENTILE.INC",
    "90th percentile of monthly revenue",
    `=PERCENTILE.INC(${PL(6)},0.9)`,
    EUR,
  ],
  [
    "Statistics",
    "PERCENTILE.EXC",
    "10th percentile of monthly revenue (exclusive)",
    `=PERCENTILE.EXC(${PL(6)},0.1)`,
    EUR,
  ],
  [
    "Statistics",
    "PERCENTILE",
    "First quartile through the legacy name",
    `=PERCENTILE(${PL(6)},0.25)`,
    EUR,
  ],
  [
    "Statistics",
    "QUARTILE.INC",
    "Third quartile of monthly revenue",
    `=QUARTILE.INC(${PL(6)},3)`,
    EUR,
  ],
  [
    "Statistics",
    "STDEV.S",
    "Sample deviation of 2025 revenue",
    `=STDEV.S('P&L'!B6:M6)`,
    EUR,
  ],
  [
    "Statistics",
    "STDEV.P",
    "Population deviation of 2025 revenue",
    `=STDEV.P('P&L'!B6:M6)`,
    EUR,
  ],
  [
    "Finance",
    "NPV",
    "NPV of 2025 cash flows, before the investment",
    `=NPV(${$A("monthlyRate")},'Cash flow'!B7:M7)`,
    EUR,
  ],
];
// Imported records: the selected station is Formula analysis!B4.
const R = (col) => `Rentals!$${col}$2:$${col}$2000`;
export const RECORD_ANALYSIS = [
  [
    "Aggregation",
    "SUMIF",
    "Rentals at the selected station",
    `=SUMIF(${R("B")},$B$4,${R("D")})`,
    INT,
  ],
  [
    "Aggregation",
    "SUMIFS",
    "Member rentals at the selected station",
    `=SUMIFS(${R("D")},${R("B")},$B$4,${R("C")},"Member")`,
    INT,
  ],
  [
    "Aggregation",
    "COUNTIFS",
    "Records above 300 rentals at the selected station",
    `=COUNTIFS(${R("B")},$B$4,${R("D")},">300")`,
    INT,
  ],
  [
    "Aggregation",
    "AVERAGEIFS",
    "Average casual rentals per month at the selected station",
    `=AVERAGEIFS(${R("D")},${R("B")},$B$4,${R("C")},"Casual")`,
    DEC,
  ],
  ["Aggregation", "COUNTA", "Imported records", `=COUNTA(${R("B")})`, INT],
  [
    "Aggregation",
    "COUNTBLANK",
    "Records without a note (first 96 rows)",
    `=COUNTBLANK(Rentals!E2:E97)`,
    INT,
  ],
  [
    "Text",
    "TEXTJOIN",
    "Stations of the first month's records",
    `=TEXTJOIN(", ",TRUE,Rentals!B2:B9)`,
  ],
  ["Text", "TRIM", "Festival note without extra spaces", `=TRIM(Rentals!E50)`],
  ["Text", "CLEAN", "Storm note without its line break", `=CLEAN(Rentals!E97)`],
  [
    "Text",
    "LEN",
    "Characters removed by TRIM",
    `=LEN(Rentals!E50)-LEN(TRIM(Rentals!E50))`,
    INT,
  ],
];
const FIRST = 7;
const analysisRow = (c, r, [family, fn, question, expression, format]) => {
  c[`A${r}`] = text(family, "rowHeader");
  c[`B${r}`] = text(fn);
  c[`C${r}`] = text(question);
  c[`D${r}`] = formula(expression, "calculation", format);
};
export const RECORD_ROW = FIRST + MODEL_ANALYSIS.length + 2;
function analysis() {
  const c = {
    A1: text(
      "Formula analysis: every reference function on this model",
      "title",
    ),
    A2: text(
      "One row per function of the V1 formula contract; formulas stay in English.",
      "note",
    ),
    A4: text("Station", "rowHeader"),
    B4: text("North", "assumption"),
    A6: text("Family", "header"),
    B6: text("Function", "header"),
    C6: text("Question", "header"),
    D6: text("Result", "header"),
  };
  MODEL_ANALYSIS.forEach((row, i) => analysisRow(c, FIRST + i, row));
  c[`A${RECORD_ROW - 1}`] = text(
    "Imported rental records (after Data › Import CSV…)",
    "header",
  );
  for (const col of ["B", "C", "D"])
    c[`${col}${RECORD_ROW - 1}`] = text("", "header");
  return c;
}

function stations() {
  return {
    A1: text("Rentals by station and plan (pivot table)", "title"),
    A2: text(
      "Read from the imported Rentals sheet; refresh after a source refresh.",
      "note",
    ),
  };
}

export function model() {
  const book = {
    version: "html-data/0.1",
    id: "fictional-bike-rentals-pnl",
    title: "Fictional bike rental co-op: 24-month P&L",
    dateSystem: "excel1900",
    locale: "en-GB",
    groups: [
      {
        id: "summary-group",
        name: "Summary",
        kind: "summary",
        sheetIds: ["summary", "stations"],
      },
      {
        id: "inputs-group",
        name: "Inputs",
        kind: "inputs",
        sheetIds: ["inputs"],
      },
      { id: "raw-group", name: "Raw Data", kind: "raw", sheetIds: ["actuals"] },
      {
        id: "calc-group",
        name: "Calculations",
        kind: "calculations",
        sheetIds: ["pnl", "cash", "analysis", "chartdata"],
      },
    ],
    names: [
      { name: "DiscountRate", sheetId: "inputs", ref: `B${A.discount}` },
      { name: "InitialInvestment", sheetId: "inputs", ref: `B${A.investment}` },
    ],
    metadata: {
      fictional: true,
      note: "T21 acceptance workbook: an invented bike rental co-op. Every figure, name and note is fictional.",
    },
    validations: [
      {
        id: "scenario",
        sheetId: "inputs",
        ref: `B${A.scenario}`,
        source: {
          kind: "range",
          sheetId: "inputs",
          ref: `B${A.names}:D${A.names}`,
        },
      },
      {
        id: "station",
        sheetId: "analysis",
        ref: "B4",
        source: {
          kind: "list",
          values: STATIONS.map((value) => ({ type: "text", value })),
        },
      },
    ],
    scenario: { validationId: "scenario" },
    conditionalFormats: [
      {
        id: "net-income-bars",
        sheetId: "pnl",
        ref: "B14:Y14",
        kind: "dataBar",
        scale: { kind: "auto" },
        positive: "acc",
        negative: "alert",
      },
      {
        id: "negative-margin",
        sheetId: "pnl",
        ref: "B15:Y15",
        kind: "highlight",
        condition: { operator: "lt", values: [{ type: "number", value: 0 }] },
        style: { color: "alert", bold: true },
      },
      {
        id: "forecast-columns",
        sheetId: "pnl",
        ref: "B3:Y3",
        kind: "highlight",
        condition: {
          operator: "eq",
          values: [{ type: "text", value: "Forecast" }],
        },
        style: { fill: "tint", italic: true },
      },
      {
        id: "cumulative-cash-bars",
        sheetId: "cash",
        ref: "B8:Y8",
        kind: "dataBar",
        scale: { kind: "auto" },
        positive: "acc",
        negative: "alert",
      },
      {
        id: "summary-decline",
        sheetId: "summary",
        ref: "E7:E11",
        kind: "highlight",
        condition: { operator: "lt", values: [{ type: "number", value: 0 }] },
        style: { color: "alert" },
      },
    ],
    charts: [
      {
        id: "monthly-trend",
        sheetId: "summary",
        anchor: "G2",
        width: 860,
        height: 300,
        type: "line",
        options: {
          title: "Monthly revenue and net income, Jan 2025 to Dec 2026",
          unit: "EUR",
          decimals: 0,
        },
        source: { sheetId: "chartdata", ref: "A1:C25" },
      },
      {
        id: "bridge",
        sheetId: "summary",
        anchor: "G18",
        width: 620,
        height: 300,
        type: "waterfall",
        options: {
          title: "24 months: revenue to net income",
          unit: "EUR",
          decimals: 0,
          increase: "good",
        },
        source: { sheetId: "chartdata", ref: "E1:G7" },
      },
      {
        id: "scenarios",
        sheetId: "summary",
        anchor: "A20",
        width: 460,
        height: 280,
        type: "column",
        options: { title: "2026 by growth scenario", unit: "EUR", decimals: 0 },
        source: { sheetId: "chartdata", ref: "I1:K4" },
      },
    ],
    sheets: [
      {
        id: "summary",
        name: "Summary",
        columns: {
          A: { width: 300 },
          B: { width: 110 },
          C: { width: 110 },
          D: { width: 110 },
          E: { width: 80 },
        },
        cells: summary(),
        links: { A18: { sheetId: "analysis", ref: "A1" } },
      },
      {
        id: "stations",
        name: "Stations",
        columns: { A: { width: 140 } },
        cells: stations(),
      },
      {
        id: "inputs",
        name: "Assumptions",
        columns: {
          A: { width: 300 },
          B: { width: 100 },
          C: { width: 90 },
          D: { width: 90 },
        },
        cells: assumptions(),
      },
      {
        id: "actuals",
        name: "Monthly actuals",
        columns: { A: { width: 110 } },
        cells: actuals(),
      },
      { id: "pnl", name: "P&L", columns: { A: { width: 170 } }, cells: pnl() },
      {
        id: "cash",
        name: "Cash flow",
        columns: { A: { width: 300 } },
        cells: cash(),
      },
      {
        id: "analysis",
        name: "Formula analysis",
        columns: {
          A: { width: 110 },
          B: { width: 130 },
          C: { width: 380 },
          D: { width: 130 },
        },
        cells: analysis(),
      },
      {
        id: "chartdata",
        name: "Chart data",
        columns: { E: { width: 120 } },
        cells: chartData(),
      },
    ],
  };
  return book;
}

// After the person imports rentals-2025.csv as "Rentals": monthly actuals
// read the records, the record rows join the analysis, and the pivot table.
export function linkPatch() {
  const edits = [];
  for (let m = 0; m < 12; m++)
    edits.push({
      sheet: "Monthly actuals",
      ref: `B${m + 2}`,
      cell: formula(
        `=SUMIFS(${R("D")},${R("A")},A${m + 2})`,
        "calculation",
        INT,
      ),
    });
  RECORD_ANALYSIS.forEach(([family, fn, question, expression, format], i) => {
    const r = RECORD_ROW + i;
    edits.push(
      {
        sheet: "Formula analysis",
        ref: `A${r}`,
        cell: text(family, "rowHeader"),
      },
      { sheet: "Formula analysis", ref: `B${r}`, cell: text(fn) },
      { sheet: "Formula analysis", ref: `C${r}`, cell: text(question) },
      {
        sheet: "Formula analysis",
        ref: `D${r}`,
        cell: formula(expression, "calculation", format),
      },
    );
  });
  return {
    edits,
    set: {
      pivots: [
        {
          id: "rentals-by-station",
          name: "Rentals by station and plan",
          source: { sheetId: "import-1" },
          output: { sheetId: "stations", ref: "A4" },
          rows: ["Station"],
          columns: ["Plan"],
          filters: [],
          values: [{ field: "Rentals", aggregate: "sum" }],
        },
      ],
    },
  };
}

const json = (value) => JSON.stringify(value, null, 2) + "\n";
export const FILES = {
  "model.json": () => json(model()),
  "sources/rentals-2025.csv": () => csv(1),
  "sources/rentals-2025-v2.csv": () => csv(2),
  "patches/link-rentals.json": () => json(linkPatch()),
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const [name, make] of Object.entries(FILES)) {
    const path = join(here, name),
      content = make();
    if (check) {
      const current = await readFile(path, "utf8").catch(() => null);
      if (current !== content) {
        console.error(
          `${name} is out of date: run node ${join("packages/data/acceptance/author.mjs")}`,
        );
        stale++;
      }
    } else {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }
  }
  if (stale) process.exit(1);
}
