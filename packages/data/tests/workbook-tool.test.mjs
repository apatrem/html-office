// T20 document tooling: the valid and invalid examples drive the checks, so
// the guidance cannot drift from the checker. Each command runs as a person
// or an agent runs it, in a child process.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readDocument, outside } from "../tools/document-html.mjs";
import { writeModel } from "../model/document.mjs";
import { preservation } from "../tools/workbook-ops.mjs";
import { guide } from "../tools/build.mjs";

const run = promisify(execFile),
  tool = fileURLToPath(new URL("../tools/workbook.mjs", import.meta.url)),
  examples = fileURLToPath(new URL("../examples/", import.meta.url)),
  dir = await mkdtemp(join(tmpdir(), "html-data-tool-"));
async function cli(...args) {
  try {
    const { stdout } = await run(process.execPath, [tool, ...args]);
    return { code: 0, out: stdout };
  } catch (error) {
    return { code: error.code, out: error.stdout + error.stderr };
  }
}
const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );
const cell = async (file, range) =>
  JSON.parse((await cli("inspect", file, "--range", range, "--json")).out)
    .cells;

const budget = join(dir, "budget.html");
test("valid examples build, standard and offline, and validate", async () => {
  for (const name of await readdir(join(examples, "valid"))) {
    const out = join(dir, name.replace(".json", ".html")),
      made = await cli("new", out, "--model", join(examples, "valid", name));
    assert.equal(made.code, 0, made.out);
    assert.match(made.out, /results current/);
  }
  assert.equal((await cli("validate", budget)).code, 0);
  // The sales pivot was never refreshed: validate says what to do.
  const sales = join(dir, "sales.html"),
    stale = await cli("validate", sales);
  assert.equal(stale.code, 1);
  assert.match(
    stale.out,
    /not yet refreshed: recalculate with --refresh-pivots/,
  );
  assert.equal(
    (await cli("recalculate", sales, "--in-place", "--refresh-pivots")).code,
    0,
  );
  assert.equal((await cli("validate", sales)).code, 0);
  const offline = join(dir, "budget-offline.html");
  assert.equal(
    (
      await cli(
        "new",
        offline,
        "--model",
        join(examples, "valid/budget.json"),
        "--offline",
      )
    ).code,
    0,
  );
  const a = readDocument(await readFile(budget, "utf8")).book,
    b = readDocument(await readFile(offline, "utf8")).book;
  delete a.snapshot.calculatedAt;
  delete b.snapshot.calculatedAt;
  assert.deepEqual(a, b, "standard and offline hold the same workbook");
  // An existing file is not replaced without --force.
  assert.equal(
    (await cli("new", budget, "--model", join(examples, "valid/budget.json")))
      .code,
    2,
  );
});

test("invalid examples are refused with their documented errors", async () => {
  const expected = JSON.parse(
    await readFile(join(examples, "invalid/expected.json"), "utf8"),
  );
  for (const [name, message] of Object.entries(expected)) {
    const out = join(dir, `invalid-${name}.html`),
      result = await cli(
        "new",
        out,
        "--model",
        join(examples, "invalid", name),
      );
    assert.equal(result.code, 1, name);
    assert.ok(result.out.includes(message), `${name}: ${result.out}`);
    assert.equal(await exists(out), false, `${name} wrote nothing`);
    assert.ok(guide.includes(message), `the guide documents "${message}"`);
  }
  // Errors name the cell they are in.
  const bad = await cli(
    "new",
    join(dir, "x.html"),
    "--model",
    join(examples, "invalid/literal-colour.json"),
  );
  assert.match(bad.out, /Budget!A2: Invalid text colour/);
});

test("invalid patches are reported, all at once, and change nothing", async () => {
  const expected = JSON.parse(
      await readFile(join(examples, "patches/invalid/expected.json"), "utf8"),
    ),
    before = await readFile(budget, "utf8");
  for (const [name, message] of Object.entries(expected)) {
    for (const mode of [["--dry-run"], ["--in-place"]]) {
      const result = await cli(
        "apply",
        budget,
        join(examples, "patches/invalid", name),
        ...mode,
      );
      assert.equal(result.code, 1, name);
      assert.ok(result.out.includes(message), `${name}: ${result.out}`);
    }
    assert.ok(guide.includes(message), `the guide documents "${message}"`);
  }
  assert.equal(await readFile(budget, "utf8"), before);
  // Several problems come back together, numbered.
  const many = join(dir, "many.json");
  await writeFile(
    many,
    JSON.stringify({
      edits: [
        { sheet: "Nope", ref: "A1", cell: null },
        { sheet: "Budget", ref: "ZZZZ9", cell: null },
        {
          sheet: "Budget",
          ref: "B2",
          cell: { formula: "=1", input: { type: "blank" } },
        },
      ],
    }),
  );
  const listed = await cli("apply", budget, many, "--dry-run");
  assert.match(listed.out, /1\. edits\[0\]: unknown sheet "Nope"/);
  assert.match(listed.out, /2\. edits\[1\]: Invalid address: ZZZZ9/);
  assert.match(
    listed.out,
    /3\. edits\[2\] Budget!B2: Cell cannot contain input and formula/,
  );
});

