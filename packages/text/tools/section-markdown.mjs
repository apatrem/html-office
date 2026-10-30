// A section as editable Markdown (T18): the working format convert.mjs reads back, so a rewrite
// starts from the section as it is. Figures become placeholders naming their ID (the caption is
// the intent), cross-references [[xref: id]], footnotes [^n] with their definitions after the
// text, comment anchors raw <mark class="comment" data-ref="…">, and what Markdown has no syntax
// for (underline, highlight, superscript, subscript, line breaks, page breaks) the subset's own
// HTML. Converting the result unchanged gives the section back byte for byte (tests/document.test.mjs).
// Unlike the T15 export, this is not a reading copy: it is lossless for what a section holds,
// and it refuses a section with a contents list or a protected block, which Markdown cannot carry.
import { parseFile } from "../model/parse.mjs";
import { sectionsOf, articleOf } from "../model/sections.mjs";
import { schema } from "../editor/schema/schema.mjs";
import { openFile } from "../editor/schema/document.mjs";
import { ConvertError } from "./convert.mjs";

const N = schema.nodes,
  M = schema.marks;
const KIND = { note: "NOTE", warning: "WARNING", key: "KEY" };
const html = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

// Text with the characters Markdown reads as inline syntax escaped.
const escapeText = (s) =>
  s.replace(/[\\`*_[\]{}<&]/g, (c) => (c === "&" ? "&amp;" : `\\${c}`));
// A line that Markdown would read as another block (a list item, a heading, a quote, a rule)
// when it starts it; spaces Markdown would trim are written as references.
const lineStart = (md) =>
  md
    .replace(/^([-+#>=])/, "\\$1")
    .replace(/^(\d+)([.)])/, "$1\\$2")
    .replace(/^ /, "&#32;")
    .replace(/ $/, "&#32;");

const ALNUM = /^[\p{L}\p{N}](.*[\p{L}\p{N}])?$/su;
const OPEN = {
  strong: "<strong>",
  em: "<em>",
  u: "<u>",
  highlight: "<mark>",
  sub: "<sub>",
  sup: "<sup>",
};
const CLOSE = {
  strong: "</strong>",
  em: "</em>",
  u: "</u>",
  highlight: "</mark>",
  sub: "</sub>",
  sup: "</sup>",
};

// Inline content the conversion would read differently, as HTML spaces and breaks are read: a
// run of spaces, or a line break or space at either end.
function unwritable(fragment) {
  // The line as HTML reads it: text, breaks as line feeds, notes and references as one mark.
  let flow = "";
  fragment.forEach((n) => {
    flow += n.isText ? n.text : n.type === N.hard_break ? "\n" : "x";
  });
  return / {2}|\n | \n|^[\n ]|[\n ]$/.test(flow);
}

// Inline content as Markdown. notes: the footnotes met so far ([^n] definitions).
function inline(fragment, notes) {
  if (unwritable(fragment))
    throw new ConvertError(
      `The section holds text with a run of spaces, or a space or line break at the start or end of a line ("${fragment.textBetween(0, Math.min(fragment.size, 40), " ")}…"), which Markdown cannot keep: edit it in HTML (show, replace)`,
    );
  const nodes = [];
  fragment.forEach((n) => nodes.push(n));
  let out = "";
  const open = [];
  // Whether ** or * are safe for a mark: it spans only text whose ends are letters or digits,
  // with no other bold or italic inside it or touching it, whose delimiters would run together.
  const emphasis = (n) =>
    n.marks.filter((m) => m.type === M.strong || m.type === M.em);
  const plainSpan = (i, mark) => {
    let j = i,
      text = "";
    while (j < nodes.length && mark.isInSet(nodes[j].marks)) {
      if (!nodes[j].isText || emphasis(nodes[j]).length > 1) return false;
      text += nodes[j].text;
      j++;
    }
    const touches = (n) => n && emphasis(n).length > 0;
    return ALNUM.test(text) && !touches(nodes[i - 1]) && !touches(nodes[j]);
  };
  const delimiter = new Map();
  const close = (mark) => {
    const name = mark.type.name;
    out +=
      name === "comment"
        ? "</mark>"
        : name === "link"
          ? delimiter.get(mark) === "md"
            ? `](${mark.attrs.href})`
            : "</a>"
          : name === "code"
            ? "</code>"
            : (delimiter.get(mark) ?? CLOSE[name]);
  };
  nodes.forEach((node, i) => {
    const marks = node.marks;
    let keep = 0;
    while (keep < open.length && open[keep].isInSet(marks)) keep++;
    while (open.length > keep) close(open.pop());
    for (const mark of marks) {
      if (open.includes(mark)) continue;
      const name = mark.type.name;
      let start;
      if (name === "comment")
        start = `<mark class="comment" data-ref="${html(mark.attrs.ref)}">`;
      else if (name === "link") {
        const md = /^[^\s()<>\\]+$/.test(mark.attrs.href);
        delimiter.set(mark, md ? "md" : "html");
        start = md ? "[" : `<a href="${html(mark.attrs.href)}">`;
      } else if (name === "code") start = "<code>";
      else if ((name === "strong" || name === "em") && plainSpan(i, mark)) {
        start = name === "strong" ? "**" : "*";
        delimiter.set(mark, start);
      } else {
        start = OPEN[name];
        // The same mark may have been written with ** before: it closes as it opens.
        delimiter.delete(mark);
      }
      out += start;
      open.push(mark);
    }
    if (node.isText) out += escapeText(node.text);
    else if (node.type === N.hard_break) out += "<br>";
    else if (node.type === N.xref) out += `[[xref: ${node.attrs.target}]]`;
    else if (node.type === N.footnote) {
      notes.push(inline(node.content, notes));
      out += `[^${notes.length}]`;
    }
  });
  while (open.length) close(open.pop());
  return out;
}

const classes = (...names) => {
  const list = names.filter(Boolean);
  return list.length ? ` {${list.map((c) => `.${c}`).join(" ")}}` : "";
};
const paragraph = (node, notes) =>
  lineStart(inline(node.content, notes)) +
  classes(node.attrs.lead && "lead", node.attrs.align);

// A list as lines, items indented under their marker; marker alternates between neighbours.
function list(node, notes, alternate) {
  const ordered = node.type === N.ordered_list;
  const marker = ordered ? (alternate ? "1)" : "1.") : alternate ? "*" : "-";
  const lines = [];
  node.forEach((item) => {
    const pad = " ".repeat(marker.length + 1);
    lines.push(
      `${marker} ${lineStart(inline(item.firstChild.content, notes))}`,
    );
    if (item.childCount > 1)
      for (const line of list(item.lastChild, notes, false))
        lines.push(pad + line);
  });
  return lines;
}

// The blocks of a section as Markdown chunks.
function blocks(nodes, notes) {
  const out = [];
  let previous = null,
    alternate = false;
  for (const node of nodes) {
    const t = node.type;
    if (t === N.heading) {
      const a = node.attrs;
      const tokens = [
        `#${a.id}`,
        a.unnumbered && ".unnumbered",
        a.newPage && ".new-page",
        a.align && `.${a.align}`,
      ].filter(Boolean);
      out.push(
        `${"#".repeat(a.level)} ${lineStart(inline(node.content, notes))} {${tokens.join(" ")}}`,
      );
    } else if (t === N.paragraph) {
      if (!node.childCount)
        throw new ConvertError(
          "The section holds an empty paragraph, which Markdown cannot write: edit it in HTML",
        );
      out.push(paragraph(node, notes));
    } else if (t === N.blockquote || t === N.callout) {
      const parts = [];
      let last = null,
        flip = false;
      node.forEach((child) => {
        if (child.type === N.paragraph) parts.push([paragraph(child, notes)]);
        else {
          flip = last?.type === child.type ? !flip : false;
          parts.push(list(child, notes, flip));
        }
        last = child;
      });
      const lines = [
        ...(t === N.callout ? [`[!${KIND[node.attrs.kind]}]`] : []),
        ...parts.flatMap((p, i) => (i ? ["", ...p] : p)),
      ];
      out.push(lines.map((l) => (l ? `> ${l}` : ">")).join("\n"));
    } else if (t === N.code_block && node.textContent.includes("\r"))
      // Markdown has no carriage return: the subset's own HTML, an HTML block up to </pre>.
      out.push(
        `<pre><code>${node.textContent.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\r/g, "&#13;")}</code></pre>`,
      );
    else if (t === N.code_block) {
      const text = node.textContent;
      const ticks = "`".repeat(
        Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)),
      );
      out.push(`${ticks}\n${text}\n${ticks}`);
    } else if (t === N.bullet_list || t === N.ordered_list) {
      alternate = previous?.type === t ? !alternate : false;
      out.push(list(node, notes, alternate).join("\n"));
    } else if (t === N.page_break) out.push('<hr class="page-break">');
    else if (t === N.chart || t === N.image_figure || t === N.table_figure) {
      const kind =
        t === N.chart ? "chart" : t === N.image_figure ? "image" : "table";
      const caption =
        node.firstChild?.type === N.caption ? node.firstChild.textContent : "";
      const intent = caption || (t === N.image_figure ? node.attrs.alt : "");
      out.push(
        `[[block: ${kind} | intent: ${JSON.stringify(intent)} | id: ${node.attrs.id}]]`,
      );
    } else
      throw new ConvertError(
        `The section holds a ${t === N.protected ? "protected block" : t === N.toc ? "contents list" : t.name}, which Markdown cannot carry: edit it in HTML (show, replace)`,
      );
    previous = node;
  }
  return out;
}

// The Markdown of section `id` of a valid document.
export function sectionMarkdown(source, id) {
  const file = parseFile(source);
  const { doc } = openFile(file);
  const found = sectionsOf(articleOf(file));
  const section = found?.sections.find((s) => s.id === id);
  if (!section)
    throw new ConvertError(
      `No section with the heading ID "${id}": outline lists them`,
    );
  const nodes = [];
  doc.forEach((node, _, i) => {
    if (i >= section.from && i < section.to) nodes.push(node);
  });
  const notes = [];
  const chunks = blocks(nodes, notes);
  const definitions = notes.map((n, i) => `[^${i + 1}]: ${lineStart(n)}`);
  return (
    [...chunks, ...(definitions.length ? [definitions.join("\n")] : [])].join(
      "\n\n",
    ) + "\n"
  );
}
