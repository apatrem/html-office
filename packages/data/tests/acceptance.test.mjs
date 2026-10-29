// T21: the committed acceptance workbook and samples. The inputs are what
// acceptance/author.mjs writes; the published standard and offline files
// hold the same workbook with current results that match independently
// known totals; the CSV and PDF samples are what the README describes;
// nothing private or client-specific is published. Regeneration through the
// skill and the browser workflow are in acceptance-browser.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readHTML } from "../bench/storage/html.mjs";
import { snapshotState } from "../model/snapshots.mjs";
import { FILES } from "../acceptance/author.mjs";
import { parseCSV } from "./csv-parse.mjs";
import {
  differences,
  expected,
  readRecords,
  FUNCTIONS,
} from "./acceptance-expected.mjs";

const dir = fileURLToPath(new URL("../acceptance/", import.meta.url)),
  output = join(dir, "output"),
  NAME = "fictional-bike-rentals";
const book = async (name) =>
  readHTML(await readFile(join(output, name), "utf8")).book;

test("the committed inputs are what author.mjs writes", async () => {
  for (const [name, make] of Object.entries(FILES))
    assert.equal(await readFile(join(dir, name), "utf8"), make(), name);
});

test("standard and offline files hold one workbook with current results", async () => {
  const standard = await book(`${NAME}.html`),
    offline = await book(`${NAME}-offline.html`);
  const strip = (b) => ({ ...b, snapshot: { ...b.snapshot, calculatedAt: 0 } });
  assert.deepEqual(strip(offline), strip(standard));
  assert.equal((await snapshotState(standard)).state, "current");
  assert.equal(standard.metadata.fictional, true);
  assert.equal(standard.sources.length, 1);
  assert.equal(standard.sources[0].file.name, "rentals-2025.csv");
  assert.equal(standard.pivots[0].refreshed.fingerprint.length, 64);
  for (const chart of standard.charts) assert.match(chart.preview.svg, /^<svg/);
});

test("saved results match the independently known totals", async () => {
  const records = readRecords(
      await readFile(join(dir, "sources/rentals-2025.csv"), "utf8"),
    ),
    standard = await book(`${NAME}.html`),
    state = expected(records);
  assert.deepEqual(differences(standard, state), []);
  // The totals the README states.
  const readme = await readFile(join(dir, "README.md"), "utf8"),
    eur = (x) => `€${Math.round(x).toLocaleString("en-US")}`;
  for (const value of [
    state.summary.revenue[2],
    state.summary.net[2],
    state.summary.fcf[2],
    state.summary.npv,
  ])
    assert.ok(readme.includes(eur(value)), eur(value));
  // Every function of the formula contract has an analysis row.
  const analysis = standard.sheets.find((s) => s.name === "Formula analysis"),
    rows = Object.entries(analysis.cells).filter(
      ([ref, c]) => /^B\d+$/.test(ref) && c.input?.type === "text",
    );
  for (const fn of FUNCTIONS)
    assert.ok(
      rows.some(([ref, c]) => {
        const formula = analysis.cells[`D${ref.slice(1)}`]?.formula ?? "";
        return c.input.value === fn && formula.includes(`${fn}(`);
      }),
      fn,
    );
});

test("the CSV and PDF samples", async () => {
  const csv = parseCSV(await readFile(join(output, `${NAME}-pnl.csv`), "utf8")),
    pnl = (await book(`${NAME}.html`)).sheets.find((s) => s.name === "P&L");
  assert.equal(csv.length, 15);
  assert.deepEqual(csv[1].slice(0, 3), [
    "Month end",
    "2025-01-31",
    "2025-02-28",
  ]);
  for (const [r, row] of csv.entries())
    row.slice(1).forEach((field, i) => {
      const cell = pnl.cells[`${String.fromCharCode(66 + i)}${r + 1}`],
        value = cell?.result?.value;
      if (typeof value === "number" && r !== 1)
        assert.equal(Number(field), value, `P&L row ${r + 1}`);
    });
  for (const name of ["summary", "pnl"]) {
    const pdf = await readFile(join(output, `${NAME}-${name}.pdf`));
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.equal(pdf.toString("latin1").match(/\/Type\s*\/Page\b/g).length, 3);
  }
});

test("the README records each published file's size", async () => {
  const readme = await readFile(join(dir, "README.md"), "utf8");
  for (const name of await readdir(output)) {
    const { size } = await stat(join(output, name));
    assert.match(
      readme,
      new RegExp(
        `${name.replace(/[.]/g, "\\.")}[^\\n]*\\| ${size.toLocaleString("en-US")} bytes`,
      ),
      name,
    );
  }
});

test("nothing private is published", async () => {
  const names = [
    ...Object.keys(FILES),
    ...(await readdir(output)).map((n) => `output/${n}`),
    "README.md",
  ];
  // Paths of the machine that built or imported the files, in any file.
  const paths = [
    /\/Users\//,
    /\/home\/(?!runner\b)[a-z]/,
    /\/private\/tmp|\/var\/folders/,
    /[A-Z]:\\\\Users/,
    /fakepath/i,
  ];
  for (const name of names) {
    const text = (await readFile(join(dir, name))).toString("latin1");
    for (const pattern of paths)
      assert.ok(!pattern.test(text), `${name}: ${pattern}`);
  }
  // Authored content: the workbook (notices legitimately hold addresses).
  // Chart previews are SVG drawings (their xmlns is a URL).
  const authored = await book(`${NAME}.html`);
  for (const chart of authored.charts) delete chart.preview;
  const workbook = JSON.stringify(authored);
  for (const pattern of [/@[a-z0-9-]+\.[a-z]{2,}/i, /https?:\/\//])
    assert.ok(!pattern.test(workbook), `workbook: ${pattern}`);
});
