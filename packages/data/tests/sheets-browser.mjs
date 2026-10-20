import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook, measureHTML } from "../tools/build.mjs";
import { readHTML } from "../bench/storage/html.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const book = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
const file = resolve(out, "sheets.html");
await writeFile(file, await buildWorkbook(book, { offline: true }));
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ acceptDownloads: true }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(pathToFileURL(file).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  const manager = async () =>
    page.getByRole("button", { name: "Manage sheets", exact: true }).click();
  const undo = async () => {
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page
      .getByText("Undo restored the previous workbook.", { exact: true })
      .waitFor();
  };
  const redo = async () => {
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await page
      .getByText("Redo restored the previous workbook.", { exact: true })
      .waitFor();
  };
  const save = async (name) => {
    const wait = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save a copy", exact: true })
      .click();
    const target = resolve(out, name);
    await (await wait).saveAs(target);
    return {
      file: target,
      book: readHTML(await readFile(target, "utf8")).book,
    };
  };
  // Group navigation is keyboard-accessible and does not hide the current grid.
  const collapse = page.getByRole("button", {
    name: "Collapse Inputs / Hypotheses",
    exact: true,
  });
  await collapse.focus();
  await page.keyboard.press("Enter");
  assert.equal(
    await page
      .getByRole("button", { name: "Expand Inputs / Hypotheses", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
  );
  assert.equal(
    await page.getByRole("button", { name: "Inputs", exact: true }).count(),
    0,
  );
  assert.match(await page.locator("#current-sheet").textContent(), /Inputs/);
  await undo();
  assert.equal(
    await page.getByRole("button", { name: "Inputs", exact: true }).count(),
    1,
  );
  await page
    .getByRole("button", { name: "Move Raw Data group earlier", exact: true })
    .click();
  // Move selected Inputs to Calculations and retain the selected sheet and grey tabs.
  await manager();
  await page
    .getByLabel("Destination group", { exact: true })
    .selectOption({ label: "Calculations" });
  await page
    .getByRole("button", { name: "Move to group", exact: true })
    .click();
  assert.equal(
    await page
      .locator(".calculations")
      .getByRole("button", { name: "Inputs", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page
      .locator(".calculations")
      .getByRole("button", { name: "Inputs", exact: true })
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(90, 102, 112)",
  );
  // Create and rename a sheet, including quoted cross-sheet formula rewrites.
  await manager();
  await page.getByLabel("Sheet name", { exact: true }).fill("Forecast");
  await page.getByRole("button", { name: "Create sheet", exact: true }).click();
  await page
    .getByText("Sheet references updated. Unsaved changes.", { exact: true })
    .waitFor();
  assert.equal(
    await page.locator("#current-sheet").textContent(),
    "Sheet: Forecast",
  );
  await page.getByLabel("Input type").selectOption("formula");
  await page.getByLabel("Cell value", { exact: true }).fill("=Inputs!B2");
  await page.getByRole("button", { name: "Apply edit", exact: true }).click();
  await page
    .getByText("Calculated locally. Unsaved changes.", { exact: true })
    .waitFor();
  await undo();
  await undo();
  assert.equal(
    await page.getByRole("button", { name: "Forecast", exact: true }).count(),
    0,
  );
  await redo();
  await redo();
  assert.equal(await page.locator('[data-cell="A1"]').textContent(), "100");
  assert.equal(
    await page.locator("#current-sheet").textContent(),
    "Sheet: Forecast",
  );
  await page.getByRole("button", { name: "Inputs", exact: true }).click();
  await manager();
  await page
    .getByLabel("Sheet name", { exact: true })
    .fill("Next year's Inputs");
  await page
    .getByRole("button", { name: "Rename selected sheet", exact: true })
    .click();
  await page
    .getByText("Sheet references updated. Unsaved changes.", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Summary", exact: true }).click();
  await page.locator('[data-cell="B2"]').click();
  assert.equal(
    await page.getByLabel("Cell value", { exact: true }).inputValue(),
    "='Next year''s Inputs'!B2*'Next year''s Inputs'!B3",
  );
  assert.match(await page.locator('[data-cell="B2"]').textContent(), /2,500/);
  await undo();
  await redo();
  // Reorder sheets inside Calculations; then persist a collapsed group.
  await manager();
  await page
    .getByRole("button", { name: "Close sheet manager", exact: true })
    .click();
  await page.getByRole("button", { name: "Forecast", exact: true }).click();
  await manager();
  await page
    .getByRole("button", { name: "Move sheet earlier", exact: true })
    .click();
  assert.deepEqual(
    await page.locator(".calculations .group-tabs button").allTextContents(),
    ["Forecast", "Next year's Inputs"],
  );
  await page
    .getByRole("button", { name: "Collapse Calculations", exact: true })
    .click();
  await page
    .locator("#save-status")
    .filter({ hasText: "Recovery stored." })
    .waitFor();
  const saved = await save("sheets-saved.html");
  assert.equal(saved.book.sheets[0].id, "inputs");
  assert.equal(saved.book.sheets[0].cells.B2.input.value, 100);
  assert.equal(
    saved.book.groups.find((g) => g.kind === "calculations").collapsed,
    true,
  );
  assert.equal(saved.book.groups[1].kind, "raw");
  assert.deepEqual(
    saved.book.groups.find((g) => g.kind === "calculations").sheetIds,
    [saved.book.sheets[2].id, "inputs"],
  );
  await page.goto(pathToFileURL(file).href);
  await page
    .getByRole("button", { name: "Restore draft", exact: true })
    .click();
  assert.deepEqual((await save("sheets-recovered.html")).book, saved.book);
  await context.setOffline(true);
  await page.goto(pathToFileURL(saved.file).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Expand Calculations", exact: true })
      .count(),
    1,
  );
  await page
    .getByRole("button", { name: "Expand Calculations", exact: true })
    .click();
  await page.getByRole("button", { name: "Summary", exact: true }).click();
  assert.match(await page.locator('[data-cell="B2"]').textContent(), /2,500/);
  await page.screenshot({ path: resolve(out, "sheets.png"), fullPage: true });
  assert.deepEqual(errors, []);
  await context.close();
  // Standard mode must allow metadata navigation with every dependency blocked.
  const standard = resolve(out, "sheets-standard.html"),
    html = await buildWorkbook(book);
  await writeFile(standard, html);
  assert.ok(measureHTML(html).applicationCodeBytes < 500000);
  const offline = await browser.newContext({ acceptDownloads: true }),
    p = await offline.newPage(),
    requests = [];
  await offline.route("https://**", (r) => {
    requests.push(r.request().url());
    return r.abort();
  });
  await p.goto(pathToFileURL(standard).href);
  await p.getByText("Saved results are current.", { exact: true }).waitFor();
  await p
    .getByRole("button", { name: "Collapse Summary", exact: true })
    .click();
  await p
    .getByRole("button", {
      name: "Move Calculations group earlier",
      exact: true,
    })
    .click();
  await p.getByRole("button", { name: "Undo", exact: true }).click();
  assert.deepEqual(requests, []);
  await offline.close();
  for (const type of ["create", "rename"])
    for (const mode of ["cancel", "error"]) {
      const c = await browser.newContext({ acceptDownloads: true }),
        p = await c.newPage(),
        pageErrors = [];
      p.on("pageerror", (e) => pageErrors.push(e.message));
      p.on("dialog", (d) => d.accept());
      await p.goto(pathToFileURL(file).href);
      await p
        .getByText("Saved results are current.", { exact: true })
        .waitFor();
      const copy = async (suffix) => {
        const wait = p.waitForEvent("download");
        await p
          .getByRole("button", { name: "Save a copy", exact: true })
          .click();
        const path = resolve(out, `sheets-${type}-${mode}-${suffix}.html`);
        await (await wait).saveAs(path);
        return readHTML(await readFile(path, "utf8")).book;
      };
      const before = await copy("before");
      await p.evaluate((mode) => {
        const descriptor = Object.getOwnPropertyDescriptor(
          Worker.prototype,
          "onmessage",
        );
        Object.defineProperty(Worker.prototype, "onmessage", {
          configurable: true,
          get: descriptor.get,
          set(handler) {
            descriptor.set.call(this, (event) => {
              if (event.data.value?.formulas && !globalThis.interceptedSheet) {
                globalThis.interceptedSheet = true;
                if (mode === "cancel")
                  return setTimeout(() => handler(event), 600);
                return handler({
                  data: {
                    id: event.data.id,
                    error: "Injected sheet publication failure",
                  },
                });
              }
              handler(event);
            });
          },
        });
      }, mode);
      const attempt = async () => {
        await p
          .getByRole("button", { name: "Manage sheets", exact: true })
          .click();
        await p.getByLabel("Sheet name", { exact: true }).fill("Revised");
        await p
          .getByRole("button", {
            name: type === "create" ? "Create sheet" : "Rename selected sheet",
            exact: true,
          })
          .click();
      };
      await attempt();
      await p.waitForFunction(() => globalThis.interceptedSheet);
      if (mode === "cancel")
        await p
          .getByRole("button", { name: "Cancel calculation", exact: true })
          .click();
      else
        await p
          .locator("#status")
          .filter({ hasText: "Injected sheet publication failure" })
          .waitFor();
      await p
        .getByRole("button", { name: "Close sheet manager", exact: true })
        .click();
      assert.deepEqual(await copy("kept"), before);
      await attempt();
      await p
        .getByText("Sheet references updated. Unsaved changes.", {
          exact: true,
        })
        .waitFor();
      const retried = await copy("retry");
      assert.equal(retried.sheets.length, type === "create" ? 3 : 2);
      assert.equal(
        retried.sheets.filter((s) => s.name === "Revised").length,
        1,
      );
      assert.deepEqual(pageErrors, []);
      await c.close();
      console.log(
        `PASS sheets: ${type} ${mode} after engine mutation preserves canonical workbook; retry applies once`,
      );
    }
  console.log(
    "PASS sheets: create/quoted rename/move/order/collapse, history, stable IDs, offline reopen and local navigation",
  );
} finally {
  await browser.close();
}
