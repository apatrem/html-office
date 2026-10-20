import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { readHTML } from "../bench/storage/html.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const book = JSON.parse(
    await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
  ),
  file = resolve(out, "history.html");
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
  const enter = async (ref, value) => {
    await page.getByLabel("Cell address").fill(ref);
    await page.getByLabel("Cell value").focus();
    await page.getByLabel("Cell value").fill(value);
    await page.getByRole("button", { name: "Apply edit", exact: true }).click();
    await page
      .getByText("Calculated locally. Unsaved changes.", { exact: true })
      .waitFor();
  };
  const total = async (expected) => {
    await page.getByRole("button", { name: "Summary", exact: true }).click();
    assert.match(
      await page.locator('[data-cell="B2"]').textContent(),
      new RegExp(expected),
    );
  };
  await enter("B2", "140");
  await enter("B3", "30");
  await total("4,200");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page
    .getByText("Undo restored the previous workbook.", { exact: true })
    .waitFor();
  assert.equal(await page.getByLabel("Cell address").inputValue(), "B3");
  assert.equal(await page.getByLabel("Cell value").inputValue(), "25");
  await total("3,500");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page
    .getByText("Redo restored the previous workbook.", { exact: true })
    .waitFor();
  assert.equal(await page.getByLabel("Cell address").inputValue(), "B3");
  assert.equal(await page.getByLabel("Cell value").inputValue(), "30");
  await total("4,200");
  await page.locator("#grid").focus();
  await page.keyboard.press("Control+z");
  await page
    .getByText("Undo restored the previous workbook.", { exact: true })
    .waitFor();
  await page.locator("#grid").focus();
  await page.keyboard.press("Control+Shift+z");
  await page
    .getByText("Redo restored the previous workbook.", { exact: true })
    .waitFor();
  // Formatting history never changes the numeric input, formula or result.
  await page
    .getByRole("button", { name: "More decimals", exact: true })
    .click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  // Cancelled and failed recalculation must retain the known restored state.
  await enter("B3", "35");
  await page.evaluate(() => {
    const post = Worker.prototype.postMessage;
    globalThis.historyMode = "delay";
    Worker.prototype.postMessage = function (message) {
      if (
        message.method === "calculate" &&
        globalThis.historyMode === "delay"
      ) {
        globalThis.historyMode = "normal";
        return setTimeout(() => post.call(this, message), 500);
      }
      if (message.method === "calculate" && globalThis.historyMode === "fail") {
        globalThis.historyMode = "normal";
        return setTimeout(
          () =>
            this.dispatchEvent(
              new MessageEvent("message", {
                data: { id: message.id, error: "Injected redo failure" },
              }),
            ),
          0,
        );
      }
      return post.call(this, message);
    };
  });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page
    .getByRole("button", { name: "Cancel calculation", exact: true })
    .click();
  assert.equal(await page.getByLabel("Cell value").inputValue(), "30");
  await page.evaluate(() => (globalThis.historyMode = "fail"));
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page
    .locator("#status")
    .filter({ hasText: "Injected redo failure" })
    .waitFor();
  assert.equal(await page.getByLabel("Cell value").inputValue(), "35");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page
    .getByText("Undo restored the previous workbook.", { exact: true })
    .waitFor();
  assert.equal(await page.getByLabel("Cell value").inputValue(), "30");
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save a copy" }).click();
  const saved = resolve(out, "history-saved.html");
  await (await waiting).saveAs(saved);
  const result = readHTML(await readFile(saved, "utf8")).book;
  assert.equal(result.sheets[0].cells.B2.input.value, 140);
  assert.equal(result.sheets[0].cells.B3.input.value, 30);
  assert.equal(result.sheets[1].cells.B2.result.value, 4200);
  assert.equal(result.sheets[0].cells.B3.format.digits, 3);
  assert.deepEqual(result.sheets[0].cells.A1, book.sheets[0].cells.A1);
  await context.setOffline(true);
  await page.goto(pathToFileURL(saved).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  await total("4,200");
  assert.deepEqual(errors, []);
  await context.close();
  console.log(
    "PASS history: multi-sheet undo/redo restores selection, recalculates, formats and saves/reopens",
  );
} finally {
  await browser.close();
}
