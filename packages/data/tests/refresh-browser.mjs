// Refresh an imported source (T16): the replacement file's changes and the
// dependent impact are shown first; missing and renamed columns need an
// explicit resolution; hand edits need a confirmation; one undoable step;
// saved without any link to the file. Offline build: no request at all.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { readHTML } from "../bench/storage/html.mjs";
import { command } from "./shell.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const book = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
book.sheets[1].cells.B5 = { formula: "=SUM(Ventes!C2:C10)" };
const browser = await chromium.launch();
const text = async (page, ref) =>
  (await page.locator(`#grid [data-cell="${ref}"]`).textContent()).trim();
async function waitStatus(page, pattern) {
  try {
    await page.waitForFunction(
      (source) =>
        new RegExp(source).test(document.getElementById("status").textContent),
      pattern.source,
      { timeout: 30000 },
    );
  } catch (error) {
    console.error(`Status: ${await page.locator("#status").textContent()}`);
    throw error;
  }
}
const tab = (page, name) =>
  page.locator("#sheet-tabs").getByRole("button", { name, exact: true });
async function enter(page, ref, type, value) {
  await page.locator("#cell-address").fill(ref);
  await page.locator("#cell-address").press("Enter");
  await page.locator("#cell-type").selectOption(type);
  await page.locator("#cell-value").fill(value);
  await page.locator("#cell-value").press("Enter");
}
async function pick(page, name, content, item) {
  const chooser = page.waitForEvent("filechooser");
  await command(page, item);
  await (
    await chooser
  ).setFiles({ name, mimeType: "text/csv", buffer: Buffer.from(content) });
}
const original =
  "Région;Code;Montant;Date\nNord;0012;1 234,5;28/10/2026\nSud;0345;7,5;01/02/2026\n";
const replacement =
  "Code;Région;Montant HT;TVA\n0012;Nord;1 300;260\n0345;Sud;10;2\n0678;Est;5,5;1,1\n";
