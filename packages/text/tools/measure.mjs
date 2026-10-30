#!/usr/bin/env node
// Embedded code budget by component (T02, T17): the built file's application code, split by what
// it embeds. The editor is built exactly as tools/build.mjs builds it (one minified script) and
// esbuild's metafile attributes each output byte to its source file; the rest of the script
// (module scaffolding, licence notices, inline-script escaping) and of the file's code (theme
// styles, HTML skeleton) are rows of their own, so the rows add up to the measured total.
//   node tools/measure.mjs [--write]   (--write updates bench/code-size.json)
import { gzipSync } from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEngine, buildDocument, measureFile } from "./build.mjs";
import { parseFile } from "../model/parse.mjs";

// Raised from 500,000 by the user on 28 October 2026 (T07–T13 together come to about 548 KB).
export const STANDARD_CODE_CEILING = 600000;
const pkg = resolve(fileURLToPath(import.meta.url), "../..");
const repo = resolve(pkg, "../..");
// The document measured: the compact example, as T03 and later tasks reported it.
const EXAMPLE = join(pkg, "fixtures/valid/example.html");

// ProseMirror's own small dependencies, and commonmark's, are counted with their parent.
const WITH = {
  orderedmap: "prosemirror-model",
  "rope-sequence": "prosemirror-history",
  "w3c-keyname": "prosemirror-keymap",
  mdurl: "commonmark",
};
// Source paths (relative to the repository) to components, first match wins.
const OURS = [
  [/\.css$/, "CSS: shell, panels and editor styles"],
  [/^src\/format\.js$/, "Slides format vocabulary (theme CSS checks)"],
  [/^packages\/text\/model\//, "Text model: HTML tree, file layout, validator"],
  [
    /^packages\/text\/editor\/schema\//,
    "Schema, parser, serialiser, editing guard",
  ],
  [/^packages\/text\/editor\/clipboard\//, "Paste mapping and Markdown import"],
  [
    /^packages\/text\/editor\//,
    "Editing: commands, numbering, footnotes, tables, figures, comments, Markdown projection",
  ],
  [
    /^packages\/text\/runtime\//,
    "Editor UI: shell, saving, print, figures, comments",
  ],
  [/^packages\/text\/theme\//, "Text theme"],
  [/^packages\/shared\/([^/.]+)/, (m) => `Shared: ${m[1]}`],
];

async function componentOf(path, versions) {
  const dep = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(path);
  if (dep) {
    const name = WITH[dep[1]] ?? dep[1];
    const dir = path.slice(0, dep.index + dep[0].length - dep[1].length - 1);
    versions[name] ??= JSON.parse(
      await readFile(join(repo, dir, name, "package.json"), "utf8"),
    ).version;
    return `${name} ${versions[name]}`;
  }
  for (const [pattern, label] of OURS) {
    const m = pattern.exec(path);
    if (m) return typeof label === "function" ? label(m) : label;
  }
  throw new Error(`No component for ${path}`);
}

const bytes = (s) => Buffer.byteLength(s, "utf8");

export async function measure() {
  const engine = await buildEngine();
  const html = await buildDocument(await readFile(EXAMPLE, "utf8"), engine);
  const file = measureFile(html);
  const [output] = Object.values(engine.metafile.outputs);
  const sums = new Map(),
    versions = {};
  let attributed = 0;
  for (const [path, { bytesInOutput }] of Object.entries(output.inputs)) {
    const name = await componentOf(path, versions);
    sums.set(name, (sums.get(name) ?? 0) + bytesInOutput);
    attributed += bytesInOutput;
  }
  const libraries = [...sums].filter(([name]) => /\d+\.\d+\.\d+$/.test(name));
  const ours = [...sums].filter(([name]) => !/\d+\.\d+\.\d+$/.test(name));
  // The script's text: a banner comment holding the notices, then the escaped bundle.
  const comment = engine.code.slice(0, engine.code.indexOf("*/\n") + 3);
  const head = parseFile(html).html.children.find((n) => n.name === "head");
  const styles = head.children
    .filter((n) => n.name === "style")
    .reduce((sum, n) => sum + bytes(html.slice(n.loc.offset, n.loc.end)), 0);
  const rows = [
    ...libraries.sort((a, b) => b[1] - a[1]),
    ...ours.sort((a, b) => b[1] - a[1]),
    ["Bundle scaffolding (esbuild module wrappers)", output.bytes - attributed],
    ["Licence notices and banner", bytes(comment)],
    [
      "Inline-script escaping and the script element",
      file.engine - bytes(comment) - output.bytes,
    ],
    ["Document theme styles (style#charte, style#theme)", styles],
    [
      "HTML skeleton (head, metadata, zones)",
      file.applicationCode - file.engine - styles,
    ],
  ].map(([component, n]) => ({
    component,
    bytes: n,
    share: Math.round((n / STANDARD_CODE_CEILING) * 1000) / 10,
  }));
  const total = rows.reduce((sum, r) => sum + r.bytes, 0);
  if (total !== file.applicationCode)
    throw new Error(
      `Components add up to ${total}, the file's code is ${file.applicationCode}`,
    );
  return {
    ceiling: STANDARD_CODE_CEILING,
    document: "fixtures/valid/example.html",
    applicationCode: file.applicationCode,
    headroom: STANDARD_CODE_CEILING - file.applicationCode,
    engineGzip: gzipSync(engine.code, { level: 9 }).length,
    file: {
      total: file.total,
      engine: file.engine,
      content: file.content,
      assets: file.assets,
    },
    rows,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await measure();
  console.log(
    "| Component | Bytes | Share of the ceiling |\n| --- | ---: | ---: |",
  );
  for (const r of result.rows)
    console.log(
      `| ${r.component} | ${r.bytes.toLocaleString("en")} | ${r.share}% |`,
    );
  console.log(
    `\nApplication code of the built example: ${result.applicationCode.toLocaleString("en")} of ${result.ceiling.toLocaleString("en")} bytes; headroom ${result.headroom.toLocaleString("en")}. The editor script is ${result.engineGzip.toLocaleString("en")} bytes gzipped.`,
  );
  if (process.argv.includes("--write"))
    await writeFile(
      join(pkg, "bench/code-size.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
  if (result.applicationCode >= result.ceiling) process.exit(1);
}
