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
import { preservation, compactRange } from "../tools/workbook-ops.mjs";
import { guide } from "../tools/build.mjs";
import { cssTheme } from "../tools/chart-previews.mjs";

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

// Re-verification regressions (GPT-6.1 Sol): a later pivot no longer
// releases cells an earlier one just wrote; a moved pivot anchor is a
// change; replaced workbook fields can be allowed by name.
test("refreshing moved pivots keeps an earlier pivot's output", async () => {
  const model = JSON.parse(
      await readFile(join(examples, "valid/sales.json"), "utf8"),
    ),
    pivot = (id, ref) => ({
      id,
      name: id,
      source: { sheetId: "sales" },
      output: { sheetId: "summary", ref },
      rows: ["Region"],
      columns: [],
      filters: [],
      values: [{ field: "Adjusted", aggregate: "sum" }],
    });
  model.pivots = [pivot("first", "D20"), pivot("second", "B21")];
  const source = join(dir, "two-pivots.json"),
    file = join(dir, "two-pivots.html");
  await writeFile(source, JSON.stringify(model));
  assert.equal((await cli("new", file, "--model", source)).code, 0);
  const move = join(dir, "two-moves.json"),
    out = join(dir, "two-moved.html");
  await writeFile(
    move,
    JSON.stringify({
      set: { pivots: [pivot("first", "A20"), pivot("second", "D20")] },
    }),
  );
  const moved = await cli(
    "apply",
    file,
    move,
    "--out",
    out,
    "--refresh-pivots",
  );
  assert.equal(moved.code, 0, moved.out);
  const [first] = await cell(out, "Summary!B21:B21"),
    [second] = await cell(out, "Summary!E21:E21");
  assert.ok(first?.cell.input, "the first pivot keeps B21");
  assert.ok(second?.cell.input, "the second pivot writes E21");
  assert.deepEqual(first.cell.input, second.cell.input);
});

test("validate --since flags a moved pivot and allows named fields", async () => {
  const sales = join(dir, "sales.html"),
    model = JSON.parse((await cli("extract", sales)).out),
    pivots = structuredClone(model.pivots);
  pivots[0].output = { sheetId: "summary", ref: "H20" };
  const move = join(dir, "move-far.json"),
    out = join(dir, "moved-far.html");
  await writeFile(move, JSON.stringify({ set: { pivots } }));
  const moved = await cli(
    "apply",
    sales,
    move,
    "--out",
    out,
    "--refresh-pivots",
  );
  assert.equal(moved.code, 0, moved.out);
  const check = await cli("validate", out, "--since", sales);
  assert.equal(check.code, 1);
  assert.match(check.out, /Workbook field "pivots" changed/);
  // A requested chart change, allowed by field name.
  const retitle = join(dir, "retitle.json"),
    titled = join(dir, "retitled.html"),
    { charts } = JSON.parse((await cli("extract", budget)).out);
  charts[0].options.title = "Margin per line";
  delete charts[0].preview;
  await writeFile(retitle, JSON.stringify({ set: { charts } }));
  assert.equal((await cli("apply", budget, retitle, "--out", titled)).code, 0);
  assert.equal((await cli("validate", titled, "--since", budget)).code, 1);
  const allowed = await cli(
    "validate",
    titled,
    "--since",
    budget,
    "--allow-fields",
    "charts",
  );
  assert.equal(allowed.code, 0, allowed.out);
  assert.equal(
    (
      await cli(
        "validate",
        titled,
        "--since",
        budget,
        "--allow-fields",
        "sheets",
      )
    ).code,
    2,
  );
});

