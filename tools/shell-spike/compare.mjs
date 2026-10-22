// Gap to variant A: captures the R06 sample in the same states as the U02
// variant A mock-up screenshots (Calculations sheet, cell C4, same panel and
// viewport) and writes a side-by-side page.
// Usage (repository root, after build.mjs): node tools/shell-spike/compare.mjs
// The target-*.jpg files are copies of docs/mockups/shell/screenshots/a-data-*.jpg.
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url)),
  repo = resolve(here, "../.."),
  dir = resolve(here, "results/variant-a");
const STATES = [
  ["a-data-1440", 1440, "styles", "1440 × 900 · cell styles panel"],
  ["a-data-375", 375, "", "375 × 812 · no panel"],
  ["a-data-settings-1440", 1440, "settings", "1440 × 900 · document settings"],
  ["a-data-regional-1440", 1440, "regional", "1440 × 900 · regional settings"],
  ["a-data-styles-375", 375, "styles", "375 × 812 · cell styles as a bottom sheet"],
];
// Variant A mock-up measurements (docs/mockups/shell/screenshots/measurements.json).
const TARGET = { 1440: { rows: 32, pageScroll: false }, 375: { rows: 28, pageScroll: false } };

const browser = await chromium.launch();
const measured = {};
for (const [name, width, panel] of [...STATES, ["a-data-1440-nopanel", 1440, ""]]) {
  const context = await browser.newContext({ viewport: { width, height: width === 375 ? 812 : 900 }, deviceScaleFactor: width === 375 ? 2 : 1 });
  await context.route("https://raw.githubusercontent.com/**", async (route) =>
    route.fulfill({ body: await readFile(resolve(repo, "packages/data/engine/vendor", route.request().url().endsWith(".wasm.gz") ? "ironcalc.wasm.gz" : "ironcalc.mjs")) }),
  );
  const page = await context.newPage();
  await page.goto(pathToFileURL(resolve(repo, "dist/shell-spike/shell-native.html")).href);
  await page.getByText("Editing toolbar ready.", { exact: true }).waitFor();
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Calculations", exact: true }).click();
  await page.locator('#grid [data-cell="C4"]').click();
  if (panel === "styles") await page.locator("#shell-root").getByRole("button", { name: "Styles", exact: true }).click();
  if (panel === "settings") await page.getByRole("button", { name: "Document settings: theme, font, regional" }).click();
  if (panel === "regional") {
    await page.locator("#shell-root").getByRole("menuitem", { name: "File" }).click();
    await page.getByRole("menuitem", { name: "Regional settings…" }).click();
  }
  await page.waitForTimeout(200);
  if (!name.endsWith("nopanel")) await page.screenshot({ path: resolve(dir, `current-${name}.jpg`), type: "jpeg", quality: 82 });
  if (!panel)
    measured[width] = await page.evaluate(() => {
      const grid = document.getElementById("grid").getBoundingClientRect(),
        bottom = Math.min(grid.bottom, innerHeight);
      // Header row included, as in the mock-up measurement.
      const rows = [...document.querySelectorAll("#grid .grid-row, #grid .grid-column-head")]
        .map((el) => el.getBoundingClientRect())
        .filter((r, i, all) => r.top >= grid.top - 0.5 && r.bottom <= bottom + 0.5 && all.findIndex((o) => Math.round(o.top) === Math.round(r.top)) === i).length;
      return { rows, gridTop: Math.round(grid.top), pageScroll: document.documentElement.scrollHeight > innerHeight + 1 };
    });
  await context.close();
}
await browser.close();

const figure = ([name, , , caption]) => `<section><h2>${caption}</h2><div class="pair">
<figure><img src="target-${name}.jpg" alt="Variant A mock-up, ${caption}" loading="lazy"><figcaption>Variant A mock-up (U02)</figcaption></figure>
<figure><img src="current-${name}.jpg" alt="R06 spike, ${caption}" loading="lazy"><figcaption>R06 spike today</figcaption></figure></div></section>`;
const row = (w) => `<tr><th scope="row">${w === "1440" ? "1440 × 900" : "375 × 812"}</th><td>${TARGET[w].rows}, no page scroll</td><td>${measured[w].rows}${measured[w].pageScroll ? ", page scrolls" : ""}</td></tr>`;
await writeFile(
  resolve(dir, "index.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Variant A gap</title>
<style>:root{color-scheme:light}body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#1d2a35;background:#f6f7f9}main{max-width:1500px;margin:0 auto;padding:24px 16px}h1{font-size:24px;margin:0 0 6px}h2{font-size:16px;margin:28px 0 10px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}figure{margin:0}img{width:100%;height:auto;border:1px solid #dde1e6;border-radius:6px;background:#fff;display:block}figcaption{font-size:12.5px;color:#5f6b75;margin-top:4px}
table{border-collapse:collapse;background:#fff;border:1px solid #dde1e6;font-size:14px}th,td{padding:7px 12px;border-bottom:1px solid #dde1e6;text-align:left}thead th{background:#eef1f4}
@media (max-width:700px){.pair{grid-template-columns:1fr}}</style></head><body><main>
<h1>Data shell: variant A mock-up vs the R06 spike</h1>
<p>Same states: Calculations sheet, cell C4 selected. The gap list is in <code>docs/HTML-DATA-NATIVE-SHELL-SPIKE.md</code>. Regenerate with <code>node tools/shell-spike/compare.mjs</code>.</p>
<table><thead><tr><th scope="col">Viewport</th><th scope="col">Grid rows, mock-up</th><th scope="col">Grid rows, spike</th></tr></thead><tbody>${row("1440")}${row("375")}</tbody></table>
${STATES.map(figure).join("\n")}
</main></body></html>
`,
);
await writeFile(resolve(dir, "measurements.json"), JSON.stringify({ target: TARGET, current: measured }, null, 2) + "\n");
console.log(JSON.stringify(measured));
