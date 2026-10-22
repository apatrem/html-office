// Regenerates ironcalc-static.json from the pinned engine source (requires cargo).
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile, copyFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const here = dirname(fileURLToPath(import.meta.url)),
  repo = resolve(here, "../../..");
const revision = "297553dc3a37ec6b0f4821055220e3d26c4ac6a1";
const index = process.argv.indexOf("--source");
if (index < 0)
  throw new Error("Supply --source PATH to the pinned IronCalc checkout");
const work = resolve(repo, "dist/toolbar-preact/extract");
await rm(work, { recursive: true, force: true });
await mkdir(resolve(work, "src"), { recursive: true });
const archive = execFileSync(
  "git",
  ["archive", revision, "base", "Cargo.lock"],
  {
    cwd: resolve(process.argv[index + 1]),
    maxBuffer: 50_000_000,
  },
);
execFileSync("tar", ["-x", "-C", work], { input: archive });
await copyFile(resolve(here, "extract/main.rs"), resolve(work, "src/main.rs"));
await writeFile(
  resolve(work, "Cargo.toml"),
  '[package]\nname = "extract"\nversion = "0.0.0"\nedition = "2021"\n[dependencies]\nironcalc_base = { path = "base" }\nserde_json = "1.0"\n[workspace]\n',
);
const json = JSON.parse(
  execFileSync("cargo", ["run", "--offline", "--release", "-q"], {
    cwd: work,
    maxBuffer: 50_000_000,
  }),
);
const data = {
  source: {
    revision,
    archiveSha256: createHash("sha256").update(archive).digest("hex"),
  },
  ...json,
};
await writeFile(
  resolve(here, "ironcalc-static.json"),
  JSON.stringify(data, null, 1) + "\n",
);
console.log(
  Object.fromEntries(Object.entries(json).map(([k, v]) => [k, v.length])),
);
