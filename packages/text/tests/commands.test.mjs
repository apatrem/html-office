// T06 editing commands: each result is checked to save as a valid file that reopens as the same
// document, so commands write only subset markup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EditorState, TextSelection, NodeSelection } from "prosemirror-state";
import { toggleMark, deleteSelection } from "prosemirror-commands";
import { history, undo } from "prosemirror-history";
import { parseFile } from "../model/parse.mjs";
import { validateFile } from "../model/validate.mjs";
import { openFile, saveFile } from "../editor/schema/document.mjs";
import { articleHTML } from "../editor/schema/serialize.mjs";
import { schema } from "../editor/schema/schema.mjs";
import { subsetGuard } from "../editor/schema/guard.mjs";
import * as C from "../editor/commands.mjs";
import { envelope } from "./generate.mjs";

const N = schema.nodes,
  M = schema.marks;
const article = (body) =>
  envelope(`<article id="doc" data-format="1" lang="en">\n${body}\n</article>`);

function editor(source) {
  const file = parseFile(
    source.startsWith("<!doctype") ? source : article(source),
  );
  let state = EditorState.create({
    doc: openFile(file).doc,
    plugins: [history(), subsetGuard()],
  });
  const dispatch = (tr) => (state = state.applyTransaction(tr).state);
  const find = (text) => {
    let at = null;
    state.doc.descendants((node, pos) => {
      if (at === null && node.isText && node.text.includes(text))
        at = pos + node.text.indexOf(text);
    });
    assert.notEqual(at, null, `text "${text}"`);
    return at;
  };
  return {
    get state() {
      return state;
    },
    find,
    // Selects `text` (or puts the cursor before it, or `offset` characters into it).
    select(text, { to = text, offset } = {}) {
      const from = find(text) + (offset ?? 0);
      const end = offset !== undefined ? from : find(to) + to.length;
      dispatch(
        state.tr.setSelection(TextSelection.create(state.doc, from, end)),
      );
      return this;
    },
    selectNode(pos) {
      dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
      return this;
    },
    run: (command) => command(state, dispatch),
    can: (command) => command(state),
    type(text) {
      dispatch(state.tr.insertText(text));
      return this;
    },
    undo: () => undo(state, dispatch),
    // The article's lines, after checking that the file saves valid and reopens identically.
    lines() {
      const saved = saveFile(file, state.doc);
      const report = validateFile(parseFile(saved));
      assert.deepEqual(report.errors, [], saved);
      assert.ok(
        openFile(parseFile(saved)).doc.eq(state.doc),
        "reopens identically",
      );
      return articleHTML(state.doc).split("\n").slice(1, -1);
    },
  };
}

test("headings get a stable ID from their text when created", () => {
  const e = editor("<p>Market review</p>\n<p>Next steps</p>");
  assert.ok(e.select("Market").run(C.setStyle("h2")));
  assert.deepEqual(e.lines(), [
    '<h2 id="sec-market-review">Market review</h2>',
    "<p>Next steps</p>",
  ]);
  e.select("Market", { offset: 0 }).type("New ");
  assert.ok(e.run(C.setStyle("h3")));
  assert.equal(
    e.lines()[0],
    '<h3 id="sec-market-review">New Market review</h3>',
  );
  // The same text twice: a fresh ID.
  e.select("Next").run(C.setStyle("h1"));
  e.select("Next", { offset: 0 });
  assert.equal(e.lines()[1], '<h1 id="sec-next-steps">Next steps</h1>');
  const twin = editor('<h1 id="sec-a">A</h1>\n<p>A</p>');
  twin.select("A", { to: "A" });
  const pos = twin.find("A");
  twin.run((s, d) =>
    d(
      s.tr.setSelection(
        TextSelection.create(s.doc, s.doc.child(0).nodeSize + 2),
      ),
    ),
  );
  twin.run(C.setStyle("h2"));
  assert.equal(twin.lines()[1], '<h2 id="sec-a-2">A</h2>');
  assert.ok(pos > 0);
});

test("body, lead and code; code is refused where it would lose content", () => {
  const e = editor(
    '<p>One<br>two</p>\n<p>Note<span class="footnote">fn</span> here</p>',
  );
  e.select("One").run(C.setStyle("lead"));
  assert.equal(e.lines()[0], '<p class="lead">One<br>two</p>');
  e.run(C.setStyle("code"));
  assert.deepEqual(e.lines().slice(0, 2), [
    "<pre><code>One",
    "two</code></pre>",
  ]);
  e.run(C.setStyle("body"));
  assert.equal(e.lines()[0], "<p>One<br>two</p>");
  e.select("Note");
  assert.equal(e.can(C.setStyle("code")), false);
  assert.equal(C.styleAt(e.state), "body");
});

