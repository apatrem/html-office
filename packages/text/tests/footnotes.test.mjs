// T09 footnotes: numbered in document order by the one numbering function, inserted at the
// cursor, carried with their sentence when it moves or is deleted, and listed as notes that are
// drawn, never saved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, TextSelection } from "prosemirror-state";
import { history, undo, redo } from "prosemirror-history";
import { parseFile } from "../model/parse.mjs";
import { validateFile } from "../model/validate.mjs";
import { openFile, saveFile } from "../editor/schema/document.mjs";
import { articleHTML } from "../editor/schema/serialize.mjs";
import { schema } from "../editor/schema/schema.mjs";
import { subsetGuard } from "../editor/schema/guard.mjs";
import { numbering } from "../editor/numbering.mjs";
import {
  generatedContent,
  generatedKey,
  insertFootnote,
} from "../editor/generated.mjs";
import { envelope } from "./generate.mjs";

const N = schema.nodes;
const BODY = [
  '<h1 id="h">Title<span class="footnote">In a heading.</span></h1>',
  '<p>First.<span class="footnote">One <em>italic</em>.</span> Second.<span class="footnote">Two, see <a class="xref" href="#h">Section 1</a>.</span></p>',
  "<ul>",
  '<li>Item<span class="footnote">Three.</span></li>',
  "</ul>",
  "<p>Plain paragraph.</p>",
  '<div id="kept"><span class="footnote">Protected.</span></div>',
].join("\n");

function editor(body = BODY) {
  const file = parseFile(
    envelope(
      `<article id="doc" data-format="1" lang="en" data-heading-numbers="on">\n${body}\n</article>`,
    ),
  );
  let state = EditorState.create({
    doc: openFile(file).doc,
    plugins: [history(), subsetGuard(), generatedContent()],
  });
  const dispatch = (tr) => (state = state.applyTransaction(tr).state);
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
    cursor(pos) {
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)));
    },
    notes: () => numbering(state.doc).footnotes.map((f) => f.text),
    saved() {
      const text = saveFile(file, state.doc);
      assert.deepEqual(validateFile(parseFile(text)).errors, []);
      assert.ok(openFile(parseFile(text)).doc.eq(state.doc), "reopens");
      return articleHTML(state.doc);
    },
  };
}

test("footnotes are numbered in document order, headings and lists included, protected blocks left out", () => {
  const e = editor();
  assert.deepEqual(e.notes(), [
    "In a heading.",
    "One italic.",
    "Two, see Section 1.",
    "Three.",
  ]);
  assert.deepEqual(
    numbering(e.state.doc).footnotes.map((f) => f.number),
    [1, 2, 3, 4],
  );
  // The heading's own label and contents leave its footnote out.
  assert.equal(numbering(e.state.doc).headings[0].text, "Title");
});

test("decorations number each reference and draw one notes list; nothing of it is saved", () => {
  const e = editor();
  const set = generatedKey.getState(e.state).decorations;
  const notes = set
    .find()
    .filter((d) => d.type.attrs?.["data-tx-note"])
    .map((d) => [
      d.type.attrs["data-tx-note"],
      d.type.attrs["data-tx-preview"],
    ]);
  assert.deepEqual(notes, [
    ["1", "In a heading."],
    ["2", "One italic."],
    ["3", "Two, see Section 1."],
    ["4", "Three."],
  ]);
  const widgets = set.find().filter((d) => d.spec.key?.startsWith("tx-notes"));
  assert.equal(widgets.length, 1);
  // At the end of the content (before a comments section, when there is one).
  assert.equal(widgets[0].from, e.state.doc.content.size);
  assert.doesNotMatch(e.saved(), /tx-|data-tx/);
});

