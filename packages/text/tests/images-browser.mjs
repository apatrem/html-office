// T12 from file:// in Chromium, Firefox and WebKit: images display from script#assets; Insert ›
// Image… shrinks a real picked file, asks for alt text and a layout, and inserts it (wrapped
// before its anchor paragraph); the image dialog changes the layout and replaces the file; a block
// moves with its wrapped images; deleting and undoing; the saved file keeps only used assets and
// reopens with its images shown and nothing unsaved.
// T12b: image files and data: images pasted and dropped through dispatched events go the same
// way (shrunk, described, one undo step, only used assets saved); images by URL, over the limits
// or unreadable are left out and reported; nothing is requested while pasting.
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
const PASTE_BYTES = 20 * 2 ** 20;
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

// Real picture files, as a person would pick, encoded by the browser's own canvas in every
// engine: a 2,400 px wide PNG (shrunk to 1,600), a JPEG, a PNG with a transparent background, and
// a GIF.
async function pictures(browser) {
  const page = await browser.newPage();
  const encoded = await page.evaluate(() => {
    const draw = (width, height, type, clear) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!clear) {
        const g = ctx.createLinearGradient(0, 0, width, 0);
        g.addColorStop(0, "#14517a");
        g.addColorStop(1, "#c2521c");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = "#fff";
        ctx.font = `${height / 5}px sans-serif`;
        ctx.fillText("Northwind", width / 10, height / 2);
      } else {
        ctx.fillStyle = "#c2521c";
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, height / 2, 0, 2 * Math.PI);
        ctx.fill();
      }
      return canvas.toDataURL(type, 0.9).split(",")[1];
    };
    return {
      png: draw(2400, 1000, "image/png"),
      jpeg: draw(800, 600, "image/jpeg"),
      clear: draw(200, 100, "image/png", true),
    };
  });
  await page.close();
  const files = {
    png: join(out, "picture.png"),
    jpeg: join(out, "picture.jpg"),
    gif: join(out, "picture.gif"),
    clear: join(out, "picture-clear.png"),
  };
  for (const kind of ["png", "jpeg", "clear"])
    await writeFile(files[kind], Buffer.from(encoded[kind], "base64"));
  await writeFile(
    files.gif,
    Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64",
    ),
  );
  return files;
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
    await pasting(browser, name, files, pass);
  } finally {
    await browser.close();
  }
}

