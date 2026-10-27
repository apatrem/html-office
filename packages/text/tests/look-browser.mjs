// T04 in real Chromium from file://: brand themes, fonts, page formats and margins, and line breaks
// that match print.   node tests/look-browser.mjs
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildEngine, buildDocument } from "../tools/build.mjs";
import { diffLines } from "../tools/pack.mjs";
import { CHARTES } from "../../shared/themes/chartes.mjs";

const out = resolve(
  new URL("../../../dist/text-test/", import.meta.url).pathname,
);
await mkdir(out, { recursive: true });
const built = await buildDocument(
  await readFile(
    new URL("../fixtures/valid/example.html", import.meta.url),
    "utf8",
  ),
  await buildEngine(),
);
const write = async (name, html) => {
  const path = join(out, name);
  await writeFile(path, html);
  return pathToFileURL(path).href;
};
const url = await write("look.html", built);
const changed = (a, b) =>
  diffLines(a.split("\n"), b.split("\n"))
    .filter((e) => e.op !== " ")
    .map((e) => e.op + e.text);
const pass = (name) => console.log(`PASS text look: ${name}`);
const rgb = (hex) =>
  `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
const MM = 96 / 25.4;

const browser = await chromium.launch();
async function open(target, disk = built) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.addInitScript((text) => {
    const disk = (globalThis.disk = { text, writes: 0 });
    globalThis.showSaveFilePicker = async () => ({
      name: "look.html",
      getFile: async () => ({ text: async () => disk.text }),
      async createWritable() {
        let next;
        return {
          write: async (value) => void (next = value),
          close: async () => void ((disk.text = next), disk.writes++),
          abort: async () => {},
        };
      },
    });
  }, disk);
  await page.goto(target);
  await page.waitForFunction(() => window.htmlText);
  return { page, errors };
}

// The character offset where each line of each text block starts.
const lineStarts = (page) =>
  page.evaluate(() => {
    const blocks = document.querySelectorAll(
      "#doc :is(p, h1, h2, h3, h4, pre, figcaption, td, th):not(.comments *)",
    );
    return [...blocks].map((el) => {
      const step = parseFloat(getComputedStyle(el).lineHeight) * 0.6;
      const range = document.createRange();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const starts = [];
      let top = null,
        i = 0;
      for (let n; (n = walker.nextNode()); )
        for (let k = 0; k < n.length; k++, i++) {
          range.setStart(n, k);
          range.setEnd(n, k + 1);
          const rect = range.getClientRects()[0];
          if (!rect || !rect.width) continue;
          if (top === null || rect.top > top + step) {
            starts.push(i);
            top = rect.top;
          }
        }
      return starts;
    });
  });
const textWidth = (page) =>
  page.evaluate(() => {
    const a = document.getElementById("doc"),
      cs = getComputedStyle(a);
    return (
      a.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    );
  });
const settings = async (page) => {
  if (!(await page.locator(".tx-drawer:not([hidden])").count()))
    await page.click(".tx-float button:has-text('Theme & page')");
};
const pick = async (page, group, name) => {
  await settings(page);
  await page.click(
    `.tx-drawer [role=radiogroup][aria-label='${group}'] [role=radio]:has-text('${name}')`,
  );
};
// The size of every page of a printed PDF, in points (/MediaBox).
const pdfSizes = async (page) => {
  const pdf = (await page.pdf({ preferCSSPageSize: true })).toString("latin1");
  const sizes = [
    ...pdf.matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g),
  ];
  return [
    ...new Set(sizes.map((m) => `${Math.round(+m[1])}x${Math.round(+m[2])}`)),
  ];
};

try {
  // ---- the printed page has the chosen size (before any media emulation: once emulated, Chromium's
  // page.pdf() adds stale pages of the previous size) ----
  const printed = await open(url);
  const sizes = [];
  for (const [format, margins] of [
    ["A4", "Theme default"],
    ["Letter", "Theme default"],
    ["Letter", "Wide"],
    ["A4", "Narrow"],
  ]) {
    await pick(printed.page, "Page format", format);
    await pick(printed.page, "Margins", margins);
    sizes.push(await pdfSizes(printed.page));
  }
  assert.deepEqual(sizes, [["595x842"], ["612x792"], ["612x792"], ["595x842"]]);
  assert.deepEqual(printed.errors, []);
  await printed.page.close();
  pass(
    "every printed page has the chosen size (A4, Letter, with margin presets)",
  );

  const { page, errors } = await open(url);

  // ---- the default brand theme is TH01 blue; a built-in charte recolours, nothing else changes ----
  const acc = () =>
    page.evaluate(
      () =>
        getComputedStyle(document.querySelector("#doc h1#sec-summary")).color,
    );
  assert.equal(await acc(), rgb(CHARTES.blue.acc));
  await pick(page, "Theme", "Red");
  assert.equal(await acc(), rgb(CHARTES.red.acc));
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "red",
  );
  let saved = await page.evaluate(() => window.htmlText.serialize());
  assert.deepEqual(changed(built, saved), [
    '-<article id="doc" data-format="1" lang="en-GB" data-heading-numbers="on">',
    '+<article id="doc" data-format="1" lang="en-GB" data-heading-numbers="on" data-theme="red">',
  ]);
  await page.keyboard.press(
    `${process.platform === "darwin" ? "Meta" : "Control"}+z`,
  );
  assert.equal(await acc(), rgb(CHARTES.blue.acc));
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    undefined,
  );
  assert.equal(await page.evaluate(() => window.htmlText.serialize()), built);
  assert.equal(
    await page.getAttribute(
      ".tx-drawer [aria-label=Theme] [aria-checked=true]",
      "data-value",
    ),
    "document",
    "the open panel follows undo",
  );
  pass(
    "a built-in charte restyles the document, changes only data-theme and undoes",
  );

  // ---- font: body only ----
  await pick(page, "Document font", "Georgia");
  const fonts = await page.evaluate(() =>
    ["#doc p.lead", "#doc h1#sec-summary"].map(
      (s) => getComputedStyle(document.querySelector(s)).fontFamily,
    ),
  );
  assert.match(fonts[0], /^Georgia/);
  assert.match(fonts[1], /^Arial/);
  await pick(page, "Document font", "Charte font");
  pass("a document font changes the body, headings keep the charte font");

  // ---- page formats and margins set the editing width ----
  const widths = {};
  for (const [page_, margins, mm] of [
    ["A4", "Theme default", 160],
    ["Letter", "Theme default", 165.9],
    ["Letter", "Narrow", 185.9],
    ["A4", "Wide", 140],
  ]) {
    await pick(page, "Page format", page_);
    await pick(page, "Margins", margins);
    widths[`${page_}/${margins}`] = await textWidth(page);
    assert.ok(
      Math.abs((await textWidth(page)) - mm * MM) < 1,
      `${page_} ${margins}`,
    );
    assert.equal(
      await page.locator(".tx-float [role=status]").textContent(),
      `Text width ${Math.round(mm)} mm`,
    );
  }
  pass("A4, Letter and the margin presets give the page's text width");

  // ---- line breaks on screen match print, for both formats ----
  const breaks = {};
  for (const format of ["A4", "Letter"]) {
    await pick(page, "Page format", format);
    await pick(page, "Margins", "Theme default");
    await page.click(".tx-drawer button[aria-label='Close Document settings']");
    const screen = await lineStarts(page);
    await page.emulateMedia({ media: "print" });
    assert.equal(
      await page.evaluate(
        () => getComputedStyle(document.querySelector(".tx-shell")).display,
      ),
      "none",
    );
    const print = await lineStarts(page);
    await page.emulateMedia({ media: "screen" });
    assert.deepEqual(screen, print, `${format}: screen and print lines`);
    assert.ok(screen.flat().length > 40);
    breaks[format] = screen;
  }
  assert.notDeepEqual(
    breaks.A4,
    breaks.Letter,
    "the formats break differently",
  );
  pass(
    "every line breaks at the same character on screen and in print (A4 and Letter)",
  );

  // ---- an explicit page start clears a wrapped image, on screen as in print: a heading that
  // starts a new page, and a page break (here before a heading that does not) ----
  const FLOAT =
    '<figure class="image" id="fig-float" data-width="40" data-wrap="left">\n<img data-asset="a1" alt="A wrapped image">\n<figcaption>A wrapped image with a caption long enough to take several lines beside the text</figcaption>\n</figure>\n';
  for (const [name, from, to, after] of [
    [
      "a heading that starts a new page",
      '<h1 class="new-page" id="sec-plan">',
      `${FLOAT}<h1 class="new-page" id="sec-plan">`,
      "#sec-plan",
    ],
    [
      "a page break",
      '<hr class="page-break">\n<h1 class="new-page" id="sec-plan">',
      `${FLOAT}<hr class="page-break">\n<h1 id="sec-plan">`,
      "#sec-plan",
    ],
  ]) {
    const floated = built.replace(from, () => to);
    assert.notEqual(floated, built);
    const float = await open(await write("look-float.html", floated), floated);
    const cleared = await float.page.evaluate((selector) => {
      const doc = document.getElementById("doc");
      const figure = document.getElementById("fig-float");
      const next = document.querySelector(selector);
      // The first line after the break starts at the text's left edge, not beside the image.
      const r = document.createRange();
      r.setStart(next.firstChild, 0);
      r.setEnd(next.firstChild, 1);
      return {
        below:
          next.getBoundingClientRect().top >=
          figure.getBoundingClientRect().bottom,
        left:
          Math.abs(
            r.getClientRects()[0].left -
              (doc.getBoundingClientRect().left +
                parseFloat(getComputedStyle(doc).paddingLeft)),
          ) < 1,
      };
    }, after);
    assert.deepEqual(cleared, { below: true, left: true }, name);
    assert.deepEqual(float.errors, []);
    await float.page.close();
  }
  pass(
    "a heading that starts a new page and a page break clear wrapped images, so the page after keeps the full width",
  );

  // ---- the saved document alone (no script) has the page width, charte and column widths ----
  const plain = await browser.newPage({
    javaScriptEnabled: false,
    viewport: { width: 1280, height: 900 },
  });
  await plain.goto(url);
  const alone = await plain.evaluate(() => {
    const a = document.getElementById("doc"),
      cs = getComputedStyle(a);
    const cols = [
      ...document.querySelectorAll("#tab-regions tr:last-child > td"),
    ].map((c) => c.getBoundingClientRect().width);
    const table = document
      .querySelector("#tab-regions table")
      .getBoundingClientRect().width;
    return {
      editing: a.isContentEditable,
      width:
        a.clientWidth -
        parseFloat(cs.paddingLeft) -
        parseFloat(cs.paddingRight),
      acc: getComputedStyle(document.getElementById("sec-summary")).color,
      cols: cols.map((w) => Math.round((w / table) * 100)),
    };
  });
  assert.equal(alone.editing, false);
  assert.ok(Math.abs(alone.width - 160 * MM) < 1);
  assert.equal(alone.acc, rgb(CHARTES.blue.acc));
  assert.deepEqual(alone.cols, [40, 30, 30]);
  await plain.close();
  pass(
    "without the editor, the saved document keeps its page width, charte and column widths",
  );

  // ---- semantic styles and alignment render; no per-selection look controls ----
  const look = await page.evaluate(() => {
    const cs = (s) => getComputedStyle(document.querySelector(s));
    return {
      justify: cs("#doc p.ta-j").textAlign,
      right: cs("#doc td.ta-r").textAlign,
      key: cs("#doc aside.callout.key").fontWeight,
      warning: cs("#doc aside.callout.warning").borderLeftColor,
      quote: cs("#doc blockquote").fontStyle,
      head: cs("#doc tr.tx-head th").color,
      total: cs("#doc tr.total td").fontWeight,
    };
  });
  assert.deepEqual(look, {
    justify: "justify",
    right: "right",
    key: "700",
    warning: rgb(CHARTES.blue.alert),
    quote: "italic",
    head: "rgb(255, 255, 255)",
    total: "700",
  });
  const controls = await page.evaluate(() =>
    [...document.querySelectorAll(".sh-root button, .sh-root [role=menuitem]")]
      .map((b) => b.getAttribute("aria-label") || b.textContent)
      .filter((l) =>
        /font size|text colou?r|highlight colou?r|font family/i.test(l),
      ),
  );
  assert.deepEqual(controls, []);
  pass(
    "semantic blocks, ta-* alignment and table roles render; no font, size or colour control",
  );

  // ---- the look is saved and reopens ----
  await pick(page, "Theme", "Green");
  await pick(page, "Document font", "Verdana");
  await page.click(".tx-shell .sh-primary");
  await page.waitForFunction(() => window.disk.writes === 1);
  saved = await page.evaluate(() => window.disk.text);
  assert.match(
    saved,
    /<article id="doc" data-format="1" lang="en-GB" data-heading-numbers="on" data-theme="green" data-font="verdana" data-page="letter">/,
  );
  assert.doesNotMatch(
    saved,
    /<html[^>]*data-theme/,
    "the root mirror is not saved",
  );
  assert.deepEqual(errors, []);
  const again = await open(await write("look-saved.html", saved), saved);
  assert.equal(
    await again.page.evaluate(
      () =>
        getComputedStyle(document.querySelector("#doc h1#sec-summary")).color,
    ),
    rgb(CHARTES.green.acc),
  );
  assert.ok(Math.abs((await textWidth(again.page)) - 165.9 * MM) < 1);
  assert.equal(
    await again.page.evaluate(() => window.htmlText.serialize()),
    saved,
  );
  assert.deepEqual(again.errors, []);
  pass("theme, font and page format are saved and reopen applied");
} finally {
  await browser.close();
}
