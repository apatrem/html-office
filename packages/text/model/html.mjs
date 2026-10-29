// A plain HTML tree shared by the Node tools (parse5) and the browser (DOM), and its serialiser.
// Nodes: {type: "element", name, ns, attrs: [[name, value]], children, loc?}, {type: "text", value, loc?},
// {type: "comment", value, loc?}. `ns` is "html", "svg" or "math"; attribute order is source order.
// `loc` (Node only) is {line, col, offset, end, closing?, attrs: {name: {line, col}}}, 1-based lines and
// columns; closing is the offset of the end tag, when the source has one.

export const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
const RAW_TEXT = new Set([
  "style",
  "script",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "plaintext",
]);
const NAMESPACES = {
  "http://www.w3.org/1999/xhtml": "html",
  "http://www.w3.org/2000/svg": "svg",
  "http://www.w3.org/1998/Math/MathML": "math",
};

export const element = (name, attrs = [], children = [], ns = "html") => ({
  type: "element",
  name,
  ns,
  attrs,
  children,
});
export const text = (value) => ({ type: "text", value });

export const attr = (node, name) =>
  node.attrs?.find(([n]) => n === name)?.[1] ?? null;
export const classes = (node) =>
  (attr(node, "class") ?? "").split(/[\t\n\f\r ]+/).filter(Boolean);
export const elements = (node) =>
  node.children.filter((child) => child.type === "element");
export const isBlank = (node) =>
  node.type === "text" && !/[^\t\n\f\r ]/.test(node.value);

// Elements deeper than this are kept without their children and marked `truncated`; the
// validator rejects them. It bounds every recursive walk over the tree.
export const MAX_DEPTH = 256;

// Browser DOM node to plain tree. HTML template contents are read from `content`.
export function fromDom(node, depth = 0) {
  if (node.nodeType === 3) return text(node.data);
  if (node.nodeType === 8) return { type: "comment", value: node.data };
  const ns = NAMESPACES[node.namespaceURI] ?? "html";
  const source =
    ns === "html" && node.localName === "template" ? node.content : node;
  const children = [...source.childNodes].filter((child) =>
    [1, 3, 8].includes(child.nodeType),
  );
  const result = element(
    node.localName,
    [...node.attributes].map((a) => [a.name, a.value]),
    depth < MAX_DEPTH ? children.map((child) => fromDom(child, depth + 1)) : [],
    ns,
  );
  if (depth >= MAX_DEPTH && children.length) result.truncated = true;
  return result;
}

// The browser's parsed document in the shape of parse.mjs's parseFile.
export function fromDocument(document) {
  const html = fromDom(document.documentElement);
  return { doctype: document.doctype?.name ?? null, children: [html], html };
}

// A carriage return would become a line feed when the file is read again: it is the one character
// written as a reference.
const escapeText = (s) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/\r/g, "&#13;")
    .replace(/\u00a0/g, "&nbsp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
export const escapeAttribute = (s) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/\r/g, "&#13;")
    .replace(/\u00a0/g, "&nbsp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const OPEN_COMMENT = String.fromCharCode(60) + "!--";

// The HTML fragment serialisation algorithm with fixed escaping: & < > and no-break spaces in text;
// also " in attribute values. Every other character is written as itself. Stable under reparsing.
export function serialize(node, parent = null) {
  if (node.type === "text")
    return parent?.ns === "html" && RAW_TEXT.has(parent.name)
      ? node.value
      : escapeText(node.value);
  // Written so that the editor's own script never contains a literal comment opener.
  if (node.type === "comment") return `${OPEN_COMMENT}${node.value}-->`;
  if (node.truncated)
    throw new Error(`<${node.name}> is nested too deep to be saved`);
  if (node.ns === "html" && RAW_TEXT.has(node.name)) {
    // Raw text cannot be escaped: refuse what would end the element or change its parsing.
    const raw = node.children.map((c) => (c.type === "text" ? c.value : null));
    const text = raw.join("");
    if (
      raw.includes(null) ||
      new RegExp(`</${node.name}`, "i").test(text) ||
      (node.name === "script" && /<!-{2}/.test(text))
    )
      throw new Error(
        `<${node.name}> holds only text, without its end tag or a comment opener`,
      );
  }
  const start = `<${node.name}${node.attrs
    .map(([n, v]) => ` ${n}="${escapeAttribute(v)}"`)
    .join("")}>`;
  if (node.ns === "html" && VOID.has(node.name)) return start;
  // The parser drops one newline directly after these start tags.
  const lead =
    node.ns === "html" &&
    ["pre", "textarea", "listing"].includes(node.name) &&
    node.children[0]?.type === "text" &&
    node.children[0].value.startsWith("\n")
      ? "\n"
      : "";
  return `${start}${lead}${node.children.map((child) => serialize(child, node)).join("")}</${node.name}>`;
}
