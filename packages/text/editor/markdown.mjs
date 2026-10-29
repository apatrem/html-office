// The Markdown projection of a document (T15): what the read-only Markdown view shows and what
// Markdown export writes, one function for both. It is lossy and one-way (FORMAT.md › Markdown
// view and export): never stored, never read back as the document. Pure (no DOM), so the editor
// and tools/markdown.mjs give the same text. Labels and numbers come from numbering.mjs.
import { Transform } from "prosemirror-transform";
import { TableMap } from "prosemirror-tables";
import { schema } from "./schema/schema.mjs";
import { numbering, regenerate } from "./numbering.mjs";
import { inlineTrees } from "./schema/serialize.mjs";
import { attr, classes } from "../model/html.mjs";

const N = schema.nodes;

// Backslash escapes for text: delimiters, link brackets, raw HTML, entity references and pipes
// (tables); line starts are escaped by `block` below.
const escape = (s) =>
  s.replace(/[\\`*_[\]<~|]/g, "\\$&").replace(/&(?=#?\w+;)/g, "\\&");
// A line that would start a heading, quote, list, rule or setext underline reads as text.
const lineStart = (line) =>
  line
    .replace(/^[ \t]+/, "")
    .replace(/^(?=>|#{1,6}(\s|$)|[+-](\s|$)|(=+|-+)\s*$)/, "\\")
    .replace(/^(\d{1,9})(?=[.)](\s|$))/, "$1\\");

const CALLOUT = { note: "Note", warning: "Warning", key: "Key message" };
const DELIMITER = { strong: "**", em: "*" };
const HTML_MARK = { u: "u", mark: "mark", sub: "sub", sup: "sup" };

// A code span fenced by more backticks than it holds, padded when it starts or ends with one.
// In a table cell a pipe would end the cell: GitHub reads "\\|" there, code spans included.
function codeSpan(s, where) {
  const fence = "`".repeat(
    Math.max(0, ...(s.match(/`+/g) ?? []).map((r) => r.length)) + 1,
  );
  const pad = /^`|`$|^ .*[^ ].* $/.test(s) ? " " : "";
  return (
    fence + pad + (where === "cell" ? s.replace(/\|/g, "\\|") : s) + pad + fence
  );
}

// Inline trees (serialize.mjs) to Markdown. where: "text" (a line break is a hard break),
// "cell" (<br>) or "line" (a heading or caption line: a space). Footnotes are numbered as in
// the document and their text collected in `out.notes`.
function inline(trees, out, where) {
  let s = "";
  for (const t of trees) {
    if (t.type === "text") {
      s += escape(t.value);
      continue;
    }
    const c = classes(t);
    if (t.name === "br")
      s += where === "cell" ? "<br>" : where === "line" ? " " : "\\\n";
    else if (t.name === "span") {
      const number = out.notes.push(null);
      out.notes[number - 1] = inline(t.children, out, "line");
      s += `[^${number}]`;
    } else if (t.name === "a" && c.includes("xref"))
      s += escape(t.children.map((n) => n.value).join(""));
    else if (t.name === "a") {
      const href = attr(t, "href").replace(
        /[\\ ()<>|]/g,
        (ch) => "%" + ch.charCodeAt(0).toString(16).toUpperCase(),
      );
      s += `[${inline(t.children, out, where)}](${href})`;
    } else if (t.name === "code" && t.children.every((n) => n.type === "text"))
      s += codeSpan(t.children.map((n) => n.value).join(""), where);
    else if (t.name === "mark" && c.includes("comment"))
      s += inline(t.children, out, where);
    else {
      const inner = inline(t.children, out, where);
      // Spaces and line breaks stay outside the delimiters, which would not close after them.
      const [, lead, core, trail] = inner.match(
        /^((?:\s|\\\n)*)([\s\S]*?)((?:\s|\\\n)*)$/,
      );
      const open =
        DELIMITER[t.name] ??
        (HTML_MARK[t.name] ? `<${HTML_MARK[t.name]}>` : "");
      const close = DELIMITER[t.name] ?? (open && `</${HTML_MARK[t.name]}>`);
      s += core ? lead + open + core + close + trail : inner;
    }
  }
  return s;
}

const text = (node, out, where = "text") =>
  inline(inlineTrees(node.content), out, where);
// A paragraph's lines, each safe at the start of a line; null when it holds nothing. A line
// break at its start or end would read as a backslash: it is left out.
const paragraph = (s) => {
  s = s.replace(/^(\\\n|\s)+|(\\\n|\s)+$/g, "");
  return s ? s.split("\n").map(lineStart).join("\n") : null;
};
// Each line of a block behind a prefix: the first line's marker, then the continuation's.
const prefix = (s, first, rest = " ".repeat(first.length)) =>
  s
    .split("\n")
    .map((line, i) =>
      i === 0 ? (first + line).trimEnd() : line && rest + line,
    )
    .join("\n");

function list(node, out, marker) {
  return node.content.content
    .map((item, i) => {
      const m = node.type === N.ordered_list ? `${i + 1}${marker}` : marker;
      const own = paragraph(text(item.child(0), out)) ?? "";
      const nested =
        item.childCount > 1
          ? "\n" + list(item.child(1), out, markerOf(item.child(1)))
          : "";
      return prefix(own + nested, m + " ");
    })
    .join("\n");
}
const markerOf = (node) => (node.type === N.ordered_list ? "." : "-");

// A table row as a pipe row.
const row = (cells) => `| ${cells.join(" | ")} |`;
const ALIGN_ROW = { "ta-l": ":---", "ta-c": ":---:", "ta-r": "---:" };

// A GitHub table: the first header row is its header (an empty one without header rows), other
// header rows lead the body; a merged cell's text is in its first cell, the cells it covers stay
// empty. Columns take their body cells' alignment when they all share it.
function table(node, out) {
  const map = TableMap.get(node);
  const grid = [],
    aligns = [];
  for (let r = 0; r < map.height; r++) {
    const cells = [];
    for (let c = 0; c < map.width; c++) {
      const pos = map.map[r * map.width + c];
      const rect = map.findCell(pos);
      const cell = node.nodeAt(pos);
      const origin = rect.left === c && rect.top === r;
      cells.push(origin ? text(cell, out, "cell").trim() : "");
      if (origin && !node.child(r).attrs.head)
        (aligns[c] ??= new Set()).add(cell.attrs.align);
    }
    grid.push(cells);
  }
  const heads = node.content.content.filter((r) => r.attrs.head).length;
  const header = heads ? grid.shift() : grid[0].map(() => "");
  return [
    row(header),
    row(
      header.map((_, c) =>
        aligns[c]?.size === 1 ? (ALIGN_ROW[[...aligns[c]][0]] ?? "---") : "---",
      ),
    ),
    ...grid.map(row),
  ].join("\n");
}

// A chart's title line, then its data as a table when it has categories and series.
function chart(node, out) {
  let data = {};
  try {
    data = JSON.parse(node.attrs.data);
  } catch {}
  const title = [data.title, data.unit].filter(Boolean).join(", ");
  const lines = [
    `*Chart (${node.attrs.type})${title ? ": " + escape(title) : ""}*`,
  ];
  if (Array.isArray(data.categories) && Array.isArray(data.series))
    lines.push(
      [
        row(["", ...data.series.map((s) => escape(String(s.name ?? "")))]),
        row(["---", ...data.series.map(() => "---:")]),
        ...data.categories.map((category, i) =>
          row([
            escape(String(category)),
            ...data.series.map((s) => String(s.values?.[i] ?? "")),
          ]),
        ),
      ].join("\n"),
    );
  out.lost.charts++;
  return lines;
}

// A figure's caption line, "**Figure 1.** caption".
function caption(node, figure, out) {
  const first = node.firstChild;
  if (first?.type !== N.caption) return null;
  return paragraph(`**${figure.label}.** ${text(first, out, "line").trim()}`);
}

// The visible text of a plain tree (a protected block), spaces collapsed.
const treeText = (tree) =>
  tree.type === "text"
    ? tree.value
    : tree.type === "element"
      ? tree.children.map(treeText).join(" ")
      : "";

const entries = (list) =>
  list
    .map((e) =>
      prefix(
        (paragraph(escape(e.label)) ?? "") +
          (e.children.length ? "\n" + entries(e.children) : ""),
        "- ",
      ),
    )
    .join("\n");

function block(node, info, out) {
  const T = node.type;
  if (T === N.paragraph) return paragraph(text(node, out));
  if (T === N.heading) {
    const number = info.numbers.get(info.pos);
    // A closing run of # would end the heading's text.
    const s = text(node, out, "line")
      .trim()
      .replace(/(^|\s)(#+)$/, "$1\\$2");
    return `${"#".repeat(node.attrs.level)} ${number ? number + " " : ""}${s}`.trimEnd();
  }
  if (T === N.cover) {
    const blocks = [];
    node.forEach((child) => {
      const s = text(child, out, child.type === N.title ? "line" : "text");
      blocks.push(
        child.type === N.title ? `# ${s.trim()}`.trimEnd() : paragraph(s),
      );
    });
    return blocks;
  }
  if (T === N.blockquote || T === N.callout) {
    const inner = [];
    if (T === N.callout) inner.push(`**${CALLOUT[node.attrs.kind]}**`);
    node.forEach((child) =>
      inner.push(
        child.type === N.paragraph
          ? paragraph(text(child, out))
          : list(child, out, markerOf(child)),
      ),
    );
    return prefix(inner.filter(Boolean).join("\n\n"), "> ", "> ").replace(
      /^$/gm,
      ">",
    );
  }
  if (T === N.code_block) {
    const fence = "`".repeat(
      Math.max(
        2,
        ...(node.textContent.match(/`+/g) ?? []).map((r) => r.length),
      ) + 1,
    );
    return `${fence}\n${node.textContent}${node.textContent ? "\n" : ""}${fence}`;
  }
  if (T === N.bullet_list || T === N.ordered_list) {
    // Two lists of the same kind in a row would read as one: the second changes its marker.
    out.other = info.previous?.type === T && !out.other;
    const marker =
      T === N.ordered_list ? (out.other ? ")" : ".") : out.other ? "*" : "-";
    return list(node, out, marker);
  }
  if (T === N.toc)
    return node.attrs.entries.length ? entries(node.attrs.entries) : null;
  if (T === N.page_break) {
    out.lost.breaks++;
    return null;
  }
  const figure = info.figures.get(info.pos);
  if (T === N.image_figure) {
    out.lost.images++;
    if (node.attrs.wrap) out.lost.wrapped++;
    return [`*(Image: ${escape(node.attrs.alt)})*`, caption(node, figure, out)];
  }
  if (T === N.chart) return [...chart(node, out), caption(node, figure, out)];
  if (T === N.table_figure) {
    const t = node.lastChild;
    t.descendants((cell) => {
      if (cell.attrs.colspan > 1 || cell.attrs.rowspan > 1) out.lost.merged++;
      return cell.type === N.table_row;
    });
    return [caption(node, figure, out), table(t, out)];
  }
  if (T === N.comments) {
    out.lost.threads += node.childCount;
    return null;
  }
  if (T === N.protected) {
    out.lost.protected++;
    return paragraph(escape(treeText(node.attrs.node).replace(/\s+/g, " ")));
  }
  return null;
}

// Counts of what the Markdown leaves out, for the export's notice.
const LOSSES = [
  ["threads", "comment thread", "not exported"],
  ["images", "image", "alt text only, no picture"],
  ["wrapped", "wrapped image", "placed in the text flow"],
  ["charts", "chart", "title and data only, no drawing"],
  ["merged", "merged table cell", "split"],
  ["protected", "protected block", "plain text only"],
  ["breaks", "page break", "left out"],
];

// The document as Markdown. format: the layout theme's heading format (numbering.mjs). Returns
// {markdown, lost}: lost counts what the notice at the top of the text names.
export function toMarkdown(doc, { format } = {}) {
  // Labels and contents as the editor would write them, whatever the file says.
  const tr = new Transform(doc);
  regenerate(tr, { format });
  doc = tr.doc;
  const result = numbering(doc, { format });
  const info = {
    numbers: new Map(result.headings.map((h) => [h.pos, h.number])),
    figures: new Map(result.figures.map((f) => [f.pos, f])),
  };
  const out = {
    notes: [],
    other: false,
    lost: Object.fromEntries(LOSSES.map(([key]) => [key, 0])),
  };
  const blocks = [];
  doc.forEach((node, pos) => {
    info.pos = pos;
    const b = block(node, info, out);
    info.previous = node;
    blocks.push(...[b].flat());
  });
  const notes = out.notes.map((s, i) => `[^${i + 1}]: ${s.trim()}`);
  const counted = LOSSES.filter(([key]) => out.lost[key]).map(
    ([key, name, how]) =>
      `${out.lost[key]} ${name}${out.lost[key] === 1 ? "" : "s"} (${how})`,
  );
  const notice =
    "<!-- Markdown export from html-text: a reading copy, not the document. The HTML file is the document; this file does not keep its layout, styles, IDs, cross-reference links or comments, and cannot be opened as it." +
    (counted.length ? ` Here: ${counted.join(", ")}.` : "") +
    " -->";
  return {
    markdown:
      [
        notice,
        ...blocks.filter(Boolean),
        ...(notes.length ? [notes.join("\n")] : []),
      ].join("\n\n") + "\n",
    lost: out.lost,
  };
}
