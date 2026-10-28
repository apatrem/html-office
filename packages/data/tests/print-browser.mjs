// T19 Print / PDF: File menu → dialog → a print-only view of the selected
// sheet built from the model (no editor chrome), with repeated header rows,
// negative data bars, borders, chart SVGs after the table and a scale that
// fits wide sheets to the page width. Chromium prints it to multi-page PDFs,
// standard and offline, without network requests.
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
import { readHTML, replaceHTML } from "../bench/storage/html.mjs";
import { VERSION } from "../model/workbook.mjs";
import { STALE_NOTICE } from "../runtime/picture.mjs";
import { openMenu } from "./shell.mjs";

const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });

// A fictional report: 120 rows under a header row, mixed signs for data
// bars, currency, percent and dates, a bordered total, a wrapped note and a
// chart; a second sheet 30 columns wide.
export function reportWorkbook() {
  const text = (value, cellStyle) => ({
      input: { type: "text", value },
      ...(cellStyle ? { cellStyle } : {}),
    }),
    cells = {
      A1: text("Item", "header"),
      B1: text("Margin", "header"),
      C1: text("Share", "header"),
      D1: text("Date", "header"),
      E1: text("Double", "header"),
      F1: text("Comment", "header"),
    };
  for (let r = 2; r <= 121; r++) {
    const value = ((r * 37) % 200) - 80;
    cells[`A${r}`] = text(`Item ${r - 1}`);
    cells[`B${r}`] = {
      input: { type: "number", value },
      format: { kind: "currency", currency: "EUR", digits: 2 },
    };
    cells[`C${r}`] = {
      input: { type: "number", value: value / 400 },
      format: { kind: "percent", digits: 1 },
    };
    cells[`D${r}`] = {
      input: { type: "number", value: 45000 + r },
      format: { kind: "date" },
    };
    cells[`E${r}`] = {
      formula: `=B${r}*2`,
      format: { kind: "number", digits: 0, negative: "redParentheses" },
    };
  }
  cells.A124 = text(
    "Note: an overflowing comment that runs into the empty cells to its right",
  );
  cells.F5 = {
    input: { type: "text", value: "A wrapped note over several lines" },
    style: { align: { wrap: true } },
  };
  cells.A122 = {
    input: { type: "text", value: "Total" },
    cellStyle: "header",
    style: { border: { top: { style: "double", color: "ink" } } },
  };
  cells.B122 = {
    formula: "=SUM(B2:B121)",
    format: { kind: "currency", currency: "EUR", digits: 2 },
    style: { border: { top: { style: "double", color: "ink" } } },
  };
  const wide = { A1: text("Wide", "header") };
  for (let c = 2; c <= 30; c++) {
    const col = String.fromCharCode(64 + ((c - 1) % 26) + 1);
    const ref = (c > 26 ? "A" : "") + col;
    wide[`${ref}1`] = text(`Col ${c}`, "header");
    // A left border on every value: each band shows it beside its first
    // column after the repeated column A.
    wide[`${ref}2`] = {
      input: { type: "number", value: c * 1000 },
      style: { border: { left: { style: "double", color: "ink" } } },
    };
  }
  return {
    version: VERSION,
    id: "fictional-print-report",
    title: "Fictional print report",
    dateSystem: "excel1900",
    locale: "en-US",
    sheets: [
      { id: "report", name: "Report", rows: { 5: { height: 46 } }, cells },
      { id: "wide", name: "Wide", cells: wide },
      {
        id: "huge",
        name: "Huge",
        cells: { A1: text("Corner"), J10000: text("Far") },
      },
    ],
    groups: [],
    names: [],
    metadata: { fictional: true },
    conditionalFormats: [
      {
        id: "bars",
        sheetId: "report",
        ref: "B2:B121",
        kind: "dataBar",
        scale: { kind: "auto" },
        positive: "acc",
        negative: "alert",
      },
    ],
    charts: [
      {
        id: "margins",
        sheetId: "report",
        anchor: "H2",
        width: 420,
        height: 260,
        type: "column",
        options: { title: "Margin by item", unit: "EUR" },
        source: { sheetId: "report", ref: "A1:B9" },
      },
    ],
  };
}

const files = {
  standard: resolve(out, "print.html"),
  offline: resolve(out, "print-offline.html"),
  stale: resolve(out, "print-stale.html"),
};
const html = await buildWorkbook(reportWorkbook());
await writeFile(files.standard, html);
await writeFile(
  files.offline,
  await buildWorkbook(reportWorkbook(), { offline: true }),
);
// Changing an input after the build leaves the saved results stale.
const parsed = readHTML(html);
parsed.book.sheets[0].cells.B2.input.value = 999;
await writeFile(files.stale, replaceHTML(html, parsed, parsed.book));

// The menu item's name ends with its shortcut.
const printItem = (page) =>
  page
    .getByRole("menu", { name: "File", exact: true })
    .getByRole("menuitem", { name: /^Print \/ PDF…/ });
