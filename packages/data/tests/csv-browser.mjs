// T19 Export sheet as CSV: File menu → dialog → download, read back with an
// independent RFC 4180 parser. Current results export without the engine and
// without network; stale or missing results need an explicit choice
// (Export saved values, or Recalculate and export) in an offline build.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { openMenu, menuItem } from "./shell.mjs";
import { parseCSV } from "./csv-parse.mjs";
import { pivotWorkbook } from "../fixtures/pivots.mjs";

const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
function workbook(locale) {
  const book = JSON.parse(fixture);
  book.locale = locale;
  Object.assign(book.sheets[1].cells, {
    A5: { input: { type: "text", value: '=HYPERLINK("https://x.test","y")' } },
    A6: { input: { type: "text", value: 'He said "hi", then; left' } },
    B4: {
      formula: "=B2/3",
      format: { kind: "number", digits: 2 },
    },
    C2: { input: { type: "number", value: 45000 }, format: { kind: "date" } },
  });
  return book;
}
const fixture = await readFile(
  new URL("../fixtures/two-sheets.json", import.meta.url),
  "utf8",
);
const files = {
  en: resolve(out, "csv-en.html"),
  fr: resolve(out, "csv-fr.html"),
  stale: resolve(out, "csv-stale-offline.html"),
  pivots: resolve(out, "csv-pivots-offline.html"),
};
await writeFile(
  files.pivots,
  await buildWorkbook(pivotWorkbook(), { offline: true }),
);
await writeFile(files.en, await buildWorkbook(workbook("en-US")));
await writeFile(files.fr, await buildWorkbook(workbook("fr-FR")));
// Not recalculated: B2 keeps an out-of-date saved result and B4 has none.
const stale = workbook("en-US");
stale.sheets[1].cells.B2.result.value = 999;
await writeFile(
  files.stale,
  await buildWorkbook(stale, { offline: true, calculate: false }),
);

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ acceptDownloads: true }),
    requests = [],
    errors = [];
  await context.route(/^https?:\/\//, (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  async function open(file, ready) {
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(file).href);
    await page.getByText(ready, { exact: true }).waitFor();
    await page.getByRole("button", { name: "Summary", exact: true }).click();
    return page;
  }
  async function exportCSV(page, button, setup) {
    await openMenu(page, "File");
    await menuItem(page, "File", "Export sheet as CSV…").click();
    const dialog = page.getByRole("dialog", { name: "Export sheet as CSV" });
    await dialog.waitFor();
    await setup?.(dialog);
    const wait = page.waitForEvent("download", { timeout: 60000 });
    await dialog.getByRole("button", { name: button, exact: true }).click();
    const download = await wait,
      path = resolve(out, download.suggestedFilename());
    await download.saveAs(path);
    return {
      name: download.suggestedFilename(),
      text: await readFile(path, "utf8"),
    };
  }

  // en-US: commas and decimal points; formula-like text neutralised.
  {
    const page = await open(files.en, "Saved results are current.");
    const { name, text } = await exportCSV(page, "Export CSV");
    assert.equal(name, "community-learning-Summary.csv");
    assert.ok(text.startsWith("﻿"));
    const rows = parseCSV(text, ",");
    assert.deepEqual(rows, [
      ["Monthly revenue", "", ""],
      ["", "2500", "2023-03-15"],
      ["Revenue per participant", "25", ""],
      ["", String(2500 / 3), ""],
      [`'=HYPERLINK("https://x.test","y")`, "", ""],
      ['He said "hi", then; left', "", ""],
    ]);
    assert.equal(Number(rows[3][1]), 2500 / 3);
    assert.doesNotMatch(text, /Inputs!B2|€|EUR/);
    await page
      .getByText(
        /^CSV download requested: Summary!A1:C6, 6 × 3; calculated values, comma-separated, decimal point, 1 formula-like text prefixed/,
      )
      .waitFor();
    // Displayed text: what the grid shows.
    const shown = parseCSV(
      (
        await exportCSV(page, "Export CSV", (dialog) =>
          dialog.getByLabel("Values").selectOption("display"),
        )
      ).text,
    );
    assert.deepEqual(shown[1], ["", "€2,500.00", "03/15/2023"]);
    assert.equal(shown[3][1], "833.33");
    await page.close();
  }

  // fr-FR: semicolons and decimal commas by default; commas on request.
  {
    const page = await open(files.fr, "Saved results are current.");
    const dialogText = async () => {
      await openMenu(page, "File");
      await menuItem(page, "File", "Export sheet as CSV…").click();
      const dialog = page.getByRole("dialog", { name: "Export sheet as CSV" });
      const label = await dialog
        .getByLabel("Separators")
        .locator("option:checked")
        .textContent();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      return label;
    };
    assert.equal(await dialogText(), "Semicolons, decimal comma (fr-FR)");
    const regional = parseCSV((await exportCSV(page, "Export CSV")).text, ";");
    assert.equal(regional[3][1], String(2500 / 3).replace(".", ","));
    assert.equal(regional[1][2], "2023-03-15");
    assert.equal(regional[5][0], 'He said "hi", then; left');
    const international = parseCSV(
      (
        await exportCSV(page, "Export CSV", (dialog) =>
          dialog.getByLabel("Separators").selectOption("comma"),
        )
      ).text,
      ",",
    );
    assert.equal(international[3][1], String(2500 / 3));
    await page.close();
  }

  // Missing results, offline: an explicit choice is required.
  {
    const page = await open(
      files.stale,
      "Saved results are stale or missing. Apply an edit to recalculate.",
    );
    await openMenu(page, "File");
    await menuItem(page, "File", "Export sheet as CSV…").click();
    const dialog = page.getByRole("dialog", { name: "Export sheet as CSV" });
    await dialog
      .getByRole("alert")
      .filter({ hasText: "1 formula has no result" })
      .waitFor();
    assert.equal(
      await dialog.getByRole("button", { name: "Export CSV" }).count(),
      0,
    );
    await dialog.getByRole("button", { name: "Cancel" }).click();
    const saved = await exportCSV(page, "Export saved values");
    assert.equal(saved.name, "community-learning-Summary-stale.csv");
    const rows = parseCSV(saved.text);
    assert.deepEqual(
      rows.slice(1, 4).map((row) => row[1]),
      ["999", "25", ""],
    );
    await page
      .getByText(
        /saved results not recalculated, 1 formula without a result left empty\.$/,
      )
      .waitFor();
    const fresh = await exportCSV(page, "Recalculate and export");
    assert.equal(fresh.name, "community-learning-Summary.csv");
    assert.deepEqual(
      parseCSV(fresh.text)
        .slice(1, 4)
        .map((row) => row[1]),
      ["2500", "25", String(2500 / 3)],
    );
    // Once current, the dialog offers a plain export.
    await openMenu(page, "File");
    await menuItem(page, "File", "Export sheet as CSV…").click();
    await page
      .getByRole("dialog", { name: "Export sheet as CSV" })
      .getByRole("button", { name: "Export CSV" })
      .waitFor();
    await page.keyboard.press("Escape");
    await page.close();
  }
  // A pivot table left out of date by a scenario switch needs the same
  // choice; recalculating refreshes it.
  {
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(files.pivots).href);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    // The fixture's pivot was never refreshed.
    await openMenu(page, "Data");
    await menuItem(page, "Data", "Refresh all pivot tables").click();
    await page.getByText(/refreshed from 8 records/).waitFor();
    assert.equal(
      parseCSV((await exportCSV(page, "Export CSV")).text)[8][4],
      "390.5",
    );
    await page
      .getByLabel("Scenario", { exact: true })
      .selectOption({ label: "Upside" });
    await page.getByText(/^Calculated locally/).waitFor();
    await openMenu(page, "File");
    await menuItem(page, "File", "Export sheet as CSV…").click();
    const dialog = page.getByRole("dialog", { name: "Export sheet as CSV" });
    await dialog
      .getByRole("alert")
      .filter({ hasText: "1 pivot table on this sheet is out of date" })
      .waitFor();
    assert.equal(
      await dialog.getByRole("button", { name: "Export CSV" }).count(),
      0,
    );
    await dialog.getByRole("button", { name: "Cancel" }).click();
    const total = (text) => Number(parseCSV(text)[8][4]);
    const saved = await exportCSV(page, "Export saved values");
    assert.equal(saved.name, "fictional-sales-pivots-Summary-stale.csv");
    assert.equal(total(saved.text), 390.5);
    const fresh = await exportCSV(page, "Recalculate and export");
    assert.equal(fresh.name, "fictional-sales-pivots-Summary.csv");
    assert.ok(Math.abs(total(fresh.text) - 429.55) < 1e-9);
    await page.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, [], "CSV export makes no network request");
  console.log("CSV export browser checks passed");
} finally {
  await browser.close();
}
