// F03 formatting commands: emphasis, colours, borders, alignment, wrap with
// command-time row heights, whole rows and columns, the 50,000-cell guard,
// column widths, copy style, links, context menus, undo/redo, recovery and
// save/reopen, all without the calculation engine.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { formattingWorkbook } from "../fixtures/formatting.mjs";
import { readHTML } from "../bench/storage/html.mjs";
import { openMenu, menuItem } from "./shell.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const file = resolve(out, "commands.html");
await writeFile(file, await buildWorkbook(formattingWorkbook()));
const mod = process.platform === "darwin" ? "Meta" : "Control";
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
  const toolbar = page.getByRole("toolbar", { name: "Formatting" }),
    tool = (name) => toolbar.getByRole("button", { name, exact: true }),
    cell = (ref) => page.locator(`#grid [data-cell="${ref}"]`),
    // The grid may redraw on the next frame; wait for a measured size.
    size = (ref, prop, test) =>
      page
        .waitForFunction(
          ([r, p, t]) => {
            const el = document.querySelector(`#grid [data-cell="${r}"]`);
            return el?.isConnected && new Function("v", `return ${t}`)(el[p])
              ? el[p]
              : null;
          },
          [ref, prop, test],
        )
        .then((handle) => handle.jsonValue()),
    changed = () =>
      page
        .locator("#status")
        .filter({ hasText: /changed\. Unsaved changes\./ })
        .waitFor();
  const save = async (name) => {
    const wait = page.waitForEvent("download");
    await openMenu(page, "File");
    await menuItem(page, "File", "Save a copy").click();
    const target = resolve(out, name);
    await (await wait).saveAs(target);
    return readHTML(await readFile(target, "utf8")).book.sheets[0];
  };
  const select = async (from, to) => {
    await cell(from).click();
    if (to) await cell(to).click({ modifiers: ["Shift"] });
  };
  // Bold and italic toggle from the toolbar and shortcuts.
  await select("D3");
  await tool("Bold").click();
  await changed();
  assert.equal(await tool("Bold").getAttribute("aria-pressed"), "true");
  await page.locator("#grid").focus();
  await page.keyboard.press(`${mod}+i`);
  assert.equal(await tool("Italic").getAttribute("aria-pressed"), "true");
  // Header text is bold by its cell style: turning it off is stored.
  await select("A2");
  assert.equal(await tool("Bold").getAttribute("aria-pressed"), "true");
  await tool("Bold").click();
  // Colours from the swatches, by keyboard.
  await select("D4", "E5");
  await tool("Fill colour").click();
  await page.getByRole("radio", { name: "Accent" }).click();
  await tool("Text colour").focus();
  await page.keyboard.press("Enter");
  await page.getByRole("radio", { name: "Alert" }).focus();
  await page.keyboard.press("Enter");
  // Outer medium borders, then centre alignment and wrap.
  await tool("Borders").click();
  await page.getByRole("radio", { name: "Medium" }).click();
  await page.getByRole("button", { name: "Outer borders" }).click();
  await tool("Align centre").click();
  assert.equal(await tool("Align centre").getAttribute("aria-pressed"), "true");
  let sheet = await save("commands-1.html");
  assert.deepEqual(sheet.cells.D3.style, { bold: true, italic: true });
  assert.deepEqual(sheet.cells.A2.style.bold, false);
  assert.deepEqual(sheet.cells.D4.style, {
    fill: "acc",
    color: "alert",
    border: {
      top: { style: "medium", color: "ink" },
      left: { style: "medium", color: "ink" },
    },
    align: { horizontal: "center" },
  });
  assert.deepEqual(sheet.cells.E5.style.border, {
    bottom: { style: "medium", color: "ink" },
    right: { style: "medium", color: "ink" },
  });
  // Wrap grows the row at command time; removing it restores the height.
  await select("A8");
  await tool("Wrap text").click();
  await changed();
  const tall = await size("A8", "offsetHeight", "v > 45");
  await tool("Wrap text").click();
  await size("A8", "offsetHeight", "v === 23");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByText("Undo restored the previous workbook.").waitFor();
  await size("A8", "offsetHeight", `v === ${tall}`);
  // Whole rows from the row header write a row style; the guard refuses
  // more than 50,000 individual cells.
  await page.locator('#grid [data-row="12"]').click();
  assert.equal(
    await page.getByLabel("Cell address", { exact: true }).inputValue(),
    "A12",
  );
  await tool("Fill colour").click();
  await page.getByRole("radio", { name: "Light" }).click();
  await changed();
  // The name box also selects ranges; 300 × 201 cells exceed the guard.
  await page.getByLabel("Cell address", { exact: true }).fill("A20:KN220");
  await page.getByLabel("Cell address", { exact: true }).press("Enter");
  await tool("Bold").click();
  await page
    .locator("#status")
    .filter({ hasText: "select whole rows or columns" })
    .waitFor();
  // Column header: width by keyboard dialog and auto-fit from the menu.
  await page.locator('#grid [data-column="4"]').click();
  await openMenu(page, "Format");
  await menuItem(page, "Format", "Column width…").click();
  await page.getByLabel("Width in pixels").fill("150");
  await page.getByRole("button", { name: "Apply width" }).click();
  await changed();
  await size("D3", "offsetWidth", "v === 150");
  await page.locator('#grid [data-column="1"]').click();
  await openMenu(page, "Format");
  await menuItem(page, "Format", "Auto-fit column width").click();
  await changed();
  // Auto-fit widens A to its widest unwrapped value.
  await size("A3", "offsetWidth", "v > 180");
  // Dragging a column edge resizes it.
  let head = null;
  while (!head)
    head = await page.locator('#grid [data-column="2"]').boundingBox();
  await page.mouse.move(head.x + head.width - 2, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(head.x + head.width + 58, head.y + head.height / 2, {
    steps: 4,
  });
  await page.mouse.up();
  await changed();
  await size("B3", "offsetWidth", "v === 160");
  // Copy style tiles the source formatting over the target, by keyboard too.
  await select("D3");
  await tool("Copy style").click();
  assert.equal(await tool("Copy style").getAttribute("aria-pressed"), "true");
  // The painter applies when a pointer selection ends: drag F3 to G4.
  const from = await cell("F3").boundingBox(),
    to = await cell("G4").boundingBox();
  await page.mouse.move(from.x + 10, from.y + 10);
  await page.mouse.down();
  await page.mouse.move(to.x + 10, to.y + 10, { steps: 3 });
  await page.mouse.up();
  assert.equal(await tool("Copy style").getAttribute("aria-pressed"), "false");
  await select("D4");
  await tool("Copy style").click();
  await page.locator("#grid").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  // Links: dialog with validation, the link card, internal navigation.
  await select("A9");
  await page.keyboard.press(`${mod}+k`);
  const dialog = page.getByRole("dialog", { name: "Link" });
  await dialog
    .getByLabel("Address", { exact: true })
    .fill("javascript:alert(1)");
  assert.equal(
    await dialog.getByRole("button", { name: "Save link" }).isDisabled(),
    true,
  );
  await dialog
    .getByLabel("Address", { exact: true })
    .fill("https://example.org/report");
  await dialog.getByRole("button", { name: "Save link" }).click();
  await changed();
  assert.match(await cell("A9").getAttribute("class"), /linked/);
  await select("C9");
  await tool("Link").click();
  await dialog.getByLabel("Place in this workbook").check();
  await dialog.getByLabel("Cell", { exact: true }).fill("B5");
  await dialog.getByRole("button", { name: "Save link" }).click();
  await changed();
  await cell("H9").click();
  await cell("C9").click();
  await page
    .locator(".sh-pop-link")
    .getByRole("button", { name: "Go to" })
    .click();
  assert.equal(
    await page.getByLabel("Cell address", { exact: true }).inputValue(),
    "B5",
  );
  // Context menus: column header, and Shift+F10 on a cell.
  await page.locator('#grid [data-column="5"]').click({ button: "right" });
  const columnMenu = page.getByRole("menu", { name: "Column menu" });
  await columnMenu.getByRole("menuitem", { name: "Insert columns" }).waitFor();
  await page.keyboard.press("Escape");
  await select("C3");
  await page.locator("#grid").focus();
  await page.keyboard.press("Shift+F10");
  await page
    .getByRole("menu", { name: "Cell menu" })
    .getByRole("menuitem", { name: "Clear formatting" })
    .click();
  await changed();
  // Menu commands return focus to the grid, which survives the redraw.
  assert.equal(await page.evaluate(() => document.activeElement.id), "grid");
  // Whole columns: Bold on column C writes a column style and leaves its
  // cells' own styles alone; turning bold off for row 30 stores the reset
  // that the crossing column style needs.
  await page.locator('#grid [data-column="3"]').click();
  await tool("Bold").click();
  await changed();
  await page.locator('#grid [data-row="30"]').click();
  await tool("Bold").click();
  await changed();
  assert.equal(await tool("Bold").getAttribute("aria-pressed"), "true");
  await tool("Bold").click();
  await changed();
  // Accounting with an explicit minus sign keeps it.
  await select("H5");
  await openMenu(page, "Format");
  await menuItem(page, "Format", "Number format…").click();
  await page
    .getByLabel("Number format", { exact: true })
    .selectOption("accounting");
  await page.getByLabel("Negative numbers").selectOption("minus");
  await page.getByRole("button", { name: "Apply number format" }).click();
  // Wrap painted by Copy style grows the target row.
  await select("A6");
  await tool("Copy style").click();
  await select("B9");
  await size("B9", "offsetHeight", "v > 23");
  // The painter refuses more than 50,000 cells without throwing.
  await select("D3");
  await tool("Copy style").click();
  await page.getByLabel("Cell address", { exact: true }).fill("A20:KN220");
  await page.getByLabel("Cell address", { exact: true }).press("Enter");
  await page.locator("#grid").focus();
  await page.keyboard.press("Enter");
  await page
    .locator("#status")
    .filter({ hasText: "Copy style not applied" })
    .waitFor();
  assert.equal(await tool("Copy style").getAttribute("aria-pressed"), "false");
  // The link dialog applies the model's rules before saving.
  await select("E9");
  await tool("Link").click();
  const check = page.getByRole("dialog", { name: "Link" });
  for (const bad of ["http:example.org", "mailto:"]) {
    await check.getByLabel("Address", { exact: true }).fill(bad);
    assert.equal(
      await check.getByRole("button", { name: "Save link" }).isDisabled(),
      true,
      bad,
    );
  }
  await check.getByLabel("Place in this workbook").check();
  await check.getByLabel("Cell", { exact: true }).fill("A1048577");
  assert.equal(
    await check.getByRole("button", { name: "Save link" }).isDisabled(),
    true,
  );
  await check.getByRole("button", { name: "Cancel" }).click();
  sheet = await save("commands-2.html");
  assert.equal(sheet.columns.C.style.bold, true);
  assert.equal(sheet.cells.C4.style, undefined);
  assert.equal(sheet.rows["30"].style.bold, false);
  assert.deepEqual(sheet.cells.H5.format, {
    kind: "accounting",
    digits: 2,
    currency: "EUR",
    negative: "minus",
  });
  assert.ok(sheet.rows["9"].height > 23);
  assert.equal(sheet.rows["12"].style.fill, "lig");
  assert.equal(sheet.columns.D.width, 150);
  assert.equal(sheet.columns.B.width, 160);
  assert.ok(sheet.columns.A.width > 180);
  // D3's style tiled over F3:G4, then D4's painted onto G4 by keyboard.
  for (const ref of ["F3", "G3", "F4"])
    assert.deepEqual(sheet.cells[ref].style, { bold: true, italic: true });
  assert.deepEqual(sheet.cells.G4.style, sheet.cells.D4.style);
  assert.deepEqual(sheet.links.A9, { url: "https://example.org/report" });
  assert.deepEqual(sheet.links.C9, { sheetId: "show", ref: "B5" });
  assert.equal(sheet.cells.C3.style, undefined);
  assert.equal(sheet.cells.C3.format, undefined);
  // Widening column A re-measured the wrapped A8: its row needs less height.
  assert.ok((sheet.rows["8"]?.height ?? 23) < tall);
  // Recovery: the automatic draft restores sizes, row styles and links.
  await page.reload();
  await page
    .getByRole("button", { name: "Restore draft", exact: true })
    .click();
  await size("D3", "offsetWidth", "v === 150");
  await size("B9", "offsetHeight", "v > 23");
  assert.match(await cell("A9").getAttribute("class"), /linked/);
  assert.equal(
    await page
      .locator('#grid [data-cell="A12"]')
      .evaluate((el) => el.style.backgroundColor),
    "var(--lig)",
  );
  // Reopen: everything persisted and redrawn.
  await page.goto(pathToFileURL(resolve(out, "commands-2.html")).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  await size("D3", "offsetWidth", "v === 150");
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  await context.close();
  // A value edit re-measures a wrapped cell's row in the same history entry.
  const engine = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    }),
    p = await engine.newPage();
  await engine.route(/^https?:\/\//, async (route) =>
    route.fulfill({
      body: await readFile(
        new URL(
          `../engine/vendor/${route.request().url().endsWith(".wasm.gz") ? "ironcalc.wasm.gz" : "ironcalc.mjs"}`,
          import.meta.url,
        ),
      ),
    }),
  );
  await p.goto(pathToFileURL(file).href);
  await p.getByText("Saved results are current.", { exact: true }).waitFor();
  await p.locator('#grid [data-cell="A6"]').click();
  const rowOf = () =>
    p.waitForFunction(() => {
      const el = document.querySelector('#grid [data-cell="A6"]');
      return el?.isConnected ? el.offsetHeight : null;
    });
  const before = await (await rowOf()).jsonValue();
  await p
    .getByLabel("Cell value", { exact: true })
    .fill(
      "A much longer wrapped note that now needs many more lines than the fifty pixels it had before",
    );
  await p.getByRole("button", { name: "Apply edit", exact: true }).click();
  await p
    .getByText("Calculated locally. Unsaved changes.", { exact: true })
    .waitFor();
  const grown = await (await rowOf()).jsonValue();
  assert.ok(grown > before, `row 6 grew from ${before} to ${grown}`);
  await p.getByRole("button", { name: "Undo", exact: true }).click();
  await p.getByText("Undo restored the previous workbook.").waitFor();
  await p.waitForFunction(
    (h) => document.querySelector('#grid [data-cell="A6"]')?.offsetHeight === h,
    before,
  );
  // Redo brings the taller row back with the value.
  await p.getByRole("button", { name: "Redo", exact: true }).click();
  await p.getByText("Redo restored the previous workbook.").waitFor();
  await p.waitForFunction(
    (h) => document.querySelector('#grid [data-cell="A6"]')?.offsetHeight === h,
    grown,
  );
  // A wrapped formula is measured with its new result.
  await p.locator('#grid [data-cell="A6"]').click();
  await p.getByLabel("Input type", { exact: true }).selectOption("formula");
  await p
    .getByLabel("Cell value", { exact: true })
    .fill('=REPT("formula text ",20)');
  await p.getByRole("button", { name: "Apply edit", exact: true }).click();
  await p
    .getByText("Calculated locally. Unsaved changes.", { exact: true })
    .waitFor();
  const formula = await (await rowOf()).jsonValue();
  assert.ok(formula > before, `formula row ${formula}px`);
  await engine.close();
  console.log(
    "PASS commands: emphasis, colours, borders, alignment, wrap heights (values and formulas), row and column styles, widths, copy style, links, context menus, undo/redo, recovery and save/reopen",
  );
} finally {
  await browser.close();
}
