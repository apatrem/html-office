import { readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { resolve } from "node:path";
const directory = process.argv[2]
  ? resolve(process.argv[2])
  : new URL("../engine/vendor/", import.meta.url);
const file =
  directory instanceof URL
    ? new URL("ironcalc.wasm", directory)
    : resolve(directory, "ironcalc.wasm");
const bytes = await readFile(file);
await writeFile(
  directory instanceof URL
    ? new URL("ironcalc.wasm.gz", directory)
    : resolve(directory, "ironcalc.wasm.gz"),
  gzipSync(bytes, { level: 9 }),
);
