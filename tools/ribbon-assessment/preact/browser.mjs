// R05 browser checks: the same functional flow on the Preact and React builds,
// standard and offline, plus layout and mount timings.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
const here = dirname(fileURLToPath(import.meta.url)),
  repo = resolve(here, "../../.."),
  out = resolve(repo, "dist/toolbar-preact");
const browser = await chromium.launch();
const browserVersion = "Chromium " + browser.version();
const ready = "Editing toolbar ready.";
const results = { functional: [], layout: [], timings: [] };
// An untranslated i18n key such as "toolbar.format_menu.custom".
const rawKey = /\b[a-z]+(?:_[a-z]+)*\.[a-z_]+(?:\.[a-z_]+)*\b/;

async function setup(name, { offline = false, viewport } = {}) {
  const context = await browser.newContext({
    acceptDownloads: true,
    offline,
    viewport: viewport ?? { width: 1440, height: 1000 },
  });
  // Pinned engine fixture: isolates the toolbar from remote engine availability.
  await context.route("https://raw.githubusercontent.com/**", async (route) =>
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
  const page = await context.newPage(),
    errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) requests.push(r.url());
  });
  await page.goto(pathToFileURL(resolve(out, name)).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  await page.getByText(ready, { exact: true }).waitFor();
  return { context, page, errors, requests };
}
const intents = (page) => page.evaluate(() => globalThis.toolbarSpikeIntents);
async function lastIntent(page, kind) {
  return (await intents(page)).findLast((i) => i.kind === kind);
}
async function noRawKeys(page, selector) {
  const text = await page.locator(selector).innerText();
  assert.doesNotMatch(text, rawKey, `untranslated key in ${selector}`);
}
async function savedBook(page, path) {
  const download = page.waitForEvent("download");
  await page.locator("#save").click();
  await (await download).saveAs(path);
  const html = await readFile(path, "utf8");
  return {
    html,
    book: JSON.parse(
      /<script id="workbook"[^>]*>([\s\S]*?)<\/script>/.exec(html)[1],
    ),
  };
}