// Imported sources (T15, T16) are kept by the tools: listed by inspect, not
// settable, unchanged by a cell patch on the imported sheet.
test("imported sources are listed and kept", async () => {
  const model = JSON.parse(
      await readFile(join(examples, "valid/sales.json"), "utf8"),
    ),
    hex = "a".repeat(64);
  model.sources = [
    {
      id: "source-1",
      sheetId: "sales",
      ref: "A1:F2",
      kind: "xlsx",
      file: { name: "sales.xlsx", bytes: 2048, sha256: hex },
      importedAt: "2026-10-28T10:00:00.000Z",
      options: { sheet: "Sales", header: true },
      columns: ["A", "B", "C", "D", "E", "F"].map((name) => ({
        name,
        type: "auto",
        fingerprint: hex,
      })),
    },
  ];
  const source = join(dir, "imported.json"),
    file = join(dir, "imported.html");
  await writeFile(source, JSON.stringify(model));
  assert.equal((await cli("new", file, "--model", source)).code, 0);
  const listed = JSON.parse((await cli("inspect", file, "--json")).out);
  assert.deepEqual(listed.sources, [
    {
      id: "source-1",
      kind: "xlsx",
      file: "sales.xlsx",
      sheetId: "sales",
      ref: "A1:F2",
      importedAt: "2026-10-28T10:00:00.000Z",
    },
  ]);
  const refused = join(dir, "set-sources.json");
  await writeFile(refused, JSON.stringify({ set: { sources: null } }));
  const result = await cli("apply", file, refused, "--dry-run");
  assert.equal(result.code, 1);
  assert.match(result.out, /set\.sources: not settable/);
  const edit = join(dir, "edit-imported.json"),
    out = join(dir, "imported-2.html");
  await writeFile(
    edit,
    JSON.stringify({
      rows: [{ sheet: "Sales", at: "A3", values: [["West"]] }],
    }),
  );
  const applied = await cli(
    "apply",
    file,
    edit,
    "--out",
    out,
    "--refresh-pivots",
  );
  assert.equal(applied.code, 0, applied.out);
  assert.equal(
    readDocument(await readFile(out, "utf8")).book.sources[0].columns[0]
      .fingerprint,
    hex,
  );
  assert.equal(
    (await cli("validate", out, "--since", file, "--allow", "Sales!A3")).code,
    0,
  );
});

