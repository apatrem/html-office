// Sections of a source (T16): a top-level heading of article#doc and what follows it up to the
// next top-level heading of the same or a higher level, the comments section or the end of the
// article (FORMAT.md › Rules for the whole content). Offsets are in the source text, so a section
// is an exact slice of the file. Works on any parsed file (parse.mjs), valid or not; Node tools only.
import { attr, classes, isBlank } from "./html.mjs";

const HEADING = /^h([1-4])$/;
// Elements whose text is separate from their neighbours' (as browsers lay it out); footnotes
// read as separate too (the editor shows a number, the theme brackets).
const SEPARATE =
  /^(address|article|aside|blockquote|br|caption|center|d[dlt]|details|div|fieldset|fig(caption|ure)|footer|h\d|header|hgroup|hr|legend|li|main|menu|nav|ol|p|pre|search|section|summary|t[dhr]|table|ul)$/;

// The visible text of a tree, without chart data, chart previews or templates.
const visible = (node) =>
  node.type === "text"
    ? node.value
    : node.type !== "element" ||
        ["script", "svg", "template"].includes(node.name)
      ? ""
      : SEPARATE.test(node.name) ||
          (node.name === "span" && classes(node).includes("footnote"))
        ? ` ${node.children.map(visible).join("")} `
        : node.children.map(visible).join("");

// Its words: inline markup inside a word does not split it.
export const wordCount = (node) =>
  visible(node)
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

// article#doc of a parsed file, or null when the file has no body or article.
export function articleOf(file) {
  const body = file.html?.children.find(
    (n) => n.type === "element" && n.name === "body",
  );
  return (
    body?.children.find(
      (n) =>
        n.type === "element" && n.name === "article" && attr(n, "id") === "doc",
    ) ?? null
  );
}

// article: the article#doc node of a parsed file. Returns {blocks, sections}:
// - blocks: [{node, start, end}], the article's top-level nodes (blank text left out), each
//   from its first byte to the next block's (the line break between them included);
// - sections: [{id, level, start, end, from, to, words, own, parent}], in document order. from
//   and to index `blocks` ([from, to)); words count the whole section, own only the text before
//   its first subsection; parent is the enclosing section's ID or null.
// Returns null when the parser made up an element the source does not have (a <p> for a stray
// </p>) or the article has no end tag: such an article has no exact slices.
export function sectionsOf(article) {
  const nodes = article.children.filter((n) => !isBlank(n));
  if (!article.loc?.closing || nodes.some((n) => !n.loc)) return null;
  const close = article.loc.closing;
  const blocks = nodes.map((node, i) => ({
    node,
    start: node.loc.offset,
    end: i + 1 < nodes.length ? nodes[i + 1].loc.offset : close,
  }));
  // The comments section is the last block, a section of class "comments" alone (FORMAT.md);
  // any other section is a protected block like the others.
  const tail = nodes.at(-1);
  const comments =
    tail?.type === "element" &&
    tail.name === "section" &&
    classes(tail).join(" ") === "comments"
      ? nodes.length - 1
      : -1;
  const last = comments >= 0 ? comments : blocks.length;
  const sections = [];
  const open = [];
  blocks.forEach(({ node }, i) => {
    const level =
      node.type === "element" && attr(node, "id") !== null
        ? Number(HEADING.exec(node.name)?.[1] ?? 0)
        : 0;
    if (!level || i >= last) return;
    while (open.length && open.at(-1).level >= level) open.pop();
    const section = {
      id: attr(node, "id"),
      level,
      from: i,
      parent: open.at(-1)?.id ?? null,
    };
    let to = i + 1,
      own = null;
    for (; to < last; to++) {
      const next = blocks[to].node;
      const m = next.type === "element" && HEADING.exec(next.name);
      if (m && attr(next, "id") !== null) {
        own ??= to;
        if (Number(m[1]) <= level) break;
      }
    }
    const count = (a, b) =>
      blocks.slice(a, b).reduce((n, b) => n + wordCount(b.node), 0);
    Object.assign(section, {
      to,
      start: blocks[i].start,
      end: to < blocks.length ? blocks[to].start : close,
      words: count(i, to),
      own: count(i, own ?? to),
    });
    sections.push(section);
    open.push(section);
  });
  return { blocks, sections };
}

// The innermost section holding a source offset, or null.
export const sectionAt = (sections, offset) =>
  sections.findLast((s) => s.start <= offset && offset < s.end) ?? null;
