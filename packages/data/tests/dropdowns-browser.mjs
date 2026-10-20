import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { scenarioWorkbook } from "../fixtures/scenarios.mjs";
import { readHTML, replaceHTML } from "../bench/storage/html.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const offline of [false, true]) {
    const file = resolve(
      out,
      `dropdowns-${offline ? "offline" : "standard"}.html`,
    );
    await writeFile(file, await buildWorkbook(scenarioWorkbook(), { offline }));
    const context = await browser.newContext({ acceptDownloads: true }),
      page = await context.newPage(),
      requests = [],
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    await context.route(/^https?:\/\//, async (route) => {
      const url = route.request().url();
      requests.push(url);
      assert.ok(
        url.startsWith(
          "https://raw.githubusercontent.com/apatrem/html-office/",
        ),
      );
      await route.fulfill({
        body: await readFile(
          new URL(
            `../engine/vendor/${url.endsWith(".wasm.gz") ? "ironcalc.wasm.gz" : "ironcalc.mjs"}`,
            import.meta.url,
          ),
        ),
        headers: {
          "access-control-allow-origin": "*",
          "content-type": "application/octet-stream",
        },
      });
    });
    await page.goto(pathToFileURL(file).href);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    assert.deepEqual(requests, []);
    const scenario = page.getByLabel("Scenario", { exact: true });
    assert.equal(
      await scenario.locator("option:checked").textContent(),
      "Base",
    );
    await scenario.selectOption({ label: "Upside" });
    await page
      .getByText("Calculated locally. Unsaved changes.", { exact: true })
      .waitFor();
    assert.equal(
      await page.locator('#grid [data-cell="B2"]').textContent(),
      "€300.00",
    );
    assert.equal(
      await page.locator("#current-sheet").textContent(),
      "Sheet: Summary",
    );
    assert.equal(requests.length, offline ? 0 : 2);
    await context.setOffline(true);
    await scenario.selectOption({ label: "Downside" });
    await page
      .getByText("Calculated locally. Unsaved changes.", { exact: true })
      .waitFor();
    assert.equal(
      await page.locator('#grid [data-cell="B2"]').textContent(),
      "€95.00",
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page
      .getByText("Undo restored the previous workbook.", { exact: true })
      .waitFor();
    assert.equal(
      await scenario.locator("option:checked").textContent(),
      "Upside",
    );
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await page
      .getByText("Redo restored the previous workbook.", { exact: true })
      .waitFor();
    await page.locator('#grid [data-cell="F2"]').click();
    const dropdown = page.getByLabel("Dropdown value", { exact: true });
    assert.equal(await dropdown.getAttribute("aria-invalid"), "true");
    await dropdown.selectOption({ label: "10.0%" });
    await page
      .getByText("Calculated locally. Unsaved changes.", { exact: true })
      .waitFor();
    assert.equal(await dropdown.getAttribute("aria-invalid"), "false");
    await page
      .getByText("Unsaved changes. Recovery stored.", { exact: true })
      .waitFor();
    const wait = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save a copy", exact: true })
      .click();
    const saved = resolve(
      out,
      `dropdowns-${offline ? "offline" : "standard"}-saved.html`,
    );
    await (await wait).saveAs(saved);
    const book = readHTML(await readFile(saved, "utf8")).book;
    assert.equal(
      book.sheets.find((s) => s.id === "inputs").cells.B1.input.value,
      "Downside",
    );
    assert.equal(
      book.sheets.find((s) => s.id === "summary").cells.F2.input.value,
      0.1,
    );
    assert.equal(
      book.sheets.find((s) => s.id === "summary").cells.B2.result.value,
      95,
    );
    assert.equal(book.sheets.length, 2);
    await page.goto(pathToFileURL(saved).href);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    assert.equal(
      await scenario.locator("option:checked").textContent(),
      "Downside",
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `PASS dropdowns: ${offline ? "offline" : "standard"} scenario totals, dependent invalid values, undo/redo and offline saved reopen`,
    );
  }
  async function ready(id, html) {
    const context = await browser.newContext({ acceptDownloads: true }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    const file = resolve(out, `dropdowns-${id}.html`);
    await writeFile(file, html);
    await page.goto(pathToFileURL(file).href);
    return { context, page, errors };
  }
  async function copy(page, id) {
    const wait = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save a copy", exact: true })
      .click();
    const file = resolve(out, `dropdowns-${id}-copy.html`);
    await (await wait).saveAs(file);
    return readHTML(await readFile(file, "utf8")).book;
  }
  const standard = await buildWorkbook(scenarioWorkbook());
  {
    const { context, page, errors } = await ready("blocked", standard);
    await context.route(/^https?:\/\//, (route) => route.abort());
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    await page
      .getByLabel("Scenario", { exact: true })
      .selectOption({ label: "Upside" });
    await page
      .locator("#status")
      .filter({ hasText: "The attempted range is retained" })
      .waitFor();
    assert.equal(
      await page.locator('#grid [data-cell="B2"]').textContent(),
      "€220.00",
    );
    assert.equal(
      await page.getByLabel("Scenario", { exact: true }).inputValue(),
      "0",
    );
    await page
      .locator("#save-status")
      .filter({ hasText: "Recovery stored" })
      .waitFor();
    const draft = await copy(page, "blocked");
    assert.equal(draft.sheets[1].cells.B1.input.value, "Upside");
    assert.equal(draft.snapshot, undefined);
    await context.unroute(/^https?:\/\//);
    await context.route(/^https?:\/\//, async (route) =>
      route.fulfill({
        body: await readFile(
          new URL(
            `../engine/vendor/${route.request().url().endsWith(".wasm.gz") ? "ironcalc.wasm.gz" : "ironcalc.mjs"}`,
            import.meta.url,
          ),
        ),
      }),
    );
    await page
      .getByRole("button", { name: "Retry pending range", exact: true })
      .click();
    await page
      .getByText("Calculated locally. Unsaved changes.", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Summary", exact: true }).click();
    assert.equal(
      await page.locator('#grid [data-cell="B2"]').textContent(),
      "€300.00",
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS dropdowns: blocked engine retains a complete draft, keeps committed totals and retries once",
    );
  }
  const original = await buildWorkbook(scenarioWorkbook(), { offline: true });
  for (const mode of ["stale", "missing", "error", "computed", "large"]) {
    const parsed = readHTML(original),
      book = parsed.book;
    if (mode === "stale") book.sheets[1].cells.B4.input.value = 0.15;
    if (mode === "missing") delete book.sheets[1].cells.B10.result;
    if (mode === "error") {
      book.sheets[1].cells.B10 = { formula: "=1/0" };
    }
    if (mode === "computed")
      book.validations.push({
        id: "computed",
        sheetId: "inputs",
        ref: "B8",
        source: { kind: "list", values: [{ type: "number", value: 0.1 }] },
      });
    if (mode === "large") book.validations[2].source.ref = "B1:B10001";
    const html =
      mode === "error"
        ? await buildWorkbook(book, { offline: true })
        : replaceHTML(original, parsed, book);
    const { context, page, errors } = await ready(mode, html);
    await page
      .locator("#status")
      .filter({ hasText: /Saved results are/ })
      .waitFor();
    if (mode === "computed") {
      await page.getByRole("button", { name: "Inputs", exact: true }).click();
      await page.getByLabel("Cell address").fill("B8");
      await page.keyboard.press("Tab");
    } else await page.locator('#grid [data-cell="F2"]').click();
    assert.equal(
      await page.getByLabel("Dropdown value", { exact: true }).isDisabled(),
      true,
    );
    assert.match(
      await page.locator("#dropdown-note").textContent(),
      mode === "error"
        ? /contains an error/
        : mode === "large"
          ? /10,000 cells/
          : mode === "computed"
            ? /Calculated cell/
            : /Recalculate/,
    );
    assert.equal(
      await page.getByLabel("Scenario", { exact: true }).isEnabled(),
      true,
    );
    if (["stale", "missing"].includes(mode)) {
      await page
        .getByRole("button", { name: "Recalculate", exact: true })
        .click();
      await page
        .getByText("Calculated locally. Unsaved changes.", { exact: true })
        .waitFor();
      assert.equal(
        await page.getByLabel("Dropdown value", { exact: true }).isEnabled(),
        true,
      );
    }
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `PASS dropdowns: ${mode} choices are explained and never use unverified formula results`,
    );
  }
  {
    const { context, page, errors } = await ready("references", original);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Inputs", exact: true }).click();
    await page.getByLabel("Cell address").fill("B1");
    await page.keyboard.press("Tab");
    await page
      .getByRole("button", { name: "Insert rows", exact: true })
      .click();
    await page
      .getByText("Row/column references updated. Unsaved changes.", {
        exact: true,
      })
      .waitFor();
    await page
      .getByLabel("Scenario", { exact: true })
      .selectOption({ label: "Upside" });
    await page
      .getByText("Calculated locally. Unsaved changes.", { exact: true })
      .waitFor();
    await page.getByLabel("Cell address").fill("B2");
    await page.keyboard.press("Tab");
    await page
      .getByRole("button", { name: "Delete rows", exact: true })
      .click();
    await page
      .getByText("Row/column references updated. Unsaved changes.", {
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page.getByLabel("Scenario", { exact: true }).isDisabled(),
      true,
    );
    assert.match(
      await page.locator("#scenario-note").textContent(),
      /selector was deleted/,
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page
      .getByText("Undo restored the previous workbook.", { exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel("Scenario", { exact: true }).isEnabled(),
      true,
    );
    assert.equal(
      await page
        .getByLabel("Scenario", { exact: true })
        .locator("option:checked")
        .textContent(),
      "Upside",
    );
    const saved = await copy(page, "references");
    assert.equal(saved.validations[0].ref, "B2");
    assert.equal(saved.validations[0].source.ref, "A5:A7");
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS dropdowns: selector and source shift, deleted selector disables and undo restores",
    );
  }
} finally {
  await browser.close();
}