// ---- T12b: pasted and dropped images ----
async function pasting(browser, name, files, pass) {
  // A fresh context: no draft of the pages above.
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("request", (r) => {
    // The page itself is the only file: request; pictures show from data: URLs.
    if (r.url() !== url && !r.url().startsWith("data:")) requests.push(r.url());
  });
  await page.goto(url);
  await page.waitForFunction(() => window.htmlText);
  const saved = () => page.evaluate(() => window.htmlText.serialize());
  const status = () =>
    page.evaluate(
      () => document.querySelector(".tx-shell [role=status]").textContent,
    );
  const settled = () => page.evaluate(() => window.htmlText.pasted());
  const undo = () => page.evaluate(() => window.htmlText.commands.run("undo"));
  const article = (text) => text.match(/<article[\s\S]*?<\/article>/)[0];
  const dialog = "dialog.sh-dialog";
  // Puts the caret at the end of the textblock holding `text`.
  const caret = (text) =>
    page.evaluate((text) => {
      const { view, TextSelection } = window.htmlText;
      let at = null;
      view.state.doc.descendants((node, pos) => {
        if (at === null && node.isTextblock && node.textContent.includes(text))
          at = pos + node.nodeSize - 1;
      });
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, at)),
      );
      view.focus();
    }, text);
  const base64 = async (path) => (await readFile(path)).toString("base64");
  const picture = {
    png: await base64(files.png),
    jpeg: await base64(files.jpeg),
    gif: await base64(files.gif),
  };
  // A paste (or a drop on the textblock holding `on`) carrying files ({name, type, data}) and
  // clipboard types, as a browser builds it from the system clipboard or a dragged file.
  const send = (event, { files = [], types = {}, on = null }) =>
    page.evaluate(
      ([event, files, types, on]) => {
        const data = new DataTransfer();
        for (const f of files)
          data.items.add(
            new File(
              [Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))],
              f.name,
              { type: f.type },
            ),
          );
        for (const [type, value] of Object.entries(types))
          data.setData(type, value);
        const { view } = window.htmlText;
        if (event === "paste") {
          const e = new ClipboardEvent("paste", {
            clipboardData: data,
            bubbles: true,
            cancelable: true,
          });
          if (e.clipboardData !== data)
            Object.defineProperty(e, "clipboardData", { value: data });
          view.dom.dispatchEvent(e);
          return;
        }
        const target = [...view.dom.querySelectorAll("p")].find((p) =>
          p.textContent.includes(on),
        );
        const box = target.getBoundingClientRect();
        const e = new DragEvent("drop", {
          clientX: box.left + 4,
          clientY: box.top + box.height / 2,
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
        });
        if (e.dataTransfer !== data)
          Object.defineProperty(e, "dataTransfer", { value: data });
        target.dispatchEvent(e);
      },
      [event, files, types, on],
    );
  // Fills the open image dialog and waits for that dialog to close (a waiting paste may open
  // the next one at once).
  const describe = async (alt) => {
    const open = await page.waitForSelector(`${dialog} textarea`);
    assert.match(
      await page.getAttribute(`${dialog} img.tx-image-preview`, "src"),
      /^data:image\/(webp|png|jpeg|gif|svg\+xml);base64,/,
      "the dialog shows the picture",
    );
    await page.fill(`${dialog} textarea`, alt);
    await page.click(`${dialog} button:text-is('Insert')`);
    await page.waitForFunction((el) => !el.isConnected, open);
  };
  const loaded = (selector) =>
    page.waitForFunction((s) => {
      const img = document.querySelector(s);
      return img?.complete && img.naturalWidth > 0;
    }, selector);
  const shrunk = name === "webkit" ? "image/png" : "image/webp";
  const start = await saved();

  // ---- a screenshot: a PNG file, described in the dialog, after the caret's paragraph ----
  await caret("The north region led growth");
  await send("paste", {
    files: [{ name: "Screenshot.png", type: "image/png", data: picture.png }],
  });
  await describe("Screenshot of the plan");
  await settled();
  await loaded("#fig-screenshot-of-the-plan img");
  let text = check(await saved());
  assert.match(
    article(text),
    /the west region stayed flat\.<\/p>\n<figure class="image" id="fig-screenshot-of-the-plan" data-width="text">\n<img data-asset="a2" alt="Screenshot of the plan">\n<\/figure>\n<figure class="table" id="tab-regions">/,
  );
  assert.equal(assetsOf(text).a2.type, shrunk);
  assert.equal(
    await page.evaluate(
      () =>
        document.querySelector("#fig-screenshot-of-the-plan img").naturalWidth,
    ),
    1600,
    "shrunk to 1,600 px wide",
  );
  assert.equal(
    await page.evaluate(
      () => window.htmlText.view.state.selection.node?.attrs.id,
    ),
    "fig-screenshot-of-the-plan",
  );
  await undo();
  assert.equal(check(await saved()), start, "one undo; its asset is not saved");
  pass(
    `a pasted screenshot is shrunk to ${shrunk}, described in the dialog and inserted after the caret's paragraph; one undo removes it`,
  );

  // ---- HTML with data: images among text and a table: alt kept, order kept, one undo ----
  const svg =
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#14517a"/><image href="https://example.org/tracker.png"/></svg>',
    );
  await caret("Grow where the soil is already rich");
  await send("paste", {
    types: {
      "text/html":
        "<p>From Word</p>" +
        `<p><img src="data:image/jpeg;base64,${picture.jpeg}" alt="Raised beds"></p>` +
        "<table><tr><td>Bed</td><td>Area</td></tr><tr><td>North</td><td>12</td></tr></table>" +
        `<p>Logo <img src="${svg}" alt="Logo"> last</p>`,
      "text/plain": "From Word",
    },
  });
  await settled();
  await loaded("#fig-raised-beds img");
  await loaded("#fig-logo img");
  text = check(await saved());
  const [, beds, logo] =
    article(text).match(
      /<p>Grow where the soil is already rich\.From Word<\/p>\n<\/blockquote>\n<figure class="image" id="fig-raised-beds" data-width="text">\n<img data-asset="(a\d+)" alt="Raised beds">\n<\/figure>\n<figure class="table" id="tab-1">[^]*?<\/figure>\n<p>Logo<\/p>\n<figure class="image" id="fig-logo" data-width="text">\n<img data-asset="(a\d+)" alt="Logo">\n<\/figure>\n<p>last<\/p>/,
    ) ?? [];
  assert.ok(beds && logo, "order: text, picture, table, text, logo, text");
  assert.equal(
    assetsOf(text)[beds].type,
    name === "webkit" ? "image/jpeg" : shrunk,
  );
  // SVG is kept as it is; shown only through img, it loads nothing it names.
  assert.equal(assetsOf(text)[logo].type, "image/svg+xml");
  assert.equal(await page.locator(dialog).count(), 0, "no dialog: alt kept");
  const withImages = text;
  await undo();
  assert.equal(check(await saved()), start, "one undo for the whole paste");
  pass(
    "data: images in pasted HTML keep their alt text and their place among text and a table; SVG kept; one undo",
  );

  // ---- no alt text: the dialog asks; Cancel leaves the image out ----
  await caret("Grow where the soil is already rich");
  await send("paste", {
    types: {
      "text/html": `<img src="data:image/gif;base64,${picture.gif}" alt="">`,
    },
  });
  await page.waitForSelector(`${dialog} textarea`);
  await page.click(`${dialog} button:text-is('Cancel')`);
  await settled();
  assert.equal(await saved(), start);
  assert.match(
    await status(),
    /Nothing to paste\. Left out: 1 image without alt text\./,
  );
  pass("an image without alt text opens the dialog; Cancel leaves it out");

  // ---- a picture copied from a web page: its HTML only links it, the file is the picture ----
  await caret("Grow where the soil is already rich");
  await send("paste", {
    files: [{ name: "image.png", type: "image/png", data: picture.png }],
    types: {
      "text/html":
        '<meta charset="utf-8"><img src="https://example.org/beds.png" alt="Raised beds">',
    },
  });
  await describe("Beds from the web");
  await settled();
  text = check(await saved());
  assert.match(
    article(text),
    /<\/blockquote>\n<figure class="image" id="fig-beds-from-the-web" data-width="text">/,
  );
  await undo();
  assert.equal(await saved(), start);
  assert.deepEqual(requests, [], "the linked copy was not fetched");
  pass(
    "a picture copied from a web page is pasted from the file, not its link",
  );

  // ---- images by URL are never fetched; over the limits or unreadable, left out ----
  const huge = Buffer.concat([
    Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"),
    Buffer.from([0, 0, 0x4e, 0x20, 0, 0, 0x4e, 0x20, 8, 6, 0, 0, 0]),
  ]).toString("base64");
  await caret("Grow where the soil is already rich");
  await send("paste", {
    types: {
      "text/html":
        "<p>Linked</p>" +
        '<img src="https://example.org/a.png" alt="a"><img src="http://example.org/b.png" alt="b">' +
        '<img src="file:///Users/sam/Library/clip_image001.png" alt="c"><img src="blob:https://example.org/0c1f" alt="d">' +
        '<img src="beds.jpg" alt="e"><img srcset="https://example.org/f.png 2x" alt="f">' +
        `<img src="data:image/png;base64,${huge}" alt="20,000 px">` +
        `<img src="data:image/png;base64,${Buffer.from("not a picture").toString("base64")}" alt="broken">`,
    },
  });
  await settled();
  text = check(await saved());
  assert.match(article(text), /rich\.Linked<\/p>/);
  assert.doesNotMatch(
    article(text),
    /<figure class="image" id="fig-(a|b|c|d|e|f|20|broken)/,
  );
  assert.match(
    await status(),
    /^Pasted\. Left out: 6 images, 1 image over the paste limits \(20 images, 20 MB and 50 megapixels each\), 1 image that could not be read\./,
  );
  await undo();
  // A file whose header is over the limits is never decoded; a file of another kind is left out.
  await send("paste", {
    files: [
      { name: "huge.png", type: "image/png", data: huge },
      { name: "notes.pdf", type: "application/pdf", data: "JVBERg==" },
    ],
  });
  await settled();
  assert.equal(await saved(), start);
  assert.match(
    await status(),
    /Nothing to paste\. Left out: 1 image over the paste limits [^)]*\), 1 file that is not a PNG, JPEG, GIF, WebP or SVG image\./,
  );
  // At most 20 images per paste.
  await caret("Grow where the soil is already rich");
  await send("paste", {
    types: {
      "text/html": Array.from(
        { length: 21 },
        (_, i) =>
          `<img src="data:image/gif;base64,${picture.gif}" alt="Dot ${i + 1}">`,
      ).join(""),
    },
  });
  await settled();
  text = check(await saved());
  assert.equal(
    (article(text).match(/<figure class="image" id="fig-dot-/g) ?? []).length,
    20,
  );
  assert.doesNotMatch(article(text), /fig-dot-21/);
  assert.match(await status(), /Left out: 1 image over the paste limits/);
  await undo();
  assert.equal(await saved(), start);
  assert.deepEqual(requests, [], "nothing was requested");
  pass(
    "images by URL are left out unfetched; over the limits (size, pixels, count) or unreadable, left out and reported",
  );

  // ---- where only text goes: images alone go after the table, among text they are left out ----
  await page.evaluate(() => {
    const { view, TextSelection } = window.htmlText;
    const cell = [...view.dom.querySelectorAll("td")].find(
      (td) => td.textContent === "North",
    );
    const pos = view.posAtDOM(cell, 0);
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)),
    );
    view.focus();
  });
  await send("paste", {
    types: {
      "text/html": `<p>Note</p><img src="data:image/gif;base64,${picture.gif}" alt="Dot">`,
    },
  });
  await settled();
  text = check(await saved());
  assert.match(article(text), /<td>NoteNorth<\/td>|<td>NorthNote<\/td>/);
  assert.doesNotMatch(article(text), /fig-dot/);
  assert.match(await status(), /Left out: 1 image where only text goes\./);
  await undo();
  await send("paste", {
    files: [{ name: "dot.gif", type: "image/gif", data: picture.gif }],
  });
  await describe("Dot in a table");
  await settled();
  text = check(await saved());
  assert.match(
    article(text),
    /<\/table>\n<\/figure>\n<figure class="image" id="fig-dot-in-a-table" data-width="text">/,
  );
  assert.equal(
    assetsOf(text)[
      article(text).match(/data-asset="(a\d+)" alt="Dot in a table"/)[1]
    ].type,
    "image/gif",
    "a GIF is kept",
  );
  await undo();
  assert.equal(await saved(), start);
  pass(
    "pasted in a table cell: an image alone goes after the table, an image among text is left out",
  );

  // ---- a dropped file lands after the paragraph it is dropped on ----
  await send("drop", {
    files: [{ name: "beds.jpg", type: "image/jpeg", data: picture.jpeg }],
    on: "Each forecast applies",
  });
  await describe("Dropped beds");
  await settled();
  text = check(await saved());
  assert.match(
    article(text),
    /<p>Each forecast applies <code>growth<\/code> to the 2026 base:<\/p>\n<figure class="image" id="fig-dropped-beds" data-width="text">/,
  );
  await undo();
  assert.equal(await saved(), start);
  pass(
    "a dropped image file is described and lands after the paragraph it is dropped on",
  );

  // ---- copied inside the document, an image keeps its asset ----
  const copy = await page.evaluate(() => {
    const { view, NodeSelection } = window.htmlText;
    let at = null;
    view.state.doc.forEach((node, pos) => {
      if (node.attrs.id === "fig-site") at = pos;
    });
    view.dispatch(
      view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)),
    );
    const data = new DataTransfer();
    const e = new ClipboardEvent("copy", {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    });
    if (e.clipboardData !== data)
      Object.defineProperty(e, "clipboardData", { value: data });
    view.dom.dispatchEvent(e);
    return Object.fromEntries(data.types.map((t) => [t, data.getData(t)]));
  });
  assert.doesNotMatch(
    copy["text/html"],
    /<img|data:/,
    "copies leave images out",
  );
  await caret("Each forecast applies");
  await send("paste", { types: copy });
  await settled();
  text = check(await saved());
  assert.match(
    article(text),
    /to the 2026 base:<\/p>\n<figure class="image" id="fig-site-2" data-width="33" data-wrap="right">\n<img data-asset="a1" /,
  );
  assert.deepEqual(
    Object.keys(assetsOf(text)).filter((k) => !assetsOf(text)[k].kind),
    ["a1"],
    "no second copy in script#assets",
  );
  await undo();
  assert.equal(await saved(), start);
  pass("an image copied and pasted inside the document keeps its asset");

  // ---- edits while the dialog is open: the paste still goes where it was made ----
  await caret("The north region led growth");
  await send("paste", {
    files: [{ name: "a.png", type: "image/png", data: picture.png }],
  });
  await page.waitForSelector(`${dialog} textarea`);
  // An edit before the paragraph, and a selection elsewhere (as a restored caret could be).
  await page.evaluate(() => {
    const { view, TextSelection } = window.htmlText;
    view.dispatch(view.state.tr.insertText("Edited. ", 1));
    let at = null;
    view.state.doc.descendants((node, pos) => {
      if (at === null && node.isText && node.text.startsWith("Grow where"))
        at = pos;
    });
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, at, at + 4),
      ),
    );
  });
  await describe("Mapped picture");
  await settled();
  text = check(await saved());
  assert.match(
    article(text),
    /the west region stayed flat\.<\/p>\n<figure class="image" id="fig-mapped-picture" data-width="text">/,
  );
  assert.match(article(text), /<p>Grow where the soil is already rich\.<\/p>/);
  await undo();
  await undo();
  assert.equal(await saved(), start);
  pass(
    "an edit and a selection made while the dialog is open never move the paste or lose text",
  );

  // ---- two pastes in a row: both land, in order, as two undo steps ----
  await caret("Grow where the soil is already rich");
  await send("paste", {
    files: [{ name: "a.png", type: "image/png", data: picture.png }],
  });
  await send("paste", {
    files: [{ name: "b.gif", type: "image/gif", data: picture.gif }],
  });
  await describe("First pasted");
  await describe("Second pasted");
  await settled();
  text = check(await saved());
  assert.match(
    article(text),
    /<\/blockquote>\n<figure class="image" id="fig-first-pasted" data-width="text">\n[^\n]*\n<\/figure>\n<figure class="image" id="fig-second-pasted" data-width="text">/,
  );
  await undo();
  assert.doesNotMatch(await saved(), /fig-second-pasted/);
  assert.match(await saved(), /fig-first-pasted/);
  await undo();
  assert.equal(await saved(), start);
  pass(
    "two pastes made while the first waits both land, in order, one undo step each",
  );

  // ---- SVG is cleaned: nothing embedded, nothing that runs ----
  const embedded = `data:image/png;base64,${huge}`;
  const hostile =
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="40" height="20" onload="alert(1)">' +
    "<style>rect{fill:url(https://example.org/p.svg#g)}</style><script>alert(1)</script>" +
    `<image href="${embedded}" width="10" height="10"/><image xlink:href="https://example.org/x.png"/>` +
    '<foreignObject><p xmlns="http://www.w3.org/1999/xhtml">x</p></foreignObject>' +
    '<defs><linearGradient id="g"><stop offset="0" stop-color="#14517a"/></linearGradient></defs>' +
    '<rect width="40" height="20" fill="url(#g)" onclick="alert(1)"/><use href="#g"/><a href="https://example.org"><circle r="2"/></a></svg>';
  await caret("Grow where the soil is already rich");
  await send("paste", {
    types: {
      "text/html":
        `<img src="data:image/svg+xml;base64,${Buffer.from(hostile).toString("base64")}" alt="Cleaned">` +
        `<img src="data:image/svg+xml,${encodeURIComponent('<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg">&a;</svg>')}" alt="Entities">`,
    },
  });
  await settled();
  text = check(await saved());
  const key = article(text).match(/data-asset="(a\d+)" alt="Cleaned"/)[1];
  const cleaned = Buffer.from(assetsOf(text)[key].data, "base64").toString();
  assert.match(cleaned, /<rect width="40" height="20" fill="url\(#g\)"\/>/);
  assert.match(cleaned, /<use href="#g"\/>/);
  assert.match(cleaned, /<linearGradient id="g">/);
  assert.doesNotMatch(
    cleaned,
    /<image|<script|<style|foreignObject|onload|onclick|https:|data:/,
  );
  assert.doesNotMatch(article(text), /alt="Entities"/);
  assert.match(await status(), /Left out: 1 image that could not be read\./);
  await undo();
  assert.equal(await saved(), start);
  pass(
    "a pasted SVG keeps its drawing and loses scripts, handlers, embedded and outside resources; entities are refused",
  );

  // ---- a percent-encoded PNG, files left out beside text, a transfer with items only ----
  const percent = [...Buffer.from(picture.gif, "base64")]
    .map((b) => "%" + b.toString(16).padStart(2, "0"))
    .join("");
  await caret("Grow where the soil is already rich");
  await send("paste", {
    types: {
      "text/html": `<p>Encoded</p><img src="data:image/gif,${percent}" alt="Percent">`,
    },
  });
  await settled();
  assert.match(
    article(check(await saved())),
    /<figure class="image" id="fig-percent"/,
  );
  await undo();
  await caret("Grow where the soil is already rich");
  await send("paste", {
    files: [
      {
        name: "huge.png",
        type: "image/png",
        data: Buffer.alloc(PASTE_BYTES + 1).toString("base64"),
      },
    ],
    types: { "text/plain": "beside" },
  });
  await settled();
  assert.match(article(check(await saved())), /rich\.beside<\/p>/);
  assert.match(
    await status(),
    /^Pasted\. Left out: 1 image over the paste limits/,
  );
  await undo();
  await send("paste", {
    files: [{ name: "notes.pdf", type: "application/pdf", data: "JVBERg==" }],
    types: { "text/plain": "" },
  });
  await settled();
  assert.match(
    await status(),
    /Nothing to paste\. Left out: 1 file that is not a PNG, JPEG, GIF, WebP or SVG image\./,
  );
  // Some browsers give a pasted file through clipboardData.items only.
  await caret("Grow where the soil is already rich");
  await page.evaluate((data) => {
    const file = new File(
      [Uint8Array.from(atob(data), (c) => c.charCodeAt(0))],
      "dot.gif",
      { type: "image/gif" },
    );
    const clipboardData = {
      types: ["Files"],
      files: [],
      items: [{ kind: "file", type: "image/gif", getAsFile: () => file }],
      getData: () => "",
    };
    const e = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "clipboardData", { value: clipboardData });
    window.htmlText.view.dom.dispatchEvent(e);
  }, picture.gif);
  await describe("From items");
  await settled();
  assert.match(article(check(await saved())), /id="fig-from-items"/);
  await undo();
  assert.equal(await saved(), start);
  assert.deepEqual(requests, [], "nothing was requested");
  pass(
    "a percent-encoded picture pastes; files left out beside text are reported; files from items only paste",
  );

  // ---- saved and reopened: the pasted images show, nothing unsaved, nothing orphaned ----
  const path = join(out, `images-pasted-${name}.html`);
  await writeFile(path, withImages);
  const reopened = await context.newPage();
  reopened.on("pageerror", (e) => errors.push(e.message));
  await reopened.goto(pathToFileURL(path).href);
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
    withImages,
  );
  await reopened.close();
  pass("a file with pasted images reopens with them shown and nothing unsaved");

  assert.deepEqual(requests, [], "nothing was requested");
  assert.deepEqual(errors, []);
  await context.close();
}

for (const name of ENGINES) await run(name);
