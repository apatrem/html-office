// Chart figures (T11) on the shared chart contract (packages/shared/charts/): insert, change and
// key their saved previews. A preview is the plot drawn by ECharts and saved as SVG, so the chart
// displays and prints without the library; data-key on it records what it was drawn from (type,
// width, data, charte), so the editor knows when it is out of date.
import { NodeSelection } from "prosemirror-state";
import { schema } from "./schema/schema.mjs";
import { usedIds } from "./commands.mjs";
import { figureId } from "./images.mjs";
import { registry } from "../../shared/charts/index.mjs";
import { strictValidate } from "../../shared/charts/schema.mjs";
import { CHART_WIDTHS } from "../model/format.mjs";

const N = schema.nodes;

// Starting data of a new chart, per type; every one passes the strict schema.
export const SAMPLES = {
  column: {
    title: "New chart",
    unit: "Units",
    categories: ["A", "B", "C"],
    series: [{ name: "Series 1", values: [3, 5, 4] }],
  },
  hbar: {
    title: "New chart",
    unit: "Units",
    categories: ["A", "B", "C"],
    series: [{ name: "Series 1", values: [3, 5, 4] }],
  },
  stacked: {
    title: "New chart",
    unit: "Units",
    categories: ["A", "B", "C"],
    series: [
      { name: "Series 1", values: [3, 5, 4] },
      { name: "Series 2", values: [2, 1, 3] },
    ],
  },
  line: {
    title: "New chart",
    unit: "Units",
    categories: ["Q1", "Q2", "Q3", "Q4"],
    series: [{ name: "Series 1", values: [3, 4, 4.5, 5] }],
  },
  waterfall: {
    title: "New chart",
    unit: "Units",
    items: [
      { label: "Start", value: 10, total: true },
      { label: "Change", value: 3 },
      { label: "End", value: 13, total: true },
    ],
  },
  bubble: {
    title: "New chart",
    unit: "Units",
    xLabel: "X",
    yLabel: "Y",
    points: [
      { name: "A", x: 1, y: 2, size: 3 },
      { name: "B", x: 2, y: 3, size: 5 },
    ],
  },
  gantt: {
    title: "New chart",
    tasks: [
      { name: "Plan", start: "2027-01", end: "2027-03" },
      { name: "Build", start: "2027-03", end: "2027-06" },
    ],
  },
};

// Chart JSON as the format writes it: "<" escaped, so no "</script" or "<!--" can appear.
export const chartJSON = (data) =>
  JSON.stringify(data).replace(/</g, "\\u003c");

// Why chart data cannot be saved, or "" (FORMAT.md › Chart: the strict schema of its type).
export function chartProblem(type, data) {
  if (!Object.hasOwn(registry, type)) return `Unknown chart type "${type}"`;
  return strictValidate(type, data).slice(0, 3).join("; ");
}

// The selected chart figure, or the one whose caption holds the cursor: {pos, node}.
export function chartAt(state) {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type === N.chart)
    return { pos: sel.from, node: sel.node };
  const { $from } = sel;
  for (let d = $from.depth; d > 0; d--)
    if ($from.node(d).type === N.chart)
      return { pos: $from.before(d), node: $from.node(d) };
  return null;
}

// What a preview is drawn from: a short hash (FNV-1a) of the type, width, data and charte.
export function previewKey(type, width, data, theme) {
  const text = JSON.stringify([type, width, data, theme]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}
export const keyOf = (preview) =>
  preview?.attrs.find(([n]) => n === "data-key")?.[1] ?? null;

// A chart figure after the top-level block holding the selection (before comments); selected.
// chart: {type, data, width, preview?, caption?: inline nodes}.
export const insertChart = (chart) => (state, dispatch) => {
  const { type, data, width = "text", preview = null, caption = null } = chart;
  if (chartProblem(type, data) || !CHART_WIDTHS.includes(width)) return false;
  if (dispatch) {
    const { $from, to } = state.selection;
    const doc = state.doc;
    let at = $from.depth ? $from.after(1) : to;
    if (doc.lastChild.type === N.comments)
      at = Math.min(at, doc.content.size - doc.lastChild.nodeSize);
    const id = figureId(data.title || "chart", usedIds(doc));
    const node = N.chart.create(
      { id, type, width, data: chartJSON(data), preview },
      caption ? [N.caption.create(null, caption)] : [],
    );
    const tr = state.tr.insert(at, node);
    dispatch(
      tr.setSelection(NodeSelection.create(tr.doc, at)).scrollIntoView(),
    );
  }
  return true;
};

// The chart figure with an ID: {pos, node}, or null once it is gone.
export function chartById(state, id) {
  let found = null;
  state.doc.forEach((node, pos) => {
    if (node.type === N.chart && node.attrs.id === id) found = { pos, node };
  });
  return found;
}

// Changes a chart, the one with ID `id` or the one at the selection: any of {type, data, width}.
// Its preview stays, keyed "stale", until it is drawn again.
export const setChart =
  (changes, id = null) =>
  (state, dispatch) => {
    const found = id === null ? chartAt(state) : chartById(state, id);
    if (!found) return false;
    const attrs = found.node.attrs;
    const type = changes.type ?? attrs.type;
    const width = changes.width ?? attrs.width;
    const data =
      changes.data !== undefined ? chartJSON(changes.data) : attrs.data;
    if (chartProblem(type, JSON.parse(data)) || !CHART_WIDTHS.includes(width))
      return false;
    if (type === attrs.type && width === attrs.width && data === attrs.data)
      return false;
    if (dispatch) {
      const preview = attrs.preview && {
        ...attrs.preview,
        attrs: [
          ...attrs.preview.attrs.filter(([n]) => n !== "data-key"),
          ["data-key", "stale"],
        ],
      };
      const tr = state.tr.setNodeMarkup(found.pos, null, {
        ...attrs,
        type,
        width,
        data,
        preview,
      });
      tr.setSelection(NodeSelection.create(tr.doc, found.pos));
      dispatch(tr);
    }
    return true;
  };

// Sets a chart's saved preview (a plain SVG tree) at `pos`, outside the undo history: a preview
// is drawn from the chart, never an edit of its own.
export function setPreview(state, pos, preview) {
  const node = state.doc.nodeAt(pos);
  if (node?.type !== N.chart) return null;
  const tr = state.tr
    .setNodeMarkup(pos, null, { ...node.attrs, preview })
    .setMeta("addToHistory", false);
  // A selected chart stays selected.
  if (state.selection instanceof NodeSelection && state.selection.from === pos)
    tr.setSelection(NodeSelection.create(tr.doc, pos));
  return tr;
}
