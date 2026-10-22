// Rebuilds the mock-ups, captures screenshots at 1440 and 375 px, measures the
// canvas left by each variant, then rebuilds index.html with the measurements.
// Usage (repository root, Playwright Chromium installed): node docs/mockups/shell/screenshots.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { buildAll, file } from "./build.mjs";

const dir = new URL("screenshots/", import.meta.url);
mkdirSync(dir, { recursive: true });
buildAll();

const SIZES = { 1440: { width: 1440, height: 900 }, 375: { width: 375, height: 812 } };
// [product, state, width, suffix]
const SHOTS = [
  ["slides", "", 1440, ""],
  ["slides", "none", 375, ""],
  ["data", "", 1440, ""],
  ["data", "none", 375, ""],
  ["data", "regional", 1440, "-regional"],
  ["data", "settings", 1440, "-settings"],
  ["data", "styles", 375, "-styles"],
  ["text", "", 1440, ""],
  ["text", "none", 375, ""],
  ["text", "settings", 1440, "-settings"],
];

const browser = await chromium.launch();
const measure = {};
for (const v of ["a", "b", "c"]) {
  for (const [p, state, w, suffix] of SHOTS) {
    const context = await browser.newContext({ viewport: SIZES[w], deviceScaleFactor: w === 375 ? 2 : 1 });
    const pg = await context.newPage();
    await pg.goto(new URL(file(v, p), import.meta.url).href + (state ? "#" + state : ""));
    await pg.waitForTimeout(150);
    await pg.screenshot({ path: fileURLToPath(new URL(`${v}-${p}${suffix}-${w}.jpg`, dir)), type: "jpeg", quality: 82 });
    if (state === "none" || (!state && w === 1440)) {
      // Measure with no panel open.
      await pg.evaluate(() => window.mock.setPanel("none"));
      measure[`${v}-${p}-${w}`] = await pg.evaluate(() => {
        const canvas = document.querySelector(".canvas").getBoundingClientRect();
        const out = { vh: innerHeight, canvas: Math.round(canvas.height) };
        const wrap = document.querySelector(".grid-wrap");
        if (wrap) {
          const bottom = wrap.getBoundingClientRect().bottom;
          out.rows = [...wrap.querySelectorAll("tr")].filter((r) => r.getBoundingClientRect().bottom <= bottom + 0.5).length;
        }
        const stage = document.querySelector(".slide");
        if (stage) out.stage = Math.round(stage.getBoundingClientRect().width);
        const overflow = document.documentElement.scrollWidth > innerWidth;
        if (overflow) out.pageOverflow = true;
        return out;
      });
    }
    await context.close();
  }
}
await browser.close();
writeFileSync(new URL("measurements.json", dir), JSON.stringify(measure, null, 2) + "\n");
buildAll();
console.log(measure);