test("a patch recalculates, keeps presentation and changes nothing else", async () => {
  const out = join(dir, "raised.html"),
    applied = await cli(
      "apply",
      budget,
      join(examples, "patches/raise-price.json"),
      "--out",
      out,
    );
  assert.equal(applied.code, 0, applied.out);
  assert.match(applied.out, /Applied 2 cell edits.*results current/);
  // Busy: 180 guests × 40 = 7,200 income; costs 900 + 3,240.
  const [total] = await cell(out, "Budget!D4");
  assert.equal(total.cell.result.value, 3060);
  assert.equal(total.shown, "€3,060");
  const [price] = await cell(out, "Inputs!B4");
  assert.equal(price.cell.cellStyle, "assumption", "presentation kept");
  assert.equal(price.cell.format.kind, "currency");
  const html = await readFile(out, "utf8"),
    original = await readFile(budget, "utf8");
  assert.equal(
    outside(html, readDocument(html)),
    outside(original, readDocument(original)),
    "only the workbook payload changes",
  );
  // validate --since flags the edits unless they are allowed.
  const strict = await cli("validate", out, "--since", budget);
  assert.equal(strict.code, 1);
  assert.match(strict.out, /Inputs!B1 changed without being requested/);
  assert.match(strict.out, /Inputs!B4 changed without being requested/);
  assert.equal(
    (
      await cli(
        "validate",
        out,
        "--since",
        budget,
        "--allow",
        "Inputs!B1,Inputs!B4",
      )
    ).code,
    0,
  );
  // The chart preview was redrawn for the new data.
  assert.equal((await cli("validate", out)).code, 0);
  // --no-recalculate leaves results stale, and validate says so.
  const lazy = join(dir, "lazy.html");
  await cli(
    "apply",
    budget,
    join(examples, "patches/raise-price.json"),
    "--out",
    lazy,
    "--no-recalculate",
  );
  const stale = await cli("validate", lazy);
  assert.equal(stale.code, 1);
  assert.match(stale.out, /stale: recalculate/);
  assert.equal((await cli("validate", lazy, "--allow-stale")).code, 0);
});

test("rows patches and pivot refresh on a table sheet", async () => {
  const sales = join(dir, "sales.html"),
    out = join(dir, "sales-more.html"),
    result = await cli(
      "apply",
      sales,
      join(examples, "patches/sales-records.json"),
      "--out",
      out,
      "--refresh-pivots",
    );
  assert.equal(result.code, 0, result.out);
  const rows = await cell(out, "Summary!B3:E10"),
    west = rows.find((c) => c.shown === "West");
  assert.ok(west, "the new region appears in the pivot");
  assert.equal((await cli("validate", out)).code, 0);
  assert.equal(
    (await cli("validate", out, "--since", sales, "--allow", "Sales!A10:F10"))
      .code,
    0,
  );
  // Writing into the pivot's output is refused.
  const owned = join(dir, "owned.json");
  await writeFile(
    owned,
    JSON.stringify({
      edits: [
        {
          sheet: "Summary",
          ref: "C5",
          cell: { input: { type: "number", value: 1 } },
        },
      ],
    }),
  );
  assert.match(
    (await cli("apply", out, owned, "--dry-run")).out,
    /belongs to pivot table "Revenue by region"/,
  );
});

test("text survives exactly: markup, line separators, quotes", async () => {
  const tricky = "</script><b>x</b>   \"q\" 'a' \\ é",
    patch = join(dir, "tricky.json"),
    out = join(dir, "tricky.html");
  await writeFile(
    patch,
    JSON.stringify({
      edits: [
        {
          sheet: "Budget",
          ref: "A7",
          cell: { input: { type: "text", value: tricky } },
        },
      ],
    }),
  );
  assert.equal((await cli("apply", budget, patch, "--out", out)).code, 0);
  const html = await readFile(out, "utf8");
  assert.equal(html.includes("</script><b>"), false, "markup is escaped");
  assert.equal(readDocument(html).book.sheets[1].cells.A7.input.value, tricky);
  assert.equal((await cell(out, "Budget!A7"))[0].shown, tricky);
});

test("extract, inspect limits and output paths", async () => {
  const extracted = await cli("extract", budget);
  assert.equal(
    extracted.out.trim(),
    writeModel(readDocument(await readFile(budget, "utf8")).book),
  );
  const summary = JSON.parse((await cli("inspect", budget, "--json")).out);
  assert.deepEqual(
    summary.sheets.map((s) => [s.id, s.range, s.formulas]),
    [
      ["inputs", "A1:B5", 1],
      ["budget", "A1:D4", 7],
    ],
  );
  assert.equal(summary.results, "current");
  assert.match(
    (await cli("inspect", budget, "--range", "Budget!A1:Z300")).out,
    /Inspect at most 5000 cells/,
  );
  const patch = join(examples, "patches/add-note.json");
  assert.equal((await cli("apply", budget, patch)).code, 2);
  assert.equal((await cli("apply", budget, patch, "--out", budget)).code, 2);
  const copy = join(dir, "copy.html");
  await writeFile(copy, await readFile(budget, "utf8"));
  assert.equal((await cli("apply", copy, patch, "--in-place")).code, 0);
  assert.equal((await cell(copy, "Budget!A6"))[0].cell.cellStyle, "note");
});

