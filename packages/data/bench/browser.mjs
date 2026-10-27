import { execFile } from "node:child_process";
import { promisify } from "node:util";
// Measures the actual standalone file:// editor; no local server or fake calculator.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import os from "node:os";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { pnl, large } from "../fixtures/generate.mjs";
import {
  buildWorkbook,
  measureHTML,
  STANDARD_CODE_CEILING,
} from "../tools/build.mjs";
import { command } from "../tests/shell.mjs";
const out = resolve("dist/data-bench");
await mkdir(out, { recursive: true });
const recipes = JSON.parse(
  await readFile(new URL("../fixtures/large-workloads.json", import.meta.url)),
);
const cases = [
  { id: "pnl", make: pnl },
  ...recipes.datasets.map((r) => ({
    id: `${r.rows}x${r.columns}-${r.preaggregate ? "reused" : "scans"}`,
    make: () => large(r),
  })),
];
const caseArg = process.argv.indexOf("--case");
const profiling = process.argv.includes("--profile");
const filter =
  caseArg >= 0
    ? (c) => c.id === process.argv[caseArg + 1]
    : process.argv.includes("--pnl-only")
      ? (c) => c.id === "pnl"
      : () => true;
assert.ok(cases.some(filter), "Unknown benchmark workload");
const server = await chromium.launchServer({
  args: ["--enable-precise-memory-info"],
});
const browser = await chromium.connect(server.wsEndpoint());
const run = promisify(execFile);
function memorySampler() {
  let peak = 0,
    busy = false;
  const root = server.process().pid;
  async function sample() {
    if (busy) return;
    busy = true;
    try {
      const { stdout } = await run("ps", ["-axo", "pid=,ppid=,rss="]);
      const rows = stdout
        .trim()
        .split("\n")
        .map((line) => line.trim().split(/\s+/).map(Number));
      const ids = new Set([root]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const [pid, parent] of rows)
          if (ids.has(parent) && !ids.has(pid)) {
            ids.add(pid);
            changed = true;
          }
      }
      let bytes = 0;
      for (const [pid, , rss] of rows) if (ids.has(pid)) bytes += rss * 1024;
      peak = Math.max(peak, bytes);
    } catch {
    } finally {
      busy = false;
    }
  }
  const timer = setInterval(sample, 200);
  sample();
  return async () => {
    clearInterval(timer);
    while (busy) await new Promise((r) => setTimeout(r, 10));
    await sample();
    return peak || null;
  };
}
const report = {
  environment: {
    date: new Date().toISOString(),
    node: process.version,
    browser: browser.version(),
    platform: os.platform(),
    architecture: os.arch(),
    cpu: os.cpus()[0].model,
    logicalCPUs: os.cpus().length,
    memoryBytes: os.totalmem(),
  },
  method:
    "Standalone offline file://; same pinned IronCalc as standard. Warm edit-to-paint includes result snapshot and DOM refresh. Five input changes after one engine load. Long tasks only during warm edits. WASM memory is maximum sampled allocated linear memory. Browser-tree RSS is sampled every 200ms via ps, sums processes including shared pages, and may miss short peaks; it is not unique physical memory. Cold file opening and initial engine/model load reported separately. Network delivery assessed separately.",
  cases: [],
};
try {
  for (const item of cases.filter(filter)) {
    console.log(`Building and checking ${item.id}`);
    let book = item.make();
    if (item.id !== "pnl") book.sheets[0].metadata = { layout: "table" };
    const html = await buildWorkbook(book, { offline: true }),
      file = resolve(out, `${item.id}.html`);
    await writeFile(file, html);
    const stopMemorySampling = memorySampler();
    const configMatch =
        /<script id="engine-config"[^>]*>([\s\S]*?)<\/script>/.exec(html),
      standardConfig = JSON.parse(configMatch[1]);
    delete standardConfig.embedded;
    // A standard build embeds neither the engine nor ECharts (T18).
    const standardHTML = html
      .replace(configMatch[1], JSON.stringify(standardConfig))
      .replace(/<script id="echarts-source"[^>]*>[\s\S]*?<\/script>\n?/, "");
    const standardSize = measureHTML(standardHTML);
    assert.ok(standardSize.applicationCodeBytes < STANDARD_CODE_CEILING);
    await writeFile(resolve(out, `${item.id}-standard.html`), standardHTML);
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const cdp =
      profiling || process.argv.includes("--cpu-throttle")
        ? await context.newCDPSession(page)
        : null;
    page.setDefaultTimeout(180000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const cold = performance.now();
    await page.goto(pathToFileURL(file).href, { timeout: 180000 });
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    const coldOpenMS = performance.now() - cold;
    const isPL = item.id === "pnl",
      sheet = isPL ? "Inputs" : "Raw",
      ref = isPL ? "B2" : book.metadata.benchmark.editedRawCell;
    await page.getByRole("button", { name: sheet, exact: true }).click();
    await page.locator(`[data-cell="${ref}"]`).click();
    const initial = isPL ? 0.02 : book.metadata.benchmark.editedInitialValue;
    await page.evaluate(() => {
      window.measurements = [];
      window.longTasks = [];
      window.measuring = false;
      new PerformanceObserver((list) => {
        if (window.measuring)
          window.longTasks.push(...list.getEntries().map((e) => e.duration));
      }).observe({ type: "longtask", buffered: false });
      document
        .querySelector("#apply")
        .addEventListener(
          "click",
          () => (window.editStarted = performance.now()),
          true,
        );
      window.addEventListener("html-data:calculated", (event) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            window.measurements.push({
              ...event.detail,
              editToPaintMS: performance.now() - window.editStarted,
            });
          }),
        ),
      );
    });
    await page.getByLabel("Cell value").fill(String(initial));
    await page.getByRole("button", { name: "Apply edit" }).click();
    await page.waitForFunction(() => window.measurements.length === 1);
    const first = await page.evaluate(() => window.measurements[0]);
    if (process.argv.includes("--cpu-throttle"))
      await cdp.send("Emulation.setCPUThrottlingRate", {
        rate: Number(process.argv[process.argv.indexOf("--cpu-throttle") + 1]),
      });
    if (profiling) {
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.start");
    }
    await page.evaluate(() => {
      window.measurements = [];
      window.longTasks = [];
      window.measuring = true;
    });
    for (let i = 1; i <= 5; i++) {
      await page
        .getByLabel("Cell value")
        .fill(String(initial + i * (isPL ? 0.001 : 1)));
      await page.getByRole("button", { name: "Apply edit" }).click();
      await page.waitForFunction((n) => window.measurements.length === n, i);
    }
    const measured = await page.evaluate(() => {
      window.measuring = false;
      return {
        runs: window.measurements,
        longTasks: window.longTasks,
        mainJSHeapBytes: performance.memory?.usedJSHeapSize ?? null,
      };
    });
    if (profiling) {
      const { profile } = await cdp.send("Profiler.stop");
      await mkdir(resolve(out, "profiles"), { recursive: true });
      await writeFile(
        resolve(out, "profiles", `${item.id}.cpuprofile`),
        JSON.stringify(profile),
      );
    }
    const downloadPromise = page.waitForEvent("download");
    await command(page, "Save a copy");
    const download = await downloadPromise;
    const saved = resolve(out, `${item.id}-saved.html`);
    await download.saveAs(saved);
    const savedHTML = await readFile(saved, "utf8"),
      canonical = JSON.parse(
        /<script id="workbook"[^>]*>([\s\S]*?)<\/script>/.exec(savedHTML)[1],
      );
    if (isPL) {
      const growth = initial + 0.005;
      let expected = 1530 * 25;
      for (let n = 1; n <= 12; n++) expected += 155 * (1 + growth) ** n * 25;
      assert.ok(
        Math.abs(canonical.sheets[0].cells.B2.result.value - expected) < 1e-7,
      );
    } else {
      const expected = book.metadata.benchmark.expectedTotal + 5;
      for (const cell of Object.values(canonical.sheets[1].cells))
        assert.equal(cell.result.value, expected);
    }
    assert.deepEqual(errors, []);
    const warmMaxMS = Math.max(...measured.runs.map((r) => r.editToPaintMS)),
      mainThreadMaxMS = Math.max(0, ...measured.longTasks);
    report.cases.push({
      id: item.id,
      workload: book.metadata.benchmark,
      size: measureHTML(html),
      standardSize,
      initialEngineMetrics: first.loadMetrics,
      sampledPeakBrowserTreeRSSBytes: await stopMemorySampling(),
      coldOpenMS,
      initialLoadEditToPaintMS: first.editToPaintMS,
      maximumSampledWasmMemoryBytes: Math.max(
        first.wasmMemoryBytes,
        ...measured.runs.map((r) => r.wasmMemoryBytes),
      ),
      ...measured,
      warmMaxMS,
      mainThreadMaxMS,
      correctness:
        "All 1000 large-fixture result cells or the P&L revenue total verified after saving",
      targets: {
        standardCodeUnderCeiling:
          standardSize.applicationCodeBytes < STANDARD_CODE_CEILING,
        pnlWarmUnder250MS: !isPL || warmMaxMS < 250,
        warmCalculationMainTaskUnder100MS: mainThreadMaxMS < 100,
      },
    });
    await writeFile(
      resolve(out, "browser-results.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({ id: item.id, coldOpenMS, warmMaxMS, mainThreadMaxMS }),
    );
    await context.close();
    book = null;
    globalThis.gc?.();
  }
} finally {
  await browser.close();
  await server.close();
}
const outputArg = process.argv.indexOf("--output");
if (outputArg >= 0)
  await writeFile(
    resolve(process.argv[outputArg + 1]),
    JSON.stringify(report, null, 2) + "\n",
  );
if (process.argv.includes("--check"))
  for (const c of report.cases)
    for (const [target, passed] of Object.entries(c.targets))
      assert.ok(passed, `${c.id}: ${target} failed`);
