// T03 in real Chromium from file://: open, type, undo/redo, save, reopen, Save a copy, offline, refusal.
//   node tests/browser.mjs
// The file picker is replaced by an in-page disk; everything else is the built document.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildEngine, buildDocument, measureFile } from "../tools/build.mjs";
import { diffLines } from "../tools/pack.mjs";
import { inlineScript } from "../../../tools/inline-script.mjs";

const here = new URL("./", import.meta.url);
const out = resolve(
  new URL("../../../dist/text-test/", import.meta.url).pathname,
);
await mkdir(out, { recursive: true });
const engine = await buildEngine();
const source = await readFile(
  new URL("../fixtures/valid/example.html", here),
  "utf8",
);
const built = await buildDocument(source, engine);
const write = async (name, html) => {
  const path = join(out, name);
  await writeFile(path, html);
  return pathToFileURL(path).href;
};
const url = await write("example.html", built);
const changed = (a, b) =>
  diffLines(a.split("\n"), b.split("\n"))
    .filter((e) => e.op !== " ")
    .map((e) => e.op + e.text);

const browser = await chromium.launch();
const pass = (name) => console.log(`PASS text: ${name}`);

async function open(target, disk = built) {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  // Standard mode needs no network: record and refuse anything that is not the file itself.
  await context.route("**/*", (route) => {
    if (route.request().url().startsWith("file:")) return route.continue();
    requests.push(route.request().url());
    return route.abort();
  });
  await page.addInitScript((text) => {
    const disk = (globalThis.disk = { text, writes: 0 });
    globalThis.showSaveFilePicker = async () => ({
      name: "example.html",
      async getFile() {
        const value = disk.text;
        return { text: async () => value };
      },
      async createWritable() {
        let next;
        return {
          async write(value) {
            next = value;
          },
          async close() {
            disk.text = next;
            disk.writes++;
          },
          async abort() {},
        };
      },
    });
  }, disk);
  await page.goto(target);
  return { page, context, errors, requests };
}

const status = (page) => page.locator(".tx-shell [role=status]").textContent();
const mod = process.platform === "darwin" ? "Meta" : "Control";

