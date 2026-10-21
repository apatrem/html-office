import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
const here = dirname(fileURLToPath(import.meta.url)),
  repo = resolve(here, "../../.."),
  out = resolve(repo, "dist/toolbar-functional");
const server = createServer(async (req, res) => {
  if (!["/toolbar.js", "/toolbar.css"].includes(req.url)) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, {
    "Content-Type": req.url.endsWith(".js") ? "text/javascript" : "text/css",
    "Content-Encoding": "gzip",
    "Access-Control-Allow-Origin": "*",
    "Timing-Allow-Origin": "*",
    "Cache-Control": "public,max-age=31536000,immutable",
  });
  res.end(
    gzipSync(await readFile(resolve(here, "../vendor", "." + req.url)), {
      level: 9,
    }),
  );
});
await new Promise((r) => server.listen(8765, "127.0.0.1", r));
const browser = await chromium.launch();
const results = [];
const ready =
  "Editing toolbar ready. Grey controls are unsupported in the current workbook model.";
const file = (name) => pathToFileURL(resolve(out, name)).href;
async function setup(
  name,
  { offline = false, route, viewport = { width: 1440, height: 1000 } } = {},
) {
  const context = await browser.newContext({
    acceptDownloads: true,
    offline,
    viewport,
  });
  const page = await context.newPage(),
    errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) requests.push(r.url());
  });
  if (route) await route(context);
  await page.goto(file(name));
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  return { context, page, errors, requests };
}
async function activate(page) {
  await page.locator("#activate-toolbar").click();
  await page.getByText(ready, { exact: true }).waitFor();
}
async function savedBook(page, path) {
  const download = page.waitForEvent("download");
  await page.locator("#save").click();
  await (await download).saveAs(path);
  const html = await readFile(path, "utf8");
  return JSON.parse(
    /<script id="workbook"[^>]*>([\s\S]*?)<\/script>/.exec(html)[1],
  );
}
try {
  // Functional behavior on every distribution; actual network only for the local CDN simulation.
  for (const mode of ["cdn", "native", "embedded"])
    for (const offline of [false, true]) {
      const name = `toolbar-${mode}${offline ? "-offline" : ""}.html`;
      const { context, page, errors, requests } = await setup(name, {
        offline,
        route: async (context) => {
          // Pinned engine fixture routing isolates toolbar tests from remote engine availability.
          await context.route(
            "https://raw.githubusercontent.com/**",
            async (route) =>
              route.fulfill({
                body: await readFile(
                  resolve(
                    repo,
                    "packages/data/engine/vendor",
                    route.request().url().endsWith(".wasm.gz")
                      ? "ironcalc.wasm.gz"
                      : "ironcalc.mjs",
                  ),
                ),
              }),
          );
        },
      });
      assert.deepEqual(requests, [], "viewing must be request-free");
      const originalText = await page
        .locator('#grid [data-cell="B2"]')
        .textContent();
      await activate(page);
      assert.equal(requests.length, mode === "cdn" && !offline ? 2 : 0);
      const toolbar = page.locator("#assessment-mount");
      const gridCell = page.locator('#grid [data-cell="B2"]');
      const gridBorder = await gridCell.evaluate(
        (el) => getComputedStyle(el).borderTopColor,
      );
      const lines = toolbar.getByRole("button", {
        name: "Show/hide grid lines",
        exact: true,
      });
      await lines.click();
      assert.equal(
        await gridCell.evaluate((el) => getComputedStyle(el).borderTopColor),
        "rgba(0, 0, 0, 0)",
      );
      await lines.click();
      assert.equal(
        await gridCell.evaluate((el) => getComputedStyle(el).borderTopColor),
        gridBorder,
      );
      const pct = toolbar.getByRole("button", {
        name: mode === "native" ? "Percentage" : "Format as percentage",
        exact: true,
      });
      await pct.click();
      await page
        .getByText("Formatting changed. Unsaved changes.", { exact: true })
        .waitFor();
      assert.ok(
        (await page.locator('#grid [data-cell="B2"]').textContent()).includes(
          "%",
        ),
      );
      await toolbar.getByRole("button", { name: "Undo", exact: true }).click();
      assert.equal(
        await page.locator('#grid [data-cell="B2"]').textContent(),
        originalText,
      );
      await toolbar.getByRole("button", { name: "Redo", exact: true }).click();
      assert.ok(
        (await page.locator('#grid [data-cell="B2"]').textContent()).includes(
          "%",
        ),
      );
      // A menu action must really apply, without exposing unsupported custom formats.
      if (mode !== "native") {
        await toolbar
          .getByRole("button", { name: "Format number", exact: true })
          .focus();
        await page.keyboard.press("Enter");
        await page
          .getByRole("menu")
          .getByText("Number", { exact: true })
          .waitFor();
        await page.keyboard.press("Escape");
        assert.equal(
          await toolbar
            .getByRole("button", { name: "Format number", exact: true })
            .evaluate((el) => el === document.activeElement),
          true,
        );
        await toolbar
          .getByRole("button", { name: "Format number", exact: true })
          .click();
        const menu = page.getByRole("menu");
        await menu.getByText("Number", { exact: true }).click();
        assert.ok(
          !(
            await page.locator('#grid [data-cell="B2"]').textContent()
          ).includes("%"),
        );
        assert.equal(
          await toolbar
            .getByRole("button", { name: "Bold", exact: true })
            .isDisabled(),
          true,
        );
      } else
        await toolbar
          .getByLabel("Toolbar number format")
          .selectOption("#,##0.00");
      await toolbar
        .getByRole("button", { name: "Conditional formatting", exact: true })
        .click();
      await page.locator("#conditional-dialog").waitFor({ state: "visible" });
      await page.locator("#conditional-close").click();
      await page
        .getByLabel("Scenario", { exact: true })
        .selectOption({ label: "Upside" });
      await page
        .getByText("Calculated locally. Unsaved changes.", { exact: true })
        .waitFor();
      const save = resolve(out, `saved-${mode}-${offline}.html`),
        book = await savedBook(page, save);
      assert.equal(
        book.sheets.find((s) => s.id === "inputs").cells.B10.input.value,
        "Upside",
      );
      assert.equal(
        book.sheets.find((s) => s.id === "summary").cells.B2.format.kind,
        "number",
      );
      assert.ok(
        !/blob:[^"<]+/.test(await readFile(save, "utf8")),
        "saved shell must not depend on live blob URLs",
      );
      await page.goto(pathToFileURL(save).href);
      await page
        .getByText("Saved results are current.", { exact: true })
        .waitFor();
      await activate(page);
      assert.equal(
        await toolbar
          .getByRole("button", { name: "Undo", exact: true })
          .isDisabled(),
        true,
      );
      assert.deepEqual(errors, []);
      if (offline) assert.deepEqual(requests, []);
      results.push({
        name,
        strategy: mode,
        delivery: mode === "cdn" && offline ? "embedded" : mode,
        checks: "edit-format/menu/undo/redo/conditional/scenario/save/reopen",
        passed: true,
        requests,
      });
      await context.close();
    }
  // Integrity failure must prevent even a syntactically valid injected payload from running.
  for (const fault of ["blocked", "corrupt", "offline", "no-decompression"]) {
    const { context, page, errors } = await setup(
      fault === "no-decompression"
        ? "toolbar-embedded-offline.html"
        : "toolbar-cdn.html",
      {
        offline: fault === "offline",
        route: async (context) => {
          if (fault === "no-decompression")
            await context.addInitScript(() => {
              globalThis.DecompressionStream = undefined;
            });
          else if (fault === "blocked")
            await context.route("http://127.0.0.1:8765/**", (r) => r.abort());
          else if (fault === "corrupt")
            await context.route("http://127.0.0.1:8765/toolbar.js", (r) =>
              r.fulfill({
                body: "globalThis.UNVERIFIED_TOOLBAR_RAN=true;",
                headers: { "Access-Control-Allow-Origin": "*" },
              }),
            );
        },
      },
    );
    await page.locator("#activate-toolbar").click();
    await page
      .getByRole("button", { name: "Retry editing toolbar", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(() => globalThis.UNVERIFIED_TOOLBAR_RAN),
      undefined,
    );
    assert.equal(
      await page.locator('#grid [data-cell="B2"]').isVisible(),
      true,
    );
    await page.locator(".assessment-advanced>summary").click();
    await page.locator("#decimals").click();
    await page
      .getByText("Formatting changed. Unsaved changes.", { exact: true })
      .waitFor();
    const save = resolve(out, "failure-" + fault + ".html"),
      book = await savedBook(page, save);
    assert.equal(
      book.sheets.find((s) => s.id === "summary").cells.B2.format.digits,
      1,
    );
    if (fault !== "no-decompression") {
      await context.unrouteAll();
      await context.setOffline(false);
      await activate(page);
    }
    assert.deepEqual(errors, []);
    results.push({ fault, passed: true });
    await context.close();
  }
  // A failed calculation's attempted input must survive a later failed UI load/save.
  {
    const { context, page, errors } = await setup("toolbar-cdn.html", {
      route: async (context) => {
        await context.route(/^https?:\/\//, (r) => r.abort());
      },
    });
    await page.locator("#cell-type").selectOption("number");
    await page.locator("#cell-value").fill("777");
    await page.locator("#apply").click();
    await page
      .getByRole("button", { name: "Apply edit", exact: true })
      .waitFor({ state: "visible" });
    await page.waitForFunction(
      () =>
        !document.getElementById("apply").disabled &&
        document
          .getElementById("status")
          .textContent.includes("attempted edit"),
    );
    await page.locator("#activate-toolbar").click();
    await page
      .getByRole("button", { name: "Retry editing toolbar", exact: true })
      .waitFor();
    const book = await savedBook(
      page,
      resolve(out, "pending-after-toolbar-failure.html"),
    );
    assert.equal(
      book.sheets.find((s) => s.id === "summary").cells.B2.input.value,
      777,
    );
    assert.equal(book.snapshot, undefined);
    assert.deepEqual(errors, []);
    results.push({ pendingCalculationThenToolbarFailure: true, passed: true });
    await context.close();
  }
  // Same-browser first and cached edit latency, five repeats. Not a WAN/CDN measurement.
  const timings = [];
  for (const mode of ["cdn", "embedded", "native"])
    for (let run = 0; run < 5; run++) {
      const { context, page } = await setup(`toolbar-${mode}.html`);
      for (const cache of ["cold", "cached"]) {
        if (cache === "cached") {
          await page.reload();
          await page
            .getByText("Saved results are current.", { exact: true })
            .waitFor();
        }
        await activate(page);
        const metrics = await page.evaluate(() => ({
          ...globalThis.toolbarAssessmentMetrics,
          resources: performance
            .getEntriesByType("resource")
            .filter((e) => e.name.includes("8765"))
            .map((e) => ({
              name: e.name,
              transferSize: e.transferSize,
              encodedBodySize: e.encodedBodySize,
              decodedBodySize: e.decodedBodySize,
              duration: e.duration,
            })),
        }));
        timings.push({ mode, run, cache, ...metrics });
      }
      await context.close();
    }
  for (const mode of ["native", "embedded"]) {
    const { context, page, errors } = await setup(
      `toolbar-${mode}-offline.html`,
      { offline: true },
    );
    await activate(page);
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      if (mode === "embedded" && width === 320) {
        const right = page.getByRole("button", {
          name: "Scroll toolbar right",
          exact: true,
        });
        await right.waitFor();
        await right.focus();
        await page.keyboard.press("Enter");
        await page.waitForFunction(
          () => document.querySelector(".ic-toolbar-container").scrollLeft > 0,
        );
        await page
          .getByRole("button", { name: "Scroll toolbar left", exact: true })
          .waitFor();
        await page
          .locator(".ic-toolbar-container")
          .evaluate((el) => el.scrollTo({ left: 0, behavior: "instant" }));
      }
      await page
        .locator("#assessment-mount")
        .screenshot({ path: resolve(out, `${mode}-${width}-toolbar.png`) });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        "page must not overflow at " + width,
      );
      await page.screenshot({ path: resolve(out, `${mode}-${width}.png`) });
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  const report = {
    browser: browser.version(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    conditions:
      "Loopback HTTP server on 127.0.0.1:8765, gzip + immutable cache; no WAN throttle; five fresh contexts per mode with a same-context cached reload. Functional engine requests use pinned local fixtures; screenshots/offline prototypes use no network.",
    results,
    timings,
  };
  await writeFile(
    resolve(out, "browser-results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      functionalChecks: results.length,
      timingRuns: timings.length,
      passed: true,
    }),
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
