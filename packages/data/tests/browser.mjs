// Real file:// workflows; route interception supplies exact committed engine bytes.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { readModel } from "../model/document.mjs";
const output = resolve("dist/data-test");
await mkdir(output, { recursive: true });
const book = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
book.sheets[0].metadata = {
  layout: "table",
  keep: "hybrid browser round trip",
};
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let requests = 0;
  await context.route("https://raw.githubusercontent.com/**", async (route) => {
    requests++;
    const wasm = route.request().url().includes(".wasm");
    await route.fulfill({
      body: await readFile(
        new URL(
          `../engine/vendor/ironcalc.${wasm ? "wasm.gz" : "mjs"}`,
          import.meta.url,
        ),
      ),
      headers: {
        "access-control-allow-origin": "*",
        "content-type": wasm ? "application/wasm" : "text/javascript",
      },
    });
  });
  const standard = resolve(output, "standard.html");
  await writeFile(standard, await buildWorkbook(book));
  await page.goto(pathToFileURL(standard).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  assert.equal(requests, 0, "viewing must not fetch engines");
  await page.getByRole("button", { name: "More decimals" }).click();
  assert.equal(requests, 0, "formatting must not fetch engines");
  await page.getByLabel("Cell value").fill("140");
  await page.getByRole("button", { name: "Apply edit" }).click();
  await page
    .getByText("Calculated locally. Unsaved changes.", { exact: true })
    .waitFor();
  assert.equal(requests, 2);
  await page.getByRole("button", { name: "Summary", exact: true }).click();
  assert.match(await page.locator('[data-cell="B2"]').textContent(), /3,500/);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save a copy" }).click();
  const download = await downloadPromise;
  const saved = resolve(output, "saved.html");
  await download.saveAs(saved);
  const bytes = await readFile(saved, "utf8");
  const payloadText = /<script id="workbook"[^>]*>([\s\S]*?)<\/script>/.exec(
    bytes,
  )[1];
  assert.equal(JSON.parse(payloadText).sheets[0].table.encoding, "rows");
  const normalized = readModel(payloadText);
  assert.equal(normalized.sheets[0].cells.B2.input.value, 140);
  assert.deepEqual(normalized.sheets[0].metadata, book.sheets[0].metadata);
  assert.ok(
    !bytes.includes("blob:http"),
    "transient URLs must not become saved dependencies",
  );
  await page.getByRole("button", { name: "Undo" }).click();
  await page
    .getByText("Undo restored the previous workbook.", { exact: true })
    .waitFor();
  assert.equal(await page.getByLabel("Cell address").inputValue(), "B2");
  assert.equal(await page.getByLabel("Cell value").inputValue(), "100");
  await page.getByRole("button", { name: "Summary", exact: true }).click();
  assert.match(await page.locator('[data-cell="B2"]').textContent(), /2,500/);
  await context.setOffline(true);
  await page.goto(pathToFileURL(saved).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Summary", exact: true }).click();
  assert.match(await page.locator('[data-cell="B2"]').textContent(), /3,500/);
  const offline = resolve(output, "offline.html");
  await writeFile(offline, await buildWorkbook(book, { offline: true }));
  await page.goto(pathToFileURL(offline).href);
  await page.getByLabel("Cell value").fill("160");
  await page.getByRole("button", { name: "Apply edit" }).click();
  await page
    .getByText("Calculated locally. Unsaved changes.", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Summary", exact: true }).click();
  assert.match(await page.locator('[data-cell="B2"]').textContent(), /4,000/);
  assert.deepEqual(errors, []);
  await context.close();
  console.log(
    "PASS file:// view/format/edit/undo/save/reopen and offline edit",
  );
} finally {
  await browser.close();
}
