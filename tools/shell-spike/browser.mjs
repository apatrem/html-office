// R06 browser checks: R05's functional flow on the native shell, standard and
// offline, plus engine failures, keyboard and focus, layout and timings.
// Usage (repository root, after build.mjs): node tools/shell-spike/browser.mjs
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url)),
  repo = resolve(here, "../.."),
  out = resolve(repo, "dist/shell-spike");
const browser = await chromium.launch();
const ready = "Editing toolbar ready.";
const results = { browser: "Chromium " + browser.version(), functional: [], failures: [], layout: [], timings: [] };
const engine = async (route) =>
  route.fulfill({
    body: await readFile(resolve(repo, "packages/data/engine/vendor", route.request().url().endsWith(".wasm.gz") ? "ironcalc.wasm.gz" : "ironcalc.mjs")),
    headers: { "access-control-allow-origin": "*" },
  });

async function setup(name, { offline = false, viewport } = {}) {
  const context = await browser.newContext({ acceptDownloads: true, offline, viewport: viewport ?? { width: 1440, height: 1000 } });
  await context.route("https://raw.githubusercontent.com/**", engine);
  const page = await context.newPage(),
    errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  page.on("request", (r) => /^https?:/.test(r.url()) && requests.push(r.url()));
  await page.goto(pathToFileURL(resolve(out, name)).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  await page.getByText(ready, { exact: true }).waitFor();
  return { context, page, errors, requests };
}
const intents = (page) => page.evaluate(() => globalThis.toolbarSpikeIntents);
const lastIntent = async (page, kind) => (await intents(page)).findLast((i) => i.kind === kind);
const focused = (page) => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent.trim());
async function savedBook(page, path) {
  const download = page.waitForEvent("download");
  await page.locator("#shell-root").getByRole("menuitem", { name: "File" }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "Save a copy" }).click();
  await (await download).saveAs(path);
  const html = await readFile(path, "utf8");
  return { html, book: JSON.parse(/<script id="workbook"[^>]*>([\s\S]*?)<\/script>/.exec(html)[1]) };
}

