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

// Rules whose declarations reach the root element, as theme() reads it.
const ROOT_SELECTORS = [":root", "html", "*"];

// The custom properties a charte declares on the root, by name, in source
// order (a later declaration wins). Only rules selecting the root count, at
// the top level or in an @layer block: declarations in @media or other
// blocks, on other elements or from an @import are not read. Strings, comments and parentheses are skipped as CSS
// tokenizes them, so "/*" in a string or ";" in url(…) ends nothing.
export function charteTokens(css) {
  const tokens = {};
  let depth = 0,
    parens = 0,
    prelude = "",
    root = false,
    layer = -1,
    declaration = "";
  const flush = () => {
    const m = /^\s*--([\w-]+)\s*:([\s\S]*)$/.exec(declaration);
    if (m && m[2].trim()) tokens[m[1]] = m[2].trim();
    declaration = "";
  };
  for (let i = 0; i < css.length; i++) {
    let c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end < 0 ? css.length : end + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c && css[j] !== "\n")
        j += css[j] === "\\" ? 2 : 1;
      c = css.slice(i, j + 1);
      i = j;
    } else if (c === "(") parens++;
    else if (c === ")") parens = Math.max(0, parens - 1);
    else if (parens === 0 && c === "{") {
      if (depth++ === 0) {
        layer = /^\s*@layer\b/i.test(prelude) ? i + 1 : -1;
        root = prelude
          .split(",")
          .some((s) => ROOT_SELECTORS.includes(s.trim().toLowerCase()));
        prelude = declaration = "";
      }
      continue;
    } else if (parens === 0 && c === "}") {
      if (depth === 1 && root) flush();
      // An @layer block is a stylesheet of its own.
      if (depth === 1 && layer >= 0)
        Object.assign(tokens, charteTokens(css.slice(layer, i)));
      depth = Math.max(0, depth - 1);
      continue;
    } else if (parens === 0 && c === ";") {
      if (depth === 0) prelude = "";
      else if (depth === 1 && root) flush();
      continue;
    }
    if (depth === 0) prelude += c;
    else if (depth === 1 && root) declaration += c;
  }
  // The end of the stylesheet closes an open rule, as in the browser.
  if (depth === 1 && root) flush();
  if (depth === 1 && layer >= 0)
    Object.assign(tokens, charteTokens(css.slice(layer)));
  return tokens;
}

// The theme() of the shared chart module, read from charte CSS text: the
// document's tokens, then a built-in charte's overlay, with var() references
// resolved as the browser computes them.
export function cssTheme(css, overlay = {}) {
  const tokens = { ...charteTokens(css), ...overlay };
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
  // A token the charte leaves out reads as "", as getPropertyValue() does.
  const get = (name) => tokens[name] ?? "";
  return {
    ink: get("ink"),
    acc: get("acc"),
    mid: get("mid"),
    lig: get("lig"),
    alert: get("alert"),
    t2: get("t2"),
    bd: get("bd"),
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
