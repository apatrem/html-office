// Independent recipient workflow after the HTML-only assistants have finished.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { readHTML } from "./html.mjs";
import { EngineSession } from "../../engine/adapter.mjs";
if (!process.argv[2])
  throw new Error("Usage: blind-browser.mjs packet-directory");
const directory = resolve(process.argv[2]);
const browser = await chromium.launch();
const receipts = [];
try {
  for (let packet = 1; packet <= 6; packet++) {
    const dir = join(directory, `packet-${packet}`);
    const page = await browser.newPage({ acceptDownloads: true });
    page.setDefaultTimeout(120000);
    const errors = [];
    let requests = 0;
    page.on("pageerror", (e) => errors.push(e.message));
    await page
      .context()
      .route("https://raw.githubusercontent.com/**", async (route) => {
        requests++;
        assert.equal(
          packet,
          6,
          "Viewing edited files must not request dependencies",
        );
        const wasm = route.request().url().endsWith(".wasm.gz");
        await route.fulfill({
          body: await readFile(
            new URL(
              `../../engine/vendor/ironcalc.${wasm ? "wasm.gz" : "mjs"}`,
              import.meta.url,
            ),
          ),
          headers: {
            "access-control-allow-origin": "*",
            "content-type": wasm ? "application/wasm" : "text/javascript",
          },
        });
      });
    await page.goto(pathToFileURL(join(dir, "edited.html")).href);
    await page
      .getByText(
        "Saved results are stale or missing. Apply an edit to recalculate.",
        { exact: true },
      )
      .waitFor();
    assert.equal(requests, 0);
    if (packet === 6) {
      await page.getByRole("button", { name: "Inputs", exact: true }).click();
      await page.getByLabel("Cell value").fill("0.03");
      await page.getByRole("button", { name: "Apply edit" }).click();
      await page
        .getByText("Calculated locally. Unsaved changes.", { exact: true })
        .waitFor();
      assert.equal(requests, 2);
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Save a copy" }).click();
      const saved = join(dir, "recalculated.html");
      await (await downloadPromise).saveAs(saved);
      const actual = readHTML(await readFile(saved, "utf8"));
      assert.equal(actual.encoding, "hybrid");
      const expected = readHTML(
        await readFile(join(dir, "edited.html"), "utf8"),
      ).book;
      const module = await import("../../engine/vendor/ironcalc.mjs");
      await module.default({
        module_or_path: await readFile(
          new URL("../../engine/vendor/ironcalc.wasm", import.meta.url),
        ),
      });
      const session = new EngineSession(module);
      let calculated;
      try {
        session.load(expected);
        calculated = await session.calculate();
      } finally {
        session.dispose();
      }
      assert.equal(
        actual.book.snapshot.fingerprint,
        calculated.snapshot.fingerprint,
      );
      delete actual.book.snapshot;
      delete calculated.snapshot;
      assert.deepEqual(actual.book, calculated);
      const revenue = actual.book.sheets.find((s) => s.id === "summary").cells
        .B2.result.value;
      assert.notEqual(revenue, 91261.28465042303);
      await page.context().setOffline(true);
      await page.goto(pathToFileURL(saved).href);
      await page
        .getByText("Saved results are current.", { exact: true })
        .waitFor();
      receipts.push({
        packet,
        staleOnOpen: true,
        viewRequests: 0,
        engineRequests: requests,
        recalculatedAgainstPinnedEngine: true,
        fullCanonicalComparison: "exact apart from calculation timestamp",
        savedAndReopenedOffline: true,
        revenue,
      });
    } else receipts.push({ packet, staleOnOpen: true, viewRequests: requests });
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser.close();
}
await writeFile(
  join(directory, "browser-results.json"),
  JSON.stringify(receipts, null, 2) + "\n",
);
console.log(JSON.stringify(receipts, null, 2));
