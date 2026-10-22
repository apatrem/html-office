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
import { fingerprint } from "../model/workbook.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const book = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
book.locale = "fr-FR";
book.sheets[0].cells.C2 = { input: { type: "number", value: -1234.56789 } };
book.sheets[0].cells.C3 = { input: { type: "date", value: 60.5 } };
const source = resolve(out, "format.html"),
  html = await buildWorkbook(book);
await writeFile(source, html);
assert.ok(measureHTML(html).applicationCodeBytes < STANDARD_CODE_CEILING);
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ acceptDownloads: true }),
    page = await context.newPage(),
    errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.route(/^https?:\/\//, (r) => {
    requests.push(r.request().url());
    return r.abort();
  });
  page.on("dialog", (d) => d.accept());
  await page.goto(pathToFileURL(source).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  const styles = await page.locator('[data-cell="A1"]').evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor,
    color: getComputedStyle(el).color,
    font: getComputedStyle(el).fontFamily,
  }));
  assert.equal(styles.background, "rgb(11, 28, 44)");
  assert.equal(styles.color, "rgb(255, 255, 255)");
  assert.match(styles.font, /Arial/);
  assert.equal(
    await page
      .locator('[data-cell="B2"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(255, 246, 216)",
  );
  assert.equal(
    await page.locator('[data-cell="C3"]').textContent(),
    "29/02/1900",
  );
  const select = async (ref) => {
    await page.getByLabel("Cell address", { exact: true }).fill(ref);
    await page.getByLabel("Cell value", { exact: true }).focus();
  };
  await select("B2");
  await page.locator("#grid").focus();
  await page.keyboard.press("Shift+ArrowRight");
  await page
    .getByLabel("Cell style", { exact: true })
    .selectOption("assumption");
  await page
    .getByLabel("Number format", { exact: true })
    .selectOption("currency");
  await page.getByLabel("Decimal places", { exact: true }).fill("3");
  await page.getByLabel("Currency code", { exact: true }).fill("USD");
  await page
    .getByRole("button", { name: "Format selection", exact: true })
    .click();
  assert.match(
    await page.locator('[data-cell="C2"]').textContent(),
    /-1\u202f234,568/,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(
    await page.locator('[data-cell="C2"]').textContent(),
    "-1234.56789",
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  assert.match(
    await page.locator('[data-cell="C2"]').textContent(),
    /-1\u202f234,568/,
  );
  await page.getByLabel("Decimal places", { exact: true }).fill("16");
  await page
    .getByRole("button", { name: "Format selection", exact: true })
    .click();
  await page
    .locator("#status")
    .filter({ hasText: "Formatting not applied: Invalid digits" })
    .waitFor();
  assert.match(
    await page.locator('[data-cell="C2"]').textContent(),
    /-1\u202f234,568/,
  );
  await page.screenshot({ path: resolve(out, "format.png"), fullPage: true });
  const wait = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  const saved = resolve(out, "format-saved.html");
  await (await wait).saveAs(saved);
  const result = readHTML(await readFile(saved, "utf8")).book;
  assert.equal(await fingerprint(result), await fingerprint(book));
  assert.equal(result.sheets[0].cells.C2.input.value, -1234.56789);
  assert.equal(result.sheets[0].cells.B2.format.currency, "USD");
  assert.equal(result.sheets[0].cells.C2.format.digits, 3);
  assert.deepEqual(
    result.sheets[1].cells.B2.formula,
    book.sheets[1].cells.B2.formula,
  );
  await context.setOffline(true);
  await page.goto(pathToFileURL(saved).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  assert.match(
    await page.locator('[data-cell="C2"]').textContent(),
    /-1\u202f234,568/,
  );
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  await context.close();
  // An older custom Slides brand stylesheet without Office role tokens remains sufficient.
  const brand = resolve(out, "format-charte.css");
  await writeFile(
    brand,
    ":root{--ink:#123456;--acc:#245678;--lig:#abcdef;--alert:#654321;--tint:#eeeeee;--callout:#ffeedd;--bd:#cccccc;--t2:#555555;--bg:#ffffff;--font:Georgia,serif}",
  );
  const custom = resolve(out, "format-custom.html");
  await writeFile(custom, await buildWorkbook(book, { charte: brand }));
  const p = await browser.newPage();
  await p.goto(pathToFileURL(custom).href);
  await p.getByText("Saved results are current.", { exact: true }).waitFor();
  assert.equal(
    await p
      .locator('[data-cell="A1"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(18, 52, 86)",
  );
  assert.equal(
    await p
      .locator('[data-cell="B2"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgb(255, 238, 221)",
  );
  assert.match(
    await p
      .locator('[data-cell="A1"]')
      .evaluate((el) => getComputedStyle(el).fontFamily),
    /Georgia/,
  );
  await p.close();
  console.log(
    "PASS formatting: shared brand, locale/date/precision, rectangle undo/redo and offline save without engine requests",
  );
} finally {
  await browser.close();
}