try {
  // ---- open, type, undo and redo ----
  const { page, context, errors, requests } = await open(url);
  await page.waitForFunction(() => window.htmlText);
  assert.equal(await page.getAttribute("#doc", "contenteditable"), "true");
  assert.equal(
    await page.evaluate(() => window.htmlText.serialize()),
    built,
    "an unchanged document serialises to its own bytes",
  );
  pass("opens from file:// and an untouched document serialises byte for byte");

  // The start of the lead paragraph's first line.
  await page.click("#doc p.lead", { position: { x: 2, y: 6 } });
  await page.keyboard.press("Home");
  await page.keyboard.type("Overall, ");
  const lead = () => page.locator("#doc p.lead").textContent();
  assert.match(await lead(), /^Overall, Revenue grew/);
  assert.equal(await status(page), "Unsaved changes");
  await page.keyboard.press(`${mod}+z`);
  assert.match(await lead(), /^Revenue grew/);
  await page.keyboard.press(`${mod}+Shift+z`);
  assert.match(await lead(), /^Overall, Revenue grew/);
  await page.click(".tx-shell button[aria-label=Undo]");
  assert.match(await lead(), /^Revenue grew/);
  await page.click(".tx-shell button[aria-label=Redo]");
  assert.match(await lead(), /^Overall, Revenue grew/);
  pass(
    "typing, then undo and redo by keyboard and toolbar (ProseMirror history)",
  );

  // ---- save through the shared persistence module ----
  await page.click(".tx-shell .sh-primary");
  await page.waitForFunction(() => window.disk.writes === 1);
  assert.equal(await status(page), "Saved to example.html.");
  const saved = await page.evaluate(() => window.disk.text);
  const diff = changed(built, saved);
  assert.equal(diff.length, 2, diff.join("\n"));
  assert.match(diff[0], /^-<p class="lead"><mark class="comment"/);
  assert.match(diff[1], /^\+<p class="lead">Overall, <mark class="comment"/);
  pass("Save writes the edit and changes nothing else (one line)");

  // A second edit is saved through the same file binding.
  await page.keyboard.type("x");
  await page.keyboard.press("Backspace");
  await page.keyboard.press(`${mod}+s`);
  await page.waitForFunction(() => window.disk.writes === 2);
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(() => window.disk.writes),
    2,
    "one save per keystroke",
  );
  assert.equal(await page.evaluate(() => window.disk.text), saved);
  pass("Cmd/Ctrl+S saves again to the bound file");

  // ---- Save a copy ----
  const download = page.waitForEvent("download");
  await page.click(".tx-shell [role=menubar] button:text('File')");
  await page.click("[role=menuitem]:has-text('Save a copy')");
  const copy = await readFile(await (await download).path(), "utf8");
  assert.equal(copy, saved);
  pass("Save a copy downloads the same complete HTML");
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, [], "no network request in standard mode");
  pass("no error and no network request");
  await context.close();

  // ---- reopen the saved file ----
  const reopened = await open(await write("saved.html", saved), saved);
  await reopened.page.waitForFunction(() => window.htmlText);
  assert.match(
    await reopened.page.locator("#doc p.lead").textContent(),
    /^Overall, Revenue grew/,
  );
  assert.equal(
    await reopened.page.evaluate(() => window.htmlText.serialize()),
    saved,
  );
  assert.equal(
    await reopened.page.evaluate(() => window.htmlText.report.protected.length),
    0,
  );
  assert.deepEqual(reopened.errors, []);
  pass("the saved file reopens with the edit and is canonical");
  await reopened.context.close();

  // ---- a different file is never overwritten ----
  const other = await open(url, "<!doctype html><title>Another file</title>");
  await other.page.waitForFunction(() => window.htmlText);
  await other.page.click("#doc h1#sec-summary");
  await other.page.keyboard.type("!");
  await other.page.click(".tx-shell .sh-primary");
  await other.page.waitForFunction(() =>
    /Save failed/.test(
      document.querySelector(".tx-shell [role=status]").textContent,
    ),
  );
  assert.equal(await other.page.evaluate(() => window.disk.writes), 0);
  assert.match(await status(other.page), /not the document opened here/);
  pass("Save refuses a file that is not the opened document");
  await other.context.close();

  // ---- protected blocks and refusal ----
  const kept = await buildDocument(
    await readFile(new URL("../fixtures/valid/protected.html", here), "utf8"),
    engine,
  );
  const protectedPage = await open(await write("protected.html", kept));
  await protectedPage.page.waitForFunction(() => window.htmlText);
  assert.equal(
    await protectedPage.page.locator("#doc .tx-protected").count(),
    14,
  );
  assert.equal(
    await protectedPage.page
      .locator("#doc .tx-protected[contenteditable=false]")
      .count(),
    14,
  );
  assert.equal(
    await protectedPage.page.evaluate(() => window.htmlText.serialize()),
    kept,
  );
  assert.match(
    await protectedPage.page.locator(".tx-shell .sh-state").textContent(),
    /14 protected blocks/,
  );
  pass("protected blocks show, cannot be edited and save unchanged");
  await protectedPage.context.close();

  const invalid = (
    await readFile(
      new URL("../fixtures/invalid/style-attribute.html", here),
      "utf8",
    )
  ).replace(
    "</body>",
    `<script id="engine" data-version="${engine.version}">${engine.code}</script>\n</body>`,
  );
  const refused = await open(await write("refused.html", invalid));
  await refused.page.waitForSelector(".tx-refusal");
  assert.equal(await refused.page.evaluate(() => window.htmlText), undefined);
  assert.equal(
    await refused.page.getAttribute("#doc", "contenteditable"),
    null,
  );
  assert.match(
    await refused.page.locator(".tx-refusal").textContent(),
    /style attributes/,
  );
  pass("an invalid file is refused before the editor opens");
  await refused.context.close();

  // ---- a save that would not reopen identically is stopped ----
  const repaired = (
    await readFile(new URL("../fixtures/valid/minimal.html", here), "utf8")
  )
    .replace(
      "<p>One paragraph.</p>",
      '<p>One paragraph.</p>\n<dt><table><b id="s"><dd>x</dd></b></table></dt>',
    )
    .replace(
      "</body>",
      `<script id="engine" data-version="${engine.version}">${engine.code}</script>\n</body>`,
    );
  const unstable = await open(await write("unstable.html", repaired), "");
  await unstable.page.waitForFunction(() => window.htmlText);
  await unstable.page.click("#doc p");
  await unstable.page.keyboard.type("!");
  await unstable.page.click(".tx-shell .sh-primary");
  await unstable.page.waitForFunction(() =>
    /Save failed/.test(
      document.querySelector(".tx-shell [role=status]").textContent,
    ),
  );
  assert.match(await status(unstable.page), /would .*; nothing was written/);
  assert.equal(await unstable.page.evaluate(() => window.disk.writes), 0);
  pass("a save that would not reopen as the same document writes nothing");
  await unstable.context.close();

  // ---- size ----
  const sizes = measureFile(built);
  assert.ok(sizes.applicationCode < sizes.ceiling);
  console.log(`INFO text sizes ${JSON.stringify(sizes)}`);
  pass(
    `embedded application code ${sizes.applicationCode} bytes (< ${sizes.ceiling})`,
  );
} finally {
  await browser.close();
}
