import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url)),
  out = resolve(here, "../../../dist/toolbar-functional");
if (!process.argv[2])
  throw new Error(
    "Supply a new destination directory for the generated samples",
  );
const destination = resolve(process.argv[2]);
// A new directory protects a previous sample that the user may have edited.
await mkdir(destination, { recursive: false });
const report = JSON.parse(
  await readFile(resolve(out, "build-results.json"), "utf8"),
);
for (const file of report.sizes.map((s) => s.file))
  await copyFile(resolve(out, file), resolve(destination, file));
const rows = [
  [
    "cdn",
    "A · IronCalc through CDN",
    "The real toolbar loads on activation. Internet is required for a first load; the offline variant embeds it.",
  ],
  [
    "native",
    "B · Lightweight implementation",
    "Native controls and static SVG icons; no toolbar download. A visual approximation, with a native format menu.",
  ],
  [
    "embedded",
    "C · Compressed IronCalc in HTML",
    "The same actual toolbar is embedded as gzip/Base64. No toolbar download; exceeds the current standard code budget.",
  ],
]
  .map(([mode, label, note]) => {
    const standard = report.sizes.find(
      (s) => s.file === `toolbar-${mode}.html`,
    );
    return `<tr><th scope="row">${label}</th><td>${standard.applicationCodeBytes.toLocaleString("en-US")} bytes</td><td><a href="toolbar-${mode}.html">Open standard</a><br><a href="toolbar-${mode}-offline.html">Open fully offline</a></td><td>${note}</td></tr>`;
  })
  .join("");
await writeFile(
  resolve(destination, "index.html"),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HTML Data — toolbar comparison</title><style>body{font:15px/1.55 Arial,sans-serif;color:#0b2031;margin:32px auto;padding:0 20px;max-width:1080px;background:#f5f7fa}h1{font-size:28px}table{width:100%;border-collapse:collapse;background:white}th,td{text-align:left;vertical-align:top;border:1px solid #d7dde3;padding:14px}thead{background:#0b2031;color:white}a{color:#005b9f}small{color:#455a6a}@media(max-width:650px){body{margin:16px auto}th,td{padding:8px;font-size:12px}}</style><h1>Compare the three editing toolbars</h1><p>All samples use the same fictional 24-month P&amp;L, scenarios and calculation engine. Click <strong>Enable editing toolbar</strong> in each file. Use <strong>Existing editing commands / fallback</strong> for the rest of the editor.</p><table><thead><tr><th>Option</th><th>Stored application content<br><small style="color:white">500,000-byte standard ceiling</small></th><th>Samples</th><th>What changes</th></tr></thead><tbody>${rows}</tbody></table><p>Grey toolbar actions are unsupported by the current workbook model. The working actions include number formats, undo/redo, conditional formatting and grid lines. Picking a toolbar will not automatically add fonts, borders or merging.</p><p>Standard files still load the calculation engine for a calculation-changing edit. Fully offline files embed both the engine and toolbar and can edit without a connection. Workbook data remains readable JSON in every file.</p><p><strong>Recommendation for discussion:</strong> actual IronCalc through CDN in standard mode, embedded in <code>--offline</code>. The default editor has not changed; import remains paused.</p><small>Experimental assessment only. No production delivery choice has been made.</small></html>`,
);
console.log(resolve(destination, "index.html"));
