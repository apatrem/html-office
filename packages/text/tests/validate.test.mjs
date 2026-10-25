import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { parseFile } from "../model/parse.mjs";
import { validateArticle, validateFile } from "../model/validate.mjs";
import { FONTS } from "../model/format.mjs";
import { element, text, serialize } from "../model/html.mjs";

const fixtures = new URL("../fixtures/", import.meta.url);
const list = async (dir) =>
  (await readdir(new URL(dir, fixtures)))
    .filter((f) => f.endsWith(".html"))
    .sort();
const open = async (path) =>
  parseFile(await readFile(new URL(path, fixtures), "utf8"));
const codes = (findings) => findings.map((f) => f.code);

// Warnings and protected blocks each valid fixture is expected to produce.
const VALID = {
  "comments.html": { warnings: ["orphaned-thread"] },
  "figures.html": { warnings: ["preview-id", "preview-id"] },
  "protected.html": { protected: 14 },
};

test("every valid fixture passes with only its expected findings", async () => {
  for (const name of await list("valid/")) {
    const report = validateFile(await open(`valid/${name}`));
    const expected = VALID[name] ?? {};
    assert.deepEqual(report.errors, [], name);
    assert.deepEqual(codes(report.warnings), expected.warnings ?? [], name);
    assert.equal(report.protected.length, expected.protected ?? 0, name);
    assert.ok(report.blocks.length > 0, name);
  }
});

test("every invalid fixture is rejected at the expected locations", async () => {
  const expected = JSON.parse(
    await readFile(new URL("invalid/expected.json", fixtures), "utf8"),
  );
  const names = await list("invalid/");
  assert.deepEqual(Object.keys(expected).sort(), names);
  for (const name of names) {
    const report = validateFile(await open(`invalid/${name}`));
    assert.equal(report.ok, false, name);
    assert.deepEqual(
      report.errors.map((e) => `${e.code} ${e.line}:${e.col}`),
      expected[name],
      name,
    );
  }
});

test("protected blocks are listed in order with their reasons", async () => {
  const report = validateFile(await open("valid/protected.html"));
  const flags = report.blocks.map((b) => b.protected);
  assert.deepEqual(flags, [false, false, ...Array(14).fill(true), false]);
  assert.match(report.protected[0].reasons[0], /details/);
  assert.equal(report.protected[0].line, 11);
});

const strip = (node) => {
  const { loc, ...rest } = node;
  return rest.children ? { ...rest, children: rest.children.map(strip) } : rest;
};

test("validation without locations (the browser) finds the same problems", async () => {
  for (const name of [...(await list("invalid/")), "../valid/protected.html"]) {
    const file = await open(`invalid/${name}`);
    const article = file.html.children
      .find((n) => n.name === "body")
      .children.find((n) => n.name === "article");
    // envelope-id repeats an ID of <head>, which the article alone cannot know.
    if (!article || name === "envelope-id.html") continue;
    const located = validateFile(file);
    const plain = validateArticle(strip(article), {
      assets: name.startsWith("image-") ? new Set(["a1"]) : null,
    });
    const article_ = (f) => f.filter((e) => e.path.startsWith("article#doc"));
    assert.deepEqual(
      codes(plain.errors),
      codes(article_(located.errors)),
      name,
    );
    assert.deepEqual(
      plain.protected.map((p) => p.path),
      located.protected.map((p) => p.path),
      name,
    );
    assert.ok(plain.errors.every((e) => e.line === undefined && e.path));
  }
});

test("errors carry a path to the element", async () => {
  const report = validateFile(await open("invalid/table-rowspan.html"));
  assert.equal(
    report.errors[0].path,
    "article#doc > figure#tab-a > table[1] > tbody[1] > tr[1] > td[1]",
  );
});

