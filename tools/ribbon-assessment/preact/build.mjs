// R05: build the pinned IronCalc toolbar + panels on React and on preact/compat,
// measure each component/dependency, and assemble usable P&L samples.
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
import * as lucide from "lucide-react";
import {
  buildWorkbook,
  measureHTML,
} from "../../../packages/data/tools/build.mjs";
import { pnl } from "../../../packages/data/fixtures/generate.mjs";
import { replaceOnce } from "../functional/patches.mjs";
import { patches } from "./patches.mjs";

const here = dirname(fileURLToPath(import.meta.url)),
  repo = resolve(here, "../../.."),
  modules = resolve(here, "../node_modules");
const revision = "297553dc3a37ec6b0f4821055220e3d26c4ac6a1";
const index = process.argv.indexOf("--source");
if (index < 0)
  throw new Error("Supply --source PATH to the pinned IronCalc checkout");
const out = resolve(repo, "dist/toolbar-preact"),
  source = resolve(out, "source");
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
  ],
  { cwd: resolve(process.argv[index + 1]), maxBuffer: 50_000_000 },
);
execFileSync("tar", ["-x", "-C", source], { input: archive });
const upstream = resolve(source, "webapp/IronCalc/src");
const staticData = JSON.parse(
  await readFile(resolve(here, "ironcalc-static.json"), "utf8"),
);
if (staticData.source.revision !== revision)
  throw new Error("Static data was extracted from another revision");
const { source: _provenance, ...runtimeData } = staticData;

// Flattened English dictionary plus the strings added by our patches.
const flat = {};
(function walk(node, prefix) {
  for (const [key, value] of Object.entries(node))
    if (typeof value === "string") flat[prefix + key] = value;
    else walk(value, prefix + key + ".");
})(
  JSON.parse(await readFile(resolve(upstream, "locale/en_us.json"), "utf8")),
  "",
);
flat["toolbar.align_center_across"] = "Center across selection";
const nested = {};
for (const [key, value] of Object.entries(flat)) {
  const parts = key.split(".");
  let node = nested;
  for (const part of parts.slice(0, -1)) node = node[part] ??= {};
  node[parts.at(-1)] = value;
}

// Build-time static icons: same SVG markup as lucide-react, no icon runtime.
// Every exported icon name, including lucide's compatibility aliases.
const iconNames = Object.keys(lucide).filter(
  (name) =>
    /^[A-Z]/.test(name) &&
    !/(^Lucide|Icon$)/.test(name) &&
    typeof lucide[name] === "object" &&
    lucide[name]?.render,
);
const iconModule =
  'import { createElement } from "react";\n' +
  'const icon = (inner) => ({ size = 24, color = "currentColor", strokeWidth = 2, absoluteStrokeWidth, className = "", ...rest }) => createElement("svg", { xmlns: "http://www.w3.org/2000/svg", width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth, strokeLinecap: "round", strokeLinejoin: "round", className: ("lucide " + className).trim(), "aria-hidden": rest["aria-label"] ? undefined : "true", dangerouslySetInnerHTML: { __html: inner }, ...rest });\n' +
  iconNames
    .map((name) => {
      const markup = renderToStaticMarkup(React.createElement(lucide[name]));
      const inner = markup.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
      return `export const ${name} = /* @__PURE__ */ icon(${JSON.stringify(inner)});`;
    })
    .join("\n");

