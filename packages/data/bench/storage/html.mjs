import { parse } from "parse5";
import { decodeWorkbook, encodeWorkbook, safeJSON } from "./encodings.mjs";
import {
  DOCUMENT_VERSION,
  readModel,
  writeModel,
} from "../../model/document.mjs";
export function readHTML(html) {
  const nodes = [];
  function visit(node) {
    if (
      node.tagName === "script" &&
      node.attrs?.some((a) => a.name === "id" && a.value === "workbook")
    )
      nodes.push(node);
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(parse(html, { sourceCodeLocationInfo: true }));
  if (
    nodes.length !== 1 ||
    !nodes[0].attrs.some(
      (a) => a.name === "type" && a.value === "application/json",
    )
  )
    throw new Error("Expected one inert script#workbook");
  const location = nodes[0].sourceCodeLocation;
  if (!location?.endTag) throw new Error("Missing workbook closing tag");
  const start = location.startTag.endOffset,
    end = location.endTag.startOffset,
    payload = JSON.parse(html.slice(start, end));
  return {
    book:
      payload.version === DOCUMENT_VERSION
        ? readModel(html.slice(start, end))
        : decodeWorkbook(payload),
    encoding:
      payload.version === DOCUMENT_VERSION
        ? "hybrid"
        : (payload.storageExperiment?.encoding ?? "per-cell"),
    start,
    end,
  };
}
export function replaceHTML(html, read, book) {
  return (
    html.slice(0, read.start) +
    (read.encoding === "hybrid"
      ? writeModel(book)
      : safeJSON(encodeWorkbook(book, read.encoding))) +
    html.slice(read.end)
  );
}
