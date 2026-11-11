// Save in place for Data (shared FileBinding): the opened file is remembered and reused, the
// picker behaves as Save As, a new name is used from then on; Cmd/Ctrl+S downloads a copy where the
// browser cannot save in place.
//   SAVE_ENGINES=chromium,firefox,webkit node tests/save-in-place-browser.mjs   (default: chromium)
// Firefox and WebKit run only the copy scenario; Chromium runs both.
import { readFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as playwright from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import {
  saveInPlaceScenarios,
  copyOnlyScenario,
} from "../../../tests/save-in-place.mjs";

const ENGINES = (process.env.SAVE_ENGINES || "chromium").split(",");
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const dir = await mkdtemp(join(out, "save-in-place-"));
const fixture = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
const source = await buildWorkbook(fixture, { offline: true });
const mod = process.platform === "darwin" ? "Meta" : "Control";
// Distinct cell values: each edit leaves its own number in the saved workbook.
const value = (n) => 918270 + n;

const product = {
  label: "Data",
  prefix: "data",
  purpose: "html-data-save",
  dir,
  source,
  other: source.replace(
    /<title>([^<]*)<\/title>/,
    "<title>$1 (theirs)</title>",
  ),
  statusSelector: "#save-status",
  async open(page) {
    await page
      .getByText("Saved results are current.", { exact: true })
      .waitFor();
    await page.waitForFunction(
      () => !document.getElementById("direct-save").disabled,
    );
  },
  async edit(page, n) {
    await page.evaluate(
      () => (document.getElementById("status").textContent = ""),
    );
    await page.getByLabel("Cell value").fill(String(value(n)));
    await page.getByRole("button", { name: "Apply edit", exact: true }).click();
    // WebKit cannot calculate from file://: the edit stays an attempted input, still saved.
    await page
      .locator("#status")
      .filter({ hasText: /Calculated locally|retry Apply edit/ })
      .waitFor();
  },
  marker: (n) => `"value": ${value(n)}`,
  save: (page) => page.keyboard.press(`${mod}+s`),
};

try {
  for (const engine of ENGINES) {
    const browser = await playwright[engine].launch();
    try {
      if (engine === "chromium") await saveInPlaceScenarios(browser, product);
      await copyOnlyScenario(browser, {
        ...product,
        label: `Data, ${engine}`,
      });
    } finally {
      await browser.close();
    }
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
