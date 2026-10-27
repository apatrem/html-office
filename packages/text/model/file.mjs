// The file layout of FORMAT.md › Canonical form, shared by the Node tools and the editor:
// one zone per line in head and body, with article#doc written by the editor's serialiser.
import { attr, elements, escapeAttribute, serialize } from "./html.mjs";

const start = (node) =>
  `<${node.name}${node.attrs.map(([n, v]) => ` ${n}="${escapeAttribute(v)}"`).join("")}>`;

// file: parse.mjs parseFile or html.mjs fromDocument; article: the canonical article#doc HTML.
export function serializeFile(file, article) {
  const [head, body] = ["head", "body"].map((name) =>
    elements(file.html).find((n) => n.name === name),
  );
  const zones = (parent) =>
    elements(parent)
      .map((n) =>
        n.name === "article" && attr(n, "id") === "doc"
          ? article
          : serialize(n),
      )
      .join("\n");
  return `<!doctype html>\n${start(file.html)}\n${start(head)}\n${zones(head)}\n</head>\n${start(body)}\n${zones(body)}\n</body>\n</html>\n`;
}

// Whether a file the browser parsed is in canonical form as far as its tree can tell: head and
// body children with their whitespace, article#doc compared with `article`, its canonical HTML.
// Spelling the parser does not keep (entity forms, quotes, letter case) is invisible here; check.mjs
// reports it. The body was captured while its last element, script#engine, ran: nothing after it
// is parsed yet, so its canonical text ends with that script.
export function looksCanonical(file, article) {
  const [head, body] = ["head", "body"].map((name) =>
    elements(file.html).find((n) => n.name === name),
  );
  const seen = (parent) =>
    parent.children.map((n) => serialize(n, parent)).join("");
  const zones = (parent) =>
    elements(parent)
      .map((n) =>
        n.name === "article" && attr(n, "id") === "doc"
          ? article
          : serialize(n),
      )
      .join("\n");
  return (
    seen(head) === `\n${zones(head)}\n` && seen(body) === `\n${zones(body)}`
  );
}
