// F02 rendering: layered formatting, charte colours, shared-edge borders,
// alignment, overflow, centre across selection, wrap, sizes, font and number
// presets, all without the calculation engine.
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { formattingWorkbook } from "../fixtures/formatting.mjs";
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const file = resolve(out, "rendering.html");
await writeFile(file, await buildWorkbook(formattingWorkbook()));
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    }),
    page = await context.newPage(),
    requests = [],
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.route(/^https?:\/\//, (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  await page.goto(pathToFileURL(file).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  const cell = (ref) => page.locator(`#grid [data-cell="${ref}"]`);
  const css = (ref, property) =>
    cell(ref).evaluate((el, p) => getComputedStyle(el)[p], property);
  const token = (name) =>
    page.evaluate((n) => {
      const probe = document.createElement("span");
      probe.style.color = `var(--${n})`;
      document.body.append(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    }, name);
  // Layers: cell style, column, row, then the cell's own style; a
  // conditional fill keeps a chosen text colour (A3) and drops the automatic
  // white of a replaced dark fill (A4).
  assert.equal(await css("A3", "fontWeight"), "700");
  assert.equal(await css("A3", "backgroundColor"), await token("ink"));
  assert.equal(await css("A3", "color"), await token("acc"));
  assert.equal(await css("A4", "backgroundColor"), await token("callout"));
  assert.equal(await css("A4", "color"), await token("ink"));
  // Data bars keep the grid's text span and its rules.
  assert.equal(await cell("B3").locator(".cell-text.data-bar-text").count(), 1);
  // The tint fill is the charte callout colour, as bg-tint in html-slides.
  assert.equal(await css("C7", "backgroundColor"), await token("callout"));
  assert.equal(await css("C2", "color"), await token("ink"));
  assert.equal(await css("A8", "fontStyle"), "italic");
  // Number presets.
  assert.equal(await cell("B3").textContent(), "€1.2M");
  assert.equal(await cell("C3").textContent(), "(4.2%)");
  assert.equal(await css("C3", "color"), await token("alert"));
  assert.equal(await cell("C4").textContent(), "January 1, 2024");
  assert.equal(await cell("B4").textContent(), "99k");
  // General alignment by value, explicit alignment and centre across.
  assert.equal(await cell("A3").getAttribute("data-align"), "left");
  assert.equal(await cell("B3").getAttribute("data-align"), "right");
  assert.equal(await cell("A10").getAttribute("data-align"), "center");
  assert.equal(await cell("B2").getAttribute("data-align"), "right");
  const span = (ref) =>
    cell(ref)
      .locator(".cell-text")
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width };
      });
  const box = (ref) =>
    cell(ref).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, height: r.height };
    });
  const b6 = await span("B6"),
    [B6, C6] = [await box("B6"), await box("C6")];
  assert.ok(Math.abs(b6.left - (B6.left + 6)) < 1.5);
  assert.ok(Math.abs(b6.right - (C6.right - 6)) < 1.5, "centred across B6:C6");
  // Overflow into empty neighbours: rightwards, and leftwards when right-aligned.
  const a8 = await span("A8");
  assert.ok(a8.right > (await box("B8")).right, "A8 overflows right");
  // Overflowing text does not take clicks meant for the cells under it.
  const b8 = await box("B8");
  await page.mouse.click(b8.left + 20, b8.top + 10);
  assert.equal(
    await page.getByLabel("Cell address", { exact: true }).inputValue(),
    "B8",
  );
  // Centre across works for numbers and does not depend on the viewport.
  const d13 = await span("D13"),
    F13 = await box("F13");
  assert.ok(Math.abs(d13.right - (F13.right - 6)) < 1.5, "D13 across D:F");
  const b9 = await span("B9");
  assert.ok(b9.left < (await box("B9")).left, "B9 overflows left");
  assert.equal(
    await cell("A3").evaluate((el) => el.classList.contains("overflow")),
    false,
  );
  // Sizes: column A 180 px, row 6 50 px; wrap stays inside its cell.
  assert.equal(
    Math.round((await box("A3")).right - (await box("A3")).left),
    180,
  );
  assert.equal(Math.round((await box("A6")).height), 50);
  assert.equal(
    await cell("A6").evaluate((el) => el.classList.contains("wrap")),
    true,
  );
  // Shared edges: the heavier line wins; each edge is drawn once.
  const edges = await page.locator(".grid-edge").evaluateAll((list) =>
    list.map((el) => ({
      top: el.getBoundingClientRect().top,
      left: el.getBoundingClientRect().left,
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
      style: el.style.borderTop || el.style.borderLeft,
    })),
  );
  const A5 = await box("A5"),
    B5 = await box("B5"),
    under = (b) =>
      edges.filter(
        (e) =>
          Math.abs(e.top + e.height / 2 - (b.top + b.height)) < 3 &&
          e.left < b.right &&
          e.left + e.width > b.left,
      );
  assert.match(under(B5)[0].style, /^3px double/, "total over thin: double");
  assert.equal(under(A5).length, 1);
  const B4 = await box("B4");
  assert.match(under(B4)[0].style, /^2px solid/, "medium bottom on B4");
  // The sheet's top and left edges draw too (A1 top and left borders).
  const A1 = await box("A1");
  assert.ok(
    edges.some(
      (e) =>
        Math.abs(e.top - A1.top) < 3 && e.left <= A1.left + 1 && e.width > 50,
    ),
    "A1 top edge",
  );
  assert.ok(
    edges.some((e) => Math.abs(e.left - A1.left) < 3 && e.height > 10),
    "A1 left edge",
  );
  // The workbook font applies to the whole grid.
  assert.match(
    await page
      .locator("#grid")
      .evaluate((el) => getComputedStyle(el).fontFamily),
    /^Georgia/,
  );
  // The last row and column render without reading past Excel's bounds.
  for (const ref of ["A1048576", "XFD1", "XFD1048576"]) {
    await page.getByLabel("Cell address", { exact: true }).fill(ref);
    await page.getByLabel("Cell address", { exact: true }).press("Enter");
    await cell(ref).waitFor();
  }
  // Variable sizes keep a bounded viewport far down a sheet.
  await page.getByLabel("Cell address", { exact: true }).fill("D900000");
  await page.getByLabel("Cell address", { exact: true }).press("Enter");
  await cell("D900000").waitFor();
  assert.ok((await page.locator("#grid [data-cell]").count()) < 800);
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: resolve(out, "rendering.png") });
  await context.close();
  console.log(
    "PASS rendering: layers, charte colours, number presets, alignment, overflow, centre across, wrap, sizes, shared-edge borders and workbook font without the engine",
  );
} finally {
  await browser.close();
}
