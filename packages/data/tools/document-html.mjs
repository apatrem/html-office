// The canonical workbook inside an HTML Data file (T20): one inert
// script#workbook[type="application/json"]. Rewrites replace only that
// payload, so everything else in the file stays byte-identical.
import { parse } from "parse5";
import { readModel, writeModel } from "../model/document.mjs";

// Where the payload is, without reading it.
export function locatePayload(html) {
  const found = [];
  (function visit(node) {
    if (
      node.tagName === "script" &&
      node.attrs?.some((a) => a.name === "id" && a.value === "workbook")
    )
      found.push(node);
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content) visit(node.content);
  })(parse(html, { sourceCodeLocationInfo: true }));
  if (found.length !== 1)
    throw new Error(
      `Not an HTML Data file: expected one script#workbook, found ${found.length}.`,
    );
  const [node] = found;
  if (
    !node.attrs.some((a) => a.name === "type" && a.value === "application/json")
  )
    throw new Error('script#workbook must have type="application/json".');
  const location = node.sourceCodeLocation;
  if (!location?.endTag) throw new Error("script#workbook is not closed.");
  return {
    start: location.startTag.endOffset,
    end: location.endTag.startOffset,
  };
}

export function readDocument(html) {
  const { start, end } = locatePayload(html);
  return { book: readModel(html.slice(start, end)), start, end };
}

// The file with a new workbook payload; the result is read back to prove it.
export function writeDocument(html, read, book) {
  const next =
    html.slice(0, read.start) + writeModel(book) + html.slice(read.end);
  readDocument(next);
  return next;
}

// The text outside the payload, which edits never change.
export const outside = (html, read) =>
  html.slice(0, read.start) + html.slice(read.end);

// The brand stylesheet (style#charte), used to draw chart previews.
export function charteCSS(html) {
  return /<style id="charte">([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
}
