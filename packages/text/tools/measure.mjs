#!/usr/bin/env node
// Embedded code budget by component (T02): minified browser bundles, as a product build would embed them.
//   node tools/measure.mjs [--write]   (--write updates bench/code-size.json)
// Each ProseMirror package is measured alone with its dependencies; our modules with ProseMirror external.
// "Editor core" is everything together, the floor of the Text standard build before shell, CSS and UI
// (with the T07 paste mapping and Markdown import).
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { inlineScript } from "../../../tools/inline-script.mjs";
import { groupNotices, formatNotices } from "../../shared/notices.mjs";
import { licenceEntries, escapeComments } from "./build.mjs";

// Raised from 500,000 by the user on 28 October 2026 (T07–T13 together come to about 548 KB).
export const STANDARD_CODE_CEILING = 600000;
const root = new URL("../", import.meta.url);
const PACKAGES = [
  "prosemirror-model",
  "prosemirror-transform",
  "prosemirror-state",
  "prosemirror-view",
  "prosemirror-history",
  "prosemirror-keymap",
  "prosemirror-commands",
  "commonmark",
  "prosemirror-tables",
];
const OURS = {
  "HTML tree and serialiser": "./model/html.mjs",
  Validator: "./model/validate.mjs",
  Schema: "./editor/schema/schema.mjs",
  "Parser (tree to document)": "./editor/schema/parse.mjs",
  "Serialiser (document to HTML)": "./editor/schema/serialize.mjs",
  "File layout": "./model/file.mjs",
  "Editing guard": "./editor/schema/guard.mjs",
  "Editing commands": "./editor/commands.mjs",
  "Paste mapping (HTML, tables)": "./editor/clipboard/html.mjs",
  "Markdown import": "./editor/clipboard/markdown.mjs",
  "Table editing": "./editor/tables.mjs",
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
    // As the editor is built: the browser decodes Markdown character references.
    alias: { entities: "./editor/clipboard/entities.mjs" },
  });
  const code = result.outputFiles[0].contents;
  return {
    text: result.outputFiles[0].text,
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
      ...PACKAGES.map(
        (p) => `export * as ${p.replace(/\W/g, "_")} from "${p}";`,
      ),
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
      ...licenceEntries(core.metafile, root.pathname),
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
  // As embedded: notices comment, then the code prepared for an inline <script>.
  const total = Buffer.byteLength(
    inlineScript(
      `/*! html-text\n${notices}*/\n${escapeComments(core.text)}`,
      "core",
    ),
    "utf8",
  );
  return {
    ceiling: STANDARD_CODE_CEILING,
    total,
    headroom: STANDARD_CODE_CEILING - total,
    rows: rows.map(({ metafile, text, ...row }) => row),
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
