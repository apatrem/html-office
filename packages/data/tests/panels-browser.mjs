// F05 panels (ADR-011 §7, ADR-012 §8–9): cell styles, document settings with
// the TH01 built-in chartes and fonts, regional settings; one panel at a
// time, focus in and out, undo, save/reopen and the narrow bottom sheet.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { formattingWorkbook } from "../fixtures/formatting.mjs";
import { readHTML } from "../bench/storage/html.mjs";
import { CHARTES } from "../../shared/themes/chartes.mjs";
import { openMenu, menuItem } from "./shell.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const book = formattingWorkbook();
delete book.font;
const file = resolve(out, "panels.html");
await writeFile(file, await buildWorkbook(book));
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1440, height: 900 },
    }),
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
  const active = () =>
    page.evaluate(
      () =>
        document.activeElement?.getAttribute("aria-label") ??
        document.activeElement?.textContent?.trim(),
    );
  const token = (name) =>
    page.evaluate(
      (n) =>
        getComputedStyle(document.documentElement)
          .getPropertyValue(`--${n}`)
          .trim(),
      name,
    );
  const panel = (name) => page.getByRole("region", { name });
  // Cell styles: toolbar toggle, focus on the heading, apply, follow, close.
  await page.locator('#grid [data-cell="C3"]').click();
  const toggle = page.getByRole("button", { name: "Styles", exact: true });
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-pressed"), "true");
  assert.equal(await active(), "Cell styles");
  const styles = panel("Cell styles");
  await styles.getByRole("radio", { name: /^Total/ }).click();
  await page
    .locator("#status")
    .filter({ hasText: "Formatting changed" })
    .waitFor();
  await page.locator('#grid [data-cell="A3"]').click();
  assert.equal(
    await styles.locator('[aria-checked="true"]').getAttribute("data-value"),
    "normal",
  );
  await styles.getByRole("heading").focus();
  await page.keyboard.press("Escape");
  assert.equal(await panel("Cell styles").count(), 0);
  assert.equal(await active(), "Styles");
  // Document settings from the sheet bar: built-in theme and font.
  const settings = page.getByRole("button", { name: "Document settings" });
  await settings.click();
  assert.equal(await active(), "Document settings");
  const documentInk = await token("ink");
  await panel("Document settings").getByRole("radio", { name: "Red" }).click();
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "red",
  );
  assert.equal((await token("ink")).toUpperCase(), CHARTES.red.ink);
  await panel("Document settings")
    .getByRole("radio", { name: /^Georgia/ })
    .click();
  assert.match(
    await page
      .locator("#grid")
      .evaluate((el) => getComputedStyle(el).fontFamily),
    /^Georgia/,
  );
  // Undo restores the document's own charte; redo re-applies Red... then
  // the document charte can be chosen again explicitly.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme ?? null),
    null,
  );
  assert.equal(await token("ink"), documentInk);
  assert.equal(
    await panel("Document settings")
      .getByRole("radio", { checked: true })
      .first()
      .getAttribute("data-value"),
    "document",
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  // Regional settings opened from inside the panel return focus to the
  // sheet-bar button when closed.
  await panel("Document settings")
    .getByRole("button", { name: "Regional settings…" })
    .click();
  assert.equal(await active(), "Regional settings");
  await panel("Regional settings").getByLabel("Locale").selectOption("fr-FR");
  assert.match(
    await panel("Regional settings").locator("table").textContent(),
    /1\s234,50/,
  );
  await panel("Regional settings")
    .getByRole("button", { name: "Apply locale" })
    .click();
  assert.match(
    await page.locator('#grid [data-cell="B3"]').textContent(),
    /1,2\sM\s?€|€1,2M|1,2M/,
  );
  await panel("Regional settings")
    .getByRole("button", { name: "Close Regional settings" })
    .click();
  assert.equal(await active(), "Document settings");
  // File menu entries open the same panels.
  await openMenu(page, "File");
  await menuItem(page, "File", "Document settings…").click();
  await panel("Document settings").waitFor();
  await page.keyboard.press("Escape");
  // Save a copy: workbook fields, no shell state in the file.
  const wait = page.waitForEvent("download");
  await openMenu(page, "File");
  await menuItem(page, "File", "Save a copy").click();
  const saved = resolve(out, "panels-saved.html");
  await (await wait).saveAs(saved);
  const text = await readFile(saved, "utf8"),
    result = readHTML(text).book;
  assert.equal(result.theme, "red");
  assert.equal(result.font, "georgia");
  assert.equal(result.locale, "fr-FR");
  assert.equal(result.sheets[0].cells.C3.cellStyle, "total");
  assert.doesNotMatch(text, /<html[^>]*data-theme/);
  assert.doesNotMatch(text, /<html[^>]*style=/);
  await page.goto(pathToFileURL(saved).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "red",
  );
  // Narrow: the panel becomes a bottom sheet.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole("button", { name: "Styles", exact: true }).click();
  const sheet = await page.locator("#shell-drawer").boundingBox();
  assert.equal(Math.round(sheet.y + sheet.height), 812);
  assert.equal(Math.round(sheet.width), 375);
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  await context.close();
  console.log(
    "PASS panels: cell styles, built-in themes and fonts, regional settings, focus, undo, save/reopen and the narrow bottom sheet without the engine",
  );
} finally {
  await browser.close();
}
