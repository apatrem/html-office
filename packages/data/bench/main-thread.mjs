import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import assert from "node:assert/strict";
const benchmark = await build({
  stdin: {
    contents:
      "export {loadEngine} from './packages/data/runtime/loader.mjs'; export {EngineSession} from './packages/data/engine/adapter.mjs';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  write: false,
});
const source =
  benchmark.outputFiles[0].text +
  "\nglobalThis.assessment={loadEngine,EngineSession};";
const browser = await chromium.launch();
const report = {
  method:
    "Same typed adapter and calculation+snapshot code as worker, executed directly on the main thread. Five warm edits; excludes DOM rendering.",
  cases: [],
};
try {
  for (const id of ["pnl", "100000x2-scans"]) {
    const file = resolve(`dist/data-bench/${id}-main.html`),
      html = await readFile(resolve(`dist/data-bench/${id}.html`), "utf8");
    await writeFile(
      file,
      html.replace(
        "</body>",
        `<script type="module">${source}</script></body>`,
      ),
    );
    const page = await browser.newPage();
    page.setDefaultTimeout(180000);
    await page.goto(pathToFileURL(file).href, { timeout: 180000 });
    await page.waitForFunction(() => globalThis.assessment);
    const result = await page.evaluate(async (id) => {
      const { loadEngine, EngineSession } = assessment,
        module = await loadEngine(
          JSON.parse(document.querySelector("#engine-config").textContent),
        ),
        session = new EngineSession(module),
        book = JSON.parse(document.querySelector("#workbook").textContent);
      session.load(book);
      const longTasks = [];
      const observer = new PerformanceObserver((list) =>
        longTasks.push(...list.getEntries().map((e) => e.duration)),
      );
      observer.observe({ type: "longtask" });
      const runs = [];
      try {
        for (let n = 1; n <= 5; n++) {
          const start = performance.now();
          session.edit(
            id === "pnl" ? "inputs" : "raw",
            id === "pnl" ? "B2" : "B1",
            {
              input: {
                type: "number",
                value: id === "pnl" ? 0.02 + n * 0.001 : 50 + n,
              },
            },
          );
          const delta = await session.calculateDelta();
          runs.push({
            calculateMS: performance.now() - start,
            result: delta.results[0].result.value,
          });
          await new Promise((r) => setTimeout(r, 20));
        }
      } finally {
        session.dispose();
        observer.disconnect();
      }
      return { id, runs, longTasks };
    }, id);
    if (id !== "pnl")
      assert.equal(
        result.runs[4].result,
        JSON.parse(
          /<script id="workbook"[^>]*>([\s\S]*?)<\/script>/.exec(html)[1],
        ).metadata.benchmark.expectedTotal + 5,
      );
    report.cases.push(result);
    await page.close();
    console.log(JSON.stringify(result));
  }
} finally {
  await browser.close();
}
await writeFile(
  "packages/data/bench/main-thread-results.json",
  JSON.stringify(report, null, 2) + "\n",
);
