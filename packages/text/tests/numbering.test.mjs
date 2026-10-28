// T08 numbering: heading numbers per level format, figure and table numbers, cross-reference
// labels and contents, from the one pure function; regenerated after edits, in one undo step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, TextSelection, NodeSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { parseFile } from "../model/parse.mjs";
import { validateFile } from "../model/validate.mjs";
import { openFile, saveFile } from "../editor/schema/document.mjs";
import { articleHTML } from "../editor/schema/serialize.mjs";
import { schema } from "../editor/schema/schema.mjs";
import { subsetGuard } from "../editor/schema/guard.mjs";
import { numbering, formatNumber, regenerate } from "../editor/numbering.mjs";
import {
  generatedContent,
  generatedKey,
  themeFormat,
  insertContents,
  insertXref,
  setContentsDepth,
  setHeadingFormat,
  setHeadingNumbers,
  referenceTargets,
} from "../editor/generated.mjs";
import { envelope } from "./generate.mjs";

const N = schema.nodes;
// One 1×1 PNG asset, "a1", for image figures.
const ASSETS =
  '<script id="assets" type="application/json">{"a1":{"type":"image/png","data":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="}}</script>';
const file = (body, attrs = 'data-heading-numbers="on"') =>
  parseFile(
    envelope(
      `<article id="doc" data-format="1" lang="en" ${attrs}>\n${body}\n</article>\n${ASSETS}`.replace(
        " >",
        ">",
      ),
    ),
  );
const docOf = (body, attrs) => openFile(file(body, attrs)).doc;
const numbers = (doc, options) =>
  numbering(doc, options).headings.map((h) => [h.id, h.number]);

test("formats counters as decimals, letters and Roman numerals", () => {
  assert.deepEqual(
    [1, 2, 26, 27, 52, 703].map((n) => formatNumber(n, "A")),
    ["A", "B", "Z", "AA", "AZ", "AAA"],
  );
  assert.equal(formatNumber(3, "a"), "c");
  assert.deepEqual(
    [1, 4, 9, 14, 40, 1994, 3999].map((n) => formatNumber(n, "I")),
    ["I", "IV", "IX", "XIV", "XL", "MCMXCIV", "MMMCMXCIX"],
  );
  assert.equal(formatNumber(4000, "I"), "4000");
  assert.equal(formatNumber(12, "i"), "xii");
  assert.equal(formatNumber(12, "1"), "12");
});

test("heading numbers are hierarchical; deeper counters restart", () => {
  const doc = docOf(
    [
      '<h1 id="a">A</h1>',
      '<h2 id="a1">A1</h2>',
      '<h3 id="a11">A11</h3>',
      '<h2 id="a2">A2</h2>',
      '<h1 id="b">B</h1>',
      '<h3 id="b01">B01</h3>',
      '<h2 id="b1">B1</h2>',
    ].join("\n"),
  );
  assert.deepEqual(numbers(doc), [
    ["a", "1"],
    ["a1", "1.1"],
    ["a11", "1.1.1"],
    ["a2", "1.2"],
    ["b", "2"],
    // No level-2 ancestor: the prefix comes only from numbered ancestors.
    ["b01", "2.1"],
    ["b1", "2.1"],
  ]);
});

test("unnumbered headings show no number, do not count, and are left out of prefixes", () => {
  const doc = docOf(
    [
      '<h1 class="unnumbered" id="intro">Intro</h1>',
      '<h2 id="intro-a">Intro A</h2>',
      '<h1 id="a">A</h1>',
      '<h2 class="unnumbered" id="u">U</h2>',
      '<h3 id="u1">U1</h3>',
      '<h2 id="a1">A1</h2>',
      '<h1 id="b">B</h1>',
    ].join("\n"),
  );
  assert.deepEqual(numbers(doc), [
    ["intro", null],
    ["intro-a", "1"],
    ["a", "1"],
    ["u", null],
    ["u1", "1.1"],
    ["a1", "1.1"],
    ["b", "2"],
  ]);
});

