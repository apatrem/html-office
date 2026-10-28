// T12 from file:// in Chromium, Firefox and WebKit: images display from script#assets; Insert ›
// Image… shrinks a real picked file, asks for alt text and a layout, and inserts it (wrapped
// before its anchor paragraph); the image dialog changes the layout and replaces the file; a block
// moves with its wrapped images; deleting and undoing; the saved file keeps only used assets and
// reopens with its images shown and nothing unsaved.
//   TEXT_ENGINES=chromium,firefox,webkit node tests/images-browser.mjs   (default: chromium)
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as playwright from "playwright";
import { buildEngine, buildDocument } from "../tools/build.mjs";
import { parseFile } from "../model/parse.mjs";
import { validateFile } from "../model/validate.mjs";
import { openFile, saveFile } from "../editor/schema/document.mjs";

const ENGINES = (process.env.TEXT_ENGINES || "chromium").split(",");
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
const path = join(out, "images.html");
await writeFile(path, built);
const url = pathToFileURL(path).href;

// Real picture files, as a person would pick: a 2,400 px wide PNG (shrunk to 1,600) and a JPEG.
async function pictures(browser) {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 500 },
  });
  await page.setContent(
    '<body style="margin:0;background:linear-gradient(90deg,#14517a,#c2521c)"><h1 style="font:80px sans-serif;color:#fff;margin:150px">Northwind</h1></body>',
  );
  const png = join(out, "picture.png"),
    jpeg = join(out, "picture.jpg"),
    gif = join(out, "picture.gif"),
    clear = join(out, "picture-clear.png");
  await page.setViewportSize({ width: 2400, height: 1000 });
  await page.screenshot({ path: png });
  await page.setViewportSize({ width: 800, height: 600 });
  await page.screenshot({ path: jpeg, type: "jpeg" });
  await page.setContent(
    '<body style="margin:0;background:transparent"><div style="width:200px;height:100px;border-radius:50px;background:#c2521c"></div></body>',
  );
  await page.screenshot({
    path: clear,
    omitBackground: true,
    clip: { x: 0, y: 0, width: 200, height: 100 },
  });
  await page.close();
  await writeFile(
    gif,
    Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64",
    ),
  );
  return { png, jpeg, gif, clear };
}

const assetsOf = (text) =>
  JSON.parse(
    text.match(
      /<script id="assets" type="application\/json">(.*)<\/script>/,
    )[1],
  );
function check(text) {
  const report = validateFile(parseFile(text));
  assert.deepEqual(report.errors, []);
  const file = parseFile(text);
  assert.equal(saveFile(file, openFile(file).doc), text, "canonical");
  const used = [...text.matchAll(/data-asset="([^"]+)"/g)].map((m) => m[1]);
  // Every image asset is used (fonts are kept whatever uses them).
  assert.deepEqual(
    Object.entries(assetsOf(text))
      .filter(([, a]) => a.kind !== "font")
      .map(([k]) => k)
      .sort(),
    [...new Set(used)].sort(),
    "the saved assets are exactly the used ones",
  );
  return text;
}