test("the font list matches the shared document settings", async () => {
  const source = await readFile(
    new URL("../../shared/shell/panels.mjs", import.meta.url),
    "utf8",
  );
  const block = source.slice(source.indexOf("export const FONTS"));
  const ids = [
    ...block.slice(0, block.indexOf("];")).matchAll(/\["([a-z]+)"/g),
  ].map((m) => m[1]);
  assert.deepEqual(FONTS, ids);
});

const page = (body) =>
  parseFile(
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>T</title>\n</head>\n<body>\n<article id="doc" data-format="1" lang="en">\n<h1 id="sec-a">H</h1>\n${body}\n</article>\n</body>\n</html>\n`,
  );

test("unusual structures are protected instead of crashing", () => {
  for (const body of [
    "<svg><g><template></template></g></svg>",
    '<header class="cover"><h1 class="title">Title</h1>loose text</header>',
    '<header class="cover"><h1 class="title">Title</h1><!-- note --></header>',
    "<p><strong></strong></p>",
  ]) {
    const report = validateFile(page(body));
    assert.equal(report.protected.length, 1, body);
  }
});

test("chart JSON that would end its script element is rejected", () => {
  const json = JSON.stringify({
    title: "</script><script>alert(1)</script>",
    unit: "u",
    categories: ["a"],
    series: [{ name: "s", values: [1] }],
  });
  const chart = element(
    "figure",
    [
      ["class", "chart"],
      ["id", "fig-a"],
      ["data-type", "column"],
      ["data-width", "text"],
    ],
    [element("script", [["type", "application/json"]], [text(json)])],
  );
  const article = element(
    "article",
    [
      ["id", "doc"],
      ["data-format", "1"],
      ["lang", "en"],
    ],
    [chart],
  );
  assert.deepEqual(codes(validateArticle(article).errors), ["chart-data"]);
  assert.throws(() => serialize(article), /holds only text/);
});

test("data attributes are text, never URLs", () => {
  const report = validateFile(
    page(
      '<p><mark class="comment" data-ref="c1">x</mark></p>\n<section class="comments">\n<aside class="comment-thread" id="c1" data-status="open" data-quote="javascript:alert(1)">\n<p class="comment" data-author="A" data-date="2026-10-15T14:02:59Z">c</p>\n</aside>\n</section>',
    ),
  );
  assert.deepEqual(report.errors, []);
});

test("findings inside nested marks carry the full path", () => {
  const report = validateFile(
    page(
      '<p><strong><mark class="comment" data-ref="nope">x</mark></strong></p>',
    ),
  );
  assert.equal(
    report.errors[0].path,
    "article#doc > p[2] > strong[1] > mark.comment[1]",
  );
});

test("re-verification cases: titles, deep guides, dates, the doc ID and text attributes", () => {
  const codesOf = (source) => codes(validateFile(parseFile(source)).errors);
  const base = (body, head = "") =>
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n${head}<title>T</title>\n</head>\n<body>\n<article id="doc" data-format="1" lang="en">\n${body}\n</article>\n</body>\n</html>\n`;
  assert.deepEqual(codesOf(base('<h2 class="title">H</h2>')), ["missing-id"]);
  assert.deepEqual(
    codesOf(
      base('<header class="cover">\n<h1 class="title">T</h1>\n</header>'),
    ),
    [],
  );
  const deep = "<div>".repeat(300) + "x" + "</div>".repeat(300);
  assert.deepEqual(
    codesOf(
      base("<p>x</p>", `<template id="html-text-guide">${deep}</template>\n`),
    ),
    ["too-deep"],
  );
  assert.deepEqual(
    codesOf(base("<p>x</p>").replace("<title>", '<title id="doc">')),
    ["duplicate-id"],
  );
  assert.deepEqual(
    codesOf(base('<p>x <abbr title="javascript:alert(1)">y</abbr></p>')),
    [],
  );
  const thread = (date) =>
    `<p><mark class="comment" data-ref="c1">x</mark></p>\n<section class="comments">\n<aside class="comment-thread" id="c1" data-status="open" data-quote="q">\n<p class="comment" data-author="A" data-date="${date}">c</p>\n</aside>\n</section>`;
  assert.deepEqual(codesOf(base(thread("0099-01-01T00:00Z"))), []);
  assert.deepEqual(codesOf(base(thread("2027-02-29T00:00Z"))), [
    "malformed-thread",
  ]);
});

test("a chart's JSON script holds text only, and a style end tag in it is harmless", () => {
  const data = (children) =>
    element(
      "article",
      [
        ["id", "doc"],
        ["data-format", "1"],
        ["lang", "en"],
      ],
      [
        element(
          "figure",
          [
            ["class", "chart"],
            ["id", "f"],
            ["data-type", "column"],
            ["data-width", "text"],
          ],
          [element("script", [["type", "application/json"]], children)],
        ),
      ],
    );
  const json = (title) =>
    text(
      JSON.stringify({
        title,
        unit: "u",
        categories: ["a"],
        series: [{ name: "s", values: [1] }],
      }),
    );
  const hidden = data([
    json("t"),
    { type: "comment", value: "--></script><script>alert(1)</script>" },
  ]);
  assert.deepEqual(codes(validateArticle(hidden).errors), ["chart-data"]);
  assert.throws(() => serialize(hidden), /holds only text/);
  const style = data([json("</style>")]);
  assert.deepEqual(validateArticle(style).errors, []);
  assert.match(serialize(style), /<\/style>/);
});
