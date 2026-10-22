// R06 spike: variant A of the shared editor shell for html-data, built from
// shared native components (no framework), on the same P&L sample and host
// seam as R05 so sizes and behaviour compare like for like.
// Usage (repository root): node tools/shell-spike/build.mjs
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build, transform } from "esbuild";
import { buildWorkbook, measureHTML } from "../../packages/data/tools/build.mjs";
import { pnl } from "../../packages/data/fixtures/generate.mjs";
import { replaceOnce } from "../ribbon-assessment/functional/patches.mjs";

const here = dirname(fileURLToPath(import.meta.url)),
  repo = resolve(here, "../.."),
  out = resolve(repo, "dist/shell-spike");
const SHELL_IDS = ["shell-root", "shell-drawer", "shell-layer", "sheet-end"];

// Host application: unchanged runtime plus the assessment-only bridge (as R05).
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
          contents = replaceOnce(contents, "  dropdowns.draw();\n}\nfunction render()", "  dropdowns.draw();\n  assessmentNotify();\n}\nfunction render()");
          contents = replaceOnce(contents, "  conditionalSettings.draw();\n}", "  conditionalSettings.draw();\n  assessmentNotify();\n}");
          return { contents: contents + "\n" + bridge, loader: "js", resolveDir: dirname(args.path) };
        });
        // Saved copies reopen with an empty shell that mounts fresh.
        b.onLoad({ filter: /runtime\/saving\.mjs$/ }, async (args) => ({
          contents: replaceOnce(
            await readFile(args.path, "utf8"),
            '    copy.querySelector("#workbook").textContent = modelText;',
            `    for (const id of ${JSON.stringify(SHELL_IDS)}) copy.querySelector("#" + id)?.replaceChildren();\n    copy.querySelector("#shell-drawer")?.setAttribute("hidden", "");\n    copy.querySelector("#grid")?.classList.remove("assessment-no-grid");\n    copy.querySelector("body")?.classList.remove("sh-drawer-open");\n    copy.querySelector("#workbook").textContent = modelText;`,
          ),
          loader: "js",
          resolveDir: dirname(args.path),
        }));
      },
    },
  ],
});

// The shell: shared components + Data adapter, minified, with a per-module breakdown.
const shell = await build({
  entryPoints: [resolve(here, "entry.mjs")],
  bundle: true,
  minify: true,
  write: false,
  metafile: true,
  platform: "browser",
  target: "es2022",
  // Scoped: it shares one module script with the host bundle.
  format: "iife",
});
const shellJs = shell.outputFiles[0].text;
const modules = Object.fromEntries(
  Object.entries(Object.values(shell.metafile.outputs)[0].inputs).map(([path, v]) => [relative(here, resolve(repo, path)), v.bytesInOutput]),
);
const css = (
  await transform((await readFile(resolve(here, "shell/shell.css"), "utf8")) + (await readFile(resolve(here, "integration.css"), "utf8")), { loader: "css", minify: true })
).code;

// Source size of each shared component, as a measure of effort.
const sources = {};
for (const dir of ["shell", "."])
  for (const file of await readdir(resolve(here, dir)))
    if (/\.(mjs|css)$/.test(file) && !["build.mjs", "browser.mjs", "entry.mjs"].includes(file)) {
      const text = await readFile(resolve(here, dir, file), "utf8");
      sources[`${dir === "." ? "" : dir + "/"}${file}`] = { lines: text.split("\n").length, bytes: Buffer.byteLength(text) };
    }