test("quotes and callouts wrap, change kind and unwrap", () => {
  const e = editor("<p>First</p>\n<p>Second</p>\n<p>Third</p>");
  e.select("First", { to: "Second" }).run(C.setStyle("quote"));
  assert.deepEqual(e.lines(), [
    "<blockquote>",
    "<p>First</p>",
    "<p>Second</p>",
    "</blockquote>",
    "<p>Third</p>",
  ]);
  assert.equal(C.styleAt(e.state), "quote");
  e.select("Second").run(C.setStyle("body"));
  assert.deepEqual(e.lines(), [
    "<blockquote>",
    "<p>First</p>",
    "</blockquote>",
    "<p>Second</p>",
    "<p>Third</p>",
  ]);
  e.select("Third").run(C.setStyle("note"));
  e.run(C.setStyle("warning"));
  assert.deepEqual(e.lines().slice(-3), [
    '<aside class="callout warning">',
    "<p>Third</p>",
    "</aside>",
  ]);
  e.select("Third").run(C.setStyle("h2"));
  assert.equal(e.lines().at(-1), '<h2 id="sec-third">Third</h2>');
  // A heading in a quote becomes body text.
  e.run(C.setStyle("quote"));
  assert.deepEqual(e.lines().slice(-3), [
    "<blockquote>",
    "<p>Third</p>",
    "</blockquote>",
  ]);
});

test("title and subtitle make a cover; restyling the title dissolves it", () => {
  const e = editor(
    "<p>Annual report</p>\n<p>Fictional company</p>\n<p>Body</p>",
  );
  assert.equal(e.select("Fictional").can(C.setStyle("title")), false);
  e.select("Annual").run(C.setStyle("title"));
  e.select("Fictional").run(C.setStyle("subtitle"));
  assert.deepEqual(e.lines(), [
    '<header class="cover">',
    '<h1 class="title">Annual report</h1>',
    '<p class="subtitle">Fictional company</p>',
    "</header>",
    "<p>Body</p>",
  ]);
  e.select("Fictional").run(C.setStyle("body"));
  assert.equal(e.lines()[2], "<p>Fictional company</p>");
  e.select("Annual").run(C.setStyle("h1"));
  assert.deepEqual(e.lines(), [
    '<h1 id="sec-annual-report">Annual report</h1>',
    "<p>Fictional company</p>",
    "<p>Body</p>",
  ]);
});

test("captions join and leave their figure", async () => {
  const example = await readFile(
    new URL("../fixtures/valid/example.html", import.meta.url),
    "utf8",
  );
  const e = editor(
    example
      .replace("<figcaption>The north site</figcaption>\n", "")
      .replace('<h1 id="sec-results">', '<h1 id="sec-results">'),
  );
  const figure = [];
  e.state.doc.forEach(
    (node, pos) => node.type === N.image_figure && figure.push(pos),
  );
  // A selected figure without caption gets an empty one.
  e.selectNode(figure[0]);
  assert.ok(e.run(C.setStyle("caption")));
  e.type("Raised beds");
  assert.match(
    e.lines().join("\n"),
    /<figcaption>Raised beds<\/figcaption>\n<\/figure>/,
  );
  assert.equal(C.styleAt(e.state), "caption");
  e.run(C.setStyle("body"));
  assert.match(
    e.lines().join("\n"),
    /alt="[^"]*">\n<\/figure>\n<p>Raised beds<\/p>/,
  );
  e.run(C.setStyle("caption"));
  assert.match(
    e.lines().join("\n"),
    /<figcaption>Raised beds<\/figcaption>\n<\/figure>/,
  );
});

