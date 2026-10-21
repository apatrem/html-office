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
);
book.names = [
  { name: "Metric", sheetId: "inputs", ref: "B2" },
  { name: "Block", sheetId: "inputs", ref: "B2:B3" },
];
book.sheets[1].cells.C2 = { formula: "=Metric+Inputs!$B$2+Inputs!B$3" };
book.sheets[1].cells.D2 = { formula: "=Metric" };
book.sheets[0].cells.H10 = {
  input: { type: "date", value: 46023 },
  format: { kind: "date" },
};
const html = await buildWorkbook(book, { offline: true }),
  browser = await chromium.launch();
async function ready(id) {
  const context = await browser.newContext({ acceptDownloads: true }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  const file = resolve(out, `structure-${id}.html`);
  await writeFile(file, html);
  await page.goto(pathToFileURL(file).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  return { context, page, errors };
}
async function jump(page, ref) {
  await page.getByLabel("Cell address").fill(ref);
  await page.keyboard.press("Tab");
  await page.locator("#grid").focus();
}
async function copy(page, name) {
  const wait = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save a copy" }).click();
  const file = resolve(out, name);
  await (await wait).saveAs(file);
  return { book: readHTML(await readFile(file, "utf8")).book, file };
}
const updated = (page) =>
  page
    .getByText("Row/column references updated. Unsaved changes.", {
      exact: true,
    })
    .waitFor();
try {
  for (const axis of ["row", "column"]) {
    const { context, page, errors } = await ready(axis),
      plural = axis === "row" ? "rows" : "columns";
    await page
      .getByRole("button", { name: `Insert ${plural}`, exact: true })
      .click();
    await updated(page);
    let saved = (await copy(page, `structure-${axis}-insert.html`)).book;
    assert.equal(saved.names[0].ref, axis === "row" ? "B3" : "C2");
    assert.equal(saved.sheets[1].cells.C2.result.value, 225);
    assert.deepEqual(saved.groups, book.groups);
    const moved = axis === "row" ? "B3" : "C2";
    assert.equal(saved.sheets[0].cells[moved].input.value, 100);
    assert.equal(saved.sheets[0].cells[moved].cellStyle, "assumption");
    await jump(page, axis === "row" ? "B3" : "C2");
    await page
      .getByRole("button", { name: `Delete ${plural}`, exact: true })
      .click();
    await updated(page);
    saved = (await copy(page, `structure-${axis}-deleted.html`)).book;
    assert.equal(saved.names[0].ref, "#REF!");
    assert.equal(saved.names[1].ref, axis === "row" ? "B3" : "#REF!");
    assert.deepEqual(saved.sheets[1].cells.D2.result, {
      type: "error",
      value: "#REF!",
    });
    await page.getByRole("button", { name: "Summary", exact: true }).click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page
      .getByText("Undo restored the previous workbook.", { exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel("Cell address").inputValue(),
      axis === "row" ? "B3" : "C2",
    );
    assert.equal(await page.getByLabel("Cell value").inputValue(), "100");
    let undone = (await copy(page, `structure-${axis}-undone.html`)).book;
    assert.equal(undone.names[0].ref, moved);
    assert.equal(undone.sheets[1].cells.D2.result.value, 100);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await page
      .getByText("Redo restored the previous workbook.", { exact: true })
      .waitFor();
    await page
      .locator("#save-status")
      .filter({ hasText: "Recovery stored" })
      .waitFor();
    const final = await copy(page, `structure-${axis}-final.html`);
    assert.equal(final.book.sheets.length, 2);
    assert.equal(JSON.stringify(final.book).includes("__office"), false);
    await page.reload();
    await page
      .getByRole("dialog")
      .filter({ hasText: "Recover unsaved work" })
      .waitFor();
    await page
      .getByRole("button", { name: "Restore draft", exact: true })
      .click();
    assert.deepEqual(
      (await copy(page, `structure-${axis}-recovered.html`)).book,
      final.book,
    );
    await context.setOffline(true);
    await page.goto(pathToFileURL(final.file).href);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Recalculate", exact: true })
      .click();
    await page
      .getByText("Calculated locally. Unsaved changes.", { exact: true })
      .waitFor();
    assert.deepEqual(
      (await copy(page, `structure-${axis}-reopened.html`)).book.sheets[1].cells
        .D2.result,
      { type: "error", value: "#REF!" },
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `PASS structure: ${axis} references, names, undo/redo, recovery and offline reopen`,
    );
  }
  {
    const { context, page, errors } = await ready("pending");
    await page.evaluate(() => {
      const post = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (message) {
        if (message.method === "calculate" && !globalThis.failedOnce) {
          globalThis.failedOnce = true;
          return setTimeout(
            () =>
              this.dispatchEvent(
                new MessageEvent("message", {
                  data: { id: message.id, error: "Injected input failure" },
                }),
              ),
            0,
          );
        }
        return post.call(this, message);
      };
    });
    await page.getByLabel("Cell value").fill("140");
    await page.getByRole("button", { name: "Apply edit", exact: true }).click();
    await page
      .locator("#status")
      .filter({ hasText: "Injected input failure" })
      .waitFor();
    await page
      .getByRole("button", { name: "Insert rows", exact: true })
      .click();
    await updated(page);
    await page
      .locator("#save-status")
      .filter({ hasText: "Recovery stored" })
      .waitFor();
    const saved = (await copy(page, "structure-prior-pending.html")).book;
    assert.equal(saved.sheets[0].cells.B3.input.value, 100);
    assert.equal(saved.sheets[1].cells.B2.result.value, 2500);
    await page.reload();
    await page
      .getByRole("dialog")
      .filter({ hasText: "Recover unsaved work" })
      .waitFor();
    await page
      .getByRole("button", { name: "Restore draft", exact: true })
      .click();
    assert.deepEqual(
      (await copy(page, "structure-prior-pending-recovered.html")).book,
      saved,
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS structure: previous failed edits cannot become shifted ghost values in recovery",
    );
  }
  for (const mode of ["cancel", "error"]) {
    const { context, page, errors } = await ready(mode),
      before = (await copy(page, `structure-${mode}-before.html`)).book;
    await page.evaluate((mode) => {
      const descriptor = Object.getOwnPropertyDescriptor(
        Worker.prototype,
        "onmessage",
      );
      Object.defineProperty(Worker.prototype, "onmessage", {
        configurable: true,
        get: descriptor.get,
        set(handler) {
          descriptor.set.call(this, (event) => {
            if (
              event.data.value?.formulas &&
              !globalThis.interceptedStructure
            ) {
              globalThis.interceptedStructure = true;
              if (mode === "cancel")
                return setTimeout(() => handler(event), 600);
              return handler({
                data: {
                  id: event.data.id,
                  error: "Injected structural publication failure",
                },
              });
            }
            handler(event);
          });
        },
      });
    }, mode);
    await page
      .getByRole("button", { name: "Insert rows", exact: true })
      .click();
    await page.waitForFunction(() => globalThis.interceptedStructure);
    if (mode === "cancel") {
      await page
        .getByRole("button", { name: "Cancel calculation", exact: true })
        .click();
      await page
        .getByText(
          "Row/column operation cancelled. Your previous work is retained.",
          { exact: true },
        )
        .waitFor();
    } else
      await page
        .locator("#status")
        .filter({ hasText: "Injected structural publication failure" })
        .waitFor();
    assert.deepEqual(
      (await copy(page, `structure-${mode}-kept.html`)).book,
      before,
    );
    await page
      .getByRole("button", { name: "Insert rows", exact: true })
      .click();
    await updated(page);
    const saved = (await copy(page, `structure-${mode}-retried.html`)).book;
    assert.equal(saved.sheets[0].cells.B3.input.value, 100);
    assert.equal(saved.sheets[0].cells.B4.input.value, 25);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `PASS structure: ${mode} after engine mutation never publishes partial state; retry applies once`,
    );
  }
} finally {
  await browser.close();
}
