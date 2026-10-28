// T12 images: figures inserted with required alt text, placed by their layout, changed and
// replaced; blocks move with their anchored wrapped images; saving keeps the asset store
// consistent (no orphaned image, fonts kept, an unchanged set byte-identical).
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
import { assetStore } from "../model/assets.mjs";
import {
  insertImage,
  setImage,
  moveBlock,
  imageProblem,
  figureId,
  usedAssets,
} from "../editor/images.mjs";

const N = schema.nodes;
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const ASSETS = `{"a1":{"type":"image/png","data":"${PNG}"},"f1":{"kind":"font","family":"Brand","type":"font/woff2","data":"AAAA"},"a9":{"type":"image/png","data":"${PNG}"}}`;
const source = (body, assets = ASSETS) =>
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Images</title>\n</head>\n<body>\n<article id="doc" data-format="1" lang="en">\n${body}\n</article>\n${assets === null ? "" : `<script id="assets" type="application/json">${assets}</script>\n`}</body>\n</html>\n`;
const BODY = [
  "<p>Intro.</p>",
  '<figure class="image" id="fig-a" data-width="33" data-wrap="right">\n<img data-asset="a1" alt="First">\n</figure>',
  "<p>Beside the first image.</p>",
  "<p>Last.</p>",
].join("\n");

function editor(text = source(BODY)) {
  let file = parseFile(text);
  const store = assetStore(file);
  let state = EditorState.create({
    doc: openFile(file).doc,
    plugins: [history(), subsetGuard()],
  });
  const dispatch = (tr) => (state = state.applyTransaction(tr).state);
  return {
    store,
    get state() {
      return state;
    },
    dispatch,
    run: (command) => command(state, dispatch),
    find(t) {
      let at = null;
      state.doc.descendants((node, pos) => {
        if (at === null && node.isText && node.text.includes(t))
          at = pos + node.text.indexOf(t);
      });
      assert.notEqual(at, null, t);
      return at;
    },
    cursor(t) {
      dispatch(
        state.tr.setSelection(TextSelection.create(state.doc, this.find(t))),
      );
    },
    // The saved file: valid, reopening as the same document.
    saved() {
      const out = saveFile(store.fileFor(file, state.doc), state.doc);
      const report = validateFile(parseFile(out));
      assert.deepEqual(report.errors, [], out);
      assert.ok(openFile(parseFile(out)).doc.eq(state.doc), "reopens");
      return out;
    },
    assets(out) {
      const m = out.match(
        /<script id="assets" type="application\/json">(.*)<\/script>/,
      );
      return m ? Object.keys(JSON.parse(m[1])) : null;
    },
  };
}

test("alt text is required; wrapped images take a wrap width", () => {
  assert.match(imageProblem({ alt: " ", width: "text", wrap: null }), /alt/);
  assert.equal(imageProblem({ alt: "x", width: "full", wrap: null }), "");
  assert.match(imageProblem({ alt: "x", width: "33", wrap: null }), /width/);
  assert.equal(imageProblem({ alt: "x", width: "25", wrap: "left" }), "");
  assert.match(
    imageProblem({ alt: "x", width: "text", wrap: "left" }),
    /width/,
  );
  assert.match(
    imageProblem({ alt: "x", width: "25", wrap: "up" }),
    /left or right/,
  );
  assert.equal(
    figureId("Raised beds, north site", new Set()),
    "fig-raised-beds-north-site",
  );
  assert.equal(figureId("Été", new Set(["fig-ete"])), "fig-ete-2");
});

test("a wrapped image goes before the block it anchors to, a block image after it", () => {
  const e = editor();
  const asset = e.store.add({ type: "image/png", data: PNG });
  assert.equal(asset, "a2");
  e.cursor("Last.");
  assert.equal(e.run(insertImage({ asset, alt: "" })), false);
  assert.ok(
    e.run(insertImage({ asset, alt: " Second ", width: "25", wrap: "left" })),
  );
  assert.ok(e.state.selection instanceof NodeSelection);
  let html = articleHTML(e.state.doc);
  assert.match(
    html,
    /<figure class="image" id="fig-second" data-width="25" data-wrap="left">\n<img data-asset="a2" alt="Second">\n<\/figure>\n<p>Last\.<\/p>/,
  );
  e.cursor("Intro.");
  assert.ok(e.run(insertImage({ asset, alt: "Second", width: "full" })));
  html = articleHTML(e.state.doc);
  assert.match(
    html,
    /<p>Intro\.<\/p>\n<figure class="image" id="fig-second-2" data-width="full">/,
  );
  assert.deepEqual(e.assets(e.saved()), ["a1", "f1", "a2"]);
});

test("changing and replacing an image; invalid changes are refused", () => {
  const e = editor();
  e.dispatch(
    e.state.tr.setSelection(
      NodeSelection.create(e.state.doc, e.find("Intro.") + 7),
    ),
  );
  assert.equal(e.state.selection.node.type, N.image_figure);
  assert.equal(e.run(setImage({ alt: "" })), false);
  assert.equal(e.run(setImage({ wrap: null })), false, "33 needs a wrap");
  assert.ok(e.run(setImage({ wrap: null, width: "text", alt: "Renamed" })));
  assert.match(
    articleHTML(e.state.doc),
    /id="fig-a" data-width="text">\n<img data-asset="a1" alt="Renamed">/,
  );
  const next = e.store.add({ type: "image/png", data: PNG });
  assert.ok(e.run(setImage({ asset: next })));
  // The replaced asset is not saved any more; fonts stay; the unused a9 goes too.
  assert.deepEqual(e.assets(e.saved()), ["f1", "a2"]);
  undo(e.state, e.dispatch);
  assert.deepEqual(e.assets(e.saved()), ["a1", "f1"]);
});

test("an unchanged asset set keeps the zone byte for byte; deleting every image drops it", () => {
  const text = source(
    BODY,
    ` {"a1": {"type": "image/png", "data": "${PNG}"}} `,
  );
  const e = editor(text);
  assert.equal(e.saved(), text);
  let pos;
  e.state.doc.forEach((n, p) => {
    if (n.type === N.image_figure) pos = p;
  });
  e.dispatch(e.state.tr.delete(pos, pos + e.state.doc.nodeAt(pos).nodeSize));
  const out = e.saved();
  assert.equal(e.assets(out), null, "no assets zone left");
  // A file without assets gains the zone, after the article, when an image is inserted.
  const bare = editor(source("<p>Only text.</p>", null));
  bare.cursor("Only");
  const key = bare.store.add({ type: "image/webp", data: PNG });
  bare.run(insertImage({ asset: key, alt: "New", width: "text" }));
  assert.match(
    bare.saved(),
    /<\/article>\n<script id="assets" type="application\/json">\{"a1":/,
  );
});

test("images in protected blocks keep their assets", () => {
  const e = editor(
    source(`${BODY}\n<div class="kept"><img data-asset="a9" alt="Kept"></div>`),
  );
  assert.deepEqual([...usedAssets(e.state.doc)].sort(), ["a1", "a9"]);
  assert.deepEqual(e.assets(e.saved()), ["a1", "f1", "a9"]);
});

test("moving a block carries its wrapped images; the cover and comments stay", () => {
  const e = editor();
  e.cursor("Beside");
  assert.ok(e.run(moveBlock(-1)));
  assert.match(
    articleHTML(e.state.doc),
    /<article[^>]*>\n<figure class="image" id="fig-a"[^]*?<\/figure>\n<p>Beside the first image\.<\/p>\n<p>Intro\.<\/p>\n<p>Last\.<\/p>/,
  );
  assert.equal(
    e.state.selection.$from.parent.textContent,
    "Beside the first image.",
  );
  assert.equal(e.run(moveBlock(-1)), false, "already first");
  assert.ok(e.run(moveBlock(1)));
  assert.ok(e.run(moveBlock(1)));
  assert.match(
    articleHTML(e.state.doc),
    /<p>Intro\.<\/p>\n<p>Last\.<\/p>\n<figure class="image" id="fig-a"/,
  );
  undo(e.state, e.dispatch);
  undo(e.state, e.dispatch);
  undo(e.state, e.dispatch);
  assert.equal(articleHTML(e.state.doc), articleHTML(editor().state.doc));
  const c = editor(
    source(
      '<header class="cover">\n<h1 class="title">T</h1>\n</header>\n<p>One.</p>\n<section class="comments">\n<aside class="comment-thread" id="c1" data-status="open" data-quote="x">\n<p class="comment" data-author="A" data-date="2026-10-01T10:00Z">x</p>\n</aside>\n</section>',
    ),
  );
  c.cursor("One.");
  assert.equal(c.run(moveBlock(-1)), false);
  assert.equal(c.run(moveBlock(1)), false);
});
