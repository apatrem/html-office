// T18 from file:// in Chromium (Firefox and WebKit with TEXT_ENGINES): a document made by
// tools/document.mjs new from the examples opens in the editor without errors, shows its
// Node-drawn chart preview without requesting ECharts, saves back the same bytes when nothing
// was edited, and Help › Format guide shows the embedded guide as text.
//   TEXT_ENGINES=chromium,firefox,webkit node tests/document-browser.mjs   (default: chromium)
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import * as playwright from "playwright";
import { guideText } from "../tools/guide.mjs";

const ENGINES = (process.env.TEXT_ENGINES || "chromium").split(",");
const out = resolve(
  new URL("../../../dist/text-test/", import.meta.url).pathname,
);
await mkdir(out, { recursive: true });
const examples = fileURLToPath(new URL("../examples/valid/", import.meta.url));
const path = join(out, "document-new.html");
const made = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL("../tools/document.mjs", import.meta.url)),
    "new",
    path,
    "--markdown",
    join(examples, "report.md"),
    "--payloads",
    join(examples, "payloads.json"),
    "--title",
    "Northwind Gardens review",
    "--contents",
    "2",
    "--numbers",
    "--force",
  ],
  { encoding: "utf8" },
);
assert.equal(made.status, 0, made.stderr);
const source = await readFile(path, "utf8");
const url = pathToFileURL(path).href;

async function run(name) {
  const pass = (what) => console.log(`PASS text document [${name}]: ${what}`);
  const browser = await playwright[name].launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    const errors = [],
      requests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on(
      "request",
      (r) => r.url().startsWith("http") && requests.push(r.url()),
    );
    await page.goto(url);
    await page.waitForFunction(() => window.htmlText);
    // The saved preview shows: the chart is not redrawn, so ECharts is never requested.
    await page.locator("#fig-revenue svg.render").scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    assert.equal(await page.locator("#fig-revenue .tx-stale").count(), 0);
    assert.equal(await page.locator("#fig-revenue.tx-stale").count(), 0);
    assert.deepEqual(requests, []);
    pass("opens with its saved chart preview, no request");
    // Nothing edited: the document saves as it was made.
    assert.equal(
      await page.evaluate(() => window.htmlText.serialize()),
      source,
    );
    pass("saves back byte for byte");
    await page.click(".tx-shell [role=menubar] button:text-is('Help')");
    await page.click("[role=menu] [role^=menuitem]:has-text('Format guide')");
    const shown = await page.locator("dialog pre.tx-guide").textContent();
    assert.equal(shown, guideText("0.1.0"));
    await page.keyboard.press("Escape");
    await page.locator("dialog pre.tx-guide").waitFor({ state: "detached" });
    pass("Help › Format guide shows the embedded guide");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

for (const name of ENGINES) await run(name);
