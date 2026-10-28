// CSV import end to end (T15): file picker, typed preview, encoding and
// locale ambiguity resolved by the person, one undoable step through the
// engine, source metadata saved without a path, and no data request.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { readHTML } from "../bench/storage/html.mjs";
import { command, currentSheet } from "./shell.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const book = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
// A formula that reads the sheet the import will create.
book.sheets[1].cells.A5 = {
  input: { type: "text", value: "Imported total" },
};
book.sheets[1].cells.B5 = { formula: "=SUM(Ventes!C2:C4)" };
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
// French Excel "CSV (point-virgule)": Windows-1252, semicolons, decimal
// commas, day-first dates, a quoted multiline field and leading zeros.
const french = Buffer.from(
  "Région;Code;Montant;Date;Note\r\n" +
    'Nord;0012;1 234,56;28/10/2026;"Ligne 1\r\nLigne 2"\r\n' +
    "Sud;0345;7,5;01/02/2026;=1+1\r\n" +
    'Île-de-France;0678;-3,25;15/12/2025;"guillemets ""ok"""\r\n',
  "latin1",
);
async function pick(page, name, buffer) {
  const chooser = page.waitForEvent("filechooser");
  await command(page, "Import CSV");
  await (await chooser).setFiles({ name, mimeType: "text/csv", buffer });
  await page.locator("#import-preview table").waitFor();
}
const dialog = (page) => page.locator("dialog.imp-dialog");
try {
  const file = resolve(out, "import.html");
  await writeFile(file, await buildWorkbook(book));
  const context = await browser.newContext({ acceptDownloads: true }),
    page = await context.newPage(),
    requests = [],
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.route(/^https?:\/\//, async (route) => {
    const request = route.request();
    requests.push({ url: request.url(), method: request.method() });
    await route.fulfill({
      body: await readFile(
        new URL(
          `../engine/vendor/${request.url().endsWith(".wasm.gz") ? "ironcalc.wasm.gz" : "ironcalc.mjs"}`,
          import.meta.url,
        ),
      ),
    });
  });
  await page.goto(pathToFileURL(file).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();

  // Preview: encoding fallback, conventions detected, typed values shown.
  await pick(page, "ventes.csv", french);
  assert.deepEqual(requests, [], "the preview needs no request");
  const summary = await page.locator("#import-summary").textContent();
  assert.match(
    summary,
    /4 rows × 5 columns · Western \(Windows-1252\) · semicolon-separated · first row holds column names/,
  );
  const notes = await page.locator("#import-notes").textContent();
  assert.match(notes, /not UTF-8; it was read as Western/);
  assert.match(notes, /Column B \(Code\) is kept as text/);
  assert.match(notes, /1 field spans several lines/);
  assert.match(notes, /1 value starts like a formula/);
  assert.equal(await page.locator("#import-alerts li").count(), 0);
  const preview = page.locator("#import-preview tbody");
  assert.equal(
    await preview.locator("tr").nth(1).locator("td").nth(1).textContent(),
    "0012",
  );
  assert.equal(
    await preview.locator("tr").nth(1).locator("td").nth(2).textContent(),
    "1,234.56",
  );
  assert.equal(
    await preview.locator("tr").nth(1).locator("td").nth(3).textContent(),
    "October 28, 2026",
  );
  assert.equal(
    await page.getByLabel("Type of column C (Montant)").inputValue(),
    "auto",
  );
  assert.match(
    await page
      .getByLabel("Type of column C (Montant)")
      .locator("option:checked")
      .textContent(),
    /Automatic: Number/,
  );
  // Choosing UTF-8 shows the damage the person would otherwise import.
  await page.getByLabel("Encoding").selectOption("utf-8");
  assert.match(
    await preview.locator("tr").nth(3).locator("td").nth(0).textContent(),
    /�/,
  );
  await page.getByLabel("Encoding").selectOption("windows-1252");
  assert.equal(
    await preview.locator("tr").nth(3).locator("td").nth(0).textContent(),
    "Île-de-France",
  );
  assert.equal(await page.getByLabel("New sheet name").inputValue(), "ventes");
  await page.getByLabel("New sheet name").fill("Ventes");
  await page.locator("#import-apply").click();
  await waitStatus(
    page,
    /Imported ventes\.csv: 4 rows × 5 columns into the sheet "Ventes"/,
  );
  await dialog(page).waitFor({ state: "detached" });
  assert.equal(await currentSheet(page), "Ventes");
  assert.equal(await text(page, "A4"), "Île-de-France");
  assert.equal(await text(page, "B2"), "0012");
  assert.equal(await text(page, "E2"), "Ligne 1\nLigne 2");
  assert.equal(await text(page, "E3"), "=1+1");
  assert.equal(await text(page, "E4"), 'guillemets "ok"');
  assert.ok(requests.length > 0 && requests.every((r) => r.method === "GET"));
  assert.ok(
    requests.every((r) => /ironcalc/.test(r.url)),
    "only the verified engine is fetched",
  );
  // The existing formula now reads the imported sheet: 1234.56 + 7.5 - 3.25.
  await page
    .locator("#sheet-tabs")
    .getByRole("button", { name: "Summary", exact: true })
    .click();
  assert.equal(await text(page, "B5"), "1238.81");

  // One undo removes the sheet and its source; redo restores both.
  await page.locator("#grid").focus();
  await page.keyboard.press("ControlOrMeta+z");
  await waitStatus(page, /Undo restored the previous workbook/);
  assert.equal(
    await page
      .locator("#sheet-tabs")
      .getByRole("button", { name: "Ventes" })
      .count(),
    0,
  );
  assert.notEqual(await text(page, "B5"), "1238.81");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await waitStatus(page, /Redo restored the previous workbook/);
  await page
    .locator("#sheet-tabs")
    .getByRole("button", { name: "Ventes", exact: true })
    .click();
  assert.equal(await text(page, "C2"), "1,234.56");

  // Ambiguous values block the import until the person chooses.
  await pick(
    page,
    "ambiguous.csv",
    Buffer.from('Date,Amount\n03/04/2026,"1,234"\n05/06/2026,"2,500"\n'),
  );
  const alerts = page.locator("#import-alerts li");
  assert.equal(await alerts.count(), 2);
  assert.match(
    await alerts.nth(0).textContent(),
    /"1,234" \(B2\) could be read with a decimal point or a decimal comma/,
  );
  assert.match(
    await alerts.nth(1).textContent(),
    /"03\/04\/2026" \(A2\) could be day\/month or month\/day/,
  );
  assert.equal(await page.locator("#import-apply").isDisabled(), true);
  assert.equal(
    await page.getByLabel("Decimal separator").getAttribute("aria-invalid"),
    "true",
  );
  await page.getByLabel("Decimal separator").selectOption("comma");
  assert.equal(await alerts.count(), 1);
  assert.equal(await page.locator("#import-apply").isDisabled(), true);
  await page.getByLabel("Date order").selectOption("dmy");
  assert.equal(await alerts.count(), 0);
  assert.equal(
    await preview.locator("tr").nth(1).locator("td").nth(0).textContent(),
    "April 3, 2026",
  );
  assert.equal(
    await preview.locator("tr").nth(1).locator("td").nth(1).textContent(),
    "1.234",
  );
  await page.locator("#import-apply").click();
  await waitStatus(
    page,
    /Imported ambiguous\.csv: 3 rows × 2 columns into the sheet "ambiguous"/,
  );

  // Cancelling leaves the workbook unchanged.
  await pick(page, "other.csv", Buffer.from("a,b\n1,2\n"));
  await page.locator("#import-cancel").click();
  await dialog(page).waitFor({ state: "detached" });
  assert.equal(
    await page
      .locator("#sheet-tabs")
      .getByRole("button", { name: "other" })
      .count(),
    0,
  );
  // A file that cannot be read says why and imports nothing.
  await pick(page, "broken.csv", Buffer.from('a,b\n1,"open\n')).catch(() => {});
  assert.match(
    await page.locator("#import-summary").textContent(),
    /broken\.csv cannot be imported: A quoted field opened on line 2 is never closed/,
  );
  assert.equal(await page.locator("#import-apply").isDisabled(), true);
  await page.locator("#import-cancel").click();

  // Saved: the sheet as a row table and the source, with no path.
  const download = page.waitForEvent("download");
  await command(page, "Save a copy");
  const saved = resolve(out, "import-saved.html");
  await (await download).saveAs(saved);
  const html = await readFile(saved, "utf8"),
    savedBook = readHTML(html).book,
    raw = JSON.parse(
      /<script id="workbook"[^>]*>([\s\S]*?)<\/script>/.exec(html)[1],
    );
  const ventes = savedBook.sheets.find((s) => s.name === "Ventes"),
    source = savedBook.sources.find((s) => s.sheetId === ventes.id);
  assert.equal(
    raw.sheets.find((s) => s.name === "Ventes").table.encoding,
    "rows",
  );
  assert.deepEqual(ventes.cells.B2.input, { type: "text", value: "0012" });
  assert.deepEqual(ventes.cells.C2.input, { type: "number", value: 1234.56 });
  assert.deepEqual(ventes.cells.D2.input, { type: "date", value: 46323 });
  assert.equal(source.ref, "A1:E4");
  assert.equal(source.file.name, "ventes.csv");
  assert.equal(source.file.bytes, french.length);
  assert.match(source.file.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(source.options, {
    encoding: "windows-1252",
    delimiter: ";",
    header: true,
    decimal: "comma",
    dates: "dmy",
  });
  assert.deepEqual(
    source.columns.map((c) => c.name),
    ["Région", "Code", "Montant", "Date", "Note"],
  );
  assert.doesNotMatch(
    JSON.stringify(savedBook.sources),
    /\/Users\/|[A-Za-z]:\\\\|fakepath/,
  );
  assert.equal(
    savedBook.sources.find((s) => s.file.name === "ambiguous.csv").options
      .decimal,
    "comma",
  );
  assert.deepEqual(errors, []);
  await context.close();

  // Offline build: the import makes no request at all.
  const offline = resolve(out, "import-offline.html");
  await writeFile(offline, await buildWorkbook(book, { offline: true }));
  const quiet = await browser.newContext(),
    offlinePage = await quiet.newPage(),
    offlineRequests = [];
  await quiet.route(/^https?:\/\//, (route) => {
    offlineRequests.push(route.request().url());
    return route.abort();
  });
  await offlinePage.goto(pathToFileURL(offline).href);
  await offlinePage
    .getByText("Saved results are current.", { exact: true })
    .waitFor();
  await pick(offlinePage, "ventes.csv", french);
  await offlinePage.getByLabel("New sheet name").fill("Ventes");
  await offlinePage.locator("#import-apply").click();
  await waitStatus(offlinePage, /Imported ventes\.csv/);
  assert.deepEqual(offlineRequests, []);
  await quiet.close();
  console.log("CSV import browser checks passed.");
} finally {
  await browser.close();
}
