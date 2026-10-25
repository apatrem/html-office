// F01: ADR-010 presentation fields survive browser edits, paste, structural
// edits, undo/redo, recovery and save/reopen before rendering exists (F02).
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { readHTML } from "../bench/storage/html.mjs";
import { command, cellStyle } from "./shell.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const book = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
const style = {
  bold: true,
  color: "alert",
  fill: "tint",
  border: { bottom: { style: "double", color: "ink" } },
  align: { horizontal: "centerContinuous", wrap: true },
};
const inputs = book.sheets[0];
inputs.cells.B2 = { ...inputs.cells.B2, style, cellStyle: "output" };
inputs.cells.A5 = {
  input: { type: "text", value: "old" },
  style: { italic: true },
};
inputs.cells.D3 = { style: { border: { left: { style: "medium" } } } };
inputs.links = {
  A5: { url: "https://example.org/a" },
  E9: { sheetId: "inputs", ref: "B3" },
};
inputs.rows = { 3: { height: 36 } };
inputs.columns = { B: { width: 150, style: { italic: true } } };
book.font = "verdana";
book.theme = "green";
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
  await command(page, "Save a copy");
  const path = resolve(out, name);
  await (await wait).saveAs(path);
  return { book: readHTML(await readFile(path, "utf8")).book, path };
}
async function richCopyPaste(page, from, to) {
  await jump(page, from);
  const payload = await page.evaluate(() => {
    const data = new DataTransfer();
    document
      .getElementById("grid")
      .dispatchEvent(
        new ClipboardEvent("copy", { clipboardData: data, bubbles: true }),
      );
    return data.getData("application/x-html-office+json");
  });
  await jump(page, to);
  await page.evaluate((json) => {
    const data = new DataTransfer();
    data.setData("application/x-html-office+json", json);
    document
      .getElementById("grid")
      .dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true }),
      );
  }, payload);
  return payload;
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
  // Linked cells take the hyperlink style automatically: accent colour, underlined.
  for (const ref of ["A5", "E9"]) {
    const look = await page
      .locator(`#grid [data-cell="${ref}"]`)
      .evaluate((el) => ({
        classes: el.className,
        color: getComputedStyle(el).color,
        line: getComputedStyle(el).textDecorationLine,
      }));
    assert.match(look.classes, /\bhyperlink\b/, ref);
    assert.equal(look.line, "underline", `${ref} is underlined`);
    // The workbook's green theme (TH01) supplies the accent token.
    assert.equal(
      look.color,
      "rgb(30, 107, 71)",
      `${ref} uses the green accent token`,
    );
  }

  // A typed value edit keeps every presentation field of the cell.
  await jump(page, "B2");
  await page.getByLabel("Cell value", { exact: true }).fill("150");
  await page.getByRole("button", { name: "Apply edit", exact: true }).click();
  await calculated(page);
  // Pasting values keeps the destination's style and link.
  await jump(page, "A5");
  await command(page, "Paste table");
  await page.getByLabel("Table text").fill("new");
  await page.getByRole("button", { name: "Apply table", exact: true }).click();
  await calculated(page);
  // Toolbar cell-style changes keep direct formatting.
  await jump(page, "B2");
  await cellStyle(page, "Assumption");
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
  assert.equal(saved.font, "verdana");
  assert.equal(saved.theme, "green");

  // Inserting a row above moves row formatting and internal links.
  await jump(page, "A2");
  await command(page, "Insert rows");
  await page
    .getByText("Row/column references updated. Unsaved changes.", {
      exact: true,
    })
    .waitFor();
  saved = (await copy(page, "formatting-inserted.html")).book;
  sheet = saved.sheets[0];
  assert.deepEqual(sheet.rows, { 4: { height: 36 } });
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
  // Rich copy/paste carries the source link; undo/redo restore it atomically.
  const payload = await richCopyPaste(page, "A6", "C20");
  assert.match(payload, /example\.org\/a/);
  await calculated(page);
  let pasted = (await copy(page, "formatting-link-pasted.html")).book;
  assert.deepEqual(pasted.sheets[0].links.C20, {
    url: "https://example.org/a",
  });
  assert.deepEqual(pasted.sheets[0].cells.C20.style, { italic: true });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page
    .getByText("Undo restored the previous workbook.", { exact: true })
    .waitFor();
  pasted = (await copy(page, "formatting-link-undone.html")).book;
  assert.equal(pasted.sheets[0].links.C20, undefined);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page
    .getByText("Redo restored the previous workbook.", { exact: true })
    .waitFor();
  await page
    .locator("#save-status")
    .filter({ hasText: "Recovery stored" })
    .waitFor();
  const final = await copy(page, "formatting-final.html");
  assert.deepEqual(final.book.sheets[0].links.C20, {
    url: "https://example.org/a",
  });
  assert.deepEqual(final.book.sheets[0].rows, {
    4: { height: 36 },
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
    // Rich copy of A5 (italic text, linked) pasted onto B2 (bold, unlinked).
    await richCopyPaste(page, "A5", "B2");
    await page
      .locator("#status")
      .filter({ hasText: "The attempted range is retained" })
      .waitFor();
    await page
      .getByRole("button", { name: "Increase decimal places", exact: true })
      .click();
    await page
      .getByText("Formatting changed. Unsaved changes.", { exact: true })
      .waitFor();
    await page
      .locator("#save-status")
      .filter({ hasText: "Recovery stored" })
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
    assert.deepEqual(
      draft.sheets[0].links.B2,
      { url: "https://example.org/a" },
      "pending paste keeps its link in the draft",
    );
    assert.equal(draft.snapshot, undefined);
    // Automatic recovery keeps the pending paste's link change too.
    await page.reload();
    await page
      .getByRole("dialog")
      .filter({ hasText: "Recover unsaved work" })
      .waitFor();
    await page
      .getByRole("button", { name: "Restore draft", exact: true })
      .click();
    const recovered = (await copy(page, "formatting-pending-recovered.html"))
      .book;
    assert.deepEqual(recovered.sheets[0].links, draft.sheets[0].links);
    assert.deepEqual(recovered.sheets[0].cells.B2, draft.sheets[0].cells.B2);
    assert.deepEqual(pageErrors, []);
    await blocked.close();
  }
  console.log(
    "PASS formatting fields: typed edit, paste, cell style, sheet links, row insert, undo/redo, recovery, reopen and pending-attempt formatting",
  );
} finally {
  await browser.close();
}