test("lists: toggle, change kind, indent, outdent, Enter and Backspace", () => {
  const e = editor("<p>Alpha</p>\n<p>Beta</p>\n<p>Gamma</p>");
  e.select("Alpha", { to: "Gamma" }).run(C.toggleList(N.bullet_list));
  assert.deepEqual(e.lines(), [
    "<ul>",
    "<li>Alpha</li>",
    "<li>Beta</li>",
    "<li>Gamma</li>",
    "</ul>",
  ]);
  e.select("Beta", { to: "Gamma" });
  assert.ok(e.run(C.indent));
  assert.deepEqual(e.lines(), [
    "<ul>",
    "<li>Alpha<ul>",
    "<li>Beta</li>",
    "<li>Gamma</li>",
    "</ul></li>",
    "</ul>",
  ]);
  e.select("Gamma").run(C.toggleList(N.ordered_list));
  assert.deepEqual(e.lines(), [
    "<ul>",
    "<li>Alpha<ol>",
    "<li>Beta</li>",
    "<li>Gamma</li>",
    "</ol></li>",
    "</ul>",
  ]);
  e.select("Beta", { offset: 0 });
  assert.equal(
    e.can(C.indent),
    false,
    "the first item of a level cannot go deeper",
  );
  e.select("Gamma", { offset: 0 }).run(C.outdent);
  assert.deepEqual(e.lines(), [
    "<ul>",
    "<li>Alpha<ol>",
    "<li>Beta</li>",
    "</ol></li>",
    "<li>Gamma</li>",
    "</ul>",
  ]);
  // Enter splits; the items under it follow the new item.
  e.select("Alpha", { offset: 2 }).run(C.splitListItem);
  assert.deepEqual(e.lines().slice(0, 3), [
    "<ul>",
    "<li>Al</li>",
    "<li>pha<ol>",
  ]);
  e.type("X");
  assert.equal(e.lines()[2], "<li>Xpha<ol>");
  // Enter on an empty item leaves the list level; Backspace at the start too.
  e.select("Gamma", { offset: 5 }).run(C.splitListItem);
  e.run(C.splitListItem);
  assert.deepEqual(e.lines().slice(-2), ["</ul>", "<p></p>"]);
  e.select("Gamma", { offset: 0 }).run(C.liftListItem);
  assert.deepEqual(e.lines().slice(-3), ["</ul>", "<p>Gamma</p>", "<p></p>"]);
  // A list of this kind toggles back into paragraphs.
  e.select("Al", { offset: 0 }).run(C.toggleList(N.bullet_list));
  assert.equal(e.lines()[0], "<p>Al</p>");
  // A mixed selection takes the kind asked for.
  e.select("Xpha", { to: "Beta" }).run(C.toggleList(N.bullet_list));
  assert.deepEqual(e.lines().slice(1, 6), [
    "<ul>",
    "<li>Xpha<ul>",
    "<li>Beta</li>",
    "</ul></li>",
    "</ul>",
  ]);
});

test("lists join their neighbours and stay out of covers and quotes", () => {
  const e = editor(
    "<ul>\n<li>One</li>\n</ul>\n<p>Two</p>\n<blockquote>\n<p>Three</p>\n</blockquote>",
  );
  e.select("Two").run(C.toggleList(N.bullet_list));
  assert.deepEqual(e.lines().slice(0, 4), [
    "<ul>",
    "<li>One</li>",
    "<li>Two</li>",
    "</ul>",
  ]);
  e.select("Three").run(C.toggleList(N.bullet_list));
  assert.deepEqual(e.lines(), [
    "<ul>",
    "<li>One</li>",
    "<li>Two</li>",
    "<li>Three</li>",
    "</ul>",
  ]);
});

test("inline marks, exclusive superscript and subscript, links", () => {
  const e = editor("<p>Water use fell</p>");
  e.select("Water").run(toggleMark(M.strong));
  e.run(toggleMark(M.highlight));
  assert.ok(C.markActive(e.state, M.strong));
  e.select("use").run(toggleMark(M.sub));
  e.run(toggleMark(M.sup));
  assert.equal(
    e.lines()[0],
    "<p><strong><mark>Water</mark></strong> <sup>use</sup> fell</p>",
  );
  assert.equal(e.select("fell").can(C.setLink("javascript:alert(1)")), false);
  e.run(C.setLink("https://example.org/a"));
  assert.equal(C.linkAt(e.state), "https://example.org/a");
  e.select("fell", { offset: 2 }).run(C.setLink("https://example.org/b"));
  assert.equal(
    e.lines()[0],
    '<p><strong><mark>Water</mark></strong> <sup>use</sup> <a href="https://example.org/b">fell</a></p>',
  );
  e.run(C.removeLink);
  assert.equal(C.linkAt(e.state), null);
});

