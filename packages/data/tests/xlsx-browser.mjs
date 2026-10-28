// XLSX import and refresh (T15, T16, ADR-015). Offline build: SheetJS is
// embedded and nothing is requested. Standard build: SheetJS is fetched from
// the vendor's CDN with SRI only once an XLSX file is picked, and tampered
// bytes are refused before anything runs.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { readHTML } from "../bench/storage/html.mjs";
import { XLSX_URL } from "../runtime/xlsx-reader.mjs";
import { command } from "./shell.mjs";

const XLSX = createRequire(import.meta.url)("xlsx");
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const book = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
const library = await readFile(
  new URL("../vendor/xlsx/xlsx.mini.min.js", import.meta.url),
);
function workbook(montant, { formula = "SUM(C2:C3)" } = {}) {
  const wb = XLSX.utils.book_new(),
    ventes = XLSX.utils.aoa_to_sheet([
      ["Région", "Code", "Montant"],
      ["Nord", "0012", montant[0]],
      ["Sud", "0345", montant[1]],
    ]);
  ventes.C4 = { t: "n", f: formula, v: montant[0] + montant[1] };
  ventes["!ref"] = "A1:C4";
  ventes["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  XLSX.utils.book_append_sheet(wb, ventes, "Ventes");
  const summary = XLSX.utils.aoa_to_sheet([["Total"]]);
  summary.B1 = { t: "n", f: "Ventes!C4*2", v: (montant[0] + montant[1]) * 2 };
  // A function Data does not know: its saved value differs after the import.
  summary.B2 = { t: "n", f: "NOSUCHFUNCTION(1)", v: 5 };
  summary["!ref"] = "A1:B2";
  XLSX.utils.book_append_sheet(wb, summary, "Summary");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[1]]), "Hidden");
  wb.Workbook = {
    Sheets: [{ Hidden: 0 }, { Hidden: 0 }, { Hidden: 1 }],
    Names: [{ Name: "Total", Ref: "Ventes!$C$4" }],
  };
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
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
async function pick(page, name, buffer, item) {
  const chooser = page.waitForEvent("filechooser");
  await command(page, item);
  await (
    await chooser
  ).setFiles({
    name,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
}
const routeEngine = (context) =>
  context.route("https://raw.githubusercontent.com/**", async (route) => {
    const wasm = route.request().url().includes(".wasm");
    await route.fulfill({
      body: await readFile(
        new URL(
          `../engine/vendor/ironcalc.${wasm ? "wasm.gz" : "mjs"}`,
          import.meta.url,
        ),
      ),
      headers: {
        "access-control-allow-origin": "*",
        "content-type": wasm ? "application/wasm" : "text/javascript",
      },
    });
  });
try {
  // ---- offline: embedded reader, no request at all ----
  {
    const file = resolve(out, "xlsx-offline.html");
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
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();

    // A file that is not a workbook says so.
    await pick(page, "notes.xlsx", Buffer.from("a,b\n1,2\n"), "Import XLSX");
    await page
      .locator("#import-summary", { hasText: "is not an XLSX workbook" })
      .waitFor();
    await page.locator("#import-cancel").click();
    await page.locator("dialog.imp-dialog").waitFor({ state: "detached" });

    await pick(page, "budget.xlsx", workbook([1234.5, 7.5]), "Import XLSX");
    await page.locator("#import-sheets table").waitFor();
    const rows = page.locator("#import-sheets tbody tr");
    assert.deepEqual(
      await rows.evaluateAll((r) =>
        r.map((x) => [
          x.dataset.sheet,
          x.querySelector("input").checked,
          x.children[2].textContent,
        ]),
      ),
      [
        ["Ventes", true, "Ventes"],
        ["Summary", true, "Summary (2)"],
        ["Hidden", false, "—"],
      ],
    );
    const notes = page.locator("#import-notes");
    assert.match(
      await notes.textContent(),
      /"Ventes": 1 merged range is unmerged/,
    );
    assert.match(
      await notes.textContent(),
      /"Summary" is imported as "Summary \(2\)"/,
    );
    assert.match(await notes.textContent(), /1 sheet is not imported\./);
    assert.equal(
      await page
        .locator("#import-preview td.imp-formula")
        .getAttribute("title"),
      "=SUM(C2:C3)",
    );
    // The preview follows the chosen sheet; unchecking one updates the plan.
    await page.getByLabel("Preview sheet").selectOption({ label: "Summary" });
    assert.equal(
      await page
        .locator("#import-preview td.imp-formula")
        .first()
        .getAttribute("title"),
      "=Ventes!C4*2",
    );
    await page.getByLabel('Import sheet "Summary"').uncheck();
    assert.doesNotMatch(await notes.textContent(), /Summary \(2\)/);
    await page.getByLabel('Import sheet "Summary"').check();
    await page.locator("#import-apply").click();
    await waitStatus(
      page,
      /Imported budget\.xlsx: 2 sheets "Ventes", "Summary \(2\)" and 1 named range\. 1 formula gives a different result in Data than the value saved in the file, for example 'Summary \(2\)'!B2: 5 in the file, #NAME\? here\./,
    );
    await page.locator("dialog.imp-dialog").waitFor({ state: "detached" });
    assert.equal(await text(page, "B2"), "0012");
    assert.equal(await text(page, "C4"), "1242");
    await tab(page, "Summary (2)").click();
    assert.equal(await text(page, "B1"), "2484");

    await page.locator("#grid").focus();
    await page.keyboard.press("ControlOrMeta+z");
    await waitStatus(page, /Undo restored the previous workbook/);
    assert.equal(await tab(page, "Ventes").count(), 0);
    await page.locator("#grid").focus();
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await waitStatus(page, /Redo restored the previous workbook/);
    await tab(page, "Ventes").click();
    assert.equal(await text(page, "C4"), "1242");

    // Refresh the Ventes sheet from a new version of the workbook.
    await pick(
      page,
      "budget-v2.xlsx",
      workbook([1234.5, 10]),
      "Refresh source",
    );
    await page.locator("#refresh-columns table").waitFor();
    assert.equal(
      await page.getByLabel("Sheet in the new file").inputValue(),
      "0",
    );
    assert.match(
      await page.locator("#refresh-summary").textContent(),
      /budget\.xlsx .* → budget-v2\.xlsx\. Rows: 4 → 4\. 1 value changes;/,
    );
    assert.match(
      await page.locator("#refresh-impact").textContent(),
      /1 formula on Summary \(2\) will recalculate/,
    );
    await page.locator("#refresh-apply").click();
    await waitStatus(
      page,
      /Refreshed "Ventes" from budget-v2\.xlsx: 4 rows, 1 value changed\./,
    );
    assert.equal(await text(page, "C3"), "10");
    assert.equal(await text(page, "C4"), "1244.5");
    await tab(page, "Summary (2)").click();
    assert.equal(await text(page, "B1"), "2489");

    const download = page.waitForEvent("download");
    await command(page, "Save a copy");
    const saved = resolve(out, "xlsx-saved.html");
    await (await download).saveAs(saved);
    const savedBook = readHTML(await readFile(saved, "utf8")).book;
    assert.deepEqual(
      savedBook.sources.map((s) => [s.kind, s.file.name, s.options, s.ref]),
      [
        ["xlsx", "budget-v2.xlsx", { sheet: "Ventes", header: true }, "A1:C4"],
        ["xlsx", "budget.xlsx", { sheet: "Summary", header: false }, "A1:B2"],
      ],
    );
    assert.deepEqual(savedBook.names, [
      { name: "Total", sheetId: savedBook.sources[0].sheetId, ref: "C4" },
    ]);
    assert.doesNotMatch(
      JSON.stringify(savedBook.sources),
      /\/Users\/|fakepath/,
    );
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
    await context.close();
  }

  // ---- standard: the pinned reader from the CDN, only on an XLSX import ----
  const file = resolve(out, "xlsx-standard.html");
  await writeFile(file, await buildWorkbook(book));
  for (const tampered of [false, true]) {
    const context = await browser.newContext(),
      page = await context.newPage(),
      fetched = [],
      other = [],
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await routeEngine(context);
    await context.route(/^https?:\/\//, (route) => {
      const url = route.request().url();
      if (url.startsWith("https://raw.githubusercontent.com/"))
        return route.fallback();
      if (url !== XLSX_URL) {
        other.push(url);
        return route.abort();
      }
      fetched.push(url);
      return route.fulfill({
        body: tampered
          ? Buffer.concat([library, Buffer.from("\nself.tampered=1;")])
          : library,
        headers: {
          "access-control-allow-origin": "*",
          "content-type": "application/javascript",
        },
      });
    });
    await page.goto(pathToFileURL(file).href);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    assert.deepEqual(fetched, [], "nothing fetched at load");
    await pick(page, "budget.xlsx", workbook([1, 2]), "Import XLSX");
    if (tampered) {
      await page
        .locator("#import-summary", {
          hasText:
            "cannot be imported: The XLSX reader could not be loaded (no connection, blocked, or it failed its integrity check). Nothing was run.",
        })
        .waitFor();
      assert.equal(await page.locator("#import-apply").isDisabled(), true);
      await page.locator("#import-cancel").click();
    } else {
      await page.locator("#import-sheets table").waitFor();
      await page.locator("#import-apply").click();
      await waitStatus(page, /Imported budget\.xlsx: 2 sheets/);
      // A second import reuses the verified reader.
      await pick(page, "budget.xlsx", workbook([1, 2]), "Import XLSX");
      await page.locator("#import-sheets table").waitFor();
      await page.locator("#import-cancel").click();
    }
    assert.deepEqual(fetched, [XLSX_URL]);
    assert.deepEqual(other, []);
    assert.equal(await page.evaluate(() => typeof window.XLSX), "undefined");
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("XLSX browser checks passed.");
} finally {
  await browser.close();
}
