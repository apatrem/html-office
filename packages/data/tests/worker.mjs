import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build } from "esbuild";
import { buildWorkbook } from "../tools/build.mjs";
const book = JSON.parse(
  await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
);
const out = resolve("dist/data-test");
await mkdir(out, { recursive: true });
const bundled = await build({
  stdin: {
    contents:
      "export {EngineClient} from './packages/data/runtime/client.mjs'; export {readModel} from './packages/data/model/document.mjs';",
    resolveDir: fileURLToPath(new URL("../../../", import.meta.url)),
  },
  format: "esm",
  bundle: true,
  write: false,
  platform: "browser",
  target: "es2022",
});
const html = await buildWorkbook(book, { offline: true });
const file = resolve(out, "worker-probe.html");
await writeFile(
  file,
  html.replace(
    "</body>",
    `<script type="module">${bundled.outputFiles[0].text}\nglobalThis.Client=EngineClient;globalThis.readDocument=readModel;</script></body>`,
  ),
);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(file).href);
  await page.waitForFunction(() => globalThis.Client);
  const result = await page.evaluate(async () => {
    const client = new Client(
      JSON.parse(document.querySelector("#engine-config").textContent),
      document.querySelector("#worker-source").textContent,
    );
    try {
      await client.load(
        readDocument(document.querySelector("#workbook").textContent),
      );
      await client.edit("inputs", "B2", {
        input: { type: "number", value: 160 },
      });
      const delta = await client.calculate();
      return { delta, hasSheets: "sheets" in delta };
    } finally {
      client.dispose();
    }
  });
  assert.equal(
    result.hasSheets,
    false,
    "worker replies must not clone the entire raw dataset to the UI",
  );
  assert.equal(
    result.delta.results.find((r) => r.ref === "B2").result.value,
    4000,
  );
  console.log(
    "PASS worker typed edit returns only formula results and snapshot",
  );
} finally {
  await browser.close();
}
