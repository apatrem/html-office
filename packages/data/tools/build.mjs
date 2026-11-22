import { conditionalDialogHTML } from "./conditional-controls.mjs";
import { guideText } from "./guide.mjs";
import { charteCSS } from "../../shared/themes/chartes.mjs";
import {
  fileBarHTML,
  formulaBarHTML,
  sheetBarHTML,
  numberDialogHTML,
  helpDialogHTML,
} from "./shell.mjs";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import {
  parseWorkbook,
  stringifyWorkbook,
  address,
} from "../model/workbook.mjs";
import { cellClasses } from "../model/formatting.mjs";
import { recalculate } from "./engine-node.mjs";
import { readModel, writeModel } from "../model/document.mjs";
import { escapeHTML as esc, preview } from "../runtime/view.mjs";
import { renderPreviews, embeddedECharts } from "./chart-previews.mjs";
import { completeCharte } from "../../shared/charts/css-theme.mjs";
import { xlsxLibrary, xlsxPackage } from "./xlsx-library.mjs";
// Standard-mode embedded application code ceiling for HTML Data (ADR-010).
export const STANDARD_CODE_CEILING = 750000;
const root = new URL("../", import.meta.url);
const exists = (url) =>
  access(url).then(
    () => true,
    () => false,
  );
// The embedded guide (tools/guide.mjs): template#html-data-guide in head.
export const guide = guideText;
const echartsDir = new URL("../../../node_modules/echarts/", import.meta.url);
// Notices are compiled with the runtime: the packaged skill does not read
// licence files.
export async function echartsPackage() {
  const { packageAt } = await import("../../shared/notices.mjs");
  return packageAt(echartsDir.pathname.replace(/\/$/, ""), [
    new URL("dist/echarts.min.js", echartsDir).pathname,
  ]);
}
export function measureHTML(html) {
  const bytes = (s) => Buffer.byteLength(s, "utf8");
  let contentBytes = 0;
  const code = html.replace(
    /(<(script|pre|template)[^>]*\bdata-document-content[^>]*>)([\s\S]*?)(<\/\2>)/g,
    (_m, start, _tag, content, end) => {
      contentBytes += bytes(content);
      return start + end;
    },
  );
  return {
    applicationCodeBytes: bytes(code),
    documentContentBytes: contentBytes,
    totalHTMLBytes: bytes(html),
  };
}
// The editor code embedded in every workbook: the app, the calculation and
// recovery workers, the stylesheet and the licence notices. Compiled from the
// sources with esbuild in the repository; the packaged skill ships it
// precompiled (assets/runtime.json) and has no build dependency.
export async function compileRuntime({ modelCodecPath } = {}) {
  const { build } = await import("esbuild"),
    { bundledPackages, packageEntries } = await import(
      "../../shared/notices.mjs"
    ),
    { dataNotices } = await import("./notices.mjs"),
    plugins = modelCodecPath
      ? [
          {
            name: "experimental-document-codec",
            setup(b) {
              b.onResolve({ filter: /^\.\/document-model\.mjs$/ }, () => ({
                path: resolve(modelCodecPath),
              }));
            },
          },
        ]
      : [],
    bundle = (entry, withPlugins) =>
      build({
        plugins: withPlugins ? plugins : [],
        entryPoints: [new URL(entry, root).pathname],
        bundle: true,
        minify: true,
        format: "esm",
        platform: "browser",
        target: "es2022",
        write: false,
        metafile: true,
        legalComments: "none",
      }),
    result = await bundle("runtime/app.mjs", true),
    worker = await bundle("runtime/worker.mjs", false),
    recovery = await bundle("runtime/recovery-worker.mjs", true),
    // CSV and XLSX import (T15) and refresh (T16) are a separate chunk, run
    // only when a file is imported.
    importer = await bundle("runtime/import.mjs", false),
    text = (output) =>
      output.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  return {
    js: text(result),
    worker: text(worker),
    recovery: text(recovery),
    importer: text(importer),
    css:
      (await readFile(new URL("../shared/shell/shell.css", root), "utf8")) +
      (await readFile(new URL("../shared/shell/drawer.css", root), "utf8")) +
      (await readFile(new URL("../shared/shell/panels.css", root), "utf8")) +
      (await readFile(new URL("runtime/style.css", root), "utf8")) +
      charteCSS(),
    // Retained IronCalc/Rust texts, any npm package esbuild bundled, ECharts,
    // which offline builds embed and the editor may load (T18), and SheetJS,
    // which offline builds embed and XLSX import may load (T15).
    notices: dataNotices(
      await readFile(new URL("engine/THIRD-PARTY-NOTICES.txt", root), "utf8"),
      JSON.parse(await readFile(new URL("engine/dependency-audit.json", root))),
      packageEntries([
        ...bundledPackages([
          result.metafile,
          worker.metafile,
          recovery.metafile,
          importer.metafile,
        ]),
        await echartsPackage(),
        await xlsxPackage(),
      ]),
    ),
  };
}

