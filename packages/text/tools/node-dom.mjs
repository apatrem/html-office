// A small DOM in Node (T18), enough for the browser modules the document tools reuse: the paste
// mapping (editor/clipboard/html.mjs) reads a parsed fragment, and the shared SVG allow-list
// (packages/shared/charts/clipboard.mjs sanitizeSVG) reads one and builds a new element tree.
// Fragments are parsed by parse5 in a <template> context, as parseInert does in the browser:
// nothing runs or loads.
import { parseFragment } from "parse5";

const XMLNS = {
  html: "http://www.w3.org/1999/xhtml",
  svg: "http://www.w3.org/2000/svg",
};

class Text {
  constructor(data) {
    this.nodeType = 3;
    this.data = data;
    this.childNodes = [];
  }
  get textContent() {
    return this.data;
  }
}

class Comment extends Text {
  constructor(data) {
    super(data);
    this.nodeType = 8;
  }
}

export class Element {
  constructor(localName, namespaceURI = XMLNS.html, nodeType = 1) {
    this.nodeType = nodeType;
    this.localName = localName;
    this.namespaceURI = namespaceURI;
    this.attributes = [];
    this.childNodes = [];
  }
  get children() {
    return this.childNodes.filter((n) => n.nodeType === 1);
  }
  get textContent() {
    return this.childNodes.map((n) => n.textContent).join("");
  }
  getAttribute(name) {
    return (
      this.attributes.find((a) => !a.namespaceURI && a.name === name)?.value ??
      null
    );
  }
  setAttribute(name, value) {
    const found = this.attributes.find(
      (a) => !a.namespaceURI && a.name === name,
    );
    if (found) found.value = String(value);
    else
      this.attributes.push({ name, value: String(value), namespaceURI: null });
  }
  removeAttribute(name) {
    this.attributes = this.attributes.filter(
      (a) => a.namespaceURI || a.name !== name,
    );
  }
  appendChild(node) {
    this.childNodes.push(node);
    return node;
  }
}

// parse5's tree as Element and Text nodes; a template's content is its `content` fragment.
function convert(node) {
  if (node.nodeName === "#text") return new Text(node.value);
  if (node.nodeName === "#comment") return new Comment(node.data);
  const fragment = node.nodeName === "#document-fragment";
  const element = fragment
    ? new Element("#fragment", null, 11)
    : new Element(node.tagName, node.namespaceURI);
  for (const a of node.attrs ?? [])
    element.attributes.push({
      name: a.prefix ? `${a.prefix}:${a.name}` : a.name,
      value: a.value,
      namespaceURI: a.namespace ?? null,
    });
  element.childNodes = (node.childNodes ?? []).map(convert);
  if (node.nodeName === "template") element.content = convert(node.content);
  return element;
}

// An HTML fragment as an inert fragment node.
export const parseInert = (html) => convert(parseFragment(html));

// The document object sanitizeSVG builds its result with.
export const nodeDocument = {
  createElementNS: (ns, name) => new Element(name, ns),
  createTextNode: (data) => new Text(data),
};

// Runs fn with nodeDocument as the global document (the shared module reads the global).
export function withDocument(fn) {
  const had = Object.hasOwn(globalThis, "document"),
    saved = globalThis.document;
  globalThis.document = nodeDocument;
  try {
    return fn();
  } finally {
    if (had) globalThis.document = saved;
    else delete globalThis.document;
  }
}
