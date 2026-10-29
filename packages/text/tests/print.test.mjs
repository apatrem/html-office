// T14 without a browser: the running header attribute (validation, command, the CSS it prints
// with), the layout theme's print rules and the test PDF reader.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { EditorState } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { parseFile } from "../model/parse.mjs";
import { validateFile } from "../model/validate.mjs";
import { openFile, saveFile } from "../editor/schema/document.mjs";
import { cssString, headerCSS, setHeader } from "../runtime/look.mjs";
import { LAYOUT_CSS } from "../theme/index.mjs";
import { readPDF } from "./pdf.mjs";

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

test("setHeader always stores a header the validator accepts (code points, controls, ends)", () => {
  const { doc } = openFile(parseFile(minimal));
  const stored = (value) => {
    let header;
    setHeader(value)(EditorState.create({ doc }), (tr) => {
      header = tr.doc.attrs.header;
    });
    return header;
  };
  // 121 code points, 185 UTF-16 units: the first 120 code points are kept, no emoji cut in two.
  const emoji = "A" + "😀".repeat(64) + "b".repeat(56);
  assert.equal(stored(emoji), "A" + "😀".repeat(64) + "b".repeat(55));
  assert.equal(stored("Board\u0001report\u0085x y"), "Board report x y");
  assert.equal(stored("x".repeat(119) + " y"), "x".repeat(119));
  assert.equal(stored("lone \ud800 surrogate"), "lone surrogate");
  for (const value of [
    emoji,
    "Board\u0001report",
    "x".repeat(119) + " y",
    "a\ud83d",
    " 　 wide spaces  ",
  ]) {
    const header = stored(value);
    const html = minimal.replace(
      /<article ([^>]*)>/,
      (_, a) =>
        `<article ${a} data-header="${header.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">`,
    );
    assert.deepEqual(errors(html), [], JSON.stringify(value));
  }
});

test("the PDF reader follows indirect resources and fonts", () => {
  const stream = (body) => {
    const data = deflateSync(Buffer.from(body, "latin1"));
    return `<</Filter /FlateDecode /Length ${data.length}>>\nstream\n${data.toString("latin1")}\nendstream`;
  };
  const objects = [
    "<</Type /Catalog /Pages 2 0 R>>",
    "<</Type /Pages /Kids [3 0 R] /Count 1>>",
    "<</Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources 4 0 R /Contents 7 0 R>>",
    "<</Font 5 0 R>>",
    "<</F1 6 0 R>>",
    "<</Type /Font /Subtype /Type0 /ToUnicode 8 0 R>>",
    stream("BT /F1 12 Tf <00010002> Tj ET"),
    stream(
      "beginbfchar\n<0001> <0048>\nendbfchar\nbeginbfrange\n<0002> <0002> <0069>\nendbfrange",
    ),
  ];
  const pdf = Buffer.from(
    `%PDF-1.4\n${objects.map((o, i) => `${i + 1} 0 obj\n${o}\nendobj\n`).join("")}%%EOF`,
    "latin1",
  );
  const read = readPDF(pdf);
  assert.equal(read.pages.length, 1);
  assert.equal(read.pages[0].text.trim(), "Hi");
  assert.deepEqual(read.size, [595, 842]);
});
