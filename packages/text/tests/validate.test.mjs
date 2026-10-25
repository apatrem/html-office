import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { parseFile } from "../model/parse.mjs";
import { validateArticle, validateFile } from "../model/validate.mjs";
import { FONTS } from "../model/format.mjs";

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
  "protected.html": { protected: 12 },
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
  assert.deepEqual(flags, [false, false, ...Array(12).fill(true), false]);
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
    if (!article) continue;
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
