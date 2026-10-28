// T07 paste and Markdown import in Node: clipboard HTML (Word, Docs, Excel, Sheets, web pages,
// Text itself) and Markdown onto the subset, portable tables both ways. Every result must save as
// a valid file without protected blocks that reopens identically. parse5 stands in for the
// browser's inert <template> (tests/helpers/inert-dom.mjs at the repository root).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseInert } from "../../../tests/helpers/inert-dom.mjs";
import {
  ClipboardError,
  readTable,
  validateTable,
} from "../../shared/clipboard/index.mjs";
import { parseFile } from "../model/parse.mjs";
import { serialize } from "../model/html.mjs";
import { validateFile } from "../model/validate.mjs";
import { openFile, saveFile } from "../editor/schema/document.mjs";
import { articleHTML, blockTree } from "../editor/schema/serialize.mjs";
import { schema } from "../editor/schema/schema.mjs";
import {
  fromHTML,
  textBlocks,
  inlineLines,
  describeLost,
} from "../editor/clipboard/html.mjs";
import { markdownHTML } from "../editor/clipboard/markdown.mjs";
import {
  tableNode,
  tableFigure,
  portableTable,
  LIMIT,
} from "../editor/clipboard/table.mjs";
import { envelope } from "./generate.mjs";

const N = schema.nodes;
const fixture = (name) =>
  readFile(new URL(`../fixtures/clipboard/${name}`, import.meta.url), "utf8");
const shared = (name) =>
  readFile(
    new URL(`../../shared/clipboard/fixtures/${name}`, import.meta.url),
    "utf8",
  );

// The blocks as a saved file: valid, nothing protected, canonical; returns the article's HTML.
function saved(blocks) {
  const doc = N.doc.create({ lang: "en" }, blocks);
  doc.check();
  const html = articleHTML(doc);
  const text = envelope(html);
  const file = parseFile(text);
  const report = validateFile(file);
  assert.deepEqual(report.errors, [], "valid");
  assert.equal(report.protected.length, 0, "nothing protected");
  assert.equal(saveFile(file, openFile(file).doc), text, "canonical");
  return html;
}
const map = (html, used = new Set()) => fromHTML(parseInert(html), { used });
const body = (html) =>
  html.replace(/^<article[^>]*>\n/, "").replace(/<\/article>$/, "");

test("Word: title, headings, lists by level and kind, marks, links; notes and images left out", async () => {
  const { blocks, lost } = map(await fixture("word-document.html"));
  assert.equal(
    body(saved(blocks)),
    `<h1 id="sec-community-garden-report">Community garden report</h1>
<p class="lead">Spring 2027</p>
<h1 id="sec-summary">Summary</h1>
<p>The volunteers planted <strong>forty</strong> raised beds and logged <em>320 hours</em>, see the <a href="https://example.org/plan">planting plan</a>. Water use <u>fell</u> by 12<sup>%</sup> and <strong>costs</strong> stayed flat.</p>
<h2 id="sec-next-steps">Next steps</h2>
<ul>
<li>Order compost<ul>
<li>Two <strong>tonnes</strong> for the north site</li>
</ul></li>
<li>Repair the shed</li>
</ul>
<ol>
<li>Book the hall</li>
<li>Send invitations</li>
</ol>
<figure class="table" id="tab-1">
<table>
<tbody>
<tr><td><strong>Site</strong></td><td class="ta-r"><strong>Beds</strong></td></tr>
<tr><td>North</td><td class="ta-r">24</td></tr>
</tbody>
</table>
</figure>
`,
  );
  assert.equal(
    describeLost(lost),
    "Left out: 1 image, 2 Word footnotes or comments.",
  );
});

