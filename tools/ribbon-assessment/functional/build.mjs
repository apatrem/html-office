import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { build } from "esbuild";
import { transform } from "@svgr/core";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as icons from "lucide-react";
import {
  buildWorkbook,
  measureHTML,
} from "../../../packages/data/tools/build.mjs";
import { pnl } from "../../../packages/data/fixtures/generate.mjs";
import {
  patchToolbar,
  patchMenu,
  patchFormats,
  replaceOnce,
} from "./patches.mjs";
// This folder is three levels below the repository root.
const here = dirname(fileURLToPath(import.meta.url)),
  repo = resolve(here, "../../..");
const revision = "297553dc3a37ec6b0f4821055220e3d26c4ac6a1";
const argument = (name) => process.argv[process.argv.indexOf(name) + 1];
if (!process.argv.includes("--source"))
  throw new Error("Supply --source PATH to the pinned IronCalc checkout");
const out = resolve(repo, "dist/toolbar-functional"),
  source = resolve(out, "source");
await mkdir(out, { recursive: true });
await rm(source, { recursive: true, force: true });
await mkdir(source, { recursive: true });
const archive = execFileSync(
  "git",
  [
    "archive",
    revision,
    "webapp/IronCalc/src",
    "bindings/wasm/types.ts",
    "LICENSE-MIT",
    "base/src/colors.rs",
  ],
  { cwd: resolve(argument("--source")), maxBuffer: 20_000_000 },
);
execFileSync("tar", ["-x", "-C", source], { input: archive });
const upstream = resolve(source, "webapp/IronCalc/src");
const helper = resolve(out, "helpers.ts");
await writeFile(
  helper,
  `export * from ${JSON.stringify(resolve(source, "bindings/wasm/types.ts"))};export * from ${JSON.stringify(resolve(here, "ui-helpers.mjs"))};`,
);
const alias = {
  "pinned-toolbar": resolve(upstream, "components/Toolbar/Toolbar.tsx"),
  "pinned-english": resolve(upstream, "locale/en_us.json"),
  "pinned-theme": resolve(upstream, "theme/theme.css"),
  "@ironcalc/wasm": helper,
};
const patched = [];
const common = {
  bundle: true,
  minify: true,
  write: false,
  platform: "browser",
  target: "es2022",
  legalComments: "eof",
};
const toolbar = await build({
  ...common,
  entryPoints: [resolve(here, "upstream-entry.jsx")],
  outfile: resolve(out, "toolbar.js"),
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  nodePaths: [resolve(here, "../node_modules")],
  metafile: true,
  plugins: [
    {
      name: "pinned-toolbar",
      setup(b) {
        b.onResolve({ filter: /^(pinned-|@ironcalc\/wasm)/ }, (args) => ({
          path: alias[args.path],
        }));
        b.onResolve({ filter: /\.svg\?react$/ }, (args) => ({
          path: resolve(args.resolveDir, args.path.replace(/\?react$/, "")),
          namespace: "svg",
        }));
        b.onLoad({ filter: /.*/, namespace: "svg" }, async (args) => ({
          contents: await transform(
            await readFile(args.path, "utf8"),
            { plugins: ["@svgr/plugin-jsx"], jsxRuntime: "automatic" },
            { componentName: "Icon" },
          ),
          loader: "jsx",
          resolveDir: dirname(args.path),
        }));
        b.onLoad(
          {
            filter:
              /(Toolbar\/Toolbar|Menu\/Menu|FormatMenu\/FormatMenu)\.tsx$/,
          },
          async (args) => {
            const original = await readFile(args.path, "utf8");
            const contents = args.path.endsWith("/Toolbar/Toolbar.tsx")
              ? patchToolbar(original)
              : args.path.endsWith("/Menu/Menu.tsx")
                ? patchMenu(original)
                : patchFormats(original);
            const adapted = resolve(out, args.path.split("/").at(-1));
            await writeFile(adapted, contents);
            const diff = spawnSync(
              "git",
              ["diff", "--no-index", "--numstat", args.path, adapted],
              { encoding: "utf8" },
            );
            if (![0, 1].includes(diff.status)) throw new Error(diff.stderr);
            const [added, removed] = diff.stdout.split("\t").map(Number);
            patched.push({
              file: args.path.slice(upstream.length + 1),
              added,
              removed,
            });
            return { contents, loader: "tsx", resolveDir: dirname(args.path) };
          },
        );
      },
    },
  ],
});
const js = toolbar.outputFiles.find((f) => f.path.endsWith(".js")).contents,
  css = toolbar.outputFiles.find((f) => f.path.endsWith(".css")).contents;
