// Fictional content for the mock-ups. Data values are computed from the
// formulas and inputs of packages/data/fixtures/pnl.json (Community Learning
// 24-month P&L); Slides and Text tell the same fictional story.
import { readFileSync } from "node:fs";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../../../packages/data/fixtures/pnl.json", import.meta.url),
    "utf8",
  ),
);
const sheet = (id) => fixture.sheets.find((s) => s.id === id);
const input = (ref) => sheet("inputs").cells[ref].input.value;
const growth = input("B2"),
  fee = input("B3"),
  unitCost = input("B4"),
  fixed = input("B5"),
  taxRate = input("B6");
const actual = Object.entries(sheet("raw").cells)
  .filter(([ref, c]) => ref[0] === "B" && c.input.type === "number")
  .sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)))
  .map(([, c]) => c.input.value);

export const months = [];
let participants = 0;
for (let m = 0; m < 24; m++) {
  participants = m < actual.length ? actual[m] : participants * (1 + growth);
  const revenue = participants * fee,
    variable = participants * unitCost,
    contribution = revenue - variable,
    operating = contribution - fixed,
    tax = Math.max(0, operating * taxRate),
    net = operating - tax;
  months.push({
    label: m < 12 ? `Actual ${m + 1}` : `Forecast ${m - 11}`,
    period: m + 1,
    participants,
    revenue,
    variable,
    contribution,
    fixed,
    operating,
    tax,
    net,
    margin: revenue ? operating / revenue : 0,
    cash: net,
  });
}
const year1 = months.slice(0, 12);
const sum = (k) => year1.reduce((t, m) => t + m[k], 0);
export const yearOne = {
  revenue: sum("revenue"),
  variable: sum("variable"),
  contribution: sum("contribution"),
  fixed: sum("fixed"),
  operating: sum("operating"),
  tax: sum("tax"),
  net: sum("net"),
  growth: actual.at(-1) / actual[0] - 1,
};

const eur = (v) => "€" + Math.round(v).toLocaleString("en-US");
const num = (v) => Math.round(v).toLocaleString("en-US");
const pct = (v) => (v * 100).toFixed(1) + "%";
export const fmt = { eur, num, pct };

// Calculations sheet rows: [label, key, formatter, cell style for values, row style]
export const pnlRows = [
  ["Period", "period", num, "normal"],
  ["Participants", "participants", num, "calculation"],
  ["Revenue", "revenue", eur, "calculation"],
  ["Variable costs", "variable", eur, "calculation"],
  ["Contribution", "contribution", eur, "calculation"],
  ["Fixed costs", "fixed", eur, "calculation"],
  ["Operating profit", "operating", eur, "output"],
  ["Tax", "tax", eur, "calculation"],
  ["Net income", "net", eur, "total"],
  ["Operating margin", "margin", pct, "calculation"],
  ["Operating cash flow", "cash", eur, "calculation"],
];

export const sheetGroups = fixture.groups.map((g) => ({
  name: g.name,
  sheets: g.sheetIds.map((id) => sheet(id).name),
}));
export const workbookTitle = fixture.title;

// Formula of the selected cell, as stored in the fixture.
export const selected = {
  ref: "C4",
  formula: sheet("calc").cells.C4.formula,
};

// Simple column chart as inline SVG, coloured by charte tokens so themes recolour it.
export function columnChart({ values, labels, highlight, width = 560, height = 260, unit = "" }) {
  const max = Math.max(...values) * 1.15,
    left = 36,
    bottom = 28,
    top = 14,
    plotW = width - left - 8,
    plotH = height - top - bottom,
    step = plotW / values.length,
    bar = step * 0.62;
  const ticks = [0, 0.5, 1].map((t) => Math.round((max * t) / 10) * 10);
  let out = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${unit}" class="chart-svg">`;
  for (const t of ticks) {
    const y = top + plotH - (t / max) * plotH;
    out += `<line x1="${left}" x2="${width - 8}" y1="${y}" y2="${y}" class="ch-grid"/><text x="${left - 6}" y="${y + 4}" class="ch-tick" text-anchor="end">${t.toLocaleString("en-US")}</text>`;
  }
  values.forEach((v, i) => {
    const h = (v / max) * plotH,
      x = left + i * step + (step - bar) / 2,
      y = top + plotH - h;
    const cls = highlight?.includes(i) ? "ch-hi" : "ch-bar";
    out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bar.toFixed(1)}" height="${h.toFixed(1)}" class="${cls}"/>`;
    if (labels[i]) out += `<text x="${(x + bar / 2).toFixed(1)}" y="${height - 10}" class="ch-tick" text-anchor="middle">${labels[i]}</text>`;
  });
  return out + `<line x1="${left}" x2="${width - 8}" y1="${top + plotH}" y2="${top + plotH}" class="ch-axis"/></svg>`;
}
