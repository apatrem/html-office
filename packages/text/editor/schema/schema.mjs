// The ProseMirror schema of the canonical subset (FORMAT.md), one node or mark per construct.
// Parsing and serialising are ours (parse.mjs, serialize.mjs), not ProseMirror's DOMParser/DOMSerializer:
// they map the subset exactly and keep the canonical bytes. toDOM only draws the editing view.
import { Schema } from "prosemirror-model";

const classList = (...tokens) => tokens.filter(Boolean).join(" ") || null;
const attrs = (pairs) =>
  Object.fromEntries(pairs.filter(([, value]) => value !== null));

// Builds DOM from a plain tree (html.mjs) for protected blocks and chart previews; browser only.
const NS = {
  html: "http://www.w3.org/1999/xhtml",
  svg: "http://www.w3.org/2000/svg",
  math: "http://www.w3.org/1998/Math/MathML",
};
export function domFromTree(node) {
  if (node.type === "text") return document.createTextNode(node.value);
  if (node.type === "comment") return document.createComment(node.value);
  const el = document.createElementNS(NS[node.ns], node.name);
  for (const [name, value] of node.attrs) {
    const [prefix] = name.split(":");
    if (prefix === "xlink")
      el.setAttributeNS("http://www.w3.org/1999/xlink", name, value);
    else if (prefix === "xml")
      el.setAttributeNS("http://www.w3.org/XML/1998/namespace", name, value);
    else if (name === "xmlns" || prefix === "xmlns")
      el.setAttributeNS("http://www.w3.org/2000/xmlns/", name, value);
    else el.setAttribute(name, value);
  }
  const target = node.name === "template" ? el.content : el;
  for (const child of node.children) target.appendChild(domFromTree(child));
  return el;
}

const tocList = (entries) => [
  "ol",
  ...entries.map((e) => [
    "li",
    ["a", { href: `#${e.target}` }, e.label],
    ...(e.children.length ? [tocList(e.children)] : []),
  ]),
];