// Sources when they are present (repository), the precompiled runtime
// otherwise (packaged skill).
async function loadRuntime(options) {
  if (await exists(new URL("runtime/app.mjs", root)))
    return compileRuntime(options);
  return JSON.parse(await readFile(new URL("assets/runtime.json", root)));
}

// The default brand: the skill's copy, or the Slides default it mirrors.
async function defaultBrand() {
  for (const file of [
    new URL("assets/default.css", root),
    new URL(
      "../../../plugin/skills/html-slides/assets/default.css",
      import.meta.url,
    ),
  ])
    if (await exists(file)) return file;
  throw new Error("The default brand stylesheet is missing.");
}

// Moved to the shared chart module (T18 Text); exported here as before.
export {
  CHARTE_TOKENS,
  completeCharte,
} from "../../shared/charts/css-theme.mjs";

export async function buildWorkbook(
  input,
  {
    offline = false,
    calculate = true,
    modelCodecPath,
    serializeModel = writeModel,
    formatGuide = guide,
    charte,
    previews = true,
    runtime,
    note = () => {},
  } = {},
) {
  let book = parseWorkbook(stringifyWorkbook(input));
  let brand = await readFile(charte ?? (await defaultBrand()), "utf8");
  if (/<\/style/i.test(brand))
    throw new Error("Brand CSS cannot close its style element");
  if (charte) {
    const completed = completeCharte(
      brand,
      await readFile(await defaultBrand(), "utf8"),
    );
    brand = completed.css;
    if (completed.missing.length)
      note(
        `The charte leaves out ${completed.missing.map((n) => `--${n}`).join(", ")}: the default charte's values are used.`,
      );
  }
  // The pinned engine, its digests checked (engine-node.mjs).
  if (calculate) book = await recalculate(book);
  // Charts open with saved previews drawn from the saved results.
  if (previews) book = await renderPreviews(book, brand);
  const config = JSON.parse(
    await readFile(new URL("engine/manifest.json", root)),
  );
  if (offline) {
    config.embedded = {};
    for (const [name, file] of [
      ["js", "ironcalc.mjs"],
      ["wasm", config.wasm.transport ? "ironcalc.wasm.gz" : "ironcalc.wasm"],
    ])
      config.embedded[name] = (
        await readFile(new URL(`engine/vendor/${file}`, root))
      ).toString("base64");
  }
  runtime ??= await loadRuntime({ modelCodecPath });
  const { js, css, notices } = runtime,
    workerText = runtime.worker,
    recoveryText = runtime.recovery,
    importText = runtime.importer;
  const initial = preview(book.sheets[0], book.locale);
  const rows = initial.rows
    .map(
      (row) =>
        `<tr><th scope="row">${row[0].ref.replace(/[A-Z]+/, "")}</th>` +
        row
          .map(
            ({ ref, cell, text }) =>
              `<td><button class="${cellClasses(cell, !!book.sheets[0].links?.[ref])}" data-cell="${ref}">${esc(text) || "&#160;"}</button></td>`,
          )
          .join("") +
        "</tr>",
    )
    .join("");
  const configText = JSON.stringify(config).replaceAll("<", "\\u003c");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(book.title)}</title><template id="html-data-guide" data-document-content><pre>${esc(formatGuide)}</pre></template><style id="charte">${brand}</style><style>${css}</style></head><body>