const vendor = resolve(here, "../vendor");
await mkdir(vendor, { recursive: true });
await writeFile(resolve(vendor, "toolbar.js"), js);
await writeFile(resolve(vendor, "toolbar.css"), css);
const packages = [
  ...new Set(
    Object.keys(toolbar.metafile.inputs)
      .map((p) => /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(p)?.[1])
      .filter(Boolean),
  ),
].sort();
let notices =
  "IronCalc toolbar assessment, source " +
  revision +
  "\n\n" +
  (await readFile(resolve(source, "LICENSE-MIT"), "utf8"));
const runtimePackages = [];
for (const name of packages) {
  const dir = resolve(here, "../node_modules", name),
    metadata = JSON.parse(await readFile(resolve(dir, "package.json"), "utf8"));
  runtimePackages.push({
    name,
    version: metadata.version,
    license: metadata.license,
  });
  let license;
  for (const file of ["LICENSE", "LICENSE.txt", "LICENSE.md"]) {
    try {
      license = await readFile(resolve(dir, file), "utf8");
      break;
    } catch {}
  }
  if (!license) throw new Error("Missing licence text: " + name);
  notices += "\n\n--- " + name + " " + metadata.version + " ---\n" + license;
}
await writeFile(resolve(vendor, "NOTICES.txt"), notices);
const bridge = await readFile(resolve(here, "host-bridge.mjs"), "utf8");
const app = await build({
  ...common,
  entryPoints: [resolve(repo, "packages/data/runtime/app.mjs")],
  format: "esm",
  plugins: [
    {
      name: "assessment-only-host",
      setup(b) {
        b.onLoad({ filter: /runtime\/app\.mjs$/ }, async (args) => {
          let contents = await readFile(args.path, "utf8");
          contents = replaceOnce(
            contents,
            "  dropdowns.draw();\n}\nfunction render()",
            "  dropdowns.draw();\n  assessmentNotify();\n}\nfunction render()",
          );
          contents = replaceOnce(
            contents,
            "  conditionalSettings.draw();\n}",
            "  conditionalSettings.draw();\n  assessmentNotify();\n}",
          );
          return {
            contents: contents + "\n" + bridge,
            loader: "js",
            resolveDir: dirname(args.path),
          };
        });
        b.onLoad({ filter: /runtime\/saving\.mjs$/ }, async (args) => ({
          contents: replaceOnce(
            await readFile(args.path, "utf8"),
            '    copy.querySelector("#workbook").textContent = modelText;',
            '    copy.querySelector("#assessment-mount")?.replaceChildren();\n    for (const node of copy.querySelectorAll("[data-assessment-transient]")) node.remove();\n    copy.querySelector("#grid")?.classList.remove("assessment-no-grid");\n    copy.querySelector("#workbook").textContent = modelText;',
          ),
          loader: "js",
          resolveDir: dirname(args.path),
        }));
      },
    },
  ],
});
const loader = (
  await build({
    ...common,
    entryPoints: [resolve(here, "loader.mjs")],
    format: "iife",
  })
).outputFiles[0].text;
const iconNames = [
  "Undo2",
  "Redo2",
  "PaintRoller",
  "RemoveFormatting",
  "Euro",
  "Percent",
  "DecimalsArrowLeft",
  "DecimalsArrowRight",
  "Minus",
  "Plus",
  "Bold",
  "Italic",
  "Underline",
  "Strikethrough",
  "Type",
  "PaintBucket",
  "Grid2X2",
  "Brush",
  "SwatchBook",
  "Layers",
  "AlignLeft",
  "AlignCenter",
  "AlignRight",
  "ArrowUpToLine",
  "ArrowDownToLine",
  "WrapText",
  "TableCellsMerge",
  "Link2",
  "ImageDown",
  "Grid2x2Check",
];
const iconMap = Object.fromEntries(
  iconNames.map((name) => [
    name,
    renderToStaticMarkup(
      React.createElement(icons[name], { "aria-hidden": true }),
    ),
  ]),
);
const native = (
  await build({
    ...common,
    stdin: {
      contents: `import {mountNative} from './native-entry.mjs';globalThis.mountNativeAssessmentToolbar=(node,bridge)=>mountNative(node,bridge,${JSON.stringify(iconMap)});`,
      resolveDir: here,
    },
    format: "iife",
  })
).outputFiles[0].text;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const esc = (s) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const safe = (s) => s.replaceAll(/<\/script/gi, "<\\/script");
const gzip = (bytes) => gzipSync(bytes, { level: 9 });
const base = process.argv.includes("--asset-base")
  ? argument("--asset-base").replace(/\/$/, "")
  : "http://127.0.0.1:8765";
