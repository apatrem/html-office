// T12b in Node: pasted images whose data is in the clipboard. data: URLs are recognised and sized
// before anything is decoded, image headers give the pixel size checked against the limits, and
// the mapping puts each image in its place among the pasted blocks as a placeholder that the
// runtime replaces with a figure on its asset. Images by URL are never kept. The browser part
// (shrinking, the alt dialog, undo, drop) is in tests/images-browser.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInert } from "../../../tests/helpers/inert-dom.mjs";
import { parseFile } from "../model/parse.mjs";
import { validateFile } from "../model/validate.mjs";
import { openFile, saveFile } from "../editor/schema/document.mjs";
import { articleHTML } from "../editor/schema/serialize.mjs";
import { schema } from "../editor/schema/schema.mjs";
import { assetStore } from "../model/assets.mjs";
import { fromHTML, describeLost } from "../editor/clipboard/html.mjs";
import {
  PASTE_IMAGES,
  dataImage,
  imageSize,
  overLimits,
  placeImages,
} from "../editor/clipboard/images.mjs";
import { figureId } from "../editor/images.mjs";

const N = schema.nodes;
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const map = (html) => fromHTML(parseInert(html), { images: true });
const bytes = (...parts) =>
  Uint8Array.from(
    parts.flatMap((p) =>
      typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p,
    ),
  );
const be32 = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

test("data: URLs of the five image types are recognised; anything else is not", () => {
  assert.deepEqual(dataImage(`data:image/png;base64,${PNG}`), {
    type: "image/png",
    base64: true,
    payload: PNG,
    bytes: 68,
  });
  assert.equal(
    dataImage(" data:IMAGE/JPEG;name=x.jpg;base64,/9j/\n4A== ").payload,
    "/9j/4A==",
  );
  const svg = dataImage(
    "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E",
  );
  assert.equal(svg.type, "image/svg+xml");
  assert.equal(svg.base64, false);
  for (const src of [
    "https://example.org/x.png",
    "http://example.org/x.png",
    "file:///Users/sam/clip_image001.png",
    "blob:https://example.org/0c1f",
    "images/x.png",
    "//example.org/x.png",
    "data:image/bmp;base64,Qk0=",
    "data:text/html;base64,PHNjcmlwdD4=",
    "data:image/png;base64,not base64!",
    "",
  ])
    assert.equal(dataImage(src), null, src);
});

test("image headers give the format and pixel size; anything else is unreadable", () => {
  const png = bytes(
    [0x89],
    "PNG\r\n\x1a\n",
    be32(13),
    "IHDR",
    be32(2400),
    be32(1000),
  );
  assert.deepEqual(imageSize(png), {
    type: "image/png",
    width: 2400,
    height: 1000,
  });
  assert.deepEqual(imageSize(Buffer.from(PNG, "base64")), {
    type: "image/png",
    width: 1,
    height: 1,
  });
  assert.deepEqual(imageSize(bytes("GIF89a", [0x40, 0x01, 0xf0, 0x00])), {
    type: "image/gif",
    width: 320,
    height: 240,
  });
  // A JPEG with an APP0 segment and a DQT before its baseline frame header.
  const jpeg = bytes(
    [0xff, 0xd8, 0xff, 0xe0, 0, 16],
    "JFIF\0",
    new Array(9).fill(0),
    [0xff, 0xdb, 0, 4, 0, 0],
    [0xff, 0xc0, 0, 17, 8, 0x02, 0x58, 0x03, 0x20, 3],
    new Array(9).fill(0),
  );
  assert.deepEqual(imageSize(jpeg), {
    type: "image/jpeg",
    width: 800,
    height: 600,
  });
  const riff = (chunk, rest) =>
    bytes("RIFF", [0, 0, 0, 0], "WEBP", chunk, [0, 0, 0, 0], rest);
  assert.deepEqual(
    imageSize(
      riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, 0x40, 0x06, 0xe8, 0x03]),
    ),
    { type: "image/webp", width: 1600, height: 1000 },
  );
  // VP8L: 14 bits of width − 1, then 14 bits of height − 1.
  const bits = 199 | (99 << 14);
  assert.deepEqual(
    imageSize(
      riff("VP8L", [
        0x2f,
        bits & 255,
        (bits >> 8) & 255,
        (bits >> 16) & 255,
        bits >>> 24,
        0,
        0,
        0,
        0,
        0,
      ]),
    ),
    { type: "image/webp", width: 200, height: 100 },
  );
  assert.deepEqual(
    imageSize(riff("VP8X", [0, 0, 0, 0, 0x7f, 0x3e, 0, 0x1f, 0x4e, 0])),
    { type: "image/webp", width: 16000, height: 20000 },
  );
  for (const junk of [
    bytes("<svg xmlns='http://www.w3.org/2000/svg'/>"),
    bytes("not an image at all"),
    bytes([0xff, 0xd8, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]),
    bytes([0x89], "PNG"),
    new Uint8Array(0),
  ])
    assert.equal(imageSize(junk), null);
});

test("the limits: 20 MB, 16,384 px a side and 50 megapixels", () => {
  assert.equal(PASTE_IMAGES.count, 20);
  assert.equal(overLimits(20 * 2 ** 20), false);
  assert.equal(overLimits(20 * 2 ** 20 + 1), true);
  assert.equal(overLimits(1000, { width: 8000, height: 6000 }), false);
  assert.equal(overLimits(1000, { width: 16385, height: 10 }), true);
  assert.equal(overLimits(1000, { width: 10000, height: 6000 }), true);
});

