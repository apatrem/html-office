// Plain tree (html.mjs) to ProseMirror document. Runs only on content the validator accepted:
// each top-level block is either in the subset (mapped exactly) or protected (kept as its tree).
// Whitespace between blocks and container children is layout (serialize.mjs regenerates it);
// line breaks and tabs inside inline text read as spaces. Nothing else is normalised.
import { schema } from "./schema.mjs";
import { attr, classes, isBlank } from "../../model/html.mjs";
import { ALIGN } from "../../model/format.mjs";

const N = schema.nodes,
  M = schema.marks;

const kids = (node) => node.children.filter((n) => !isBlank(n));
const textOf = (node) => node.children.map((n) => n.value).join("");
const align = (node) => classes(node).find((c) => ALIGN.includes(c)) ?? null;
const inlineText = (value) => value.replace(/[\t\n\r]/g, " ");

// Removes source locations, so protected trees and previews hold only what is saved.
export function plain(node) {
  if (node.type !== "element") return { type: node.type, value: node.value };
  return {
    type: "element",
    name: node.name,
    ns: node.ns,
    attrs: node.attrs.map(([n, v]) => [n, v]),
    children: node.children.map(plain),
  };
}

function inline(children, marks = [], out = []) {
  for (const node of children) {
    if (node.type === "text") {
      if (node.value) out.push(schema.text(inlineText(node.value), marks));
      continue;
    }
    const c = classes(node);
    let mark = null;
    switch (node.name) {
      case "br":
        out.push(N.hard_break.create(null, null, marks));
        continue;
      case "span":
        out.push(N.footnote.create(null, inline(node.children), marks));
        continue;
      case "a":
        if (c.includes("xref")) {
          out.push(
            N.xref.create(
              {
                target: attr(node, "href").slice(1),
                label: inlineText(textOf(node)),
              },
              null,
              marks,
            ),
          );
          continue;
        }
        mark = M.link.create({ href: attr(node, "href") });
        break;
      case "mark":
        mark = c.length
          ? M.comment.create({ ref: attr(node, "data-ref") })
          : M.highlight.create();
        break;
      case "strong":
      case "em":
      case "u":
      case "sub":
      case "sup":
      case "code":
        mark = M[node.name].create();
        break;
      default:
        throw new Error(`Unexpected <${node.name}> in inline content`);
    }
    inline(node.children, mark.addToSet(marks), out);
  }
  return out;
}

const paragraph = (node) =>
  N.paragraph.create(
    { lead: classes(node).includes("lead"), align: align(node) },
    inline(node.children),
  );

function list(node) {
  return N[node.name === "ul" ? "bullet_list" : "ordered_list"].create(
    null,
    kids(node).map((li) => {
      const last = kids(li).at(-1);
      const nested = last && ["ul", "ol"].includes(last.name) ? last : null;
      const text = nested
        ? li.children.slice(0, li.children.indexOf(nested))
        : li.children;
      return N.list_item.create(null, [
        N.list_text.create(null, inline(text)),
        ...(nested ? [list(nested)] : []),
      ]);
    }),
  );
}

function tocEntries(ol) {
  return kids(ol).map((li) => {
    const [link, nested] = kids(li);
    return {
      target: attr(link, "href").slice(1),
      label: textOf(link),
      children: nested ? tocEntries(nested) : [],
    };
  });
}

const caption = (node) => N.caption.create(null, inline(node.children));

function chart(node) {
  const [data, ...rest] = kids(node);
  const preview = rest[0]?.ns === "svg" ? rest.shift() : null;
  return N.chart.create(
    {
      id: attr(node, "id"),
      type: attr(node, "data-type"),
      width: attr(node, "data-width"),
      data: textOf(data),
      preview: preview && plain(preview),
    },
    rest.length ? [caption(rest[0])] : [],
  );
}

function imageFigure(node) {
  const [img, cap] = kids(node);
  return N.image_figure.create(
    {
      id: attr(node, "id"),
      width: attr(node, "data-width"),
      wrap: attr(node, "data-wrap"),
      asset: attr(img, "data-asset"),
      alt: attr(img, "alt"),
    },
    cap ? [caption(cap)] : [],
  );
}

