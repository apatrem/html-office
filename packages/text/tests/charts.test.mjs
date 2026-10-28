// T11 chart figures: insertion and changes on the shared strict schemas, IDs from titles, changes
// targeted by ID, JSON written without "</script" or "<!--", stable preview keys, previews set
// outside the history.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, TextSelection, NodeSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { parseFile } from "../model/parse.mjs";
import { validateFile } from "../model/validate.mjs";
import { openFile, saveFile } from "../editor/schema/document.mjs";
import { articleHTML } from "../editor/schema/serialize.mjs";
import { subsetGuard } from "../editor/schema/guard.mjs";
import { element } from "../model/html.mjs";
import {
  SAMPLES,
  chartJSON,
  chartProblem,
  insertChart,
  setChart,
  setPreview,
  previewKey,
  keyOf,
  previewPrefix,
  captionText,
  keepFields,
} from "../editor/charts.mjs";
import { envelope } from "./generate.mjs";

const CHART =
  '<figure class="chart" id="fig-a" data-type="column" data-width="text">\n<script type="application/json">{"title":"A","unit":"EUR","categories":["x"],"series":[{"name":"s","values":[1]}]}</script>\n<figcaption>Chart A</figcaption>\n</figure>';

function editor(body = `<p>Intro.</p>\n${CHART}\n<p>End.</p>`) {
  const file = parseFile(
    envelope(
      `<article id="doc" data-format="1" lang="en">\n${body}\n</article>`,
    ),
  );
  let state = EditorState.create({
    doc: openFile(file).doc,
    plugins: [history(), subsetGuard()],
  });
  const dispatch = (tr) => (state = state.applyTransaction(tr).state);
  return {
    get state() {
      return state;
    },
    dispatch,
    run: (c) => c(state, dispatch),
    cursor(text) {
      let at;
      state.doc.descendants((n, p) => {
        if (at === undefined && n.isText && n.text.includes(text)) at = p;
      });
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, at)));
    },
    saved() {
      const out = saveFile(file, state.doc);
      assert.deepEqual(validateFile(parseFile(out)).errors, []);
      assert.ok(openFile(parseFile(out)).doc.eq(state.doc), "reopens");
      return articleHTML(state.doc);
    },
  };
}

test("every sample passes the strict schema of its type", () => {
  for (const [type, data] of Object.entries(SAMPLES))
    assert.equal(chartProblem(type, data), "", type);
  assert.match(chartProblem("pie", {}), /Unknown chart type/);
  assert.match(
    chartProblem("column", { ...SAMPLES.column, colour: "red" }),
    /unknown field/,
  );
});

test("chart JSON never holds </script or <!--", () => {
  const json = chartJSON({ ...SAMPLES.column, title: "</script><!-- x" });
  assert.doesNotMatch(json, /<\/script|<!--/);
  assert.equal(JSON.parse(json).title, "</script><!-- x");
});

