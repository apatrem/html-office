import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { scenarioWorkbook } from "../fixtures/scenarios.mjs";
import { readHTML } from "../bench/storage/html.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  const file = resolve(out, "dropdown-settings.html");
  await writeFile(file, await buildWorkbook(scenarioWorkbook()));
  const context = await browser.newContext({ acceptDownloads: true }),
    page = await context.newPage(),
    requests = [],
    errors = [];
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
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "Data", exact: true }).click();

  await page
    .getByRole("button", { name: "Dropdown settings", exact: true })
    .click();
  await page.getByLabel("Target range", { exact: true }).fill("H2");
  await page
    .getByLabel("List value type", { exact: true })
    .selectOption("number");
  await page.getByLabel("List values", { exact: true }).fill("10\n20\n30");
  await page
    .getByRole("button", { name: "Save dropdown", exact: true })
    .click();
  await page
    .getByText("Dropdown settings updated. Unsaved changes.", { exact: true })
    .waitFor();
  assert.deepEqual(requests, []);
  await page.locator('#grid [data-cell="H2"]').click();
  await page
    .getByLabel("Dropdown value", { exact: true })
    .selectOption({ label: "20" });
  await page
    .getByText("Calculated locally. Unsaved changes.", { exact: true })
    .waitFor();
  assert.equal(requests.length, 2);
  await context.setOffline(true);
  await page.getByRole("tab", { name: "Data", exact: true }).click();

  await page
    .getByRole("button", { name: "Dropdown settings", exact: true })
    .click();
  await page.getByLabel("Use as scenario selector", { exact: true }).check();
  await page
    .getByRole("button", { name: "Save dropdown", exact: true })
    .click();
  await page
    .getByText("Dropdown settings updated. Unsaved changes.", { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByLabel("Scenario", { exact: true })
      .locator("option:checked")
      .textContent(),
    "20",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page
    .getByText("Undo restored the previous workbook.", { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByLabel("Scenario", { exact: true })
      .locator("option:checked")
      .textContent(),
    "Base",
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page
    .getByText("Redo restored the previous workbook.", { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByLabel("Scenario", { exact: true })
      .locator("option:checked")
      .textContent(),
    "20",
  );
  await page
    .locator("#save-status")
    .filter({ hasText: "Recovery stored" })
    .waitFor();
  const wait = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  const saved = resolve(out, "dropdown-settings-saved.html");
  await (await wait).saveAs(saved);
  const book = readHTML(await readFile(saved, "utf8")).book;
  assert.equal(book.validations.length, 4);
  assert.equal(book.sheets[0].cells.H2.input.value, 20);
  assert.equal(book.scenario.validationId, book.validations[3].id);
  await page.goto(pathToFileURL(saved).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByLabel("Scenario", { exact: true })
      .locator("option:checked")
      .textContent(),
    "20",
  );
  assert.equal(requests.length, 2);
  assert.deepEqual(errors, []);
  await context.close();
  console.log(
    "PASS dropdown settings: engine-free creation, warm header synchronization/history and offline saved reopen",
  );
  const offlineHTML = await buildWorkbook(scenarioWorkbook(), {
    offline: true,
  });
  async function ready(id, html = offlineHTML) {
    const context = await browser.newContext({ acceptDownloads: true }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    const file = resolve(out, `dropdown-settings-${id}.html`);
    await writeFile(file, html);
    await page.goto(pathToFileURL(file).href);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    return { context, page, errors };
  }
  async function copy(page, id) {
    const wait = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save a copy", exact: true })
      .click();
    const file = resolve(out, `dropdown-settings-${id}-saved.html`);
    await (await wait).saveAs(file);
    return readHTML(await readFile(file, "utf8")).book;
  }
  async function openNew(page) {
    await page.getByRole("tab", { name: "Data", exact: true }).click();

    await page
      .getByRole("button", { name: "Dropdown settings", exact: true })
      .click();
    await page
      .getByLabel("Dropdown definition", { exact: true })
      .selectOption("");
    await page.getByLabel("Target range", { exact: true }).fill("H2");
    await page
      .getByLabel("List value type", { exact: true })
      .selectOption("text");
    await page.getByLabel("List values", { exact: true }).fill("One\nTwo");
  }
  const updated = (page) =>
    page
      .getByText("Dropdown settings updated. Unsaved changes.", { exact: true })
      .waitFor();
  {
    const { context, page, errors } = await ready("range-and-invalid"),
      before = await copy(page, "range-before");
    await openNew(page);
    await page
      .getByLabel("List value type", { exact: true })
      .selectOption("number");
    await page.getByLabel("List values", { exact: true }).fill("12x");
    await page
      .getByRole("button", { name: "Save dropdown", exact: true })
      .click();
    await page
      .locator("#dropdown-context")
      .filter({ hasText: "finite number" })
      .waitFor();
    await page.getByLabel("List values", { exact: true }).fill("10");
    await page.getByLabel("Target range", { exact: true }).fill("D2");
    await page
      .getByRole("button", { name: "Save dropdown", exact: true })
      .click();
    await page
      .locator("#dropdown-context")
      .filter({ hasText: /overlap/i })
      .waitFor();
    await page.getByLabel("Target range", { exact: true }).fill("B2");
    await page.getByLabel("Use as scenario selector", { exact: true }).check();
    await page
      .getByRole("button", { name: "Save dropdown", exact: true })
      .click();
    await page
      .locator("#dropdown-context")
      .filter({ hasText: "input cell" })
      .waitFor();
    await page
      .getByRole("button", { name: "Close dropdown settings", exact: true })
      .click();
    assert.deepEqual(await copy(page, "invalid-kept"), before);
    await openNew(page);
    await page
      .getByLabel("Choices from", { exact: true })
      .selectOption("range");
    await page
      .getByLabel("Source sheet", { exact: true })
      .selectOption("inputs");
    await page.getByLabel("Source range", { exact: true }).fill("A4:A6");
    await page
      .getByRole("button", { name: "Save dropdown", exact: true })
      .click();
    await updated(page);
    await page.locator('#grid [data-cell="H2"]').click();
    await page
      .getByLabel("Dropdown value", { exact: true })
      .selectOption({ label: "Upside" });
    await page
      .getByText("Calculated locally. Unsaved changes.", { exact: true })
      .waitFor();
    await page.getByRole("tab", { name: "Data", exact: true }).click();

    await page
      .getByRole("button", { name: "Dropdown settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Remove dropdown", exact: true })
      .click();
    await updated(page);
    assert.equal(
      await page.getByLabel("Dropdown value", { exact: true }).isVisible(),
      false,
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page
      .getByText("Undo restored the previous workbook.", { exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByLabel("Dropdown value", { exact: true })
        .locator("option:checked")
        .textContent(),
      "Upside",
    );
    await page
      .locator("#save-status")
      .filter({ hasText: "Recovery stored" })
      .waitFor();
    const saved = await copy(page, "range-recovery");
    await page.reload();
    await page
      .getByRole("button", { name: "Restore draft", exact: true })
      .click();
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    assert.deepEqual(await copy(page, "range-restored"), saved);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS dropdown settings: invalid input/overlap/computed selectors leave model unchanged; range creation/removal/undo/recovery preserve values",
    );
  }
  {
    const { context, page, errors } = await ready("history-worker");
    await page
      .getByRole("button", { name: "Recalculate", exact: true })
      .click();
    await page
      .getByText("Calculated locally. Unsaved changes.", { exact: true })
      .waitFor();
    await openNew(page);
    await page.getByLabel("Use as scenario selector", { exact: true }).check();
    await page
      .getByRole("button", { name: "Save dropdown", exact: true })
      .click();
    await updated(page);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page
      .getByText("Undo restored the previous workbook.", { exact: true })
      .waitFor();
    await page.getByLabel("Cell address").fill("H2");
    await page.keyboard.press("Tab");
    await page.getByLabel("Input type").selectOption("formula");
    await page.getByLabel("Cell value").fill("=30");
    await page.getByRole("button", { name: "Apply edit", exact: true }).click();
    await page
      .getByText("Calculated locally. Unsaved changes.", { exact: true })
      .waitFor();
    assert.equal(
      await page.locator('#grid [data-cell="H2"]').textContent(),
      "30",
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS dropdown settings: undo synchronizes the warm engine so a former selector can become a formula",
    );
  }
  {
    const mixed = scenarioWorkbook(),
      choices = [
        { type: "number", value: -0 },
        { type: "text", value: "001" },
        { type: "text", value: "first\nsecond" },
        {
          type: "text",
          value: "</textarea><script>globalThis.injected=true</script>",
        },
        { type: "boolean", value: true },
        { type: "blank" },
        { type: "date", value: 60 },
      ];
    mixed.validations.push({
      id: "mixed",
      sheetId: "summary",
      ref: "H2",
      source: { kind: "list", values: choices },
    });
    const { context, page, errors } = await ready(
      "mixed",
      await buildWorkbook(mixed, { offline: true }),
    );
    await page.getByLabel("Cell address").fill("H2");
    await page.keyboard.press("Tab");
    await page.getByRole("tab", { name: "Data", exact: true }).click();

    await page
      .getByRole("button", { name: "Dropdown settings", exact: true })
      .click();
    assert.equal(
      await page.getByLabel("List value type", { exact: true }).inputValue(),
      "keep",
    );
    assert.equal(
      await page.getByLabel("List values", { exact: true }).isDisabled(),
      true,
    );
    await page
      .getByRole("button", { name: "Save dropdown", exact: true })
      .click();
    await updated(page);
    assert.deepEqual(
      (await copy(page, "mixed")).validations[3].source.values,
      choices,
    );
    assert.equal(await page.evaluate(() => globalThis.injected), undefined);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS dropdown settings: mixed choices, signed zero, multiline and markup text are retained exactly",
    );
  }
  {
    const { context, page, errors } = await ready("pending-formula");
    await page.evaluate(() => {
      const post = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (message) {
        if (message.method === "calculate" && !globalThis.failedInput) {
          globalThis.failedInput = true;
          return this.dispatchEvent(
            new MessageEvent("message", {
              data: { id: message.id, error: "Injected pending formula" },
            }),
          );
        }
        return post.call(this, message);
      };
    });
    await page.getByLabel("Cell address").fill("H2");
    await page.keyboard.press("Tab");
    await page.getByLabel("Input type").selectOption("formula");
    await page.getByLabel("Cell value").fill("=30");
    await page.getByRole("button", { name: "Apply edit", exact: true }).click();
    await page
      .locator("#status")
      .filter({ hasText: "Injected pending formula" })
      .waitFor();
    await openNew(page);
    await page.getByLabel("Use as scenario selector", { exact: true }).check();
    await page
      .getByRole("button", { name: "Save dropdown", exact: true })
      .click();
    await page
      .locator("#dropdown-context")
      .filter({ hasText: "Scenario selector must be an input cell" })
      .waitFor();
    await page
      .getByRole("button", { name: "Close dropdown settings", exact: true })
      .click();
    const saved = await copy(page, "pending-formula");
    assert.equal(saved.validations.length, 3);
    assert.equal(saved.scenario.validationId, "scenario");
    assert.equal(saved.sheets[0].cells.H2.formula, "=30");
    assert.equal(saved.snapshot, undefined);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS dropdown settings: a pending formula prevents scenario assignment and remains in the uncalculated draft",
    );
  }
  for (const mode of ["cancel", "error"]) {
    const { context, page, errors } = await ready(mode);
    await page
      .getByRole("button", { name: "Recalculate", exact: true })
      .click();
    await page
      .getByText("Calculated locally. Unsaved changes.", { exact: true })
      .waitFor();
    const before = await copy(page, `${mode}-before`);
    await page.evaluate((mode) => {
      const post = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (message) {
        if (
          message.method === "configureValidations" &&
          !globalThis.interceptedHeader
        ) {
          const handler = this.onmessage;
          this.onmessage = (event) => {
            if (
              event.data.id === message.id &&
              event.data.value?.applied === true
            ) {
              globalThis.interceptedHeader = true;
              this.onmessage = handler;
              if (mode === "cancel")
                return setTimeout(() => handler(event), 600);
              return handler({
                data: {
                  id: event.data.id,
                  error: "Injected dropdown publication failure",
                },
              });
            }
            handler(event);
          };
        }
        return post.call(this, message);
      };
    }, mode);
    await openNew(page);
    await page
      .getByRole("button", { name: "Save dropdown", exact: true })
      .click();
    await page.waitForFunction(() => globalThis.interceptedHeader);
    if (mode === "cancel")
      await page
        .getByRole("button", { name: "Cancel calculation", exact: true })
        .click();
    await page
      .locator("#dropdown-context")
      .filter({
        hasText: mode === "cancel" ? /cancelled/ : /Injected dropdown/,
      })
      .waitFor();
    assert.equal(
      await page.getByLabel("Target range", { exact: true }).inputValue(),
      "H2",
    );
    assert.equal(
      await page.getByLabel("List values", { exact: true }).inputValue(),
      "One\nTwo",
    );
    await page
      .getByRole("button", { name: "Close dropdown settings", exact: true })
      .click();
    assert.deepEqual(await copy(page, `${mode}-kept`), before);
    await openNew(page);
    await page
      .getByRole("button", { name: "Save dropdown", exact: true })
      .click();
    await updated(page);
    const saved = await copy(page, `${mode}-retry`);
    assert.equal(saved.validations.length, 4);
    assert.equal(saved.validations[3].ref, "H2");
    assert.deepEqual(saved.sheets, before.sheets);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `PASS dropdown settings: ${mode} after worker mutation preserves canonical header; retry creates exactly one rule`,
    );
  }
} finally {
  await browser.close();
}