function rows(section, head) {
  return kids(section).map((tr) =>
    N.table_row.create(
      { head, total: classes(tr).includes("total") },
      kids(tr).map((cell) =>
        N[cell.name === "th" ? "table_header" : "table_cell"].create(
          {
            colspan: Number(attr(cell, "colspan") ?? 1),
            rowspan: Number(attr(cell, "rowspan") ?? 1),
            align: align(cell),
          },
          inline(cell.children),
        ),
      ),
    ),
  );
}

function tableFigure(node) {
  const parts = kids(node);
  const cap = parts[0].name === "figcaption" ? parts.shift() : null;
  const table = parts[0];
  const sections = kids(table);
  const colgroup = sections[0].name === "colgroup" ? sections.shift() : null;
  const thead = sections[0].name === "thead" ? sections.shift() : null;
  return N.table_figure.create({ id: attr(node, "id") }, [
    ...(cap ? [caption(cap)] : []),
    N.table.create(
      {
        compact: classes(table).includes("compact"),
        cols: colgroup
          ? kids(colgroup).map((col) => ({
              width: attr(col, "data-width"),
              emphasis: classes(col).includes("emphasis"),
            }))
          : null,
      },
      [...(thead ? rows(thead, true) : []), ...rows(sections[0], false)],
    ),
  ]);
}

function comments(node) {
  return N.comments.create(
    null,
    kids(node).map((thread) =>
      N.comment_thread.create({
        id: attr(thread, "id"),
        status: attr(thread, "data-status"),
        quote: attr(thread, "data-quote"),
        section: attr(thread, "data-section"),
        prefix: attr(thread, "data-prefix"),
        suffix: attr(thread, "data-suffix"),
        entries: kids(thread).map((p) => ({
          author: attr(p, "data-author"),
          date: attr(p, "data-date"),
          text: textOf(p),
        })),
      }),
    ),
  );
}

function block(node) {
  const c = classes(node);
  switch (node.name) {
    case "p":
      return paragraph(node);
    case "h1":
    case "h2":
    case "h3":
    case "h4":
      return N.heading.create(
        {
          level: Number(node.name[1]),
          id: attr(node, "id"),
          unnumbered: c.includes("unnumbered"),
          newPage: c.includes("new-page"),
          align: align(node),
        },
        inline(node.children),
      );
    case "header": {
      const [title, ...lines] = kids(node);
      const subtitle =
        lines[0] && classes(lines[0]).join(" ") === "subtitle"
          ? lines.shift()
          : null;
      return N.cover.create(null, [
        N.title.create(null, inline(title.children)),
        ...(subtitle
          ? [N.subtitle.create(null, inline(subtitle.children))]
          : []),
        ...lines.map(paragraph),
      ]);
    }
    case "nav": {
      const [ol] = kids(node);
      return N.toc.create({
        depth: Number(attr(node, "data-depth")),
        entries: ol ? tocEntries(ol) : [],
      });
    }
    case "blockquote":
      return N.blockquote.create(null, kids(node).map(paragraph));
    case "aside":
      return N.callout.create(
        { kind: c.find((k) => k !== "callout") },
        kids(node).map((kid) =>
          kid.name === "p" ? paragraph(kid) : list(kid),
        ),
      );
    case "pre": {
      const code = textOf(node.children[0]);
      return N.code_block.create(null, code ? [schema.text(code)] : []);
    }
    case "ul":
    case "ol":
      return list(node);
    case "hr":
      return N.page_break.create();
    case "figure":
      return { chart, image: imageFigure, table: tableFigure }[c[0]](node);
    case "section":
      return comments(node);
  }
  throw new Error(`Unexpected <${node.name}> block`);
}

// article: the article#doc tree; blocks: validateArticle/validateFile's blocks (non-blank children, in order).
export function toDoc(article, blocks) {
  const doc = Object.fromEntries(article.attrs);
  const result = N.doc.create(
    {
      lang: doc.lang,
      headingNumbers: doc["data-heading-numbers"] === "on",
      headingFormat: doc["data-heading-format"] ?? null,
      theme: doc["data-theme"] ?? null,
      font: doc["data-font"] ?? null,
      page: doc["data-page"] ?? null,
      margins: doc["data-margins"] ?? null,
    },
    blocks.map(({ node, protected: kept }) =>
      kept ? N.protected.create({ node: plain(node) }) : block(node),
    ),
  );
  result.check();
  return result;
}
