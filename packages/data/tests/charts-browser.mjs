// Charts end to end (T18): saved previews without ECharts or network, lazy
// library and instances, chart commands, undo/redo, structural moves,
// save/reopen, stale and missing previews, a tampered library, offline
// builds and print.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { pnl } from "../fixtures/generate.mjs";
import { salesWorkbook, manyCharts } from "../fixtures/charts.mjs";
import { readHTML, replaceHTML } from "../bench/storage/html.mjs";
import { chartData, chartRevision } from "../model/charts.mjs";
import { display } from "../runtime/view.mjs";
import { cssTheme } from "../tools/chart-previews.mjs";
import { CHARTES } from "../../shared/themes/chartes.mjs";
import { ECHARTS_URL } from "../../shared/charts/echarts.mjs";
import { openMenu, menuItem } from "./shell.mjs";

const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const echartsBytes = await readFile(
  new URL("../../../node_modules/echarts/dist/echarts.min.js", import.meta.url),
);
const engine = (url) =>
  readFile(
    new URL(
      `../engine/vendor/${url.endsWith(".wasm.gz") ? "ironcalc.wasm.gz" : "ironcalc.mjs"}`,
      import.meta.url,
    ),
  );
// Serves the pinned engine and ECharts from disk (or tampered ECharts).
async function open(html, { tampered = false, name = "charts.html" } = {}) {
  const file = resolve(out, name);
  await writeFile(file, html);
  const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1280, height: 800 },
    }),
    page = await context.newPage(),
    requests = [],
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await context.route(/^https?:\/\//, async (route) => {
    const url = route.request().url();
    requests.push(url);
    if (url === ECHARTS_URL) {
      const body = tampered
        ? Buffer.concat([echartsBytes, Buffer.from("\n;")])
        : echartsBytes;
      return route.fulfill({
        body,
        headers: {
          "content-type": "application/javascript",
          "access-control-allow-origin": "*",
        },
      });
    }
    await route.fulfill({ body: await engine(url) });
  });
  await page.goto(pathToFileURL(file).href);
  await page.getByText(/^Saved results are/).waitFor();
  return { context, page, requests, errors };
}
const states = (page) =>
  page.locator(".data-chart").evaluateAll((f) => f.map((x) => x.dataset.state));
const liveCount = (page) => page.locator(".data-chart-plot.live").count();
async function waitStates(page, expected) {
  await page.waitForFunction(
    (want) =>
      JSON.stringify(
        [...document.querySelectorAll(".data-chart")].map(
          (x) => x.dataset.state,
        ),
      ) === JSON.stringify(want),
    expected,
    { timeout: 20000 },
  );
}
async function waitStatus(page, pattern) {
  try {
    await page.waitForFunction(
      (source) =>
        new RegExp(source).test(document.getElementById("status").textContent),
      pattern.source,
      { timeout: 20000 },
    );
  } catch (error) {
    console.error(`Status: ${await page.locator("#status").textContent()}`);
    throw error;
  }
}
async function menu(page, name, item) {
  await openMenu(page, name);
  await menuItem(page, name, item).click();
}
async function selectSheet(page, name) {
  await page
    .locator("#sheet-tabs")
    .getByRole("button", { name, exact: true })
    .click();
}
async function enter(page, ref, value) {
  await page.locator("#cell-address").fill(ref);
  await page.locator("#cell-address").press("Enter");
  await page.locator("#cell-value").fill(value);
  await page.locator("#cell-value").press("Enter");
  await page.waitForFunction(
    () => document.getElementById("calc-state").textContent === "Calculated",
    null,
    { timeout: 30000 },
  );
}
async function select(page, from, to) {
  await page.locator(`#grid [data-cell="${from}"]`).click();
  await page
    .locator(`#grid [data-cell="${to}"]`)
    .click({ modifiers: ["Shift"] });
}
async function saveCopy(page, name) {
  const download = page.waitForEvent("download");
  await menu(page, "File", "Save a copy");
  const file = resolve(out, name);
  await (await download).saveAs(file);
  const html = await readFile(file, "utf8");
  return { file, html, book: readHTML(html).book };
}
// Every saved preview shows its chart's current data, in the file's charte.
async function assertPreviewsCurrent({ book, html }) {
  const css = /<style id="charte">([\s\S]*?)<\/style>/.exec(html)[1],
    theme = cssTheme(css, CHARTES[book.theme]);
  for (const chart of book.charts) {
    const { data, errors } = chartData(book, chart, (cell) =>
      display(cell, book.locale),
    );
    assert.deepEqual(errors, [], chart.id);
    assert.equal(
      chart.preview?.revision,
      await chartRevision(chart, data, theme),
      `${chart.id} preview is current`,
    );
  }
}
const panel = (page) => page.locator("#shell-drawer");

