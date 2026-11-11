// Save in place for Text (shared FileBinding): the opened file is remembered and reused, other
// files are refused, a new name is used from then on; Cmd/Ctrl+S downloads a copy where the
// browser cannot save in place.
//   TEXT_ENGINES=chromium,firefox,webkit node tests/save-in-place-browser.mjs   (default: chromium)
// Firefox and WebKit run only the copy scenario; Chromium runs both.
import { readFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as playwright from "playwright";
import { buildEngine, buildDocument } from "../tools/build.mjs";
import {
  saveInPlaceScenarios,
  copyOnlyScenario,
} from "../../../tests/save-in-place.mjs";

const ENGINES = (process.env.TEXT_ENGINES || "chromium").split(",");
const out = resolve(
  new URL("../../../dist/text-test/", import.meta.url).pathname,
);
await mkdir(out, { recursive: true });
const dir = await mkdtemp(join(out, "save-in-place-"));
const source = await buildDocument(
  await readFile(
    new URL("../fixtures/valid/example.html", import.meta.url),
    "utf8",
  ),
  await buildEngine(),
);
const mod = process.platform === "darwin" ? "Meta" : "Control";

const product = {
  label: "Text",
  prefix: "text",
  purpose: "html-text-save",
  dir,
  source,
  other: source.replace(
    "Prepared by the planning team, October 2026",
    "Prepared by the planning team, November 2026",
  ),
  refused: /Save failed: The selected file is not the document opened here/,
  statusSelector: ".tx-shell [role=status]",
  async open(page) {
    await page.waitForFunction(() => window.htmlText);
    await page.waitForFunction(
      () => window.htmlText.saving.recovery !== "opening",
    );
  },
  async edit(page, n) {
    await page.click("#doc p.lead", { position: { x: 2, y: 6 } });
    await page.keyboard.press("Home");
    await page.keyboard.type(`Edit ${n} `);
  },
  marker: (n) => `Edit ${n} `,
  save: (page) => page.keyboard.press(`${mod}+s`),
};

try {
  for (const engine of ENGINES) {
    const browser = await playwright[engine].launch();
    try {
      if (engine === "chromium") await saveInPlaceScenarios(browser, product);
      await copyOnlyScenario(browser, {
        ...product,
        label: `Text, ${engine}`,
      });
    } finally {
      await browser.close();
    }
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