export const schema = new Schema({
  nodes: {
    doc: {
      // Never empty: an empty paragraph fills a document whose blocks were all deleted.
      content: "block+ comments? | cover block* comments? | comments",
      attrs: {
        lang: { default: "en" },
        headingNumbers: { default: false },
        headingFormat: { default: null },
        theme: { default: null },
        font: { default: null },
        page: { default: null },
      },
    },
    cover: {
      content: "title subtitle? paragraph*",
      defining: true,
      toDOM: () => ["header", { class: "cover" }, 0],
    },
    title: {
      content: "inline*",
      defining: true,
      toDOM: () => ["h1", { class: "title" }, 0],
    },
    subtitle: {
      content: "inline*",
      defining: true,
      toDOM: () => ["p", { class: "subtitle" }, 0],
    },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { lead: { default: false }, align: { default: null } },
      toDOM: (n) => [
        "p",
        attrs([["class", classList(n.attrs.lead && "lead", n.attrs.align)]]),
        0,
      ],
    },
    heading: {
      group: "block",
      content: "inline*",
      defining: true,
      attrs: {
        level: { default: 1 },
        id: {},
        unnumbered: { default: false },
        newPage: { default: false },
        align: { default: null },
      },
      toDOM: (n) => [
        `h${n.attrs.level}`,
        attrs([
          [
            "class",
            classList(
              n.attrs.unnumbered && "unnumbered",
              n.attrs.newPage && "new-page",
              n.attrs.align,
            ),
          ],
          ["id", n.attrs.id],
        ]),
        0,
      ],
    },
    blockquote: {
      group: "block",
      content: "paragraph+",
      defining: true,
      toDOM: () => ["blockquote", 0],
    },
    callout: {
      group: "block",
      content: "(paragraph | bullet_list | ordered_list)+",
      defining: true,
      attrs: { kind: { default: "note" } },
      toDOM: (n) => ["aside", { class: `callout ${n.attrs.kind}` }, 0],
    },
    code_block: {
      group: "block",
      content: "text*",
      marks: "",
      code: true,
      defining: true,
      toDOM: () => ["pre", ["code", 0]],
    },
    bullet_list: {
      group: "block",
      content: "list_item+",
      toDOM: () => ["ul", 0],
    },
    ordered_list: {
      group: "block",
      content: "list_item+",
      toDOM: () => ["ol", 0],
    },
    list_item: {
      content: "list_text (bullet_list | ordered_list)?",
      defining: true,
      toDOM: () => ["li", 0],
    },
    // The text of a list item, written directly inside <li>.
    list_text: {
      content: "inline*",
      toDOM: () => ["p", { class: "tx-li" }, 0],
    },
    page_break: {
      group: "block",
      atom: true,
      toDOM: () => ["hr", { class: "page-break" }],
    },
    // Generated contents: entries are [{target, label, children}], rewritten from headings (T08).
    toc: {
      group: "block",
      atom: true,
      attrs: { depth: { default: 2 }, entries: { default: [] } },
      toDOM: (n) => [
        "nav",
        { class: "toc", "data-depth": String(n.attrs.depth) },
        ...(n.attrs.entries.length ? [tocList(n.attrs.entries)] : []),
      ],
    },
    // data is the chart JSON exactly as written; preview the saved SVG as a plain tree.
    chart: {
      group: "block",
      content: "caption?",
      defining: true,
      attrs: {
        id: {},
        type: {},
        width: { default: "text" },
        data: {},
        preview: { default: null },
      },
      toDOM: (n) => {
        const figure = document.createElement("figure");
        figure.className = "chart";
        figure.id = n.attrs.id;
        figure.dataset.type = n.attrs.type;
        figure.dataset.width = n.attrs.width;
        const plot = figure.appendChild(document.createElement("div"));
        plot.className = "tx-plot";
        plot.contentEditable = "false";
        if (n.attrs.preview) plot.appendChild(domFromTree(n.attrs.preview));
        const content = figure.appendChild(document.createElement("div"));
        return { dom: figure, contentDOM: content };
      },
    },
    // The image itself is in the attributes: asset key and text alternative.
    image_figure: {
      group: "block",
      content: "caption?",
      defining: true,
      attrs: {
        id: {},
        width: { default: "text" },
        wrap: { default: null },
        asset: {},
        alt: {},
      },
      toDOM: (n) => [
        "figure",
        attrs([
          ["class", "image"],
          ["id", n.attrs.id],
          ["data-width", n.attrs.width],
          ["data-wrap", n.attrs.wrap],
        ]),
        [
          "div",
          { class: "tx-image", contenteditable: "false" },
          ["img", { "data-asset": n.attrs.asset, alt: n.attrs.alt }],
        ],
        ["div", 0],
      ],
    },
    table_figure: {
      group: "block",
      content: "caption? table",
      defining: true,
      attrs: { id: {} },
      toDOM: (n) => ["figure", { class: "table", id: n.attrs.id }, 0],
    },
    // cols: null, or one {width, emphasis} per column (the colgroup).
    table: {
      content: "table_row+",
      tableRole: "table",
      isolating: true,
      attrs: { compact: { default: false }, cols: { default: null } },
      toDOM: (n) => [
        "table",
        attrs([["class", n.attrs.compact ? "compact" : null]]),
        ...(n.attrs.cols
          ? [
              [
                "colgroup",
                ...n.attrs.cols.map((c) => [
                  "col",
                  attrs([
                    ["class", c.emphasis ? "emphasis" : null],
                    ["data-width", c.width],
                  ]),
                ]),
              ],
            ]
          : []),
        ["tbody", 0],
      ],
    },
    // head rows are the thead; total rows are tr.total in the tbody.
    table_row: {
      // A row covered entirely by rowspans above has no cell of its own.
      content: "(table_cell | table_header)*",
      tableRole: "row",
      attrs: { head: { default: false }, total: { default: false } },
      toDOM: (n) => [
        "tr",
        attrs([
          ["class", n.attrs.total ? "total" : n.attrs.head ? "tx-head" : null],
        ]),
        0,
      ],
    },
    table_cell: {
      content: "inline*",
      tableRole: "cell",
      isolating: true,
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        align: { default: null },
      },
      toDOM: (n) => ["td", cellAttrs(n), 0],
    },
    table_header: {
      content: "inline*",
      tableRole: "header_cell",
      isolating: true,
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        align: { default: null },
      },
      toDOM: (n) => ["th", cellAttrs(n), 0],
    },
    caption: {
      content: "inline*",
      toDOM: () => ["figcaption", 0],
    },
    comments: {
      content: "comment_thread+",
      toDOM: () => ["section", { class: "comments" }, 0],
    },
    // entries: [{author, date, text}]; context fields serve anchor recovery (T13).
    comment_thread: {
      atom: true,
      // Defaults only let ProseMirror check the schema; parsed threads always have these fields.
      attrs: {
        id: { default: "" },
        status: { default: "open" },
        quote: { default: "" },
        section: { default: null },
        prefix: { default: null },
        suffix: { default: null },
        entries: { default: [] },
      },
      toDOM: (n) => [
        "aside",
        {
          class: "comment-thread",
          id: n.attrs.id,
          "data-status": n.attrs.status,
        },
        ...n.attrs.entries.map((e) => [
          "p",
          { class: "comment", "data-author": e.author, "data-date": e.date },
          e.text,
        ]),
      ],
    },
    // Inert content outside the subset, kept as its plain tree: shown, saved unchanged, not editable.
    protected: {
      group: "block",
      atom: true,
      selectable: true,
      attrs: { node: {} },
      toDOM: (n) => {
        const wrapper = document.createElement("div");
        wrapper.className = "tx-protected";
        wrapper.contentEditable = "false";
        wrapper.appendChild(domFromTree(n.attrs.node));
        return wrapper;
      },
    },
    text: { group: "inline" },
    hard_break: {
      group: "inline",
      inline: true,
      selectable: false,
      toDOM: () => ["br"],
    },
    footnote: {
      group: "inline",
      inline: true,
      content: "(text | xref)*",
      toDOM: () => ["span", { class: "footnote" }, 0],
    },
    // A cross-reference: the label is generated from its target (T08) and saved for readers.
    xref: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { target: {}, label: { default: "" } },
      toDOM: (n) => [
        "a",
        { class: "xref", href: `#${n.attrs.target}` },
        n.attrs.label,
      ],
    },
  },
  // Rank order is the canonical nesting order, outermost first.
  marks: {
    comment: {
      attrs: { ref: {} },
      excludes: "",
      inclusive: false,
      toDOM: (m) => ["mark", { class: "comment", "data-ref": m.attrs.ref }],
    },
    link: {
      attrs: { href: {} },
      inclusive: false,
      toDOM: (m) => ["a", { href: m.attrs.href }],
    },
    strong: { toDOM: () => ["strong"] },
    em: { toDOM: () => ["em"] },
    u: { toDOM: () => ["u"] },
    highlight: { toDOM: () => ["mark"] },
    sub: { excludes: "sub sup", toDOM: () => ["sub"] },
    sup: { excludes: "sub sup", toDOM: () => ["sup"] },
    code: { toDOM: () => ["code"] },
  },
});

function cellAttrs(n) {
  return attrs([
    ["class", n.attrs.align],
    ["colspan", n.attrs.colspan > 1 ? String(n.attrs.colspan) : null],
    ["rowspan", n.attrs.rowspan > 1 ? String(n.attrs.rowspan) : null],
  ]);
}
