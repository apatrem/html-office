import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CHARTES, contrast, charteCSS } from "../../shared/themes/chartes.mjs";
import { THEMES } from "../model/formatting.mjs";

test("built-in chartes match the document vocabulary and the Slides default", async () => {
  assert.deepEqual(Object.keys(CHARTES), THEMES);
  const keys = Object.keys(CHARTES.blue);
  for (const tokens of Object.values(CHARTES))
    assert.deepEqual(Object.keys(tokens), keys);
  const defaults = await readFile(
    new URL(
      "../../../plugin/skills/html-slides/assets/default.css",
      import.meta.url,
    ),
    "utf8",
  );
  for (const token of [
    "ink",
    "acc",
    "mid",
    "lig",
    "alert",
    "tint",
    "callout",
    "bd",
    "t2",
    "bg",
    "assumption-bg",
  ])
    assert.match(
      defaults,
      new RegExp(`--${token}:${CHARTES.blue[token]}`, "i"),
      `blue ${token} is the Slides default`,
    );
  assert.match(charteCSS(), /:root\[data-theme="black"\]\{--ink:#111111/);
});
test("built-in chartes keep text readable on the fills the grid uses", () => {
  // Blue is the existing Slides default; two of its pairs are below 4.5:1 and
  // recorded here rather than changed for every product.
  const known = { blue: ["white on mid", "alert on assumption"] };
  for (const [name, t] of Object.entries(CHARTES)) {
    const pairs = {
      "ink on bg": [t.ink, t.bg],
      "secondary on bg": [t.t2, t.bg],
      "accent on bg": [t.acc, t.bg],
      "alert on bg": [t.alert, t.bg],
      "white on ink": [t.bg, t.ink],
      "white on acc": [t.bg, t.acc],
      "white on mid": [t.bg, t.mid],
      "white on alert": [t.bg, t.alert],
      "ink on lig": [t.ink, t.lig],
      "ink on callout": [t.ink, t.callout],
      "ink on tint": [t.ink, t.tint],
      "alert on assumption": [t.alert, t["assumption-bg"]],
    };
    for (const [pair, [a, b]] of Object.entries(pairs)) {
      const ratio = contrast(a, b);
      if (known[name]?.includes(pair))
        assert.ok(ratio >= 4.2, `${name} ${pair} ${ratio.toFixed(2)}`);
      else assert.ok(ratio >= 4.5, `${name} ${pair} ${ratio.toFixed(2)}`);
    }
  }
});
