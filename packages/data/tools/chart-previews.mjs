// Build-time chart previews (T18): the editor's chart options drawn by
// ECharts' server-side SVG renderer, so a built workbook shows its charts
// without loading ECharts. Previews that already match their data are kept.
import { readFile } from "node:fs/promises";
import * as echarts from "echarts";
import { CHARTES } from "../../shared/themes/chartes.mjs";
import {
  chartData,
  chartOption,
  chartRevision,
  plotSize,
  MAX_PREVIEW,
} from "../model/charts.mjs";
import { display } from "../runtime/view.mjs";
import { inlineScript } from "../../../tools/inline-script.mjs";
import { verifyECharts } from "../../../tools/echarts-integrity.mjs";

const library = new URL("../../../node_modules/echarts/", import.meta.url);

// The theme() of the shared chart module, read from charte CSS text: the
// document's tokens, then a built-in charte's overlay, with var() references
// resolved as the browser computes them.
export function cssTheme(css, overlay = {}) {
  const tokens = {};
  for (const m of css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .matchAll(/--([\w-]+)\s*:\s*([^;}]+)/g))
    tokens[m[1]] = m[2].trim();
  Object.assign(tokens, overlay);
  // var(--name, fallback) with nested fallbacks, as CSS substitutes them.
  function resolve(value, depth = 0) {
    if (depth > 10) return "";
    let out = "",
      i = 0;
    for (let start; (start = value.indexOf("var(", i)) >= 0; ) {
      let level = 0,
        end = start + 3;
      for (; end < value.length; end++)
        if (value[end] === "(") level++;
        else if (value[end] === ")" && --level === 0) break;
      const inner = value.slice(start + 4, end),
        comma = inner.indexOf(","),
        name = (comma < 0 ? inner : inner.slice(0, comma))
          .trim()
          .replace(/^--/, "");
      out +=
        value.slice(i, start) +
        (tokens[name] !== undefined
          ? resolve(tokens[name], depth + 1)
          : comma < 0
            ? ""
            : resolve(inner.slice(comma + 1), depth + 1));
      i = end + 1;
    }
    return (out + value.slice(i)).trim();
  }
  for (const key of Object.keys(tokens)) tokens[key] = resolve(tokens[key]);
  return {
    ink: tokens.ink,
    acc: tokens.acc,
    mid: tokens.mid,
    lig: tokens.lig,
    alert: tokens.alert,
    t2: tokens.t2,
    bd: tokens.bd,
    w: tokens.bg || "#fff",
    font: tokens.font || "Arial, sans-serif",
  };
}

export async function renderPreviews(book, css) {
  if (!book.charts?.length) return book;
  const theme = cssTheme(css, CHARTES[book.theme]),
    label = (cell) => display(cell, book.locale),
    charts = [];
  for (const chart of book.charts) {
    const { data, errors } = chartData(book, chart, label);
    if (errors.length) {
      charts.push(chart);
      continue;
    }
    const revision = await chartRevision(chart, data, theme);
    if (chart.preview?.revision === revision) {
      charts.push(chart);
      continue;
    }
    const { width, height } = plotSize(chart),
      instance = echarts.init(null, null, {
        renderer: "svg",
        ssr: true,
        width,
        height,
      });
    try {
      instance.setOption(chartOption(chart, data, theme));
      const svg = instance.renderToSVGString(),
        { preview: _, ...rest } = chart;
      // A drawing over the stored limit is not kept (ADR-013 §4).
      charts.push(
        svg.length > MAX_PREVIEW
          ? rest
          : { ...rest, preview: { svg, revision } },
      );
    } finally {
      instance.dispose();
    }
  }
  return { ...book, charts };
}

// The pinned ECharts bytes for offline builds, checked against the approved
// SRI digest and escaped for an inline script.
export async function embeddedECharts() {
  const bytes = await readFile(new URL("dist/echarts.min.js", library)),
    { version } = JSON.parse(
      await readFile(new URL("package.json", library), "utf8"),
    );
  verifyECharts(bytes, version);
  return inlineScript(bytes.toString("utf8"), "echarts");
}
