// U04-Data acceptance: captures the fictional P&L in the variant A mock-up's
// states (Calculations sheet, cell C4) and writes a side-by-side page with the
// grid-row and page-scroll measurements.
// Usage (from packages/data): node tools/shell-compare.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "./build.mjs";
import { pnl } from "../fixtures/generate.mjs";

const out = resolve("bench/shell-variant-a"),
  targets = "../../../../docs/mockups/shell/screenshots";
// Variant A mock-up measurements (docs/mockups/shell/screenshots).
const STATES = [
  { id: "1440", width: 1440, height: 900, rows: 32, target: "a-data-1440.jpg" },
  { id: "375", width: 375, height: 812, rows: 28, target: "a-data-375.jpg" },
];
await mkdir(out, { recursive: true });
const file = resolve("dist/data-test/shell-compare.html");
await mkdir(resolve("dist/data-test"), { recursive: true });
await writeFile(file, await buildWorkbook(pnl()));
const browser = await chromium.launch(),
  measured = {};
try {
  for (const state of STATES) {
    const context = await browser.newContext({
        viewport: { width: state.width, height: state.height },
        deviceScaleFactor: state.width < 720 ? 2 : 1,
      }),
      page = await context.newPage();
    await page.goto(pathToFileURL(file).href);
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    if (state.width < 720)
      await page
        .getByLabel("Sheet", { exact: true })
        .selectOption({ label: "Calculations" });
    else
      await page
        .getByRole("button", { name: "Calculations", exact: true })
        .click();
    await page.locator('#grid [data-cell="C4"]').click();
    measured[state.id] = await page.evaluate(() => {
      const grid = document.getElementById("grid").getBoundingClientRect();
      return {
        // Header row included, as the mock-up counts it.
        rows:
          1 +
          [...document.querySelectorAll(".grid-row-head")].filter((head) => {
            const r = head.getBoundingClientRect();
            return r.top >= grid.top && r.bottom <= grid.bottom + 1;
          }).length,
        pageScroll:
          document.documentElement.scrollWidth > innerWidth ||
          document.documentElement.scrollHeight > innerHeight,
      };
    });
    await page.screenshot({
      path: resolve(out, `current-${state.id}.jpg`),
      quality: 70,
    });
    await context.close();
  }
} finally {
  await browser.close();
}
const rows = STATES.map(
  (s) =>
    `<tr><th scope="row">${s.width} × ${s.height}</th><td>${s.rows}, no page scroll</td><td>${measured[s.id].rows}, ${measured[s.id].pageScroll ? "page scrolls" : "no page scroll"}</td></tr>`,
).join("");
const pairs = STATES.map(
  (s) => `<section><h2>${s.width} × ${s.height}</h2><div class="pair">
<figure><img src="${targets}/${s.target}" alt="Variant A mock-up at ${s.width} × ${s.height}"><figcaption>Variant A mock-up (U02)${s.width > 720 ? ", cell styles panel open (arrives with F05)" : ""}</figcaption></figure>
<figure><img src="current-${s.id}.jpg" alt="html-data at ${s.width} × ${s.height}"><figcaption>html-data after U04-Data</figcaption></figure></div></section>`,
).join("\n");
await writeFile(
  resolve(out, "index.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Variant A parity</title>
<style>body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#1d2a35;background:#f6f7f9}main{max-width:1500px;margin:0 auto;padding:24px 16px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}figure{margin:0}img{width:100%;height:auto;border:1px solid #dde1e6;border-radius:6px;background:#fff;display:block}table{border-collapse:collapse;background:#fff;border:1px solid #dde1e6}th,td{padding:7px 12px;border-bottom:1px solid #dde1e6;text-align:left}@media (max-width:700px){.pair{grid-template-columns:1fr}}</style></head><body><main>
<h1>Data shell: variant A mock-up and html-data</h1>
<p>Fictional P&amp;L, Calculations sheet, cell C4 selected. Regenerate from <code>packages/data</code> with <code>node tools/shell-compare.mjs</code>.</p>
<table><thead><tr><th scope="col">Viewport</th><th scope="col">Grid rows, mock-up</th><th scope="col">Grid rows, html-data</th></tr></thead><tbody>${rows}</tbody></table>
${pairs}
</main></body></html>
`,
);
await writeFile(
  resolve(out, "measurements.json"),
  JSON.stringify(measured, null, 2) + "\n",
);
console.log(JSON.stringify(measured));
for (const s of STATES)
  if (measured[s.id].rows < s.rows || measured[s.id].pageScroll)
    throw new Error(`Variant A parity not met at ${s.width} px`);
