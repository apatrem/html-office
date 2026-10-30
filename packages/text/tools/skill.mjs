// Packages the html-text skill (T18) into plugin/skills/html-text: the document tools bundled
// into one Node script with no dependency, the built editor, the pinned ECharts with its
// notices, the default charte and layout theme, the format reference and the examples.
// SKILL.md is written by hand and kept. As packages/data/tools/skill.mjs does for Data.
// Usage: node packages/text/tools/skill.mjs [--check]
//   --check compares a fresh build with the committed files and fails when they differ.
//   tools/release.sh packages the skill before zipping, so a release always carries the
//   current sources; CI tests a fresh package rather than the committed copy, which other
//   Text work may outdate.
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
import { join, relative, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { buildEngine, echartsNotices } from "./build.mjs";
import { echartsBytes } from "./previews.mjs";

const text = fileURLToPath(new URL("../", import.meta.url)),
  repo = join(text, "../.."),
  skill = join(repo, "plugin/skills/html-text"),
  REPOSITORY = "https://github.com/apatrem/html-office";
// Generated paths inside the skill; everything else (SKILL.md) is by hand.
export const GENERATED = [
  "tools/document.mjs",
  "assets/engine.json",
  "assets/echarts.min.js",
  "assets/echarts-notices.txt",
  "assets/default.css",
  "assets/layout.css",
  "assets/THIRD-PARTY-NOTICES.txt",
  "references/FORMAT.md",
  "examples",
];

// FORMAT.md's relative links point into the repository: absolute in the skill.
export function absoluteLinks(markdown, from) {
  return markdown.replace(/\]\((?!https?:|mailto:|#)([^)]+)\)/g, (_, link) => {
    const [path, hash] = link.split("#"),
      target = relative(repo, join(from, path)).split("\\").join("/");
    return `](${REPOSITORY}/blob/main/${target}${hash ? `#${hash}` : ""})`;
  });
}

// The command lines inlined in the bundle test import.meta.url to know whether they run as the
// main script; in one bundle every module would. They get a URL of their own. esbuild and the
// licence notices (which read the licence texts when loaded) serve only the repository's build:
// the skill ships the built editor and its notices, and gets stubs that say so.
const STUBS = {
  esbuild: ["build", "transform"],
  notices: [
    "bundledPackages",
    "packageAt",
    "packageEntries",
    "groupNotices",
    "formatNotices",
  ],
};
const CLI = /\/tools\/(build|check|measure|pack|sections|markdown)\.mjs$/;
const skillBundle = {
  name: "html-text-skill",
  setup(b) {
    b.onResolve({ filter: /^esbuild$/ }, () => ({
      path: "esbuild",
      namespace: "stub",
    }));
    b.onResolve({ filter: /\/shared\/notices\.mjs$/ }, () => ({
      path: "notices",
      namespace: "stub",
    }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({
      contents: `const missing = () => { throw new Error("The skill does not build the editor: it ships assets/engine.json and its notices."); };\nexport const ${STUBS[a.path].map((n) => `${n} = missing`).join(", ")};`,
      loader: "js",
    }));
    b.onLoad({ filter: CLI }, async (a) => ({
      contents: (await readFile(a.path, "utf8")).replaceAll(
        "import.meta.url",
        JSON.stringify(`file:///html-text-skill/${basename(a.path)}`),
      ),
      loader: "js",
    }));
  },
};

export async function packageSkill(out) {
  const { build } = await import("esbuild");
  await mkdir(join(out, "tools"), { recursive: true });
  await build({
    entryPoints: [join(text, "tools/document.mjs")],
    outfile: join(out, "tools/document.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node18",
    minify: true,
    legalComments: "eof",
    plugins: [skillBundle],
    absWorkingDir: repo,
    banner: {
      js: "// html-text document tools (bundled; source: packages/text/tools/document.mjs in https://github.com/apatrem/html-office). MIT.",
    },
  });
  await mkdir(join(out, "assets"), { recursive: true });
  const engine = await buildEngine();
  await writeFile(
    join(out, "assets/engine.json"),
    JSON.stringify({ version: engine.version, code: engine.code }) + "\n",
  );
  const { bytes } = await echartsBytes();
  await writeFile(join(out, "assets/echarts.min.js"), bytes);
  const echarts = echartsNotices();
  await writeFile(join(out, "assets/echarts-notices.txt"), echarts);
  // What every document embeds, readable without opening one.
  await writeFile(
    join(out, "assets/THIRD-PARTY-NOTICES.txt"),
    `${engine.notices}\n${echarts}`,
  );
  await cp(
    join(repo, "src/theme/default.css"),
    join(out, "assets/default.css"),
  );
  await cp(join(text, "theme/layout.css"), join(out, "assets/layout.css"));
  await mkdir(join(out, "references"), { recursive: true });
  await writeFile(
    join(out, "references/FORMAT.md"),
    absoluteLinks(await readFile(join(text, "FORMAT.md"), "utf8"), text),
  );
  await rm(join(out, "examples"), { recursive: true, force: true });
  await cp(join(text, "examples"), join(out, "examples"), { recursive: true });
}

// Every generated file with its digest, for --check.
async function digests(root) {
  const found = {};
  const hash = async (file) =>
    createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) await walk(full);
      else found[relative(root, full)] = await hash(full);
    }
  }
  for (const item of GENERATED) {
    const full = join(root, item),
      info = await stat(full).catch(() => null);
    if (!info) found[item] = "missing";
    else if (info.isDirectory()) await walk(full);
    else found[item] = await hash(full);
  }
  return found;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.includes("--check")) {
    const fresh = await mkdtemp(join(tmpdir(), "html-text-skill-"));
    await packageSkill(fresh);
    const want = await digests(fresh),
      have = await digests(skill),
      stale = [...new Set([...Object.keys(want), ...Object.keys(have)])].filter(
        (file) => want[file] !== have[file],
      );
    await rm(fresh, { recursive: true, force: true });
    if (stale.length) {
      console.error(
        `plugin/skills/html-text is out of date (${stale.join(", ")}): run node packages/text/tools/skill.mjs`,
      );
      process.exit(1);
    }
    console.log("plugin/skills/html-text matches its sources.");
  } else {
    await packageSkill(skill);
    console.log(`Packaged ${relative(repo, skill)}.`);
  }
}