const patched = new Map();
async function bundle({ framework, shims, dictionary }) {
  const preact = framework === "preact";
  const virtual = {
    "spike-static-data": `export default ${JSON.stringify(runtimeData)};`,
    "spike-dictionary": `export default ${JSON.stringify(dictionary ?? {})};`,
    "spike-i18n-init": shims
      ? ""
      : `import i18n from "i18next";import { initReactI18next } from "react-i18next";i18n.use(initReactI18next).init({ lng: "en-US", resources: { "en-US": { translation: ${JSON.stringify(nested)} } }, initImmediate: false });`,
    "spike-lucide": iconModule,
  };
  const alias = {
    "pinned-toolbar": resolve(upstream, "components/Toolbar/Toolbar.tsx"),
    "pinned-drawer": resolve(
      upstream,
      "components/RightDrawer/RightDrawer.tsx",
    ),
    "pinned-link-dialog": resolve(
      upstream,
      "components/LinkDialog/LinkDialog.tsx",
    ),
    "pinned-theme": resolve(upstream, "theme/theme.css"),
    "pinned-wasm-types": resolve(source, "bindings/wasm/types.ts"),
    "@ironcalc/wasm": resolve(here, "shims/wasm.mjs"),
  };
  const result = await build({
    entryPoints: [resolve(here, "entry.jsx")],
    outfile: resolve(out, "toolbar.js"),
    bundle: true,
    minify: true,
    write: false,
    platform: "browser",
    target: "es2022",
    format: "iife",
    legalComments: "eof",
    jsx: "automatic",
    jsxImportSource: preact ? "preact" : "react",
    define: { "process.env.NODE_ENV": '"production"' },
    nodePaths: [modules],
    metafile: true,
    plugins: [
      {
        name: "spike",
        setup(b) {
          b.onResolve({ filter: /^spike-/ }, (args) => ({
            path: args.path,
            namespace: "spike",
          }));
          b.onLoad({ filter: /.*/, namespace: "spike" }, (args) => ({
            contents: virtual[args.path],
            loader: "js",
            resolveDir: here,
          }));
          b.onResolve({ filter: /^(pinned-|@ironcalc\/wasm$)/ }, (args) => ({
            path: alias[args.path],
          }));
          if (shims) {
            b.onResolve({ filter: /^(i18next|react-i18next)$/ }, () => ({
              path: resolve(here, "shims/i18n.mjs"),
            }));
            b.onResolve({ filter: /^lucide-react$/ }, () => ({
              path: "spike-lucide",
              namespace: "spike",
            }));
          }
          if (preact) {
            const compat = {
              react: "preact/compat",
              "react-dom": "preact/compat",
              "react-dom/client": "preact/compat/client",
              "react/jsx-runtime": "preact/jsx-runtime",
            };
            b.onResolve(
              { filter: /^react(-dom)?(\/client|\/jsx-runtime)?$/ },
              (args) =>
                b.resolve(compat[args.path], {
                  kind: args.kind,
                  resolveDir: modules,
                }),
            );
          }
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
          b.onLoad({ filter: /\.tsx?$/ }, async (args) => {
            const patch = patches.find(([pattern]) => pattern.test(args.path));
            if (!patch || !args.path.startsWith(upstream)) return;
            const contents = patch[1](await readFile(args.path, "utf8"));
            const file = args.path.slice(upstream.length + 1);
            if (!patched.has(file)) {
              const adapted = resolve(
                out,
                "patched",
                file.replaceAll("/", "__"),
              );
              await mkdir(dirname(adapted), { recursive: true });
              await writeFile(adapted, contents);
              const diff = spawnSync(
                "git",
                ["diff", "--no-index", "--numstat", args.path, adapted],
                { encoding: "utf8" },
              );
              if (![0, 1].includes(diff.status)) throw new Error(diff.stderr);
              const [added, removed] = diff.stdout.split("\t").map(Number);
              patched.set(file, { file, added, removed });
            }
            return {
              contents,
              loader: args.path.endsWith("x") ? "tsx" : "ts",
              resolveDir: dirname(args.path),
            };
          });
        },
      },
    ],
  });
  const js = result.outputFiles.find((f) => f.path.endsWith(".js")).contents;
  const css = result.outputFiles.find((f) => f.path.endsWith(".css")).contents;
  return { js, css, metafile: result.metafile };
}

