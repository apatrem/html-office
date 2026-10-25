#!/usr/bin/env node
// Embedded code budget by component (T02): minified browser bundles, as a product build would embed them.
//   node tools/measure.mjs [--write]   (--write updates bench/code-size.json)
// Each ProseMirror package is measured alone with its dependencies; our modules with ProseMirror external.
// "Editor core" is everything together, the floor of the Text standard build before shell, CSS and UI.
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  bundledPackages,
  packageEntries,
  groupNotices,
  formatNotices,
} from "../../shared/notices.mjs";

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
    metafile: true,
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
  return {
    bytes: code.length,
    gzip: gzipSync(code, { level: 9 }).length,
    metafile: result.metafile,
  };
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
  // The file must carry the licence notices of what it embeds (ADR-011 §9): count them too.
  const notices = formatNotices(
    groupNotices([
      {
        label: "html-text/LICENSE",
        text: await readFile(new URL("../../LICENSE", root), "utf8"),
      },
      // esbuild reports inputs relative to the working directory.
      ...packageEntries(bundledPackages([core.metafile])),
    ]),
    { title: "Licence notices" },
  );
  const noticeBytes = Buffer.byteLength(notices, "utf8");
  rows.push(
    {
      component: "Editor core (all of the above, shared code once)",
      bytes: core.bytes,
      gzip: core.gzip,
    },
    {
      component: "Licence notices of the editor core",
      bytes: noticeBytes,
      gzip: gzipSync(notices, { level: 9 }).length,
    },
  );
  const total = core.bytes + noticeBytes;
  return {
    ceiling: STANDARD_CODE_CEILING,
    total,
    headroom: STANDARD_CODE_CEILING - total,
    rows: rows.map(({ metafile, ...row }) => row),
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
    `\nEditor core with notices: ${result.total.toLocaleString("en")} of ${result.ceiling.toLocaleString("en")} bytes; headroom ${result.headroom.toLocaleString("en")}. Bare minified bundles; tools/build.mjs (T03) measures the built file.`,
  );
  if (process.argv.includes("--write")) {
    await mkdir(new URL("bench/", root), { recursive: true });
    await writeFile(
      new URL("bench/code-size.json", root),
      JSON.stringify(result, null, 2) + "\n",
    );
  }
}
