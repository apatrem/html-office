// Packages the html-data skill (T20) into plugin/skills/html-data: the
// document tools bundled into one Node script with no dependency, the
// precompiled editor runtime, the pinned engine and ECharts, the format
// reference and the examples. SKILL.md is written by hand and kept.
// Usage: node packages/data/tools/skill.mjs [--check]
//   --check compares a fresh build with the committed files and fails when
//   they differ. tools/release.sh packages the skill before zipping, so a
//   release always carries the current sources; CI tests a fresh package
//   rather than the committed copy, which other Data work may outdate.
import {
  readFile,
  writeFile,
  mkdir,
  cp,
  rm,
  readdir,
  mkdtemp,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { compileRuntime } from "./build.mjs";

const data = fileURLToPath(new URL("../", import.meta.url)),
  repo = join(data, "../.."),
  skill = join(repo, "plugin/skills/html-data"),
  REPOSITORY = "https://github.com/apatrem/html-office";
// Generated paths inside the skill; everything else (SKILL.md) is by hand.
export const GENERATED = [
  "tools/workbook.mjs",
  "assets/runtime.json",
  "assets/echarts.min.js",
  "assets/default.css",
  "assets/THIRD-PARTY-NOTICES.txt",
  "engine/manifest.json",
  "engine/vendor/ironcalc.mjs",
  "engine/vendor/ironcalc.wasm.gz",
  "vendor/xlsx/xlsx.mini.min.js",
  "vendor/xlsx/package.json",
  "vendor/xlsx/LICENSE",
  "references/FORMAT.md",
  "examples",
];

// FORMAT.md's relative links point into the repository: absolute in the
// skill, where the repository is absent.
export function absoluteLinks(markdown, from) {
  return markdown.replace(/\]\((?!https?:|mailto:|#)([^)]+)\)/g, (_, link) => {
    const [path, hash] = link.split("#"),
      target = relative(repo, join(from, path)).split("\\").join("/");
    return `](${REPOSITORY}/blob/main/${target}${hash ? `#${hash}` : ""})`;
  });
}

export async function packageSkill(out) {
  const { build } = await import("esbuild");
  await mkdir(join(out, "tools"), { recursive: true });
  await build({
    entryPoints: [join(data, "tools/workbook.mjs")],
    outfile: join(out, "tools/workbook.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node18",
    minify: true,
    legalComments: "eof",
    // Only reached from the repository, never in the skill.
    external: ["esbuild"],
    banner: {
      js: "// html-data document tools (bundled; source: packages/data/tools/workbook.mjs in https://github.com/apatrem/html-office). MIT.",
    },
  });
  await mkdir(join(out, "assets"), { recursive: true });
  const runtime = await compileRuntime();
  await writeFile(
    join(out, "assets/runtime.json"),
    JSON.stringify(runtime) + "\n",
  );
  // The notices every workbook embeds (IronCalc and its Rust crates, the
  // bundled npm packages, ECharts), readable without opening a workbook.
  await writeFile(join(out, "assets/THIRD-PARTY-NOTICES.txt"), runtime.notices);
  await cp(
    join(repo, "node_modules/echarts/dist/echarts.min.js"),
    join(out, "assets/echarts.min.js"),
  );
  await cp(
    join(repo, "plugin/skills/html-slides/assets/default.css"),
    join(out, "assets/default.css"),
  );
  await mkdir(join(out, "engine/vendor"), { recursive: true });
  for (const file of [
    "manifest.json",
    "vendor/ironcalc.mjs",
    "vendor/ironcalc.wasm.gz",
  ])
    await cp(join(data, "engine", file), join(out, "engine", file));
  // The pinned SheetJS reader (T15), which offline workbooks embed for XLSX
  // import; checked against its digest before each build.
  await mkdir(join(out, "vendor/xlsx"), { recursive: true });
  for (const file of ["xlsx.mini.min.js", "package.json", "LICENSE"])
    await cp(join(data, "vendor/xlsx", file), join(out, "vendor/xlsx", file));
  await mkdir(join(out, "references"), { recursive: true });
  await writeFile(
    join(out, "references/FORMAT.md"),
    absoluteLinks(
      await readFile(join(data, "model/FORMAT.md"), "utf8"),
      join(data, "model"),
    ),
  );
  await rm(join(out, "examples"), { recursive: true, force: true });
  await cp(join(data, "examples"), join(out, "examples"), { recursive: true });
}

// Every generated file with its digest, for --check.
async function digests(root) {
  const found = {};
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) await walk(full);
      else
        found[relative(root, full)] = createHash("sha256")
          .update(await readFile(full))
          .digest("hex");
    }
  }
  for (const item of GENERATED) {
    const full = join(root, item),
      info = await stat(full).catch(() => null);
    if (!info) found[item] = "missing";
    else if (info.isDirectory()) await walk(full);
    else
      found[item] = createHash("sha256")
        .update(await readFile(full))
        .digest("hex");
  }
  return found;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.includes("--check")) {
    const fresh = await mkdtemp(join(tmpdir(), "html-data-skill-"));
    await packageSkill(fresh);
    const want = await digests(fresh),
      have = await digests(skill),
      stale = [...new Set([...Object.keys(want), ...Object.keys(have)])].filter(
        (file) => want[file] !== have[file],
      );
    await rm(fresh, { recursive: true, force: true });
    if (stale.length) {
      console.error(
        `plugin/skills/html-data is out of date (${stale.join(", ")}): run node packages/data/tools/skill.mjs`,
      );
      process.exit(1);
    }
    console.log("plugin/skills/html-data matches its sources.");
  } else {
    await packageSkill(skill);
    console.log(`Packaged ${relative(repo, skill)}.`);
  }
}