test("each level has its format: the document's, else the theme's", () => {
  const body = [
    '<h1 id="a">A</h1>',
    '<h1 id="b">B</h1>',
    '<h2 id="b1">B1</h2>',
    '<h2 id="b2">B2</h2>',
    '<h3 id="b21">B21</h3>',
    '<h4 id="b211">B211</h4>',
  ].join("\n");
  assert.deepEqual(numbers(docOf(body), { format: "I.A.1.a" }).slice(1), [
    ["b", "II"],
    ["b1", "II.A"],
    ["b2", "II.B"],
    ["b21", "II.B.1"],
    ["b211", "II.B.1.a"],
  ]);
  const own = docOf(
    body,
    'data-heading-numbers="on" data-heading-format="A.i.1.1"',
  );
  assert.equal(
    numbers(own, { format: "I.A.1.a" }).at(-1)[1],
    "B.ii.1.1",
    "the document's format wins",
  );
  assert.deepEqual(
    numbers(docOf(body, "")).map(([, n]) => n),
    [null, null, null, null, null, null],
    "numbers off",
  );
});

test("captioned figures and tables are numbered in document order; labels follow the language", () => {
  const body = [
    '<h1 id="s">Results</h1>',
    '<p>See <a class="xref" href="#tab-b">old</a>, <a class="xref" href="#fig-c">x</a>, <a class="xref" href="#s">x</a>, <a class="xref" href="#gone">Figure 9</a> and <a class="xref" href="#img">x</a>.</p>',
    '<figure class="table" id="tab-a">\n<figcaption>A</figcaption>\n<table>\n<tbody>\n<tr><td>1</td></tr>\n</tbody>\n</table>\n</figure>',
    '<figure class="image" id="img" data-width="text">\n<img data-asset="a1" alt="x">\n</figure>',
    '<figure class="table" id="tab-b">\n<figcaption>B</figcaption>\n<table>\n<tbody>\n<tr><td>1</td></tr>\n</tbody>\n</table>\n</figure>',
    '<figure class="chart" id="fig-c" data-type="column" data-width="text">\n<script type="application/json">{"title":"C","unit":"EUR","categories":["a"],"series":[{"name":"s","values":[1]}]}</script>\n<figcaption>C</figcaption>\n</figure>',
  ].join("\n");
  const result = numbering(docOf(body));
  assert.deepEqual(
    result.figures.map((f) => [f.id, f.label]),
    [
      ["tab-a", "Table 1"],
      ["img", "Figure"],
      ["tab-b", "Table 2"],
      ["fig-c", "Figure 1"],
    ],
  );
  assert.deepEqual(
    result.xrefs.map((x) => [x.target, x.label, x.missing]),
    [
      ["tab-b", "Table 2", false],
      ["fig-c", "Figure 1", false],
      ["s", "Section 1", false],
      ["gone", null, true],
      ["img", "Figure", false],
    ],
  );
  const fr = numbering(
    docOf(body, "").type.create(
      { ...docOf(body).attrs, lang: "fr-FR", headingNumbers: false },
      docOf(body).content,
    ),
  );
  assert.deepEqual(
    fr.xrefs.slice(0, 3).map((x) => x.label),
    ["Tableau 2", "Figure 1", "Results"],
    "French words; an unnumbered heading is named by its text",
  );
});

test("contents list headings up to their depth, nested, with numbers", () => {
  const doc = docOf(
    [
      '<nav class="toc" data-depth="2"></nav>',
      '<h2 id="pre">Before any h1</h2>',
      '<h1 id="a">Alpha <span class="footnote">note</span>beta</h1>',
      '<h2 id="a1">A <a class="xref" href="#b">x</a> one</h2>',
      '<h3 id="a11">Deep</h3>',
      '<h1 class="unnumbered" id="b">Annex</h1>',
      '<nav class="toc" data-depth="1"></nav>',
    ].join("\n"),
  );
  const [two, one] = numbering(doc).tocs;
  assert.deepEqual(two.entries, [
    { target: "pre", label: "1 Before any h1", children: [] },
    {
      target: "a",
      label: "1 Alpha beta",
      children: [{ target: "a1", label: "1.1 A x one", children: [] }],
    },
    { target: "b", label: "Annex", children: [] },
  ]);
  assert.deepEqual(
    one.entries.map((e) => e.target),
    ["a", "b"],
  );
});

test("targets inside protected blocks keep their label and are not missing", () => {
  const doc = docOf(
    '<div id="kept"><h2 id="old">Old</h2></div>\n<p><a class="xref" href="#old">As written</a></p>',
  );
  const [x] = numbering(doc).xrefs;
  assert.equal(x.label, null);
  assert.equal(x.missing, false);
});

