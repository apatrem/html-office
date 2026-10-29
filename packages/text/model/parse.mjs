// Node only: parses a complete file with parse5 into the plain tree of html.mjs, with source locations.
// parse5 follows the HTML parsing algorithm, so the tree matches what a browser builds from the same bytes.
import { parse } from "parse5";
import { MAX_DEPTH } from "./html.mjs";

const NAMESPACES = {
  "http://www.w3.org/1999/xhtml": "html",
  "http://www.w3.org/2000/svg": "svg",
  "http://www.w3.org/1998/Math/MathML": "math",
};

function location(l) {
  if (!l) return undefined;
  const attrs = {};
  for (const [name, a] of Object.entries(l.attrs ?? {}))
    attrs[name] = { line: a.startLine, col: a.startCol };
  return {
    line: l.startLine,
    col: l.startCol,
    offset: l.startOffset,
    end: l.endOffset,
    // Where the end tag starts, when the source has one.
    ...(l.endTag ? { closing: l.endTag.startOffset } : {}),
    attrs,
  };
}

function convert(node, depth = 0) {
  const loc = location(node.sourceCodeLocation);
  if (node.nodeName === "#text")
    return { type: "text", value: node.value, loc };
  if (node.nodeName === "#comment")
    return { type: "comment", value: node.data, loc };
  const ns = NAMESPACES[node.namespaceURI] ?? "html";
  const source =
    ns === "html" && node.nodeName === "template" ? node.content : node;
  const children = source.childNodes.filter(
    (child) => child.nodeName !== "#documentType",
  );
  return {
    type: "element",
    name: node.tagName,
    ns,
    attrs: node.attrs.map((a) => [
      a.prefix ? `${a.prefix}:${a.name}` : a.name,
      a.value,
    ]),
    children:
      depth < MAX_DEPTH
        ? children.map((child) => convert(child, depth + 1))
        : [],
    ...(depth >= MAX_DEPTH && children.length ? { truncated: true } : {}),
    loc,
  };
}

// Returns {doctype, children, html}: the doctype name (or null), the document's top-level nodes and the html element.
export function parseFile(source) {
  const document = parse(source, { sourceCodeLocationInfo: true });
  const doctype = document.childNodes.find(
    (n) => n.nodeName === "#documentType",
  );
  const children = document.childNodes
    .filter((n) => n.nodeName !== "#documentType")
    .map(convert);
  return {
    doctype: doctype ? doctype.name : null,
    children,
    html: children.find((n) => n.type === "element" && n.name === "html"),
  };
}
