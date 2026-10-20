import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { transform } from "@svgr/core";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const revision = "297553dc3a37ec6b0f4821055220e3d26c4ac6a1";
const source = process.argv[process.argv.indexOf("--source") + 1];
if (!process.argv.includes("--source") || !source)
  throw new Error(
    "Supply --source PATH to an IronCalc git checkout containing pinned commit " +
      revision,
  );
const output = resolve(root, "dist/ribbon-assessment");
await mkdir(output, { recursive: true });
const archive = execFileSync(
  "git",
  ["archive", revision, "webapp/IronCalc/src"],
  { cwd: resolve(source), maxBuffer: 20_000_000 },
);
const extracted = resolve(output, "source");
await rm(extracted, { recursive: true, force: true });
await mkdir(extracted, { recursive: true });
execFileSync("tar", ["-x", "-C", extracted], { input: archive });
const upstream = resolve(extracted, "webapp/IronCalc/src");
const stub = resolve(output, "wasm-size-stub.mjs");
await writeFile(
  stub,
  `// SIZE LOWER BOUND ONLY: no calculation engine or colour implementation.\nexport const BorderStyle={Thin:0,Medium:1,Thick:2,Double:3,Dotted:4,MediumDashed:5,SlantDashDot:6,MediumDashDot:7,MediumDashDotDot:8};\nexport const BorderType={All:0,Inner:1,CenterH:2,CenterV:3,Outer:4,None:5,Left:6,Right:7,Top:8,Bottom:9};\nexport const columnNameFromNumber=()=>{throw new Error("WASM absent");};export const quoteName=columnNameFromNumber;\nexport function hexWithTintToRgb(){throw new Error("WASM intentionally absent from size-only probe");}\n`,
);
const entries = {
  "react-runtime": `import React from "react";import{createRoot}from"react-dom/client";globalThis.mountProbe=(node,props)=>createRoot(node).render(React.createElement("div",props));`,
  "upstream-toolbar-lower-bound": `import React from "react";import{createRoot}from"react-dom/client";import{I18nextProvider}from"react-i18next";import i18n from "i18next";import english from ${JSON.stringify(resolve(upstream, "locale/en_us.json"))};import Toolbar from ${JSON.stringify(resolve(upstream, "components/Toolbar/Toolbar.tsx"))};import ${JSON.stringify(resolve(upstream, "theme/theme.css"))};i18n.init({lng:"en-US",resources:{"en-US":{translation:english}}});globalThis.mountProbe=(node,props)=>createRoot(node).render(React.createElement(I18nextProvider,{i18n},React.createElement(Toolbar,props)));`,
};
const results = [];
for (const [name, contents] of Object.entries(entries)) {
  const result = await build({
    stdin: { contents, resolveDir: here, loader: "jsx" },
    bundle: true,
    minify: true,
    write: false,
    outfile: resolve(output, `${name}.js`),
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    target: "es2022",
    define: { "process.env.NODE_ENV": '"production"' },
    nodePaths: [resolve(here, "node_modules")],
    metafile: true,
    legalComments: "eof",
    plugins: [
      {
        name: "pinned-svg-and-size-stub",
        setup(b) {
          b.onResolve({ filter: /^@ironcalc\/wasm$/ }, () => ({ path: stub }));
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
        },
      },
    ],
  });
  let jsBytes = 0,
    cssBytes = 0,
    transfer = 0;
  for (const file of result.outputFiles) {
    await writeFile(file.path, file.contents);
    if (file.path.endsWith(".css")) cssBytes += file.contents.length;
    else jsBytes += file.contents.length;
    transfer += gzipSync(file.contents, { level: 9 }).length;
  }
  await writeFile(
    resolve(output, `${name}-meta.json`),
    JSON.stringify(result.metafile, null, 2),
  );
  const runtimePackages = new Map();
  for (const input of Object.keys(result.metafile.inputs)) {
    const match = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(input);
    if (match && !runtimePackages.has(match[1])) {
      const metadata = JSON.parse(
        await readFile(
          resolve(here, "node_modules", match[1], "package.json"),
          "utf8",
        ),
      );
      runtimePackages.set(match[1], {
        name: match[1],
        version: metadata.version,
        declaredLicense: metadata.license ?? null,
      });
    }
  }
  results.push({
    name,
    jsBytes,
    cssBytes,
    totalRawBytes: jsBytes + cssBytes,
    gzipBytesForInformationOnly: transfer,
    runtimePackages: [...runtimePackages.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
  });
}
const report = {
  upstream: {
    repository: "https://github.com/ironcalc/IronCalc",
    revision,
    sourceArchiveSHA256: createHash("sha256").update(archive).digest("hex"),
  },
  method:
    "Production minified browser JS + CSS, all peer runtimes bundled; English locale. Upstream Toolbar exported directly from pinned source. WASM enums/color/name helpers stubbed: lower bound, not a functional integration, excludes command adapters and additional notices. No dependency enters the Data runtime.",
  results,
};
await writeFile(
  resolve(here, "results.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