test("themeFormat reads --heading-format and falls back to decimals", () => {
  assert.equal(themeFormat(' "I.A.1.a"'), "I.A.1.a");
  assert.equal(themeFormat("'A.1.a.i'"), "A.1.a.i");
  assert.equal(themeFormat(""), "1.1.1.1");
  assert.equal(themeFormat('"1.2.3.4"'), "1.1.1.1");
});

// ---------- the editor plugin ----------
function editor(body, attrs) {
  const f = file(body, attrs);
  let state = EditorState.create({
    doc: openFile(f).doc,
    plugins: [history(), subsetGuard(), generatedContent()],
  });
  const dispatch = (tr) => (state = state.applyTransaction(tr).state);
  // Open: generated content is rewritten once, outside the history.
  const tr = state.tr;
  if (regenerate(tr)) dispatch(tr.setMeta("addToHistory", false));
  return {
    get state() {
      return state;
    },
    dispatch,
    find(text) {
      let at = null;
      state.doc.descendants((node, pos) => {
        if (at === null && node.isText && node.text.includes(text))
          at = pos + node.text.indexOf(text);
      });
      assert.notEqual(at, null, text);
      return at;
    },
    run: (command) => command(state, dispatch),
    // Saves, checks that the file is valid and reopens identically, and returns the article.
    saved() {
      const text = saveFile(f, state.doc);
      const report = validateFile(parseFile(text));
      assert.deepEqual(report.errors, []);
      assert.ok(openFile(parseFile(text)).doc.eq(state.doc), "reopens");
      return articleHTML(state.doc);
    },
  };
}
const SECTIONS = [
  '<nav class="toc" data-depth="2"></nav>',
  '<h1 id="one">One</h1>',
  '<p>See <a class="xref" href="#two">Section 9</a> and <a class="xref" href="#tab">Table 7</a>.</p>',
  '<h1 id="two">Two</h1>',
  '<figure class="table" id="tab">\n<figcaption>T</figcaption>\n<table>\n<tbody>\n<tr><td>1</td></tr>\n</tbody>\n</table>\n</figure>',
  '<h2 id="two-a">Two A</h2>',
  "<p>End.</p>",
].join("\n");

test("stale labels and contents are rewritten on open; nothing else changes", () => {
  const e = editor(SECTIONS);
  const before = articleHTML(docOf(SECTIONS)).split("\n");
  const after = e.saved().split("\n");
  const changed = after.filter((line) => !before.includes(line));
  assert.deepEqual(changed, [
    '<nav class="toc" data-depth="2">',
    "<ol>",
    '<li><a href="#one">1 One</a></li>',
    '<li><a href="#two">2 Two</a><ol>',
    '<li><a href="#two-a">2.1 Two A</a></li>',
    "</ol></li>",
    "</ol>",
    "</nav>",
    '<p>See <a class="xref" href="#two">Section 2</a> and <a class="xref" href="#tab">Table 1</a>.</p>',
  ]);
  assert.deepEqual(
    before.filter((line) => !after.includes(line)),
    [
      '<nav class="toc" data-depth="2"></nav>',
      '<p>See <a class="xref" href="#two">Section 9</a> and <a class="xref" href="#tab">Table 7</a>.</p>',
    ],
  );
});

test("moving, deleting and renumbering sections relabels everything in the same undo step", () => {
  const e = editor(SECTIONS);
  const doc = e.state.doc;
  // Move section "two" (heading, table, h2) before section "one".
  let one, two, end;
  doc.forEach((node, pos) => {
    if (node.attrs.id === "one") one = pos;
    if (node.attrs.id === "two") two = pos;
    if (node.type === N.paragraph && node.textContent === "End.") end = pos;
  });
  const moved = doc.slice(two, end);
  e.dispatch(e.state.tr.delete(two, end).insert(one, moved.content));
  assert.match(e.saved(), /href="#two">Section 1</);
  assert.match(e.saved(), /<li><a href="#two-a">1\.1 Two A<\/a><\/li>/);
  // Delete heading "two": its cross-reference is now missing, its label kept.
  let at;
  e.state.doc.forEach((node, pos) => {
    if (node.attrs.id === "two") at = pos;
  });
  e.dispatch(e.state.tr.delete(at, at + e.state.doc.nodeAt(at).nodeSize));
  const result = numbering(e.state.doc);
  assert.deepEqual(
    result.xrefs.map((x) => [x.target, x.missing]),
    [
      ["two", true],
      ["tab", false],
    ],
  );
  const decorations = generatedKey.getState(e.state).decorations.find();
  assert.ok(
    decorations.some((d) => d.type.attrs?.class === "tx-missing"),
    "flagged",
  );
  assert.match(e.saved(), /href="#two">Section 1</, "label kept as last known");
  // Undo restores the heading and the labels together.
  undo(e.state, e.dispatch);
  undo(e.state, e.dispatch);
  assert.match(e.saved(), /href="#two">Section 2</);
});