try {
  for (const offline of [false, true]) {
    const name = `shell-native${offline ? "-offline" : ""}.html`;
    const { context, page, errors, requests } = await setup(name, { offline });
    assert.deepEqual(requests, [], "viewing must be request-free");
    const shell = page.locator("#shell-root");
    const button = (label) => shell.getByRole("button", { name: label, exact: true });
    const menu = page.getByRole("menu");

    // Exclusions (ADR-010/012): no merge, no custom format, no font size, underline or strike.
    for (const re of [/merge/i, /font size/i, /underline/i, /strike/i]) assert.equal(await shell.getByRole("button", { name: re }).count(), 0);

    // Menubar keyboard: focus File, ArrowDown opens, ArrowRight switches, Escape returns focus.
    await shell.getByRole("menuitem", { name: "File" }).focus();
    await page.keyboard.press("ArrowDown");
    await menu.getByRole("menuitem", { name: "Save a copy" }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.closest('[role="menu"]') !== null), true, "focus moves into the menu");
    await page.keyboard.press("ArrowRight");
    await menu.getByRole("menuitem", { name: "Paste table…" }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await menu.count(), 0);
    assert.equal(await focused(page), "Edit", "Escape returns focus to the menubar");
    await page.keyboard.press("ArrowRight");
    assert.equal(await focused(page), "Insert", "menubar arrow keys");

    // Number format menu button: keyboard open, no custom format, focus return.
    const numberFormat = shell.getByRole("button", { name: /^Number format:/ });
    await numberFormat.focus();
    await page.keyboard.press("Enter");
    await menu.getByRole("menuitem", { name: "Long date" }).waitFor();
    assert.equal(await menu.getByText("Custom").count(), 0);
    await page.keyboard.press("Escape");
    assert.equal(await numberFormat.evaluate((el) => el === document.activeElement), true, "Escape returns focus to the trigger");

    // Toolbar: one tab stop, arrow keys move.
    const stops = await shell.locator('[role="toolbar"] button[tabindex="0"]').count();
    assert.equal(stops, 1, "one tab stop in the toolbar");

    // Supported commands use the canonical handlers and history.
    const cell = page.locator('#grid [data-cell="B2"]');
    const original = await cell.textContent();
    await button("Format as percentage").click();
    await page.getByText("Formatting changed. Unsaved changes.", { exact: true }).waitFor();
    assert.match(await cell.textContent(), /%/);
    await button("Undo").click();
    assert.equal(await cell.textContent(), original);
    await button("Redo").click();
    assert.match(await cell.textContent(), /%/);
    await numberFormat.click();
    await menu.getByRole("menuitem", { name: "Long date" }).click();
    assert.equal(await numberFormat.getAttribute("aria-label"), "Number format: Long date");
    // The model field is written canonically; today's renderer does not distinguish long dates yet (F02).
    assert.equal(await page.evaluate(() => HTMLDataToolbarBridge.state().format.dateStyle), "long", "dateStyle written to the model");
    await button("Undo").click();
    await button("Increase decimal places").click();
    assert.match(await cell.textContent(), /\.\d\d%/);

    // Emphasis, alignment, colours and borders reach the host as ADR-012 intents.
    await button("Bold").click();
    assert.deepEqual((await lastIntent(page, "style.bold")).payload, { bold: true });
    assert.equal(await button("Bold").getAttribute("aria-pressed"), "true");
    await button("Center across selection").click();
    assert.equal((await lastIntent(page, "style.align.horizontal")).payload.horizontal, "centerContinuous");
    await button("Text colour").click();
    const colours = page.getByRole("radiogroup", { name: "Text colour" });
    assert.equal(await colours.getByRole("radio").count(), 6, "six text colour tokens");
    await colours.getByRole("radio", { name: "Accent" }).focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    assert.equal((await lastIntent(page, "style.color")).payload.color, "mid");
    assert.equal(await button("Text colour").evaluate((el) => el === document.activeElement), true);
    await button("Fill colour").click();
    assert.equal(await page.getByRole("radiogroup", { name: "Fill colour" }).getByRole("radio").count(), 7, "seven fill tokens");
    await page.getByRole("radio", { name: "Tint" }).click();
    assert.equal((await lastIntent(page, "style.fill")).payload.fill, "tint");
    await button("Borders").click();
    await page.getByRole("radiogroup", { name: "Line style" }).getByRole("radio", { name: "Double" }).click();
    await page.getByRole("radiogroup", { name: "Border colour" }).getByRole("radio", { name: "Accent" }).click();
    await page.getByRole("button", { name: "Bottom border" }).click();
    assert.deepEqual((await lastIntent(page, "style.border")).payload, { preset: "bottom", style: "double", color: "acc" });
    assert.equal(await page.getByRole("radio", { name: "Dotted" }).count(), 0);

    // Cell styles: menu and drawer; catalogue styles apply canonically.
    const stylePick = shell.getByRole("button", { name: /^Cell style:/ });
    await stylePick.click();
    await menu.getByRole("menuitemcheckbox", { name: "Total" }).click();
    assert.equal(await stylePick.getAttribute("aria-label"), "Cell style: Total");
    await button("Styles").click();
    const drawer = page.locator("#shell-drawer");
    assert.equal(await drawer.getByRole("heading", { name: "Cell styles" }).evaluate((el) => el === document.activeElement), true, "focus moves into the drawer");
    assert.equal(await drawer.getByRole("radio").count(), 11, "eleven catalogue styles");
    await drawer.getByRole("radio", { name: /^Assumption/ }).click();
    assert.equal(await stylePick.getAttribute("aria-label"), "Cell style: Assumption");
    await drawer.getByRole("radio", { name: /^Alert/ }).click();
    assert.equal((await lastIntent(page, "cellStyle.apply")).payload.name, "alert", "ADR-012 style without a model yet");
    await page.keyboard.press("Escape");
    assert.equal(await drawer.isHidden(), true);
    assert.equal(await button("Styles").evaluate((el) => el === document.activeElement), true, "focus returns to the panel toggle");

    // Document settings from the sheet bar, then regional settings.
    await page.getByRole("button", { name: "Document settings: theme, font, regional" }).click();
    await drawer.getByRole("radio", { name: "Green" }).click();
    assert.equal((await lastIntent(page, "theme.pick")).payload.theme, "green");
    await drawer.getByRole("radio", { name: /^Georgia/ }).click();
    assert.equal((await lastIntent(page, "font.pick")).payload.font, "georgia");
    await drawer.getByRole("button", { name: "Regional settings…" }).click();
    await drawer.getByLabel("Locale").selectOption("fr-FR");
    assert.match(await drawer.locator("table").innerText(), /1\s?234,50/);
    await drawer.getByRole("button", { name: "Save", exact: true }).click();
    assert.equal((await lastIntent(page, "regional.save")).payload.locale, "fr-FR");
    await drawer.getByRole("button", { name: "Close Regional settings" }).click();

    // Links: only https/http/mailto, or a workbook place.
    await button("Insert link").click();
    const dialog = page.getByRole("dialog", { name: "Link" });
    const save = dialog.getByRole("button", { name: "Save link" });
    for (const bad of ["file:///etc/hosts", "javascript:alert(1)", "example.org"]) {
      await dialog.getByRole("textbox", { name: "Address" }).fill(bad);
      assert.equal(await save.isDisabled(), true, `${bad} is rejected`);
    }
    assert.equal(await dialog.getByRole("textbox", { name: "Address" }).getAttribute("aria-invalid"), "true");
    await dialog.getByRole("textbox", { name: "Address" }).fill("https://example.org/report");
    await save.click();
    assert.equal((await lastIntent(page, "link.set")).payload.link.url, "https://example.org/report");
    assert.equal(await button("Insert link").evaluate((el) => el === document.activeElement), true, "dialog returns focus");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    await dialog.getByLabel("Place in this workbook").check();
    await dialog.getByLabel("Cell").fill("ZZZZ1");
    assert.equal(await save.isDisabled(), true);
    await dialog.getByLabel("Cell").fill("b4");
    await save.click();
    assert.deepEqual((await lastIntent(page, "link.set")).payload.link, { sheet: "Summary", ref: "B4" });

    // Review fixes: Cancel after invalid input, Cmd/Ctrl+K over an open menu, clear resets recorded formatting,
    // focus return after switching panels, and an open styles panel that follows the model.
    await button("Insert link").click();
    await dialog.getByRole("radio", { name: "Web or email address" }).check();
    await dialog.getByRole("textbox", { name: "Address" }).fill("example.org");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    assert.equal(await dialog.count(), 0, "Cancel closes despite invalid input");
    assert.equal(await button("Insert link").evaluate((el) => el === document.activeElement), true);
    await shell.getByRole("menuitem", { name: "Format" }).click();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    assert.equal(await menu.count(), 0, "Cmd/Ctrl+K closes the open menu");
    await dialog.waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await dialog.count(), 0, "Escape reaches the native dialog");
    // The dialog's close event, which restores focus, is asynchronous.
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Insert link");
    if ((await button("Bold").getAttribute("aria-pressed")) !== "true") await button("Bold").click();
    assert.equal(await button("Bold").getAttribute("aria-pressed"), "true");
    await button("Clear formatting").click();
    assert.equal(await button("Bold").getAttribute("aria-pressed"), "false", "clear resets recorded formatting");
    assert.equal(await page.evaluate(() => HTMLDataToolbarBridge.state().cellStyle), "normal");
    const settingsButton = page.getByRole("button", { name: "Document settings: theme, font, regional" });
    await settingsButton.click();
    await drawer.getByRole("button", { name: "Regional settings…" }).click();
    await page.keyboard.press("Escape");
    assert.equal(await settingsButton.evaluate((el) => el === document.activeElement), true, "focus returns to the original trigger");
    await button("Styles").click();
    await stylePick.click();
    await menu.getByRole("menuitemcheckbox", { name: "Total" }).click();
    assert.equal(await drawer.getByRole("radio", { name: /^Total/ }).getAttribute("aria-checked"), "true", "open panel follows the model");
    await button("Styles").click();
    assert.ok(await page.locator(".sh-notice").isVisible(), "intent-only controls are disclosed on screen");

    // Our conditional-format dialog and the presentation-only grid toggle.
    await button("Conditional formatting").click();
    await page.locator("#conditional-dialog").waitFor({ state: "visible" });
    await page.locator("#conditional-close").click();
    const border = () => page.evaluate(() => getComputedStyle(document.querySelector('#grid [data-cell="B2"]')).borderTopColor);
    const gridBorder = await border();
    await button("Show/hide grid lines").click();
    assert.equal(await border(), "rgba(0, 0, 0, 0)");
    await shell.getByRole("menuitem", { name: "View" }).click();
    await menu.getByRole("menuitemcheckbox", { name: "Grid lines" }).click();
    assert.equal(await border(), gridBorder);

    // Every former ribbon command is reachable from a menu.
    await shell.getByRole("menuitem", { name: "Data" }).click();
    await menu.getByRole("menuitem", { name: "Manage sheets…" }).click();
    await page.locator("#sheet-dialog").waitFor({ state: "visible" });
    await page.locator("#sheet-close").click();

    // Scenario recalculation, save and reopen with a fresh shell.
    await page.getByLabel("Scenario", { exact: true }).selectOption({ label: "Upside" });
    await page.getByText("Calculated locally. Unsaved changes.", { exact: true }).waitFor();
    const savePath = resolve(out, `saved-${offline}.html`),
      { html, book } = await savedBook(page, savePath);
    assert.equal(book.sheets.find((s) => s.id === "inputs").cells.B10.input.value, "Upside");
    // B2 was cleared, then given the Total style through the menu, all canonically.
    const b2 = book.sheets.find((s) => s.id === "summary").cells.B2;
    assert.equal(b2.cellStyle, "total");
    assert.equal(b2.format.kind, "general");
    assert.equal(b2.style, undefined);
    assert.match(html, /<div id="shell-root"[^>]*><\/div>/);
    assert.match(html, /<div id="shell-layer"><\/div>/);
    await page.goto(pathToFileURL(savePath).href);
    await page.getByText(ready, { exact: true }).waitFor();
    assert.equal(await button("Undo").isDisabled(), true);
    assert.deepEqual(errors, []);
    if (offline) assert.deepEqual(requests, []);
    results.functional.push({
      name,
      offline,
      checks: "exclusions/menubar keyboard/menu focus return/toolbar tab stop/format+history/date preset/decimals/emphasis/centre across/colour swatches keyboard/fill/borders/cell styles menu+drawer/focus into and out of drawer/document settings/regional preview+save/link schemes+place+Cmd+K/conditional/grid lines/manage sheets/scenario/save/reopen",
      requests,
      passed: true,
    });
    await context.close();
  }

  // Engine failures (standard mode): busy shell disabled, input retained,
  // engine-free formatting still applies, retry calculates. Same as R05.
  for (const mode of ["blocked", "bad-js", "cancel"]) {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
    let broken = true,
      release;
    const held = new Promise((r) => (release = r));
    await context.route("https://raw.githubusercontent.com/**", async (route) => {
      if (broken && mode === "blocked") return route.abort();
      if (broken && mode === "cancel") await held;
      const wasm = route.request().url().includes(".wasm");
      let body = await readFile(resolve(repo, "packages/data/engine/vendor", wasm ? "ironcalc.wasm.gz" : "ironcalc.mjs"));
      if (broken && mode === "bad-js" && !wasm) body = Buffer.concat([body, Buffer.from("\nglobalThis.unverifiedExecuted=true;")]);
      try {
        await route.fulfill({ body, headers: { "access-control-allow-origin": "*", "content-type": wasm ? "application/wasm" : "text/javascript" } });
      } catch {
        /* The cancelled download may already be closed. */
      }
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    await page.goto(pathToFileURL(resolve(out, "shell-native.html")).href);
    await page.getByText(ready, { exact: true }).waitFor();
    const button = (label) => page.locator("#shell-root").getByRole("button", { name: label, exact: true });
    await page.getByRole("button", { name: "Inputs", exact: true }).click();
    await page.getByLabel("Cell address").fill("E2");
    await page.keyboard.press("Tab");
    await page.getByLabel("Cell value", { exact: true }).fill("0.05");
    await page.getByRole("button", { name: "Apply edit", exact: true }).click();
    if (mode === "cancel") {
      await page.waitForFunction(() => document.querySelector('#shell-root [aria-label="Bold"]')?.disabled);
      assert.equal(await button("Format as percentage").isDisabled(), true, "busy shell is disabled");
      await page.getByRole("button", { name: "Cancel calculation" }).click();
      release();
      await page.getByText("Calculation cancelled. Your attempted edit is retained; retry Apply edit.", { exact: true }).waitFor();
    } else await page.locator("#status").filter({ hasText: mode === "blocked" ? "retry Apply edit" : "integrity check failed" }).waitFor();
    assert.equal(await page.evaluate(() => globalThis.unverifiedExecuted), undefined);
    await page.waitForFunction(() => !document.querySelector('#shell-root [aria-label="Format as percentage"]')?.disabled);
    await button("Increase decimal places").click();
    await page.getByText("Formatting changed. Unsaved changes.", { exact: true }).waitFor();
    const { book: draft } = await savedBook(page, resolve(out, `failure-${mode}.html`));
    const cell = draft.sheets.find((s) => s.id === "inputs").cells.E2;
    assert.equal(cell.input.value, 0.05, "attempted input is saved");
    assert.equal(cell.format.digits, 2, "formatting applied to the attempt");
    assert.equal(draft.snapshot, undefined, "uncalculated draft has no current snapshot");
    broken = false;
    await page.getByRole("button", { name: "Apply edit", exact: true }).click();
    await page.getByText("Calculated locally. Unsaved changes.", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    results.failures.push({ mode, passed: true });
    await context.close();
  }

  // Layout: no page overflow; toolbar reachable by keyboard at 320 px; drawer as bottom sheet.
  await mkdir(resolve(here, "results/screenshots"), { recursive: true });
  for (const width of [320, 768, 1024, 1440]) {
    const { context, page, errors } = await setup("shell-native.html", { viewport: { width, height: 900 } });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 0, `no page overflow at ${width}px`);
    const toolbar = page.locator('#shell-root [role="toolbar"]');
    await toolbar.locator('button[tabindex="0"]').focus();
    await page.keyboard.press("End");
    const last = await focused(page);
    assert.equal(last, "Styles", `End reaches the last toolbar item at ${width}px`);
    const inView = await page.evaluate(() => {
      const el = document.activeElement.getBoundingClientRect();
      return el.left >= 0 && el.right <= innerWidth;
    });
    assert.ok(inView, `focused toolbar item scrolls into view at ${width}px`);
    if (width === 320) {
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      await page.getByRole("menu").getByRole("menuitem", { name: "Save a copy" }).waitFor();
      await page.keyboard.press("Escape");
    }
    await page.screenshot({ path: resolve(here, `results/screenshots/shell-${width}.png`) });
    await page.locator("#shell-root").getByRole("button", { name: "Styles", exact: true }).focus();
    assert.equal(await page.locator("#shell-root").getByRole("button", { name: "Styles", exact: true }).count(), 1, `named at ${width}px`);
    await page.keyboard.press("Enter");
    const drawerBox = await page.locator("#shell-drawer").boundingBox();
    await page.screenshot({ path: resolve(here, `results/screenshots/shell-${width}-styles.png`) });
    results.layout.push({ width, overflow, drawer: { x: Math.round(drawerBox.x), width: Math.round(drawerBox.width), height: Math.round(drawerBox.height) } });
    assert.deepEqual(errors, []);
    await context.close();
  }

  // Component screenshots at 1440 px for the report.
  for (const [shot, open] of [
    ["menu", (page) => page.locator("#shell-root").getByRole("menuitem", { name: "Format" }).click()],
    ["borders", (page) => page.getByRole("button", { name: "Borders", exact: true }).click()],
    ["link", async (page) => {
      await page.getByRole("button", { name: "Insert link", exact: true }).click();
      await page.getByRole("textbox", { name: "Address", exact: true }).fill("file:///etc/hosts");
    }],
    ["settings", (page) => page.getByRole("button", { name: "Document settings: theme, font, regional" }).click()],
  ]) {
    const { context, page } = await setup("shell-native.html", { viewport: { width: 1440, height: 900 } });
    await open(page);
    await page.screenshot({ path: resolve(here, `results/screenshots/shell-${shot}.png`) });
    await context.close();
  }

  // Timings: mount and first menu open, 5 fresh contexts.
  for (let i = 0; i < 5; i++) {
    const { context, page } = await setup("shell-native.html");
    const mountMs = await page.evaluate(() => globalThis.toolbarSpikeMount.mountMs);
    const menuMs = await page.evaluate(async () => {
      const t = document.querySelector('#shell-root [role="menubar"] button');
      const t0 = performance.now();
      t.click();
      document.querySelector('[role="menu"]').getBoundingClientRect();
      await new Promise(requestAnimationFrame);
      return performance.now() - t0;
    });
    results.timings.push({ mountMs: +mountMs.toFixed(1), firstMenuMs: +menuMs.toFixed(1) });
    await context.close();
  }
} finally {
  await browser.close();
}
await writeFile(resolve(here, "results/browser.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results, null, 1));
