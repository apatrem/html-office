// F06 Download PNG (ADR-010): the selection drawn from the model without the
// engine, at 2×, with sizes, catalogue and direct formatting, borders,
// conditional formatting and grid lines as displayed; stale results add a
// band; whole columns are cut to the used range; large selections are refused.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { formattingWorkbook } from "../fixtures/formatting.mjs";
import { readModel } from "../model/document.mjs";
import { readHTML, replaceHTML } from "../bench/storage/html.mjs";
import { openMenu, menuItem } from "./shell.mjs";
import { STALE_NOTICE } from "../runtime/picture.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const file = resolve(out, "picture.html"),
  staleFile = resolve(out, "picture-stale.html");
await writeFile(file, await buildWorkbook(formattingWorkbook()));
// Changing an input after the build leaves the saved results stale.
const current = await buildWorkbook(
    readModel(
      await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
    ),
  ),
  parsed = readHTML(current);
parsed.book.sheets[0].cells.B2.input.value = 120;
await writeFile(staleFile, replaceHTML(current, parsed, parsed.book));
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1440, height: 900 },
    }),
    page = await context.newPage(),
    requests = [],
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.route(/^https?:\/\//, (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  await page.goto(pathToFileURL(file).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  const select = async (range) => {
    await page.getByLabel("Cell address").fill(range);
    await page.getByLabel("Cell address").press("Enter");
  };
  const fromMenu = async () => {
    await openMenu(page, "File");
    await menuItem(page, "File", "Download selection as PNG").click();
  };
  async function download(name, start = fromMenu) {
    const wait = page.waitForEvent("download");
    await start();
    const d = await wait,
      saved = resolve(out, name);
    await d.saveAs(saved);
    // Size and pixels (CSS px at 2×) read back through an image.
    const png = (await readFile(saved)).toString("base64");
    const image = await page.evaluate(async (data) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return {
        width: img.width,
        height: img.height,
        data: [...ctx.getImageData(0, 0, img.width, img.height).data],
      };
    }, png);
    image.at = (x, y) => {
      const i = (Math.round(y * 2) * image.width + Math.round(x * 2)) * 4;
      return `rgb(${image.data.slice(i, i + 3).join(", ")})`;
    };
    return { image, suggested: d.suggestedFilename() };
  }
  const css = (ref, property) =>
    page
      .locator(`#grid [data-cell="${ref}"]`)
      .evaluate((el, p) => getComputedStyle(el)[p], property);
  const token = (name) =>
    page.evaluate((n) => {
      const probe = document.createElement("i");
      probe.style.color = `var(--${n})`;
      document.body.append(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    }, name);
  // A1:F12 at 2×: A is 180 px, B–F 100; row 6 is 50 px, the others 23.
  await select("A1:F12");
  const first = await download("picture-a1.png");
  assert.equal(first.suggested, "fictional-formatting-Showcase-A1-F12.png");
  assert.equal(first.image.width, 2 * (180 + 5 * 100));
  assert.equal(first.image.height, 2 * (11 * 23 + 50));
  await page
    .locator("#status")
    .filter({ hasText: "PNG download requested: Showcase!A1:F12" })
    .waitFor();
  const { at } = first.image;
  // Conditional dark fill on A3, column tint on C8, white on F12, header ink
  // on A2... B2, red negative D10 over a conditional light fill.
  assert.equal(at(170, 23 * 2 + 4), await css("A3", "backgroundColor"));
  assert.equal(at(330, 7 * 23 + 50 + 4), await css("C8", "backgroundColor"));
  assert.equal(at(675, 9 * 23 + 50 + 4), await css("F11", "backgroundColor"));
  assert.equal(at(185, 23 + 4), await css("B2", "backgroundColor"));
  assert.equal(at(435, 8 * 23 + 50 + 4), await css("D10", "backgroundColor"));
  // Total row: double border under A5:B5, two 1 px lines centred on the
  // edge like the grid's (the row's grid line shows in the gap).
  const bottom = 5 * 23;
  assert.equal(at(90, bottom - 1.75), await token("ink"));
  assert.equal(at(90, bottom - 0.75), await css("A5", "borderBottomColor"));
  assert.equal(at(90, bottom + 0.25), await token("ink"));
  assert.equal(at(90, bottom + 1.25), await css("A6", "backgroundColor"));
  // Grid lines as displayed: a 1 px line between E and F on row 12.
  assert.equal(
    at(579.5, 10 * 23 + 50 + 10),
    await css("F12", "borderRightColor"),
  );
  // Grid lines off: the same point is the cell background.
  const toolbar = page.getByRole("toolbar", { name: /Formatting/ });
  await toolbar.getByRole("button", { name: "Grid lines" }).click();
  const plain = await download("picture-plain.png");
  assert.equal(
    plain.image.at(579.5, 10 * 23 + 50 + 10),
    await css("F12", "backgroundColor"),
  );
  await toolbar.getByRole("button", { name: "Grid lines" }).click();
  // The cell menu offers the same command for the selection.
  await select("A1:B2");
  const menu = await download("picture-menu.png", async () => {
    await page.locator('#grid [data-cell="B2"]').click({ button: "right" });
    await page
      .getByRole("menu", { name: "Cell menu" })
      .getByRole("menuitem", { name: "Download as PNG" })
      .click();
  });
  assert.equal(menu.suggested, "fictional-formatting-Showcase-A1-B2.png");
  // A whole column is cut to the used range (13 rows).
  await page.locator('#grid [data-column="3"]').click();
  const whole = await download("picture-whole.png");
  assert.equal(whole.suggested, "fictional-formatting-Showcase-C1-C13.png");
  assert.equal(whole.image.width, 200);
  assert.equal(whole.image.height, 2 * (12 * 23 + 50));
  // Too large: refused with guidance, nothing downloaded.
  let downloads = 0;
  page.on("download", () => downloads++);
  await select("A1:J600");
  await fromMenu();
  await page
    .locator("#status")
    .filter({ hasText: "too large for a picture (6,000 cells" })
    .waitFor();
  await select("A1:B500");
  await fromMenu();
  await page
    .locator("#status")
    .filter({ hasText: "the limit is 5,000 cells and 8,000 px" })
    .waitFor();
  assert.equal(downloads, 0);
  // Stale saved results: a warning band inside the image; none without
  // formulas.
  await page.goto(pathToFileURL(staleFile).href);
  await page
    .getByText(
      "Saved results are stale or missing. Apply an edit to recalculate.",
      { exact: true },
    )
    .waitFor();
  await page.getByRole("button", { name: "Inputs", exact: true }).click();
  await select("A1:B3");
  const inputs = await download("picture-inputs.png");
  assert.equal(inputs.image.height, 2 * 3 * 23);
  await page.getByRole("button", { name: "Summary", exact: true }).click();
  await select("A1:B3");
  const stale = await download("picture-stale.png");
  // The notice wraps to the 200 px width: 16 px lines and 12 px padding
  // (the line count depends on the platform's font).
  const band = stale.image.height / 2 - 3 * 23;
  assert.ok(band >= 2 * 16 + 12 && (band - 12) % 16 === 0, `band ${band}`);
  assert.equal(stale.image.at(2, 2), await token("alert"));
  await page
    .locator("#status")
    .filter({ hasText: "with a stale-results warning" })
    .waitFor();
  assert.ok(STALE_NOTICE.length > 0);
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  await context.close();
  console.log(
    "PASS picture: PNG of the selection at 2× with formatting, borders, conditional fills and grid lines, cut whole columns, size limits and the stale band, without the engine",
  );
} finally {
  await browser.close();
}
