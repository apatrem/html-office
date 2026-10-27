import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { EditorState, TextSelection } from "prosemirror-state";
import { parseFile } from "../model/parse.mjs";
import { validateFile } from "../model/validate.mjs";
import {
  openFile,
  saveFile,
  canonicalize,
} from "../editor/schema/document.mjs";
import { articleHTML } from "../editor/schema/serialize.mjs";
import { schema } from "../editor/schema/schema.mjs";
import { subsetGuard, linkConflicts } from "../editor/schema/guard.mjs";
import { pack, diffLines } from "../tools/pack.mjs";
import { checkSource } from "../tools/check.mjs";
import { generate, envelope } from "./generate.mjs";

const fixtures = new URL("../fixtures/", import.meta.url);
const read = (path) => readFile(new URL(path, fixtures), "utf8");
const list = async (dir) =>
  (await readdir(new URL(dir, fixtures))).filter((f) => f.endsWith(".html"));
const open = (source) => openFile(parseFile(source));
const roundTrip = (source) => {
  const file = parseFile(source);
  return saveFile(file, openFile(file).doc);
};

test("every valid fixture opens and saves byte for byte", async () => {
  for (const name of await list("valid/")) {
    const source = await read(`valid/${name}`);
    assert.equal(roundTrip(source), source, name);
    assert.deepEqual(
      checkSource(source).warnings.filter((w) => w.code === "not-canonical"),
      [],
      name,
    );
  }
});

test("unsafe or malformed files are refused before a document is built", async () => {
  for (const name of await list("invalid/")) {
    const source = await read(`invalid/${name}`);
    assert.throws(
      () => open(source),
      (e) => e.report?.errors.length > 0,
      name,
    );
  }
});

test("protected blocks keep their bytes and are not editable", async () => {
  const source = await read("valid/protected.html");
  const { doc } = open(source);
  const kept = [];
  doc.forEach((n) => n.type.name === "protected" && kept.push(n));
  assert.equal(kept.length, 14);
  assert.ok(kept.every((n) => n.isAtom && n.childCount === 0));
  assert.equal(roundTrip(source), source);
});

// The canonical form is a fixed point: serialise, parse, serialise again gives the same bytes and document.
test("generated documents round-trip (Unicode, markup-like text, every construct)", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const doc = generate(seed, 25);
    const source = envelope(articleHTML(doc));
    const report = validateFile(parseFile(source));
    assert.deepEqual(report.errors, [], `seed ${seed}`);
    assert.deepEqual(report.protected, [], `seed ${seed}`);
    const reopened = open(source).doc;
    assert.ok(reopened.eq(doc), `seed ${seed}: documents differ`);
    assert.equal(roundTrip(source), source, `seed ${seed}`);
  }
});

test("a long document (about 100 pages) round-trips", () => {
  const doc = generate(7, 4000);
  const source = envelope(articleHTML(doc));
  assert.ok(source.length > 1_000_000, `${source.length} bytes`);
  const started = performance.now();
  assert.equal(roundTrip(source), source);
  assert.ok(performance.now() - started < 10_000);
});

// Applies a change through a ProseMirror transaction and returns the changed lines of the file.
async function edit(name, change) {
  const source = await read(`valid/${name}`);
  const file = parseFile(source);
  const state = EditorState.create({ doc: openFile(file).doc });
  const tr = change(state);
  assert.ok(tr.docChanged);
  const saved = saveFile(file, tr.doc);
  return diffLines(source.split("\n"), saved.split("\n"))
    .filter((e) => e.op !== " ")
    .map((e) => `${e.op}${e.text}`);
}
const find = (doc, predicate) => {
  let found = null;
  doc.descendants((node, pos) => {
    if (!found && predicate(node)) found = { node, pos };
    return !found;
  });
  return found;
};

test("a targeted edit changes only the edited block's line", async () => {
  const lead = await edit("example.html", (state) => {
    const p = find(
      state.doc,
      (n) => n.type.name === "paragraph" && n.attrs.lead,
    );
    return state.tr.insertText("Overall, ", p.pos + 1);
  });
  assert.equal(lead.length, 2);
  assert.match(lead[0], /^-<p class="lead"><mark/);
  assert.match(lead[1], /^\+<p class="lead">Overall, <mark/);

  const cell = await edit("example.html", (state) => {
    const td = find(
      state.doc,
      (n) => n.type.name === "table_cell" && n.textContent === "South",
    );
    return state.tr.insertText(" (new)", td.pos + 1 + td.node.content.size);
  });
  assert.deepEqual(cell, [
    '-<tr><td>South</td><td class="ta-r">1.2</td><td class="ta-r">1.4</td></tr>',
    '+<tr><td>South (new)</td><td class="ta-r">1.2</td><td class="ta-r">1.4</td></tr>',
  ]);

  const item = await edit("example.html", (state) => {
    const li = find(
      state.doc,
      (n) => n.type.name === "list_text" && n.textContent === "Spring cohort",
    );
    return state.tr.insertText("Early ", li.pos + 1);
  });
  assert.deepEqual(item, [
    "-<li>Spring cohort</li>",
    "+<li>Early Spring cohort</li>",
  ]);

  const bold = await edit("example.html", (state) => {
    const h = find(
      state.doc,
      (n) => n.type.name === "heading" && n.attrs.id === "sec-method",
    );
    return state.tr.addMark(h.pos + 1, h.pos + 7, schema.marks.strong.create());
  });
  assert.deepEqual(bold, [
    '-<h3 id="sec-method">Method</h3>',
    '+<h3 id="sec-method"><strong>Method</strong></h3>',
  ]);

  const removed = await edit("protected.html", (state) => {
    const kept = find(state.doc, (n) => n.type.name === "protected");
    return state.tr.delete(kept.pos, kept.pos + kept.node.nodeSize);
  });
  assert.deepEqual(removed, [
    "-<details><summary>Inert unknown element</summary><p>Kept as written.</p></details>",
  ]);
});

