// T19 acceptance report: the committed inputs (packages/text/acceptance/) are consistent. The
// payload map validates; every figure placed in a section is planned in the outline, and every
// planned section and figure is written in exactly one section file; each image has its source
// and licence; the brand charte sets every core token; the companion deck shares the chart data.
// tests/acceptance-browser.mjs generates the report and checks the outputs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { readPayloads } from "../tools/convert.mjs";
import { charteTokens, CHARTE_TOKENS } from "../../shared/charts/css-theme.mjs";

const dir = new URL("../acceptance/", import.meta.url);
const read = (path) => readFile(new URL(path, dir), "utf8");
const ids = (markdown, re) => [...markdown.matchAll(re)].map((m) => m[1]);
const HEADINGS = /^#{1,4} .*\{#([A-Za-z][\w-]*)/gm,
  FIGURES = /^\[\[block: \w+ \| intent: "[^"]*" \| id: ([\w-]+)\]\]$/gm;

test("the outline plans every section and figure the sections write", async () => {
  const outline = await read("outline.md");
  const files = (await readdir(new URL("sections/", dir)))
    .filter((n) => n.endsWith(".md"))
    .sort();
  const sections = await Promise.all(files.map((f) => read(`sections/${f}`)));
  const written = sections.join("\n");
  assert.deepEqual(
    ids(written, HEADINGS),
    ids(outline, HEADINGS),
    "headings, in order",
  );
  assert.deepEqual(
    ids(written, FIGURES).sort(),
    ids(outline, FIGURES).sort(),
    "figures",
  );
  // Each section file starts with one top-level heading of the outline.
  for (const s of sections) assert.match(s, /^# .*\{#[A-Za-z][\w-]*[^}]*\}\n/);
  const payloads = readPayloads(await read("payloads.json"));
  assert.deepEqual([...payloads.keys()].sort(), ids(outline, FIGURES).sort());
  const kinds = [...payloads.values()].map((p) => p.kind);
  assert.equal(kinds.filter((k) => k === "chart").length, 2);
  assert.equal(kinds.filter((k) => k === "table").length, 3);
  assert.ok(kinds.filter((k) => k === "image").length >= 2);
  // About 15–20 printed pages of text: 4,500 to 6,500 words.
  const words = written
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  assert.ok(words > 4500 && words < 6500, `${words} words`);
});

test("images are original, with their source and licence", async () => {
  const sources = await read("images/SOURCES.md");
  const images = (await readdir(new URL("images/", dir))).filter((n) =>
    n.endsWith(".svg"),
  );
  assert.ok(images.length >= 3);
  for (const name of images) {
    assert.match(
      sources,
      new RegExp(`\\| \`${name}\` \\|[^\\n]*\\| CC0 1\\.0`),
      name,
    );
    const svg = await read(`images/${name}`);
    assert.doesNotMatch(
      svg,
      /<script|<image|href=|url\(/i,
      `${name}: nothing executable or loaded`,
    );
  }
  const payloads = JSON.parse(await read("payloads.json"));
  for (const p of Object.values(payloads))
    if (p.kind === "image")
      assert.ok(images.includes(p.file.replace("images/", "")), p.file);
});

test("the brand charte is complete and the deck shows the report's data", async () => {
  const tokens = charteTokens(await read("brand.css"));
  for (const name of CHARTE_TOKENS) assert.ok(tokens[name], `--${name}`);
  const deck = await read("deck-content.html");
  const payloads = JSON.parse(await read("payloads.json"));
  for (const id of ["fig-revenue", "fig-bridge"]) {
    const { title, items, series } = payloads[id].data;
    assert.ok(deck.includes(JSON.stringify(title)), id);
    assert.ok(
      deck.includes(
        JSON.stringify(items ?? series).replace(/\.0(?=[,\]])/g, ""),
      ),
      `${id} data`,
    );
  }
});
