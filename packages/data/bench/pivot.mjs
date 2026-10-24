// Large-data pivot measurement (T17): the standalone file:// editor refreshing
// a pivot over 50k/100k fictional records whose summed column is a formula.
// Records wall time from the Refresh click to the published result, the
// worker's recalculation + aggregation time, main-thread long tasks during the
// refresh, and the time until the recovery worker reports a source edit stale.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import os from "node:os";
import { chromium } from "playwright";
import { buildWorkbook, measureHTML } from "../tools/build.mjs";
import { pivotWorkbook } from "../fixtures/pivots.mjs";
const out = resolve("dist/data-bench");
await mkdir(out, { recursive: true });
const outputArg = process.argv.indexOf("--output"),
  output =
    outputArg >= 0
      ? resolve(process.argv[outputArg + 1])
      : new URL("./pivot-large-results.json", import.meta.url).pathname;
const browser = await chromium.launch();
const report = {
  generatedAt: new Date().toISOString(),
  hardware: {
    platform: `${os.platform()} ${os.release()}`,
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
    memoryGB: Math.round(os.totalmem() / 2 ** 30),
  },
  browser: `chromium ${browser.version()}`,
  method:
    "Fictional Sales row table (Region, Quarter, Channel, Units, Revenue, Adjusted = Revenue × scenario factor). Pivot: rows Region, columns Quarter, Sum of Adjusted. Cold = first refresh, including engine load and model load; warm = refresh after one source edit, five runs.",
  cases: [],
};
async function refresh(page) {
  const start = Date.now();
  await page.evaluate(() => {
    window.__longTasks = [];
    window.__pivot = null;
  });
  await page
    .locator("#shell-drawer")
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
  await page.waitForFunction(() => window.__pivot, null, { timeout: 600000 });
  const wallMS = Date.now() - start,
    { pivot, longTasks } = await page.evaluate(() => ({
      pivot: window.__pivot,
      longTasks: window.__longTasks,
    }));
  return {
    wallMS,
    workerPivotMS: Math.round(pivot.pivotMS),
    records: pivot.records,
    outputCells: pivot.outputCells,
    longestMainTaskMS: Math.round(Math.max(0, ...longTasks)),
  };
}
try {
  for (const rows of [50000, 100000]) {
    const file = resolve(out, `pivot-${rows}.html`),
      html = await buildWorkbook(pivotWorkbook({ rows }));
    await writeFile(file, html);
    const context = await browser.newContext(),
      page = await context.newPage();
    page.setDefaultTimeout(600000);
    await context.route(/^https?:\/\//, async (route) =>
      route.fulfill({
        body: await readFile(
          new URL(
            `../engine/vendor/${route.request().url().endsWith(".wasm.gz") ? "ironcalc.wasm.gz" : "ironcalc.mjs"}`,
            import.meta.url,
          ),
        ),
      }),
    );
    await page.addInitScript(() => {
      window.__longTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          window.__longTasks.push(entry.duration);
      }).observe({ type: "longtask", buffered: false });
      addEventListener("html-data:pivot", (event) => {
        window.__pivot = event.detail;
      });
    });
    const opened = Date.now();
    await page.goto(pathToFileURL(file).href);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    const openMS = Date.now() - opened;
    await page
      .getByRole("menubar", { name: "Workbook menu" })
      .getByRole("menuitem", { name: "Data", exact: true })
      .click();
    await page
      .getByRole("menu", { name: "Data", exact: true })
      .getByRole("menuitem", { name: "Pivot tables…", exact: true })
      .click();
    await page.locator('.pv-state[data-state="never"]').waitFor();
    const cold = await refresh(page);
    await page.locator('.pv-state[data-state="current"]').waitFor();
    const warm = [];
    for (let run = 0; run < 5; run++) {
      // One source edit, then wait for the derived stale state.
      await page
        .locator("#sheet-tabs")
        .getByRole("button", { name: "Sales", exact: true })
        .click();
      await page.locator("#cell-address").fill("E2");
      await page.locator("#cell-address").press("Enter");
      await page.locator("#cell-type").selectOption("number");
      await page.locator("#cell-value").fill(String(100 + run));
      const edited = Date.now();
      await page.locator("#cell-value").press("Enter");
      await page.waitForFunction(() =>
        /Calculated locally/.test(
          document.getElementById("status").textContent,
        ),
      );
      await page.locator('.pv-state[data-state="stale"]').waitFor();
      const staleMS = Date.now() - edited;
      warm.push({ ...(await refresh(page)), editToStaleMS: staleMS });
      await page.locator('.pv-state[data-state="current"]').waitFor();
    }
    // The grand total cell of the Region × Quarter table (B3:G10).
    const grand = Number(
      (await page.locator('#grid [data-cell="G10"]').textContent()).replace(
        /[^0-9.-]/g,
        "",
      ),
    );
    assert.ok(grand > 0, "grand total rendered");
    report.cases.push({
      id: `pivot-${rows}`,
      rows,
      sourceFormulaCells: rows,
      size: measureHTML(html),
      openMS,
      cold,
      warm,
      warmMaxWallMS: Math.max(...warm.map((w) => w.wallMS)),
      warmMaxLongTaskMS: Math.max(...warm.map((w) => w.longestMainTaskMS)),
    });
    await context.close();
  }
} finally {
  await browser.close();
}
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    report.cases.map(({ size, warm, ...c }) => c),
    null,
    2,
  ),
);
