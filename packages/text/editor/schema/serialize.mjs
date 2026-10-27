// ProseMirror document to canonical HTML (FORMAT.md › Canonical form): a plain tree laid out with
// line breaks, then the fixed serialiser of html.mjs. Parsing this output gives back an equal document.
import { element, text, serialize } from "../../model/html.mjs";

const NL = () => text("\n");
// Class tokens, or null when there are none.
const tokens = (...list) => list.filter(Boolean).join(" ") || null;
// [name, value] pairs in canonical order; null values are left out (an empty value is kept).
const pairs = (list) => list.filter(([, v]) => v !== null);
// Each child on its own line: <x>\n<a>\n<b>\n</x>.
const lines = (children) => [...children.flatMap((c) => [NL(), c]), NL()];

const MARK = {
  comment: (m) =>
    element("mark", [
      ["class", "comment"],
      ["data-ref", m.attrs.ref],
    ]),
  link: (m) => element("a", [["href", m.attrs.href]]),
  strong: () => element("strong"),
  em: () => element("em"),
  u: () => element("u"),
  highlight: () => element("mark"),
  sub: () => element("sub"),
  sup: () => element("sup"),
  code: () => element("code"),
};

function inlineNode(node) {
  switch (node.type.name) {
    case "text":
      return text(node.text);
    case "hard_break":
      return element("br");
    case "footnote":
      return element("span", [["class", "footnote"]], inline(node.content));
    case "xref":
      return element(
        "a",
        [
          ["class", "xref"],
          ["href", `#${node.attrs.target}`],
        ],
        node.attrs.label ? [text(node.attrs.label)] : [],
      );
  }
  throw new Error(`Unexpected inline node ${node.type.name}`);
}

// Marks are sorted by rank (outermost first). An element stays open while the following
// nodes keep the same leading marks, so neighbours share their common outer elements.
function inline(fragment) {
  const root = [];
  const open = [];
  fragment.forEach((node) => {
    // HTML cannot nest <a>: the parser would split the link (FORMAT.md › Inline content).
    if (!node.isText && node.marks.some((m) => m.type.name === "link"))
      if (node.type.name !== "hard_break")
        throw new Error(`A link cannot contain a ${node.type.name}`);
    let keep = 0;
    while (
      keep < open.length &&
      keep < node.marks.length &&
      open[keep].mark.eq(node.marks[keep])
    )
      keep++;
    open.length = keep;
    for (const mark of node.marks.slice(keep)) {
      const el = MARK[mark.type.name](mark);
      (open.at(-1)?.el.children ?? root).push(el);
      open.push({ mark, el });
    }
    (open.at(-1)?.el.children ?? root).push(inlineNode(node));
  });
  return root;
}

const children = (node) => {
  const out = [];
  node.forEach((child) => out.push(block(child)));
  return out;
};

function list(node) {
  return element(
    node.type.name === "bullet_list" ? "ul" : "ol",
    [],
    lines(children(node)),
  );
}

function listItem(node) {
  const [textNode, nested] = [
    node.child(0),
    node.childCount > 1 ? node.child(1) : null,
  ];
  return element(
    "li",
    [],
    [...inline(textNode.content), ...(nested ? [block(nested)] : [])],
  );
}

function tocList(entries) {
  return element(
    "ol",
    [],
    lines(
      entries.map((e) =>
        element(
          "li",
          [],
          [
            element(
              "a",
              [["href", `#${e.target}`]],
              e.label ? [text(e.label)] : [],
            ),
            ...(e.children.length ? [tocList(e.children)] : []),
          ],
        ),
      ),
    ),
  );
}

function cell(node) {
  const a = node.attrs;
  return element(
    node.type.name === "table_header" ? "th" : "td",
    pairs([
      ["class", a.align],
      ["colspan", a.colspan > 1 ? String(a.colspan) : null],
      ["rowspan", a.rowspan > 1 ? String(a.rowspan) : null],
    ]),
    inline(node.content),
  );
}

function table(node) {
  const head = [],
    body = [];
  node.forEach((row) => {
    const cells = [];
    row.forEach((c) => cells.push(cell(c)));
    (row.attrs.head ? head : body).push(
      element(
        "tr",
        pairs([["class", row.attrs.total ? "total" : null]]),
        cells,
      ),
    );
  });
  const cols = node.attrs.cols;
  return element(
    "table",
    pairs([["class", node.attrs.compact ? "compact" : null]]),
    lines([
      ...(cols
        ? [
            element(
              "colgroup",
              [],
              cols.map((c) =>
                element(
                  "col",
                  pairs([
                    ["class", c.emphasis ? "emphasis" : null],
                    ["data-width", c.width],
                  ]),
                ),
              ),
            ),
          ]
        : []),
      ...(head.length ? [element("thead", [], lines(head))] : []),
      element("tbody", [], lines(body)),
    ]),
  );
}

