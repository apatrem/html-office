import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const root = new URL("../engine/", import.meta.url);
const commit = execFileSync(
  "git",
  ["log", "-1", "--format=%H", "--", "packages/data/engine/vendor/"],
  { encoding: "utf8" },
).trim();
const manifest = {
  version: "ironcalc/0.9.0+html-office-typed.1",
  sourceCommit: "297553dc3a37ec6b0f4821055220e3d26c4ac6a1",
  artifactCommit: commit,
};
for (const [name, file] of [
  ["js", "ironcalc.mjs"],
  ["wasm", "ironcalc.wasm"],
]) {
  const bytes = await readFile(new URL(`vendor/${file}`, root));
  manifest[name] = {
    url: `https://raw.githubusercontent.com/apatrem/html-office/${commit}/packages/data/engine/vendor/${file}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
}
const compressed = await readFile(new URL("vendor/ironcalc.wasm.gz", root));
manifest.wasm.url += ".gz";
manifest.wasm.transport = {
  encoding: "gzip",
  sha256: createHash("sha256").update(compressed).digest("hex"),
  bytes: compressed.length,
};
await writeFile(
  new URL("manifest.json", root),
  JSON.stringify(manifest, null, 2) + "\n",
);
