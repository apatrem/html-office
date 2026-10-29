// Build-time chart previews (T18): the editor's chart options drawn by
// ECharts' server-side SVG renderer, so a built workbook shows its charts
// without loading ECharts. Previews that already match their data are kept.
import { readFile, access } from "node:fs/promises";
import { runInThisContext } from "node:vm";
import { fileURLToPath } from "node:url";
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
import { ECHARTS_VERSION } from "../../shared/charts/echarts.mjs";
import { cssTheme } from "../../shared/charts/css-theme.mjs";

// Moved to the shared chart module (T18 Text); exported here as before.
export { charteTokens, cssTheme } from "../../shared/charts/css-theme.mjs";

// The pinned ECharts browser build: the skill's copy (assets/), or the
// repository's dependency. Its bytes are checked against the approved SRI
// digest before use, here and for offline builds.
async function echartsFile() {
  for (const url of [
    new URL("../assets/echarts.min.js", import.meta.url),
    new URL(
      "../../../node_modules/echarts/dist/echarts.min.js",
      import.meta.url,
    ),
  ])
    if (
      await access(url).then(
        () => true,
        () => false,
      )
    )
      return url;
  throw new Error("ECharts is missing: expected assets/echarts.min.js.");
}
let library = null;
async function loadECharts() {
  if (library) return library;
  const file = await echartsFile(),
    bytes = await readFile(file);
  verifyECharts(bytes, ECHARTS_VERSION);
  // The browser build is UMD, run as CommonJS from the verified bytes for
  // server-side SVG: require() would follow the package scope of the folder
  // it sits in, and a "type": "module" project would load it as ESM.
  const module = { exports: {} };
  runInThisContext(`(function (exports, module) {${bytes}\n})`, {
    filename: fileURLToPath(file),
  })(module.exports, module);
  return (library = module.exports);
}

export async function renderPreviews(book, css) {
  if (!book.charts?.length) return book;
  const echarts = await loadECharts(),
    theme = cssTheme(css, CHARTES[book.theme]),
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
  const bytes = await readFile(await echartsFile());
  verifyECharts(bytes, ECHARTS_VERSION);
  return inlineScript(bytes.toString("utf8"), "echarts");
}
