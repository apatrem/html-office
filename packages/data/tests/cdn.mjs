// Optional online provenance smoke; deterministic failure tests use intercepted exact bytes.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { buildWorkbook } from "../tools/build.mjs";
const book = JSON.parse(
    await readFile(new URL("../fixtures/two-sheets.json", import.meta.url)),
  ),
  manifest = JSON.parse(
    await readFile(new URL("../engine/manifest.json", import.meta.url)),
  );
await mkdir("dist/data-test", { recursive: true });
const file = resolve("dist/data-test/online.html");
await writeFile(file, await buildWorkbook(book));
const browser = await chromium.launch();
try {
  const context = await browser.newContext(),
    page = await context.newPage(),
    responses = [];
  let beforeEdit = true;
  context.on("response", (r) => {
    if (r.url().startsWith("https://raw.githubusercontent.com/"))
      responses.push({ response: r, beforeEdit });
  });
  await page.goto(pathToFileURL(file).href);
  await page.getByText("Saved results are current.", { exact: true }).waitFor();
  assert.equal(responses.length, 0);
  beforeEdit = false;
  await page.getByLabel("Cell value").fill("140");
  await page.getByRole("button", { name: "Apply edit" }).click();
  await page
    .getByText("Calculated locally. Unsaved changes.", { exact: true })
    .waitFor({ timeout: 60000 });
  assert.equal(responses.length, 2);
  const items = [];
  for (const { response, beforeEdit } of responses) {
    const body = await response.body(),
      kind = response.url().includes(".wasm") ? "wasm" : "js";
    assert.equal(
      createHash("sha256").update(body).digest("hex"),
      (manifest[kind].transport ?? manifest[kind]).sha256,
    );
    assert.equal(beforeEdit, false);
    assert.equal((await response.request().allHeaders()).referer, undefined);
    items.push({
      kind,
      url: response.url(),
      sha256: (manifest[kind].transport ?? manifest[kind]).sha256,
      fetchedBodyBytes: body.length,
      wasmDecodedBytes: kind === "wasm" ? manifest.wasm.bytes : null,
      contentEncoding:
        (await response.allHeaders())["content-encoding"] ?? null,
      wireSizes: await response.request().sizes(),
      timing: response.request().timing(),
    });
  }
  const report = {
    date: new Date().toISOString(),
    browser: browser.version(),
    method:
      "Fresh file:// workbook, real HTTPS requests on first edit, no interception. wireSizes reports browser-observed encoded body plus separate header sizes.",
    items,
  };
  await writeFile(
    "packages/data/bench/cdn-results.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