const NON_CANONICAL = [
  [
    "uppercase tags and single quotes",
    "<H1 id='sec-a'>Heading</H1>",
    '<h1 id="sec-a">Heading</h1>',
  ],
  ["unquoted attribute", "<p class=lead>Lead</p>", '<p class="lead">Lead</p>'],
  ["numeric reference", "<p>A &#38; B&#160;C</p>", "<p>A &amp; B&nbsp;C</p>"],
  ["line break in text", "<p>one\ntwo</p>", "<p>one two</p>"],
  [
    "mark order",
    "<p><em><strong>x</strong></em></p>",
    "<p><strong><em>x</em></strong></p>",
  ],
  [
    "split marks",
    "<p><strong>a</strong><strong>b</strong></p>",
    "<p><strong>ab</strong></p>",
  ],
  [
    "class order and spaces",
    '<h2 class=" ta-c  unnumbered" id="s">T</h2>',
    '<h2 class="unnumbered ta-c" id="s">T</h2>',
  ],
  [
    "attribute order",
    '<figure id="t" class="table"><table><tbody><tr><td>x</td></tr></tbody></table></figure>',
    '<figure class="table" id="t">\n<table>\n<tbody>\n<tr><td>x</td></tr>\n</tbody>\n</table>\n</figure>',
  ],
  [
    "default span",
    '<figure class="table" id="t">\n<table>\n<tbody>\n<tr><td colspan="1">x</td></tr>\n</tbody>\n</table>\n</figure>',
    '<figure class="table" id="t">\n<table>\n<tbody>\n<tr><td>x</td></tr>\n</tbody>\n</table>\n</figure>',
  ],
  [
    "implied end tags",
    "<ul><li>a<li>b</ul>",
    "<ul>\n<li>a</li>\n<li>b</li>\n</ul>",
  ],
  ["self-closing void", "<p>a<br/>b</p>", "<p>a<br>b</p>"],
];

test("non-canonical sources are reported, packed explicitly and keep their content", () => {
  for (const [label, written, canonical] of NON_CANONICAL) {
    const page = (body) =>
      envelope(
        `<article id="doc" data-format="1" lang="en">\n${body}\n</article>`,
      );
    const source = page(written);
    const expected = page(canonical);
    const warning = checkSource(source).warnings.find(
      (w) => w.code === "not-canonical",
    );
    assert.ok(warning, label);
    // The warning points at the first line that differs.
    const firstDifferent = source
      .split("\n")
      .findIndex((line, i) => line !== expected.split("\n")[i]);
    assert.equal(warning.line, firstDifferent + 1, label);
    const { canonical: packed, changes } = pack(source);
    assert.equal(packed, expected, label);
    assert.ok(changes.length > 0, label);
    assert.ok(open(source).doc.eq(open(expected).doc), label);
    assert.equal(canonicalize(packed, parseFile).difference, null, label);
  }
});

test("pack refuses an invalid file", async () => {
  assert.throws(() => pack(Buffer.from("")), /error/);
  assert.throws(() => pack(String(1)), /error/);
});

const article = (body) =>
  envelope(`<article id="doc" data-format="1" lang="en">\n${body}\n</article>`);

test("content the HTML parser repaired is refused rather than saved differently", () => {
  const source = article(
    '<h1 id="h">H</h1>\n<dt><table><b id="s"><dd>x</dd></b></table></dt>',
  );
  assert.equal(validateFile(parseFile(source)).ok, true);
  const report = checkSource(source);
  assert.deepEqual(
    report.errors.map((e) => e.code),
    ["unstable"],
  );
  assert.throws(() => pack(source), /saved faithfully/);
});

test("deleting every block leaves an empty paragraph that saves and reopens", () => {
  const source = article("<p>x</p>");
  const file = parseFile(source);
  const state = EditorState.create({ doc: openFile(file).doc });
  const tr = state.tr.delete(0, state.doc.content.size);
  const saved = saveFile(file, tr.doc);
  assert.match(saved, /<article[^>]*>\n<p><\/p>\n<\/article>/);
  assert.ok(open(saved).doc.eq(tr.doc));
});

