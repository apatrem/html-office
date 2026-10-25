#!/usr/bin/env node
// Embedded code budget by component (T02): minified browser bundles, as a product build would embed them.
//   node tools/measure.mjs [--write]   (--write updates bench/code-size.json)
// Each ProseMirror package is measured alone with its dependencies; our modules with ProseMirror external.
// "Editor core" is everything together, the floor of the Text standard build before shell, CSS and UI.
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { readFile, writeFile, mkdir } from "node:fs/promises";

export const STANDARD_CODE_CEILING = 500000;
const root = new URL("../", import.meta.url);
const PACKAGES = [
  "prosemirror-model",
  "prosemirror-transform",
  "prosemirror-state",
  "prosemirror-view",
  "prosemirror-history",
  "prosemirror-keymap",
  "prosemirror-commands",
];
const OURS = {
  "HTML tree and serialiser": "./model/html.mjs",
  Validator: "./model/validate.mjs",
  Schema: "./editor/schema/schema.mjs",
  "Parser (tree to document)": "./editor/schema/parse.mjs",
  "Serialiser (document to HTML)": "./editor/schema/serialize.mjs",
  "File layout": "./model/file.mjs",
};

async function bundle(contents, external = []) {
  const result = await build({
    stdin: { contents, resolveDir: root.pathname, loader: "js" },
    bundle: true,
    write: false,
    minify: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    legalComments: "none",
    external,
  });
  const code = result.outputFiles[0].contents;
  return { bytes: code.length, gzip: gzipSync(code, { level: 9 }).length };
}

export async function measure() {
  const versions = {};
  for (const name of PACKAGES)
    versions[name] = JSON.parse(
      await readFile(new URL(`node_modules/${name}/package.json`, root)),
    ).version;
  const rows = [];
  for (const name of PACKAGES)
    rows.push({
      component: `${name} ${versions[name]}`,
      ...(await bundle(`export * from "${name}";`)),
    });
  for (const [label, path] of Object.entries(OURS))
    rows.push({
      component: label,
      ...(await bundle(`export * from "${path}";`, PACKAGES)),
    });
  const core = await bundle(
    [
      ...PACKAGES.map((p) => `export * as ${p.slice(12)} from "${p}";`),
      ...Object.values(OURS).map((p, i) => `export * as m${i} from "${p}";`),
    ].join("\n"),
  );
  rows.push({
    component: "Editor core (all of the above, shared code once)",
    ...core,
  });
  return {
    ceiling: STANDARD_CODE_CEILING,
    headroom: STANDARD_CODE_CEILING - core.bytes,
    rows,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await measure();
  console.log("| Component | Bytes (minified) | gzip |\n| --- | ---: | ---: |");
  for (const r of result.rows)
    console.log(
      `| ${r.component} | ${r.bytes.toLocaleString("en")} | ${r.gzip.toLocaleString("en")} |`,
    );
  console.log(
    `\nEditor core: ${result.rows.at(-1).bytes.toLocaleString("en")} of ${result.ceiling.toLocaleString("en")} bytes; headroom ${result.headroom.toLocaleString("en")}.`,
  );
  if (process.argv.includes("--write")) {
    await mkdir(new URL("bench/", root), { recursive: true });
    await writeFile(
      new URL("bench/code-size.json", root),
      JSON.stringify(result, null, 2) + "\n",
    );
  }
}
