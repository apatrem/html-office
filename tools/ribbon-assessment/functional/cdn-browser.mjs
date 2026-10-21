import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
const here = dirname(fileURLToPath(import.meta.url)),
  out = resolve(here, "../../../dist/toolbar-functional");
const html = await readFile(resolve(out, "toolbar-cdn.html"), "utf8");
const config = JSON.parse(
  /<script type="application\/json" id="toolbar-config">([\s\S]*?)<\/script>/.exec(
    html,
  )[1],
);
assert.match(
  config.js.url,
  /^https:\/\/cdn\.jsdelivr\.net\/gh\/apatrem\/html-office@[a-f0-9]{40}\//,
);
const browser = await chromium.launch(),
  timings = [];
try {
  for (let run = 0; run < 5; run++) {
    const context = await browser.newContext({
        acceptDownloads: true,
        viewport: { width: 1440, height: 1000 },
      }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    let transfers = [],
      requests = [];
    const byId = new Map();
    cdp.on("Network.requestWillBeSent", (e) => {
      if (e.request.url.startsWith("https://")) requests.push(e.request.url);
    });
    cdp.on("Network.responseReceived", (e) => {
      if (![config.js.url, config.css.url].includes(e.response.url)) return;
      const r = {
        url: e.response.url,
        status: e.response.status,
        fromDiskCache: !!e.response.fromDiskCache,
        headers: Object.fromEntries(
          Object.entries(e.response.headers).filter(([k]) =>
            /^(content-encoding|content-length|cache-control|access-control-allow-origin|timing-allow-origin)$/i.test(
              k,
            ),
          ),
        ),
      };
      transfers.push(r);
      byId.set(e.requestId, r);
    });
    cdp.on("Network.loadingFinished", (e) => {
      if (byId.has(e.requestId))
        byId.get(e.requestId).encodedDataLength = e.encodedDataLength;
    });
    for (const cache of ["cold", "cached"]) {
      requests = [];
      transfers = [];
      byId.clear();
      await page.goto(pathToFileURL(resolve(out, "toolbar-cdn.html")).href);
      await page
        .getByText("Saved results are current.", { exact: true })
        .waitFor();
      assert.deepEqual(requests, []);
      await page.locator("#activate-toolbar").click();
      await page
        .getByText(
          "Editing toolbar ready. Grey controls are unsupported in the current workbook model.",
          { exact: true },
        )
        .waitFor({ timeout: 25000 });
      assert.equal(requests.length, 2);
      const metrics = await page.evaluate(() => ({
        ...globalThis.toolbarAssessmentMetrics,
        resources: performance
          .getEntriesByType("resource")
          .filter((e) => e.name.startsWith("https://cdn.jsdelivr.net/"))
          .map((e) => ({
            url: e.name,
            duration: e.duration,
            transferSize: e.transferSize,
            encodedBodySize: e.encodedBodySize,
            decodedBodySize: e.decodedBodySize,
          })),
      }));
      timings.push({ run, cache, ...metrics, transfers });
      if (run === 0 && cache === "cached") {
        await page
          .locator("#assessment-mount")
          .getByRole("button", { name: "Format as percentage", exact: true })
          .click();
        assert.ok(
          (await page.locator('#grid [data-cell="B2"]').textContent()).includes(
            "%",
          ),
        );
        const download = page.waitForEvent("download");
        await page.locator("#save").click();
        const saved = resolve(out, "real-cdn-saved.html");
        await (await download).saveAs(saved);
        await page.goto(pathToFileURL(saved).href);
        await page
          .getByText("Saved results are current.", { exact: true })
          .waitFor();
        await page.locator("#activate-toolbar").click();
        await page
          .getByText(
            "Editing toolbar ready. Grey controls are unsupported in the current workbook model.",
            { exact: true },
          )
          .waitFor();
        assert.ok(
          (await page.locator('#grid [data-cell="B2"]').textContent()).includes(
            "%",
          ),
        );
      }
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  const report = {
    testedAt: new Date().toISOString(),
    browser: browser.version(),
    platform: process.platform,
    arch: process.arch,
    conditions:
      "Actual Internet jsDelivr GitHub CDN, immutable experimental commit, file:// HTML, five fresh browser contexts with same-context cached reopen. No routing/mocking/throttling. Cold denotes browser cache; CDN edge cache state is uncontrolled. No workbook data is sent in requests.",
    assetUrls: { js: config.js.url, css: config.css.url },
    timings,
  };
  await writeFile(
    resolve(here, "results/real-cdn.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        passed: true,
        runs: timings.length,
        readyMs: timings.map((t) => ({ cache: t.cache, ms: t.readyMs })),
        transfers: timings[0].transfers,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
