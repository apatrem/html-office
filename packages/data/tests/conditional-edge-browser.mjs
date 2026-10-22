import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { conditionalWorkbook } from "../fixtures/conditional.mjs";
import { readHTML, replaceHTML } from "../bench/storage/html.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const html = await buildWorkbook(conditionalWorkbook(), { offline: true });
async function ready(id, source = html, current = true) {
  const context = await browser.newContext({ acceptDownloads: true }),
    page = await context.newPage(),
    errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) requests.push(r.url());
  });
  const file = resolve(out, `conditional-edge-${id}.html`);
  await writeFile(file, source);
  await page.goto(pathToFileURL(file).href);
  if (current)
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
  return { context, page, errors, requests };
}
async function copy(page, id) {
  const wait = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  const file = resolve(out, `conditional-edge-${id}-saved.html`);
  await (await wait).saveAs(file);
  return readHTML(await readFile(file, "utf8")).book;
}
async function open(page, label) {
  await page
    .getByRole("button", { name: "Conditional formatting", exact: true })
    .click();
  await page
    .getByLabel("Conditional rule", { exact: true })
    .selectOption(label ? { label } : "");
}
const button = (page, name) => page.getByRole("button", { name, exact: true });
const updated = (page) =>
  page
    .getByText("Conditional formatting updated. Unsaved changes.", {
      exact: true,
    })
    .waitFor();
async function color(page, ref, expected) {
  await page.waitForFunction(
    ({ ref, expected }) => {
      const cell = document.querySelector(`#grid [data-cell="${ref}"]`);
      return cell && getComputedStyle(cell).backgroundColor === expected;
    },
    { ref, expected },
  );
}
async function jump(page, ref) {
  await page.getByLabel("Cell address", { exact: true }).fill(ref);
  await page.keyboard.press("Tab");
}
// Selects offer only tokens; a tampered DOM must still be rejected by the model.
async function tamper(page, id, value) {
  await page.evaluate(
    ([id, value]) => {
      const select = document.getElementById(id);
      select.add(new Option(value, value));
      select.value = value;
    },
    [id, value],
  );
}

