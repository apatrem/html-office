// T21: the committed inputs of the acceptance workbook. They are what
// acceptance/author.mjs writes, the README states the totals the expected
// model computes, and nothing private is committed. The workbook itself is
// generated (not committed) and checked in acceptance-browser.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FILES } from "../acceptance/author.mjs";
import { expected, readRecords } from "./acceptance-expected.mjs";

const dir = fileURLToPath(new URL("../acceptance/", import.meta.url));
const records = async (name) =>
  readRecords(await readFile(join(dir, "sources", name), "utf8"));

test("the committed inputs are what author.mjs writes", async () => {
  for (const [name, make] of Object.entries(FILES))
    assert.equal(await readFile(join(dir, name), "utf8"), make(), name);
});

test("the README states the expected totals", async () => {
  const readme = await readFile(join(dir, "README.md"), "utf8"),
    eur = (x) => `€${Math.round(x).toLocaleString("en-US")}`,
    base = expected(await records("rentals-2025.csv")).summary,
    refreshed = expected(await records("rentals-2025-v2.csv")).summary,
    high = expected(await records("rentals-2025.csv"), {
      scenario: "High",
    }).summary;
  for (const value of [
    base.revenue[2],
    base.net[2],
    base.fcf[2],
    base.npv,
    refreshed.revenue[2],
    refreshed.net[2],
    refreshed.npv,
    high.revenue[2],
    high.npv,
  ])
    assert.ok(readme.includes(eur(value)), eur(value));
});

test("nothing private is committed", async () => {
  for (const name of [...Object.keys(FILES), "README.md"]) {
    const text = await readFile(join(dir, name), "utf8");
    for (const pattern of [
      /\/Users\//,
      /\/home\/[a-z]/,
      /\/private\/tmp|\/var\/folders/,
      /[A-Z]:\\\\Users/,
      /fakepath/i,
      /@[a-z0-9-]+\.[a-z]{2,}/i,
    ])
      assert.ok(!pattern.test(text), `${name}: ${pattern}`);
  }
});