const assets = {
  js: { url: base + "/toolbar.js", sha256: sha(js), id: "toolbar-js-gzip" },
  css: { url: base + "/toolbar.css", sha256: sha(css), id: "toolbar-css-gzip" },
};
const book = pnl();
book.id = "fictional-toolbar-assessment";
book.title = "Community Learning — fictional P&L";
const inputs = book.sheets.find((s) => s.id === "inputs").cells;
inputs.A10 = {
  input: { type: "text", value: "Active scenario" },
  role: "rowHeader",
};
inputs.B10 = { input: { type: "text", value: "Base" }, role: "assumption" };
for (const [row, name, growth] of [
  [2, "Base", 0.02],
  [3, "Upside", 0.04],
  [4, "Downside", -0.01],
]) {
  inputs["D" + row] = {
    input: { type: "text", value: name },
    role: "rowHeader",
  };
  inputs["E" + row] = {
    input: { type: "number", value: growth },
    format: { kind: "percent", digits: 1 },
    role: "assumption",
  };
}
inputs.B2 = {
  formula: "=XLOOKUP(B10,D2:D4,E2:E4)",
  role: "calculation",
  format: { kind: "percent", digits: 1 },
};
book.validations = [
  {
    id: "scenario",
    sheetId: "inputs",
    ref: "B10",
    source: { kind: "range", sheetId: "inputs", ref: "D2:D4" },
  },
];
book.scenario = { validationId: "scenario" };
book.conditionalFormats = [
  {
    id: "profit",
    sheetId: "summary",
    ref: "B3",
    kind: "dataBar",
    scale: { kind: "fixed", min: 0, max: 30000 },
    positiveColor: "#4472C4",
    negativeColor: "#C00000",
  },
];
const sizes = [];
for (const offline of [false, true]) {
  const host = await buildWorkbook(book, { offline });
  await writeFile(
    resolve(out, `baseline${offline ? "-offline" : ""}.html`),
    host,
  );
  for (const mode of ["cdn", "native", "embedded"]) {
    const config = {
      strategy: mode,
      mode: mode === "cdn" && offline ? "embedded" : mode,
      ...assets,
    };
    const compressed =
      config.mode === "embedded"
        ? Object.entries({ js, css })
            .map(
              ([name, bytes]) =>
                `<script type="text/plain" id="toolbar-${name}-gzip">${gzip(bytes).toString("base64")}</script>`,
            )
            .join("\n")
        : "";
    let html = host.replace(
      /<script type="module">[\s\S]*?<\/script><\/body>/,
      `<script type="module">${safe(app.outputFiles[0].text)}\n${mode === "native" ? safe(native) : ""}\n${safe(loader)}</script></body>`,
    );
    const start = html.indexOf('<section class="ribbon"'),
      end = html.indexOf('<div class="editor-context">');
    if (start < 0 || end < start) throw new Error("Host ribbon shell changed");
    html =
      html.slice(0, start) +
      `<section class="assessment-note"><strong>Toolbar assessment · ${mode}${offline ? (mode === "cdn" ? " strategy · offline toolbar embedded" : " · offline") : " strategy"}</strong><p>Fictional data. 12 actual + 12 forecast months. Grey actions are not supported yet.</p><button id="activate-toolbar">Enable editing toolbar</button><p id="toolbar-status" role="status"></p></section><div class="ic-root" id="assessment-mount"></div><details class="assessment-advanced"><summary>Existing editing commands / fallback</summary>` +
      html.slice(start, end) +
      "</details>" +
      html.slice(end);
    html = html.replace(
      "</head>",
      `<style>${await readFile(resolve(here, "prototype.css"), "utf8")}</style></head>`,
    );
    html = html.replace(
      "</body>",
      `<script type="application/json" id="toolbar-config">${JSON.stringify(config).replaceAll("<", "\\u003c")}</script>${compressed}<details><summary>Toolbar third-party notices</summary><pre>${esc(notices)}</pre></details></body>`,
    );
    const file = `toolbar-${mode}${offline ? "-offline" : ""}.html`;
    await writeFile(resolve(out, file), html);
    sizes.push({
      file,
      strategy: mode,
      delivery: config.mode,
      ...measureHTML(html),
      decodedToolbarBytes:
        mode === "native" ? Buffer.byteLength(native) : js.length + css.length,
      baseline: measureHTML(host),
    });
  }
}
const report = {
  upstream: { revision, archiveSha256: sha(archive) },
  assetBase: base,
  patched,
  runtimePackages,
  assets: Object.fromEntries(
    Object.entries({ js, css }).map(([name, bytes]) => [
      name,
      {
        bytes: bytes.length,
        sha256: sha(bytes),
        gzipBytes: gzip(bytes).length,
        brotliBytes: brotliCompressSync(bytes).length,
        base64GzipBytes: Buffer.byteLength(gzip(bytes).toString("base64")),
      },
    ]),
  ),
  loaderBytes: Buffer.byteLength(loader),
  nativeBytes: Buffer.byteLength(native),
  noticeBytes: Buffer.byteLength(notices),
  sizes,
};
await writeFile(
  resolve(out, "build-results.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      out,
      assets: report.assets,
      files: sizes.map((s) => ({
        file: s.file,
        applicationCodeBytes: s.applicationCodeBytes,
        totalBytes: s.totalBytes,
      })),
    },
    null,
    2,
  ),
);