test("a link added over footnotes and cross-references leaves them unlinked", () => {
  const source = article(
    '<h1 id="h">Heading</h1>\n<p>Before <a class="xref" href="#h">Section 1</a> and a note.<span class="footnote">Note</span> After.</p>',
  );
  const file = parseFile(source);
  const doc = openFile(file).doc;
  let state = EditorState.create({ doc, plugins: [subsetGuard()] });
  const p = doc.child(1);
  const from = doc.child(0).nodeSize + 1;
  state = state.apply(
    state.tr.addMark(
      from,
      from + p.content.size,
      schema.marks.link.create({ href: "https://example.org/" }),
    ),
  );
  assert.equal(linkConflicts(state.doc).length, 0);
  const saved = saveFile(file, state.doc);
  assert.ok(open(saved).doc.eq(state.doc));
  assert.match(
    saved,
    /<a href="https:\/\/example.org\/">Before <\/a><a class="xref"/,
  );
});

test("the line diff keeps unchanged text and stays bounded", () => {
  assert.deepEqual(
    diffLines(["a", "b"], ["x", "a", "b"]).map((e) => e.op + e.text),
    ["+x", " a", " b"],
  );
  const lines = Array.from(
    { length: 4000 },
    (_, i) => `<p class="ta-c lead">${i}</p>`,
  );
  const changed = lines.map((l) => l.replace("ta-c lead", "lead ta-c"));
  const edits = diffLines(lines, changed);
  assert.equal(edits.filter((e) => e.op === "-").length, 4000);
  assert.equal(edits.filter((e) => e.op === "+").length, 4000);
});

test("the guard repairs footnotes inserted in links, repeated IDs and short table rows", () => {
  const editor = (body) => {
    const file = parseFile(article(body));
    const state = EditorState.create({
      doc: openFile(file).doc,
      plugins: [subsetGuard()],
    });
    const reopen = (s) => {
      const saved = saveFile(file, s.doc);
      assert.ok(open(saved).doc.eq(s.doc));
      return saved;
    };
    return { state, reopen };
  };

  const linked = editor('<p><a href="https://example.org/">abc</a></p>');
  const inLink = linked.state.apply(
    linked.state.tr
      .setSelection(TextSelection.create(linked.state.doc, 2))
      .replaceSelectionWith(
        schema.nodes.footnote.create(null, schema.text("note")),
      ),
  );
  assert.deepEqual(linkConflicts(inLink.doc), []);
  assert.match(
    linked.reopen(inLink),
    /<a href="https:\/\/example.org\/">a<\/a><span class="footnote">note<\/span>/,
  );

  const headed = editor('<h1 id="sec-a">Heading</h1>');
  const split = headed.state.apply(headed.state.tr.split(4));
  assert.match(
    headed.reopen(split),
    /<h1 id="sec-a">Hea<\/h1>\n<h1 id="sec-a-2">ding<\/h1>/,
  );

  const table = editor(
    '<figure class="table" id="t">\n<table>\n<tbody>\n<tr><td>x</td><td>y</td></tr>\n<tr><td>z</td><td>w</td></tr>\n</tbody>\n</table>\n</figure>',
  );
  let cellPos = null;
  table.state.doc.descendants((n, p) => {
    if (
      cellPos === null &&
      n.type.name === "table_cell" &&
      n.textContent === "w"
    )
      cellPos = p;
  });
  const deleted = table.state.apply(
    table.state.tr.delete(cellPos, cellPos + 3),
  );
  assert.match(table.reopen(deleted), /<tr><td>z<\/td><td><\/td><\/tr>/);
});

test("a comment thread that text refers to cannot be deleted; with its anchors it can", () => {
  const source = article(
    '<p><mark class="comment" data-ref="c1">Quoted</mark> text.</p>\n<section class="comments">\n<aside class="comment-thread" id="c1" data-status="open" data-quote="Quoted">\n<p class="comment" data-author="A" data-date="2026-10-15T14:02Z">Check.</p>\n</aside>\n</section>',
  );
  const file = parseFile(source);
  const state = EditorState.create({
    doc: openFile(file).doc,
    plugins: [subsetGuard()],
  });
  const comments = state.doc.lastChild;
  const at = state.doc.content.size - comments.nodeSize;
  // Deleting the comments section alone would leave the mark without its thread.
  const alone = state.applyTransaction(
    state.tr.delete(at, state.doc.content.size),
  );
  assert.equal(alone.state.doc, state.doc);
  // Deleting the paragraph too removes the anchor: allowed, and the file reopens.
  const both = state.applyTransaction(
    state.tr
      .delete(at, state.doc.content.size)
      .replaceWith(
        0,
        state.doc.child(0).nodeSize,
        schema.nodes.paragraph.create(),
      ),
  );
  assert.notEqual(both.state.doc, state.doc);
  const saved = saveFile(file, both.state.doc);
  assert.ok(open(saved).doc.eq(both.state.doc));
});
