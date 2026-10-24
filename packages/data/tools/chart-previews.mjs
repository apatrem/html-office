// Build-time chart previews (T18): the editor's chart options drawn by
// ECharts' server-side SVG renderer, so a built workbook shows its charts
// without loading ECharts. Previews that already match their data are kept.
import { readFile } from "node:fs/promises";
import * as echarts from "echarts";
import { registry } from "../../shared/charts/index.mjs";
import { CHARTES } from "../../shared/themes/chartes.mjs";
import { chartData, chartRevision, plotSize } from "../model/charts.mjs";
import { display } from "../runtime/view.mjs";
import { inlineScript } from "../../../tools/inline-script.mjs";
import { verifyECharts } from "../../../tools/echarts-integrity.mjs";

const library = new URL("../../../node_modules/echarts/", import.meta.url);

// The theme() of the shared chart module, read from charte CSS text: the
// document's tokens, then a built-in charte's overlay.
export function cssTheme(css, overlay = {}) {
  const tokens = {};
  for (const m of css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .matchAll(/--([\w-]+)\s*:\s*([^;}]+)/g))
    tokens[m[1]] = m[2].trim();
  Object.assign(tokens, overlay);
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
    const revision = await chartRevision(chart, data, book.theme);
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
      instance.setOption(registry[chart.type].toOption(data, theme));
      charts.push({
        ...chart,
        preview: { svg: instance.renderToSVGString(), revision },
      });
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
