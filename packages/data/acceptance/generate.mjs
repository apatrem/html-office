#!/usr/bin/env node
// T21: generates the fictional P&L acceptance workbook through the html-data
// skill, as an author and a person would:
//   1. the skill is packaged afresh and its tools/workbook.mjs builds
//      model.json (`new --offline`), then `validate`;
//   2. a person imports sources/rentals-2025.csv in Chromium (Data › Import
//      CSV…, sheet "Rentals") and saves a copy: imports happen only in the
//      browser;
//   3. `inspect` gives the imported sheet's ID; the tools apply
//      patches/link-rentals.json with --refresh-pivots, and `validate --since`
//      checks that nothing else changed;
//   4. `extract` (with the charte), then `new` and `new --offline` write the standard
//      and offline files from the same canonical JSON, and `validate` both;
//   5. Chromium exports the P&L as CSV and prints Summary and P&L to PDF from
//      the offline file (no network).
// Usage: node packages/data/acceptance/generate.mjs [--out DIR]
// (default: packages/data/acceptance/output). The command line first writes
// the inputs with author.mjs.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, cp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { packageSkill } from "../tools/skill.mjs";
import { RECORD_ROW, RECORD_ANALYSIS, FILES } from "./author.mjs";
import { command, openMenu, menuItem } from "../tests/shell.mjs";

const run = promisify(execFile),
  here = dirname(fileURLToPath(import.meta.url)),
  repo = resolve(here, "../../..");
export const NAME = "fictional-bike-rentals";

// The released skill, packaged from the current sources as release.sh does.
export async function freshSkill() {
  const dir = await mkdtemp(join(tmpdir(), "html-data-t21-")),
    skill = join(dir, "plugin/skills/html-data");
  await cp(join(repo, "plugin"), join(dir, "plugin"), { recursive: true });
  await packageSkill(skill);
  return { dir, skill };
}

async function waitStatus(page, pattern, timeout = 60000) {
  try {
    await page.waitForFunction(
      (source) =>
        new RegExp(source).test(document.getElementById("status").textContent),
      pattern.source,
      { timeout },
    );
  } catch (error) {
    console.error(`Status: ${await page.locator("#status").textContent()}`);
    throw error;
  }
}

// Picks a file for a Data menu command, as a person does in the dialog.
export async function pickCSV(page, name, item) {
  const chooser = page.waitForEvent("filechooser");
  await command(page, item);
  await (
    await chooser
  ).setFiles({
    name,
    mimeType: "text/csv",
    buffer: await readFile(join(here, "sources", name)),
  });
}

