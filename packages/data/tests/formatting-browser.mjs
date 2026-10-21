// F01: ADR-010 presentation fields survive browser edits, paste, structural
// edits, undo/redo, recovery and save/reopen before rendering exists (F02).
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { readHTML } from "../bench/storage/html.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const book = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
const style = {
  bold: true,
  fontSize: 14,
  background: { theme: "accent1", tint: 0.6 },
  border: { bottom: { style: "double", color: "#000000" } },
  align: { horizontal: "centerContinuous", wrap: true },
};
const inputs = book.sheets[0];
inputs.cells.B2 = { ...inputs.cells.B2, style, cellStyle: "s-key" };
inputs.cells.A5 = {
  input: { type: "text", value: "old" },
  style: { italic: true },
};
inputs.cells.D3 = { style: { border: { left: { style: "medium" } } } };
inputs.links = {
  A5: { url: "https://example.org/a" },
  E9: { sheetId: "inputs", ref: "B3" },
};
inputs.rows = { 3: { height: 36, customHeight: true } };
inputs.columns = { B: { width: 150, style: { italic: true } } };
book.namedStyles = [
  { id: "s-key", name: "Key input", style: { color: "#C00000" } },
];
const html = await buildWorkbook(book, { offline: true }),
  browser = await chromium.launch();
const file = resolve(out, "formatting.html");
await writeFile(file, html);
async function jump(page, ref) {
  await page.getByLabel("Cell address").fill(ref);
  await page.keyboard.press("Tab");
  await page.locator("#grid").focus();
}
async function copy(page, name) {
  const wait = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save a copy" }).click();
  const path = resolve(out, name);
  await (await wait).saveAs(path);
  return { book: readHTML(await readFile(path, "utf8")).book, path };
}
const calculated = (page) =>
  page
    .getByText("Calculated locally. Unsaved changes.", { exact: true })
    .waitFor();