test("pasted HTML: each data: image takes its place among the blocks, with its alt text", () => {
  const read = map(
    '<h2>Beds</h2><p class="lead">Before <img src="data:image/png;base64,' +
      PNG +
      '" alt=" The\n new  beds "> after</p>' +
      `<table><tr><td>A</td><td>1</td></tr></table><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="">`,
  );
  assert.deepEqual(
    read.blocks.map((b) => b.type.name),
    [
      "heading",
      "paragraph",
      "image_figure",
      "paragraph",
      "table_figure",
      "image_figure",
    ],
  );
  // The text on each side of an image keeps the paragraph's own attributes.
  assert.equal(read.blocks[1].attrs.lead, true);
  assert.equal(read.blocks[3].attrs.lead, true);
  assert.equal(read.blocks[1].textContent, "Before");
  assert.deepEqual(
    read.images.map((i) => [i.node, i.type, i.alt]),
    [
      [read.blocks[2], "image/png", "The new beds"],
      [read.blocks[5], "image/gif", ""],
    ],
  );
  assert.equal(read.lost.size, 0);
});

test("images by URL, inside other blocks or over the limits are left out and reported", () => {
  const data = `data:image/png;base64,${PNG}`;
  const read = map(
    [
      "<p>Kept text</p>",
      '<img src="https://example.org/a.png" alt="a">',
      '<img src="http://example.org/b.png">',
      '<img src="file:///Users/sam/Library/clip_image001.png">',
      '<img src="blob:https://example.org/0c1f">',
      '<img src="photo.jpg">',
      `<ul><li>Item <img src="${data}" alt="in a list"></li></ul>`,
      `<h3>Title <img src="${data}" alt="in a heading"></h3>`,
      `<blockquote><p><img src="${data}" alt="in a quote"></p></blockquote>`,
      `<table><tr><td><img src="${data}" alt="in a cell"> x</td></tr></table>`,
      `<img src="data:image/png;base64,${"A".repeat(Math.ceil((PASTE_IMAGES.bytes * 4) / 3) + 8)}" alt="too large">`,
    ].join(""),
  );
  assert.equal(read.images.length, 0);
  assert.equal(read.lost.get("image"), 5);
  assert.equal(read.lost.get("image-inner"), 4);
  assert.equal(read.lost.get("image-limit"), 1);
  assert.match(
    describeLost(read.lost),
    /^Left out: 5 images, 1 image over the paste limits \(20 images, 20 MB and 50 megapixels each\), 4 images inside headings, lists, quotes or tables\./,
  );
  // At most 20 images per paste: the 21st is left out.
  const many = map(
    Array.from({ length: 21 }, (_, i) => `<img src="${data}" alt="${i}">`).join(
      "",
    ),
  );
  assert.equal(many.images.length, 20);
  assert.equal(many.lost.get("image-limit"), 1);
  // Without `images` (Insert › Markdown, T07 before T12b), every image is left out as before.
  const off = fromHTML(parseInert(`<p>x<img src="${data}" alt="a"></p>`), {});
  assert.deepEqual(off.images, []);
  assert.equal(off.lost.get("image"), 1);
});

test("placeholders become figures on one asset each; the file saves valid with exactly those assets", () => {
  const read = map(
    `<p>One</p><img src="data:image/png;base64,${PNG}" alt="Raised beds"><p>Two</p><img src="data:image/png;base64,${PNG}" alt="Left out">`,
  );
  const text = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Paste</title>\n</head>\n<body>\n<article id="doc" data-format="1" lang="en">\n<p>Start.</p>\n</article>\n</body>\n</html>\n`;
  const file = parseFile(text);
  const store = assetStore(file);
  const used = new Set(["fig-raised-beds"]);
  const [first, second] = read.images;
  const done = new Map([
    [
      first.node,
      N.image_figure.create({
        id: figureId(first.alt, used),
        width: "text",
        wrap: null,
        asset: store.add({ type: first.type, data: first.payload }),
        alt: first.alt,
      }),
    ],
    // A cancelled alt dialog: left out.
    [second.node, null],
  ]);
  const blocks = placeImages(read.blocks, done);
  const doc = N.doc.create({ lang: "en" }, blocks);
  doc.check();
  assert.equal(
    articleHTML(doc),
    '<article id="doc" data-format="1" lang="en">\n<p>One</p>\n<figure class="image" id="fig-raised-beds-2" data-width="text">\n<img data-asset="a1" alt="Raised beds">\n</figure>\n<p>Two</p>\n</article>',
  );
  const out = saveFile(store.fileFor(file, doc), doc);
  assert.deepEqual(validateFile(parseFile(out)).errors, []);
  assert.match(
    out,
    new RegExp(
      `<script id="assets" type="application/json">\\{"a1":\\{"type":"image/png","data":"${PNG.replace(/\+/g, "\\+")}"\\}\\}</script>`,
    ),
  );
  assert.ok(openFile(parseFile(out)).doc.eq(doc), "reopens");
  // Without the figure (undone), nothing of it is saved.
  const empty = N.doc.create({ lang: "en" }, [N.paragraph.create()]);
  assert.doesNotMatch(saveFile(store.fileFor(file, empty), empty), /assets/);
});
