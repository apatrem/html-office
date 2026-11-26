// The command-line tool must not end with exit code 0 and nothing written
// when the calculation engine never starts (its asynchronous instantiation
// never settles and the event loop empties; seen with V8's
// --no-wasm-lazy-compilation on Node 26). The preload below reproduces that
// on any Node version by making WebAssembly.instantiate never settle.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile),
  tool = fileURLToPath(new URL("../tools/workbook.mjs", import.meta.url)),
  model = fileURLToPath(
    new URL("../examples/valid/budget.json", import.meta.url),
  ),
  exists = (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
  node = (args) =>
    run(process.execPath, args).then(
      ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
      (error) => ({
        code: error.code,
        stdout: error.stdout,
        stderr: error.stderr,
      }),
    );

test("a command whose engine never starts fails loudly and writes nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tool-exit-")),
    hang = join(dir, "hang.cjs"),
    out = join(dir, "never.html");
  try {
    await writeFile(
      hang,
      "WebAssembly.instantiate = () => new Promise(() => {});\n",
    );
    const result = await node([
      "--require",
      hang,
      tool,
      "new",
      out,
      "--model",
      model,
    ]);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /ended before it finished/);
    assert.match(result.stderr, /engine did not start/);
    assert.equal(result.stderr.trim().split("\n").length, 1);
    assert.equal(await exists(out), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a normal run still exits 0 with its usual output, and an error reports itself once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tool-exit-")),
    out = join(dir, "book.html");
  try {
    const made = await node([tool, "new", out, "--model", model]);
    assert.equal(made.code, 0);
    assert.match(
      made.stdout,
      /^Created .*book\.html \(standard, [\d,]+ bytes\); results current\.\n$/,
    );
    assert.equal(made.stderr, "");
    assert.ok((await readFile(out, "utf8")).length > 0);
    const missing = await node([tool, "new", join(dir, "x.html")]);
    assert.equal(missing.code, 2);
    assert.equal(missing.stderr.split("new needs --model").length, 2);
    assert.doesNotMatch(missing.stderr, /ended before it finished/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
