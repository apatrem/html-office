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
const browser = await chromium.launch();
async function assertColor(page, expected, ref = "B2") {
  await page.waitForFunction(
    ({ expected, ref }) => {
      const el = document.querySelector(`#grid [data-cell="${ref}"]`);
      return !!el && getComputedStyle(el).backgroundColor === expected;
    },
    { expected, ref },
  );
}
try {
  for (const offline of [false, true]) {
    const file = resolve(
      out,
      `conditional-${offline ? "offline" : "standard"}.html`,
    );
    await writeFile(
      file,
      await buildWorkbook(conditionalWorkbook(), { offline }),
    );
    const context = await browser.newContext({ acceptDownloads: true }),
      page = await context.newPage(),
      errors = [],
      requests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
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
    await assertColor(page, "rgb(236, 239, 242)");
    assert.deepEqual(requests, []);
    await page
      .getByLabel("Scenario", { exact: true })
      .selectOption({ label: "Upside" });
    await page
      .getByText("Calculated locally. Unsaved changes.", { exact: true })
      .waitFor();
    await assertColor(page, "rgb(175, 197, 212)");
    assert.equal(requests.length, offline ? 0 : 2);
    await context.setOffline(true);
    await page
      .getByLabel("Scenario", { exact: true })
      .selectOption({ label: "Downside" });
    await page
      .getByText("Calculated locally. Unsaved changes.", { exact: true })
      .waitFor();
    await assertColor(page, "rgb(194, 82, 28)");
    await page
      .getByRole("button", { name: "Conditional formatting", exact: true })
      .click();
    await page.getByLabel("Conditional rule", { exact: true }).selectOption("");
    await page.getByLabel("Rule target range", { exact: true }).fill("B2");
    await page
      .getByLabel("Condition operator", { exact: true })
      .selectOption("eq");
    await page.getByLabel("Condition value", { exact: true }).fill("95");
    await page.getByLabel("Fill colour", { exact: true }).selectOption("mid");
    await page.getByRole("button", { name: "Save rule", exact: true }).click();
    await page
      .getByText("Conditional formatting updated. Unsaved changes.", {
        exact: true,
      })
      .waitFor();
    await assertColor(page, "rgb(194, 82, 28)");
    await page
      .getByRole("button", { name: "Conditional formatting", exact: true })
      .click();
    await page
      .getByLabel("Conditional rule", { exact: true })
      .selectOption({ label: "4. Summary!B2 · eq" });
    for (let i = 0; i < 3; i++) {
      await page
        .getByRole("button", { name: "Move rule earlier", exact: true })
        .click();
      await page
        .getByText("Conditional formatting updated. Unsaved changes.", {
          exact: true,
        })
        .waitFor();
    }
    await page
      .getByRole("button", {
        name: "Close conditional formatting",
        exact: true,
      })
      .click();
    await assertColor(page, "rgb(79, 127, 163)");
    assert.equal(
      await page.locator('#grid [data-cell="B2"]').textContent(),
      "€95.00",
    );
    assert.equal(requests.length, offline ? 0 : 2);
    for (const expected of ["rgb(79, 127, 163)", "rgb(194, 82, 28)"]) {
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await page
        .getByText("Undo restored the previous workbook.", { exact: true })
        .waitFor();
      await assertColor(page, expected);
    }
    for (let i = 0; i < 2; i++) {
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      await page
        .getByText("Redo restored the previous workbook.", { exact: true })
        .waitFor();
      await assertColor(page, "rgb(79, 127, 163)");
    }
    await page.emulateMedia({ media: "print" });
    await assertColor(page, "rgb(79, 127, 163)");
    await page.emulateMedia({ media: "screen" });
    await page
      .locator("#save-status")
      .filter({ hasText: "Recovery stored" })
      .waitFor();
    const wait = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save a copy", exact: true })
      .click();
    const saved = resolve(
      out,
      `conditional-${offline ? "offline" : "standard"}-saved.html`,
    );
    await (await wait).saveAs(saved);
    const book = readHTML(await readFile(saved, "utf8")).book;
    assert.equal(book.conditionalFormats.length, 4);
    assert.equal(book.sheets[0].cells.B2.result.value, 95);
    assert.equal(book.conditionalFormats[0].style.fill, "mid");
    await page.goto(pathToFileURL(saved).href);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    await assertColor(page, "rgb(79, 127, 163)");
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `PASS conditional highlights ${offline ? "offline" : "standard"}: scenario updates, creation/precedence/history, print colours and saved reopen`,
    );
  }
} finally {
  await browser.close();
}
