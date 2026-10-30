// Saved chart previews drawn in Node (T18), so a chart the document tools create displays and
// prints without ECharts. The editor's drawing (runtime/charts.mjs) is repeated: the type's
// toOption with the document's charte, at the nominal size of the figure's width, rendered by
// ECharts' server-side SVG renderer and rebuilt through the shared allow-list (ADR-013 §4) with
// the figure's own ID prefix. The preview has no data-key: a tool-written preview counts as
// current (FORMAT.md › Chart).
import { readFile, access } from "node:fs/promises";
import { runInThisContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { registry } from "../../shared/charts/index.mjs";
import { sanitizeSVG } from "../../shared/charts/clipboard.mjs";
import { ECHARTS_VERSION } from "../../shared/charts/echarts.mjs";
import { cssTheme } from "../../shared/charts/css-theme.mjs";
import { CHARTES } from "../../shared/themes/chartes.mjs";
import { FONTS } from "../../shared/themes/fonts.mjs";
import { verifyECharts } from "../../../tools/echarts-integrity.mjs";
import { Transform } from "prosemirror-transform";
import { schema } from "../editor/schema/schema.mjs";
import { previewPrefix } from "../editor/charts.mjs";
import { fromDom, attr, elements } from "../model/html.mjs";
import { parseInert, withDocument } from "./node-dom.mjs";

// As runtime/charts.mjs: the nominal plot size per width; the SVG scales to the figure.
const SIZES = { text: [640, 320], full: [860, 360] };

// The pinned ECharts browser build: the skill's copy (assets/), or the repository's dependency.
const CANDIDATES = [
  new URL("../assets/echarts.min.js", import.meta.url),
  new URL("../../../node_modules/echarts/dist/echarts.min.js", import.meta.url),
];
export async function echartsBytes() {
  for (const url of CANDIDATES)
    if (
      await access(url).then(
        () => true,
        () => false,
      )
    ) {
      const bytes = await readFile(url);
      verifyECharts(bytes, ECHARTS_VERSION);
      return { bytes, url };
    }
  throw new Error("ECharts is missing: expected assets/echarts.min.js.");
}

let library = null;
async function loadECharts() {
  if (library) return library;
  const { bytes, url } = await echartsBytes();
  // Run as CommonJS from the verified bytes: require() would follow the package scope of the
  // folder it sits in, and a "type": "module" project would load it as ESM.
  const module = { exports: {} };
  runInThisContext(`(function (exports, module) {${bytes}\n})`, {
    filename: fileURLToPath(url),
  })(module.exports, module);
  return (library = module.exports);
}

// The theme() of the shared chart module for a document: its charte, the built-in charte its
// data-theme selects, and the body font its data-font selects.
export function documentTheme(charte, { theme = null, font = null } = {}) {
  const t = cssTheme(charte, CHARTES[theme] ?? {});
  const chosen = FONTS.find(([id]) => id === font);
  // ECharts' server-side renderer writes the font list into a double-quoted style attribute
  // without escaping: quoted family names take single quotes.
  return { ...t, font: (chosen ? chosen[2] : t.font).replaceAll('"', "'") };
}

// The saved preview of a chart as a tree (model/html.mjs), or null when nothing usable is drawn.
// chart: {type, data, width}; prefix: the ID prefix of its preview ("tx-c3-").
export async function drawPreview({ type, data, width }, theme, prefix) {
  const echarts = await loadECharts();
  const [w, h] = SIZES[width] ?? SIZES.text;
  const instance = echarts.init(null, null, {
    renderer: "svg",
    ssr: true,
    width: w,
    height: h,
  });
  try {
    instance.setOption(registry[type].toOption(data, theme), true);
    const svg = instance.renderToSVGString();
    return withDocument(() => {
      const clean = sanitizeSVG(svg, { prefix, parse: parseInert });
      return clean && fromDom(clean);
    });
  } finally {
    instance.dispose();
  }
}

// The charte of a parsed file (style#charte), as text.
export function fileCharte(file) {
  const head = elements(file.html).find((n) => n.name === "head");
  return elements(head)
    .filter((n) => n.name === "style" && attr(n, "id") === "charte")
    .map((n) => n.children.map((c) => c.value).join(""))
    .join("");
}

// The document with a preview drawn for each chart that has none (every chart with redraw), in
// the file's charte and the document's theme and font. Returns {doc, drawn, failed}: the number
// drawn and the IDs of charts nothing could be drawn for.
export async function drawCharts(file, doc, { redraw = false } = {}) {
  const theme = documentTheme(fileCharte(file), {
    theme: doc.attrs.theme,
    font: doc.attrs.font,
  });
  const tr = new Transform(doc);
  const positions = [];
  doc.forEach((node, pos) => {
    if (node.type === schema.nodes.chart && (redraw || !node.attrs.preview))
      positions.push(pos);
  });
  const failed = [];
  // Setting an attribute moves no position.
  for (const pos of positions) {
    const node = tr.doc.nodeAt(pos);
    const preview = await drawPreview(
      {
        type: node.attrs.type,
        width: node.attrs.width,
        data: JSON.parse(node.attrs.data),
      },
      theme,
      previewPrefix(tr.doc, pos),
    );
    if (preview) tr.setNodeAttribute(pos, "preview", preview);
    else failed.push(node.attrs.id);
  }
  return { doc: tr.doc, drawn: positions.length - failed.length, failed };
}
