import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { dataBarWorkbook } from "../fixtures/bars.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const book = dataBarWorkbook();
const browser = await chromium.launch();
async function geometry(page, ref) {
  await page
    .locator(`#grid [data-cell="${ref}"] .data-bar-fill`)
    .waitFor({ state: "attached" });
  return page.locator(`#grid [data-cell="${ref}"]`).evaluate((el) => {
    const fill = el.querySelector(".data-bar-fill"),
      axis = el.querySelector(".data-bar-axis");
    return {
      left: parseFloat(fill.style.left),
      width: parseFloat(fill.style.width),
      axis: parseFloat(axis.style.left),
      color: fill.style.backgroundColor,
      text: el.textContent,
    };
  });
}
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 0.01, `${actual} != ${expected}`);
try {
  for (const offline of [false, true]) {
    const file = resolve(
      out,
      `data-bars-${offline ? "offline" : "standard"}.html`,
    );
    await writeFile(file, await buildWorkbook(book, { offline }));
    const context = await browser.newContext(),
      page = await context.newPage(),
      errors = [],
      requests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await context.route(/^https?:\/\//, async (route) => {
      requests.push(route.request().url());
      await route.fulfill({
        body: await readFile(
          new URL(
            `../engine/vendor/${route.request().url().endsWith(".wasm.gz") ? "ironcalc.wasm.gz" : "ironcalc.mjs"}`,
            import.meta.url,
          ),
        ),
      });
    });
    await page.goto(pathToFileURL(file).href);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    const negative = await geometry(page, "F3"),
      positive = await geometry(page, "F4"),
      zero = await geometry(page, "F5");
    near(negative.left, 0);
    near(negative.width, 100 / 3);
    near(negative.axis, 100 / 3);
    assert.equal(negative.color, "var(--alert)");
    near(positive.left, 100 / 3);
    near(positive.width, 100 / 6);
    near(zero.width, 0);
    const clipped = await geometry(page, "H5");
    near(clipped.width, 50);
    near(clipped.axis, 50);
    assert.equal(clipped.text, "200");
    assert.equal(
      await page
        .locator(
          '#grid [data-cell="F8"] .data-bar-fill,#grid [data-cell="F9"] .data-bar-fill',
        )
        .count(),
      0,
    );
    assert.deepEqual(requests, []);
    await page
      .getByLabel("Scenario", { exact: true })
      .selectOption({ label: "Upside" });
    await page
      .getByText("Calculated locally. Unsaved changes.", { exact: true })
      .waitFor();
    const profit = await geometry(page, "B2");
    near(profit.width, 100);
    assert.equal(profit.text, "€300.00");
    assert.equal(requests.length, offline ? 0 : 2);
    await context.setOffline(true);
    await page.emulateMedia({ media: "print" });
    assert.ok((await page.locator("#grid [data-cell]").count()) < 600);
    assert.equal(
      await page.locator('#grid [data-cell="B2"] .data-bar-fill').count(),
      1,
    );
    await page.emulateMedia({ media: "screen" });
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `PASS data bars ${offline ? "offline" : "standard"}: mixed zero axis, fixed clipping, date/error/blank handling, scenario updates and bounded print`,
    );
  }
} finally {
  await browser.close();
}