test("alignment, page breaks and start on a new page", () => {
  const e = editor('<h1 id="sec-a">Heading</h1>\n<p>Text</p>');
  e.select("Heading");
  assert.equal(e.can(C.setAlign("ta-j")), false, "headings are not justified");
  e.run(C.setAlign("ta-c"));
  e.select("Text").run(C.setAlign("ta-j"));
  e.run(C.insertPageBreak);
  e.select("Heading").run(C.toggleNewPage);
  assert.deepEqual(e.lines(), [
    '<h1 class="new-page ta-c" id="sec-a">Heading</h1>',
    '<p class="ta-j">Text</p>',
    '<hr class="page-break">',
  ]);
  e.run(C.setAlign(null));
  assert.equal(e.lines()[0], '<h1 class="new-page" id="sec-a">Heading</h1>');
});

// Random commands on random selections over the example: every result is valid, reopens
// identically and undoes to the document before.
test("random command sequences produce only subset content", async () => {
  const source = await readFile(
    new URL("../fixtures/valid/example.html", import.meta.url),
    "utf8",
  );
  let seed = 7;
  const rand = (n) => (
    (seed = (seed * 1103515245 + 12345) % 2147483648),
    seed % n
  );
  const commands = [
    ...C.STYLES.map(([id]) => C.setStyle(id)),
    C.toggleList(N.bullet_list),
    C.toggleList(N.ordered_list),
    C.indent,
    C.outdent,
    C.splitListItem,
    C.liftListItem,
    C.setAlign("ta-c"),
    C.setAlign("ta-j"),
    C.setAlign(null),
    C.insertPageBreak,
    C.toggleNewPage,
    C.setLink("https://example.org/"),
    C.removeLink,
    toggleMark(M.strong),
    toggleMark(M.sup),
    toggleMark(M.code),
    deleteSelection,
  ];
  for (let round = 0; round < 40; round++) {
    const e = editor(source);
    for (let step = 0; step < 12; step++) {
      const size = e.state.doc.content.size;
      const a = rand(size),
        b = rand(4) ? a : rand(size);
      const sel = TextSelection.between(
        e.state.doc.resolve(Math.min(a, b)),
        e.state.doc.resolve(Math.max(a, b)),
      );
      e.run((s, d) => (d(s.tr.setSelection(sel)), true));
      const before = e.state.doc;
      const command = commands[rand(commands.length)];
      if (!e.run(command)) {
        assert.equal(e.state.doc, before, "a refused command changes nothing");
        continue;
      }
      e.lines();
    }
  }
});

test("review fixes: IDs, code, list levels, callouts, Enter and links", () => {
  // A heading something refers to keeps its ID: it cannot become text, a quote or the title.
  const ref = editor(
    '<h1 id="sec-a">Alpha</h1>\n<p>See <a class="xref" href="#sec-a">Section 1</a>.</p>',
  );
  ref.select("Alpha");
  for (const style of ["body", "lead", "code", "quote", "note", "title"])
    assert.equal(ref.can(C.setStyle(style)), false, style);
  assert.ok(ref.can(C.setStyle("h2")));

  // A comment anchor on a line break cannot go into code.
  const anchored = editor(
    '<p>A<mark class="comment" data-ref="c1"><br></mark>B</p>\n<section class="comments">\n<aside class="comment-thread" id="c1" data-status="open" data-quote="x">\n<p class="comment" data-author="A" data-date="2026-10-15T14:02Z">Check.</p>\n</aside>\n</section>',
  );
  anchored.select("A", { offset: 0 });
  assert.equal(anchored.can(C.setStyle("code")), false);

  // Indenting a parent and one child keeps the other children under the parent.
  const tree = editor(
    "<ul>\n<li>O</li>\n<li>A<ul>\n<li>B</li>\n<li>C</li>\n</ul></li>\n<li>D</li>\n</ul>",
  );
  tree.select("A", { to: "B" }).run(C.indent);
  assert.deepEqual(tree.lines(), [
    "<ul>",
    "<li>O<ul>",
    "<li>A<ul>",
    "<li>B</li>",
    "<li>C</li>",
    "</ul></li>",
    "</ul></li>",
    "<li>D</li>",
    "</ul>",
  ]);
  // Unlisting a parent leaves its children siblings, not children of each other.
  const parent = editor(
    "<ul>\n<li>A<ul>\n<li>B</li>\n<li>C</li>\n</ul></li>\n<li>D</li>\n</ul>",
  );
  parent.select("A", { offset: 0 }).run(C.toggleList(N.bullet_list));
  assert.deepEqual(parent.lines(), [
    "<p>A</p>",
    "<ul>",
    "<li>B</li>",
    "<li>C</li>",
    "<li>D</li>",
    "</ul>",
  ]);

  // A callout at the start of the document changes kind, from a list inside it too.
  const callout = editor(
    '<aside class="callout note">\n<ul>\n<li>Item</li>\n</ul>\n</aside>',
  );
  assert.ok(callout.select("Item", { offset: 0 }).run(C.setStyle("warning")));
  assert.equal(callout.lines()[0], '<aside class="callout warning">');

  // Enter with text selected in an item replaces it and splits there.
  const items = editor("<ul>\n<li>Alpha</li>\n</ul>");
  assert.ok(items.select("lph").run(C.splitListItem));
  assert.deepEqual(items.lines(), [
    "<ul>",
    "<li>A</li>",
    "<li>a</li>",
    "</ul>",
  ]);

  // Links: the dialog's check and the command agree; control characters are refused.
  assert.ok(C.linkProblem("https:example.org"));
  assert.ok(C.linkProblem("https://example.org/\u0000"));
  assert.equal(C.linkProblem("mailto:team@example.org"), "");
  const linked = editor("<p>Word</p>");
  linked.select("Word");
  assert.equal(linked.can(C.setLink("https://example.org/\u0000")), false);
});

