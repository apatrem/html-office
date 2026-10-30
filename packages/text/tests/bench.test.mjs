// T17 benchmark inputs: the 50-page document (bench/fixtures/report-50.html, about 25,000 words
// and 25 figures) is regenerated here byte for byte, valid, canonical and current, like the
// 100-page one in sections.test.mjs; the code budget's rows add up to the built file's code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { longDocument } from "../bench/long-document.mjs";
import { checkSource } from "../tools/check.mjs";
import { measure, STANDARD_CODE_CEILING } from "../tools/measure.mjs";

test("the 50-page fixture: generated deterministically, valid, canonical, current", async () => {
  const source = await readFile(
    new URL("../bench/fixtures/report-50.html", import.meta.url),
    "utf8",
  );
  const generated = longDocument({ pages: 50 });
  assert.equal(generated.html, source, "bench/long-document.mjs reproduces it");
  assert.ok(
    generated.words > 24000 && generated.words < 26000,
    `${generated.words} words`,
  );
  assert.equal(generated.figures, 25);
  const report = checkSource(source);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

test("the code budget: components add up to the built file's code, under the ceiling", async () => {
  const result = await measure();
  assert.equal(
    result.rows.reduce((sum, r) => sum + r.bytes, 0),
    result.applicationCode,
  );
  assert.ok(result.rows.every((r) => r.bytes >= 0));
  assert.ok(result.applicationCode < STANDARD_CODE_CEILING);
  for (const name of ["prosemirror-view", "prosemirror-tables", "commonmark"])
    assert.ok(result.rows.some((r) => r.component.startsWith(`${name} `)));
});
