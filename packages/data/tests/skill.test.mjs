// T20 packaged html-data skill: the committed skill matches its sources,
// and the plugin archive, extracted where no repository or node_modules
// exist, generates, edits and validates workbooks with Node alone. The
// plugin keeps its html-slides identity and Slides skill.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, cp, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWorkbook } from "../tools/build.mjs";
import { readModel } from "../model/document.mjs";

const run = promisify(execFile),
  repo = fileURLToPath(new URL("../../../", import.meta.url)),
  plugin = join(repo, "plugin");

// The release archive (tools/release.sh zips plugin/), extracted into an
// empty directory; a plain copy where zip is unavailable.
async function extract() {
  const dir = await mkdtemp(join(tmpdir(), "html-office-plugin-")),
    archive = join(dir, "html-slides.plugin"),
    out = join(dir, "plugin");
  try {
    await run("zip", ["-qr", archive, ".", "-x", "*.DS_Store"], {
      cwd: plugin,
    });
    await run("unzip", ["-q", archive, "-d", out]);
  } catch {
    await cp(plugin, out, { recursive: true });
  }
  return { dir, skill: join(out, "skills/html-data") };
}

test("the committed skill matches its sources", async () => {
  const { stdout } = await run(process.execPath, [
    join(repo, "packages/data/tools/skill.mjs"),
    "--check",
  ]);
  assert.match(stdout, /matches its sources/);
});

test("the plugin keeps its identity and the Slides skill", async () => {
  const manifest = JSON.parse(
      await readFile(join(plugin, ".claude-plugin/plugin.json"), "utf8"),
    ),
    root = JSON.parse(await readFile(join(repo, "package.json"), "utf8"));
  assert.equal(manifest.name, "html-slides");
  assert.equal(manifest.version, root.version);
  await access(join(plugin, "skills/html-slides/SKILL.md"));
  const skill = await readFile(
    join(plugin, "skills/html-data/SKILL.md"),
    "utf8",
  );
  assert.match(skill, /^---\nname: html-data\ndescription: /);
  assert.match(skill, /at most two corrective retries/);
  for (const path of [
    "tools/workbook.mjs",
    "assets/runtime.json",
    "assets/THIRD-PARTY-NOTICES.txt",
    "engine/vendor/ironcalc.wasm.gz",
    "references/FORMAT.md",
    "examples/valid/budget.json",
    "examples/invalid/expected.json",
    "examples/patches/invalid/expected.json",
  ])
    await access(join(plugin, "skills/html-data", path));
});

test("the extracted skill generates, edits and validates with Node alone", async () => {
  const { dir, skill } = await extract(),
    tool = join(skill, "tools/workbook.mjs"),
    cli = async (...args) => {
      try {
        const { stdout } = await run(process.execPath, [tool, ...args], {
          cwd: dir,
        });
        return { code: 0, out: stdout };
      } catch (error) {
        return { code: error.code, out: error.stdout + error.stderr };
      }
    },
    example = (path) => join(skill, "examples", path);
  for (const [name, args] of [
    ["budget.html", []],
    ["budget-offline.html", ["--offline"]],
  ]) {
    const made = await cli(
      "new",
      join(dir, name),
      "--model",
      example("valid/budget.json"),
      ...args,
    );
    assert.equal(made.code, 0, made.out);
  }
  const budget = join(dir, "budget.html");
  assert.equal((await cli("validate", budget)).code, 0);
  // The same workbook, editor and engine as a repository build.
  const own = await buildWorkbook(
      readModel(
        await readFile(
          join(repo, "packages/data/examples/valid/budget.json"),
          "utf8",
        ),
      ),
    ),
    normal = (html) =>
      html.replace(/"calculatedAt": *"[^"]*"/g, '"calculatedAt": ""');
  assert.equal(normal(await readFile(budget, "utf8")), normal(own));
  // Invalid examples are refused with their documented errors.
  const invalid = JSON.parse(
    await readFile(example("invalid/expected.json"), "utf8"),
  );
  for (const [file, message] of Object.entries(invalid)) {
    const result = await cli(
      "new",
      join(dir, "refused.html"),
      "--model",
      example(`invalid/${file}`),
    );
    assert.equal(result.code, 1, file);
    assert.ok(result.out.includes(message), `${file}: ${result.out}`);
  }
  // Patch, preservation check, pivots.
  const edited = join(dir, "budget-2.html");
  assert.equal(
    (
      await cli(
        "apply",
        budget,
        example("patches/raise-price.json"),
        "--out",
        edited,
      )
    ).code,
    0,
  );
  assert.equal(
    (
      await cli(
        "validate",
        edited,
        "--since",
        budget,
        "--allow",
        "Inputs!B1,Inputs!B4",
      )
    ).code,
    0,
  );
  const sales = join(dir, "sales.html");
  await cli("new", sales, "--model", example("valid/sales.json"));
  const more = join(dir, "sales-2.html");
  assert.equal(
    (
      await cli(
        "apply",
        sales,
        example("patches/sales-records.json"),
        "--out",
        more,
        "--refresh-pivots",
      )
    ).code,
    0,
  );
  assert.equal((await cli("validate", more)).code, 0);
});
