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
import { command } from "./shell.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const book = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
book.sheets[0].cells.C2 = {
  formula: "=$B2+B$3+$B$3",
  format: { kind: "number", digits: 2 },
};
book.sheets[0].cells.C3 = { formula: "=SUM(B2:B3)" };
const html = await buildWorkbook(book, { offline: true }),
  browser = await chromium.launch(),
  shortcut = process.platform === "darwin" ? "Meta" : "Control";
async function jump(page, ref) {
  await page.getByLabel("Cell address").fill(ref);
  await page.keyboard.press("Tab");
  await page.locator("#grid").focus();
}
async function copied(page, name) {
  const waiting = page.waitForEvent("download");
  await command(page, "Save a copy");
  const file = resolve(out, name);
  await (await waiting).saveAs(file);
  return readHTML(await readFile(file, "utf8")).book;
}
async function calculated(page) {
  await page
    .getByText("Calculated locally. Unsaved changes.", { exact: true })
    .waitFor();
}
try {
  const context = await browser.newContext({
      acceptDownloads: true,
      permissions: ["clipboard-read", "clipboard-write"],
    }),
    source = await context.newPage(),
    errors = [];
  const ready = async (page, name) => {
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    const file = resolve(out, name);
    await writeFile(file, html);
    await page.goto(pathToFileURL(file).href);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
  };
  await ready(source, "clipboard-source.html");
  const page = await context.newPage();
  await ready(page, "clipboard-target.html");
  await source.bringToFront();
  await jump(source, "B2");
  await source.keyboard.press("Shift+ArrowRight");
  await source.keyboard.press("Shift+ArrowDown");
  await source.keyboard.press(shortcut + "+c");
  await source.locator("#status").filter({ hasText: "Range copied" }).waitFor();
  await page.bringToFront();
  await jump(page, "E5");
  await page.keyboard.press(shortcut + "+v");
  await calculated(page);
  let saved = await copied(page, "clipboard-internal.html");
  assert.equal(saved.sheets[0].cells.E5.input.value, 100);
  assert.equal(saved.sheets[0].cells.E5.cellStyle, "assumption");
  assert.equal(saved.sheets[0].cells.F5.formula, "=$B5+E$3+$B$3");
  assert.equal(saved.sheets[0].cells.F6.result.value, 125);
  await jump(page, "F5");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await command(page, "Fill down");
  await calculated(page);
  saved = await copied(page, "clipboard-fill.html");
  assert.equal(saved.sheets[0].cells.F7.formula, "=$B7+E$3+$B$3");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page
    .getByText("Undo restored the previous workbook.", { exact: true })
    .waitFor();
  saved = await copied(page, "clipboard-fill-undone.html");
  assert.equal(saved.sheets[0].cells.F7, undefined);
  assert.equal(saved.sheets[0].cells.F6.formula, "=SUM(E5:E6)");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page
    .getByText("Redo restored the previous workbook.", { exact: true })
    .waitFor();
  await jump(page, "F5");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await command(page, "Fill right");
  await calculated(page);
  saved = await copied(page, "clipboard-fill-right.html");
  assert.equal(saved.sheets[0].cells.H5.formula, "=$B5+G$3+$B$3");
  await jump(page, "A10");
  await command(page, "Paste table");
  await page
    .getByLabel("Table text")
    .fill('0012\t=SUM(A1)\n"line one\nline two"\t2\n""\t3');
  await page.getByRole("button", { name: "Apply table", exact: true }).click();
  await calculated(page);
  saved = await copied(page, "clipboard-values.html");
  assert.equal(saved.sheets[0].cells.A10.input.value, "0012");
  assert.equal(saved.sheets[0].cells.B10.input.value, "=SUM(A1)");
  assert.equal(saved.sheets[0].cells.B10.formula, undefined);
  assert.equal(saved.sheets[0].cells.A11.input.value, "line one\nline two");
  assert.equal(saved.sheets[0].cells.A12.input.type, "blank");
  await jump(page, "A15");
  await command(page, "Paste table");
  await page.getByLabel("Table text").fill("1,234\t01/02/2026");
  assert.equal(
    await page
      .getByRole("button", { name: "Apply table", exact: true })
      .isDisabled(),
    true,
  );
  assert.match(await page.locator("#paste-preview").textContent(), /Ambiguous/);
  await page.getByLabel("Value typing").selectOption("fr-FR");
  await page.getByRole("button", { name: "Apply table", exact: true }).click();
  await calculated(page);
  saved = await copied(page, "clipboard-locales.html");
  assert.equal(saved.sheets[0].cells.A15.input.value, 1.234);
  assert.equal(saved.sheets[0].cells.B15.input.type, "date");
  assert.equal(saved.sheets[0].cells.B15.input.value, 46054);
  await jump(page, "A20");
  await command(page, "Paste table");
  await page
    .getByLabel("Table text")
    .fill("Label | Value\n--- | ---\nA\\|B | 42");
  await page.getByRole("button", { name: "Apply table", exact: true }).click();
  await calculated(page);
  saved = await copied(page, "clipboard-markdown.html");
  assert.equal(saved.sheets[0].cells.A21.input.value, "A|B");
  assert.equal(saved.sheets[0].cells.B21.input.value, 42);
  const before = saved;
  await command(page, "Paste table");
  await page.getByLabel("Table text").fill("a\tb\nc");
  assert.equal(
    await page
      .getByRole("button", { name: "Apply table", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Cancel paste", exact: true }).click();
  assert.deepEqual(await copied(page, "clipboard-invalid-kept.html"), before);
  await command(page, "Paste table");
  await page.getByLabel("Table text").fill("uncommitted paste marker");
  await page.getByRole("button", { name: "Cancel paste", exact: true }).click();
  await copied(page, "clipboard-cancelled-preview.html");
  assert.equal(
    (
      await readFile(resolve(out, "clipboard-cancelled-preview.html"), "utf8")
    ).includes("uncommitted paste marker"),
    false,
  );
  await source.bringToFront();
  await source.getByLabel("Cell value").fill("ordinary text copy");
  await source.getByLabel("Cell value").press(shortcut + "+a");
  await source.keyboard.press(shortcut + "+c");
  await page.bringToFront();
  await page.locator("#grid").focus();
  await page.keyboard.press(shortcut + "+v");
  await page.getByRole("dialog").filter({ hasText: "Paste values" }).waitFor();
  assert.match(
    await page.locator("#paste-preview").textContent(),
    /ordinary text copy/,
  );
  await page.getByRole("button", { name: "Cancel paste", exact: true }).click();
  const unchanged = await copied(page, "clipboard-before-unsupported.html");
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/html", "<b>unsupported rich-only clipboard</b>");
    document.querySelector("#grid").dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await page
    .locator("#status")
    .filter({ hasText: "no plain-text table" })
    .waitFor();
  assert.deepEqual(await copied(page, "clipboard-unsupported.html"), unchanged);
  await context.setOffline(true);
  const file = resolve(out, "clipboard-final.html");
  const waiting = page.waitForEvent("download");
  await command(page, "Save a copy");
  await (await waiting).saveAs(file);
  await page.goto(pathToFileURL(file).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
  for (const failure of ["cancel", "error", "escape", "undo"]) {
    const ctx = await browser.newContext({ acceptDownloads: true }),
      p = await ctx.newPage();
    await ready(p, `clipboard-${failure}.html`);
    if (failure === "undo") {
      await p.getByLabel("Cell value").fill("120");
      await p.getByRole("button", { name: "Apply edit", exact: true }).click();
      await calculated(p);
    }
    await p.evaluate((mode) => {
      const post = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (message) {
        if (message.method === "calculate" && !globalThis.allowBatch) {
          if (mode === "cancel")
            return setTimeout(() => post.call(this, message), 600);
          return setTimeout(
            () =>
              this.dispatchEvent(
                new MessageEvent("message", {
                  data: { id: message.id, error: "Injected batch failure" },
                }),
              ),
            0,
          );
        }
        return post.call(this, message);
      };
    }, failure);
    await command(p, "Paste table");
    await p.getByLabel("Table text").fill("140\n30");
    await p.getByRole("button", { name: "Apply table", exact: true }).click();
    if (failure !== "cancel")
      await p
        .locator("#status")
        .filter({ hasText: "Injected batch failure" })
        .waitFor();
    await p.getByRole("button", { name: "Cancel paste", exact: true }).click();
    if (failure === "escape") {
      await p.getByLabel("Cell value").focus();
      await p.keyboard.press("Escape");
    }
    if (failure === "undo") {
      await p.getByRole("button", { name: "Undo", exact: true }).click();
      await p
        .locator("#status")
        .filter({ hasText: "Workbook restored from history" })
        .waitFor();
    }
    await p
      .locator("#save-status")
      .filter({ hasText: "Recovery stored" })
      .waitFor();
    const draft = await copied(p, `clipboard-${failure}-draft.html`);
    const discarded = ["escape", "undo"].includes(failure);
    assert.equal(draft.sheets[0].cells.B2.input.value, discarded ? 100 : 140);
    assert.equal(draft.sheets[0].cells.B3.input.value, discarded ? 25 : 30);
    assert.equal(!!draft.snapshot, discarded);
    let expected = draft;
    if (failure === "cancel") {
      assert.equal(
        await p
          .getByRole("button", { name: "Retry pending range", exact: true })
          .isVisible(),
        true,
      );
      await p.evaluate(() => (globalThis.allowBatch = true));
      await p
        .getByRole("button", { name: "Retry pending range", exact: true })
        .click();
      await calculated(p);
      await p
        .locator("#save-status")
        .filter({ hasText: "Recovery stored" })
        .waitFor();
      expected = await copied(p, "clipboard-retried.html");
      assert.equal(expected.sheets[1].cells.B2.result.value, 4200);
      assert.equal(
        await p
          .getByRole("button", { name: "Retry pending range", exact: true })
          .isVisible(),
        false,
      );
    }
    await p.reload();
    await p
      .getByRole("dialog")
      .filter({ hasText: "Recover unsaved work" })
      .waitFor();
    await p.getByRole("button", { name: "Restore draft", exact: true }).click();
    assert.deepEqual(
      await copied(p, `clipboard-${failure}-recovered.html`),
      expected,
    );
    await ctx.close();
  }
  assert.deepEqual(errors, []);
  assert.ok(
    measureHTML(await buildWorkbook(book)).applicationCodeBytes <
      STANDARD_CODE_CEILING,
  );
  console.log(
    "PASS clipboard: native cross-tab range copy, mixed-reference fill, batch undo/redo, typed table preview and portable save/reopen",
  );
} finally {
  await browser.close();
}