function thread(node) {
  const a = node.attrs;
  return element(
    "aside",
    pairs([
      ["class", "comment-thread"],
      ["id", a.id],
      ["data-status", a.status],
      ["data-quote", a.quote],
      ["data-section", a.section],
      ["data-prefix", a.prefix],
      ["data-suffix", a.suffix],
    ]),
    lines(
      a.entries.map((e) =>
        element(
          "p",
          [
            ["class", "comment"],
            ["data-author", e.author],
            ["data-date", e.date],
          ],
          e.text ? [text(e.text)] : [],
        ),
      ),
    ),
  );
}

function block(node) {
  const a = node.attrs;
  switch (node.type.name) {
    case "paragraph":
      return element(
        "p",
        pairs([["class", tokens(a.lead && "lead", a.align)]]),
        inline(node.content),
      );
    case "heading":
      return element(
        `h${a.level}`,
        pairs([
          [
            "class",
            tokens(
              a.unnumbered && "unnumbered",
              a.newPage && "new-page",
              a.align,
            ),
          ],
          ["id", a.id],
        ]),
        inline(node.content),
      );
    case "cover":
      return element("header", [["class", "cover"]], lines(children(node)));
    case "title":
      return element("h1", [["class", "title"]], inline(node.content));
    case "subtitle":
      return element("p", [["class", "subtitle"]], inline(node.content));
    case "blockquote":
      return element("blockquote", [], lines(children(node)));
    case "callout":
      return element(
        "aside",
        [["class", `callout ${a.kind}`]],
        lines(children(node)),
      );
    case "code_block":
      return element(
        "pre",
        [],
        [element("code", [], node.textContent ? [text(node.textContent)] : [])],
      );
    case "bullet_list":
    case "ordered_list":
      return list(node);
    case "list_item":
      return listItem(node);
    case "page_break":
      return element("hr", [["class", "page-break"]]);
    case "toc":
      return element(
        "nav",
        [
          ["class", "toc"],
          ["data-depth", String(a.depth)],
        ],
        a.entries.length ? lines([tocList(a.entries)]) : [],
      );
    case "chart":
      return element(
        "figure",
        [
          ["class", "chart"],
          ["id", a.id],
          ["data-type", a.type],
          ["data-width", a.width],
        ],
        lines([
          element("script", [["type", "application/json"]], [text(a.data)]),
          ...(a.preview ? [a.preview] : []),
          ...children(node),
        ]),
      );
    case "image_figure":
      return element(
        "figure",
        pairs([
          ["class", "image"],
          ["id", a.id],
          ["data-width", a.width],
          ["data-wrap", a.wrap],
        ]),
        lines([
          element("img", [
            ["data-asset", a.asset],
            ["alt", a.alt],
          ]),
          ...children(node),
        ]),
      );
    case "table_figure":
      return element(
        "figure",
        [
          ["class", "table"],
          ["id", a.id],
        ],
        lines(children(node)),
      );
    case "table":
      return table(node);
    case "caption":
      return element("figcaption", [], inline(node.content));
    case "comments":
      return element("section", [["class", "comments"]], lines(children(node)));
    case "comment_thread":
      return thread(node);
    case "protected":
      return a.node;
  }
  throw new Error(`Unexpected block ${node.type.name}`);
}

const ARTICLE = [
  ["data-heading-numbers", (a) => (a.headingNumbers ? "on" : null)],
  ["data-heading-format", (a) => a.headingFormat],
  ["data-theme", (a) => a.theme],
  ["data-font", (a) => a.font],
  ["data-page", (a) => a.page],
  ["data-margins", (a) => a.margins],
];

// The article#doc element as a plain tree. A protected text block keeps its own surrounding
// whitespace, so line breaks are added only between two blocks that are not text.
export function articleTree(doc) {
  const blocks = children(doc);
  const content = [];
  blocks.forEach((b, i) => {
    if (b.type !== "text" && (i === 0 || blocks[i - 1].type !== "text"))
      content.push(NL());
    content.push(b);
  });
  if (!blocks.length || blocks.at(-1).type !== "text") content.push(NL());
  return element(
    "article",
    pairs([
      ["id", "doc"],
      ["data-format", "1"],
      ["lang", doc.attrs.lang],
      ...ARTICLE.map(([name, get]) => [name, get(doc.attrs)]),
    ]),
    content,
  );
}

export const articleHTML = (doc) => serialize(articleTree(doc));
