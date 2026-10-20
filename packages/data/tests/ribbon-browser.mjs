import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook, measureHTML } from "../tools/build.mjs";
import { scenarioWorkbook } from "../fixtures/scenarios.mjs";
import { readHTML } from "../bench/storage/html.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const offline of [false, true]) {
    const file = resolve(
        out,
        `ribbon-${offline ? "offline" : "standard"}.html`,
      ),
      html = await buildWorkbook(scenarioWorkbook(), { offline });
    await writeFile(file, html);
    if (!offline) assert.ok(measureHTML(html).applicationCodeBytes < 500000);
    const context = await browser.newContext({
        acceptDownloads: true,
        viewport: { width: 1440, height: 1000 },
      }),
      page = await context.newPage(),
      requests = [],
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
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
    assert.equal(
      await page
        .getByRole("tablist", { name: "Workbook ribbon", exact: true })
        .count(),
      1,
    );
    const home = page.getByRole("tab", { name: "Home", exact: true }),
      data = page.getByRole("tab", { name: "Data", exact: true });
    assert.equal(await home.getAttribute("aria-selected"), "true");
    await home.focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await data.getAttribute("aria-selected"), "true");
    assert.equal(
      await data.evaluate((el) => el === document.activeElement),
      true,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Format selection", exact: true })
        .isVisible(),
      false,
    );
    await page.keyboard.press("Home");
    assert.equal(await home.getAttribute("aria-selected"), "true");
    await page.keyboard.press("End");
    assert.equal(await data.getAttribute("aria-selected"), "true");
    await page.keyboard.press("ArrowRight");
    assert.equal(await home.getAttribute("aria-selected"), "true");
    assert.deepEqual(requests, []);
    await page
      .getByRole("button", { name: "More decimals", exact: true })
      .click();
    assert.deepEqual(requests, []);
    await data.click();
    await page
      .getByLabel("Scenario", { exact: true })
      .selectOption({ label: "Upside" });
    await page
      .getByText("Calculated locally. Unsaved changes.", { exact: true })
      .waitFor();
    assert.equal(await data.getAttribute("aria-selected"), "true");
    assert.equal(
      await page.locator('#grid [data-cell="B2"]').textContent(),
      "€300.000",
    );
    assert.equal(requests.length, offline ? 0 : 2);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page
      .getByText("Undo restored the previous workbook.", { exact: true })
      .waitFor();
    assert.equal(await data.getAttribute("aria-selected"), "true");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await page
      .getByText("Redo restored the previous workbook.", { exact: true })
      .waitFor();
    await page
      .locator("#save-status")
      .filter({ hasText: "Recovery stored" })
      .waitFor();
    const wait = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save a copy", exact: true })
      .click();
    const saved = resolve(
      out,
      `ribbon-${offline ? "offline" : "standard"}-saved.html`,
    );
    await (await wait).saveAs(saved);
    const book = readHTML(await readFile(saved, "utf8")).book;
    assert.equal(book.sheets[0].cells.B2.result.value, 300);
    assert.equal(book.sheets[0].cells.B2.format.digits, 3);
    await context.setOffline(true);
    await page.goto(pathToFileURL(saved).href);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    assert.equal(await home.getAttribute("aria-selected"), "true");
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await home.click();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      if (width === 320) {
        await home.focus();
        for (let step = 0; step < 30; step++) {
          await page.keyboard.press("Tab");
          if (
            await page.evaluate(
              () => document.activeElement.id === "recalculate",
            )
          )
            break;
        }
        assert.equal(
          await page.evaluate(() => document.activeElement.id),
          "recalculate",
        );
        assert.equal(
          await page
            .locator("#ribbon-home")
            .evaluate((el) => el.scrollLeft > 0),
          true,
        );
      }
      await data.click();
      assert.equal(
        await page
          .getByRole("button", { name: "Dropdown settings", exact: true })
          .isVisible(),
        true,
      );
    }
    // Prevent an unbounded old print viewport from actually rendering millions
    // of grid cells while this regression inspects its computed layout.
    await page.evaluate(() => {
      const request = requestAnimationFrame;
      globalThis.ribbonOriginalRAF = request;
      window.requestAnimationFrame = (callback) =>
        matchMedia("print").matches ? 0 : request(callback);
    });
    await page.emulateMedia({ media: "print" });
    assert.ok(
      await page
        .locator("#grid")
        .evaluate((el) => el.clientHeight <= innerHeight),
    );
    assert.ok((await page.locator("#grid [data-cell]").count()) < 600);
    await page.emulateMedia({ media: "screen" });
    await page.evaluate(() => {
      window.requestAnimationFrame = globalThis.ribbonOriginalRAF;
      delete globalThis.ribbonOriginalRAF;
    });
    await page.emulateMedia({ media: "print" });
    await page.waitForFunction(
      () => document.getElementById("grid").clientHeight <= innerHeight,
    );
    assert.ok((await page.locator("#grid [data-cell]").count()) < 600);
    await page.emulateMedia({ media: "screen" });
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `PASS ribbon ${offline ? "offline" : "standard"}: keyboard tabs, engine-free formatting, scenario/history, save/reopen and responsive reachability`,
    );
  }
} finally {
  await browser.close();
}