test("a chart is inserted after the block, with an ID from its title, and validates", () => {
  const e = editor();
  e.cursor("Intro.");
  assert.equal(
    e.run(insertChart({ type: "column", data: { title: "x" } })),
    false,
  );
  assert.ok(
    e.run(
      insertChart({
        type: "waterfall",
        data: { ...SAMPLES.waterfall, title: "Bridge 2027" },
        width: "full",
      }),
    ),
  );
  assert.ok(e.state.selection instanceof NodeSelection);
  assert.match(
    e.saved(),
    /<p>Intro\.<\/p>\n<figure class="chart" id="fig-bridge-2027" data-type="waterfall" data-width="full">\n<script type="application\/json">\{"title":"Bridge 2027"/,
  );
});

test("changes target the chart by ID and undo restores the chart as it was; a preview is set outside the history", () => {
  const e = editor();
  e.cursor("End.");
  const data = { ...SAMPLES.line, title: "Trend" };
  assert.ok(e.run(setChart({ type: "line", data }, "fig-a")));
  assert.match(
    e.saved(),
    /data-type="line" data-width="text">\n<script type="application\/json">\{"title":"Trend"/,
  );
  assert.equal(
    e.run(setChart({ type: "line", data }, "fig-a")),
    false,
    "no change",
  );
  assert.equal(e.run(setChart({ data: { title: 1 } }, "fig-a")), false);
  assert.equal(e.run(setChart({ width: "half" }, "fig-a")), false);
  const preview = element(
    "svg",
    [
      ["class", "render"],
      ["viewBox", "0 0 10 5"],
      ["data-key", "k1"],
    ],
    [],
    "svg",
  );
  let pos;
  e.state.doc.forEach((n, p) => {
    if (n.type.name === "chart") pos = p;
  });
  e.dispatch(setPreview(e.state, pos, preview));
  assert.match(
    e.saved(),
    /<svg class="render" viewBox="0 0 10 5" data-key="k1"><\/svg>\n<figcaption>Chart A<\/figcaption>/,
  );
  undo(e.state, e.dispatch);
  const after = e.saved();
  assert.match(after, /data-type="column"/, "undo reverts the change");
  // The chart comes back as it was, with the preview it had then (none): it is drawn again.
  assert.doesNotMatch(after, /data-key/);
});

test("preview keys follow type, width, data and charte", () => {
  const theme = { ink: "#000", acc: "#14517A" };
  const base = previewKey("column", "text", SAMPLES.column, theme);
  assert.equal(
    previewKey("column", "text", SAMPLES.column, { ...theme }),
    base,
  );
  assert.notEqual(previewKey("column", "full", SAMPLES.column, theme), base);
  assert.notEqual(previewKey("hbar", "text", SAMPLES.column, theme), base);
  assert.notEqual(
    previewKey("column", "text", { ...SAMPLES.column, unit: "x" }, theme),
    base,
  );
  assert.notEqual(
    previewKey("column", "text", SAMPLES.column, { ...theme, acc: "#c00" }),
    base,
  );
  assert.equal(keyOf(element("svg", [["data-key", "k"]], [], "svg")), "k");
  assert.equal(keyOf(element("svg", [], [], "svg")), null);
});

test("preview ID prefixes are short and used by no other preview", () => {
  const svg = (ids) =>
    element(
      "svg",
      [["class", "render"]],
      ids.map((id) => element("clipPath", [["id", id]], [], "svg")),
      "svg",
    );
  const e = editor(
    `${CHART}\n${CHART.replace('id="fig-a"', 'id="fig-b"')}\n<p>End.</p>`,
  );
  let a, b;
  e.state.doc.forEach((n, p) => {
    if (n.attrs.id === "fig-a") a = p;
    if (n.attrs.id === "fig-b") b = p;
  });
  e.dispatch(setPreview(e.state, a, svg(["tx-c1-0", "tx-c2-0"])));
  assert.equal(previewPrefix(e.state.doc), "tx-c3-");
  // A chart's own old preview does not count: it is replaced.
  assert.equal(previewPrefix(e.state.doc, a), "tx-c1-");
  assert.equal(previewPrefix(e.state.doc, b), "tx-c3-");
});

test("pasted captions keep their length and lose what the parser would change", () => {
  const long = "x".repeat(1200);
  assert.equal(captionText(long), long);
  assert.equal(captionText("bad\u0000cap\ttion\n"), "bad cap tion");
  assert.equal(captionText("a\ud800b"), "a\ufffdb");
  assert.equal(captionText("ok \ud83d\ude00"), "ok \ud83d\ude00");
});

test("a change of type keeps only the fields the new type accepts", () => {
  const line = { ...SAMPLES.line, labels: "all", scale: true, decimals: 1 };
  const column = keepFields("column", line);
  assert.equal(chartProblem("column", column), "");
  assert.equal(column.decimals, 1);
  assert.equal("labels" in column || "scale" in column, false);
});