async function run(name) {
  const pass = (what) => console.log(`PASS text images [${name}]: ${what}`);
  const browser = await playwright[name].launch();
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  try {
    const files = await pictures(browser);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(url);
    await page.waitForFunction(() => window.htmlText);
    const saved = () => page.evaluate(() => window.htmlText.serialize());
    const loaded = (selector) =>
      page.waitForFunction((s) => {
        const img = document.querySelector(s);
        return img?.complete && img.naturalWidth > 0;
      }, selector);
    const menu = async (menuName, item) => {
      await page.click(
        `.tx-shell [role=menubar] button:text-is('${menuName}')`,
      );
      await page.click(`[role=menu] [role^=menuitem]:has-text('${item}')`);
    };
    const cursorIn = (selector) =>
      page.evaluate((s) => {
        const { view } = window.htmlText;
        const el = document.querySelector(s);
        const $pos = view.state.doc.resolve(view.posAtDOM(el, 0));
        view.dispatch(
          view.state.tr.setSelection(
            view.state.selection.constructor.near($pos),
          ),
        );
        view.focus();
      }, selector);
    const dialogClosed = () =>
      page.waitForSelector("dialog.sh-dialog", { state: "detached" });

    // ---- the example's image shows from its asset ----
    await loaded("#fig-site img");
    assert.match(
      await page.getAttribute("#fig-site img", "src"),
      /^data:image\/png;base64,/,
    );
    assert.doesNotMatch(
      (await saved()).match(/<article[\s\S]*?<\/article>/)[0],
      /src=/,
      "the source is never saved",
    );
    pass("an image shows from script#assets; its src is not saved");

    // ---- Insert › Image…: a real file, alt text required, wrapped left ----
    await cursorIn("#doc blockquote p");
    const chooser = page.waitForEvent("filechooser");
    await menu("Insert", "Image…");
    await (await chooser).setFiles(files.png);
    await page.waitForSelector("dialog.sh-dialog textarea");
    const insert = page.locator("dialog.sh-dialog button:text-is('Insert')");
    assert.equal(await insert.isDisabled(), true, "alt text is required");
    await page.fill(
      "dialog.sh-dialog textarea",
      "Gradient banner with the name",
    );
    await page.selectOption("dialog.sh-dialog select >> nth=0", "left");
    await page.selectOption("dialog.sh-dialog select >> nth=1", "25");
    await insert.click();
    await dialogClosed();
    const added = "#fig-gradient-banner-with-the-name";
    await loaded(`${added} img`);
    let text = check(await saved());
    assert.match(
      text,
      /<figure class="image" id="fig-gradient-banner-with-the-name" data-width="25" data-wrap="left">\n<img data-asset="a2" alt="Gradient banner with the name">\n<\/figure>\n<blockquote>/,
    );
    const asset = assetsOf(text).a2;
    // WebP where the browser encodes it; otherwise a PNG stays PNG (its transparency kept).
    assert.match(asset.type, /^image\/(webp|png)$/);
    const size = await page.evaluate(
      (s) => document.querySelector(s).naturalWidth,
      `${added} img`,
    );
    assert.equal(size, 1600, "shrunk to 1,600 px wide");
    pass(
      `Insert › Image… shrinks a real PNG to ${asset.type}, requires alt text and wraps it before its anchor`,
    );

    // ---- the image dialog: layout, then Replace ----
    await page.locator(`${added} img`).scrollIntoViewIfNeeded();
    await page.dblclick(`${added} img`);
    await page.waitForSelector("dialog.sh-dialog textarea");
    assert.equal(
      await page.inputValue("dialog.sh-dialog textarea"),
      "Gradient banner with the name",
    );
    await page.selectOption("dialog.sh-dialog select >> nth=0", "full");
    await page.click("dialog.sh-dialog button:text-is('Apply')");
    await dialogClosed();
    assert.match(
      await page.getAttribute(added, "class"),
      /ProseMirror-selectednode/,
      "the changed figure stays visibly selected",
    );
    // Cancel changes nothing and puts the selection back.
    await page.dblclick(`${added} img`);
    await page.click("dialog.sh-dialog button:text-is('Cancel')");
    await dialogClosed();
    assert.equal(
      await page.evaluate(
        () => window.htmlText.view.state.selection.node?.attrs.id,
      ),
      "fig-gradient-banner-with-the-name",
    );
    assert.match(
      check(await saved()),
      /id="fig-gradient-banner-with-the-name" data-width="full">\n/,
    );
    await page.dblclick(`${added} img`);
    const replace = page.waitForEvent("filechooser");
    await page.click("dialog.sh-dialog button:text('Replace image…')");
    await (await replace).setFiles(files.jpeg);
    await page.waitForFunction(
      (s) => document.querySelector(s).dataset.asset === "a3",
      `${added} img`,
    );
    await loaded(`${added} img`);
    text = check(await saved());
    assert.deepEqual(Object.keys(assetsOf(text)).sort(), ["a1", "a3"]);
    pass(
      "the image dialog changes the layout and replaces the file; the old asset is dropped",
    );

    // ---- a paragraph moves with its wrapped image ----
    await cursorIn("#fig-site + p");
    await page.keyboard.press("Alt+Shift+ArrowUp");
    text = check(await saved());
    assert.match(
      text,
      /<figure class="image" id="fig-site"[^]*?<\/figure>\n<p>The north region led growth[^\n]*\n<h2 id="sec-regions">/,
    );
    await page.keyboard.press("Alt+Shift+ArrowUp");
    assert.match(
      check(await saved()),
      /<figure class="image" id="fig-site"[^]*?<\/figure>\n<p>The north region led growth[^\n]*\n<figure class="chart" id="fig-revenue"/,
    );
    pass("Alt+Shift+↑ moves a paragraph with its wrapped image");

    // ---- delete an image, undo ----
    await page.click("#fig-site img");
    await page.keyboard.press("Backspace");
    assert.equal(await page.locator("#fig-site").count(), 0);
    text = check(await saved());
    assert.deepEqual(Object.keys(assetsOf(text)), ["a3"]);
    await page.keyboard.press(`${mod}+z`);
    await loaded("#fig-site img");
    text = check(await saved());
    assert.deepEqual(Object.keys(assetsOf(text)).sort(), ["a1", "a3"]);
    pass("deleting an image drops its asset; undo brings both back");

    // ---- the saved file reopens with its images and nothing unsaved ----
    const copy = join(out, `images-copy-${name}.html`);
    await writeFile(copy, text);
    const reopened = await context.newPage();
    await reopened.goto(pathToFileURL(copy).href);
    await reopened.waitForFunction(() => window.htmlText);
    await reopened.waitForFunction(() =>
      [...document.querySelectorAll("#doc img")].every(
        (img) => img.complete && img.naturalWidth > 0,
      ),
    );
    assert.equal(
      await reopened.getAttribute(".tx-shell [role=status]", "data-state"),
      "saved",
    );
    assert.equal(
      await reopened.evaluate(() => window.htmlText.serialize()),
      text,
    );
    await reopened.close();
    pass("the saved file reopens with its images shown and nothing unsaved");

    // ---- protected images and embedded fonts show; GIF and transparent PNG keep their kind ----
    const variant = built
      .replace(
        '<section class="comments">',
        () =>
          '<div class="kept"><img data-asset="a1" alt="Kept"></div>\n<section class="comments">',
      )
      .replace(
        /<script id="assets" type="application\/json">\{/,
        (m) =>
          `${m}"f1":{"kind":"font","family":"Brand Serif","type":"font/woff2","data":"AAAA"},`,
      );
    const variantPath = join(out, `images-variant-${name}.html`);
    await writeFile(variantPath, variant);
    const other = await context.newPage();
    other.on("pageerror", (e) => errors.push(e.message));
    await other.goto(pathToFileURL(variantPath).href);
    await other.waitForFunction(() => window.htmlText);
    await other.waitForFunction(() => {
      const img = document.querySelector("#doc .tx-protected img");
      return img?.complete && img.naturalWidth > 0;
    });
    assert.ok(
      await other.evaluate(() =>
        [...document.querySelectorAll("style")].some((s) =>
          s.textContent.includes('@font-face{font-family:"Brand Serif"'),
        ),
      ),
      "the embedded font is installed",
    );
    for (const [file, type] of [
      [files.gif, "image/gif"],
      [
        files.clear,
        name === "chromium" || name === "firefox" ? "image/webp" : "image/png",
      ],
    ]) {
      await other.evaluate(() => {
        const { view } = window.htmlText;
        view.dispatch(
          view.state.tr.setSelection(
            view.state.selection.constructor.atStart(view.state.doc),
          ),
        );
        view.focus();
      });
      const pick = other.waitForEvent("filechooser");
      await other.click(".tx-shell [role=menubar] button:text-is('Insert')");
      await other.click("[role=menu] [role^=menuitem]:has-text('Image…')");
      await (await pick).setFiles(file);
      await other.waitForSelector("dialog.sh-dialog textarea");
      await other.fill("dialog.sh-dialog textarea", `Picture ${type}`);
      await other.click("dialog.sh-dialog button:text-is('Insert')");
      await other.waitForSelector("dialog.sh-dialog", { state: "detached" });
    }
    const kinds = Object.values(
      assetsOf(check(await other.evaluate(() => window.htmlText.serialize()))),
    ).map((a) => a.kind ?? a.type);
    assert.ok(kinds.includes("image/gif"), kinds.join());
    assert.ok(kinds.includes("font"), "the font is kept");
    assert.ok(
      kinds.includes(name === "webkit" ? "image/png" : "image/webp"),
      kinds.join(),
    );
    await other.close();
    pass(
      "protected images and embedded fonts show; a GIF is kept, a transparent PNG never becomes JPEG",
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

for (const name of ENGINES) await run(name);
