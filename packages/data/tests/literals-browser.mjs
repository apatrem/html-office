import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { readHTML } from "../bench/storage/html.mjs";
import { command } from "./shell.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const book = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
for (const ref of ["C1", "C2", "C3"])
  book.sheets[0].cells[ref] = {
    input: { type: "number", value: 100 },
    cellStyle: "normal",
    format: { kind: "number", digits: 0 },
  };
const file = resolve(out, "literals.html");
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
  const choose = async (ref) => {
    await page.getByLabel("Cell address", { exact: true }).fill(ref);
    await page.getByLabel("Cell value", { exact: true }).focus();
  };
  await choose("C1");
  await page.getByLabel("Cell value", { exact: true }).fill("140");
  await page.getByRole("button", { name: "Apply edit", exact: true }).click();
  await page
    .getByText("Calculated locally. Unsaved changes.", { exact: true })
    .waitFor();
  assert.equal(await page.locator('[data-cell="C1"]').textContent(), "140");
  assert.equal(await page.locator('[data-cell="C2"]').textContent(), "100");
  await choose("C2");
  await page
    .getByRole("button", { name: "Increase decimal places", exact: true })
    .click();
  assert.equal(await page.locator('[data-cell="C2"]').textContent(), "100.0");
  assert.equal(await page.locator('[data-cell="C3"]').textContent(), "100");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page
    .getByText("Undo restored the previous workbook.", { exact: true })
    .waitFor();
  assert.equal(await page.locator('[data-cell="C1"]').textContent(), "100");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page
    .getByText("Redo restored the previous workbook.", { exact: true })
    .waitFor();
  const wait = page.waitForEvent("download");
  await command(page, "Save a copy");
  const saved = resolve(out, "literals-saved.html");
  await (await wait).saveAs(saved);
  const result = readHTML(await readFile(saved, "utf8")).book;
  assert.equal(result.sheets[0].cells.C1.input.value, 140);
  assert.equal(result.sheets[0].cells.C2.input.value, 100);
  assert.equal(result.sheets[0].cells.C3.input.value, 100);
  await context.setOffline(true);
  await page.goto(pathToFileURL(saved).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  assert.equal(await page.locator('[data-cell="C1"]').textContent(), "140");
  assert.equal(await page.locator('[data-cell="C2"]').textContent(), "100");
  assert.deepEqual(errors, []);
  await context.close();
  console.log(
    "PASS literal reuse: repeated inputs edit/format/undo independently and save/reopen with distinct values",
  );
} finally {
  await browser.close();
}