// Review regressions (GPT-6.1 Sol): pivot moves, cache-only exemptions,
// shrinking pivots, JSON equality, kept results, removals, scenario order,
// row-table diagnostics, atomic writes.
test("a pivot moved onto data is refused; a shrinking one refreshes", async () => {
  const sales = join(dir, "sales.html"),
    model = JSON.parse((await cli("extract", sales)).out),
    pivots = structuredClone(model.pivots);
  pivots[0].output = { sheetId: "summary", ref: "A1" };
  const move = join(dir, "move.json");
  await writeFile(move, JSON.stringify({ set: { pivots } }));
  const moved = await cli(
    "apply",
    sales,
    move,
    "--out",
    join(dir, "moved.html"),
    "--refresh-pivots",
  );
  assert.equal(moved.code, 1);
  assert.match(moved.out, /already hold data/);
  assert.equal(await exists(join(dir, "moved.html")), false);
  // Every North record becomes South: the output loses a row.
  const table = model.sheets.find((s) => s.id === "sales").table,
    edits = table.data.flatMap((row, r) =>
      row[0] === "North"
        ? [
            {
              sheet: "Sales",
              ref: `A${r + 1}`,
              cell: { input: { type: "text", value: "South" } },
            },
          ]
        : [],
    ),
    shrink = join(dir, "shrink.json");
  await writeFile(shrink, JSON.stringify({ edits }));
  const out = join(dir, "shrunk.html"),
    shrunk = await cli(
      "apply",
      sales,
      shrink,
      "--out",
      out,
      "--refresh-pivots",
    );
  assert.equal(shrunk.code, 0, shrunk.out);
  assert.equal((await cli("validate", out)).code, 0);
  assert.equal(
    (await readdir(dir)).some((f) => f.endsWith(".tmp")),
    false,
  );
});

test("validate --since flags removed charts and pivots, not refreshed caches", async () => {
  const removal = join(dir, "removal.json"),
    out = join(dir, "no-charts.html");
  await writeFile(removal, JSON.stringify({ set: { charts: null } }));
  const removed = await cli("apply", budget, removal, "--out", out);
  assert.equal(removed.code, 0, removed.out);
  assert.equal(
    readDocument(await readFile(out, "utf8")).book.charts,
    undefined,
  );
  const check = await cli("validate", out, "--since", budget);
  assert.equal(check.code, 1);
  assert.match(check.out, /Workbook field "charts" changed/);
  // A recalculated copy (new previews, stamps) has no unrequested change.
  const again = join(dir, "again.html");
  await cli(
    "recalculate",
    join(dir, "sales.html"),
    "--out",
    again,
    "--refresh-pivots",
  );
  assert.equal(
    (await cli("validate", again, "--since", join(dir, "sales.html"))).code,
    0,
  );
});

test("formatting a formula keeps its result; key order and -0 compare exactly", async () => {
  const bold = join(dir, "bold.json"),
    out = join(dir, "bold.html");
  await writeFile(
    bold,
    JSON.stringify({
      edits: [{ sheet: "Budget", ref: "B2", cell: { style: { bold: true } } }],
    }),
  );
  assert.equal(
    (await cli("apply", budget, bold, "--out", out, "--no-recalculate")).code,
    0,
  );
  assert.equal((await cli("validate", out)).code, 0, "results still current");
  const before = {
      version: "x",
      sheets: [
        {
          id: "s",
          name: "S",
          cells: { A1: { input: { type: "number", value: 0 } } },
        },
      ],
    },
    signed = structuredClone(before),
    reordered = structuredClone(before);
  signed.sheets[0].cells.A1.input.value = -0;
  reordered.sheets[0].cells.A1 = { input: { value: 0, type: "number" } };
  assert.deepEqual(preservation(before, reordered), []);
  assert.deepEqual(preservation(before, signed), [
    "S!A1 changed without being requested.",
  ]);
});

test("removing the scenario frees its selector in the same patch", async () => {
  const patch = join(dir, "unscenario.json");
  await writeFile(
    patch,
    JSON.stringify({
      set: { scenario: null },
      edits: [{ sheet: "Inputs", ref: "B1", cell: { formula: '="Busy"' } }],
    }),
  );
  const result = await cli("apply", budget, patch, "--dry-run");
  assert.equal(result.code, 0, result.out);
});

test("a bad value in a row table is reported at its cell", async () => {
  const sales = join(dir, "sales.html"),
    model = JSON.parse((await cli("extract", sales)).out),
    table = model.sheets.find((s) => s.id === "sales").table;
  table.data[1][3] = "bad";
  const file = join(dir, "bad-table.json");
  await writeFile(file, JSON.stringify(model));
  const result = await cli("new", join(dir, "bad-table.html"), "--model", file);
  assert.equal(result.code, 1);
  assert.match(result.out, /Sales!D2: Expected finite number/);
});
