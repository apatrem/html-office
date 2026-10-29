// T14 without a browser: the running header attribute (validation, command, the CSS it prints
// with) and the layout theme's print rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EditorState } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { parseFile } from "../model/parse.mjs";
import { validateFile } from "../model/validate.mjs";
import { openFile, saveFile } from "../editor/schema/document.mjs";
import { cssString, headerCSS, setHeader } from "../runtime/look.mjs";
import { LAYOUT_CSS } from "../theme/index.mjs";

const minimal = await readFile(
  new URL("../fixtures/valid/minimal.html", import.meta.url),
  "utf8",
);
const withHeader = (value) =>
  minimal.replace(
    /<article ([^>]*)>/,
    (_, a) => `<article ${a} data-header="${value}">`,
  );
const errors = (html) =>
  validateFile(parseFile(html)).errors.map((e) => e.message);

test("data-header is one line of at most 120 characters without outer spaces", () => {
  for (const ok of [
    "Annual report",
    "x",
    "Q&amp;A &quot;draft&quot; &lt;2027&gt; · déjà vu 漢字",
    "a".repeat(120),
    "Two  spaces inside",
  ])
    assert.deepEqual(errors(withHeader(ok)), [], ok);
  for (const bad of [
    "",
    " leading",
    "trailing ",
    "line&#10;break",
    "tab&#9;inside",
    "nul\u0001",
    "a".repeat(121),
    "line separator",
  ])
    assert.match(errors(withHeader(bad)).join(), /data-header/, bad);
});

test("data-header round-trips byte for byte, escapes included", () => {
  const html = withHeader("Q&amp;A &quot;draft&quot; &lt;2027&gt;");
  const file = parseFile(html);
  const { doc } = openFile(file);
  assert.equal(doc.attrs.header, 'Q&A "draft" <2027>');
  assert.equal(saveFile(file, doc), html);
});

test("setHeader trims, joins lines, keeps 120 characters and removes an empty header", () => {
  const { doc } = openFile(parseFile(minimal));
  let state = EditorState.create({ doc, plugins: [history()] });
  const run = (value) => {
    let ran = false;
    setHeader(value)(state, (tr) => {
      state = state.apply(tr);
      ran = true;
    });
    return ran;
  };
  assert.ok(run("  Annual\n report\t2026 "));
  assert.equal(state.doc.attrs.header, "Annual report 2026");
  assert.equal(run("Annual report 2026"), false, "unchanged: no step");
  assert.ok(run("b".repeat(130)));
  assert.equal(state.doc.attrs.header, "b".repeat(120));
  assert.ok(run("   "));
  assert.equal(state.doc.attrs.header, null);
  undo(state, (tr) => (state = state.apply(tr)));
  assert.equal(state.doc.attrs.header, "b".repeat(120), "one undo step each");
  const saved = saveFile(parseFile(minimal), state.doc);
  assert.match(saved, / data-header="b{120}">/);
  assert.deepEqual(validateFile(parseFile(saved)).errors, []);
});

test("the header prints as a CSS string in the top margin box", () => {
  assert.equal(cssString('a "b" \\ c'), '"a \\"b\\" \\\\ c"');
  assert.equal(cssString("x\ny"), '"x\\a y"');
  assert.equal(cssString("</style>"), '"</style>"');
  assert.equal(
    headerCSS("Annual report"),
    '@page{@top-center{content:"Annual report"}}',
  );
  assert.equal(headerCSS(null), "");
});

test("the layout theme's print rules: breaks, keep-together, full-width figures, comments", () => {
  const print = LAYOUT_CSS.match(/@media print\{(.*)\}$/)[1];
  for (const rule of [
    "hr.page-break{break-after:page;",
    ".new-page{break-before:page}",
    "figure:not(.table),tr,h1,h2,h3,h4,.cover{break-inside:avoid}",
    "figure.table>figcaption{break-after:avoid}",
    "figure[data-width=full]{margin-left:0;margin-right:0}",
    ".comments{display:none}",
  ])
    assert.ok(print.includes(rule), rule);
  assert.match(LAYOUT_CSS, /h1,h2,h3,h4,\.title\{[^}]*break-after:avoid/);
  assert.match(LAYOUT_CSS, /#doc\{--page-w:210mm;--page-h:297mm;/);
  assert.match(
    LAYOUT_CSS,
    /#doc\[data-page=letter\]\{--page-w:215\.9mm;--page-h:279\.4mm;/,
  );
});