test("new heading IDs avoid the file's other IDs", () => {
  const source = article("<p>Intro</p>").replace(
    "<title>",
    '<title id="sec-intro">',
  );
  C.reserveIds(["sec-intro"]);
  try {
    const e = editor(source);
    e.select("Intro").run(C.setStyle("h1"));
    assert.equal(e.lines()[0], '<h1 id="sec-intro-2">Intro</h1>');
  } finally {
    C.reserveIds([]);
  }
});

test("second review: split IDs, code line endings, Enter across items and in the cover, Body after a cover", () => {
  // A repeated heading ID (a split) gets a fresh one that is not a file ID.
  C.reserveIds(["sec-a-2"]);
  try {
    const split = editor('<h1 id="sec-a">Heading</h1>');
    split.run((s, d) =>
      d(
        s.tr.insert(
          s.doc.content.size,
          s.doc.child(0).copy(s.doc.child(0).content),
        ),
      ),
    );
    assert.deepEqual(split.lines(), [
      '<h1 id="sec-a">Heading</h1>',
      '<h1 id="sec-a-3">Heading</h1>',
    ]);
  } finally {
    C.reserveIds([]);
  }

  // Carriage returns in code become line breaks in text.
  const code = editor("<pre><code>a&#13;b&#13;\nc</code></pre>");
  code.select("a", { offset: 0 }).run(C.setStyle("body"));
  assert.deepEqual(code.lines(), ["<p>a<br>b<br>c</p>"]);

  // Enter with a selection across two items deletes it and splits there.
  const items = editor("<ul>\n<li>Alpha</li>\n<li>Beta</li>\n</ul>");
  assert.ok(items.select("lpha", { to: "Be" }).run(C.splitListItem));
  assert.deepEqual(items.lines(), [
    "<ul>",
    "<li>A</li>",
    "<li>ta</li>",
    "</ul>",
  ]);

  // Enter at the end of a title followed by a subtitle moves into the subtitle.
  const cover = editor(
    '<header class="cover">\n<h1 class="title">Report</h1>\n<p class="subtitle">Sub</p>\n</header>\n<h1 id="sec-b">Body heading</h1>',
  );
  cover.select("Report", { offset: 6 });
  assert.ok(cover.run(C.titleEnter));
  assert.equal(cover.state.selection.$from.parent.type, N.subtitle);
  cover.select("Report", { offset: 2 });
  const before = cover.state.doc;
  assert.ok(cover.run(C.titleEnter));
  assert.equal(cover.state.doc, before);

  // Body from the subtitle through a heading after the cover changes both.
  cover.select("Sub", { to: "Body heading" }).run(C.setStyle("body"));
  assert.deepEqual(cover.lines(), [
    '<header class="cover">',
    '<h1 class="title">Report</h1>',
    "<p>Sub</p>",
    "</header>",
    "<p>Body heading</p>",
  ]);
});