// Pass 1 finds the dictionary keys the bundle actually references.
const probe = await bundle({ framework: "preact", shims: true });
const text = Buffer.from(probe.js).toString("utf8");
// Template keys such as `regional_settings.locale.delimiter_${type}` keep
// every dictionary entry sharing their literal prefix.
const prefixes = [
  ...text.matchAll(/`([a-z0-9_]+(?:\.[a-z0-9_]+)*[._][a-z0-9_]*)\$\{/g),
].map((m) => m[1]);
const used = Object.fromEntries(
  [
    ...new Set([
      ...(text.match(/"[a-z0-9_]+(?:\.[a-z0-9_]+)+"/g) ?? []).map((s) =>
        s.slice(1, -1),
      ),
      ...Object.keys(flat).filter((key) =>
        prefixes.some((prefix) => key.startsWith(prefix)),
      ),
    ]),
  ]
    .filter((key) => key in flat)
    .sort()
    .map((key) => [key, flat[key]]),
);

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const gzip = (bytes) => gzipSync(bytes, { level: 9 });
function breakdown(metafile) {
  const output = Object.values(metafile.outputs).find((o) => o.entryPoint);
  const parts = {};
  for (const [path, info] of Object.entries(output.inputs)) {
    const pkg = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(path)?.[1];
    const component = /webapp\/IronCalc\/src\/(?:components\/)?([^/]+)/.exec(
      path,
    )?.[1];
    const key = pkg
      ? "package:" + pkg
      : component
        ? "ironcalc:" + component.replace(/\.(tsx?|css|json)$/, "")
        : path.startsWith("spike:")
          ? path
          : "spike:" + path.split("/").at(-1);
    parts[key] = (parts[key] ?? 0) + info.bytesInOutput;
  }
  return Object.fromEntries(Object.entries(parts).sort((a, b) => b[1] - a[1]));
}
const variants = {};
for (const [name, options] of Object.entries({
  "react-upstream": { framework: "react", shims: false },
  "react-shims": { framework: "react", shims: true, dictionary: used },
  preact: { framework: "preact", shims: true, dictionary: used },
})) {
  const { js, css, metafile } = await bundle(options);
  const packages = [
    ...new Set(
      Object.keys(metafile.inputs)
        .map((p) => /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(p)?.[1])
        .filter(Boolean),
    ),
  ].sort();
  variants[name] = {
    js,
    css,
    report: {
      jsBytes: js.length,
      cssBytes: css.length,
      totalBytes: js.length + css.length,
      gzipBytes: gzip(js).length + gzip(css).length,
      brotliBytes:
        brotliCompressSync(js).length + brotliCompressSync(css).length,
      jsSha256: sha(js),
      packages,
      jsBreakdown: breakdown(metafile),
    },
  };
}

// Notices for the shipped (Preact) variant: IronCalc plus bundled packages.
let notices =
  "IronCalc toolbar and panels, source " +
  revision +
  " (MIT)\n\n" +
  (await readFile(resolve(source, "LICENSE-MIT"), "utf8")) +
  "\n\n--- lucide (static SVG icons, ISC) ---\n" +
  (await readFile(resolve(modules, "lucide-react/LICENSE"), "utf8"));
for (const name of variants.preact.report.packages) {
  const dir = resolve(modules, name),
    metadata = JSON.parse(await readFile(resolve(dir, "package.json"), "utf8"));
  let license;
  for (const file of ["LICENSE", "LICENSE.txt", "LICENSE.md"])
    try {
      license = await readFile(resolve(dir, file), "utf8");
      break;
    } catch {}
  if (!license) throw new Error("Missing licence text: " + name);
  notices += `\n\n--- ${name} ${metadata.version} (${metadata.license}) ---\n${license}`;
}

// Host application: unchanged runtime plus the assessment-only bridge.
const bridge = await readFile(resolve(here, "host-bridge.mjs"), "utf8");
const app = await build({
  entryPoints: [resolve(repo, "packages/data/runtime/app.mjs")],
  bundle: true,
  minify: true,
  write: false,
  platform: "browser",
  target: "es2022",
  format: "esm",
  legalComments: "eof",
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
            '    for (const id of ["spike-toolbar", "spike-drawer"]) copy.querySelector("#" + id)?.replaceChildren();\n    copy.querySelector("#grid")?.classList.remove("assessment-no-grid");\n    copy.querySelector("#workbook").textContent = modelText;',
          ),
          loader: "js",
          resolveDir: dirname(args.path),
        }));
      },
    },
  ],
});

// Same fictional P&L and scenario setup as R04.
const book = pnl();
book.id = "fictional-toolbar-preact";
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

const esc = (s) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const safe = (s) => s.replaceAll(/<\/script/gi, "<\\/script");
const spikeCss = await readFile(resolve(here, "spike.css"), "utf8");
const sizes = [];
await mkdir(out, { recursive: true });
for (const offline of [false, true]) {
  const host = await buildWorkbook(book, { offline });
  await writeFile(
    resolve(out, `baseline${offline ? "-offline" : ""}.html`),
    host,
  );
  for (const variant of ["preact", "react-upstream"]) {
    const { js, css } = variants[variant];
    let html = host.replace(
      /<script type="module">[\s\S]*?<\/script><\/body>/,
      // Function replacements: minified code contains "$&"-like sequences.
      () =>
        `<script type="module">${safe(app.outputFiles[0].text)}\n${safe(Buffer.from(js).toString("utf8"))}\nglobalThis.toolbarSpikeMount = (() => { const t0 = performance.now(); mountSpikeToolbar(document.getElementById("spike-toolbar"), document.getElementById("spike-drawer"), HTMLDataToolbarBridge); document.getElementById("toolbar-status").textContent = "Editing toolbar ready."; return { mountMs: performance.now() - t0 }; })();</script></body>`,
    );
    const start = html.indexOf('<section class="ribbon"'),
      end = html.indexOf('<div class="editor-context">');
    if (start < 0 || end < start) throw new Error("Host ribbon shell changed");
    html =
      html.slice(0, start) +
      `<section class="assessment-note"><strong>R05 toolbar spike · ${variant}${offline ? " · offline" : ""}</strong> <span>Fictional data. Formatting without a model yet is recorded, not applied.</span> <button type="button" onclick="openSpikeDrawer('regionalSettings')">Regional settings</button> <span id="toolbar-status" role="status"></span></section><div class="ic-root" id="spike-toolbar"></div><details class="assessment-advanced"><summary>Existing editing commands / fallback</summary>` +
      html.slice(start, end) +
      "</details>" +
      html.slice(end);
    html = html.replace(
      "</body>",
      () =>
        `<div class="ic-root" id="spike-drawer"></div><details><summary>Toolbar third-party notices</summary><pre>${esc(notices)}</pre></details></body>`,
    );
    html = html.replace(
      "</head>",
      () =>
        `<style>${Buffer.from(css).toString("utf8")}\n${spikeCss}</style></head>`,
    );
    const file = `toolbar-${variant}${offline ? "-offline" : ""}.html`;
    await writeFile(resolve(out, file), html);
    sizes.push({
      file,
      variant,
      offline,
      ...measureHTML(html),
      baseline: measureHTML(host),
    });
  }
}

const report = {
  upstream: { revision, archiveSha256: sha(archive) },
  preactVersion: JSON.parse(
    await readFile(resolve(modules, "preact/package.json"), "utf8"),
  ).version,
  patched: [...patched.values()].sort((a, b) => a.file.localeCompare(b.file)),
  dictionary: {
    templatePrefixes: prefixes,
    keys: Object.keys(used).length,
    upstreamKeys: Object.keys(flat).length,
    bytes: Buffer.byteLength(JSON.stringify(used)),
  },
  staticDataBytes: Buffer.byteLength(JSON.stringify(runtimeData)),
  noticeBytes: Buffer.byteLength(notices),
  variants: Object.fromEntries(
    Object.entries(variants).map(([name, v]) => [name, v.report]),
  ),
  sizes,
};
await writeFile(
  resolve(here, "results/build.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      variants: Object.fromEntries(
        Object.entries(report.variants).map(([k, v]) => [
          k,
          { total: v.totalBytes, gzip: v.gzipBytes, packages: v.packages },
        ]),
      ),
      sizes: sizes.map((s) => [
        s.file,
        s.applicationCodeBytes,
        s.totalHTMLBytes ?? s.totalBytes,
      ]),
      dictionary: report.dictionary,
    },
    null,
    1,
  ),
);
