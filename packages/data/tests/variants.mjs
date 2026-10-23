import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import {
  encodeWorkbook,
  decodeWorkbook,
  safeJSON,
} from "../bench/storage/encodings.mjs";
import { command } from "./shell.mjs";
const book = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
await mkdir("dist/data-storage", { recursive: true });
const browser = await chromium.launch();
try {
  for (const encoding of ["per-cell", "rows", "columns", "csv", "tsv"]) {
    const html = await buildWorkbook(book, {
      offline: true,
      modelCodecPath: new URL(
        "../bench/storage/document-model.mjs",
        import.meta.url,
      ).pathname,
      serializeModel: (b) => safeJSON(encodeWorkbook(b, encoding)),
    });
    const file = resolve(`dist/data-storage/${encoding}.html`);
    await writeFile(file, html);
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(file).href);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    await page.getByLabel("Cell value").fill("140");
    await page.getByRole("button", { name: "Apply edit" }).click();
    await page
      .getByText("Calculated locally. Unsaved changes.", { exact: true })
      .waitFor();
    const downloadPromise = page.waitForEvent("download");
    await command(page, "Save a copy");
    const download = await downloadPromise;
    const saved = resolve(`dist/data-storage/${encoding}-saved.html`);
    await download.saveAs(saved);
    const text = await readFile(saved, "utf8"),
      payload = JSON.parse(
        /<script id="workbook"[^>]*>([\s\S]*?)<\/script>/.exec(text)[1],
      );
    assert.equal(payload.storageExperiment?.encoding ?? "per-cell", encoding);
    assert.equal(decodeWorkbook(payload).sheets[1].cells.B2.result.value, 3500);
    await page.goto(pathToFileURL(saved).href);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      `PASS ${encoding}: portable edit/save/reopen retains encoding and values`,
    );
  }
} finally {
  await browser.close();
}