test("Google Docs: the normal-weight wrapper, span styles, nested lists, a table; the image left out", async () => {
  const { blocks, lost } = map(await fixture("docs-document.html"));
  assert.equal(
    body(saved(blocks)),
    `<h1 id="sec-volunteer-plan">Volunteer plan</h1>
<p>We meet <strong>every Saturday</strong><em> at nine</em>; read the <a href="https://example.org/rota">rota</a><u> first</u><sup>2</sup>.</p>
<h2 id="sec-tasks">Tasks</h2>
<ul>
<li>Watering<ul>
<li>North beds</li>
</ul></li>
<li>Weeding</li>
</ul>
<ol>
<li>Sign in</li>
</ol>
<figure class="table" id="tab-1">
<table>
<tbody>
<tr><td><strong>Day</strong></td><td class="ta-r"><strong>Volunteers</strong></td></tr>
<tr><td>Saturday</td><td class="ta-r">14</td></tr>
</tbody>
</table>
</figure>
`,
  );
  assert.equal(describeLost(lost), "Left out: 1 image.");
});

test("web page: article content kept, navigation, forms, media and unsafe links dropped", async () => {
  const { blocks, lost } = map(await fixture("web-page.html"));
  const html = saved(blocks);
  assert.equal(
    body(html),
    `<h1 id="spring-harvest">Spring harvest</h1>
<p class="lead">A record year for the <a href="https://example.org/garden">community garden</a>, says <em>Ana</em>.</p>
<p>Read the full report, the summary or the numbers. Contact <a href="mailto:team@example.org">the team</a>.</p>
<p>The new raised beds</p>
<blockquote>
<p>Best season <strong>ever</strong>.</p>
<p>Agreed.</p>
<p>Quoted item</p>
</blockquote>
<h3 id="sec-numbers">Numbers</h3>
<figure class="table" id="tab-1">
<figcaption>Harvest by crop</figcaption>
<table>
<thead>
<tr><th>Crop</th><th class="ta-r">kg</th></tr>
</thead>
<tbody>
<tr><td>Tomatoes</td><td class="ta-r">120</td></tr>
<tr><td colspan="2"><em>Herbs not weighed</em></td></tr>
<tr class="total"><td>Total</td><td class="ta-r">120</td></tr>
</tbody>
</table>
</figure>
<pre><code>water --beds 40
compost --tonnes 2</code></pre>
<h4 id="sec-footnote-heading">Footnote heading</h4>
<p>Line one<br>line two &amp; <code>code</code>, H<sub>2</sub>O, x<sup>2</sup>, <mark>marked</mark>, struck, <strong>styled bold</strong>.</p>
<p>Email</p>
<p>Beds</p>
<p>Forty</p>
<ol>
<li>First paragraph<br>Second paragraph</li>
<li>Second item<ol>
<li>Nested</li>
</ol></li>
</ol>
<p>© 2027 Garden club</p>
`,
  );
  assert.equal(
    describeLost(lost),
    "Left out: 2 images, 1 horizontal rule, 3 embedded objects. Adapted to the document's styles: 1 heading of level 5 or 6, 2 blocks inside quotes, 1 block inside a list item, 2 links to other kinds of addresses.",
  );
  assert.doesNotMatch(html, /alert|steal|onclick|onmouseover|svg text|Hidden/);
});

test("Excel, Sheets, Word and Docs tables: the shared reader's portable table, as a Text table", async () => {
  for (const name of [
    "excel-macos.html",
    "sheets-fr.html",
    "word-macos.html",
    "docs.html",
  ]) {
    const html = await shared(name);
    const { blocks } = map(html);
    const figures = blocks.filter((b) => b.type === N.table_figure);
    assert.equal(figures.length, 1, name);
    // The same grid as the reader's portable table, slot for slot.
    const { table } = readTable(parseInert(html));
    const back = portableTable(figures[0].lastChild);
    assert.equal(back.rows.length, table.rows.length, name);
    assert.deepEqual(
      back.rows.map((row) => row.map((slot) => slot?.text ?? null)),
      table.rows.map((row) =>
        row.map((slot) => (slot?.covered ? null : (slot?.text ?? null))),
      ),
      name,
    );
    saved(blocks);
  }
  const excel = saved(map(await shared("excel-macos.html")).blocks);
  assert.match(excel, /<td class="ta-c" colspan="3">Quarterly sales<\/td>/);
  assert.match(excel, /<td class="ta-r">\(5,000\)<\/td>/);
  assert.match(excel, /Line one<br>line two/);
});