// Pages in a PDF: one /Type /Page object each.
const pages = (pdf) =>
  pdf.toString("latin1").match(/\/Type\s*\/Page\b/g).length;

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    }),
    requests = [],
    errors = [];
  await context.route(/^https?:\/\//, (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  async function open(file) {
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(file).href);
    await page.locator("#calc-state").waitFor();
    await page.waitForFunction(
      () => document.getElementById("calc-state").textContent !== "",
    );
    // The browser's print dialog cannot be driven: count the calls.
    await page.evaluate(() => {
      window.printed = 0;
      window.print = () => window.printed++;
    });
    return page;
  }
  async function printDialog(page, configure) {
    await openMenu(page, "File");
    await printItem(page).click();
    const dialog = page.getByRole("dialog", { name: "Print / PDF" });
    await dialog.waitFor();
    const state = {
      paper: await dialog.getByLabel("Paper").inputValue(),
      orientation: await dialog.getByLabel("Orientation").inputValue(),
      repeat: await dialog.getByLabel("Repeat rows at top").inputValue(),
      fit: await dialog.locator(".print-fit").textContent(),
    };
    await configure?.(dialog);
    await dialog.getByRole("button", { name: "Print", exact: true }).click();
    await page.waitForFunction(() => window.printed > 0);
    return state;
  }

  for (const mode of ["standard", "offline"]) {
    const page = await open(files[mode]);
    const state = await printDialog(page);
    assert.deepEqual(state, {
      paper: "Letter",
      orientation: "portrait",
      repeat: "1",
      fit: "Report!A1:F124, at full size.",
    });
    const view = await page.evaluate(() => {
      const v = document.getElementById("print-view"),
        bars = [...v.querySelectorAll(".data-bar-fill")];
      return {
        printing: document.documentElement.classList.contains("printing"),
        title: v.querySelector(".print-title").textContent,
        head: v.querySelectorAll("thead tr").length,
        body: v.querySelectorAll("tbody tr").length,
        columns: v.querySelectorAll("col").length,
        text: v.querySelector("tbody tr td:nth-child(2)").textContent,
        red: getComputedStyle(
          [...v.querySelectorAll("tbody td:nth-child(5) .grid-cell")].find(
            (c) => c.textContent.startsWith("("),
          ),
        ).color,
        bars: bars.length,
        negative: bars.filter(
          (bar) =>
            parseFloat(bar.style.left) + parseFloat(bar.style.width) <=
              parseFloat(
                bar.parentElement.querySelector(".data-bar-axis").style.left,
              ) +
                0.01 && parseFloat(bar.style.width) > 0,
        ).length,
        edges: [...v.querySelectorAll(".print-edge")].map(
          (e) => getComputedStyle(e).borderTopStyle,
        ),
        overflow: v.querySelectorAll(".grid-cell.overflow").length,
        wrapped: v.querySelectorAll(".grid-cell.wrap").length,
        charts: [...v.querySelectorAll(".print-chart img")].map((img) => ({
          svg: img.src.startsWith("data:image/svg+xml"),
          loaded: img.complete && img.naturalWidth > 0,
          alt: img.alt,
        })),
        chartTitle: v.querySelector(".print-chart .data-chart-title")
          ?.textContent,
        stale: !!v.querySelector(".print-stale"),
        hidden: v.closest("[aria-hidden]") !== null,
      };
    });
    assert.equal(view.printing, true);
    assert.equal(view.title, "Fictional print report — Report");
    assert.equal(view.head, 1);
    assert.equal(view.body, 123);
    assert.equal(view.columns, 6);
    assert.match(view.text, /^-?€\d/);
    assert.notEqual(view.red, "rgb(0, 0, 0)");
    assert.equal(view.bars, 120);
    assert.ok(view.negative >= 40, `${view.negative} negative bars`);
    // The total's double top border, as row 121's bottom edge.
    assert.deepEqual(view.edges, ["double", "double"]);
    assert.equal(view.overflow, 1);
    assert.equal(view.wrapped, 1);
    assert.deepEqual(view.charts, [
      {
        svg: true,
        loaded: true,
        alt: "Margin by item. Columns chart of Report!A1:B9.",
      },
    ]);
    assert.equal(view.chartTitle, "Margin by item");
    assert.equal(view.stale, false);
    // Printed PDFs keep the report in the accessibility tree.
    assert.equal(view.hidden, false);
    // In print, only the view shows.
    await page.emulateMedia({ media: "print" });
    const shown = await page.evaluate(() => ({
      app: getComputedStyle(document.querySelector(".app-bar")).display,
      grid: document.getElementById("grid").getClientRects().length,
      view: getComputedStyle(document.getElementById("print-view")).display,
    }));
    assert.deepEqual(shown, { app: "none", grid: 0, view: "block" });
    await page.screenshot({
      path: resolve(out, `print-${mode}.png`),
      fullPage: true,
    });
    const pdf = await page.pdf({
      path: resolve(out, `print-${mode}.pdf`),
      preferCSSPageSize: true,
      printBackground: true,
    });
    assert.ok(pages(pdf) >= 3, `${pages(pdf)} pages`);
    await page.emulateMedia({ media: null });
    // The view goes when the print dialog closes.
    await page.evaluate(() => dispatchEvent(new Event("afterprint")));
    assert.equal(await page.locator("#print-view").count(), 0);
    assert.equal(
      await page.evaluate(() =>
        document.documentElement.classList.contains("printing"),
      ),
      false,
    );

    // A wide sheet turns landscape and, too wide to fit legibly, splits into
    // pages across, each starting with column A.
    await page.getByRole("button", { name: "Wide", exact: true }).click();
    const wide = await printDialog(page);
    assert.equal(wide.orientation, "landscape");
    assert.match(wide.fit, /^Wide!A1:AD2 on \d+ pages across, at full size\.$/);
    const across = Number(wide.fit.match(/on (\d+) pages/)[1]);
    const bands = await page.evaluate(() =>
      [...document.querySelectorAll("#print-view table")].map((t) => ({
        first: t.querySelector("thead td").textContent,
        edge: getComputedStyle(
          t.querySelector("tbody tr td:nth-child(2) .print-edge"),
        ).borderLeftStyle,
        width: parseFloat(t.style.width),
        zoom: t.style.zoom,
      })),
    );
    assert.equal(bands.length, across);
    assert.ok(across >= 3);
    // Letter landscape: 279.4 mm less two 12 mm margins.
    const landscape = ((279.4 - 24) * 96) / 25.4;
    for (const band of bands) {
      assert.equal(band.first, "Wide");
      assert.equal(band.edge, "double");
      assert.equal(band.zoom, "");
      assert.ok(band.width <= landscape);
    }
    await page.emulateMedia({ media: "print" });
    const splitPdf = await page.pdf({
      path: resolve(out, `print-${mode}-wide-split.pdf`),
      preferCSSPageSize: true,
      printBackground: true,
    });
    assert.equal(pages(splitPdf), across);
    await page.emulateMedia({ media: null });
    await page.evaluate(() => dispatchEvent(new Event("afterprint")));
    // Fit to the page width instead: one scaled table on one page.
    const fitted = await printDialog(page, (dialog) =>
      dialog.getByLabel("Wide sheets").selectOption("fit"),
    );
    assert.equal(fitted.orientation, "landscape");
    const zoom = await page.evaluate(() => {
      const t = document.querySelectorAll("#print-view table");
      return {
        count: t.length,
        zoom: +t[0].style.zoom,
        width: parseFloat(t[0].style.width),
      };
    });
    assert.equal(zoom.count, 1);
    assert.ok(zoom.zoom < 0.6);
    assert.ok(zoom.zoom * zoom.width <= landscape + 0.5);
    await page.emulateMedia({ media: "print" });
    const widePdf = await page.pdf({
      path: resolve(out, `print-${mode}-wide-fit.pdf`),
      preferCSSPageSize: true,
      printBackground: true,
    });
    assert.equal(pages(widePdf), 1);
    await page.emulateMedia({ media: null });
    await page.evaluate(() => dispatchEvent(new Event("afterprint")));

    // Cmd/Ctrl+P opens the dialog; a print started elsewhere uses defaults.
    await page.locator("#grid").focus();
    await page.keyboard.press("ControlOrMeta+p");
    await page.getByRole("dialog", { name: "Print / PDF" }).waitFor();
    await page.keyboard.press("Escape");
    await page.evaluate(() => dispatchEvent(new Event("beforeprint")));
    assert.equal(await page.locator("#print-view").count(), 1);
    await page.evaluate(() => dispatchEvent(new Event("afterprint")));
    // The browser's own Print on a sheet too large prints the reason, not
    // the editor's viewport.
    await page.getByRole("button", { name: "Huge", exact: true }).click();
    await page.evaluate(() => dispatchEvent(new Event("beforeprint")));
    assert.match(
      await page.locator("#print-view").textContent(),
      /too large to print/,
    );
    await page.emulateMedia({ media: "print" });
    assert.equal(
      await page.evaluate(
        () => document.getElementById("grid").getClientRects().length,
      ),
      0,
    );
    await page.emulateMedia({ media: null });
    await page.evaluate(() => dispatchEvent(new Event("afterprint")));
    await page.close();
  }

  // Stale saved results: a warning in the dialog and a band in the print.
  {
    const page = await open(files.stale);
    await openMenu(page, "File");
    await printItem(page).click();
    await page
      .getByRole("dialog", { name: "Print / PDF" })
      .getByRole("alert")
      .filter({ hasText: "Saved results may be out of date" })
      .waitFor();
    await page.keyboard.press("Escape");
    await printDialog(page);
    assert.equal(
      await page.locator("#print-view .print-stale").textContent(),
      STALE_NOTICE,
    );
    await page.emulateMedia({ media: "print" });
    await page.pdf({
      path: resolve(out, "print-stale.pdf"),
      preferCSSPageSize: true,
      printBackground: true,
    });
    await page.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, [], "printing makes no network request");
  console.log("Print / PDF browser checks passed");
} finally {
  await browser.close();
}
