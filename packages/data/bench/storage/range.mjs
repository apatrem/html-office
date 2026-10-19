import { readFile, writeFile } from "node:fs/promises";
import { readHTML, replaceHTML } from "./html.mjs";
import { writeCell, structuralEdit } from "./operations.mjs";
import { parseRange, address } from "../../model/workbook.mjs";
import { EngineSession } from "../../engine/adapter.mjs";
const [command, input, ...args] = process.argv.slice(2);
if (!["inspect", "apply"].includes(command) || !input)
  throw new Error(
    "Usage: range.mjs inspect file.html sheet-id A1:B5 | apply file.html patch.json output.html [--recalculate]",
  );
const html = await readFile(input, "utf8"),
  read = readHTML(html);
let book = read.book;
if (command === "inspect") {
  const [sheetId, ref] = args,
    r = parseRange(ref),
    sheet = book.sheets.find((s) => s.id === sheetId);
  if (!sheet) throw new Error("Unknown sheet ID");
  if ((r.bottom - r.top + 1) * (r.right - r.left + 1) > 5000)
    throw new Error("Inspect at most 5000 cells per call");
  const cells = [];
  for (let row = r.top; row <= r.bottom; row++)
    for (let col = r.left; col <= r.right; col++) {
      const ref = address(row, col);
      cells.push({ ref, cell: sheet.cells[ref] ?? null });
    }
  console.log(JSON.stringify({ sheetId, cells }, null, 2));
} else {
  const [patchFile, output] = args;
  if (!patchFile || !output || output === input)
    throw new Error("Provide a patch and a different output path");
  const patch = JSON.parse(await readFile(patchFile, "utf8"));
  let module;
  if (patch.structural?.length || args.includes("--recalculate")) {
    module = await import("../../engine/vendor/ironcalc.mjs");
    await module.default({
      module_or_path: await readFile(
        new URL("../../engine/vendor/ironcalc.wasm", import.meta.url),
      ),
    });
  }
  for (const edit of patch.edits ?? [])
    writeCell(book, edit.sheetId, edit.ref, edit.cell);
  for (const operation of patch.structural ?? [])
    book = await structuralEdit(book, module, operation);
  if (args.includes("--recalculate")) {
    const session = new EngineSession(module);
    try {
      session.load(book);
      book = await session.calculate();
    } finally {
      session.dispose();
    }
  }
  const updated = replaceHTML(html, read, book);
  readHTML(updated);
  await writeFile(output, updated);
  console.log(
    JSON.stringify({
      output,
      encoding: read.encoding,
      recalculated: args.includes("--recalculate"),
    }),
  );
}
