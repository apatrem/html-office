// Sections of a source (T16): a top-level heading of article#doc and what follows it up to the
// next top-level heading of the same or a higher level, the comments section or the end of the
// article (FORMAT.md › Rules for the whole content). Offsets are in the source text, so a section
// is an exact slice of the file. Works on any parsed file (parse.mjs), valid or not; Node tools only.
import { attr, classes, isBlank } from "./html.mjs";

const HEADING = /^h([1-4])$/;
const END_TAG = "</article>".length;

// The visible words of a tree: its text, without chart data, chart previews or comment threads.
export function wordCount(node) {
  if (node.type === "text")
    return node.value.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w))
      .length;
  if (node.type !== "element") return 0;
  if (["script", "svg", "template"].includes(node.name)) return 0;
  return node.children.reduce((n, child) => n + wordCount(child), 0);
}

// article: the article#doc node of a parsed file. Returns {blocks, sections}:
// - blocks: [{node, start, end}], the article's top-level nodes (blank text left out), each
//   from its first byte to the next block's (the line break between them included);
// - sections: [{id, level, start, end, from, to, words, own, parent}], in document order. from
//   and to index `blocks` ([from, to)); words count the whole section, own only the text before
//   its first subsection; parent is the enclosing section's ID or null.
export function sectionsOf(article) {
  const nodes = article.children.filter((n) => !isBlank(n));
  const close = article.loc.end - END_TAG;
  const blocks = nodes.map((node, i) => ({
    node,
    start: node.loc.offset,
    end: i + 1 < nodes.length ? nodes[i + 1].loc.offset : close,
  }));
  const comments = blocks.findIndex(
    ({ node }) =>
      node.type === "element" &&
      node.name === "section" &&
      classes(node).includes("comments"),
  );
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