try {
  for (const variant of ["preact", "react-upstream"])
    for (const offline of [false, true]) {
      const name = `toolbar-${variant}${offline ? "-offline" : ""}.html`;
      const { context, page, errors, requests } = await setup(name, {
        offline,
      });
      assert.deepEqual(requests, [], "viewing must be request-free");
      const toolbar = page.locator("#spike-toolbar");
      const button = (label) =>
        toolbar.getByRole("button", { name: label, exact: true });
      await noRawKeys(page, "#spike-toolbar");

      // ADR-010 exclusions: no merge control, no custom number format.
      assert.equal(
        await toolbar.getByRole("button", { name: /merge/i }).count(),
        0,
      );
      await button("Format number").focus();
      await page.keyboard.press("Enter");
      const menu = page.getByRole("menu");
      await menu.getByText("Number", { exact: true }).waitFor();
      assert.equal(await menu.getByText("Custom", { exact: false }).count(), 0);
      await menu.getByText("Long date", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      assert.equal(
        await button("Format number").evaluate(
          (el) => el === document.activeElement,
        ),
        true,
        "Escape returns focus to the menu trigger",
      );

      // Supported commands still use the canonical handlers and history.
      const original = await page
        .locator('#grid [data-cell="B2"]')
        .textContent();
      await button("Format as percentage").click();
      await page
        .getByText("Formatting changed. Unsaved changes.", { exact: true })
        .waitFor();
      assert.match(
        await page.locator('#grid [data-cell="B2"]').textContent(),
        /%/,
      );
      await button("Undo").click();
      assert.equal(
        await page.locator('#grid [data-cell="B2"]').textContent(),
        original,
      );
      await button("Redo").click();
      assert.match(
        await page.locator('#grid [data-cell="B2"]').textContent(),
        /%/,
      );
      await button("Format number").click();
      await menu.getByText("Long date", { exact: true }).click();
      assert.ok(await lastIntent(page, "format.longDate"));

      // ADR-010 formatting controls are live and reach the host.
      await button("Bold").click();
      assert.deepEqual((await lastIntent(page, "style.bold")).payload, {
        bold: true,
      });
      assert.equal(await button("Bold").getAttribute("aria-pressed"), "true");
      await button("Center across selection").click();
      assert.equal(
        (await lastIntent(page, "style.align.horizontal")).payload.horizontal,
        "centerContinuous",
      );
      await button("Increase font size").click();
      assert.equal(
        (await lastIntent(page, "style.fontSize")).payload.fontSize,
        13,
      );
      await button("Font color").click();
      await page.locator(".ic-color-picker__swatch--selectable").nth(4).click();
      assert.ok((await lastIntent(page, "style.color")).payload.color);
      await button("Borders").click();
      await page.locator(".ic-border-picker__borders button").first().click();
      assert.ok((await lastIntent(page, "style.border")).payload.border);
      await page.keyboard.press("Escape");

      // Themes: charte first, IronCalc built-ins after.
      await button("Themes").click();
      await menu.getByText("Document charte", { exact: true }).waitFor();
      await menu.getByText("Office", { exact: true }).click();
      assert.equal(
        (await lastIntent(page, "theme.pick")).payload.name,
        "Office",
      );
      await button("Themes").click();
      await menu.getByText("Manage themes", { exact: true }).click();
      await page.locator(".ic-drawer-container").waitFor();
      await noRawKeys(page, ".ic-drawer-container");
      await page
        .locator(".ic-drawer-container")
        .getByRole("button", { name: "Close", exact: true })
        .click();

      // Cell styles: apply a built-in, create a custom style.
      await button("Cell styles").click();
      const drawer = page.locator(".ic-drawer-container");
      await noRawKeys(page, ".ic-drawer-container");
      await drawer.getByRole("button", { name: "Good", exact: true }).click();
      assert.equal(
        (await lastIntent(page, "cellStyle.apply")).payload.name,
        "Good",
      );
      await drawer.getByRole("button", { name: "Add new" }).click();
      await drawer.getByLabel("Style name").fill("Margin highlight");
      await drawer.getByRole("button", { name: "Bold", exact: true }).click();
      await drawer.getByRole("button", { name: "Apply", exact: true }).click();
      assert.equal(
        (await lastIntent(page, "cellStyle.add")).payload.name,
        "Margin highlight",
      );
      await drawer.getByRole("button", { name: "Close", exact: true }).click();

      // Regional settings (locale + time zone).
      await page
        .getByRole("button", { name: "Regional settings", exact: true })
        .click();
      await noRawKeys(page, ".ic-drawer-container");
      await drawer.getByText("Timezone", { exact: true }).first().waitFor();
      await drawer.getByRole("button", { name: "Save", exact: true }).click();
      assert.ok(await lastIntent(page, "regional.save"));

      // Links: only https/http/mailto are accepted.
      await button("Insert link").click();
      const dialog = page.locator(".ic-link-dialog");
      await noRawKeys(page, ".ic-link-dialog");
      await dialog
        .getByPlaceholder("URL", { exact: true })
        .fill("file:///etc/hosts");
      assert.equal(
        await dialog
          .getByRole("button", { name: "Save", exact: true })
          .isDisabled(),
        true,
        "file: links are rejected",
      );
      await dialog
        .getByPlaceholder("URL", { exact: true })
        .fill("https://example.org/report");
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      assert.equal(
        (await lastIntent(page, "link.set")).payload.link.target,
        "https://example.org/report",
      );

      // Our conditional-format dialog and the presentation-only grid toggle.
      await button("Conditional formatting").click();
      await page.locator("#conditional-dialog").waitFor({ state: "visible" });
      await page.locator("#conditional-close").click();
      const border = () =>
        page.evaluate(
          () =>
            getComputedStyle(document.querySelector('#grid [data-cell="B2"]'))
              .borderTopColor,
        );
      const gridBorder = await border();
      await button("Show/hide grid lines").click();
      assert.equal(await border(), "rgba(0, 0, 0, 0)");
      await button("Show/hide grid lines").click();
      assert.equal(await border(), gridBorder);

      // Scenario recalculation, save and reopen with a fresh toolbar.
      await page
        .getByLabel("Scenario", { exact: true })
        .selectOption({ label: "Upside" });
      await page
        .getByText("Calculated locally. Unsaved changes.", { exact: true })
        .waitFor();
      const save = resolve(out, `saved-${variant}-${offline}.html`),
        { html, book } = await savedBook(page, save);
      assert.equal(
        book.sheets.find((s) => s.id === "inputs").cells.B10.input.value,
        "Upside",
      );
      assert.equal(
        book.sheets.find((s) => s.id === "summary").cells.B2.format.kind,
        "percent",
      );
      assert.match(html, /<div class="ic-root" id="spike-toolbar"><\/div>/);
      assert.match(html, /<div class="ic-root" id="spike-drawer"><\/div>/);
      await page.goto(pathToFileURL(save).href);
      await page.getByText(ready, { exact: true }).waitFor();
      assert.equal(await button("Undo").isDisabled(), true);
      assert.deepEqual(errors, []);
      if (offline) assert.deepEqual(requests, []);
      results.functional.push({
        name,
        variant,
        offline,
        checks:
          "exclusions/menu keyboard/format+history/long date/emphasis/centre across/font size/colour/borders/themes/cell styles add+apply/regional/link schemes/conditional/grid lines/scenario/save/reopen",
        requests,
        passed: true,
      });
      await context.close();
    }

  // Narrow/desktop layout, keyboard overflow and screenshots.
  for (const variant of ["preact", "react-upstream"]) {
    const { context, page, errors } = await setup(
      `toolbar-${variant}-offline.html`,
      { offline: true },
    );
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );
      if (width === 320) {
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
          .locator(".ic-toolbar-container")
          .evaluate((el) => el.scrollTo({ left: 0, behavior: "instant" }));
      }
      await page
        .locator("#spike-toolbar")
        .screenshot({ path: resolve(out, `${variant}-${width}-toolbar.png`) });
      results.layout.push({ variant, width, pageOverflow: overflow });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page
      .getByRole("button", { name: "Cell styles", exact: true })
      .click();
    await page.screenshot({ path: resolve(out, `${variant}-cell-styles.png`) });
    assert.deepEqual(errors, []);
    await context.close();
  }

  // Mount and first-interaction timings, five fresh contexts each.
  for (const variant of ["preact", "react-upstream"])
    for (let run = 0; run < 5; run++) {
      const { context, page } = await setup(`toolbar-${variant}-offline.html`, {
        offline: true,
      });
      const mount = await page.evaluate(() => globalThis.toolbarSpikeMount);
      const menuMs = await page.evaluate(async () => {
        const t0 = performance.now();
        document.querySelector('[aria-label="Format number"]').click();
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        );
        return performance.now() - t0;
      });
      results.timings.push({ variant, run, ...mount, firstMenuMs: menuMs });
      await context.close();
    }
} finally {
  await browser.close();
}
await writeFile(
  resolve(here, "results/browser.json"),
  JSON.stringify(
    {
      browser: browserVersion,
      ...results,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    {
      functional: results.functional.map((r) => [r.name, r.passed]),
      layout: results.layout,
      timings: results.timings,
    },
    null,
    1,
  ),
);
