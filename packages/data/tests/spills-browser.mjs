// F-01 spilled array results in the editor: display, read-only spill cells,
// #SPILL! while a target cell is occupied, save/reload, undo/redo, row
// insert/delete near a spill, copy/paste and CSV export.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { readHTML } from "../bench/storage/html.mjs";
import { command, openMenu, menuItem } from "./shell.mjs";
import { parseCSV } from "./csv-parse.mjs";

const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const book = JSON.parse(
    await readFile(new URL("../fixtures/spills.json", import.meta.url)),
  ),
  html = await buildWorkbook(book, { offline: true }),
  browser = await chromium.launch(),
  shortcut = process.platform === "darwin" ? "Meta" : "Control";

async function open(context, name, content = html) {
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  const file = resolve(out, name);
  await writeFile(file, content);
  await page.goto(pathToFileURL(file).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  return { page, errors };
}
async function jump(page, ref) {
  await page.getByLabel("Cell address").fill(ref);
  await page.keyboard.press("Tab");
  await page.locator("#grid").focus();
}
const calculated = (page) =>
  page
    .getByText("Calculated locally. Unsaved changes.", { exact: true })
    .waitFor();
async function enter(page, ref, type, value) {
  await page.getByLabel("Cell address").fill(ref);
  await page.keyboard.press("Tab");
  await page.getByLabel("Input type").selectOption(type);
  await page.getByLabel("Cell value").fill(value);
  await page.getByRole("button", { name: "Apply edit", exact: true }).click();
  await calculated(page);
}
async function saved(page, name) {
  const wait = page.waitForEvent("download");
  await command(page, "Save a copy");
  const file = resolve(out, name);
  await (await wait).saveAs(file);
  const content = await readFile(file, "utf8");
  return { book: readHTML(content).book, content };
}
const text = (page, ref) =>
  page.locator(`[data-cell="${ref}"] .cell-text`).textContent();
async function column(page, refs) {
  const values = [];
  for (const ref of refs) values.push((await text(page, ref)).trim());
  return values;
}

try {
  const context = await browser.newContext({
    acceptDownloads: true,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const { page, errors } = await open(context, "spills.html");

  // The saved spills are shown without the engine, marked and read-only.
  assert.deepEqual(await column(page, ["D1", "D2", "D3", "D4"]), [
    "1",
    "2",
    "3",
    "4",
  ]);
  assert.deepEqual(await column(page, ["F1", "F2", "F3"]), [
    "East",
    "North",
    "South",
  ]);
  assert.deepEqual(await column(page, ["G1", "H1", "G2", "H2"]), [
    "North",
    "120",
    "East",
    "200",
  ]);
  const d2 = page.locator('[data-cell="D2"]');
  assert.ok(await d2.evaluate((b) => b.classList.contains("spill-cell")));
  assert.equal(await d2.getAttribute("aria-label"), "D2: 2, spilled from D1");
  assert.ok(
    !(await page
      .locator('[data-cell="D1"]')
      .evaluate((b) => b.classList.contains("spill-cell"))),
  );
  await jump(page, "D2");
  assert.equal(
    await page.getByLabel("Cell value").inputValue(),
    "=SEQUENCE(4)",
  );
  assert.ok(await page.getByLabel("Cell value").evaluate((i) => i.readOnly));
  await page.keyboard.press("F2");
  await page
    .getByText(
      "D2 shows part of the array that D1 spills. Edit the formula in D1.",
      { exact: true },
    )
    .waitFor();
  await page.getByRole("button", { name: "Apply edit", exact: true }).click();
  await page
    .getByText(
      "D2 shows part of the array that D1 spills. Edit the formula in D1.",
      { exact: true },
    )
    .waitFor();

  // #SPILL! while a target cell is occupied; freeing it spills again.
  await enter(page, "D7", "number", "99");
  await enter(page, "D1", "formula", "=SEQUENCE(7)");
  assert.equal((await text(page, "D1")).trim(), "#SPILL!");
  assert.equal((await text(page, "D2")).trim(), "");
  let copy = await saved(page, "spills-blocked.html");
  assert.equal(copy.book.sheets[0].cells.D1.result.value, "#SPILL!");
  assert.equal(copy.book.sheets[0].cells.D1.spill, undefined);
  await enter(page, "D7", "blank", "");
  assert.deepEqual(await column(page, ["D1", "D5", "D7"]), ["1", "5", "7"]);
  copy = await saved(page, "spills-freed.html");
  assert.equal(copy.book.sheets[0].cells.D1.spill.ref, "D1:D7");

  // Undo and redo restore the spill with its anchor.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page
    .getByText("Undo restored the previous workbook.", { exact: true })
    .waitFor();
  assert.equal((await text(page, "D1")).trim(), "#SPILL!");
  assert.equal((await text(page, "D5")).trim(), "");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page
    .getByText("Redo restored the previous workbook.", { exact: true })
    .waitFor();
  assert.deepEqual(await column(page, ["D5", "D7"]), ["5", "7"]);

  // A saved copy reopens with the same spilled values, without recalculating.
  {
    const reopened = await open(context, "spills-reopened.html", copy.content);
    assert.deepEqual(await column(reopened.page, ["D1", "D7", "E4", "G2"]), [
      "1",
      "7",
      "400.0",
      "East",
    ]);
    assert.equal(reopened.errors.length, 0, reopened.errors.join("\n"));
    await reopened.page.close();
  }

  // Inserting a row inside the source extends =B2:B5*2; inserting inside a
  // spill leaves the anchor in place.
  await jump(page, "A3");
  await command(page, "Insert rows");
  await page
    .getByText("Row/column references updated. Unsaved changes.", {
      exact: true,
    })
    .waitFor();
  copy = await saved(page, "spills-inserted.html");
  let cells = copy.book.sheets[0].cells;
  assert.equal(cells.E1.formula, "=B2:B6*2");
  assert.equal(cells.E1.spill.ref, "E1:E5");
  assert.deepEqual(
    cells.E1.spill.results.map(([v]) => v.value),
    [240, 0, 160, 90, 400],
  );
  assert.equal(cells.D1.spill.ref, "D1:D7");
  assert.equal(cells.D8.input.type, "blank");
  assert.equal((await text(page, "E2")).trim(), "0.0");
  await command(page, "Delete rows");
  await page
    .getByText("Row/column references updated. Unsaved changes.", {
      exact: true,
    })
    .waitFor();
  cells = (await saved(page, "spills-deleted.html")).book.sheets[0].cells;
  assert.equal(cells.E1.formula, "=B2:B5*2");
  assert.equal(cells.E1.spill.ref, "E1:E4");
  assert.deepEqual(await column(page, ["E2", "E4"]), ["160.0", "400.0"]);

  // Copying spilled cells copies their values; an anchor copies its formula.
  await jump(page, "D1");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press(shortcut + "+c");
  await page.locator("#status").filter({ hasText: "Range copied" }).waitFor();
  await jump(page, "J1");
  await page.keyboard.press(shortcut + "+v");
  await calculated(page);
  cells = (await saved(page, "spills-pasted.html")).book.sheets[0].cells;
  assert.equal(cells.J1.formula, "=SEQUENCE(7)");
  assert.deepEqual(cells.J2.input, { type: "number", value: 2 });
  // The pasted values block the pasted anchor.
  assert.equal(cells.J1.result.value, "#SPILL!");
  assert.equal(cells.J1.spill, undefined);

  // CSV export writes spilled values like any value.
  await openMenu(page, "File");
  await menuItem(page, "File", "Export sheet as CSV…").click();
  const dialog = page.getByRole("dialog", { name: "Export sheet as CSV" });
  await dialog.waitFor();
  const wait = page.waitForEvent("download", { timeout: 60000 });
  await dialog.getByRole("button", { name: "Export CSV", exact: true }).click();
  const download = await wait,
    path = resolve(out, download.suggestedFilename());
  await download.saveAs(path);
  const rows = parseCSV(await readFile(path, "utf8"));
  assert.deepEqual(rows[1].slice(3, 8), ["2", "160", "North", "East", "200"]);
  assert.equal(rows[6][3], "7");

  assert.equal(errors.length, 0, errors.join("\n"));
} finally {
  await browser.close();
}
