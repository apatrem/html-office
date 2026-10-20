import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { readHTML } from "../bench/storage/html.mjs";
import {
  CONFORMANCE_FAMILIES,
  conformanceFixture,
  conformanceDifferences,
} from "../fixtures/conformance.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const family of CONFORMANCE_FAMILIES)
    for (const offline of [false, true]) {
      const { book, fixture } = await conformanceFixture(family),
        context = await browser.newContext({ acceptDownloads: true }),
        page = await context.newPage(),
        errors = [],
        requests = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("dialog", (d) => d.accept());
      await context.route(/^https?:\/\//, async (route) => {
        const url = route.request().url();
        requests.push(url);
        if (
          !url.startsWith(
            "https://raw.githubusercontent.com/apatrem/html-office/",
          )
        )
          throw new Error(`Unexpected dependency ${url}`);
        await route.fulfill({
          body: await readFile(
            new URL(
              `../engine/vendor/${url.endsWith(".wasm.gz") ? "ironcalc.wasm.gz" : "ironcalc.mjs"}`,
              import.meta.url,
            ),
          ),
          headers: {
            "access-control-allow-origin": "*",
            "content-type": "application/octet-stream",
          },
        });
      });
      const file = resolve(
        out,
        `conformance-${family}-${offline ? "offline" : "standard"}.html`,
      );
      await writeFile(file, await buildWorkbook(book, { offline }));
      await page.goto(pathToFileURL(file).href);
      await page
        .getByText("Saved results are current.", { exact: true })
        .waitFor();
      assert.deepEqual(requests, []);
      if (offline) await context.setOffline(true);
      await page
        .getByRole("button", { name: "Recalculate", exact: true })
        .click();
      await page
        .getByText("Calculated locally. Unsaved changes.", { exact: true })
        .waitFor();
      assert.equal(requests.length, offline ? 0 : 2);
      await context.setOffline(true);
      const wait = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Save a copy", exact: true })
        .click();
      const saved = resolve(
        out,
        `conformance-${family}-${offline ? "offline" : "standard"}-saved.html`,
      );
      await (await wait).saveAs(saved);
      const result = readHTML(await readFile(saved, "utf8")).book;
      assert.deepEqual(conformanceDifferences(result, fixture), []);
      await page.goto(pathToFileURL(saved).href);
      await page
        .getByText("Saved results are current.", { exact: true })
        .waitFor();
      assert.deepEqual(errors, []);
      await context.close();
      console.log(
        `PASS conformance: ${family} ${offline ? "offline" : "standard"} ${fixture.cases.length} frozen results/errors, recalculation and offline saved reopen`,
      );
    }
} finally {
  await browser.close();
}