test("Text's own markup reads back as itself: blocks, inline marks, footnotes, tables", async () => {
  for (const name of ["blocks.html", "inline.html", "tables.html"]) {
    const source = await readFile(
      new URL(`../fixtures/valid/${name}`, import.meta.url),
      "utf8",
    );
    const { doc } = openFile(parseFile(source));
    const html = [];
    doc.forEach((block) => html.push(serialize(blockTree(block))));
    const { blocks } = map(html.join("\n"));
    let expected = articleHTML(doc).replace(' lang="en-GB"', ' lang="en"');
    // Pasting gives a new ID to tables and the cover title, keeps neither comments nor generated
    // contents, and turns the cover into a heading and paragraphs.
    expected = expected
      .replace(
        /<p><mark class="comment"[^\n]*<\/p>/,
        "<p>Commented <strong>bold</strong> text and overlapping comments.</p>",
      )
      .replace(/<section class="comments">[^]*<\/section>\n/, "")
      .replace(/<nav class="toc"[^>]*><\/nav>\n/, "")
      .replace(
        /<header class="cover">\n<h1 class="title">Cover title<\/h1>\n<\/header>/,
        '<h1 id="sec-cover-title">Cover title</h1>',
      );
    let n = 0;
    expected = expected.replace(/id="tab-[a-z]+"/g, () => `id="tab-${++n}"`);
    assert.equal(saved(blocks), expected, name);
  }
});

test("portable tables: spans, header and total rows, alignment, widths and runs both ways", async () => {
  const source = await readFile(
    new URL("../fixtures/valid/tables.html", import.meta.url),
    "utf8",
  );
  const { doc } = openFile(parseFile(source));
  doc.forEach((figure) => {
    if (figure.type !== N.table_figure) return;
    const table = figure.lastChild;
    const model = portableTable(table);
    validateTable(model);
    const again = tableNode(model);
    // Emphasis columns and density are Text's own: they do not travel.
    const strip = (t) =>
      serialize(blockTree(t)).replace(/ class="compact"/, "");
    assert.equal(serialize(blockTree(again)), strip(table));
  });
  const model = {
    rows: [
      [
        { text: "Region", header: true, rowspan: 2 },
        { text: "2026", header: true },
      ],
      [{ covered: true }, { text: "H1", header: true }],
      [
        {
          text: "North east",
          runs: [
            { text: "North " },
            {
              text: "east",
              italic: true,
              link: { url: "https://example.org/ne" },
            },
          ],
        },
        {
          text: "1 234,5 €",
          value: { type: "number", value: 1234.5 },
          align: "right",
          color: "alert",
        },
      ],
      [
        { text: "Total", bold: true },
        { text: "9", cellStyle: "alert" },
      ],
    ],
    headerRows: 1,
    totalRows: [3],
    columns: [{ width: 62.4 }, { align: "right", width: 37.6 }],
  };
  const html = saved([tableFigure(validateTable(model), new Set(["tab-1"]))]);
  assert.equal(
    html.replace(/^<article[^>]*>\n|<\/article>$/g, ""),
    `<figure class="table" id="tab-2">
<table>
<colgroup><col data-width="62"><col data-width="38"></colgroup>
<thead>
<tr><th>Region</th><th class="ta-r">2026</th></tr>
</thead>
<tbody>
<tr><td></td><th class="ta-r">H1</th></tr>
<tr><td>North <a href="https://example.org/ne"><em>east</em></a></td><td class="ta-r">1 234,5 €</td></tr>
<tr class="total"><td>Total</td><td class="ta-r">9</td></tr>
</tbody>
</table>
</figure>
`,
  );
});

test("tables over 1,000 rows or 30 columns are refused whole", () => {
  const rows = (r, c) =>
    Array.from({ length: r }, () =>
      Array.from({ length: c }, () => ({ text: "x" })),
    );
  assert.throws(
    () => tableNode({ rows: rows(LIMIT.rows + 1, 1) }),
    ClipboardError,
  );
  assert.throws(
    () => tableNode({ rows: rows(1, LIMIT.columns + 1) }),
    ClipboardError,
  );
  tableNode({ rows: rows(LIMIT.rows, 1) });
  const wide = `<table>${"<tr>" + "<td>x</td>".repeat(31) + "</tr>"}</table>`;
  assert.throws(() => map(wide), ClipboardError);
});

