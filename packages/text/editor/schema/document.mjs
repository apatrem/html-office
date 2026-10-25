// Validated file to ProseMirror document and back: the round trip T02 must keep byte for byte.
import { elements } from "../../model/html.mjs";
import { serializeFile } from "../../model/file.mjs";
import { validateFile } from "../../model/validate.mjs";
import { toDoc } from "./parse.mjs";
import { articleHTML } from "./serialize.mjs";

export const findArticle = (file) =>
  elements(elements(file.html).find((n) => n.name === "body")).find(
    (n) => n.name === "article",
  );

// Refuses a file with errors; protected blocks are kept as they are.
export function openFile(file) {
  const report = validateFile(file);
  if (!report.ok) {
    const error = new Error(
      `${report.errors.length} error(s): ${report.errors[0].message}`,
    );
    error.report = report;
    throw error;
  }
  return { doc: toDoc(findArticle(file), report.blocks), report };
}

export const saveFile = (file, doc) => serializeFile(file, articleHTML(doc));

// Line and column (1-based) of an offset in a source text.
export function position(source, offset) {
  const before = source.slice(0, offset).split("\n");
  return { line: before.length, col: before.at(-1).length + 1 };
}

// The canonical serialisation of a valid source, and where the source first differs from it.
export function canonicalize(source, parse) {
  const file = parse(source);
  const { doc, report } = openFile(file);
  const canonical = saveFile(file, doc);
  let offset = 0;
  while (offset < source.length && source[offset] === canonical[offset])
    offset++;
  return {
    file,
    doc,
    report,
    canonical,
    difference:
      canonical === source ? null : { offset, ...position(source, offset) },
  };
}
