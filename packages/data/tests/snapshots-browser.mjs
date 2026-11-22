import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { readHTML, replaceHTML } from "../bench/storage/html.mjs";
import { command } from "./shell.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const source = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
const original = await buildWorkbook(source, { offline: true });
const browser = await chromium.launch();
try {
  // Opening must verify results without building the large fingerprint on the UI
  // thread. The recovery worker already receives the original inert JSON.
  {
    const file = resolve(out, "snapshot-worker-only.html");
    await writeFile(file, original);
    const page = await browser.newPage();
    const requests = [];
    await page.context().route(/^https?:\/\//, (route) => {
      requests.push(route.request().url());
      return route.abort();
    });
    await page.addInitScript(() => {
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      globalThis.mainDigestCalls = 0;
      crypto.subtle.digest = (...args) => {
        globalThis.mainDigestCalls++;
        return digest(...args);
      };
    });
    await page.goto(pathToFileURL(file).href);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    // Source payload, HTML shell and file-location identity only. Formula
    // fingerprint verification runs in the existing recovery worker.
    assert.equal(await page.evaluate(() => globalThis.mainDigestCalls), 3);
    assert.deepEqual(requests, []);
    await page.close();
    console.log(
      "PASS snapshots: startup verification stays in the recovery worker without engine requests",
    );
  }
  for (const mode of ["changed-input", "missing-result", "wrong-engine"]) {
    const parsed = readHTML(original),
      book = parsed.book;
    if (mode === "changed-input")
      book.sheets[0].cells.B2.input.value = 123.45678901234567;
    else if (mode === "missing-result") delete book.sheets[1].cells.B2.result;
    else book.snapshot.engine = "unrecognised/1";
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
    // The stale line offers Recalculate itself; it goes with the message.
    await page.locator("#status-recalculate").waitFor();
    if (mode === "missing-result") {
      await page.locator("#status-recalculate").click();
      await page
        .getByText("Calculated locally. Unsaved changes.", { exact: true })
        .waitFor();
      assert.equal(
        await page.locator("#status-recalculate").isHidden(),
        true,
        "hidden once the message is replaced",
      );
    }
    await page.getByLabel("Cell value").fill("987654");
    await command(page, "Recalculate");
    await page
      .getByText("Calculated locally. Unsaved changes.", { exact: true })
      .waitFor();
    assert.equal(await page.getByLabel("Cell value").inputValue(), "987654");
    const download = page.waitForEvent("download");
    await command(page, "Save a copy");
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
  {
    // Review defect 6: results that use TODAY() and were saved on an earlier
    // day are current by fingerprint but not by the clock; the editor says so.
    const book = structuredClone(source);
    book.sheets[1].cells.B4 = { formula: "=TODAY()" };
    const built = await buildWorkbook(book, { offline: true }),
      parsed = readHTML(built),
      old = parsed.book;
    old.sheets[1].cells.B4.result = { type: "number", value: 43831 };
    old.snapshot.calculatedAt = "2020-01-01T12:00:00.000Z";
    const file = resolve(out, "snapshot-volatile.html");
    await writeFile(file, replaceHTML(built, parsed, old));
    const page = await browser.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(file).href);
    await page
      .locator("#status")
      .filter({
        hasText:
          /^Saved results are current, but TODAY\(\) shows the value calculated on Jan 1, 2020\./,
      })
      .waitFor();
    assert.equal(
      await page.locator("#calc-state").textContent(),
      "Results dated",
    );
    await page.locator("#status-recalculate").click();
    await page
      .getByText("Calculated locally. Unsaved changes.", { exact: true })
      .waitFor();
    assert.equal(await page.locator("#calc-state").textContent(), "Calculated");
    const download = page.waitForEvent("download");
    await command(page, "Save a copy");
    const saved = resolve(out, "snapshot-volatile-saved.html");
    await (await download).saveAs(saved);
    const fresh = readHTML(await readFile(saved, "utf8")).book;
    // Today's date in the browser's own time zone, as a serial number.
    const today = await page.evaluate(() => {
      const d = new Date();
      return Math.round(
        (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) -
          Date.UTC(1899, 11, 30)) /
          86400000,
      );
    });
    assert.equal(fresh.sheets[1].cells.B4.result.value, today);
    // Reopened the same day, the saved results are simply current.
    await page.goto(pathToFileURL(saved).href);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      "PASS snapshots: volatile results from an earlier day are marked, recalculated with the local date",
    );
  }
  const file = resolve(out, "snapshot-late-startup.html");
  await writeFile(file, original);
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let first = true;
    crypto.subtle.digest = async (...args) => {
      const value = await digest(...args);
      if (first) {
        first = false;
        globalThis.snapshotDigestWaiting = true;
        await new Promise(
          (resolve) => (globalThis.releaseSnapshotDigest = resolve),
        );
      }
      return value;
    };
  });
  await page.goto(pathToFileURL(file).href, { waitUntil: "commit" });
  await page.waitForFunction(() => globalThis.snapshotDigestWaiting);
  await command(page, "Recalculate");
  await page
    .getByText("Calculated locally. Unsaved changes.", { exact: true })
    .waitFor();
  await page.evaluate(async () => {
    globalThis.releaseSnapshotDigest();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(
    await page.locator("#status").textContent(),
    "Calculated locally. Unsaved changes.",
  );
  await page.close();
  console.log(
    "PASS snapshots: obsolete startup fingerprint cannot overwrite newer calculation status",
  );
} finally {
  await browser.close();
}
