// T15 from file:// in Chromium, Firefox and WebKit: File › Markdown view shows the projection of
// the document as it is now (an unsaved edit included), read-only; Export (in the view and in
// the File menu) downloads the same text as tools/markdown.mjs gives for the same document; and
// neither changes the document, its saved form or its state.
//   TEXT_ENGINES=chromium,firefox,webkit node tests/markdown-browser.mjs   (default: chromium)
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as playwright from "playwright";
import { buildEngine, buildDocument } from "../tools/build.mjs";
import { markdownSource } from "../tools/markdown.mjs";

const ENGINES = (process.env.TEXT_ENGINES || "chromium").split(",");
const out = resolve(
  new URL("../../../dist/text-test/", import.meta.url).pathname,
);
await mkdir(out, { recursive: true });
const example = await readFile(
  new URL("../fixtures/valid/example.html", import.meta.url),
  "utf8",
);
const built = await buildDocument(example, await buildEngine());
const path = join(out, "markdown.html");
await writeFile(path, built);
const url = pathToFileURL(path).href;

async function run(name) {
  const pass = (what) => console.log(`PASS text markdown [${name}]: ${what}`);
  const browser = await playwright[name].launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(url);
    await page.waitForFunction(() => window.htmlText);
    const saved = () => page.evaluate(() => window.htmlText.serialize());
    const state = () =>
      page.locator(".tx-shell [role=status]").getAttribute("data-state");
    const menu = async (item) => {
      await page.click(".tx-shell [role=menubar] button:text-is('File')");
      await page.click(`[role=menu] [role^=menuitem]:has-text('${item}')`);
    };

    // An unsaved edit: the view shows the document as it is now.
    await page.click("#doc p.lead", { position: { x: 2, y: 6 } });
    await page.keyboard.press("Home");
    await page.keyboard.type("Overall, ");
    const before = await saved();
    const status = await state();
    assert.equal(status, "unsaved");
    const expected = markdownSource(before).markdown;
    assert.match(expected, /^Overall, Revenue grew 18% in 2026/m);

    await menu("Markdown view");
    const area = page.locator("dialog[open] textarea.tx-md-view");
    assert.equal(await area.inputValue(), expected);
    assert.equal(await area.getAttribute("readonly"), "");
    await area.click();
    await page.keyboard.type("typed");
    await page.keyboard.press("Backspace");
    assert.equal(await area.inputValue(), expected, "read-only");
    pass("Markdown view: the projection of the edited document, read-only");

    const viewed = page.waitForEvent("download");
    await page.click("dialog[open] button:text-is('Export .md')");
    const file = await viewed;
    assert.equal(file.suggestedFilename(), "Business review and 2027 plan.md");
    assert.equal(await readFile(await file.path(), "utf8"), expected);
    await page.click("dialog[open] button:text-is('Close')");
    assert.equal(await page.locator("dialog[open]").count(), 0);

    const exported = page.waitForEvent("download");
    await menu("Export Markdown (.md)");
    assert.equal(
      await readFile(await (await exported).path(), "utf8"),
      expected,
    );
    pass("Export from the view and from File: the same text as markdown.mjs");

    assert.equal(await saved(), before, "the document is unchanged");
    assert.equal(await state(), status, "its state is unchanged");
    assert.deepEqual(errors, []);
    pass("nothing stored: the document, its saved form and state unchanged");
    await context.close();
  } finally {
    await browser.close();
  }
}

for (const name of ENGINES) await run(name);
