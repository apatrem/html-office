// T21 test helper: the fictional P&L acceptance workbook computed in plain
// JavaScript from the CSV records and the planning assumptions, without the
// workbook's formulas or the engine, so the tests compare IronCalc's saved
// results with independently known totals.
import { parseCSV } from "./csv-parse.mjs";

// The planning assumptions of acceptance/model.json (the known inputs).
export const ASSUMPTIONS = {
  scenario: "Base",
  growth: { Base: 0.08, Low: 0.02, High: 0.15 },
  priceChange: { Base: 0.03, Low: 0, High: 0.05 },
  price: 6.5,
  unitCost: 1.4,
  fixed: 6000,
  depreciation: 1000,
  capex: 800,
  workingCapital: 0.1,
  tax: 0.25,
  discount: 0.09,
  investment: 20000,
  station: "North",
};
export const FUNCTIONS = [
  "SUM", "SUMIF", "SUMIFS", "COUNT", "COUNTIF", "COUNTIFS", "COUNTA",
  "COUNTBLANK", "AVERAGE", "AVERAGEIF", "AVERAGEIFS", "MIN", "MAX", "SUBTOTAL",
  "IF", "IFS", "AND", "OR", "NOT", "IFERROR", "IFNA", "XLOOKUP", "INDEX",
  "MATCH", "ROUND", "ROUNDUP", "ROUNDDOWN", "ABS", "CONCATENATE", "TEXTJOIN",
  "TRIM", "CLEAN", "LEFT", "RIGHT", "MID", "LEN", "TEXT", "VALUE", "DATE",
  "YEAR", "MONTH", "EDATE", "EOMONTH", "MEDIAN", "PERCENTILE.INC",
  "PERCENTILE.EXC", "PERCENTILE", "QUARTILE.INC", "STDEV.S", "STDEV.P", "NPV",
]; // prettier-ignore

