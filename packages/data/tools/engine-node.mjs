// The pinned IronCalc engine for Node tools (T20): the same JavaScript
// wrapper and WASM the browser verifies, checked against the manifest's
// SHA-256 digests before use.
import { readFile, access } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EngineSession } from "../engine/adapter.mjs";
import { pivotEdits, pivotLabel } from "../model/pivot.mjs";
import { parseAddress, parseRange } from "../model/workbook.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// Where the engine files are: engine/ next to tools/, in the repository
// package and in the packaged skill alike.
export async function engineFiles(base = here) {
  const dir = join(base, "../engine/vendor");
  if (!(await exists(join(dir, "ironcalc.mjs"))))
    throw new Error(
      "The calculation engine is missing: expected engine/vendor/ironcalc.mjs next to tools/.",
    );
  return {
    js: join(dir, "ironcalc.mjs"),
    wasm: join(dir, "ironcalc.wasm.gz"),
    manifest: join(base, "../engine/manifest.json"),
  };
}

let loaded = null;
// The verified engine module, initialised once per process.
export async function loadEngine() {
  if (loaded) return loaded;
  const files = await engineFiles(),
    manifest = JSON.parse(await readFile(files.manifest, "utf8")),
    js = await readFile(files.js),
    transport = await readFile(files.wasm);
  if (sha256(js) !== manifest.js.sha256)
    throw new Error("Engine JavaScript does not match its pinned digest.");
  if (
    manifest.wasm.transport &&
    sha256(transport) !== manifest.wasm.transport.sha256
  )
    throw new Error("Engine WASM archive does not match its pinned digest.");
  const wasm = gunzipSync(transport);
  if (sha256(wasm) !== manifest.wasm.sha256)
    throw new Error("Engine WASM does not match its pinned digest.");
  const module = await import(pathToFileURL(files.js).href);
  await module.default({ module_or_path: wasm });
  return (loaded = module);
}

// A full recalculation: every formula result and a current snapshot.
export async function recalculate(book) {
  const session = new EngineSession(await loadEngine());
  try {
    session.load(book);
    return await session.calculate();
  } finally {
    session.dispose();
  }
}

// Recalculates, then refreshes every pivot table in definition order, as
// Data › Refresh all pivot tables does: each writes its output cells and
// its source stamp; a failing pivot stops with its reason. `committed` holds
// the definitions before a patch changed them: their output is what a
// refresh may release, and any other cell it would cover must be empty. A
// cell an earlier pivot of the same run wrote is no longer released.
export async function refreshPivots(book, committed = book.pivots ?? []) {
  const session = new EngineSession(await loadEngine()),
    written = [],
    within = (outputs, sheetId, ref) => {
      const { row, column } = parseAddress(ref);
      return outputs.some(
        (w) =>
          w.sheetId === sheetId &&
          row >= w.rect.top &&
          row <= w.rect.bottom &&
          column >= w.rect.left &&
          column <= w.rect.right,
      );
    };
  try {
    session.load(book);
    for (const { id } of book.pivots ?? []) {
      const current = session.book,
        definition = current.pivots.find((p) => p.id === id);
      let result;
      try {
        const computed = await session.pivot(definition);
        result = pivotEdits(current, definition, computed, {
          previous: committed.find((p) => p.id === id),
          fingerprint: computed.fingerprint,
          at: new Date().toISOString(),
        });
      } catch (error) {
        throw new Error(
          `Pivot table "${pivotLabel(definition)}" not refreshed: ${error.message}`,
        );
      }
      const output = {
        sheetId: result.pivot.output.sheetId,
        rect: parseRange(result.pivot.output.ref),
      };
      // Edits outside its own output release the committed footprint.
      session.editMany(
        result.edits.filter(
          ({ sheetId, ref }) =>
            within([output], sheetId, ref) || !within(written, sheetId, ref),
        ),
      );
      written.push(output);
      session.book.pivots = session.book.pivots.map((p) =>
        p.id === id ? result.pivot : p,
      );
    }
    return await session.calculate();
  } finally {
    session.dispose();
  }
}
