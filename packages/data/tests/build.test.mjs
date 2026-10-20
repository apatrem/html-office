import { gunzipSync } from "node:zlib";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { buildWorkbook, measureHTML } from "../tools/build.mjs";
import { pnl } from "../fixtures/generate.mjs";
import { ENGINE } from "../engine/identity.mjs";
test("pinned executable digests and retained notices match committed artifacts", async () => {
  const base = new URL("../engine/", import.meta.url),
    manifest = JSON.parse(await readFile(new URL("manifest.json", base)));
  assert.match(manifest.artifactCommit, /^[a-f0-9]{40}$/);
  assert.equal(manifest.version, ENGINE);
  assert.equal(
    createHash("sha256")
      .update(await readFile(new URL("formula-compatibility.patch", base)))
      .digest("hex"),
    manifest.compatibilityPatchSha256,
  );
  for (const [kind, file] of [
    ["js", "ironcalc.mjs"],
    ["wasm", "ironcalc.wasm"],
  ]) {
    const data = await readFile(new URL("vendor/" + file, base));
    assert.equal(
      createHash("sha256").update(data).digest("hex"),
      manifest[kind].sha256,
    );
    assert.equal(data.length, manifest[kind].bytes);
    assert.ok(manifest[kind].url.includes("/" + manifest.artifactCommit + "/"));
    assert.ok(
      !data.includes(Buffer.from("/Users/")),
      "build must not expose local paths",
    );
  }
  const compressed = await readFile(new URL("vendor/ironcalc.wasm.gz", base));
  assert.equal(
    createHash("sha256").update(compressed).digest("hex"),
    manifest.wasm.transport.sha256,
  );
  assert.equal(
    createHash("sha256").update(gunzipSync(compressed)).digest("hex"),
    manifest.wasm.sha256,
  );
  const audit = JSON.parse(
      await readFile(new URL("dependency-audit.json", base)),
    ),
    notices = await readFile(new URL("THIRD-PARTY-NOTICES.txt", base));
  assert.equal(
    createHash("sha256").update(notices).digest("hex"),
    audit.noticesSha256,
  );
});
test("standard code budget includes notices and preview scaffold; linked fictional P&L has known totals", async () => {
  const book = pnl(),
    html = await buildWorkbook(book),
    size = measureHTML(html);
  assert.ok(size.applicationCodeBytes < 500000);
  assert.equal(
    size.applicationCodeBytes + size.documentContentBytes,
    size.totalHTMLBytes,
  );
  assert.ok(html.includes("HTML Office typed IronCalc build"));
  assert.ok(!html.includes('"embedded":'));
  const saved = JSON.parse(
    /<script id="workbook"[^>]*>([\s\S]*?)<\/script>/.exec(html)[1],
  );
  assert.ok(
    Math.abs(
      saved.sheets[0].cells.B2.result.value -
        book.metadata.benchmark.expectedRevenue,
    ) < 1e-7,
  );
  assert.ok(
    Math.abs(
      saved.sheets[0].cells.B3.result.value -
        book.metadata.benchmark.expectedNetIncome,
    ) < 1e-7,
  );
  assert.equal(saved.sheets[0].cells.B4.result.type, "number");
  assert.ok(
    Math.abs(
      saved.sheets[0].cells.B4.result.value -
        book.metadata.benchmark.expectedNPV,
    ) < 1e-7,
  );
});
