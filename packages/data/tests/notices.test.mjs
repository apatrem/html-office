import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { buildWorkbook } from "../tools/build.mjs";
import { retainedNotices } from "../tools/notices.mjs";
import { bundledPackages, packageEntries } from "../../shared/notices.mjs";
import { noticeBlocks, noticeProblems } from "../../shared/notices-check.mjs";
import { pnl } from "../fixtures/generate.mjs";

const engine = new URL("../engine/", import.meta.url),
  file = await readFile(new URL("THIRD-PARTY-NOTICES.txt", engine), "utf8"),
  audit = JSON.parse(await readFile(new URL("dependency-audit.json", engine)));
const unescape = (html) =>
  html.replace(
    /&(amp|lt|gt|quot|#39);/g,
    (_, c) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[c],
  );
const embedded = (html) =>
  unescape(
    /<details data-section="notices"><summary>[^<]*<\/summary><pre>([\s\S]*?)<\/pre>/.exec(
      html,
    )[1],
  );

test("retained IronCalc notices are read back exactly as audit.py wrote them", () => {
  const { title, entries } = retainedNotices(file, audit);
  assert.equal(title, "HTML Office typed IronCalc build — third-party notices");
  assert.equal(entries.length, 147);
  assert.throws(
    () =>
      retainedNotices(file.replace("Apache License", "Apache Licence"), audit),
    /digest order|missing/,
  );
});

test("embedded notices attribute every Cargo package and bundled npm package once", async () => {
  const notices = embedded(await buildWorkbook(pnl()));
  assert.equal(
    embedded(await buildWorkbook(pnl(), { offline: true })),
    notices,
  );
  // The runtime bundles carry no npm package today; any added later must be
  // attributed with its own licence files.
  const metafiles = [];
  for (const entry of ["app.mjs", "worker.mjs", "recovery-worker.mjs"])
    metafiles.push(
      (
        await build({
          entryPoints: [
            new URL("../runtime/" + entry, import.meta.url).pathname,
          ],
          bundle: true,
          write: false,
          metafile: true,
          format: "esm",
          platform: "browser",
          logLevel: "silent",
        })
      ).metafile,
    );
  const entries = [
    ...retainedNotices(file, audit).entries,
    ...packageEntries(bundledPackages(metafiles)),
  ];
  assert.deepEqual(noticeProblems(entries, notices), []);
  const listed = new Set(noticeBlocks(notices).flatMap((b) => b.packages));
  for (const { name, version } of audit.packages)
    assert.ok(listed.has(`${name}@${version}`), `${name}@${version} listed`);
  assert.ok(listed.has("ironcalc_base@0.9.0"));
  assert.ok(listed.has("Rust 1.95.0 standard-library copyright/attributions"));
  // L01: 197,573 retained bytes are stored as about 53 KB.
  assert.ok(Buffer.byteLength(notices) < 60000, Buffer.byteLength(notices));
});
