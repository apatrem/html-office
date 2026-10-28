// Variant A editor shell (ADR-011 §7, U04-Data): keyboard behaviour, engine-free
// commands, save/reopen with a fresh shell, layout parity and print.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import {
  buildWorkbook,
  measureHTML,
  STANDARD_CODE_CEILING,
} from "../tools/build.mjs";
import { scenarioWorkbook } from "../fixtures/scenarios.mjs";
import { readHTML } from "../bench/storage/html.mjs";
import { command, openMenu, menuItem, cellStyle } from "./shell.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const active = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return el.getAttribute("aria-label") ?? el.textContent.trim();
  });
// Every command the shell offers; a released shell lists no inert command.
const MENUS = {
  File: [
    "Save",
    "Save a copy",
    "Download selection as PNG",
    "Export sheet as CSV…",
    "Document settings…",
    "Regional settings…",
  ],
  Edit: [
    "Undo",
    "Redo",
    "Paste table…",
    "Fill down",
    "Fill right",
    "Copy style",
    "Delete rows",
    "Delete columns",
    "Duplicate chart",
    "Delete chart",
    "Clear formatting",
  ],
  Insert: [
    "Insert rows",
    "Insert columns",
    "Link…",
    "New sheet…",
    "Pivot table…",
    "Chart…",
  ],
  Format: [
    "Bold",
    "Italic",
    "Text colour…",
    "Fill colour…",
    "Borders…",
    "Align left",
    "Align centre",
    "Align right",
    "Centre across selection",
    "Wrap text",
    "Number format…",
    "Increase decimal places",
    "Decrease decimal places",
    "Cell styles…",
    "Column width…",
    "Auto-fit column width",
    "Conditional formatting…",
    "Chart settings…",
    "Clear formatting",
  ],
  Data: [
    "Import CSV…",
    "Import XLSX…",
    "Refresh source…",
    "Recalculate",
    "Pivot tables…",
    "Refresh all pivot tables",
    "Redraw charts",
    "Dropdown settings…",
    "Manage sheets…",
  ],
  View: ["Grid lines"],
  Help: ["Keyboard shortcuts", "File format guide", "Third-party notices"],
};
const browser = await chromium.launch();
try {
  for (const offline of [false, true]) {
    const file = resolve(out, `shell-${offline ? "offline" : "standard"}.html`),
      html = await buildWorkbook(scenarioWorkbook(), { offline });
    await writeFile(file, html);
    if (!offline)
      assert.ok(measureHTML(html).applicationCodeBytes < STANDARD_CODE_CEILING);
    const context = await browser.newContext({
        acceptDownloads: true,
        viewport: { width: 1440, height: 900 },
      }),
      page = await context.newPage(),
      requests = [],
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
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
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    // Menus list exactly the working commands, in order.
    for (const [menu, items] of Object.entries(MENUS)) {
      await openMenu(page, menu);
      assert.deepEqual(
        await page
          .getByRole("menu", { name: menu, exact: true })
          .locator('[role^="menuitem"]')
          .evaluateAll((list) =>
            list.map((el) => el.querySelector(".sh-mlabel").textContent),
          ),
        items,
        menu,
      );
      await page.keyboard.press("Escape");
    }
    // Menu bar keyboard: Left/Right move, Down opens, Left/Right switch menus,
    // Escape closes and returns focus to the trigger.
    const bar = page.getByRole("menubar", { name: "Workbook menu" });
    await bar.getByRole("menuitem", { name: "File", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await active(page), "Edit");
    await page.keyboard.press("ArrowDown");
    // The first enabled item takes focus; Undo has no history yet.
    assert.equal(await active(page), "Paste table…");
    // Type-ahead skips disabled items (Undo) and keeps arrow navigation.
    await page.keyboard.press("u");
    assert.equal(await active(page), "Paste table…");
    await page.keyboard.press("f");
    assert.equal(await active(page), "Fill down");
    await page.keyboard.press("ArrowUp");
    assert.equal(await active(page), "Paste table…");
    await page.keyboard.press("ArrowRight");
    assert.equal(await active(page), "Insert rows");
    await page.keyboard.press("Escape");
    assert.equal(await active(page), "Insert");
    assert.equal(await page.getByRole("menu").count(), 0);
    // The toolbar is one tab stop with arrow keys, Home and End.
    const toolbar = page.getByRole("toolbar", { name: "Formatting" });
    assert.equal(
      await toolbar.locator('button[tabindex="0"]').count(),
      1,
      "one toolbar tab stop",
    );
    await toolbar.getByRole("button", { name: "Clear formatting" }).focus();
    await page.keyboard.press("End");
    assert.equal(await active(page), "Styles");
    // Home reaches the first enabled command (Undo and Redo have no history).
    await page.keyboard.press("Home");
    assert.equal(await active(page), "Copy style");
    // Engine-free formatting from the toolbar, menu buttons and menus.
    await page.locator('#grid [data-cell="B2"]').click();
    await toolbar
      .getByRole("button", { name: "Increase decimal places", exact: true })
      .click();
    const numberFormat = toolbar.getByRole("button", {
      name: /^Number format: /,
    });
    assert.equal(
      await numberFormat.getAttribute("aria-label"),
      "Number format: Currency",
    );
    await numberFormat.focus();
    await page.keyboard.press("ArrowDown");
    await menuItem(page, "Number format", "Percent").waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await active(page), "Number format: Currency");
    await cellStyle(page, "Output");
    assert.equal(
      await toolbar
        .getByRole("button", { name: /^Cell style: / })
        .getAttribute("aria-label"),
      "Cell style: Output",
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page
      .getByText("Undo restored the previous workbook.", { exact: true })
      .waitFor();
    assert.deepEqual(requests, []);
    // Grid lines are a view setting only.
    await toolbar.getByRole("button", { name: "Grid lines" }).click();
    assert.equal(
      await page.locator("#grid").evaluate((el) => el.className),
      "no-grid-lines",
    );
    // Scenario in the formula bar; the calculation state follows.
    await page
      .getByLabel("Scenario", { exact: true })
      .selectOption({ label: "Upside" });
    await page
      .getByText("Calculated locally. Unsaved changes.", { exact: true })
      .waitFor();
    assert.equal(await page.locator("#calc-state").textContent(), "Calculated");
    assert.equal(
      await page.locator('#grid [data-cell="B2"]').textContent(),
      "€300.000",
    );
    assert.equal(requests.length, offline ? 0 : 2);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page
      .getByText("Undo restored the previous workbook.", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await page
      .getByText("Redo restored the previous workbook.", { exact: true })
      .waitFor();
    // Help opens the embedded guide in a native dialog.
    await command(page, "Number format");
    await page.keyboard.press("Escape");
    await openMenu(page, "Help");
    await menuItem(page, "Help", "File format guide").click();
    const help = page.getByRole("dialog", { name: "Help" });
    assert.equal(
      await help.locator('details[data-section="guide"]').getAttribute("open"),
      "",
    );
    assert.equal(await active(page), "Embedded format guide");
    await page.keyboard.press("Escape");
    await page
      .locator("#save-status")
      .filter({ hasText: "Recovery stored" })
      .waitFor();
    const wait = page.waitForEvent("download");
    await command(page, "Save a copy");
    const saved = resolve(
      out,
      `shell-${offline ? "offline" : "standard"}-saved.html`,
    );
    await (await wait).saveAs(saved);
    const text = await readFile(saved, "utf8"),
      book = readHTML(text).book;
    assert.equal(book.sheets[0].cells.B2.result.value, 300);
    assert.equal(book.sheets[0].cells.B2.format.digits, 3);
    // Saved copies carry an empty shell, which mounts afresh on reopen.
    for (const id of ["shell-menus", "shell-toolbar", "sheet-actions"])
      assert.match(text, new RegExp(`id="${id}"[^>]*></`), id);
    assert.doesNotMatch(text, /<div[^>]*class="[^"]*no-grid-lines/);
    await context.setOffline(true);
    await page.goto(pathToFileURL(saved).href);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    assert.equal(await page.getByRole("menubar").count(), 1);
    assert.equal(await page.getByRole("toolbar").count(), 1);
    // Undoing the last change disables Undo; focus stays in the toolbar.
    await toolbar
      .getByRole("button", { name: "Increase decimal places", exact: true })
      .click();
    await toolbar.getByRole("button", { name: "Undo", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page
      .getByText("Undo restored the previous workbook.", { exact: true })
      .waitFor();
    assert.equal(
      await toolbar
        .getByRole("button", { name: "Undo", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await toolbar.evaluate((el) => el.contains(document.activeElement)),
      true,
    );
    // Layout: no page scroll, and the variant A grid density.
    for (const [width, height, rows] of [
      [320, 640, 0],
      [375, 812, 28],
      [768, 1000, 0],
      [1024, 768, 0],
      [1440, 900, 32],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(
        ([w, h]) => innerWidth === w && innerHeight === h,
        [width, height],
      );
      // The grid redraws its viewport on the next frame after a resize.
      await page.evaluate(
        () =>
          new Promise((done) =>
            requestAnimationFrame(() => requestAnimationFrame(done)),
          ),
      );
      const layout = await page.evaluate(() => {
        const grid = document.getElementById("grid").getBoundingClientRect();
        return {
          scroll:
            document.documentElement.scrollWidth > innerWidth ||
            document.documentElement.scrollHeight > innerHeight,
          // Header row included, as the mock-up counts it.
          rows:
            1 +
            [...document.querySelectorAll(".grid-row-head")].filter((head) => {
              const r = head.getBoundingClientRect();
              return r.top >= grid.top && r.bottom <= grid.bottom + 1;
            }).length,
        };
      });
      assert.equal(layout.scroll, false, `page scroll at ${width}px`);
      assert.ok(layout.rows >= rows, `${layout.rows} rows at ${width}px`);
      const narrow = width < 720;
      assert.equal(await bar.isVisible(), !narrow);
      assert.equal(
        await page.getByLabel("Sheet", { exact: true }).isVisible(),
        narrow,
      );
      // Visually collapsed labels keep their accessible names.
      assert.equal(
        await page.getByRole("button", { name: "Save", exact: true }).count(),
        1,
      );
      await toolbar.getByRole("button", { name: "Clear formatting" }).focus();
      await page.keyboard.press("End");
      assert.equal(await active(page), "Styles");
      assert.ok(
        await toolbar
          .getByRole("button", { name: "Styles", exact: true })
          .evaluate((el) => {
            const r = el.getBoundingClientRect(),
              box = el.closest(".sh-tbar").getBoundingClientRect();
            return r.left >= box.left - 1 && r.right <= box.right + 1;
          }),
        `last toolbar item visible at ${width}px`,
      );
      if (narrow) {
        // The input type stays available; the overflow arrows are keyboard
        // items at both ends of the toolbar.
        assert.equal(
          await page.getByLabel("Input type", { exact: true }).isVisible(),
          true,
        );
        const left = toolbar.getByRole("button", {
          name: "Scroll toolbar left",
        });
        // Shown once the scroll position after End is reported.
        await left.waitFor({ state: "visible" });
        // Right from the last command passes the right arrow (while any
        // overflow remains) and wraps to the left arrow.
        for (let step = 0; step < 2; step++) {
          await page.keyboard.press("ArrowRight");
          if ((await active(page)) === "Scroll toolbar left") break;
        }
        assert.equal(await active(page), "Scroll toolbar left");
        const before = await toolbar
          .locator(".sh-tscroll")
          .evaluate((el) => el.scrollLeft);
        await page.keyboard.press("Enter");
        await page.waitForFunction(
          (start) =>
            document.querySelector(".sh-tscroll").scrollLeft < start - 10,
          before,
        );
        await page.getByRole("button", { name: "Menu", exact: true }).click();
        await page
          .getByRole("menu", { name: "Menu" })
          .getByRole("menuitem", { name: "Manage sheets…" })
          .click();
        await page
          .getByRole("button", { name: "Close sheet manager", exact: true })
          .click();
        await page
          .getByLabel("Sheet", { exact: true })
          .selectOption({ label: "Inputs" });
        assert.equal(
          await page.getByLabel("Sheet", { exact: true }).inputValue(),
          "inputs",
        );
      }
      await page.screenshot({
        path: resolve(
          out,
          `shell-${offline ? "offline" : "standard"}-${width}.png`,
        ),
      });
    }
    // Print hides all chrome and keeps the grid a bounded viewport.
    await page.emulateMedia({ media: "print" });
    assert.equal(await page.locator("#shell-root").isVisible(), false);
    assert.equal(await page.locator(".formula-bar").isVisible(), false);
    assert.ok(
      await page
        .locator("#grid")
        .evaluate((el) => el.clientHeight <= innerHeight),
    );
    // Bounded by the page: the visible rows and columns plus a small margin.
    await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        ),
    );
    const [cells, bound] = await page.evaluate(() => [
      document.querySelectorAll("#grid [data-cell]").length,
      (Math.ceil(innerHeight / 23) + 5) * (Math.ceil(innerWidth / 100) + 5),
    ]);
    assert.ok(cells <= bound, `${cells} cells rendered for print`);
    await page.emulateMedia({ media: "screen" });
    // A workbook without formulas has nothing to calculate.
    const plain = scenarioWorkbook();
    for (const sheet of plain.sheets)
      for (const [ref, cell] of Object.entries(sheet.cells))
        if (cell.formula) delete sheet.cells[ref];
    delete plain.conditionalFormats;
    const plainFile = resolve(out, "shell-no-formulas.html");
    await writeFile(
      plainFile,
      await buildWorkbook(plain, { offline, calculate: false }),
    );
    await page.goto(pathToFileURL(plainFile).href);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    assert.equal(await page.locator("#calc-state").textContent(), "Calculated");
    // Typing into an empty cell's value picks a type, as the grid does.
    await page.getByLabel("Cell address", { exact: true }).fill("D9");
    await page.getByLabel("Cell address", { exact: true }).press("Enter");
    assert.equal(
      await page.getByLabel("Input type", { exact: true }).inputValue(),
      "blank",
    );
    await page.getByLabel("Cell value", { exact: true }).fill("42");
    assert.equal(
      await page.getByLabel("Input type", { exact: true }).inputValue(),
      "number",
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `PASS shell ${offline ? "offline" : "standard"}: menus, keyboard, engine-free formatting, scenario/history, fresh shell after reopen, variant A density and print`,
    );
  }
} finally {
  await browser.close();
}