test("hostile HTML is data: nothing runs, loads or links outside web and mail addresses", () => {
  const { blocks, lost } = map(`
    <base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example/">
    <p onclick="x()" style="color:red;background:url(https://evil.example/a.png)">Click <a href="javascript:x()">me</a>
    <a href="data:text/html,<script>x()</script>">data</a> <a href="vbscript:x">vb</a> <a href=" https://example.org/ok ">ok</a>
    <img src="x" onerror="x()"><svg onload="x()"><script>x()</script></svg><iframe srcdoc="<p>framed"></iframe>
    <object data="x.swf"></object><math><mi>x</mi></math><template><p>template</p></template><noscript>no script</noscript>
    <a href="https://example.org/a" onmouseover="x()" style="color:red">styled link</a></p>
    <h7>Not a heading</h7><x-widget>custom</x-widget><input value="input"><textarea>area</textarea>
    <table><tr><td><script>x()</script><a href="javascript:x()">cell</a></td></tr></table>`);
  const html = saved(blocks);
  assert.doesNotMatch(
    html,
    /x\(\)|evil|javascript|vbscript|data:|framed|template|no script|input|area|<img|<svg|<math/,
  );
  assert.match(html, /<a href="https:\/\/example.org\/ok">ok<\/a>/);
  assert.match(html, /<a href="https:\/\/example.org\/a">styled link<\/a>/);
  assert.match(html, /<p>Not a heading custom<\/p>|Not a heading/);
  assert.equal(lost.get("image"), 1);
  assert.equal(lost.get("media"), 4);
  assert.equal(lost.get("link"), 4);
});

test("plain text: one paragraph per line, controls and tabs cleaned", () => {
  assert.equal(
    body(saved(textBlocks("First\tline\r\n\r\nSecond \u0007line\rThird\n"))),
    "<p>First line</p>\n<p>Second line</p>\n<p>Third</p>\n",
  );
  assert.deepEqual(textBlocks(" \n\t\n"), []);
});

test("blocks as one paragraph's lines: a table gives one line per row", () => {
  const { blocks } = map(
    "<h2>Title</h2><ul><li>a</li><li>b</li></ul><table><tr><td>1</td><td>2</td></tr><tr><td>3</td></tr></table><pre>x\ny</pre>",
  );
  const p = N.paragraph.create(null, inlineLines(blocks));
  assert.equal(
    serialize(blockTree(p)),
    "<p>Title<br>a<br>b<br>1 2<br>3<br>x<br>y</p>",
  );
});

test("Markdown: CommonMark with tables, nested lists, HTML fragments; what it cannot represent is reported", async () => {
  const { blocks, lost } = map(markdownHTML(await fixture("report.md")));
  assert.equal(
    body(saved(blocks)),
    `<h1 id="sec-garden-report">Garden report</h1>
<p>An <em>overview</em> of the <strong>2027</strong> season, with <code>inline code</code>, a <a href="https://example.org/plan">link</a>, an autolink <a href="https://example.org/autolink">https://example.org/autolink</a> and entities: © &amp; € &amp;unknown;. Hard break at the end of this line<br>and a backslash break<br>here.</p>
<h2 id="sec-harvest">Harvest</h2>
<figure class="table" id="tab-1">
<table>
<thead>
<tr><th class="ta-l">Crop</th><th class="ta-c">Site</th><th class="ta-r">kg</th></tr>
</thead>
<tbody>
<tr><td class="ta-l">Tomatoes</td><td class="ta-c">North</td><td class="ta-r">120</td></tr>
<tr><td class="ta-l"><em>Herbs</em> | spices</td><td class="ta-c"><code>South</code></td><td class="ta-r"><a href="https://example.org/herbs">42</a></td></tr>
<tr><td class="ta-l">Beans</td><td class="ta-c">East</td><td></td></tr>
</tbody>
</table>
</figure>
<h3 id="sec-tasks">Tasks</h3>
<ul>
<li>Water the beds</li>
<li>Weed<ol>
<li>North</li>
<li>South<ul>
<li>early</li>
</ul></li>
</ol></li>
<li>Order compost<br>Two tonnes, delivered.</li>
</ul>
<ol>
<li>Book the hall</li>
<li>Send invitations</li>
</ol>
<blockquote>
<p>A quote with <strong>bold</strong>.</p>
<p>A nested quote.</p>
<p>a list in a quote</p>
</blockquote>
<h4 id="sec-a-fifth-level-heading">A fifth-level heading</h4>
<p>Raw <strong>HTML</strong> block</p>
<p>More</p>
<p>Hidden details</p>
<p>Inline styled HTML and a bad link.</p>
<pre><code>const beds = 40;
if (beds &lt; 50) water();</code></pre>
<pre><code>indented code</code></pre>
<p>Not | a table</p>
`,
  );
  assert.equal(
    describeLost(lost),
    "Left out: 1 image, 1 horizontal rule. Adapted to the document's styles: 1 heading of level 5 or 6, 2 blocks inside quotes, 1 block inside a list item, 1 link to another kind of address.",
  );
});

