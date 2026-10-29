#!/usr/bin/env node
// Markdown export of a Text document (T15), the projection the editor's Markdown view shows:
//   node markdown.mjs <document.html> [<output.md>]
// Lossy and one-way (FORMAT.md › Markdown view and export): the HTML file stays the document.
// Without an output file the Markdown goes to standard output. Exit code 1 for an invalid file.
import { readFile, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseFile } from "../model/parse.mjs";
import { openFile } from "../editor/schema/document.mjs";
import { fileFormat } from "../editor/numbering.mjs";
import { toMarkdown } from "../editor/markdown.mjs";

// The Markdown of a document's source; throws for a file with errors.
export function markdownSource(source) {
  const file = parseFile(source);
  return toMarkdown(openFile(file).doc, { format: fileFormat(file) });
}

// Run as a command, also through a symbolic link or a path with escaped characters.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [input, output] = process.argv.slice(2);
  if (!input) {
    console.error("usage: markdown.mjs <document.html> [<output.md>]");
    process.exit(2);
  }
  let result;
  try {
    result = markdownSource(await readFile(input, "utf8"));
  } catch (error) {
    console.error(`${input}: ${error.message} (run check.mjs)`);
    process.exit(1);
  }
  if (output) await writeFile(output, result.markdown);
  else process.stdout.write(result.markdown);
}
