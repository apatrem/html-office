import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { readHTML, replaceHTML } from "../bench/storage/html.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const source = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
const original = await buildWorkbook(source, { offline: true });
const browser = await chromium.launch();
try {
  for (const mode of ["changed-input", "missing-result"]) {
    const parsed = readHTML(original),
      book = parsed.book;
    if (mode === "changed-input")
      book.sheets[0].cells.B2.input.value = 123.45678901234567;
    else delete book.sheets[1].cells.B2.result;
    const file = resolve(out, `snapshot-${mode}.html`);
    await writeFile(file, replaceHTML(original, parsed, book));
    const page = await browser.newPage();
    await page.context().setOffline(true);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(file).href);
    await page
      .getByText(
        "Saved results are stale or missing. Apply an edit to recalculate.",
        { exact: true },
      )
      .waitFor();
    await page.getByLabel("Cell value").fill("987654");
    await page
      .getByRole("button", { name: "Recalculate", exact: true })
      .click();
    await page
      .getByText("Calculated locally. Unsaved changes.", { exact: true })
      .waitFor();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save a copy" }).click();
    const saved = resolve(out, `snapshot-${mode}-saved.html`);
    await (await download).saveAs(saved);
    const actual = readHTML(await readFile(saved, "utf8")).book;
    assert.equal(
      actual.sheets[0].cells.B2.input.value,
      book.sheets[0].cells.B2.input.value,
    );
    assert.equal(
      actual.sheets[1].cells.B2.result.value,
      book.sheets[0].cells.B2.input.value * 25,
    );
    await page.goto(pathToFileURL(saved).href);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `PASS snapshots: ${mode}, explicit recalc preserves attempted form input and saves precise results`,
    );
  }
} finally {
  await browser.close();
}