test("Markdown tables: only with a matching delimiter row, at the top level, after a paragraph", () => {
  const html = (md) => body(saved(map(markdownHTML(md)).blocks));
  assert.equal(
    html("Intro line\n| a | b |\n|---|---|\n| 1 | `x \\| y` |\n| 2 | 3 | 4 |"),
    `<p>Intro line</p>
<figure class="table" id="tab-1">
<table>
<thead>
<tr><th>a</th><th>b</th></tr>
</thead>
<tbody>
<tr><td>1</td><td><code>x | y</code></td></tr>
<tr><td>2</td><td>3</td></tr>
</tbody>
</table>
</figure>
`,
  );
  // A delimiter row of another width, or no pipe at all, is no table.
  assert.equal(
    html("| a | b |\n|---|\n| 1 | 2 |"),
    "<p>| a | b | |---| | 1 | 2 |</p>\n",
  );
  assert.equal(html("a\n-"), '<h2 id="sec-a">a</h2>\n');
  // A table in a list item stays text: the subset holds no table there.
  assert.match(
    html("- | a |\n  |---|\n  | 1 |"),
    /<ul>\n<li>\| a \| \|---\| \| 1 \|<\/li>/,
  );
  // A table needs only one column with pipes.
  assert.match(html("| a |\n| :-: |\n| 1 |"), /<th class="ta-c">a<\/th>/);
});

test("pasted heading IDs: kept when free and valid, otherwise new", () => {
  const used = new Set(["taken", "sh-x"]);
  const { blocks } = map(
    '<h2 id="free">A</h2><h2 id="taken">B</h2><h2 id="1bad">C</h2><h2 id="sh-reserved">D</h2><h2 id="free">E</h2>',
    used,
  );
  assert.deepEqual(
    blocks.map((b) => b.attrs.id),
    ["free", "sec-b", "sec-c", "sec-d", "sec-e"],
  );
});

test("review: overlapping spans are kept as plain cells; spans stop at their row group", () => {
  const { blocks, lost } = map(
    '<table><tr><td>A</td><td rowspan="2">B</td></tr><tr><td colspan="2">C</td></tr></table>',
  );
  assert.match(
    saved(blocks),
    /<tr><td>A<\/td><td>B<\/td><\/tr>\n<tr><td>C<\/td><td><\/td><\/tr>/,
  );
  assert.equal(lost.get("span"), 1);
  const head = map(
    '<table><thead><tr><th rowspan="0">A</th><th>B</th></tr></thead><tbody><tr><td>C</td><td>D</td></tr></tbody></table>',
  );
  assert.match(
    saved(head.blocks),
    /<thead>\n<tr><th>A<\/th><th>B<\/th><\/tr>\n<\/thead>\n<tbody>\n<tr><td>C<\/td><td>D<\/td><\/tr>/,
  );
});

test("review: deep lists stay within the format, very deep ones do not overflow the stack", () => {
  const nested = (n) => "<ul><li>".repeat(n) + "x" + "</li></ul>".repeat(n);
  saved(map(nested(150)).blocks);
  const { blocks, lost } = map(nested(5000));
  saved(blocks);
  assert.ok(lost.get("item") >= 1);
  saved(
    map(
      "<pre>" +
        "<span>".repeat(5000) +
        "deep" +
        "</span>".repeat(5000) +
        "</pre>",
    ).blocks,
  );
});