// Same fictional P&L and scenario setup as R04/R05.
const book = pnl();
book.id = "fictional-shell-native";
book.title = "Community Learning — fictional P&L";
const inputs = book.sheets.find((s) => s.id === "inputs").cells;
inputs.A10 = { input: { type: "text", value: "Active scenario" }, cellStyle: "rowHeader" };
inputs.B10 = { input: { type: "text", value: "Base" }, cellStyle: "assumption" };
for (const [row, name, growth] of [[2, "Base", 0.02], [3, "Upside", 0.04], [4, "Downside", -0.01]]) {
  inputs["D" + row] = { input: { type: "text", value: name }, cellStyle: "rowHeader" };
  inputs["E" + row] = { input: { type: "number", value: growth }, format: { kind: "percent", digits: 1 }, cellStyle: "assumption" };
}
inputs.B2 = { formula: "=XLOOKUP(B10,D2:D4,E2:E4)", cellStyle: "calculation", format: { kind: "percent", digits: 1 } };
book.validations = [{ id: "scenario", sheetId: "inputs", ref: "B10", source: { kind: "range", sheetId: "inputs", ref: "D2:D4" } }];
book.scenario = { validationId: "scenario" };

const safe = (s) => s.replaceAll(/<\/script/gi, "<\\/script");
const sizes = [];
await mkdir(out, { recursive: true });
for (const offline of [false, true]) {
  const host = await buildWorkbook(book, { offline });
  await writeFile(resolve(out, `baseline${offline ? "-offline" : ""}.html`), host);
  let html = host.replace(
    /<script type="module">[\s\S]*?<\/script><\/body>/,
    () =>
      `<script type="module">${safe(app.outputFiles[0].text)}\n${safe(shellJs)}\nglobalThis.toolbarSpikeMount = (() => { const r = mountDataShell({ root: document.getElementById("shell-root"), drawerHost: document.getElementById("shell-drawer"), bridge: HTMLDataToolbarBridge }); document.getElementById("toolbar-status").textContent = "Editing toolbar ready."; return { mountMs: r.mountMs }; })();</script></body>`,
  );
  const start = html.indexOf('<div class="quick-access"'),
    end = html.indexOf('<div class="editor-context">');
  if (start < 0 || end < start) throw new Error("Host ribbon shell changed");
  html =
    html.slice(0, start) +
    `<div id="shell-root"></div><details class="assessment-advanced"><summary>Existing editing commands / fallback</summary>` +
    html.slice(start, end) +
    "</details>" +
    html.slice(end);
  html = replaceOnce(html, '<nav id="sheet-tabs" aria-label="Sheets"></nav>', '<div class="sheet-bar"><nav id="sheet-tabs" aria-label="Sheets"></nav><div id="sheet-end" class="sh-sheet-end"></div></div>');
  html = html.replace("</body>", () => `<aside id="shell-drawer" aria-label="Side panel" hidden></aside><div id="shell-layer"></div></body>`);
  html = html.replace("</head>", () => `<style>${css}</style></head>`);
  const file = `shell-native${offline ? "-offline" : ""}.html`;
  await writeFile(resolve(out, file), html);
  sizes.push({ file, offline, ...measureHTML(html), baseline: measureHTML(host) });
}

const r05 = JSON.parse(await readFile(resolve(repo, "tools/ribbon-assessment/preact/results/build.json"), "utf8"));
const report = {
  shell: {
    jsBytes: Buffer.byteLength(shellJs),
    cssBytes: Buffer.byteLength(css),
    totalBytes: Buffer.byteLength(shellJs) + Buffer.byteLength(css),
    // Same method as R05: JS and CSS compressed separately at level 9.
    gzipBytes: gzipSync(shellJs, { level: 9 }).length + gzipSync(css, { level: 9 }).length,
    runtimePackages: [],
    modules,
  },
  sources,
  sizes,
  r05: {
    preact: { totalBytes: r05.variants.preact.totalBytes, gzipBytes: r05.variants.preact.gzipBytes },
    samples: r05.sizes.map(({ file, applicationCodeBytes, baseline }) => ({ file, applicationCodeBytes, baseline: baseline.applicationCodeBytes })),
  },
};
await mkdir(resolve(here, "results"), { recursive: true });
await writeFile(resolve(here, "results/build.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ shell: { ...report.shell, modules: undefined }, sizes: sizes.map((s) => [s.file, s.applicationCodeBytes, s.baseline.applicationCodeBytes]), r05: report.r05.preact }, null, 1));