try {
  const context = await browser.newContext({ acceptDownloads: true }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(pathToFileURL(file).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();

  // A typed value edit keeps every presentation field of the cell.
  await jump(page, "B2");
  await page.getByLabel("Cell value", { exact: true }).fill("150");
  await page.getByRole("button", { name: "Apply edit", exact: true }).click();
  await calculated(page);
  // Pasting values keeps the destination's style and link.
  await jump(page, "A5");
  await page.getByRole("button", { name: "Paste table", exact: true }).click();
  await page.getByLabel("Table text").fill("new");
  await page.getByRole("button", { name: "Apply table", exact: true }).click();
  await calculated(page);
  // Ribbon cell-style changes keep direct formatting.
  await jump(page, "B2");
  await page
    .getByLabel("Cell style", { exact: true })
    .selectOption("assumption");
  await page
    .getByRole("button", { name: "Format selection", exact: true })
    .click();
  await page
    .getByText("Formatting changed. Unsaved changes.", { exact: true })
    .waitFor();
  let saved = (await copy(page, "formatting-edited.html")).book;
  let sheet = saved.sheets[0];
  assert.equal(sheet.cells.B2.input.value, 150);
  assert.deepEqual(sheet.cells.B2.style, style);
  assert.equal(sheet.cells.B2.cellStyle, "assumption");
  assert.equal(sheet.cells.A5.input.value, "new");
  assert.deepEqual(sheet.cells.A5.style, { italic: true });
  assert.deepEqual(sheet.links.A5, { url: "https://example.org/a" });
  assert.deepEqual(sheet.cells.D3, inputs.cells.D3);
  assert.deepEqual(saved.namedStyles, book.namedStyles);

  // Inserting a row above moves row formatting and internal links.
  await jump(page, "A2");
  await page.getByRole("button", { name: "Insert rows", exact: true }).click();
  await page
    .getByText("Row/column references updated. Unsaved changes.", {
      exact: true,
    })
    .waitFor();
  saved = (await copy(page, "formatting-inserted.html")).book;
  sheet = saved.sheets[0];
  assert.deepEqual(sheet.rows, { 4: { height: 36, customHeight: true } });
  assert.deepEqual(sheet.columns, inputs.columns);
  assert.deepEqual(sheet.links.E10, { sheetId: "inputs", ref: "B4" });
  assert.deepEqual(sheet.links.A6, { url: "https://example.org/a" });
  assert.deepEqual(sheet.cells.D4, inputs.cells.D3);
  assert.deepEqual(sheet.cells.B3.style, style);

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page
    .getByText("Undo restored the previous workbook.", { exact: true })
    .waitFor();
  const undone = (await copy(page, "formatting-undone.html")).book;
  assert.deepEqual(undone.sheets[0].rows, inputs.rows);
  assert.deepEqual(undone.sheets[0].links, inputs.links);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page
    .getByText("Redo restored the previous workbook.", { exact: true })
    .waitFor();
  await page
    .locator("#save-status")
    .filter({ hasText: "Recovery stored" })
    .waitFor();
  const final = await copy(page, "formatting-final.html");
  assert.deepEqual(final.book.sheets[0].rows, {
    4: { height: 36, customHeight: true },
  });

  // Recovery draft and reopened file keep the same canonical formatting.
  await page.reload();
  await page
    .getByRole("dialog")
    .filter({ hasText: "Recover unsaved work" })
    .waitFor();
  await page
    .getByRole("button", { name: "Restore draft", exact: true })
    .click();
  assert.deepEqual(
    (await copy(page, "formatting-recovered.html")).book,
    final.book,
  );
  await page.goto(pathToFileURL(final.path).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  assert.deepEqual(
    (await copy(page, "formatting-reopened.html")).book,
    final.book,
  );
  assert.deepEqual(errors, []);
  await context.close();

  // A failed calculation leaves a pending attempt; formatting it keeps the
  // attempt's own direct style and changes only the requested property.
  {
    const standard = resolve(out, "formatting-standard.html");
    await writeFile(standard, await buildWorkbook(book));
    const blocked = await browser.newContext({ acceptDownloads: true });
    await blocked.route("https://raw.githubusercontent.com/**", (r) =>
      r.abort(),
    );
    const page = await blocked.newPage(),
      pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(pathToFileURL(standard).href);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    // Rich copy of A5 (italic text) pasted onto B2 (bold, different style).
    await jump(page, "A5");
    const payload = await page.evaluate(() => {
      const data = new DataTransfer();
      document
        .getElementById("grid")
        .dispatchEvent(
          new ClipboardEvent("copy", { clipboardData: data, bubbles: true }),
        );
      return data.getData("application/x-html-office-range+json");
    });
    assert.ok(payload, "rich clipboard payload");
    await jump(page, "B2");
    await page.evaluate((json) => {
      const data = new DataTransfer();
      data.setData("application/x-html-office-range+json", json);
      document
        .getElementById("grid")
        .dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: data, bubbles: true }),
        );
    }, payload);
    await page
      .locator("#status")
      .filter({ hasText: "The attempted range is retained" })
      .waitFor();
    await page.locator("#decimals").click();
    await page
      .getByText("Formatting changed. Unsaved changes.", { exact: true })
      .waitFor();
    const draft = (await copy(page, "formatting-pending.html")).book;
    const cell = draft.sheets[0].cells.B2;
    assert.equal(cell.input.value, "old", "attempted paste kept");
    assert.deepEqual(
      cell.style,
      { italic: true },
      "attempt keeps the pasted style",
    );
    assert.equal(cell.format.digits, 1, "only the requested property changed");
    assert.equal(draft.snapshot, undefined);
    assert.deepEqual(pageErrors, []);
    await blocked.close();
  }
  console.log(
    "PASS formatting fields: typed edit, paste, cell style, sheet links, row insert, undo/redo, recovery, reopen and pending-attempt formatting",
  );
} finally {
  await browser.close();
}
