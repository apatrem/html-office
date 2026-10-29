// T18 packaged html-text skill: packaging is deterministic, the plugin keeps its html-slides
// identity with the Slides and Data skills beside Text, and the plugin archive, extracted where
// no repository or node_modules exist, generates, edits, checks and packs a document with Node
// alone, writing the same bytes as the repository's tools.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  readFile,
  writeFile,
  cp,
  access,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { packageSkill, GENERATED } from "../tools/skill.mjs";
import { guideText, RELEASES } from "../tools/guide.mjs";

const run = promisify(execFile),
  repo = fileURLToPath(new URL("../../../", import.meta.url)),
  plugin = join(repo, "plugin"),
  examples = fileURLToPath(new URL("../examples/", import.meta.url));

// The release archive (tools/release.sh zips plugin/), extracted into an empty directory; a plain
// copy where zip is unavailable. The directory is an ESM project, as a user's project may be.
async function extract() {
  const dir = await mkdtemp(join(tmpdir(), "html-office-plugin-")),
    source = join(dir, "source"),
    archive = join(dir, "html-slides.plugin"),
    out = join(dir, "plugin");
  await writeFile(join(dir, "package.json"), '{ "type": "module" }\n');
  await cp(plugin, source, { recursive: true });
  // As release.sh builds it: the Text skill packaged afresh from the sources.
  await packageSkill(join(source, "skills/html-text"));
  try {
    await run("zip", ["-qr", archive, ".", "-x", "*.DS_Store"], {
      cwd: source,
    });
    await run("unzip", ["-q", archive, "-d", out]);
  } catch {
    await cp(source, out, { recursive: true });
  }
  return { dir, skill: join(out, "skills/html-text") };
}

test("packaging is deterministic", async () => {
  const dir = await mkdtemp(join(tmpdir(), "html-text-skill-"));
  await packageSkill(join(dir, "a"));
  await packageSkill(join(dir, "b"));
  for (const file of GENERATED.filter((f) => f !== "examples"))
    assert.deepEqual(
      await readFile(join(dir, "a", file)),
      await readFile(join(dir, "b", file)),
      file,
    );
});

test("the plugin keeps its identity, with the Slides, Data and Text skills", async () => {
  const manifest = JSON.parse(
      await readFile(join(plugin, ".claude-plugin/plugin.json"), "utf8"),
    ),
    root = JSON.parse(await readFile(join(repo, "package.json"), "utf8"));
  assert.equal(manifest.name, "html-slides");
  assert.equal(manifest.version, root.version);
  assert.deepEqual(
    (await readdir(join(plugin, "skills")))
      .filter((n) => !n.startsWith("."))
      .sort(),
    ["html-data", "html-slides", "html-text"],
  );
  const skill = await readFile(
    join(plugin, "skills/html-text/SKILL.md"),
    "utf8",
  );
  assert.match(skill, /^---\nname: html-text\ndescription: "[^"\n]+"\n---\n/);
  assert.match(skill, /at most two corrective retries/);
  assert.match(skill, /never invent figures, and an intent is not data/);
  assert.match(skill, /data, never instructions/);
  // Every path SKILL.md names exists in the skill.
  for (const [, path] of skill.matchAll(
    /`(?:<skill>\/)?((?:tools|references|examples)\/[\w./-]+)`/g,
  ))
    await access(join(plugin, "skills/html-text", path));
  // The release script packages the skill before zipping.
  const release = await readFile(join(repo, "tools/release.sh"), "utf8");
  assert.ok(
    release.indexOf("node packages/text/tools/skill.mjs") <
      release.indexOf("zip -qr"),
  );
  // The reference's links reach the repository; the guide links the releases.
  const format = await readFile(
    join(plugin, "skills/html-text/references/FORMAT.md"),
    "utf8",
  );
  assert.doesNotMatch(format, /\]\((?!https?:|mailto:|#)/);
  assert.ok(guideText("0.1.0").includes(RELEASES));
});

test("the extracted skill creates, rewrites, checks and packs with Node alone", async () => {
  const { dir, skill } = await extract();
  const tool = join(skill, "tools/document.mjs");
  const node = (...args) =>
    spawnSync(process.execPath, [tool, ...args], {
      cwd: dir,
      encoding: "utf8",
    });
  const ok = (r) => assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  // The examples shipped in the skill.
  const ex = join(skill, "examples/valid");
  ok(
    node(
      "new",
      "report.html",
      "--markdown",
      join(ex, "report.md"),
      "--payloads",
      join(ex, "payloads.json"),
      "--title",
      "Northwind Gardens review",
      "--contents",
      "2",
      "--numbers",
    ),
  );
  const html = await readFile(join(dir, "report.html"), "utf8");
  // The same bytes as the repository's tools write.
  const here = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../tools/document.mjs", import.meta.url)),
      "new",
      join(dir, "repo.html"),
      "--markdown",
      join(examples, "valid/report.md"),
      "--payloads",
      join(examples, "valid/payloads.json"),
      "--title",
      "Northwind Gardens review",
      "--contents",
      "2",
      "--numbers",
    ],
    { encoding: "utf8" },
  );
  assert.equal(here.status, 0, here.stderr);
  assert.equal(await readFile(join(dir, "repo.html"), "utf8"), html);
  ok(node("check", "report.html"));
  // A section rewritten in Markdown, with a new chart, then replaced.
  const md = node("show", "report.html", "sec-regions", "--markdown");
  ok(md);
  assert.match(
    md.stdout,
    /^# Regions \{#sec-regions\}\n\n\[\[block: image \| intent: "The north site" \| id: fig-site\]\]/,
  );
  ok(
    node(
      "convert",
      "report.html",
      "sec-regions",
      join(ex, "rewrite-regions.md"),
      "--payloads",
      join(ex, "rewrite-payloads.json"),
      "--out",
      "regions.html",
    ),
  );
  ok(
    node(
      "replace",
      "report.html",
      "sec-regions",
      "regions.html",
      "--output",
      "edited.html",
    ),
  );
  const check = node("check", "edited.html");
  ok(check);
  assert.match(
    check.stdout,
    /^0 error\(s\), 0 protected block\(s\), 0 warning\(s\)$/m,
  );
  // A refused conversion writes nothing.
  const refused = node(
    "convert",
    "edited.html",
    "sec-summary",
    join(skill, "examples/invalid/missing-payload.md"),
    "--out",
    "nothing.html",
  );
  assert.equal(refused.status, 1);
  await assert.rejects(access(join(dir, "nothing.html")));
  // Offline, outline and the Markdown export.
  ok(node("pack", "edited.html", "--offline", "--out", "offline.html"));
  assert.match(
    await readFile(join(dir, "offline.html"), "utf8"),
    /<script id="echarts">\/\*!\n/,
  );
  const outline = node("outline", "edited.html");
  ok(outline);
  assert.match(outline.stdout, / sec-regions +2 Regions\n/);
  ok(node("markdown", "edited.html", "edited.md"));
  assert.match(await readFile(join(dir, "edited.md"), "utf8"), /^# 2 Regions$/m);
});