// Excel 1900 serials (dates after 1 March 1900).
export const serial = (y, m, d) =>
  (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
const monthEnd = (i) => serial(2025, i + 2, 0); // i = 0 is January 2025

export function readRecords(text) {
  const [header, ...rows] = parseCSV(text).filter((r) => r.some((v) => v));
  return rows.map((r) =>
    Object.fromEntries(
      header.map((h, i) => [h, h === "Rentals" ? Number(r[i]) : r[i]]),
    ),
  );
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => sum(xs) / xs.length;
const sorted = (xs) => [...xs].sort((a, b) => a - b);
const inc = (xs, p) => {
  const s = sorted(xs),
    h = (s.length - 1) * p,
    lo = Math.floor(h);
  return s[lo] + (h - lo) * ((s[lo + 1] ?? s[lo]) - s[lo]);
};
const exc = (xs, p) => {
  const s = sorted(xs),
    h = (s.length + 1) * p - 1,
    lo = Math.floor(h);
  return s[lo] + (h - lo) * (s[lo + 1] - s[lo]);
};
const variance = (xs, n) => {
  const m = mean(xs);
  return sum(xs.map((x) => (x - m) ** 2)) / n;
};
// Excel's rounding: half away from zero.
const round = (x, digits = 0) =>
  (Math.sign(x) * Math.round(Math.abs(x) * 10 ** digits)) / 10 ** digits;
const npv = (rate, flows) =>
  sum(flows.map((f, i) => f / (1 + rate) ** (i + 1)));

// The whole workbook for a state: records (from a CSV), assumption
// overrides, and `months` (24, or 25 once the forecast is extended).
export function expected(records, overrides = {}, months = 24) {
  const a = {
      ...ASSUMPTIONS,
      ...overrides,
      growth: { ...ASSUMPTIONS.growth, ...overrides.growth },
      priceChange: { ...ASSUMPTIONS.priceChange, ...overrides.priceChange },
    },
    g = a.growth[a.scenario],
    pc = a.priceChange[a.scenario];
  const actual = Array.from({ length: 12 }, (_, i) =>
    sum(
      records.filter((r) => r.Month === isoMonthEnd(i)).map((r) => r.Rentals),
    ),
  );
  const p = { date: [], period: [], rentals: [], price: [] };
  for (let m = 0; m < months; m++) {
    p.date.push(monthEnd(m));
    p.period.push(m < 12 ? "Actual" : "Forecast");
    p.rentals.push(m < 12 ? actual[m] : p.rentals[m - 12] * (1 + g));
    p.price.push(m < 12 ? a.price : a.price * (1 + pc));
  }
  const each = (f) => p.rentals.map((_, m) => f(m));
  p.revenue = each((m) => p.rentals[m] * p.price[m]);
  p.variable = each((m) => p.rentals[m] * a.unitCost);
  p.contribution = each((m) => p.revenue[m] - p.variable[m]);
  p.fixed = each(() => a.fixed);
  p.ebitda = each((m) => p.contribution[m] - p.fixed[m]);
  p.depreciation = each(() => a.depreciation);
  p.operating = each((m) => p.ebitda[m] - p.depreciation[m]);
  p.tax = each((m) => Math.max(0, p.operating[m] * a.tax));
  p.net = each((m) => p.operating[m] - p.tax[m]);
  p.margin = each((m) => (p.revenue[m] ? p.operating[m] / p.revenue[m] : 0));
  const c = {};
  c.wc = each(
    (m) => -a.workingCapital * (p.revenue[m] - (m ? p.revenue[m - 1] : 0)),
  );
  c.fcf = each((m) => p.net[m] + a.depreciation - a.capex + c.wc[m]);
  c.cumulative = [];
  c.fcf.forEach((f, m) =>
    c.cumulative.push((m ? c.cumulative[m - 1] : -a.investment) + f),
  );
  const rate = (1 + a.discount) ** (1 / 12) - 1,
    first24 = (xs) => xs.slice(0, 24),
    act = (xs) => xs.slice(0, 12),
    fc = (xs) => xs.slice(12, 24);
  const summary = {
    npv: npv(rate, first24(c.fcf)) - a.investment,
    lossMonths: first24(p.net).filter((x) => x < 0).length,
    margin: mean(first24(p.margin)),
    lowestCash: Math.min(...first24(c.cumulative)),
  };
  for (const [key, row] of [
    ["rentals", p.rentals],
    ["revenue", p.revenue],
    ["ebitda", p.ebitda],
    ["net", p.net],
    ["fcf", c.fcf],
  ])
    summary[key] = [sum(act(row)), sum(fc(row)), sum(first24(row))];
  const rev = first24(p.revenue),
    net = first24(p.net),
    peak = rev.indexOf(Math.max(...rev)),
    trough = rev.indexOf(Math.min(...rev)),
    names = "Base, Low, High",
    at = records.filter((r) => r.Station === a.station),
    notes = records.slice(0, 96),
    festival = records[48].Note,
    storm = records[95].Note;
  const npvText = (() => {
    const v = round(summary.npv);
    return (v < 0 ? "-" : "") + Math.abs(v).toLocaleString("en-US");
  })();
  const analysis = {
    SUM: sum(rev),
    SUMIF: sum(fc(net)),
    SUMIFS: sum(act(rev).filter((x) => x > 15000)),
    COUNT: 24,
    COUNTIF: summary.lossMonths,
    COUNTIFS: fc(net).filter((x) => x < 0).length,
    COUNTA: 14,
    AVERAGE: mean(rev),
    AVERAGEIF: mean(act(rev)),
    AVERAGEIFS: mean(fc(rev).filter((_, i) => fc(net)[i] > 0)),
    MIN: Math.min(...net),
    MAX: Math.max(...net),
    SUBTOTAL: sum(act(p.ebitda)),
    IF: summary.npv > 0 ? "Yes" : "No",
    IFS: p.margin[23] >= 0.2 ? "High" : p.margin[23] >= 0.1 ? "Medium" : "Low",
    AND:
      summary.revenue[1] > summary.revenue[0] &&
      summary.net[1] > summary.net[0],
    OR: [5, 6, 7].some((m) => p.net[m] < 0),
    NOT: a.scenario !== "Base",
    IFERROR: p.net[6] / p.revenue[6],
    IFNA: rev.includes(10000) ? p.date[rev.indexOf(10000)] : "none",
    XLOOKUP: p.date[peak],
    INDEX: net[trough],
    MATCH: 13,
    ROUND: round(mean(first24(p.rentals))),
    ROUNDUP: Math.ceil(Math.max(...first24(p.rentals)) / 30),
    ROUNDDOWN: Math.trunc(sum(net) / 1000),
    ABS: Math.abs(Math.min(...net)),
    CONCATENATE: `Scenario: ${a.scenario}`,
    TEXTJOIN: names,
    LEFT: a.scenario[0],
    RIGHT: "2026",
    MID: "01",
    LEN: names.length,
    TEXT: npvText,
    VALUE: 1,
    DATE: serial(2026, 1, 1),
    YEAR: 2025,
    MONTH: new Date(Date.UTC(1899, 11, 30 + p.date[peak])).getUTCMonth() + 1,
    EDATE: serial(2026, 1, 1),
    EOMONTH: serial(2026, 12, 31),
    MEDIAN: inc(rev, 0.5),
    "PERCENTILE.INC": inc(rev, 0.9),
    "PERCENTILE.EXC": exc(rev, 0.1),
    PERCENTILE: inc(rev, 0.25),
    "QUARTILE.INC": inc(rev, 0.75),
    "STDEV.S": Math.sqrt(variance(act(rev), 11)),
    "STDEV.P": Math.sqrt(variance(act(rev), 12)),
    NPV: npv(rate, act(c.fcf)),
  };
  // Rows reading the imported records (the patch's second block).
  const records2 = {
    SUMIF: sum(at.map((r) => r.Rentals)),
    SUMIFS: sum(at.filter((r) => r.Plan === "Member").map((r) => r.Rentals)),
    COUNTIFS: at.filter((r) => r.Rentals > 300).length,
    AVERAGEIFS: mean(
      at.filter((r) => r.Plan === "Casual").map((r) => r.Rentals),
    ),
    COUNTA: records.length,
    COUNTBLANK: notes.filter((r) => !r.Note).length,
    TEXTJOIN: records
      .slice(0, 8)
      .map((r) => r.Station)
      .join(", "),
    TRIM: festival.trim().replace(/ +/g, " "),
    CLEAN: storm.replace(/[\x00-\x1f]/g, ""),
    LEN: festival.length - festival.trim().replace(/ +/g, " ").length,
  };
  const pivot = {};
  for (const r of records) {
    pivot[r.Station] ??= { Casual: 0, Member: 0 };
    pivot[r.Station][r.Plan] += r.Rentals;
  }
  const yearRentals = sum(actual);
  const scenarios = Object.keys(a.growth).map((s) => [
    s,
    yearRentals * (1 + a.growth[s]) * a.price * (1 + a.priceChange[s]),
    yearRentals *
      (1 + a.growth[s]) *
      (a.price * (1 + a.priceChange[s]) - a.unitCost),
  ]);
  return {
    pnl: p,
    cash: c,
    summary,
    analysis,
    records: records2,
    pivot,
    scenarios,
  };
}

const isoMonthEnd = (i) =>
  new Date(Date.UTC(2025, i + 1, 0)).toISOString().slice(0, 10);

// Rows of the P&L and Cash flow sheets, by key.
export const PNL_ROWS = {
  date: 2, rentals: 4, price: 5, revenue: 6, variable: 7, contribution: 8,
  fixed: 9, ebitda: 10, depreciation: 11, operating: 12, tax: 13, net: 14,
  margin: 15,
}; // prettier-ignore
// The first row of the record block (acceptance/author.mjs RECORD_ROW).
export const RECORD_ROW = 57;
export const CASH_ROWS = { wc: 6, fcf: 7, cumulative: 8 };
export const SUMMARY_ROWS = {
  rentals: 7,
  revenue: 8,
  ebitda: 9,
  net: 10,
  fcf: 11,
};

// Differences between a workbook's saved results and the expected state.
export function differences(book, e, { months = 24, tolerance = 1e-9 } = {}) {
  const out = [],
    sheet = (name) => book.sheets.find((s) => s.name === name),
    col = (m) => {
      let s = "";
      for (let n = m + 2; n > 0; n = Math.floor((n - 1) / 26))
        s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
      return s;
    };
  const check = (sheetName, ref, want) => {
    // Pivot output cells are inputs; formulas have results.
    const cell = sheet(sheetName)?.cells[ref],
      got = (cell?.result ?? cell?.input)?.value;
    const same =
      typeof want === "number" && typeof got === "number"
        ? Math.abs(got - want) <= tolerance * Math.max(1, Math.abs(want))
        : got === want;
    if (!same) out.push(`${sheetName}!${ref}: ${got} ≠ expected ${want}`);
  };
  for (let m = 0; m < months; m++) {
    for (const [key, row] of Object.entries(PNL_ROWS))
      check("P&L", `${col(m)}${row}`, e.pnl[key][m]);
    for (const [key, row] of Object.entries(CASH_ROWS))
      check("Cash flow", `${col(m)}${row}`, e.cash[key][m]);
  }
  for (const [key, row] of Object.entries(SUMMARY_ROWS))
    ["B", "C", "D"].forEach((c, i) =>
      check("Summary", `${c}${row}`, e.summary[key][i]),
    );
  check("Summary", "B13", e.summary.npv);
  check("Summary", "B14", e.summary.lossMonths);
  check("Summary", "B15", e.summary.margin);
  check("Summary", "B16", e.summary.lowestCash);
  // Formula analysis: one row per function; the record rows follow.
  const analysis = sheet("Formula analysis");
  for (const [ref, cell] of Object.entries(analysis.cells)) {
    const [, c, r] = ref.match(/^([A-Z]+)(\d+)$/);
    if (c !== "B" || Number(r) < 7 || !cell.input?.value) continue;
    const fn = cell.input.value,
      block = Number(r) >= RECORD_ROW ? e.records : e.analysis;
    check("Formula analysis", `D${r}`, block[fn]);
  }
  const stations = Object.keys(e.pivot).sort();
  stations.forEach((s, i) => {
    check("Stations", `A${6 + i}`, s);
    check("Stations", `B${6 + i}`, e.pivot[s].Casual);
    check("Stations", `C${6 + i}`, e.pivot[s].Member);
  });
  e.scenarios.forEach(([name, revenue, contribution], i) => {
    check("Chart data", `I${2 + i}`, name);
    check("Chart data", `J${2 + i}`, revenue);
    check("Chart data", `K${2 + i}`, contribution);
  });
  return out;
}