try {
  const file = resolve(out, "refresh.html");
  await writeFile(file, await buildWorkbook(book, { offline: true }));
  const context = await browser.newContext({ acceptDownloads: true }),
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

  // Nothing to refresh before an import.
  await page
    .getByRole("menubar", { name: "Workbook menu" })
    .getByRole("menuitem", { name: "Data", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("menu", { name: "Data" })
      .getByRole("menuitem", { name: "Refresh source…" })
      .getAttribute("aria-disabled"),
    "true",
  );
  await page.keyboard.press("Escape");

  await pick(page, "ventes.csv", original, "Import CSV");
  await page.locator("#import-preview table").waitFor();
  await page.getByLabel("New sheet name").fill("Ventes");
  await page.locator("#import-apply").click();
  await waitStatus(page, /Imported ventes\.csv/);
  // A hand edit in Montant, which the refresh will replace.
  await enter(page, "C3", "number", "8");
  await waitStatus(page, /Calculated locally/);
  await tab(page, "Summary").click();
  assert.equal(await text(page, "B5"), "1242.5");
  // A sheet without a source says so.
  await command(page, "Refresh source");
  await waitStatus(page, /This sheet has no imported source/);
  await tab(page, "Ventes").click();

  // Cancel changes nothing.
  await pick(page, "ventes-v2.csv", replacement, "Refresh source");
  await page.locator("#refresh-columns table").waitFor();
  await page.locator("#refresh-cancel").click();
  await page.locator("dialog.imp-dialog").waitFor({ state: "detached" });
  assert.equal(await text(page, "C3"), "8");

  await pick(page, "ventes-v2.csv", replacement, "Refresh source");
  await page.locator("#refresh-columns table").waitFor();
  const alerts = page.locator("#refresh-alerts li"),
    apply = page.locator("#refresh-apply");
  assert.match(
    await page.locator("#refresh-summary").textContent(),
    /Rows: 3 → 4\./,
  );
  assert.deepEqual(
    (await alerts.allTextContents()).map((t) => t.slice(0, 26)),
    ['Column C "Montant" is not ', 'Column D "Date" is not in '],
  );
  assert.equal(await apply.isDisabled(), true);
  const impact = await page.locator("#refresh-impact").textContent();
  assert.match(impact, /1 formula on Summary will recalculate/);
  await page
    .getByLabel('Column C "Montant" in the new file')
    .selectOption({ label: 'Use "Montant HT"' });
  await page
    .getByLabel('Column D "Date" in the new file')
    .selectOption({ label: "Clear this column" });
  assert.equal(await alerts.count(), 0);
  // Montant was edited by hand: the refresh needs a confirmation.
  const confirm = page.locator("#refresh-confirm-label");
  assert.equal(await confirm.isVisible(), true);
  assert.match(await confirm.textContent(), /column C "Montant"/);
  assert.equal(await apply.isDisabled(), true);
  const rows = page.locator("#refresh-columns tbody tr");
  assert.deepEqual(
    await rows.evaluateAll((r) => r.map((x) => x.dataset.status)),
    ["matched", "matched", "renamed", "cleared", "added"],
  );
  assert.match(await rows.nth(2).textContent(), /C3: 8 → 10/);
  await page.locator("#refresh-confirm").check();
  await apply.click();
  await waitStatus(page, /Refreshed "Ventes" from ventes-v2\.csv: 4 rows, /);
  assert.equal(await text(page, "A4"), "Est");
  assert.equal(await text(page, "B4"), "0678");
  assert.equal(await text(page, "C1"), "Montant HT");
  assert.equal(await text(page, "C3"), "10");
  assert.equal(await text(page, "D1"), "");
  assert.equal(await text(page, "D2"), "");
  assert.equal(await text(page, "E1"), "TVA");
  assert.equal(await text(page, "E4"), "1.1");
  await tab(page, "Summary").click();
  assert.equal(await text(page, "B5"), "1315.5");

  // One undo restores the hand edit, the old columns and the formula.
  await page.locator("#grid").focus();
  await page.keyboard.press("ControlOrMeta+z");
  await waitStatus(page, /Undo restored the previous workbook/);
  await tab(page, "Summary").click();
  assert.equal(await text(page, "B5"), "1242.5");
  await tab(page, "Ventes").click();
  assert.equal(await text(page, "C3"), "8");
  assert.equal(await text(page, "D1"), "Date");
  assert.equal(await text(page, "E1"), "");
  await page.locator("#grid").focus();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await waitStatus(page, /Redo restored the previous workbook/);
  assert.equal(await text(page, "C3"), "10");

  // Saved: the source now describes the replacement file; no path, no link.
  const download = page.waitForEvent("download");
  await command(page, "Save a copy");
  const saved = resolve(out, "refresh-saved.html");
  await (await download).saveAs(saved);
  const savedBook = readHTML(await readFile(saved, "utf8")).book,
    source = savedBook.sources[0];
  assert.equal(source.ref, "A1:E4");
  assert.equal(source.file.name, "ventes-v2.csv");
  assert.deepEqual(
    source.columns.map((c) => c.name),
    ["Région", "Code", "Montant HT", "", "TVA"],
  );
  assert.doesNotMatch(JSON.stringify(source), /\/Users\/|fakepath/);

  // A refresh with the same file again finds nothing changed and no edits.
  await pick(page, "ventes-v2.csv", replacement, "Refresh source");
  await page.locator("#refresh-columns table").waitFor();
  assert.match(
    await page.locator("#refresh-summary").textContent(),
    / 0 values change;/,
  );
  assert.equal(await page.locator("#refresh-confirm-label").isVisible(), false);
  assert.equal(await page.locator("#refresh-alerts li").count(), 0);
  assert.equal(await page.locator("#refresh-apply").isDisabled(), false);
  await page.locator("#refresh-cancel").click();
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  console.log("Refresh browser checks passed.");
} finally {
  await browser.close();
}
