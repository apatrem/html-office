#!/usr/bin/env node
// Builds the html-text editor (one script) and embeds it in a document as script#engine (T03).
//   node tools/build.mjs <document.html> [<output.html>] [--json]
// Default output: dist/text/<name>.html at the repository root. The document must be valid and
// canonical (check.mjs, pack.mjs). Reports embedded application code, content, assets and total bytes.
import { build, transform } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inlineScript } from "../../../tools/inline-script.mjs";
import {
  bundledPackages,
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

// commonmark's HTML patterns hold "<!--", which an inline script cannot carry. esbuild writes it
// only inside strings and regular expressions, where \x3c is the same character.
// The browser decodes commonmark's character references (editor/clipboard/entities.mjs).
export const ENTITIES = "./packages/text/editor/clipboard/entities.mjs";
export const escapeComments = (code) => code.replaceAll("<!--", "\\x3c!--");

// Licence entries of what esbuild bundled. commonmark declares entities, replaced by the browser's
// decoder (ENTITIES), and minimist, for its command line: neither is in the editor. commonmark's
// and mdurl's licence files separate their notices with "---" lines; each part is an entry, so
// their MIT texts are stored once, like the other packages'.
// cwd: esbuild's working directory, to which the metafile's paths are relative.
export function licenceEntries(metafile, cwd = repo) {
  return packageEntries(bundledPackages([metafile], cwd))
    .filter((e) => !/^(entities|minimist)@/.test(e.label))
    .flatMap((e) =>
      /^(commonmark|mdurl)@/.test(e.label)
        ? e.text
            .split(/^-{3,}[ \t]*$/m)
            .filter((part) => part.trim())
            .map((text) => ({ label: e.label, text }))
        : [e],
    );
}

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
    alias: { entities: ENTITIES },
  });
  // The file embeds the editor, so the editor carries the notices of everything bundled in it (ADR-011 §9).
  const notices = formatNotices(
    groupNotices([
      {
        label: `html-text@${version}/LICENSE`,
        text: await readFile(join(repo, "LICENSE"), "utf8"),
      },
      ...licenceEntries(result.metafile),
    ]),
    {
      title:
        "Licence notices for the html-text editor and the libraries bundled in it.",
    },
  );
  if (/\*\/|\r/.test(notices))
    throw new Error('Notices cannot contain "*/" or a carriage return');
  const code = inlineScript(
    `/*! html-text ${version} — MIT — Copyright (c) 2026 Pierre Supau.\n${notices}*/\n${escapeComments(result.outputFiles[0].text)}`,
    "engine",
  );
  return { version, code, notices, metafile: result.metafile };
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
    assets = size(zone("assets"));
  return {
    total,
    applicationCode: total - content - assets,
    engine: size(zone("engine")),
    content,
    assets,
    ceiling: STANDARD_CODE_CEILING,
  };
}

export async function buildDocument(source, engine) {
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
  const html = await buildDocument(await readFile(input, "utf8"), engine);
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