// T21 review: an offline copy built from extracted JSON keeps the
// document's own charte when extract writes it out for new --charte.
test("extract --charte-out keeps a custom charte through new", async () => {
  const charte = join(dir, "brand.css"),
    branded = join(dir, "branded.html");
  // A complete charte: the default one with another accent colour.
  await writeFile(
    charte,
    (
      await readFile(
        new URL(
          "../../../plugin/skills/html-slides/assets/default.css",
          import.meta.url,
        ),
        "utf8",
      )
    ).replace("#14517A", "#a01050"),
  );
  const made = await cli(
    "new",
    branded,
    "--model",
    join(examples, "valid/budget.json"),
    "--charte",
    charte,
  );
  assert.equal(made.code, 0, made.out);
  const model = join(dir, "branded.json"),
    kept = join(dir, "branded-charte.css"),
    offline = join(dir, "branded-offline.html");
  const extracted = await cli(
    "extract",
    branded,
    "--out",
    model,
    "--charte-out",
    kept,
  );
  assert.equal(extracted.code, 0, extracted.out);
  assert.match(await readFile(kept, "utf8"), /--acc:#a01050/);
  const rebuilt = await cli(
    "new",
    offline,
    "--model",
    model,
    "--charte",
    kept,
    "--offline",
  );
  assert.equal(rebuilt.code, 0, rebuilt.out);
  const charteOf = async (file) =>
    /<style id="charte">([\s\S]*?)<\/style>/.exec(
      await readFile(file, "utf8"),
    )[1];
  assert.equal(await charteOf(offline), await charteOf(branded));
});

// T21 gap: a charte that sets only a few tokens failed with "Unsupported
// JSON value" while drawing chart previews. The default charte's value now
// fills each core token it leaves out, and new names them.
test("new --charte with a partial charte takes the default for the rest", async () => {
  const charte = join(dir, "partial.css"),
    out = join(dir, "partial.html"),
    own = ":root{--acc:#a01050;--ink:#111}\n";
  await writeFile(charte, own);
  const { stdout, stderr } = await run(process.execPath, [
    tool,
    "new",
    out,
    "--model",
    join(examples, "valid/budget.json"),
    "--charte",
    charte,
  ]);
  assert.match(stdout, /results current/);
  assert.match(
    stderr,
    /leaves out --mid, --lig, --alert, --tint, --callout, --bd, --t2, --bg, --font: the default charte's values are used/,
  );
  assert.equal((await cli("validate", out)).code, 0);
  const html = await readFile(out, "utf8"),
    css = /<style id="charte">([\s\S]*?)<\/style>/.exec(html)[1];
  // The charte's own rule is kept as written, the defaults follow it.
  assert.ok(css.startsWith(own));
  assert.match(css, /--mid:#4F7FA3;.*--font:Arial, Helvetica, sans-serif\}/);
  assert.doesNotMatch(css, /--acc:#14517A|--header-bg/);
  const [chart] = readDocument(html).book.charts;
  assert.match(chart.preview.svg, /#a01050/i);
  // A document whose charte still lacks tokens (built before this fix)
  // reads them as the browser does: empty, never undefined.
  const theme = cssTheme(":root{--acc:#a01050}");
  for (const [key, value] of Object.entries(theme))
    assert.equal(typeof value, "string", key);
  assert.equal(theme.mid, "");
});

// T21 gap: inspect --range printed about 15 lines of JSON per cell. The text
// view is one line per cell; --json keeps the full cells.
test("inspect --range prints one line per cell", async () => {
  const shown = await cli("inspect", budget, "--range", "Budget!A2:D3");
  assert.equal(shown.code, 0, shown.out);
  assert.equal(
    shown.out,
    [
      "Budget!A2:D3: 8 cells; results current.",
      "Cell  Formula or input      Result  Shown",
      'A2    "Tickets"                     Tickets',
      "B2    =Inputs!B5*Inputs!B4  4200    €4,200",
      "C2    900                           €900",
      "D2    =B2-C2                3300    €3,300",
      'A3    "Catering"                    Catering',
      "B3    0                             €0",
      "C3    =Inputs!B5*18         2160    €2,160",
      "D3    =B3-C3                -2160   (€2,160)",
      "",
    ].join("\n"),
  );
  assert.equal(
    (await cli("inspect", budget, "--range", "Budget!H1:H2")).out,
    "Budget!H1:H2: 0 cells; results current.\n",
  );
  const json = JSON.parse(
    (await cli("inspect", budget, "--range", "Budget!B2", "--json")).out,
  );
  assert.deepEqual(Object.keys(json), ["sheetId", "sheet", "range", "cells"]);
  assert.equal(json.cells[0].cell.formula, "=Inputs!B5*Inputs!B4");
  // Every value type, a missing result, a style-only cell, control
  // characters and a value past the column width.
  const long = `=${"A1+".repeat(20)}1`;
  assert.equal(
    compactRange(
      {
        sheet: "S",
        range: "A1:A8",
        cells: [
          {
            ref: "A1",
            cell: { input: { type: "text", value: "12" } },
            shown: "12",
          },
          {
            ref: "A2",
            cell: { input: { type: "date", value: 45292 } },
            shown: "01/01/2024",
          },
          {
            ref: "A3",
            cell: { input: { type: "boolean", value: true } },
            shown: "TRUE",
          },
          {
            ref: "A4",
            cell: {
              formula: "=1/0",
              result: { type: "error", value: "#DIV/0!" },
            },
            shown: "#DIV/0!",
          },
          { ref: "A5", cell: { formula: "=A9" }, shown: "" },
          { ref: "A6", cell: { cellStyle: "note" }, shown: "" },
          {
            ref: "A7",
            cell: { input: { type: "text", value: "a\nb" } },
            shown: "a\nb",
          },
          {
            ref: "A8",
            cell: { formula: long, result: { type: "blank" } },
            shown: "",
          },
        ],
      },
      "stale",
    ),
    [
      "S!A1:A8: 8 cells; results stale.",
      "Cell  Formula or input                          Result   Shown",
      'A1    "12"                                               12',
      "A2    45292 (date)                                       01/01/2024",
      "A3    TRUE                                               TRUE",
      "A4    =1/0                                      #DIV/0!  #DIV/0!",
      "A5    =A9                                       (none)",
      "A6    (empty)",
      'A7    "a\\nb"                                             a\\nb',
      `A8    ${long}  (blank)`,
    ].join("\n"),
  );
});
