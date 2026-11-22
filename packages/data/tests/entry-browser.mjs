// Review defects 4 and 5 in the editor: text typed into an empty cell is read
// as what it says, and cells can be cleared (Delete, Edit > Clear contents).
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { readHTML } from "../bench/storage/html.mjs";
import { command, openMenu } from "./shell.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const base = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
const browser = await chromium.launch();
async function open(id, locale) {
  const book = structuredClone(base);
  book.locale = locale;
  // A text cell, a formula reading it, and a styled empty cell.
  book.sheets[0].cells.E2 = { input: { type: "text", value: "words" } };
  book.sheets[0].cells.E3 = { formula: "=B2*2" };
  book.sheets[0].cells.E4 = { cellStyle: "assumption" };
  const context = await browser.newContext({ acceptDownloads: true }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  const file = resolve(out, `entry-${id}.html`);
  await writeFile(file, await buildWorkbook(book, { offline: true }));
  await page.goto(pathToFileURL(file).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  return { context, page, errors, id };
}
const idle = (page) =>
  page.waitForFunction(() => !document.getElementById("apply").disabled);
async function jump(page, ref) {
  await page.getByLabel("Cell address").fill(ref);
  await page.keyboard.press("Tab");
  await page.locator("#grid").focus();
}
// F2 (or a double click) on a cell, then the text, then Enter.
async function enter(page, ref, text, how = "F2") {
  await jump(page, ref);
  if (how === "F2") await page.keyboard.press("F2");
  else await page.locator(`[data-cell="${ref}"]`).dblclick();
  await page.getByLabel("Cell value").fill(text);
  await page.keyboard.press("Enter");
  await idle(page);
}
async function saved(page, name) {
  const wait = page.waitForEvent("download"),
    file = resolve(out, name);
  await command(page, "Save a copy");
  await (await wait).saveAs(file);
  return readHTML(await readFile(file, "utf8")).book;
}
const input = (book, ref) => book.sheets[0].cells[ref]?.input;
try {
  {
    // Typed values, in an English workbook.
    const { context, page, errors } = await open("us", "en-US");
    await enter(page, "G2", "=B2*2");
    await enter(page, "G3", "42", "dblclick");
    await enter(page, "G4", "50%");
    await enter(page, "G5", "3 apples");
    await enter(page, "G6", "2026-03-04");
    await enter(page, "G7", "03/04/2026");
    await enter(page, "G8", "0x10");
    await enter(page, "G9", "1,5");
    await enter(page, "G10", "TRUE");
    await enter(page, "G11", "1,234.50");
    let book = await saved(page, "entry-us-typed.html");
    const cells = book.sheets[0].cells;
    assert.equal(cells.G2.formula, "=B2*2");
    assert.equal(cells.G2.result.value, 200);
    assert.deepEqual(input(book, "G3"), { type: "number", value: 42 });
    assert.deepEqual(input(book, "G4"), { type: "number", value: 0.5 });
    assert.deepEqual(cells.G4.format, { kind: "percent", digits: 0 });
    assert.deepEqual(input(book, "G5"), { type: "text", value: "3 apples" });
    assert.equal(input(book, "G6").type, "date");
    assert.deepEqual(cells.G6.format, { kind: "date" });
    assert.deepEqual(input(book, "G7"), input(book, "G6"));
    assert.deepEqual(input(book, "G8"), { type: "text", value: "0x10" });
    assert.deepEqual(input(book, "G9"), { type: "text", value: "1,5" });
    assert.deepEqual(input(book, "G10"), { type: "boolean", value: true });
    assert.deepEqual(input(book, "G11"), { type: "number", value: 1234.5 });
    // The type follows the text until a type is chosen: typing a date.
    await jump(page, "G12");
    await page.keyboard.type("4/");
    await page.keyboard.type("3/2026");
    assert.equal(await page.getByLabel("Input type").inputValue(), "date");
    await page.keyboard.press("Enter");
    await idle(page);
    // A cell typed as a number says what is wrong instead of "finite number".
    await jump(page, "B3");
    await page.keyboard.press("F2");
    await page.getByLabel("Cell value").fill("0x10");
    await page.keyboard.press("Enter");
    await page
      .locator("#status")
      .filter({ hasText: '"0x10" is not a number' })
      .waitFor();
    await page.keyboard.press("Escape");
    // A typed percent in a number cell keeps the number's own format.
    await enter(page, "B3", "5%");
    book = await saved(page, "entry-us-number.html");
    assert.deepEqual(input(book, "B3"), { type: "number", value: 0.05 });
    assert.deepEqual(
      book.sheets[0].cells.B3.format,
      base.sheets[0].cells.B3.format,
    );
    assert.equal(input(book, "G12").type, "date");
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS entry: typing into empty cells reads formulas, numbers, percents, dates and text",
    );
  }
  {
    // A comma-decimal workbook: typing and the bar agree.
    const { context, page, errors } = await open("fr", "fr-FR");
    await enter(page, "G2", "1,5");
    await enter(page, "G3", "04/03/2026");
    await enter(page, "G4", "3,5%");
    await enter(page, "G5", "1.5");
    await jump(page, "G2");
    assert.equal(await page.getByLabel("Cell value").inputValue(), "1,5");
    // Applying the bar's own text again changes nothing.
    await page.keyboard.press("F2");
    await page.keyboard.press("Enter");
    await idle(page);
    const book = await saved(page, "entry-fr.html");
    assert.deepEqual(input(book, "G2"), { type: "number", value: 1.5 });
    assert.equal(input(book, "G3").type, "date");
    assert.deepEqual(input(book, "G4"), { type: "number", value: 0.035 });
    assert.deepEqual(input(book, "G5"), { type: "text", value: "1.5" });
    // 4 March: one day before 5 March.
    const march = new Date(Date.UTC(2026, 2, 4)) / 86400000 + 25569;
    assert.equal(input(book, "G3").value, march);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS entry: a comma-decimal workbook reads and shows its own conventions",
    );
  }
  {
    // Clearing contents.
    const { context, page, errors } = await open("clear", "en-US");
    // Emptying a text cell or a number cell in the bar clears it.
    await enter(page, "E2", "");
    await enter(page, "B3", "");
    await enter(page, "G2", "=E2*2");
    await jump(page, "G2");
    assert.equal(await page.locator('[data-cell="G2"]').textContent(), "0");
    let book = await saved(page, "entry-cleared-bar.html");
    assert.equal(book.sheets[0].cells.E2, undefined);
    assert.deepEqual(book.sheets[0].cells.B3.input, undefined);
    assert.deepEqual(
      book.sheets[0].cells.B3.format,
      base.sheets[0].cells.B3.format,
    );
    assert.equal(book.sheets[0].cells.G2.result.value, 0);
    // Delete on a selection, formatting stays, one undo step.
    await page.getByLabel("Cell address").fill("B2:E4");
    await page.keyboard.press("Tab");
    await page.locator("#grid").focus();
    await page.keyboard.press("Delete");
    await idle(page);
    book = await saved(page, "entry-cleared-delete.html");
    for (const ref of ["B2", "E3"])
      assert.equal(input(book, ref), undefined, ref);
    assert.equal(book.sheets[0].cells.E3, undefined);
    assert.equal(book.sheets[0].cells.B2.cellStyle, "assumption");
    assert.deepEqual(
      book.sheets[0].cells.B2.format,
      base.sheets[0].cells.B2.format,
    );
    assert.equal(book.sheets[0].cells.E4.cellStyle, "assumption");
    assert.equal(input(book, "A2").value, "Participants");
    // Summary B2 read the cleared cells: no stale result survives.
    assert.equal(book.sheets[1].cells.B2.result.value, 0);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page
      .getByText("Undo restored the previous workbook.", { exact: true })
      .waitFor();
    book = await saved(page, "entry-cleared-undone.html");
    assert.equal(input(book, "B2").value, 100);
    assert.equal(book.sheets[0].cells.E3.formula, "=B2*2");
    // B3 was emptied earlier, so the product stays 0.
    assert.equal(book.sheets[1].cells.B2.result.value, 0);
    // Backspace and Edit > Clear contents do the same, on one cell.
    await jump(page, "B2");
    await page.keyboard.press("Backspace");
    await idle(page);
    assert.equal(
      (await page.locator('[data-cell="B2"]').textContent()).trim(),
      "",
    );
    await jump(page, "E3");
    await openMenu(page, "Edit");
    await page.getByRole("menuitem", { name: /^Clear contents/ }).click();
    await idle(page);
    assert.equal(
      (await page.locator('[data-cell="E3"]').textContent()).trim(),
      "",
    );
    // Nothing to clear says so; a Delete in the bar edits text as usual.
    await jump(page, "H20");
    await page.keyboard.press("Delete");
    await page
      .locator("#status")
      .filter({ hasText: "no contents to clear" })
      .waitFor();
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS entry: emptying the bar, Delete and Clear contents clear in one undoable step and keep formatting",
    );
  }
} finally {
  await browser.close();
}
