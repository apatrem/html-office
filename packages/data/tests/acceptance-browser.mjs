// T21: the fictional P&L acceptance workbook, end to end in Chromium.
// It is regenerated through the freshly packaged html-data skill
// (acceptance/generate.mjs: tools, then the person's CSV import in the
// browser; the files are generated, not committed) and must match
// independently known totals, with CSV and PDF samples. A person then edits the scenario and an assumption, extends the
// forecast, refreshes the imported source from a second CSV and the pivot,
// undoes and redoes, saves a copy and reopens it; every step is checked
// against the expected workbook, and what the grid shows against the saved
// results. Offline file without any network request; the standard file is
// read with the network blocked.
import assert from "node:assert/strict";
import { readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { readHTML } from "../bench/storage/html.mjs";
import { display } from "../runtime/view.mjs";
import { parseCSV } from "./csv-parse.mjs";
import { command, openMenu, menuItem } from "./shell.mjs";
import {
  freshSkill,
  generate,
  openWorkbook,
  pickCSV,
  tab,
} from "../acceptance/generate.mjs";
import {
  differences,
  expected,
  readRecords,
  FUNCTIONS,
} from "./acceptance-expected.mjs";

const acceptance = fileURLToPath(new URL("../acceptance/", import.meta.url)),
  out = resolve("dist/data-test/acceptance");
const v1 = readRecords(
    await readFile(join(acceptance, "sources/rentals-2025.csv"), "utf8"),
  ),
  v2 = readRecords(
    await readFile(join(acceptance, "sources/rentals-2025-v2.csv"), "utf8"),
  );
const bookOf = async (file) => readHTML(await readFile(file, "utf8")).book;
const assertExpected = (book, state, months) =>
  assert.deepEqual(differences(book, state, { months }), []);

// The authored and imported content, without timestamps and caches that
// depend on the run (calculation time, import time, chart drawings).
function content(book) {
  const b = structuredClone(book);
  delete b.snapshot;
  for (const chart of b.charts) delete chart.preview;
  for (const pivot of b.pivots) delete pivot.refreshed.at;
  for (const source of b.sources) {
    delete source.importedAt;
    delete source.file.modified;
  }
  return b;
}

async function waitStatus(page, pattern, timeout = 60000) {
  try {
    await page.waitForFunction(
      (source) =>
        new RegExp(source).test(document.getElementById("status").textContent),
      pattern.source,
      { timeout },
    );
  } catch (error) {
    console.error(`Status: ${await page.locator("#status").textContent()}`);
    throw error;
  }
}
const calculated = (page) => waitStatus(page, /^Calculated locally/);

// What the grid shows equals the saved result in the workbook locale.
async function rendered(page, book, sheetName, refs) {
  await tab(page, sheetName).click();
  const sheet = book.sheets.find((s) => s.name === sheetName);
  for (const ref of refs) {
    // The grid draws the columns in view: go to the cell first.
    await page.getByLabel("Cell address").fill(ref);
    await page.keyboard.press("Tab");
    assert.equal(
      (await page.locator(`#grid [data-cell="${ref}"]`).textContent()).trim(),
      display(sheet.cells[ref], book.locale),
      `${sheetName}!${ref}`,
    );
  }
}
const SUMMARY = [
  "B4",
  "B7",
  "C8",
  "D9",
  "E10",
  "D11",
  "B13",
  "B14",
  "B15",
  "B16",
];

let saved = 0;
async function saveCopy(page) {
  const download = page.waitForEvent("download"),
    file = join(out, `saved-${++saved}.html`);
  await command(page, "Save a copy");
  await (await download).saveAs(file);
  return file;
}
async function enter(page, ref, value) {
  await page.locator("#cell-address").fill(ref);
  await page.locator("#cell-address").press("Enter");
  await page.locator("#cell-type").selectOption("number");
  await page.locator("#cell-value").fill(value);
  await page.locator("#cell-value").press("Enter");
}
async function fillRight(page, from, down) {
  await page.getByLabel("Cell address").fill(from);
  await page.keyboard.press("Tab");
  await page.locator("#grid").focus();
  await page.keyboard.press("Shift+ArrowRight");
  for (let i = 0; i < down; i++) await page.keyboard.press("Shift+ArrowDown");
  await command(page, "Fill right");
  await calculated(page);
}
async function history(page, key, word) {
  await page.locator("#grid").focus();
  await page.keyboard.press(key);
  await waitStatus(page, new RegExp(`^${word} restored the previous workbook`));
}

await rm(out, { recursive: true, force: true });
const { dir, skill } = await freshSkill(),
  browser = await chromium.launch();
try {
  // ---- generated through the skill = known totals ----
  const result = await generate({ out, browser, skill });
  const regenerated = await bookOf(result.offline);
  assert.deepEqual(
    content(await bookOf(result.standard)),
    content(regenerated),
  );
  assertExpected(regenerated, expected(v1), 24);
  assert.equal(regenerated.metadata.fictional, true);
  assert.equal(regenerated.sources[0].file.name, "rentals-2025.csv");
  // Every function of the formula contract has its row in the analysis.
  const analysis = regenerated.sheets.find(
    (s) => s.name === "Formula analysis",
  );
  const functions = new Set(
    Object.entries(analysis.cells)
      .filter(([ref, c]) => /^B\d+$/.test(ref) && c.input?.type === "text")
      .map(([, c]) => c.input.value),
  );
  assert.deepEqual(
    FUNCTIONS.filter((f) => !functions.has(f)),
    [],
    "functions without an analysis row",
  );
  // The CSV sample holds the P&L's saved results at full precision.
  const csv = parseCSV(await readFile(result.csv, "utf8")),
    pnl = regenerated.sheets.find((s) => s.name === "P&L");
  assert.equal(csv[5][0], "Revenue");
  assert.deepEqual(
    csv[5].slice(1).map(Number),
    Array.from(
      { length: 24 },
      (_, m) => pnl.cells[`${String.fromCharCode(66 + m)}6`].result.value,
    ),
  );
  // Each sheet prints on three pages (Summary: table and charts; P&L:
  // three pages across).
  for (const pdf of result.pdfs) {
    const bytes = await readFile(pdf);
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    assert.equal(
      bytes.toString("latin1").match(/\/Type\s*\/Page\b/g).length,
      3,
    );
  }
  // No path of this machine in the generated files; no address or link in
  // the workbook (chart previews are SVG, whose xmlns is a URL).
  for (const name of await readdir(out)) {
    const text = (await readFile(join(out, name))).toString("latin1");
    for (const pattern of [
      /\/Users\//,
      /\/home\/(?!runner\b)[a-z]/,
      /\/private\/tmp|\/var\/folders/,
      /[A-Z]:\\\\Users/,
      /fakepath/i,
    ])
      assert.ok(!pattern.test(text), `${name}: ${pattern}`);
  }
  const authored = structuredClone(regenerated);
  for (const chart of authored.charts) delete chart.preview;
  for (const pattern of [/@[a-z0-9-]+\.[a-z]{2,}/i, /https?:\/\//])
    assert.ok(!pattern.test(JSON.stringify(authored)), `workbook: ${pattern}`);

  const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1280, height: 800 },
    }),
    requests = [];
  await context.route(/^https?:\/\//, (route) => {
    requests.push(route.request().url());
    return route.abort();
  });

  // ---- the standard file reads without any request ----
  {
    const page = await openWorkbook(context, result.standard);
    await rendered(page, regenerated, "Summary", SUMMARY);
    assert.equal(await page.locator(".data-chart").count(), 3);
    assert.deepEqual(page.errors, []);
    await page.close();
  }

  // ---- a person's session on the offline file ----
  const page = await openWorkbook(context, result.offline);
  await rendered(page, regenerated, "Summary", SUMMARY);
  await rendered(page, regenerated, "Stations", ["A6", "B7", "D10"]);
  await rendered(page, regenerated, "P&L", ["B2", "M4", "N5", "Y14", "Y15"]);
  // Data bars on net income, negative margins highlighted.
  await page.getByLabel("Cell address").fill("B14");
  await page.keyboard.press("Tab");
  await page.locator('#grid [data-cell="B14"] .data-bar-fill').waitFor();
  // The negative margin is highlighted in bold.
  await page.waitForFunction(() => {
    const cell = document.querySelector('#grid [data-cell="B15"]');
    return cell && getComputedStyle(cell).fontWeight === "700";
  });

  // Scenario High, then its growth lowered to 12%.
  let state = { scenario: "High" };
  await page
    .getByLabel("Scenario", { exact: true })
    .selectOption({ label: "High" });
  await calculated(page);
  assertExpected(await bookOf(await saveCopy(page)), expected(v1, state), 24);
  await tab(page, "Assumptions").click();
  await enter(page, "D6", "0.12");
  await calculated(page);
  state = { scenario: "High", growth: { High: 0.12 } };

  // Extend the forecast by one month: fill right on the P&L and cash flow.
  await tab(page, "P&L").click();
  await fillRight(page, "Y2", 13);
  await tab(page, "Cash flow").click();
  await fillRight(page, "Y2", 6);
  let book = await bookOf(await saveCopy(page));
  assertExpected(book, expected(v1, state, 25), 25);
  assert.equal(
    book.sheets.find((s) => s.name === "P&L").cells.Z4.formula,
    "=N4*(1+Assumptions!$B$9)",
  );
  await rendered(page, book, "P&L", ["Z2", "Z3", "Z4", "Z14"]);

  // Refresh the imported source from the second CSV, then the pivot.
  await tab(page, "Rentals").click();
  await pickCSV(page, "rentals-2025-v2.csv", "Refresh source");
  await page.locator("#refresh-columns table").waitFor();
  assert.match(
    await page.locator("#refresh-summary").textContent(),
    /Rows: 97 → 103\./,
  );
  // Direct dependents only: the P&L and Summary follow through them.
  const impact = await page.locator("#refresh-impact").textContent();
  assert.match(impact, /12 formulas on Monthly actuals will recalculate/);
  assert.match(impact, /1 pivot table reads this sheet/);
  await page.locator("#refresh-apply").click();
  await waitStatus(page, /^Refreshed "Rentals" from rentals-2025-v2\.csv/);
  await openMenu(page, "Data");
  await menuItem(page, "Data", "Refresh all pivot tables").click();
  await waitStatus(
    page,
    /^Pivot table "Rentals by station and plan" refreshed/,
  );
  book = await bookOf(await saveCopy(page));
  assertExpected(book, expected(v2, state, 25), 25);
  assert.equal(book.sources[0].file.name, "rentals-2025-v2.csv");

  // Undo both steps, then redo them.
  await history(page, "ControlOrMeta+z", "Undo");
  await history(page, "ControlOrMeta+z", "Undo");
  assertExpected(
    await bookOf(await saveCopy(page)),
    expected(v1, state, 25),
    25,
  );
  await history(page, "ControlOrMeta+Shift+z", "Redo");
  await history(page, "ControlOrMeta+Shift+z", "Redo");
  const final = await saveCopy(page);
  book = await bookOf(final);
  assertExpected(book, expected(v2, state, 25), 25);
  assert.deepEqual(page.errors, []);
  await page.close();

  // Reopened: current results, the same values on screen.
  const reopened = await openWorkbook(context, final);
  await rendered(reopened, book, "Summary", SUMMARY);
  await rendered(reopened, book, "Stations", ["A6", "A7", "B11", "D11"]);
  await rendered(reopened, book, "P&L", ["Z4", "Z14"]);
  // The new station is a row of the refreshed pivot table.
  assert.equal(
    book.sheets.find((s) => s.name === "Stations").cells.A7.input.value,
    "Harbour",
  );
  assert.deepEqual(reopened.errors, []);
  assert.deepEqual(requests, [], "no network request");
  await context.close();
  console.log(
    "PASS T21 acceptance workbook: regenerated, edited, refreshed, saved",
  );
} finally {
  await browser.close();
  await rm(dir, { recursive: true, force: true });
}
