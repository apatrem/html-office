import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { conditionalWorkbook } from "../fixtures/conditional.mjs";
import { readHTML } from "../bench/storage/html.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const book = conditionalWorkbook();
for (const [ref, value] of Object.entries({ F3: -100, F4: 50, F5: 200 }))
  book.sheets[0].cells[ref] = { input: { type: "number", value } };
for (const offline of [false, true]) {
  const browser = await chromium.launch(),
    context = await browser.newContext({ acceptDownloads: true }),
    page = await context.newPage(),
    errors = [],
    requests = [];
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) requests.push(r.url());
  });
  const button = (name) => page.getByRole("button", { name, exact: true }),
    field = (name) => page.getByLabel(name, { exact: true });
  async function open(label) {
    await button("Conditional formatting").click();
    await field("Conditional rule").selectOption(label ? { label } : "");
  }
  const updated = () =>
    page
      .getByText("Conditional formatting updated. Unsaved changes.", {
        exact: true,
      })
      .waitFor();
  async function width(ref, value) {
    await page.waitForFunction(
      ({ ref, value }) => {
        const el = document.querySelector(
          `#grid [data-cell="${ref}"] .data-bar-fill`,
        );
        return el && Math.abs(parseFloat(el.style.width) - value) < 0.01;
      },
      { ref, value },
    );
  }
  async function copy(id) {
    const wait = page.waitForEvent("download");
    await button("Save a copy").click();
    const file = resolve(
      out,
      `data-bar-settings-${offline ? "offline" : "standard"}-${id}.html`,
    );
    await (await wait).saveAs(file);
    return { file, book: readHTML(await readFile(file, "utf8")).book };
  }
  try {
    const file = resolve(
      out,
      `data-bar-settings-${offline ? "offline" : "standard"}.html`,
    );
    await writeFile(file, await buildWorkbook(book, { offline }));
    await page.goto(pathToFileURL(file).href);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    const before = (await copy("before")).book;
    await open();
    await field("Rule kind").selectOption("dataBar");
    await field("Rule target range").fill("F3:F5");
    await field("Bar scale").selectOption("auto");
    await button("Save rule").click();
    await updated();
    await width("F3", 100 / 3);
    await open("4. Summary!F3:F5 · data bar");
    await field("Bar scale").selectOption("fixed");
    await field("Bar minimum").fill("10");
    await field("Bar maximum").fill("100");
    await button("Save rule").click();
    await page
      .locator("#conditional-context")
      .filter({ hasText: /include zero/ })
      .waitFor();
    await field("Bar minimum").fill("-100");
    // A tampered control: only charte tokens pass validation (ADR-012).
    await field("Positive bar colour").evaluate((el) => {
      el.append(new Option("bad", "url(x)"));
      el.value = "url(x)";
    });
    await button("Save rule").click();
    await page
      .locator("#conditional-context")
      .filter({ hasText: /color/ })
      .waitFor();
    await button("Close conditional formatting").click();
    assert.equal(
      (await copy("invalid")).book.conditionalFormats[3].scale.kind,
      "auto",
    );
    await open("4. Summary!F3:F5 · data bar");
    await field("Bar scale").selectOption("fixed");
    await field("Bar minimum").fill("-100");
    await field("Bar maximum").fill("100");
    await field("Positive bar colour").selectOption("mid");
    await button("Save rule").click();
    await updated();
    await width("F5", 50);
    await button("Undo").click();
    await page
      .getByText("Undo restored the previous workbook.", { exact: true })
      .waitFor();
    await width("F3", 100 / 3);
    await button("Redo").click();
    await page
      .getByText("Redo restored the previous workbook.", { exact: true })
      .waitFor();
    await width("F5", 50);
    await open();
    await field("Rule kind").selectOption("dataBar");
    await field("Rule target range").fill("F3:F5");
    await field("Bar scale").selectOption("fixed");
    await field("Bar minimum").fill("-200");
    await field("Bar maximum").fill("200");
    await field("Negative bar colour").selectOption("dark");
    await button("Save rule").click();
    await updated();
    await width("F3", 50);
    await open("5. Summary!F3:F5 · data bar");
    await button("Move rule earlier").click();
    await updated();
    await button("Close conditional formatting").click();
    await width("F3", 25);
    assert.equal(
      await page
        .locator('#grid [data-cell="F3"] .data-bar-fill')
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      // The dark token resolved from the document charte (--ink).
      "rgb(11, 28, 44)",
    );
    await open("4. Summary!F3:F5 · data bar");
    await field("Rule kind").selectOption("highlight");
    await field("Condition operator").selectOption("gte");
    await field("Condition value").fill("0");
    await button("Save rule").click();
    await updated();
    await width("F3", 50);
    assert.equal(
      await page
        .locator('#grid [data-cell="F5"]')
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(236, 239, 242)",
    );
    await page
      .locator("#save-status")
      .filter({ hasText: "Recovery stored" })
      .waitFor();
    const saved = await copy("saved");
    assert.equal(saved.book.conditionalFormats[3].kind, "highlight");
    assert.equal(saved.book.conditionalFormats[4].kind, "dataBar");
    assert.deepEqual(saved.book.sheets, before.sheets);
    assert.deepEqual(saved.book.snapshot, before.snapshot);
    assert.deepEqual(requests, []);
    await page.reload();
    await button("Restore draft").click();
    await width("F3", 50);
    assert.deepEqual((await copy("restored")).book, saved.book);
    await context.setOffline(true);
    await page.goto(pathToFileURL(saved.file).href);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    await width("F3", 50);
    assert.deepEqual(errors, []);
    console.log(
      `PASS data bar settings ${offline ? "offline" : "standard"}: engine-free auto/fixed creation/editing, invalid atomicity, priority/conversion/history, recovery and offline reopen preserve values/results`,
    );
  } finally {
    await context.close();
    await browser.close();
  }
}