try {
  // ---- P&L: previews without ECharts, edits, scenario, save/reopen ----
  {
    const { context, page, requests, errors } = await open(
      await buildWorkbook(pnl()),
      { name: "charts-pnl.html" },
    );
    await waitStates(page, ["current", "current", "current"]);
    assert.deepEqual(requests, [], "opening loads nothing");
    assert.equal(await liveCount(page), 0);
    const first = page.locator('[data-chart="revenueTrend"]');
    assert.match(
      await first.getAttribute("aria-label"),
      /^Monthly revenue and net income\. Lines chart of Chart data!A1:C25\.$/,
    );
    assert.equal(
      await first.locator("img").getAttribute("alt"),
      await first.getAttribute("aria-label"),
    );
    assert.ok(
      await first
        .locator("img")
        .evaluate((img) => img.complete && img.naturalWidth > 0),
      "the preview image renders",
    );
    // Print shows the charts as their previews, without editor chrome.
    await page.emulateMedia({ media: "print" });
    assert.ok(await first.boundingBox(), "charts print");
    assert.equal(await first.locator(".data-chart-badge button").count(), 0);
    await page.emulateMedia({ media: "screen" });

    // An input change recalculates; out-of-date charts load ECharts once
    // (pinned URL, SRI) and draw their new values.
    await selectSheet(page, "Inputs");
    await enter(page, "B3", "30");
    await selectSheet(page, "Summary");
    await waitStatus(page, /Chart library loaded/);
    assert.equal(requests.filter((u) => u === ECHARTS_URL).length, 1);
    assert.equal(
      await page
        .locator(`head > script[src="${ECHARTS_URL}"]`)
        .getAttribute("integrity"),
      "sha384-C2iskrW/uPW46KzOjrvJIQo4YkV8lkD+QS0CrDN18IIPIpT/g2USu8bTP3nvmIAD",
    );
    await page.waitForFunction(
      () => document.querySelectorAll(".data-chart-plot.live").length >= 2,
    );
    // The scenario comparison follows its assumption.
    await selectSheet(page, "Inputs");
    await enter(page, "B11", "0.05");
    await selectSheet(page, "Summary");
    const saved = await saveCopy(page, "charts-pnl-saved.html");
    await assertPreviewsCurrent(saved);
    const scenario = saved.book.charts.find(
      (c) => c.id === "scenarioComparison",
    );
    const high = saved.book.sheets.find((s) => s.id === "chartdata").cells.O4
      .result.value;
    assert.ok(
      scenario.preview.svg.includes(
        new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
          high,
        ),
      ),
      "the scenario preview shows the new high-growth revenue",
    );
    assert.ok(
      !/<script[^>]+echarts@/.test(saved.html.split("<body")[0]),
      "the CDN script element is not saved",
    );
    assert.deepEqual(errors, []);
    await context.close();

    // Reopening shows current previews with no request at all.
    const reader = await browser.newContext(),
      reopened = await reader.newPage(),
      blocked = [];
    await reader.route(/^https?:\/\//, (route) => {
      blocked.push(route.request().url());
      return route.abort();
    });
    await reopened.goto(pathToFileURL(saved.file).href);
    await reopened.getByText("Saved results are current.").waitFor();
    await waitStates(reopened, ["current", "current", "current"]);
    assert.deepEqual(blocked, []);
    await reader.close();
  }

  // ---- chart commands, undo/redo and structural moves ----
  {
    const { context, page, requests, errors } = await open(
      await buildWorkbook(salesWorkbook()),
      { name: "charts-sales.html" },
    );
    assert.equal(await page.locator(".data-chart").count(), 0);
    await select(page, "A1", "C4");
    await menu(page, "Insert", "Chart…");
    await panel(page)
      .getByLabel("Title", { exact: true })
      .fill("Sales by region");
    await panel(page).getByLabel("Title", { exact: true }).press("Tab");
    await panel(page).getByLabel("Unit", { exact: true }).fill("kEUR");
    await panel(page).getByLabel("Unit", { exact: true }).press("Tab");
    await panel(page).getByRole("button", { name: "Insert chart" }).click();
    await waitStatus(page, /Chart "Sales by region" inserted/);
    await waitStates(page, ["live"]);
    assert.ok(requests.includes(ECHARTS_URL));
    const chart = page.locator('[data-chart="chart1"]');
    assert.equal(
      await chart.locator(".data-chart-title").textContent(),
      "Sales by region",
    );
    assert.equal(
      await panel(page).getByLabel("Top-left cell").inputValue(),
      "E1",
    );
    // Settings: the panel edits the selected chart.
    await panel(page).getByLabel("Chart type").selectOption("hbar");
    await panel(page).getByLabel("Width (160–2000 px)").fill("480");
    await panel(page).getByLabel("Width (160–2000 px)").press("Tab");
    await panel(page).getByRole("button", { name: "Update chart" }).click();
    await waitStatus(page, /updated/);
    // The live drawing follows the new size: 480 px less the 8 px padding.
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-chart="chart1"] .data-chart-plot.live svg')
          ?.getAttribute("width") === "464",
    );
    // Duplicate, then delete the copy from the keyboard.
    await menu(page, "Edit", "Duplicate chart");
    await waitStatus(page, /duplicated/);
    assert.equal(await page.locator(".data-chart").count(), 2);
    await page.locator('[data-chart="chart2"]').focus();
    await page.keyboard.press("Delete");
    await waitStatus(page, /deleted/);
    assert.equal(await page.locator(".data-chart").count(), 1);
    // Undo restores the copy; redo deletes it again.
    await page.locator("#grid").focus();
    await page.keyboard.press("ControlOrMeta+z");
    await page.waitForFunction(
      () => document.querySelectorAll(".data-chart").length === 2,
    );
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await page.waitForFunction(
      () => document.querySelectorAll(".data-chart").length === 1,
    );

    // Inserting a row above moves the chart and its data range.
    await page.locator('#grid [data-cell="A1"]').click();
    await menu(page, "Insert", "Insert rows");
    await waitStatus(page, /references updated/);
    await chart.click();
    await menu(page, "Format", "Chart settings…");
    assert.equal(
      await panel(page)
        .getByLabel("Data range (header row first)")
        .inputValue(),
      "A2:C5",
    );
    assert.equal(
      await panel(page).getByLabel("Top-left cell").inputValue(),
      "E2",
    );
    // A settings draft being edited takes a structural move of the fields
    // it did not edit.
    await panel(page).getByLabel("Title", { exact: true }).fill("Moved sales");
    await panel(page).getByLabel("Title", { exact: true }).press("Tab");
    await page.locator('#grid [data-cell="A1"]').click();
    await menu(page, "Insert", "Insert rows");
    await waitStatus(page, /references updated/);
    await panel(page).getByRole("button", { name: "Update chart" }).click();
    await waitStatus(page, /"Moved sales" updated/);
    assert.equal(
      await panel(page)
        .getByLabel("Data range (header row first)")
        .inputValue(),
      "A3:C6",
    );
    assert.equal(
      await panel(page).getByLabel("Top-left cell").inputValue(),
      "E3",
    );
    // Deleting its columns leaves a "#REF!" range: the chart says why.
    await select(page, "A1", "C1");
    await menu(page, "Edit", "Delete columns");
    await waitStatus(page, /references updated/);
    await waitStates(page, ["invalid"]);
    assert.match(
      await page.locator(".data-chart-msg").textContent(),
      /data range was deleted/,
    );
    await page.locator("#grid").focus();
    await page.keyboard.press("ControlOrMeta+z");
    await waitStates(page, ["live"]);
    const saved = await saveCopy(page, "charts-sales-saved.html");
    assert.deepEqual(saved.book.charts[0].source, {
      sheetId: "data",
      ref: "A3:C6",
    });
    assert.equal(saved.book.charts[0].type, "hbar");
    await assertPreviewsCurrent(saved);
    assert.deepEqual(errors, []);
    await context.close();
  }

  // ---- a tampered library is refused; previews stay, marked out of date ----
  {
    const { context, page, errors } = await open(await buildWorkbook(pnl()), {
      tampered: true,
      name: "charts-tampered.html",
    });
    await selectSheet(page, "Inputs");
    await enter(page, "B3", "31");
    await selectSheet(page, "Summary");
    await waitStatus(page, /Chart library unavailable/);
    await waitStates(page, ["stale", "stale", "stale"]);
    assert.equal(await liveCount(page), 0);
    assert.match(
      await page.locator(".data-chart-badge").first().textContent(),
      /Preview out of date\. Chart library unavailable\./,
    );
    assert.deepEqual(
      errors.filter((e) => !/integrity/i.test(e)),
      [],
    );
    await context.close();
  }

  // ---- stale and missing previews in a file ----
  {
    const html = await buildWorkbook(pnl()),
      read = readHTML(html);
    read.book.charts[0].width = 640; // The saved drawing no longer matches.
    const stale = replaceHTML(html, read, read.book);
    const { context, page, requests } = await open(stale, {
      name: "charts-stale.html",
    });
    await waitStates(page, ["stale", "current", "current"]);
    assert.deepEqual(requests, []);
    await page
      .locator('[data-chart="revenueTrend"]')
      .getByRole("button", { name: "Redraw" })
      .click();
    await waitStatus(page, /Chart library loaded/);
    await page.waitForFunction(() =>
      document.querySelector(
        '[data-chart="revenueTrend"] .data-chart-plot.live',
      ),
    );
    await context.close();
    const none = await open(
      await buildWorkbook(withChart(), { previews: false }),
      {
        name: "charts-none.html",
      },
    );
    await waitStates(none.page, ["missing"]);
    assert.match(
      await none.page.locator(".data-chart-badge").textContent(),
      /No saved preview\./,
    );
    assert.deepEqual(none.requests, []);
    await none.context.close();
  }

  // ---- offline build: charts draw and edit with no request ----
  {
    const { context, page, requests, errors } = await open(
      await buildWorkbook(pnl(), { offline: true }),
      { name: "charts-offline.html" },
    );
    await page.waitForFunction(
      () => document.querySelectorAll(".data-chart-plot.live").length >= 2,
    );
    await selectSheet(page, "Inputs");
    await enter(page, "B4", "9");
    await selectSheet(page, "Summary");
    await select(page, "A1", "B4");
    await menu(page, "Insert", "Chart…");
    await panel(page).getByLabel("Unit", { exact: true }).fill("EUR");
    await panel(page).getByLabel("Unit", { exact: true }).press("Tab");
    await panel(page).getByRole("button", { name: "Insert chart" }).click();
    await waitStatus(page, /inserted/);
    assert.deepEqual(requests, [], "offline edits make no request");
    assert.deepEqual(errors, []);
    await context.close();
  }

  // ---- many charts: instances only for charts scrolled into view ----
  {
    const { context, page } = await open(
      await buildWorkbook(manyCharts(), { offline: true }),
      { name: "charts-many.html" },
    );
    await page.waitForFunction(
      () => document.querySelectorAll(".data-chart-plot.live").length > 0,
    );
    const first = await liveCount(page);
    assert.ok(first >= 2 && first <= 6, `live at open: ${first}`);
    assert.equal(await page.locator(".data-chart").count(), 40);
    await page.locator("#grid").evaluate((g) => (g.scrollTop = 4000));
    await page.waitForFunction(
      (n) => document.querySelectorAll(".data-chart-plot.live").length > n,
      first,
    );
    const after = await liveCount(page);
    assert.ok(after < 20, `live after one scroll: ${after}`);
    await context.close();
  }
  console.log("Chart browser tests passed.");
} finally {
  await browser.close();
}

function withChart() {
  const book = salesWorkbook();
  book.charts = [
    {
      id: "sales",
      sheetId: "data",
      anchor: "F2",
      width: 400,
      height: 240,
      type: "column",
      options: { title: "Sales", unit: "kEUR" },
      source: { sheetId: "data", ref: "A1:C4" },
    },
  ];
  return book;
}
