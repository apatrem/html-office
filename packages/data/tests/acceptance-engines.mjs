// T21: the published acceptance workbook reads offline in Chromium, Firefox
// and WebKit (ACCEPTANCE_ENGINES, comma-separated; all three by default):
// saved results are current, every sheet tab opens, the summary, P&L and
// pivot show their saved values, the chart previews load, and nothing is
// requested from the network. Editing and saving need Chrome or Edge
// (docs/MANUAL-CHECKS.md › T21). Needs only Playwright and the committed
// files, so it runs where the other browsers are installed.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as playwright from "playwright";

const dir = fileURLToPath(new URL("../acceptance/output/", import.meta.url)),
  engines = (process.env.ACCEPTANCE_ENGINES ?? "chromium,firefox,webkit").split(
    ",",
  );
// Displayed values of the published (Base) workbook, as the grid shows them.
const SHOWN = {
  Summary: { B4: "Base", D8: "€255.9k", D10: "€21.1k", B13: "€2,560" },
  "P&L": { B2: "31/01/2025", B14: "-€2,507", H6: "€15,600" },
  Stations: { A6: "East", D10: "18640" },
};
// The workbook JSON holds the sheet names the tabs show.
const html = await readFile(
    `${dir}fictional-bike-rentals-offline.html`,
    "utf8",
  ),
  names = [
    ...html
      .match(/<script id="workbook"[^>]*>([\s\S]*?)<\/script>/)[1]
      .matchAll(/"name":\s*"([^"]+)"/g),
  ].map((m) => m[1]);
for (const name of ["Summary", "Assumptions", "Rentals", "Formula analysis"])
  assert.ok(names.includes(name), name);

for (const engine of engines) {
  const browser = await playwright[engine].launch();
  try {
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      }),
      requests = [],
      errors = [];
    await context.route(/^https?:\/\//, (route) => {
      requests.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      pathToFileURL(`${dir}fictional-bike-rentals-offline.html`).href,
    );
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor({ timeout: 30000 });
    const tab = (name) =>
      page.locator("#sheet-tabs").getByRole("button", { name, exact: true });
    for (const [sheet, cells] of Object.entries(SHOWN)) {
      await tab(sheet).click();
      for (const [ref, text] of Object.entries(cells)) {
        await page.getByLabel("Cell address").fill(ref);
        await page.keyboard.press("Tab");
        assert.equal(
          (
            await page.locator(`#grid [data-cell="${ref}"]`).textContent()
          ).trim(),
          text,
          `${engine} ${sheet}!${ref}`,
        );
      }
    }
    await tab("Summary").click();
    await page.waitForFunction(
      () => {
        const images = [...document.querySelectorAll(".data-chart img")];
        return (
          images.length === 3 &&
          images.every((img) => img.complete && img.naturalWidth > 0)
        );
      },
      null,
      { timeout: 30000 },
    );
    assert.deepEqual(errors, [], engine);
    assert.deepEqual(requests, [], `${engine}: no network request`);
    console.log(`PASS acceptance workbook reads offline in ${engine}`);
  } finally {
    await browser.close();
  }
}
