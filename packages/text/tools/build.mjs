#!/usr/bin/env node
// Builds the html-text editor (one script) and embeds it in a document as script#engine (T03).
//   node tools/build.mjs <document.html> [<output.html>] [--json] [--offline]
// --offline also embeds the pinned, integrity-checked ECharts as script#echarts (T11), so charts
// draw with no network; it is reported apart from the application code.
// Default output: dist/text/<name>.html at the repository root. The document must be valid and
// canonical (check.mjs, pack.mjs). Reports embedded application code, content, assets and total bytes.
import { build, transform } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inlineScript } from "../../../tools/inline-script.mjs";
import { verifyECharts } from "../../../tools/echarts-integrity.mjs";
import {
  bundledPackages,
  packageAt,
  packageEntries,
  groupNotices,
  formatNotices,
} from "../../shared/notices.mjs";
import { parseFile } from "../model/parse.mjs";
import { element, text, attr } from "../model/html.mjs";
import { canonicalize, findArticle } from "../editor/schema/document.mjs";
import { serializeFile } from "../model/file.mjs";
import { articleHTML } from "../editor/schema/serialize.mjs";
import { STANDARD_CODE_CEILING } from "./measure.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const repo = resolve(pkg, "../..");

// Stylesheets imported by the runtime are embedded as minified text.
const cssText = {
  name: "css-text",
  setup: (b) =>
    b.onLoad({ filter: /\.css$/ }, async (a) => ({
      loader: "text",
      contents: (
        await transform(await readFile(a.path, "utf8"), {
          loader: "css",
          minify: true,
        })
      ).code,
    })),
};

export async function buildEngine() {
  const version = JSON.parse(
    await readFile(join(pkg, "package.json"), "utf8"),
  ).version;
  const result = await build({
    entryPoints: [join(pkg, "runtime/main.mjs")],
    bundle: true,
    minify: true,
    format: "iife",
    plugins: [cssText],
    target: ["chrome110", "edge110", "safari16", "firefox115"],
    write: false,
    legalComments: "none",
    metafile: true,
    absWorkingDir: repo,
  });
  // The file embeds the editor, so the editor carries the notices of everything bundled in it (ADR-011 §9).
  const notices = formatNotices(
    groupNotices([
      {
        label: `html-text@${version}/LICENSE`,
        text: await readFile(join(repo, "LICENSE"), "utf8"),
      },
      ...packageEntries(bundledPackages([result.metafile], repo)),
    ]),
    {
      title:
        "Licence notices for the html-text editor and the libraries bundled in it.",
    },
  );
  if (/\*\/|\r/.test(notices))
    throw new Error('Notices cannot contain "*/" or a carriage return');
  const code = inlineScript(
    `/*! html-text ${version} — MIT — Copyright (c) 2026 Pierre Supau.\n${notices}*/\n${result.outputFiles[0].text}`,
    "engine",
  );
  return { version, code, notices, metafile: result.metafile };
}

// ECharts for the offline build: the pinned bytes, checked against the approved SRI digest, with
// its licence notices, as the text of script#echarts.
export async function embeddedECharts() {
  const dir = join(repo, "node_modules/echarts");
  const file = join(dir, "dist/echarts.min.js");
  const code = await readFile(file);
  verifyECharts(
    code,
    JSON.parse(await readFile(join(dir, "package.json"), "utf8")).version,
  );
  const notices = formatNotices(
    groupNotices(packageEntries([packageAt(dir, [file])])),
    { title: "Licence notices for ECharts, embedded for offline use." },
  );
  if (/\*\/|\r/.test(notices))
    throw new Error('Notices cannot contain "*/" or a carriage return');
  return inlineScript(`/*!\n${notices}*/\n${code.toString("utf8")}`, "echarts");
}

const bytes = (s) => Buffer.byteLength(s, "utf8");

// Byte counts (UTF-8) of a built file by zone. Application code is everything except content and assets.
export function measureFile(html) {
  const file = parseFile(html);
  const body = file.html.children.find((n) => n.name === "body");
  const zone = (id) =>
    body.children.find((n) => n.type === "element" && attr(n, "id") === id);
  // parse5 offsets count UTF-16 code units: slice, then count UTF-8 bytes.
  const size = (node) =>
    node ? bytes(html.slice(node.loc.offset, node.loc.end)) : 0;
  const total = bytes(html),
    content = size(findArticle(file)),
    assets = size(zone("assets")),
    echarts = size(zone("echarts"));
  return {
    total,
    applicationCode: total - content - assets - echarts,
    engine: size(zone("engine")),
    content,
    assets,
    echarts,
    ceiling: STANDARD_CODE_CEILING,
  };
}

// echarts: embeddedECharts() for the offline build.
export async function buildDocument(source, engine, { echarts = null } = {}) {
  const { file, doc, difference } = canonicalize(source, parseFile);
  if (difference)
    throw new Error(
      `The document is not in canonical form at ${difference.line}:${difference.col}: run pack.mjs first`,
    );
  const body = file.html.children.find((n) => n.name === "body");
  const script = element(
    "script",
    [
      ["id", "engine"],
      ["data-version", engine.version],
    ],
    [text(engine.code)],
  );
  const at = body.children.findIndex(
    (n) => n.type === "element" && attr(n, "id") === "engine",
  );
  if (at >= 0) body.children[at] = script;
  else body.children.push(script);
  // The offline library runs before the editor, which then finds window.echarts.
  const old = body.children.findIndex(
    (n) => n.type === "element" && attr(n, "id") === "echarts",
  );
  if (old >= 0) body.children.splice(old, 1);
  if (echarts)
    body.children.splice(
      body.children.indexOf(script),
      0,
      element("script", [["id", "echarts"]], [text(echarts)]),
    );
  return serializeFile(file, articleHTML(doc));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const [input, output] = args.filter((a) => !a.startsWith("--"));
  if (!input) {
    console.error("usage: build.mjs <document.html> [<output.html>] [--json]");
    process.exit(2);
  }
  const engine = await buildEngine();
  const html = await buildDocument(await readFile(input, "utf8"), engine, {
    echarts: args.includes("--offline") ? await embeddedECharts() : null,
  });
  const target = output ?? join(repo, "dist/text", basename(input));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, html);
  const sizes = measureFile(html);
  if (args.includes("--json")) console.log(JSON.stringify(sizes, null, 2));
  else {
    for (const [k, v] of Object.entries(sizes))
      console.log(`${k.padEnd(16)} ${v.toLocaleString("en").padStart(10)}`);
    console.log(
      `headroom         ${(sizes.ceiling - sizes.applicationCode).toLocaleString("en").padStart(10)}`,
    );
    console.log(`wrote ${target}`);
  }
  if (sizes.applicationCode > sizes.ceiling) process.exit(1);
}