test("review: control characters in envelope text are dropped, so the file reopens the same", () => {
  saved([
    tableFigure(
      validateTable({ rows: [[{ text: "a\u0000b\u0007" }]] }),
      new Set(),
    ),
  ]);
});

test("review: text copied inside one Text table cell pastes as text, not as a table", () => {
  const { blocks } = map(
    '<table data-pm-slice="1 1 -3 [&quot;table_figure&quot;,{&quot;id&quot;:&quot;tab-a&quot;}]"><tbody><tr><td><strong>b</strong></td></tr></tbody></table>',
  );
  assert.equal(body(saved(blocks)), "<p><strong>b</strong></p>\n");
  // A whole copied table keeps its shape.
  assert.equal(
    map('<table data-pm-slice="0 0 []"><tr><td>b</td></tr></table>').blocks[0]
      .type.name,
    "table_figure",
  );
});

test("review: Markdown tables over the limits are refused before rendering; a setext line is a row", () => {
  const wide = `|${" a |".repeat(31)}\n|${" - |".repeat(31)}\n`;
  assert.throws(() => markdownHTML(wide), ClipboardError);
  const started = Date.now();
  const long =
    `|${" a |".repeat(30)}\n|${" - |".repeat(30)}\n` + "| x |\n".repeat(1001);
  assert.throws(() => markdownHTML(long), ClipboardError);
  assert.ok(Date.now() - started < 2000);
  assert.match(
    body(
      saved(
        map(markdownHTML("| a | b |\n| --- | --- |\n| c | d |\n===")).blocks,
      ),
    ),
    /<tr><td>c<\/td><td>d<\/td><\/tr>\n<tr><td>===<\/td><td><\/td><\/tr>/,
  );
});

test("review 2: very wide elements and copied rows; text beside a copied cell is kept", () => {
  saved(
    map("<pre><span>" + "<i>x</i>".repeat(150000) + "</span></pre>").blocks,
  );
  saved(
    map(
      "<span>".repeat(202) + "<i>x</i>".repeat(150000) + "</span>".repeat(202),
    ).blocks,
  );
  assert.equal(
    map(
      '<table data-pm-slice="0 0 -2 []"><tbody><tr><td>b</td></tr></tbody></table>',
    ).blocks[0].type.name,
    "table_figure",
  );
  const { blocks } = map(
    '<table data-pm-slice="1 1 -3 []"><tr><td>b</td></tr></table><p>keep me</p>',
  );
  assert.match(saved(blocks), /keep me/);
});

test("re-verification: deep Word lists stay within the format; a copied cell must be the only content", () => {
  const word = (n, inner = "x") =>
    Array.from(
      { length: n },
      (_, i) => `<p style="mso-list:l0 level${i + 1} lfo1">${inner}</p>`,
    ).join("");
  saved(map(word(150)).blocks);
  saved(map(word(5000)).blocks);
  saved(
    map(
      `<p style="mso-list:l0 level1 lfo1">${"<span>".repeat(5000)}<span style="mso-list:Ignore">1.</span>${"</span>".repeat(5000)}x</p>`,
    ).blocks,
  );
  const wrapped = map(
    '<div data-pm-slice="1 1 -3 []"><p>keep me</p><table><tr><td>b</td></tr></table></div>',
  );
  assert.match(saved(wrapped.blocks), /keep me/);
  assert.equal(
    map(
      '<table style="display:none" data-pm-slice="1 1 -3 []"><tr><td>hidden</td></tr></table>',
    ).blocks.length,
    0,
  );
});

test("re-verification: paragraph lines after a setext underline are still table rows", () => {
  const html = body(
    saved(
      map(markdownHTML("| a | b |\n| --- | --- |\n| c | d |\n===\n| e | f |"))
        .blocks,
    ),
  );
  assert.match(html, /<tr><td>e<\/td><td>f<\/td><\/tr>/);
  assert.doesNotMatch(html, /<p>\| e/);
  const after = body(
    saved(map(markdownHTML("| a |\n| --- |\n| b |\n===\n\nafter")).blocks),
  );
  assert.match(after, /<p>after<\/p>/);
});
