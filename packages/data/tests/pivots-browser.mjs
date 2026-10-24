// Pivot tables end to end (T17, ADR-013): panel, refresh through the engine,
// ownership, scenario and source staleness, structural moves, undo/redo,
// save/reopen without the engine, delete and create from a selection.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { pivotWorkbook } from "../fixtures/pivots.mjs";
import { readHTML } from "../bench/storage/html.mjs";
import { command, openMenu, menuItem, currentSheet } from "./shell.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const text = async (page, ref) =>
  (await page.locator(`#grid [data-cell="${ref}"]`).textContent()).trim();
async function cells(page, refs) {
  const values = {};
  for (const ref of refs) values[ref] = await text(page, ref);
  return values;
}
const panel = (page) => page.locator("#shell-drawer");
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
async function state(page, expected) {
  await panel(page).locator(`.pv-state[data-state="${expected}"]`).waitFor();
}
async function selectSheet(page, name) {
  await page
    .locator("#sheet-tabs")
    .getByRole("button", { name, exact: true })
    .click();
}
async function enter(page, ref, type, value) {
  await page.locator("#cell-address").fill(ref);
  await page.locator("#cell-address").press("Enter");
  await page.locator("#cell-type").selectOption(type);
  await page.locator("#cell-value").fill(value);
  await page.locator("#cell-value").press("Enter");
}
try {
  const file = resolve(out, "pivots.html");
  await writeFile(file, await buildWorkbook(pivotWorkbook()));
  const context = await browser.newContext({ acceptDownloads: true }),
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
  await page.getByText("Saved results are current.", { exact: true }).waitFor();

  // The panel opens without the engine; the fixture's pivot was never refreshed.
  await openMenu(page, "Data");
  await menuItem(page, "Data", "Pivot tables…").click();
  await state(page, "never");
  assert.deepEqual(requests, []);
  await panel(page)
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
  await waitStatus(page, /refreshed from 8 records/);
  assert.equal(requests.length, 2);
  await state(page, "current");
  assert.equal(await currentSheet(page), "Summary");
  assert.deepEqual(
    await cells(page, [
      "B3",
      "C3",
      "D3",
      "E3",
      "B4",
      "C4",
      "B5",
      "C5",
      "E6",
      "B8",
      "D8",
      "B9",
      "E9",
    ]),
    {
      B3: "Quarter",
      C3: "Q1",
      D3: "Q2",
      E3: "Total",
      B4: "Region",
      C4: "Sum of Adjusted",
      B5: "East",
      C5: "€30.00",
      E6: "€230.00",
      B8: "(blank)",
      D8: "€10.00",
      B9: "Total",
      E9: "€390.50",
    },
  );
  assert.equal(await text(page, "C8"), "");

  // Owned cells refuse ordinary edits; formatting still applies.
  await enter(page, "C5", "number", "1");
  await waitStatus(page, /C5 belongs to pivot table "Revenue by region"/);
  assert.equal(await text(page, "C5"), "€30.00");
  await page.locator("#cell-address").fill("C5");
  await page.locator("#cell-address").press("Enter");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await waitStatus(page, /Formatting changed/);

  // A scenario switch changes the formula source: stale until refreshed.
  await page
    .getByLabel("Scenario", { exact: true })
    .selectOption({ label: "Upside" });
  await waitStatus(page, /Calculated locally/);
  await state(page, "stale");
  await page.locator('#grid [data-cell="E9"].pivot-stale').waitFor();
  assert.equal(await text(page, "E9"), "€390.50");
  await panel(page)
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
  await waitStatus(page, /refreshed from 8 records/);
  await state(page, "current");
  assert.equal(await text(page, "E9"), "€429.55");
  // Direct formatting on an owned cell survives the refresh.
  assert.equal(
    await page
      .locator('#grid [data-cell="C5"]')
      .evaluate((el) => getComputedStyle(el).fontWeight),
    "700",
  );

  // Undo restores the previous output and stamp; redo reapplies it.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await waitStatus(page, /Undo restored/);
  await page.waitForFunction(() =>
    document
      .querySelector('#grid [data-cell="E9"]')
      ?.textContent.includes("390.50"),
  );
  await state(page, "stale");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('#grid [data-cell="E9"]')
      ?.textContent.includes("429.55"),
  );
  await state(page, "current");

  // Editing the definition: keep Online records only, then update.
  await panel(page)
    .getByRole("button", { name: "Add filter", exact: true })
    .click();
  await panel(page)
    .getByLabel("Filter field 1", { exact: true })
    .selectOption("Channel");
  await panel(page)
    .getByRole("checkbox", { name: "Store", exact: true })
    .uncheck();
  await panel(page)
    .getByRole("button", { name: "Update pivot table", exact: true })
    .click();
  await waitStatus(page, /refreshed from 5 records/);
  // Online: North 100+80, South 40+20.5, (blank) 10 at ×1.1.
  assert.deepEqual(await cells(page, ["B5", "B7", "B8"]), {
    B5: "North",
    B7: "(blank)",
    B8: "Total",
  });
  assert.equal(await text(page, "B9"), "");

  // A source edit marks the pivot stale; refresh follows it.
  await selectSheet(page, "Sales");
  await enter(page, "E2", "number", "200");
  await waitStatus(page, /Calculated locally/);
  await state(page, "stale");
  await panel(page)
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
  await waitStatus(page, /refreshed from 5 records/);
  await state(page, "current");

  // A refresh with unchanged cells is still one undoable calculation.
  await panel(page)
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
  await waitStatus(page, /refreshed from 5 records/);
  assert.equal(await page.locator("#calc-state").textContent(), "Calculated");

  // Structural edits move the output whole and refuse splits. An open draft
  // with an unapplied rename follows the move instead of reverting it.
  await panel(page).getByLabel("Name", { exact: true }).fill("Online revenue");
  await panel(page).getByLabel("Name", { exact: true }).press("Tab");
  await selectSheet(page, "Summary");
  await page.locator("#cell-address").fill("A2");
  await page.locator("#cell-address").press("Enter");
  await command(page, "Insert rows");
  await waitStatus(page, /references updated/);
  await state(page, "current");
  assert.equal(await text(page, "B4"), "Quarter");
  assert.equal(
    await panel(page)
      .getByLabel("Output top-left cell", { exact: true })
      .inputValue(),
    "B4",
  );
  await panel(page)
    .getByRole("button", { name: "Update pivot table", exact: true })
    .click();
  await waitStatus(page, /"Online revenue" refreshed from 5 records/);
  assert.equal(await text(page, "B4"), "Quarter");
  assert.equal(await text(page, "B3"), "");
  await page.locator("#cell-address").fill("B6");
  await page.locator("#cell-address").press("Enter");
  await command(page, "Delete rows");
  await waitStatus(page, /would remove part of pivot "Online revenue"/);

  // A wider definition that would cover data elsewhere is refused unchanged.
  await enter(page, "G6", "text", "keep me");
  await waitStatus(page, /Calculated locally/);
  await panel(page)
    .getByRole("button", { name: "Add column field", exact: true })
    .click();
  await panel(page)
    .getByLabel("Column field 2", { exact: true })
    .selectOption("Units");
  await panel(page)
    .getByRole("button", { name: "Update pivot table", exact: true })
    .click();
  await waitStatus(page, /G6 already hold data/);
  assert.equal(await text(page, "G6"), "keep me");
  assert.equal(await text(page, "B4"), "Quarter");

  // Save a copy and reopen offline: values show without the engine.
  const download = page.waitForEvent("download");
  await command(page, "Save a copy");
  const saved = resolve(out, "pivots-saved.html");
  await (await download).saveAs(saved);
  const html = await readFile(saved, "utf8"),
    book = readHTML(html).book;
  assert.equal(book.pivots[0].output.ref, "B4:E9");
  assert.deepEqual(book.pivots[0].filters[0].field, "Channel");
  assert.match(book.pivots[0].refreshed.fingerprint, /^[a-f0-9]{64}$/);
  // Online records at Upside: (200 + 80) + (40 + 20.5) + 10, each × 1.1.
  assert.equal(
    book.sheets.find((s) => s.id === "summary").cells.E9.input.value,
    [200, 80, 40, 20.5, 10].reduce((sum, v) => sum + v * 1.1, 0),
  );
  const reader = await browser.newContext(),
    reopened = await reader.newPage(),
    readerRequests = [];
  await reader.route(/^https?:\/\//, (route) => {
    readerRequests.push(route.request().url());
    return route.abort();
  });
  await reopened.goto(pathToFileURL(saved).href);
  await reopened
    .getByText("Saved results are current.", { exact: true })
    .waitFor();
  await openMenu(reopened, "Data");
  await menuItem(reopened, "Data", "Pivot tables…").click();
  await state(reopened, "current");
  assert.equal(await text(reopened, "B4"), "Quarter");
  assert.deepEqual(readerRequests, []);
  await reader.close();

  // Delete removes the values (keeping direct formatting); undo restores.
  await panel(page)
    .getByRole("button", { name: "Delete pivot table", exact: true })
    .click();
  await waitStatus(page, /deleted/);
  assert.equal(await text(page, "B4"), "");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('#grid [data-cell="B4"]')
      ?.textContent.includes("Quarter"),
  );

  // Insert › Pivot table from a selection proposes rows and a sum.
  await selectSheet(page, "Sales");
  await page.locator("#cell-address").fill("A1:E9");
  await page.locator("#cell-address").press("Enter");
  await openMenu(page, "Insert");
  await menuItem(page, "Insert", "Pivot table…").click();
  await state(page, "new");
  assert.equal(
    await panel(page).getByLabel("Row field 1", { exact: true }).inputValue(),
    "Region",
  );
  assert.equal(
    await panel(page).getByLabel("Value field 1", { exact: true }).inputValue(),
    "Units",
  );
  await panel(page)
    .getByRole("button", { name: "Create pivot table", exact: true })
    .click();
  await waitStatus(
    page,
    /Pivot table "Pivot table 1" refreshed from 8 records/,
  );
  assert.deepEqual(await cells(page, ["G1", "H1", "G2", "H6"]), {
    G1: "Region",
    H1: "Sum of Units",
    G2: "East",
    H6: "39",
  });
  // A dirty draft's edited source moves with a column insertion too.
  await panel(page)
    .getByLabel("Source range (header row first)", { exact: true })
    .fill("A1:E10");
  await panel(page)
    .getByLabel("Source range (header row first)", { exact: true })
    .press("Tab");
  await page.locator("#cell-address").fill("A1");
  await page.locator("#cell-address").press("Enter");
  await command(page, "Insert columns");
  await waitStatus(page, /references updated/);
  assert.equal(
    await panel(page)
      .getByLabel("Source range (header row first)", { exact: true })
      .inputValue(),
    "B1:F10",
  );
  assert.equal(
    await panel(page)
      .getByLabel("Output top-left cell", { exact: true })
      .inputValue(),
    "H1",
  );
  // Undoing a deletion restores the draft's own bounds; an invalid draft
  // reference never blocks a structural edit.
  await page.locator("#cell-address").fill("A10");
  await page.locator("#cell-address").press("Enter");
  await command(page, "Delete rows");
  await waitStatus(page, /references updated/);
  const sourceField = panel(page).getByLabel(
    "Source range (header row first)",
    { exact: true },
  );
  assert.equal(await sourceField.inputValue(), "B1:F9");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await waitStatus(page, /Undo restored/);
  assert.equal(await sourceField.inputValue(), "B1:F10");
  await sourceField.fill("NOPE");
  await sourceField.press("Tab");
  await page.locator("#cell-address").fill("A12");
  await page.locator("#cell-address").press("Enter");
  await command(page, "Insert rows");
  await waitStatus(page, /references updated/);
  assert.equal(await sourceField.inputValue(), "NOPE");

  // Filter items follow source changes while the panel is open.
  await panel(page)
    .getByLabel("Pivot table", { exact: true })
    .selectOption("byRegion");
  await panel(page)
    .getByRole("checkbox", { name: "Online", exact: true })
    .waitFor();
  await enter(page, "D9", "text", "Partner");
  await waitStatus(page, /Calculated locally/);
  await panel(page)
    .getByRole("checkbox", { name: "Partner", exact: true })
    .waitFor();
  // Text typed while a refresh runs survives the panel's rebuild.
  await panel(page)
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
  await panel(page).getByLabel("Name", { exact: true }).fill("Typing");
  await waitStatus(page, /refreshed from/);
  await page.waitForTimeout(300);
  assert.equal(
    await panel(page).getByLabel("Name", { exact: true }).inputValue(),
    "Typing",
  );
  assert.deepEqual(errors, []);
  await context.close();

  // A file without saved results: the source is unverified until refresh
  // recalculates it, and the published results become current.
  const bare = resolve(out, "pivots-uncalculated.html");
  await writeFile(
    bare,
    await buildWorkbook(pivotWorkbook(), { calculate: false }),
  );
  const fresh = await browser.newContext(),
    blank = await fresh.newPage();
  await fresh.route(/^https?:\/\//, async (route) =>
    route.fulfill({
      body: await readFile(
        new URL(
          `../engine/vendor/${route.request().url().endsWith(".wasm.gz") ? "ironcalc.wasm.gz" : "ironcalc.mjs"}`,
          import.meta.url,
        ),
      ),
    }),
  );
  await blank.goto(pathToFileURL(bare).href);
  await blank.getByText(/Saved results are stale or missing/).waitFor();
  await openMenu(blank, "Data");
  await menuItem(blank, "Data", "Pivot tables…").click();
  await state(blank, "never");
  await panel(blank)
    .getByRole("button", { name: "Add filter", exact: true })
    .click();
  await panel(blank)
    .getByLabel("Filter field 1", { exact: true })
    .selectOption("Adjusted");
  await panel(blank)
    .getByText(/Filter 1 needs current results/)
    .waitFor();
  assert.equal(
    await panel(blank)
      .getByRole("button", { name: "Update pivot table", exact: true })
      .isDisabled(),
    true,
  );
  // Recalculating verifies the results: the filter lists its items again.
  await command(blank, "Recalculate");
  await waitStatus(blank, /Calculated locally/);
  await panel(blank)
    .getByRole("group", { name: "Items kept by filter 1", exact: true })
    .waitFor();
  assert.equal(
    await panel(blank)
      .getByRole("button", { name: "Update pivot table", exact: true })
      .isDisabled(),
    false,
  );
  await panel(blank)
    .getByRole("button", { name: "Remove filter 1", exact: true })
    .click();
  await panel(blank)
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
  await waitStatus(blank, /refreshed from 8 records/);
  await state(blank, "current");
  assert.equal(await blank.locator("#calc-state").textContent(), "Calculated");
  assert.equal(await text(blank, "E9"), "€390.50");
  await fresh.close();
  console.log("Pivot browser tests passed");
} finally {
  await browser.close();
}
