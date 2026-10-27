import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { LAYOUT_CSS, CHARTE_CSS } from "../theme/index.mjs";
import { CHARTES } from "../../shared/themes/chartes.mjs";
import { PAGES, MARGINS } from "../model/format.mjs";

const example = await readFile(
  new URL("../fixtures/valid/example.html", import.meta.url),
  "utf8",
);
const zone = (id) =>
  new RegExp(`<style id="${id}">([\\s\\S]*?)</style>`).exec(example)[1];
const tokens = (css) =>
  Object.fromEntries(
    [...css.matchAll(/--([\w-]+):([^;}]+)/g)].map(([, k, v]) => [k, v.trim()]),
  );

test("the example document uses the default charte and layout theme", () => {
  assert.equal(zone("charte"), CHARTE_CSS);
  assert.equal(zone("theme"), LAYOUT_CSS);
});

test("the default charte is the TH01 blue charte (Slides default, Data roles)", () => {
  const own = tokens(CHARTE_CSS);
  for (const [token, value] of Object.entries(CHARTES.blue)) {
    const mine = own[token];
    assert.ok(mine, `--${token} is defined`);
    // Role tokens refer to colour tokens: compare them resolved.
    const resolved = mine.replace(/var\(--([\w-]+)\)/g, (_, t) => own[t]);
    assert.equal(resolved.toLowerCase(), value.toLowerCase(), `--${token}`);
  }
});

test("the layout theme sizes every page format and margin preset, on screen and in print", () => {
  assert.match(LAYOUT_CSS, /@page\{size:A4;margin:25mm\}/);
  const size = { a4: "A4", letter: "letter" };
  const margin = { narrow: "15mm", normal: "25mm", wide: "35mm" };
  for (const page of PAGES)
    for (const m of MARGINS) {
      const name = m === "normal" ? page : `${page}-${m}`;
      assert.ok(
        LAYOUT_CSS.includes(
          `@page ${name}{size:${size[page]};margin:${margin[m]}}`,
        ),
        name,
      );
      // The selector giving that page name: the theme's default (A4, normal) needs no attribute.
      const selector =
        "#doc" +
        (page === "a4" ? "" : `[data-page=${page}]`) +
        (m === "normal" ? "" : `[data-margins=${m}]`);
      assert.match(
        LAYOUT_CSS,
        new RegExp(
          `${selector.replace(/[[\]]/g, "\\$&")}\\{[^}]*page:${name}[;}]`,
        ),
        selector,
      );
    }
  assert.match(
    LAYOUT_CSS,
    /width:calc\(var\(--page-w\) - 2\*var\(--margin\)\)/,
  );
  assert.doesNotMatch(LAYOUT_CSS, /@import|url\(/);
});
