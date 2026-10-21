import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
const here = dirname(fileURLToPath(import.meta.url)),
  out = resolve(here, "../../../dist/toolbar-functional");
const browser = await chromium.launch(),
  cases = [];
try {
  for (const mode of ["baseline", "native", "embedded"]) {
    const context = await browser.newContext({
        acceptDownloads: true,
        offline: true,
        viewport: { width: 1440, height: 1000 },
      }),
      page = await context.newPage(),
      errors = [],
      requests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (/^https?:/.test(r.url())) requests.push(r.url());
    });
    page.on("dialog", (d) => d.accept());
    await page.goto(
      pathToFileURL(
        resolve(
          out,
          mode === "baseline"
            ? "baseline-offline.html"
            : `toolbar-${mode}-offline.html`,
        ),
      ).href,
    );
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    if (mode !== "baseline") {
      await page.locator("#activate-toolbar").click();
      await page
        .getByText(
          "Editing toolbar ready. Grey controls are unsupported in the current workbook model.",
          { exact: true },
        )
        .waitFor();
    }
    await page.getByRole("button", { name: "Inputs", exact: true }).click();
    await page.locator('#grid [data-cell="E2"]').click();
    await page.evaluate(() => {
      globalThis.measurements = [];
      globalThis.calculationLongTasks = [];
      globalThis.measuring = false;
      new PerformanceObserver((list) => {
        if (globalThis.measuring)
          globalThis.calculationLongTasks.push(
            ...list.getEntries().map((e) => e.duration),
          );
      }).observe({ type: "longtask" });
      document.getElementById("apply").addEventListener(
        "click",
        () => {
          globalThis.editStart = performance.now();
        },
        true,
      );
      window.addEventListener("html-data:calculated", (event) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            globalThis.measurements.push({
              editToPaintMs: performance.now() - globalThis.editStart,
              calculateMs: event.detail.calculateMS,
              wasmMemoryBytes: event.detail.wasmMemoryBytes,
            });
          }),
        ),
      );
    });
    for (let i = 0; i <= 5; i++) {
      if (i === 1)
        await page.evaluate(() => {
          globalThis.measuring = true;
        });
      await page
        .getByLabel("Cell value", { exact: true })
        .fill(String(0.02 + i * 0.001));
      await page.locator("#apply").click();
      await page.waitForFunction(
        (n) => globalThis.measurements.length === n,
        i + 1,
      );
    }
    const measured = await page.evaluate(() => {
      globalThis.measuring = false;
      return {
        runs: globalThis.measurements,
        longTasks: globalThis.calculationLongTasks,
      };
    });
    const download = page.waitForEvent("download");
    await page.locator("#save").click();
    const saved = resolve(out, `performance-${mode}-saved.html`);
    await (await download).saveAs(saved);
    const html = await readFile(saved, "utf8"),
      book = JSON.parse(
        /<script id="workbook"[^>]*>([\s\S]*?)<\/script>/.exec(html)[1],
      );
    let expected = 1530 * 25;
    for (let n = 1; n <= 12; n++) expected += 155 * (1 + 0.025) ** n * 25;
    assert.ok(
      Math.abs(
        book.sheets.find((s) => s.id === "summary").cells.B2.result.value -
          expected,
      ) < 1e-7,
    );
    const warmMaxMs = Math.max(
        ...measured.runs.slice(1).map((r) => r.editToPaintMs),
      ),
      mainThreadMaxMs = Math.max(0, ...measured.longTasks);
    assert.ok(warmMaxMs < 250, "unchanged P&L warm gate");
    assert.ok(mainThreadMaxMs < 100, "unchanged main-task gate");
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    cases.push({
      mode,
      ...measured,
      warmMaxMs,
      mainThreadMaxMs,
      correctness:
        "Saved P&L total matches independent geometric-series expectation after five assumption edits",
      passed: true,
    });
    await context.close();
  }
  const report = {
    browser: browser.version(),
    conditions:
      "Same fictional 24-month P&L, offline file://, one engine warm-up then five Base growth edits .021 through .025, two-animation-frame edit-to-paint timing; baseline then native then actual upstream, uncontrolled browser GC. No network. Existing P&L warm<250ms and main-task<100ms gates unchanged. Does not replace the full five-workload release suite.",
    cases,
  };
  await writeFile(
    resolve(here, "results/pnl-performance.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      cases.map((c) => ({
        mode: c.mode,
        warmMaxMs: c.warmMaxMs,
        mainThreadMaxMs: c.mainThreadMaxMs,
      })),
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
