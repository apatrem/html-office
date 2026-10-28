import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bundledPackages } from "../../shared/notices.mjs";
import { noticeBlocks, noticeProblems } from "../../shared/notices-check.mjs";
import { buildEngine, licenceEntries } from "../tools/build.mjs";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

test("the editor carries the notices of everything bundled in it, each text once", async () => {
  const engine = await buildEngine();
  const packages = bundledPackages([engine.metafile], repo);
  const entries = [
    {
      label: `html-text@${engine.version}/LICENSE`,
      text: await readFile(`${repo}LICENSE`, "utf8"),
    },
    ...licenceEntries(engine.metafile),
  ];
  assert.deepEqual(noticeProblems(entries, engine.notices), []);
  const listed = noticeBlocks(engine.notices).flatMap((b) => b.packages);
  for (const p of packages)
    assert.ok(listed.includes(`${p.name}@${p.version}`), p.name);
  // commonmark's declared dependencies that the editor does not contain.
  assert.ok(!listed.some((name) => /^(entities|minimist)@/.test(name)));
  assert.ok(packages.some((p) => p.name === "prosemirror-view"));
  assert.ok(engine.code.startsWith(`/*! html-text ${engine.version}`));
});