try {
  {
    const { context, page, errors, requests } = await ready("invalid"),
      before = await copy(page, "before");
    await open(page);
    await page
      .getByLabel("Condition value", { exact: true })
      .fill("not a number");
    await button(page, "Save rule").click();
    await page
      .locator("#conditional-context")
      .filter({ hasText: "finite number" })
      .waitFor();
    await page.getByLabel("Condition value", { exact: true }).fill("100");
    await page
      .getByLabel("Condition operator", { exact: true })
      .selectOption("between");
    await page.getByLabel("Upper condition value", { exact: true }).fill("10");
    await button(page, "Save rule").click();
    await page
      .locator("#conditional-context")
      .filter({ hasText: /bounds/ })
      .waitFor();
    await page.getByLabel("Upper condition value", { exact: true }).fill("200");
    await tamper(page, "conditional-fill", "url(https://example.invalid)");
    await button(page, "Save rule").click();
    await page
      .locator("#conditional-context")
      .filter({ hasText: /style/ })
      .waitFor();
    await page.getByLabel("Fill", { exact: true }).selectOption("dark");
    await page
      .getByLabel("Rule target range", { exact: true })
      .fill("not-a-range");
    await button(page, "Save rule").click();
    await page
      .locator("#conditional-context")
      .filter({ hasText: /range|address/i })
      .waitFor();
    await button(page, "Close conditional formatting").click();
    assert.deepEqual(await copy(page, "invalid-kept"), before);
    await open(page, "3. Summary!B1:B2 · gte");
    await page.getByLabel("Fill", { exact: true }).selectOption("dark");
    assert.equal(await button(page, "Move rule earlier").isDisabled(), true);
    await button(page, "Save rule").click();
    await updated(page);
    await color(page, "B2", "rgb(11, 28, 44)");
    assert.deepEqual(requests, []);
    await page
      .locator("#save-status")
      .filter({ hasText: "Recovery stored" })
      .waitFor();
    const saved = await copy(page, "metadata");
    assert.deepEqual(saved.sheets, before.sheets);
    assert.deepEqual(saved.snapshot, before.snapshot);
    await page.reload();
    await button(page, "Restore draft").click();
    await color(page, "B2", "rgb(11, 28, 44)");
    assert.deepEqual(await copy(page, "restored"), saved);
    await open(page, "3. Summary!B1:B2 · gte");
    await button(page, "Remove rule").click();
    await updated(page);
    assert.equal((await copy(page, "removed")).conditionalFormats.length, 2);
    await button(page, "Undo").click();
    await page
      .getByText("Undo restored the previous workbook.", { exact: true })
      .waitFor();
    await color(page, "B2", "rgb(11, 28, 44)");
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS conditional highlights: invalid rules are atomic; metadata changes preserve results, recover and undo without engine requests",
    );
  }
  {
    const parsed = readHTML(html);
    parsed.book.sheets[1].cells.B4.input.value = 0.9;
    const { context, page, errors } = await ready(
      "stale",
      replaceHTML(html, parsed, parsed.book),
      false,
    );
    await page
      .getByText(
        "Saved results are stale or missing. Apply an edit to recalculate.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await page
        .locator('#grid [data-cell="B2"]')
        .evaluate((el) => el.style.backgroundColor),
      "",
    );
    assert.match(
      await page
        .locator('#grid [data-cell="B2"]')
        .getAttribute("aria-description"),
      /stale/,
    );
    await button(page, "Recalculate").click();
    await page
      .getByText("Calculated locally. Unsaved changes.", { exact: true })
      .waitFor();
    await color(page, "B2", "rgb(175, 197, 212)");
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS conditional highlights: externally stale formula results stay unhighlighted until explicit recalculation",
    );
  }
  {
    const context = await browser.newContext(),
      page = await context.newPage();
    await page.addInitScript(() => {
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      let first = true;
      crypto.subtle.digest = async (...args) => {
        const result = await digest(...args);
        if (first) {
          first = false;
          globalThis.waitingHighlightVerification = true;
          await new Promise(
            (resolve) => (globalThis.releaseHighlightVerification = resolve),
          );
        }
        return result;
      };
    });
    const file = resolve(out, "conditional-unverified.html");
    await writeFile(file, html);
    await page.goto(pathToFileURL(file).href, { waitUntil: "commit" });
    await page.waitForFunction(() => globalThis.waitingHighlightVerification);
    assert.equal(
      await page
        .locator('#grid [data-cell="B2"]')
        .evaluate((el) => el.style.backgroundColor),
      "",
    );
    await page.evaluate(() => globalThis.releaseHighlightVerification());
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    await color(page, "B2", "rgb(233, 238, 242)");
    await context.close();
    console.log(
      "PASS conditional highlights: formula presentation waits for startup verification and redraws after it succeeds",
    );
  }
  {
    const book = conditionalWorkbook(),
      text = "first\n</textarea><script>globalThis.injected=true</script>\n001";
    book.sheets[0].cells.H2 = { input: { type: "text", value: text } };
    book.conditionalFormats.push({
      id: "multiline",
      sheetId: "summary",
      ref: "H2",
      kind: "highlight",
      condition: { operator: "eq", values: [{ type: "text", value: text }] },
      style: { fill: "dark", bold: false },
    });
    const { context, page, errors } = await ready(
      "typed",
      await buildWorkbook(book, { offline: true }),
    );
    await color(page, "H2", "rgb(11, 28, 44)");
    await open(page, "4. Summary!H2 · eq");
    assert.equal(
      await page.getByLabel("Condition value", { exact: true }).inputValue(),
      text,
    );
    assert.equal(
      await page.getByLabel("Font weight", { exact: true }).inputValue(),
      "normal",
    );
    await button(page, "Save rule").click();
    await updated(page);
    assert.deepEqual(
      (await copy(page, "typed")).conditionalFormats[3],
      book.conditionalFormats[3],
    );
    assert.equal(await page.evaluate(() => globalThis.injected), undefined);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS conditional highlights: multiline markup text and explicit regular font weight round trip safely",
    );
  }
  {
    const { context, page, errors } = await ready("structure");
    await button(page, "Insert rows").click();
    await page
      .getByText("Row/column references updated. Unsaved changes.", {
        exact: true,
      })
      .waitFor();
    await color(page, "B3", "rgb(233, 238, 242)");
    assert.deepEqual(
      (await copy(page, "shifted")).conditionalFormats.map((r) => r.ref),
      ["B3", "B3", "B1:B3"],
    );
    await jump(page, "B3");
    await button(page, "Delete rows").click();
    await page
      .getByText("Row/column references updated. Unsaved changes.", {
        exact: true,
      })
      .waitFor();
    assert.deepEqual(
      (await copy(page, "deleted")).conditionalFormats.map((r) => r.ref),
      ["#REF!", "#REF!", "B1:B2"],
    );
    await button(page, "Undo").click();
    await page
      .getByText("Undo restored the previous workbook.", { exact: true })
      .waitFor();
    await color(page, "B3", "rgb(233, 238, 242)");
    assert.deepEqual(
      (await copy(page, "shift-undone")).conditionalFormats.map((r) => r.ref),
      ["B3", "B3", "B1:B3"],
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS conditional highlights: structural shifts, deleted targets and undo preserve visible rule bindings",
    );
  }
  {
    const { context, page, errors } = await ready("failed-scenario");
    await page.evaluate(() => {
      const post = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (message) {
        if (message.method === "calculate" && !globalThis.failedHighlightCalc) {
          globalThis.failedHighlightCalc = true;
          return this.dispatchEvent(
            new MessageEvent("message", {
              data: {
                id: message.id,
                error: "Injected scenario calculation failure",
              },
            }),
          );
        }
        return post.call(this, message);
      };
    });
    await page
      .getByLabel("Scenario", { exact: true })
      .selectOption({ label: "Upside" });
    await page
      .locator("#status")
      .filter({ hasText: "Injected scenario calculation failure" })
      .waitFor();
    await color(page, "B2", "rgb(233, 238, 242)");
    assert.equal(
      await page.locator('#grid [data-cell="B2"]').textContent(),
      "€220.00",
    );
    const pending = await copy(page, "pending");
    assert.equal(pending.snapshot, undefined);
    assert.equal(pending.sheets[0].cells.B2.result.value, 220);
    await button(page, "Retry pending range").click();
    await page
      .getByText("Calculated locally. Unsaved changes.", { exact: true })
      .waitFor();
    await button(page, "Summary").click();
    await color(page, "B2", "rgb(175, 197, 212)");
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS conditional highlights: failed calculations retain prior values/appearance; retry publishes the new scenario together",
    );
  }
  {
    const book = conditionalWorkbook();
    book.conditionalFormats = [
      {
        id: "large-empty",
        sheetId: "summary",
        ref: "A1:XFD1048576",
        kind: "highlight",
        condition: { operator: "isBlank", values: [] },
        style: { fill: "dark" },
      },
    ];
    const { context, page, errors, requests } = await ready(
      "large-target",
      await buildWorkbook(book, { offline: true }),
    );
    await jump(page, "CV100000");
    await color(page, "CV100000", "rgb(11, 28, 44)");
    assert.ok((await page.locator("#grid [data-cell]").count()) < 600);
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS conditional highlights: Excel-sized blank targets render only a bounded visible viewport",
    );
  }
} finally {
  await browser.close();
}