test("Insert footnote puts the cursor in a new note; it renumbers the later ones; undo removes it", () => {
  const e = editor();
  e.cursor(e.find(" Second."));
  assert.ok(insertFootnote(e.state, e.dispatch));
  const $c = e.state.selection.$from;
  assert.equal($c.parent.type, N.footnote, "cursor in the note");
  e.dispatch(e.state.tr.insertText("New note"));
  assert.deepEqual(e.notes(), [
    "In a heading.",
    "One italic.",
    "New note",
    "Two, see Section 1.",
    "Three.",
  ]);
  assert.match(
    e.saved(),
    /First\.<span class="footnote">One <em>italic<\/em>\.<\/span><span class="footnote">New note<\/span> Second\./,
  );
  undo(e.state, e.dispatch);
  assert.equal(e.notes().length, 4);
  redo(e.state, e.dispatch);
  assert.equal(e.notes()[2], "New note");
});

test("no footnote inside a footnote or code; inside a link it splits the link", () => {
  const e = editor(
    '<p>A<span class="footnote">note</span></p>\n<pre><code>x</code></pre>\n<p><a href="https://a.b">link</a></p>',
  );
  e.cursor(e.find("note") + 2);
  assert.equal(insertFootnote(e.state), false);
  e.cursor(e.find("x") + 1);
  assert.equal(insertFootnote(e.state), false);
  e.cursor(e.find("link") + 2);
  assert.ok(insertFootnote(e.state, e.dispatch));
  assert.match(
    e.saved(),
    /<a href="https:\/\/a.b">li<\/a><span class="footnote"><\/span><a href="https:\/\/a.b">nk<\/a>/,
  );
});

test("moving or deleting a sentence carries its note, and the numbers follow", () => {
  const e = editor();
  // Cut "Second.<note 3>" and paste it at the start of the plain paragraph.
  const from = e.find("Second.") - 1;
  const p = e.state.doc.resolve(from).parent;
  const to = e.state.doc.resolve(from).end();
  assert.equal(p.type, N.paragraph);
  const slice = e.state.doc.slice(from, to);
  e.dispatch(e.state.tr.delete(from, to));
  const at = e.find("Plain paragraph.");
  e.dispatch(e.state.tr.replace(at, at, slice));
  assert.deepEqual(e.notes(), [
    "In a heading.",
    "One italic.",
    "Three.",
    "Two, see Section 1.",
  ]);
  assert.match(
    e.saved(),
    /<p> Second\.<span class="footnote">Two, see <a class="xref" href="#h">Section 1<\/a>\.<\/span>Plain paragraph\.<\/p>/,
  );
  // Delete the list: its note goes with it.
  let list;
  e.state.doc.forEach((node, pos) => {
    if (node.type === N.bullet_list) list = pos;
  });
  e.dispatch(e.state.tr.delete(list, list + e.state.doc.nodeAt(list).nodeSize));
  assert.deepEqual(e.notes(), [
    "In a heading.",
    "One italic.",
    "Two, see Section 1.",
  ]);
  undo(e.state, e.dispatch);
  assert.equal(e.notes().length, 4);
});

test("typing in a note updates its preview and the notes list", () => {
  const e = editor();
  e.dispatch(e.state.tr.insertText("Edited ", e.find("Three.")));
  const set = generatedKey.getState(e.state).decorations.find();
  assert.ok(
    set.some((d) => d.type.attrs?.["data-tx-preview"] === "Edited Three."),
  );
  assert.ok(
    set.some((d) => d.spec.key?.includes("Edited Three.")),
    "the list is drawn again",
  );
});

test("formatting inside a note draws the notes list again; elsewhere it only maps", () => {
  const e = editor();
  const at = e.find("Plain");
  e.dispatch(e.state.tr.addMark(at, at + 5, schema.marks.strong.create()));
  assert.equal(generatedKey.getState(e.state).result, null, "mapped only");
  const note = e.find("Three.");
  e.dispatch(e.state.tr.addMark(note, note + 5, schema.marks.strong.create()));
  const set = generatedKey.getState(e.state).decorations.find();
  assert.ok(
    set.some((d) => d.spec.key?.includes('"strong"')),
    "the list shows the bold text",
  );
});