export async function openWorkbook(context, file) {
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(pathToFileURL(file).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  return page;
}

export const tab = (page, name) =>
  page.locator("#sheet-tabs").getByRole("button", { name, exact: true });

// Step 2: the person's import, saved as a copy.
async function importRentals(context, from, to) {
  const page = await openWorkbook(context, from);
  await pickCSV(page, "rentals-2025.csv", "Import CSV");
  await page.locator("#import-preview table").waitFor();
  await page.getByLabel("New sheet name").fill("Rentals");
  await page.locator("#import-apply").click();
  await waitStatus(page, /Imported rentals-2025\.csv/);
  const download = page.waitForEvent("download");
  await command(page, "Save a copy");
  await (await download).saveAs(to);
  assert.deepEqual(page.errors, []);
  await page.close();
}

// Step 5: CSV export of the P&L and PDFs of Summary and P&L.
async function outputs(context, file, out) {
  const page = await openWorkbook(context, file);
  await tab(page, "P&L").click();
  await openMenu(page, "File");
  await menuItem(page, "File", "Export sheet as CSV…").click();
  const dialog = page.getByRole("dialog", { name: "Export sheet as CSV" });
  await dialog.waitFor();
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export CSV", exact: true }).click();
  const csv = join(out, `${NAME}-pnl.csv`);
  await (await download).saveAs(csv);
  // The browser's print dialog cannot be driven: the view is printed by
  // Chromium's PDF printer instead, as print-browser.mjs does.
  await page.evaluate(() => (window.print = () => (window.printed = true)));
  const pdfs = [];
  for (const sheet of ["Summary", "P&L"]) {
    await tab(page, sheet).click();
    await openMenu(page, "File");
    await page
      .getByRole("menu", { name: "File", exact: true })
      .getByRole("menuitem", { name: /^Print \/ PDF…/ })
      .click();
    const print = page.getByRole("dialog", { name: "Print / PDF" });
    await print.waitFor();
    await print.getByRole("button", { name: "Print", exact: true }).click();
    await page.waitForFunction(() => window.printed);
    await page.waitForFunction(() =>
      [...document.querySelectorAll("#print-view img")].every(
        (img) => img.complete && img.naturalWidth > 0,
      ),
    );
    await page.emulateMedia({ media: "print" });
    const path = join(
      out,
      `${NAME}-${sheet === "P&L" ? "pnl" : sheet.toLowerCase()}.pdf`,
    );
    await page.pdf({ path, preferCSSPageSize: true, printBackground: true });
    pdfs.push(path);
    await page.emulateMedia({ media: null });
    await page.evaluate(() => {
      window.printed = false;
      dispatchEvent(new Event("afterprint"));
    });
  }
  assert.deepEqual(page.errors, []);
  await page.close();
  return { csv, pdfs };
}

// The whole chain; `browser` is a launched Chromium. Returns the paths of
// the generated files and the tool transcript.
export async function generate({ out, browser, skill, work }) {
  await mkdir(out, { recursive: true });
  work ??= await mkdtemp(join(tmpdir(), "html-data-t21-work-"));
  const log = [],
    tool = async (...args) => {
      log.push(`workbook.mjs ${args.join(" ")}`);
      const { stdout } = await run(
        process.execPath,
        [join(skill, "tools/workbook.mjs"), ...args],
        { cwd: work, maxBuffer: 64 << 20 },
      );
      return stdout;
    };
  const model = join(here, "model.json"),
    patch = join(here, "patches/link-rentals.json");
  // 1. The authored model, offline so the browser calculates without network.
  await tool("new", "step1.html", "--model", model, "--offline", "--force");
  assert.equal((await tool("validate", "step1.html")).trim(), "Valid.");
  // 2. The person's import.
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1280, height: 800 },
  });
  const requests = [];
  await context.route(/^https?:\/\//, (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  try {
    await importRentals(
      context,
      join(work, "step1.html"),
      join(work, "step2.html"),
    );
    // 3. Link the records: the patch names the imported sheet by its ID.
    const summary = JSON.parse(await tool("inspect", "step2.html", "--json")),
      rentals = summary.sheets.find((s) => s.name === "Rentals");
    assert.equal(rentals?.id, "import-1", "the patch's pivot source ID");
    await tool("apply", "step2.html", patch, "--dry-run");
    await tool(
      "apply",
      "step2.html",
      patch,
      "--out",
      "step3.html",
      "--refresh-pivots",
    );
    const last = RECORD_ROW + RECORD_ANALYSIS.length - 1;
    assert.equal(
      (
        await tool(
          "validate",
          "step3.html",
          "--since",
          "step2.html",
          "--allow",
          `Monthly actuals!B2:B13,Formula analysis!A${RECORD_ROW}:D${last},Stations!A4:D10`,
          "--allow-fields",
          "pivots",
        )
      ).trim(),
      "Valid.",
    );
    // 4. The standard and offline files, from one canonical JSON.
    // The document's charte goes with it, as SKILL.md says.
    await tool(
      "extract",
      "step3.html",
      "--out",
      "final.json",
      "--charte-out",
      "charte.css",
    );
    const standard = join(out, `${NAME}.html`),
      offline = join(out, `${NAME}-offline.html`),
      model = ["--model", "final.json", "--charte", "charte.css", "--force"];
    await tool("new", standard, ...model);
    await tool("new", offline, ...model, "--offline");
    for (const file of [standard, offline])
      assert.equal((await tool("validate", file)).trim(), "Valid.");
    // 5. CSV and PDF samples.
    const samples = await outputs(context, offline, out);
    assert.deepEqual(requests, [], "no network request");
    return { standard, offline, ...samples, log, work };
  } finally {
    await context.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { chromium } = await import("playwright");
  const at = process.argv.indexOf("--out"),
    out = resolve(at > 0 ? process.argv[at + 1] : join(here, "output"));
  // The inputs first, so a change to author.mjs reaches the outputs.
  for (const [name, make] of Object.entries(FILES))
    await writeFile(join(here, name), make());
  const { dir, skill } = await freshSkill(),
    browser = await chromium.launch();
  try {
    const result = await generate({ out, browser, skill });
    for (const line of result.log) console.log(line);
    console.log(`Wrote ${out}`);
    await rm(result.work, { recursive: true, force: true });
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
}