<!-- The workbook below is the file's data. Read template#html-data-guide in the head first: what to change, what never to touch, how to edit. -->
<script id="workbook" type="application/json" data-document-content>${serializeModel(book)}</script>
<script id="engine-config" type="application/json">${configText}</script>
<div class="app">${fileBarHTML(book.title)}
${formulaBarHTML}
<main class="canvas" aria-label="Workbook editor"><div id="grid"><table aria-label="${esc(book.sheets[0].name)}"><thead><tr><th></th>${initial.rows[0].map((_, c) => `<th scope="col">${address(1, c + 1).replace(/\d+$/, "")}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></main>
${sheetBarHTML}</div>
${conditionalDialogHTML}
<dialog id="dropdown-dialog" aria-labelledby="dropdown-title"><h2 id="dropdown-title">Dropdown settings</h2><p id="dropdown-context" role="status"></p>
<label for="dropdown-definition">Dropdown definition</label><select id="dropdown-definition"></select>
<label for="dropdown-target-sheet">Target sheet</label><select id="dropdown-target-sheet"></select><label for="dropdown-target-ref">Target range</label><input id="dropdown-target-ref" value="B2">
<label for="dropdown-source-kind">Choices from</label><select id="dropdown-source-kind"><option value="list">Static list</option><option value="range">Cell range</option></select>
<div id="dropdown-list-fields"><label for="dropdown-list-type">List value type</label><select id="dropdown-list-type"><option value="keep">Keep existing typed values</option><option value="text">Text</option><option value="number">Number</option><option value="date">Date (Excel serial)</option><option value="boolean">TRUE / FALSE</option><option value="blank">Blank</option></select><label for="dropdown-list-values">List values</label><textarea id="dropdown-list-values" rows="4"></textarea><p>One value per line. Keep existing typed values preserves all original choices exactly. Select a value type to replace them.</p></div>
<div id="dropdown-range-fields"><label for="dropdown-source-sheet">Source sheet</label><select id="dropdown-source-sheet"></select><label for="dropdown-source-ref">Source range</label><input id="dropdown-source-ref" value="A1:A3"></div>
<label class="checkbox-label"><input id="dropdown-scenario" type="checkbox">Use as scenario selector</label><p>A scenario selector must be one input cell. It replaces the active selector; formulas continue to use their own assumption references.</p>
<div class="sheet-actions"><button id="dropdown-save">Save dropdown</button><button id="dropdown-remove">Remove dropdown</button><button id="dropdown-close">Close dropdown settings</button></div></dialog>
<dialog id="sheet-dialog" aria-labelledby="sheet-title"><h2 id="sheet-title">Manage sheets</h2><p id="sheet-context"></p><label>Sheet name<input id="sheet-name" maxlength="31"></label><label>Destination group<select id="sheet-group" aria-label="Destination group"></select></label><div class="sheet-actions"><button id="sheet-create">Create sheet</button><button id="sheet-rename">Rename selected sheet</button><button id="sheet-move">Move to group</button><button id="sheet-earlier">Move sheet earlier</button><button id="sheet-later">Move sheet later</button><button id="group-earlier">Move group earlier</button><button id="group-later">Move group later</button><button id="sheet-close">Close sheet manager</button></div></dialog>
<dialog id="paste-dialog" aria-labelledby="paste-title"><h2 id="paste-title">Paste values</h2><p>Paste an Excel or Markdown table. Values beginning with = remain literal text. Preview and choose how ambiguous dates/numbers should be read.</p><label>Table text<textarea id="paste-text" rows="6"></textarea></label><div class="paste-options"><label>Table syntax<select id="paste-syntax"><option value="auto">Auto: Excel / Markdown</option><option value="tsv">Excel / TSV</option><option value="markdown">Markdown</option><option value="csv">CSV</option></select></label><label>Value typing<select id="paste-typing"><option value="auto">Automatic, ask if ambiguous</option><option value="text">Keep every value as text</option><option value="en-US">US: 1,234.50 / MM/DD/YYYY</option><option value="fr-FR">European: 1 234,50 / DD/MM/YYYY</option></select></label></div><pre id="paste-preview" role="status"></pre><button id="paste-apply">Apply table</button><button id="paste-cancel">Cancel paste</button></dialog><dialog id="recovery-dialog"><h2>Recover unsaved work</h2><p id="recovery-message"></p><button id="restore-draft">Restore draft</button><button id="discard-draft">Discard draft</button></dialog>
${numberDialogHTML}
${helpDialogHTML(notices)}
<div id="shell-layer" data-shell-mount></div>
<script id="worker-source" type="text/plain">${workerText}</script>
<script id="recovery-worker-source" type="text/plain">${recoveryText}</script>
<script id="import-source" type="text/plain">${importText}</script>
${offline ? `<script id="echarts-source" type="text/plain">${await embeddedECharts()}</script>\n<script id="xlsx-source" type="text/plain">${await xlsxLibrary()}</script>\n` : ""}<script type="module">${js}</script></body></html>`;
  const size = measureHTML(html);
  if (!offline && size.applicationCodeBytes >= STANDARD_CODE_CEILING)
    throw new Error(
      `Embedded application code exceeds budget: ${size.applicationCodeBytes}`,
    );
  return html;
}
// Run directly (not when bundled into the skill's workbook.mjs).
if (
  process.argv[1] &&
  import.meta.url.endsWith("/tools/build.mjs") &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2),
    option = (name) => args[args.indexOf(name) + 1];
  const input = args.includes("--input")
    ? option("--input")
    : new URL("fixtures/two-sheets.json", root);
  const output = args.includes("--output")
    ? option("--output")
    : "dist/data/prototype.html";
  const html = await buildWorkbook(readModel(await readFile(input, "utf8")), {
    offline: args.includes("--offline"),
    charte: args.includes("--charte") ? option("--charte") : undefined,
  });
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, html);
  console.log(JSON.stringify({ output, ...measureHTML(html) }, null, 2));
}
