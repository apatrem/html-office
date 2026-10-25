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

// Reads a saved text back and checks that it is valid and gives the same document. Content the
// HTML parser repaired (a protected block it restructured) may not survive a second parse.
// parse: parse.mjs parseFile in Node, or a DOMParser-based reader in the browser.
export function verifySaved(text, doc, parse) {
  let reopened;
  try {
    reopened = openFile(parse(text)).doc;
  } catch (error) {
    return `the saved file would not open again (${error.message})`;
  }
  return reopened.eq(doc)
    ? null
    : "the saved file would open as a different document";
}

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
  const unstable = verifySaved(canonical, doc, parse);
  let offset = 0;
  while (offset < source.length && source[offset] === canonical[offset])
    offset++;
  return {
    file,
    doc,
    report,
    canonical,
    unstable,
    difference:
      canonical === source ? null : { offset, ...position(source, offset) },
  };
}
