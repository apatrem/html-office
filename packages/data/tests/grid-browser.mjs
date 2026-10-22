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
import { readHTML } from "../bench/storage/html.mjs";
import { large } from "../fixtures/generate.mjs";
import { command } from "./shell.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const book = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ acceptDownloads: true }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  const file = resolve(out, "grid.html");
  await writeFile(file, await buildWorkbook(book, { offline: true }));
  await page.goto(pathToFileURL(file).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  const grid = page.locator("#grid");
  await grid.focus();
  await page.keyboard.press("Tab");
  assert.equal(
    await grid.evaluate((el) => el === document.activeElement),
    false,
  );
  await grid.focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByLabel("Cell address").inputValue(), "C2");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowRight");
  assert.match(await grid.getAttribute("aria-label"), /C2:D3/);
  assert.equal(await grid.locator('[aria-selected="true"]').count(), 4);
  await page.keyboard.press("F2");
  await page.getByLabel("Cell value").fill("do not commit");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByLabel("Cell value").inputValue(), "");
  await page.locator('[data-cell="B2"]').dblclick();
  assert.equal(
    await page
      .getByLabel("Cell value")
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.getByLabel("Cell value").fill("145");
  await page.keyboard.press("Enter");
  await page
    .getByText("Calculated locally. Unsaved changes.", { exact: true })
    .waitFor();
  assert.equal(
    await grid.evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByLabel("Cell address").inputValue(), "C2");
  await page.keyboard.press("F2");
  await page.getByLabel("Cell value").fill("abc");
  await page.keyboard.press("Enter");
  await page
    .getByText("Calculated locally. Unsaved changes.", { exact: true })
    .waitFor();
  assert.equal(await page.locator('[data-cell="C2"]').textContent(), "abc");
  await page.getByLabel("Cell address").fill("C5");
  await page.getByLabel("Cell value").fill("=UNSUPPORTED_FUNCTION(1)");
  await page.getByLabel("Input type").selectOption("formula");
  await page.getByRole("button", { name: "Apply edit", exact: true }).click();
  await page
    .getByText("Calculated locally. Unsaved changes.", { exact: true })
    .waitFor();
  assert.match(await page.locator('[data-cell="C5"]').textContent(), /#NAME\?/);
  const download = page.waitForEvent("download");
  await command(page, "Save a copy");
  const saved = resolve(out, "grid-saved.html");
  await (await download).saveAs(saved);
  const result = readHTML(await readFile(saved, "utf8")).book;
  assert.equal(result.sheets[0].cells.B2.input.value, 145);
  assert.equal(result.sheets[0].cells.C5.formula, "=UNSUPPORTED_FUNCTION(1)");
  assert.deepEqual(result.sheets[0].cells.A1, book.sheets[0].cells.A1);
  await context.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS grid: keyboard, rectangular selection, edit/cancel, typed formula errors and save preservation",
  );
  const blocked = await browser.newContext({ acceptDownloads: true }),
    failed = await blocked.newPage();
  failed.on("dialog", (d) => d.accept());
  await blocked.route("https://raw.githubusercontent.com/**", (route) =>
    route.fulfill({
      status: 503,
      body: "unavailable",
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  const blockedFile = resolve(out, "grid-cancelled-attempt.html");
  await writeFile(blockedFile, await buildWorkbook(book));
  await failed.goto(pathToFileURL(blockedFile).href);
  await failed
    .getByText("Saved results are current.", { exact: true })
    .waitFor();
  await failed.getByLabel("Cell value").fill("999");
  await failed.getByRole("button", { name: "Apply edit", exact: true }).click();
  await failed
    .locator("#status")
    .filter({ hasText: "Your attempted edit remains" })
    .waitFor();
  await failed.getByLabel("Cell value").focus();
  await failed.keyboard.press("Escape");
  assert.equal(await failed.getByLabel("Cell value").inputValue(), "100");
  await failed
    .locator("#save-status")
    .filter({ hasText: "Recovery stored" })
    .waitFor();
  const cancelledDownload = failed.waitForEvent("download");
  await command(failed, "Save a copy");
  const cancelledFile = resolve(out, "grid-cancelled-copy.html");
  await (await cancelledDownload).saveAs(cancelledFile);
  assert.equal(
    readHTML(await readFile(cancelledFile, "utf8")).book.sheets[0].cells.B2
      .input.value,
    100,
  );
  await failed.reload();
  await failed.getByRole("dialog").waitFor();
  await failed
    .getByRole("button", { name: "Restore draft", exact: true })
    .click();
  assert.equal(await failed.getByLabel("Cell value").inputValue(), "100");
  await blocked.close();
  console.log(
    "PASS grid: Escape discards a failed pending edit in form, copy and recovery",
  );
  const largeBook = large({ rows: 100000, columns: 8, preaggregate: true });
  const html = await buildWorkbook(largeBook, { calculate: false });
  assert.ok(measureHTML(html).applicationCodeBytes < STANDARD_CODE_CEILING);
  const largeFile = resolve(out, "grid-large.html");
  await writeFile(largeFile, html);
  const ctx = await browser.newContext(),
    p = await ctx.newPage();
  let requests = 0;
  ctx.on("request", (r) => {
    if (r.url().startsWith("http")) requests++;
  });
  await p.goto(pathToFileURL(largeFile).href);
  await p.locator('[data-cell="B2"]').waitFor();
  await p.locator("#grid").focus();
  const start = performance.now();
  await p.keyboard.press("Control+End");
  await p.locator('[data-cell="H100000"]').waitFor();
  const elapsed = performance.now() - start;
  assert.equal(await p.getByLabel("Cell address").inputValue(), "H100000");
  assert.ok((await p.locator("#grid [data-cell]").count()) < 600);
  assert.equal(requests, 0);
  await p.keyboard.press("Control+Home");
  await p.locator('[data-cell="A1"]').waitFor();
  await p.screenshot({
    path: resolve(out, "grid-viewport.png"),
    fullPage: false,
  });
  await ctx.close();
  console.log(
    `PASS grid: 100k×8 navigation ${Math.round(elapsed)} ms, bounded DOM and no network`,
  );
} finally {
  await browser.close();
}
