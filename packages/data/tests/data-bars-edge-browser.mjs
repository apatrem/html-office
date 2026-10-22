import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { dataBarWorkbook } from "../fixtures/bars.mjs";
import { large } from "../fixtures/generate.mjs";
import { readHTML, replaceHTML } from "../bench/storage/html.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const original = await buildWorkbook(dataBarWorkbook(), { offline: true }),
  browser = await chromium.launch();
async function ready(id, { html = original, init, current = true } = {}) {
  const context = await browser.newContext({ acceptDownloads: true }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  if (init) await page.addInitScript(init);
  const file = resolve(out, `data-bars-edge-${id}.html`);
  await writeFile(file, html);
  await page.goto(pathToFileURL(file).href);
  if (current)
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
  return { context, page, errors };
}
async function width(page, ref, expected) {
  await page.waitForFunction(
    ({ ref, expected }) => {
      const fill = document.querySelector(
        `#grid [data-cell="${ref}"] .data-bar-fill`,
      );
      return fill && Math.abs(parseFloat(fill.style.width) - expected) < 0.01;
    },
    { ref, expected },
  );
}
async function edit(page, ref, value) {
  await page.getByLabel("Cell address", { exact: true }).fill(ref);
  await page.keyboard.press("Tab");
  await page.getByLabel("Cell value", { exact: true }).fill(String(value));
  await page.getByRole("button", { name: "Apply edit", exact: true }).click();
  await page
    .getByText("Calculated locally. Unsaved changes.", { exact: true })
    .waitFor();
}
async function copy(page, id) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  const file = resolve(out, `data-bars-edge-${id}-saved.html`);
  await (await waiting).saveAs(file);
  return { file, book: readHTML(await readFile(file, "utf8")).book };
}
try {
  {
    const { context, page, errors } = await ready("stale-replies", {
      init: () => {
        const descriptor = Object.getOwnPropertyDescriptor(
            Worker.prototype,
            "onmessage",
          ),
          post = Worker.prototype.postMessage;
        globalThis.barSummaryCount = 0;
        Object.defineProperty(Worker.prototype, "onmessage", {
          configurable: true,
          get: descriptor.get,
          set(handler) {
            descriptor.set.call(this, (event) => {
              if (event.data.kind === "conditional-scales") {
                globalThis.barSummaryCount++;
                if (globalThis.holdNextBarSummary) {
                  globalThis.holdNextBarSummary = false;
                  globalThis.heldBarSummary = event.data;
                  globalThis.releaseBarSummary = () => handler(event);
                  return;
                }
              }
              handler(event);
            });
          },
        });
        Worker.prototype.postMessage = function (message) {
          if (message.method === "calculate")
            return setTimeout(() => post.call(this, message), 120);
          return post.call(this, message);
        };
      },
    });
    await width(page, "F3", 100 / 3);
    await page.evaluate(() => {
      globalThis.holdNextBarSummary = true;
    });
    await edit(page, "F6", 400);
    await width(page, "F3", 20);
    await page.waitForFunction(() => !!globalThis.heldBarSummary);
    assert.equal(
      await page.evaluate(() => globalThis.heldBarSummary.scales.mixed.max),
      200,
    );
    await page.evaluate(() => globalThis.releaseBarSummary());
    await width(page, "F3", 20);
    const count = await page.evaluate(() => globalThis.barSummaryCount);
    await page.locator("#grid").evaluate((el) => (el.scrollTop = 1200));
    await page.waitForFunction(() =>
      document.querySelector('#grid [data-cell="F40"]'),
    );
    await page.locator("#grid").evaluate((el) => (el.scrollTop = 0));
    await width(page, "F3", 20);
    assert.equal(await page.evaluate(() => globalThis.barSummaryCount), count);
    await page
      .locator("#save-status")
      .filter({ hasText: "Recovery stored" })
      .waitFor();
    const saved = await copy(page, "latest");
    assert.equal(saved.book.sheets[0].cells.F6.input.value, 400);
    assert.equal(saved.book.conditionalScales, undefined);
    await context.setOffline(true);
    await page.goto(pathToFileURL(saved.file).href);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    await width(page, "F3", 20);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS data bars: pending drafts use committed bounds; obsolete replies are ignored; scrolling does not rescan; saved offline reopen derives summaries",
    );
  }
  {
    // Fail only worker fingerprint verification: the existing UI fallback can
    // still verify this saved snapshot, then must refresh derived formula bounds.
    const injection = `let fingerprintDigests=0;const digest=crypto.subtle.digest.bind(crypto.subtle);crypto.subtle.digest=(...args)=>{if(++fingerprintDigests===1)return Promise.reject(new Error('Worker inspection unavailable'));return digest(...args);};`;
    const html = original.replace(
      /(<script id="recovery-worker-source"[^>]*>)/,
      "$1" + injection,
    );
    const { context, page, errors } = await ready("inspection-fallback", {
      html,
    });
    await width(page, "B2", 100);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS data bars: successful snapshot fallback refreshes automatic formula bounds after worker inspection failure",
    );
  }
  for (const mode of ["open-denied", "quota"]) {
    const injection =
      mode === "open-denied"
        ? `indexedDB.open=()=>{throw new DOMException('Storage denied','SecurityError')};`
        : `const nativeOpen=indexedDB.open.bind(indexedDB);indexedDB.open=(...args)=>{const request=nativeOpen(...args);request.addEventListener('success',()=>{const db=request.result,transaction=db.transaction.bind(db);db.transaction=(...args)=>{const tx=transaction(...args);if(args[1]==='readwrite'){const objectStore=tx.objectStore.bind(tx);tx.objectStore=(...args)=>{const store=objectStore(...args);store.put=()=>{throw new DOMException('Quota exceeded','QuotaExceededError')};return store}}return tx}});return request};`;
    const html = original.replace(
        /(<script id="recovery-worker-source"[^>]*>)/,
        "$1" + injection,
      ),
      { context, page, errors } = await ready(mode, { html });
    await width(page, "F3", 100 / 3);
    await edit(page, "F6", 400);
    await width(page, "F3", 20);
    await page
      .locator("#save-status")
      .filter({
        hasText: mode === "open-denied" ? "Storage denied" : "Quota exceeded",
      })
      .waitFor();
    await edit(page, "F6", 100);
    await width(page, "F3", 50);
    assert.match(
      await page.locator("#save-status").textContent(),
      /Recovery unavailable/,
    );
    assert.equal(
      (await copy(page, mode)).book.sheets[0].cells.F6.input.value,
      100,
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `PASS data bars: ${mode} preserves analysis, repeated edits, warning and copy save`,
    );
  }
  {
    const { context, page, errors } = await ready("worker-failed", {
      init: () => {
        const post = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function (message) {
          if (message.kind === "init") globalThis.barRecoveryWorker = this;
          return post.call(this, message);
        };
      },
    });
    await width(page, "F3", 100 / 3);
    await page.evaluate(() => {
      globalThis.barRecoveryWorker.terminate();
      globalThis.barRecoveryWorker.onerror({
        message: "Injected recovery worker failure",
      });
    });
    await page
      .locator("#save-status")
      .filter({ hasText: "Injected recovery worker failure" })
      .waitFor();
    assert.equal(
      await page.locator('#grid [data-cell="F3"] .data-bar-fill').count(),
      0,
    );
    await width(page, "H5", 50);
    assert.match(
      await page
        .locator('#grid [data-cell="F3"]')
        .getAttribute("aria-description"),
      /unavailable/,
    );
    await edit(page, "F6", 400);
    await width(page, "H5", 50);
    assert.equal(
      await page.locator('#grid [data-cell="F3"] .data-bar-fill').count(),
      0,
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS data bars: actual worker failure removes automatic bars without UI-thread scanning; fixed bars and workbook edits remain available",
    );
  }
  {
    const parsed = readHTML(original);
    parsed.book.sheets[1].cells.B4.input.value = 0.9;
    const { context, page, errors } = await ready("stale-snapshot", {
      html: replaceHTML(original, parsed, parsed.book),
      current: false,
    });
    await page
      .getByText(
        "Saved results are stale or missing. Apply an edit to recalculate.",
        { exact: true },
      )
      .waitFor();
    await width(page, "F3", 100 / 3);
    assert.equal(
      await page.locator('#grid [data-cell="B2"] .data-bar-fill').count(),
      0,
    );
    await page
      .getByRole("button", { name: "Recalculate", exact: true })
      .click();
    await page
      .getByText("Calculated locally. Unsaved changes.", { exact: true })
      .waitFor();
    await width(page, "B2", 100);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS data bars: stale formula bars wait for verified results while input bars remain available",
    );
  }
  {
    const { context, page, errors } = await ready("structure");
    await width(page, "F3", 100 / 3);
    await page.getByLabel("Cell address", { exact: true }).fill("F3");
    await page.keyboard.press("Tab");
    await page
      .getByRole("button", { name: "Insert rows", exact: true })
      .click();
    await page
      .getByText("Row/column references updated. Unsaved changes.", {
        exact: true,
      })
      .waitFor();
    await width(page, "F4", 100 / 3);
    assert.equal(
      (await copy(page, "shifted")).book.conditionalFormats.find(
        (r) => r.id === "mixed",
      ).ref,
      "F4:F11",
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page
      .getByText("Undo restored the previous workbook.", { exact: true })
      .waitFor();
    await width(page, "F3", 100 / 3);
    await page
      .locator("#save-status")
      .filter({ hasText: "Recovery stored" })
      .waitFor();
    const saved = await copy(page, "before-restore");
    await page.reload();
    await page
      .getByRole("button", { name: "Restore draft", exact: true })
      .click();
    await width(page, "F3", 100 / 3);
    assert.deepEqual((await copy(page, "restored")).book, saved.book);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "PASS data bars: structural ranges, undo and recovered snapshot verification refresh derived summaries",
    );
  }
  {
    const book = large({ rows: 100000, columns: 8, preaggregate: true });
    book.conditionalFormats = [
      {
        id: "large-bar",
        sheetId: "raw",
        ref: "F1:F100000",
        kind: "dataBar",
        scale: { kind: "auto" },
        positive: "acc",
        negative: "alert",
      },
    ];
    const { context, page, errors } = await ready("large", {
        html: await buildWorkbook(book, { calculate: false }),
        current: false,
      }),
      requests = [];
    page.on("request", (r) => {
      if (/^https?:/.test(r.url())) requests.push(r.url());
    });
    await width(page, "F3", 40);
    await page.evaluate(() => {
      globalThis.barLongTasks = [];
      globalThis.barTaskObserver = new PerformanceObserver((list) =>
        globalThis.barLongTasks.push(
          ...list.getEntries().map((e) => e.duration),
        ),
      );
      globalThis.barTaskObserver.observe({ type: "longtask" });
      globalThis.barNavigationStart = performance.now();
    });
    await page.getByLabel("Cell address", { exact: true }).fill("F99999");
    await page.keyboard.press("Tab");
    await width(page, "F99999", 100);
    const measurement = await page.evaluate(async () => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const mainThreadMaxMS = Math.max(
        0,
        ...globalThis.barLongTasks,
        ...globalThis.barTaskObserver.takeRecords().map((e) => e.duration),
      );
      globalThis.barTaskObserver.disconnect();
      return {
        rows: 100000,
        populatedColumns: 8,
        renderedCells: document.querySelectorAll("#grid [data-cell]").length,
        navigationMS: performance.now() - globalThis.barNavigationStart,
        mainThreadMaxMS,
      };
    });
    assert.ok(measurement.renderedCells < 600);
    assert.ok(measurement.mainThreadMaxMS < 100);
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
    await writeFile(
      resolve(out, "data-bars-large-results.json"),
      JSON.stringify(measurement, null, 2) + "\n",
    );
    await context.close();
    console.log(
      `PASS data bars large viewport: ${JSON.stringify(measurement)}`,
    );
  }
} finally {
  await browser.close();
}
