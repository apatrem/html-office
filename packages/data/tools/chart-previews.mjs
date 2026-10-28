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