test("typing in a paragraph maps the decorations; typing in a heading updates the contents", () => {
  const e = editor(SECTIONS);
  const start = generatedKey.getState(e.state).decorations.find().length;
  e.dispatch(e.state.tr.insertText("Plain ", e.find("End.")));
  assert.equal(generatedKey.getState(e.state).result, null, "mapped only");
  assert.equal(generatedKey.getState(e.state).decorations.find().length, start);
  e.dispatch(e.state.tr.insertText("Renamed ", e.find("Two A")));
  assert.match(e.saved(), /<a href="#two-a">2\.1 Renamed Two A<\/a>/);
});

test("heading numbers and format are document settings; contents and cross-references insert", () => {
  const e = editor(SECTIONS, "");
  assert.match(e.saved(), /<a href="#one">One<\/a>/);
  assert.ok(e.run(setHeadingNumbers(true)));
  assert.match(e.saved(), /<a href="#one">1 One<\/a>/);
  assert.match(e.saved(), /data-heading-numbers="on"/);
  assert.ok(e.run(setHeadingFormat("I.A.1.a", "1.1.1.1")));
  assert.match(e.saved(), /data-heading-format="I.A.1.a"/);
  assert.match(e.saved(), /<a href="#two-a">II\.A Two A<\/a>/);
  // The theme's own format is never stored.
  assert.ok(e.run(setHeadingFormat("1.1.1.1", "1.1.1.1")));
  assert.doesNotMatch(e.saved(), /data-heading-format/);
  assert.equal(e.run(setHeadingFormat("1.2.3.4", "1.1.1.1")), false);
  // A cross-reference at the cursor, labelled at once.
  e.dispatch(
    e.state.tr.setSelection(TextSelection.create(e.state.doc, e.find("End."))),
  );
  assert.ok(e.run(insertXref("two-a")));
  assert.match(
    e.saved(),
    /<p><a class="xref" href="#two-a">Section 2\.1<\/a>End\.<\/p>/,
  );
  assert.equal(e.run(insertXref("nowhere")), false);
  assert.deepEqual(
    referenceTargets(e.state).map((t) => [t.id, t.label]),
    [
      ["one", "Section 1"],
      ["two", "Section 2"],
      ["tab", "Table 1"],
      ["two-a", "Section 2.1"],
    ],
  );
  // A second contents block, three levels deep.
  assert.ok(e.run(insertContents));
  assert.ok(e.state.selection instanceof NodeSelection);
  assert.ok(e.run(setContentsDepth(1)));
  const tocs = numbering(e.state.doc).tocs;
  assert.equal(tocs.length, 2);
  assert.deepEqual(
    e.state.doc.nodeAt(tocs[1].pos).attrs.entries.map((x) => x.target),
    ["one", "two"],
  );
  e.saved();
});

test("cross-references cannot go into code or a link", () => {
  const e = editor(
    '<pre><code>x</code></pre>\n<p><a href="https://a.b">link</a></p>\n<h1 id="h">H</h1>',
  );
  e.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 2)));
  assert.equal(e.run(insertXref("h")), false);
  e.dispatch(
    e.state.tr.setSelection(
      TextSelection.create(e.state.doc, e.find("link") + 2),
    ),
  );
  assert.ok(e.run(insertXref("h")));
  assert.match(
    e.saved(),
    /<a href="https:\/\/a.b">li<\/a><a class="xref" href="#h">Section 1<\/a><a href="https:\/\/a.b">nk<\/a>/,
  );
});
