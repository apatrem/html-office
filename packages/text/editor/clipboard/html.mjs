// Pasted HTML onto the subset (T07): from Word, Google Docs, Excel, Sheets, web pages, Markdown
// (markdown.mjs renders it to HTML first) and Text itself. The input is an inert DOM, a detached
// <template>'s content (ADR-013 §1) or the parse5 view of the Node tests: it is read as data and
// never inserted into the page, so nothing in it runs, loads or links anywhere but through a
// subset link. Headings, paragraphs, lists, quotes, code, inline formatting, links and tables map
// to the subset's own constructs, with the destination's styles; colours, fonts, sizes, spacing,
// alignment and Word or Docs markup are dropped. What the subset cannot hold is counted in `lost`
// (see LOST), so the paste or the import can say so.
import {
  safeURL,
  readTableElement,
  classRules,
  declarations,
  hidden,
  weight,
  slant,
  validateTable,
} from "../../../shared/clipboard/index.mjs";
import { schema } from "../schema/schema.mjs";
import { headingId } from "../commands.mjs";
import {
  ID,
  RESERVED_ID_PREFIXES,
  ALIGN,
  CALLOUTS,
} from "../../model/format.mjs";
import { tableFigure } from "./table.mjs";
import { dataImage, PASTE_IMAGES } from "./images.mjs";

const N = schema.nodes,
  M = schema.marks;
const ELEMENT = 1,
  TEXT = 3;

// What a paste or an import could not represent, in the report's order: [key, one, many, kind].
// "left out" content is not in the document; "adapted" content is, in another form.
export const LOST = [
  ["image", "image", "images", "left out"],
  [
    "image-limit",
    "image over the paste limits (20 images, 20 MB and 50 megapixels each)",
    "images over the paste limits (20 images, 20 MB and 50 megapixels each)",
    "left out",
  ],
  [
    "image-unread",
    "image that could not be read",
    "images that could not be read",
    "left out",
  ],
  [
    "image-alt",
    "image without alt text",
    "images without alt text",
    "left out",
  ],
  [
    "image-inner",
    "image inside a heading, list, quote or table",
    "images inside headings, lists, quotes or tables",
    "left out",
  ],
  [
    "image-place",
    "image where only text goes",
    "images where only text goes",
    "left out",
  ],
  [
    "file",
    "file that is not a PNG, JPEG, GIF, WebP or SVG image",
    "files that are not PNG, JPEG, GIF, WebP or SVG images",
    "left out",
  ],
  ["chart", "chart", "charts", "left out"],
  ["rule", "horizontal rule", "horizontal rules", "left out"],
  [
    "note",
    "Word footnote or comment",
    "Word footnotes or comments",
    "left out",
  ],
  ["media", "embedded object", "embedded objects", "left out"],
  ["heading", "heading of level 5 or 6", "headings of level 5 or 6", "adapted"],
  ["quote", "block inside a quote", "blocks inside quotes", "adapted"],
  ["item", "block inside a list item", "blocks inside list items", "adapted"],
  ["span", "overlapping merged cell", "overlapping merged cells", "adapted"],
  [
    "link",
    "link to another kind of address",
    "links to other kinds of addresses",
    "adapted",
  ],
];
// One sentence per kind, such as "Left out: 2 images, 1 horizontal rule.", or "".
export function describeLost(lost) {
  const parts = { "left out": [], adapted: [] };
  for (const [key, one, many, kind] of LOST) {
    const n = lost.get(key);
    if (n) parts[kind].push(`${n} ${n > 1 ? many : one}`);
  }
  return [
    parts["left out"].length && `Left out: ${parts["left out"].join(", ")}.`,
    parts.adapted.length &&
      `Adapted to the document's styles: ${parts.adapted.join(", ")}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

// Never content: their text and children are skipped (MEDIA ones are counted).
const SKIP = new Set([
  "head",
  "title",
  "meta",
  "link",
  "style",
  "script",
  "template",
  "noscript",
  "xml",
  "select",
  "button",
  "input",
  "textarea",
  "option",
  "datalist",
  "map",
  "area",
  "dialog",
  "slot",
  "nav",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "video",
  "audio",
  "canvas",
  "svg",
  "math",
  "portal",
]);
const MEDIA = new Set([
  "iframe",
  "frame",
  "object",
  "embed",
  "applet",
  "video",
  "audio",
  "canvas",
  "svg",
  "math",
  "portal",
]);
// Elements that break the inline flow; anything else is inline (its children join the text).
const BLOCK = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "caption",
  "center",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "html",
  "legend",
  "li",
  "main",
  "menu",
  "ol",
  "p",
  "pre",
  "search",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);
const LISTS = ["ul", "ol"];
// List nesting kept as lists; the format bounds nesting at 256 elements (two per level).
const MAX_LIST_LEVELS = 64;
// Text strips control characters other than tabs and line breaks (they have no rendering).
const CONTROLS = /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g;

const kids = (node) => Array.from(node.childNodes ?? []);
// Children onto a stack, first on top (no spread: an element may have 100,000 children).
function pushReversed(stack, list) {
  for (let i = list.length - 1; i >= 0; i--) stack.push(list[i]);
}
// The text of a subtree, without recursion (clipboard HTML may be nested arbitrarily deep).
function textOf(node) {
  let text = "";
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (n.nodeType === TEXT) text += n.data;
    else if (!(n.nodeType === ELEMENT && SKIP.has(n.localName)))
      pushReversed(stack, kids(n));
  }
  return text;
}
const classOf = (node) => (node.getAttribute("class") ?? "").split(/\s+/);
const has = (node, name) => classOf(node).includes(name);

// Inline content in the making: text with marks, breaks and inline nodes, white space collapsed
// as a browser lays it out; flushed into a paragraph (or taken by a heading, item or cell).
class Flow {
  // top: the flow of the pasted blocks themselves, where an image becomes a figure (T12b).
  constructor(top = false) {
    this.blocks = [];
    this.items = [];
    this.top = top;
  }
  text(value, marks) {
    this.items.push({ text: value.replace(CONTROLS, ""), marks });
  }
  node(node) {
    this.items.push({ node });
  }
  figure(figure) {
    this.items.push({ figure });
  }
  // The inline nodes so far, and empties the flow. Spaces collapse across elements; spaces at the
  // edges and before a break go; breaks at the edges go too.
  take() {
    const out = [];
    let space = true;
    const trim = () => {
      const last = out.at(-1);
      if (last?.isText && last.text.endsWith(" ")) {
        const rest = last.text.replace(/ +$/, "");
        out.pop();
        if (rest) out.push(last.withText(rest));
      }
    };
    for (const item of this.items) {
      if (item.node) {
        if (item.node.type === N.hard_break) trim();
        out.push(item.node);
        space = item.node.type === N.hard_break;
        continue;
      }
      let value = "";
      for (const c of item.text.replace(/[ \t\n\r\f]+/g, " ")) {
        if (c === " " && space) continue;
        value += c;
        space = c === " ";
      }
      if (value) out.push(schema.text(value, item.marks));
    }
    trim();
    while (out[0]?.type === N.hard_break) out.shift();
    while (out.at(-1)?.type === N.hard_break) out.pop();
    this.items = [];
    return out;
  }
  // The pending inline content as a paragraph, unless it is empty or only spaces (Word's
  // <o:p>&nbsp;</o:p> spacing paragraphs). A figure splits it: the text on each side is a
  // paragraph with the same attributes.
  flush(attrs = null) {
    const all = this.items;
    let start = 0;
    for (let i = 0; i <= all.length; i++) {
      if (i < all.length && !all[i].figure) continue;
      this.items = all.slice(start, i);
      const content = this.take();
      if (content.some((n) => !n.isText || /\S/.test(n.text)))
        this.blocks.push(N.paragraph.create(attrs, content));
      if (i < all.length) this.blocks.push(all[i].figure);
      start = i + 1;
    }
    this.items = [];
  }
}

// Inline nodes of the textblocks among `blocks`, one line each (joined by breaks).
function lines(blocks, out = []) {
  for (const block of blocks) {
    if (block.isTextblock && block.type !== N.code_block) {
      if (block.content.size) {
        if (out.length) out.push(N.hard_break.create());
        block.content.forEach((n) => out.push(n));
      }
    } else if (block.type === N.table) {
      // One line per row, cells separated by spaces.
      block.forEach((row) => {
        const cells = [];
        row.forEach((cell) => cell.content.size && cells.push(cell));
        if (!cells.length) return;
        if (out.length) out.push(N.hard_break.create());
        cells.forEach((cell, i) => {
          if (i) out.push(schema.text(" "));
          cell.content.forEach((n) => out.push(n));
        });
      });
    } else if (block.type === N.code_block) {
      block.textContent.split("\n").forEach((line) => {
        if (!line) return;
        if (out.length) out.push(N.hard_break.create());
        out.push(schema.text(line));
      });
    } else lines(childrenOf(block), out);
  }
  return out;
}
const childrenOf = (node) => {
  const out = [];
  node.forEach((child) => out.push(child));
  return out;
};

// Word writes list items as paragraphs styled "mso-list: l0 level2 lfo1" (list l0, level 2),
// with the bullet or number in a span styled "mso-list: Ignore".
const wordItem = (css) => {
  const m = /^l(\d+) +level(\d+)/.exec(css.get("mso-list") ?? "");
  return m ? { list: m[1], level: Number(m[2]) } : null;
};
function wordMarker(node, rules) {
  // Depth first in document order, without recursion (nesting is unbounded).
  const stack = [];
  pushReversed(stack, kids(node));
  while (stack.length) {
    const kid = stack.pop();
    if (kid.nodeType !== ELEMENT) continue;
    if (declarations(kid, rules).get("mso-list") === "ignore")
      return textOf(kid);
    pushReversed(stack, kids(kid));
  }
  return null;
}
const ORDERED_MARKER = /^\s*\(?([0-9]+|[a-z]{1,3}|[ivxlcdm]+)[.)]/i;

export class Mapper {
  // used: every ID the document uses or may not use (usedIds); it gains the new ones.
  // targets: the IDs of the document's headings and figures; a cross-reference to anything else
  // (another document's heading) becomes its label's text.
  // images: whether a data: image among the pasted blocks becomes a placeholder figure (T12b),
  // listed in `images` as {node, type, base64, payload, bytes, alt} for the runtime to resolve.
  constructor(
    root,
    {
      used = new Set(),
      targets = new Set(),
      maxCells = Infinity,
      images = false,
    } = {},
  ) {
    this.root = root;
    this.images = images ? [] : null;
    this.used = used;
    this.targets = targets;
    this.maxCells = maxCells;
    this.rules = classRules(root);
    this.levels = 0;
    // Text's alignment classes, as rules the shared table reader applies to cells.
    for (const [name, align] of [
      ["ta-l", "left"],
      ["ta-c", "center"],
      ["ta-r", "right"],
    ])
      this.rules.set(name, `${this.rules.get(name) ?? ""};text-align:${align}`);
    this.lost = new Map();
  }
  count(key, n = 1) {
    this.lost.set(key, (this.lost.get(key) ?? 0) + n);
  }
  // The fragment's blocks.
  blocks() {
    const flow = new Flow(true);
    this.children(this.root, flow, [], 0);
    flow.flush();
    return flow.blocks;
  }

  // Visits the children of `node`, grouping Word's list paragraphs into lists.
  children(node, flow, marks, depth) {
    const list = kids(node);
    for (let i = 0; i < list.length; i++) {
      const kid = list[i];
      const first =
        kid.nodeType === ELEMENT &&
        kid.localName === "p" &&
        wordItem(declarations(kid, this.rules));
      if (first) {
        // The paragraphs of one Word list, with white space and comments between them.
        const run = [];
        for (; i < list.length; i++) {
          const k = list[i];
          if (k.nodeType === TEXT && !/\S/.test(k.data)) continue;
          if (k.nodeType !== ELEMENT && k.nodeType !== TEXT) continue;
          const item =
            k.nodeType === ELEMENT &&
            k.localName === "p" &&
            wordItem(declarations(k, this.rules));
          if (!item || item.list !== first.list) break;
          run.push({ node: k, level: item.level });
        }
        i--;
        flow.flush();
        flow.blocks.push(this.wordList(run, marks, depth));
        continue;
      }
      this.visit(kid, flow, marks, depth + 1);
    }
  }

  visit(node, flow, marks, depth) {
    if (node.nodeType === TEXT) return flow.text(node.data, marks);
    if (node.nodeType !== ELEMENT) return;
    const tag = node.localName;
    if (SKIP.has(tag)) {
      if (MEDIA.has(tag)) this.count("media");
      return;
    }
    const css = declarations(node, this.rules);
    if (hidden(css) || css.get("mso-list") === "ignore") return;
    // Word comments, footnotes and endnotes: their lists, and their references (counted).
    if (css.has("mso-element")) return;
    if (
      /^Mso(Comment|Footnote|Endnote)Reference$/.test(classOf(node)[0] ?? "") ||
      css.has("mso-footnote-id") ||
      css.has("mso-endnote-id")
    )
      return this.count("note");
    // Deep structures keep their text only, without recursion.
    if (depth > 200) return flow.text(textOf(node), marks);
    if (tag === "img") return this.image(node, flow);
    if (tag === "br") return flow.node(N.hard_break.create(null, null, marks));
    if (BLOCK.has(tag)) return this.block(node, tag, css, flow, marks, depth);
    if (tag === "span" && has(node, "footnote"))
      return flow.node(this.footnote(node, marks, depth));
    if (tag === "a" && has(node, "xref")) {
      const target = (node.getAttribute("href") ?? "").slice(1);
      if (ID.test(target) && this.targets.has(target))
        return flow.node(
          N.xref.create(
            {
              target,
              label: textOf(node)
                .replace(/\s+/g, " ")
                .replace(CONTROLS, "")
                .trim(),
            },
            null,
            M.link.removeFromSet(marks),
          ),
        );
    }
    this.children(node, flow, this.marks(node, tag, css, marks), depth);
  }

  // An image whose data is in the clipboard (a data: URL) among the pasted blocks becomes a
  // placeholder figure within the limits; any other is left out. Nothing is ever fetched.
  image(node, flow) {
    const found = this.images && dataImage(node.getAttribute("src") ?? "");
    if (!found) return this.count("image");
    if (!flow.top) return this.count("image-inner");
    if (
      this.images.length >= PASTE_IMAGES.count ||
      found.bytes > PASTE_IMAGES.bytes
    )
      return this.count("image-limit");
    const alt = (node.getAttribute("alt") ?? "")
      .replace(CONTROLS, "")
      .replace(/\s+/g, " ")
      .trim();
    const figure = placeholder(alt);
    this.images.push({ node: figure, alt, ...found });
    flow.figure(figure);
  }

  // Marks of an inline element: tags first, then its own styles (Docs writes font-weight:700 on
  // spans and font-weight:normal on its <b> wrapper).
  marks(node, tag, css, marks) {
    const set = (type, on) =>
      (marks = on ? type.create().addToSet(marks) : type.removeFromSet(marks));
    if (tag === "b" || tag === "strong") set(M.strong, true);
    if (tag === "i" || tag === "em") set(M.em, true);
    if (tag === "u" || tag === "ins") set(M.u, true);
    if (tag === "sup") set(M.sup, true);
    if (tag === "sub") set(M.sub, true);
    if (["code", "kbd", "samp", "tt"].includes(tag)) set(M.code, true);
    if (tag === "mark" && !has(node, "comment")) set(M.highlight, true);
    const bold = weight(css.get("font-weight"));
    if (bold !== undefined) set(M.strong, bold);
    const italic = slant(css.get("font-style"));
    if (italic !== undefined) set(M.em, italic);
    const line = css.get("text-decoration-line") ?? css.get("text-decoration");
    // A link's own underline is the link's look, not underlined text.
    if (line !== undefined && !M.link.isInSet(marks))
      set(M.u, line.includes("underline"));
    const shift = css.get("vertical-align");
    if (shift === "super" || shift === "sub")
      set(shift === "super" ? M.sup : M.sub, true);
    if (tag === "a") {
      const href = (node.getAttribute("href") ?? "").trim();
      if (href && safeURL(href))
        marks = M.link.create({ href }).addToSet(marks);
      else if (href && !href.startsWith("#")) this.count("link");
    }
    return marks;
  }

  // Inline content of an element, with nested blocks as lines.
  inline(node, marks, depth) {
    const flow = new Flow();
    this.children(node, flow, marks, depth);
    const content = flow.take();
    return flow.blocks.length
      ? lines([...flow.blocks, N.paragraph.create(null, content)])
      : content;
  }

  // A footnote holds text and cross-references: breaks become spaces, a nested note its text.
  footnote(node, marks, depth) {
    const content = [];
    for (const n of this.inline(node, [], depth))
      if (n.isText || n.type === N.xref) content.push(n);
      else if (n.type === N.hard_break) content.push(schema.text(" "));
      else if (n.textContent) content.push(schema.text(n.textContent));
    return N.footnote.create(null, content, M.link.removeFromSet(marks));
  }

  heading(node, level, flow, marks, depth, cls = []) {
    const content = this.inline(node, marks, depth);
    if (!content.length) return;
    if (level > 4) this.count("heading");
    const own = node.getAttribute("id");
    const id =
      own &&
      ID.test(own) &&
      !this.used.has(own) &&
      !RESERVED_ID_PREFIXES.some((p) => own.startsWith(p))
        ? (this.used.add(own), own)
        : headingId(content.map((n) => n.textContent).join(""), this.used);
    flow.blocks.push(
      N.heading.create(
        {
          level: Math.min(level, 4),
          id,
          unnumbered: cls.includes("unnumbered"),
          newPage: cls.includes("new-page"),
          align: cls.find((c) => ["ta-l", "ta-c", "ta-r"].includes(c)) ?? null,
        },
        content,
      ),
    );
  }

  block(node, tag, css, flow, marks, depth) {
    flow.flush();
    const cls = classOf(node);
    const word = cls[0] ?? "";
    if (/^h[1-6]$/.test(tag))
      return this.heading(node, Number(tag[1]), flow, marks, depth, cls);
    if (tag === "p" && word === "MsoTitle")
      return this.heading(node, 1, flow, marks, depth);
    switch (tag) {
      case "p":
        this.children(node, flow, marks, depth);
        flow.flush({
          lead: cls.includes("lead") || word === "MsoSubtitle",
          align: cls.find((c) => ALIGN.includes(c)) ?? null,
        });
        return;
      case "ul":
      case "ol":
        return flow.blocks.push(...this.list(node, marks, depth));
      case "pre":
        return this.code(node, flow);
      case "blockquote":
        return this.wrapper(node, N.blockquote, null, flow, marks, depth);
      case "aside":
        if (cls[0] === "callout" && CALLOUTS.includes(cls[1]))
          return this.wrapper(
            node,
            N.callout,
            { kind: cls[1] },
            flow,
            marks,
            depth,
          );
        if (cls[0] === "comment-thread") return;
        break;
      case "section":
        if (cls[0] === "comments") return;
        break;
      case "hr":
        if (cls.includes("page-break")) flow.blocks.push(N.page_break.create());
        else this.count("rule");
        return;
      case "table":
        return this.table(node, null, flow, depth);
      case "figure":
        if (cls[0] === "chart") return this.count("chart");
        if (cls[0] === "image") return this.count("image");
        if (cls[0] === "table") {
          const table = kids(node).find(
            (k) => k.nodeType === ELEMENT && k.localName === "table",
          );
          const caption = kids(node).find(
            (k) => k.nodeType === ELEMENT && k.localName === "figcaption",
          );
          if (table) return this.table(table, caption, flow, depth);
        }
        break;
      case "header":
        // Text's cover: the title is a first-level heading and the subtitle a lead paragraph.
        if (cls[0] === "cover") {
          for (const kid of kids(node)) {
            if (kid.nodeType !== ELEMENT) continue;
            if (kid.localName === "h1")
              this.heading(kid, 1, flow, marks, depth + 1);
            else {
              this.children(kid, flow, marks, depth + 1);
              flow.flush({ lead: has(kid, "subtitle") });
            }
          }
          return;
        }
        break;
    }
    this.children(node, flow, marks, depth);
    flow.flush();
  }

  // pre: its text, with line breaks kept and the final one dropped.
  code(node, flow) {
    let text = "";
    // Without recursion: clipboard HTML may be nested arbitrarily deep.
    const stack = kids(node).reverse();
    while (stack.length) {
      const k = stack.pop();
      if (k.nodeType === TEXT) text += k.data;
      else if (k.nodeType === ELEMENT && !SKIP.has(k.localName)) {
        if (k.localName === "br") text += "\n";
        else if (k.localName !== "img") pushReversed(stack, kids(k));
      }
    }
    // The HTML parser already turned CR LF into LF: a CR left is a written &#13; and stays.
    text = text.replace(CONTROLS, "").replace(/\n$/, "");
    flow.blocks.push(
      N.code_block.create(null, text ? schema.text(text) : null),
    );
  }

  // A quote holds paragraphs; a callout paragraphs and lists. Other blocks inside become
  // paragraphs of their text (counted).
  wrapper(node, type, attrs, flow, marks, depth) {
    const inner = new Flow();
    this.children(node, inner, marks, depth);
    inner.flush();
    const content = [];
    for (const block of inner.blocks) {
      // Their paragraphs take alignment only.
      if (block.type === N.paragraph) {
        content.push(
          block.type.create({ ...block.attrs, lead: false }, block.content),
        );
        continue;
      }
      if (
        type === N.callout &&
        [N.bullet_list, N.ordered_list].includes(block.type)
      ) {
        content.push(block);
        continue;
      }
      this.count("quote");
      const text = lines([block]);
      if (text.length) content.push(N.paragraph.create(null, text));
    }
    if (content.length) flow.blocks.push(type.create(attrs, content));
  }

  // A list: each item's text (its paragraphs joined by breaks) and one nested list (several are
  // joined). A list directly inside a list (Docs writes nested levels so) nests in the item before.
  list(node, marks, depth) {
    // Lists nested deeper than the format holds: the rest is the text of one item.
    if (this.levels >= MAX_LIST_LEVELS) {
      this.count("item");
      return [
        N.bullet_list.create(null, [
          this.listItem({ text: this.inline(node, marks, depth), nested: [] }),
        ]),
      ];
    }
    this.levels++;
    try {
      return this.items(node, marks, depth);
    } finally {
      this.levels--;
    }
  }
  items(node, marks, depth) {
    const items = [];
    for (const kid of kids(node)) {
      if (kid.nodeType === TEXT && !/\S/.test(kid.data)) continue;
      if (kid.nodeType === ELEMENT && LISTS.includes(kid.localName)) {
        if (!items.length) items.push({ text: [], nested: [] });
        items.at(-1).nested.push(...this.list(kid, marks, depth + 1));
        continue;
      }
      if (kid.nodeType === ELEMENT && kid.localName === "li")
        items.push(this.item(kid, marks, depth + 1));
      else if (kid.nodeType === ELEMENT || kid.nodeType === TEXT) {
        const flow = new Flow();
        this.visit(kid, flow, marks, depth + 1);
        flow.flush();
        if (flow.blocks.length)
          items.push({ text: lines(flow.blocks), nested: [] });
      }
    }
    if (!items.length) return [];
    return [
      N[node.localName === "ol" ? "ordered_list" : "bullet_list"].create(
        null,
        items.map((item) => this.listItem(item)),
      ),
    ];
  }
  item(li, marks, depth) {
    const flow = new Flow(),
      nested = [];
    for (const kid of kids(li)) {
      if (kid.nodeType === ELEMENT && LISTS.includes(kid.localName)) {
        flow.flush();
        nested.push(...this.list(kid, marks, depth + 1));
      } else this.visit(kid, flow, marks, depth + 1);
    }
    flow.flush();
    const textual = flow.blocks.filter((b) => b.type === N.paragraph).length;
    if (flow.blocks.length > 1 || textual !== flow.blocks.length)
      this.count("item", flow.blocks.length - (textual ? 1 : 0));
    return { text: lines(flow.blocks), nested };
  }
  listItem({ text, nested }) {
    const [first, ...rest] = nested;
    const joined =
      first &&
      first.type.create(
        null,
        [first, ...rest].flatMap((list) => childrenOf(list)),
      );
    return N.list_item.create(null, [
      N.list_text.create(null, text),
      ...(joined ? [joined] : []),
    ]);
  }
  // Word's list paragraphs [{node, level}] as nested lists; a numbered marker makes an ordered list.
  wordList(run, marks, depth) {
    // Levels deeper than the format holds are flattened into the deepest one it holds.
    const base = Math.min(...run.map((r) => r.level)),
      deepest = base + Math.max(0, MAX_LIST_LEVELS - this.levels - 1);
    run = run.map((r) => {
      if (r.level <= deepest) return r;
      this.count("item");
      return { ...r, level: deepest };
    });
    const make = (start, level) => {
      const items = [];
      let i = start;
      while (i < run.length && run[i].level >= level) {
        if (run[i].level > level) {
          const { list, end } = make(i, run[i].level);
          if (!items.length) items.push({ text: [], nested: [] });
          items.at(-1).nested.push(list);
          i = end;
          continue;
        }
        items.push({
          text: this.inline(run[i].node, marks, depth + 1),
          nested: [],
        });
        i++;
      }
      const marker = wordMarker(run[start].node, this.rules) ?? "";
      const type = ORDERED_MARKER.test(marker) ? N.ordered_list : N.bullet_list;
      return {
        list: type.create(
          null,
          items.map((item) => this.listItem(item)),
        ),
        end: i,
      };
    };
    const level = base;
    const out = [];
    let i = 0;
    while (i < run.length) {
      const { list, end } = make(i, level);
      out.push(list);
      i = end;
    }
    return out.length === 1
      ? out[0]
      : out[0].type.create(
          null,
          out.flatMap((l) => childrenOf(l)),
        );
  }

  // A table: the shared reader gives the portable table (spans, header rows, bold, italic,
  // alignment, links), then Text's own markup adds widths, emphasis, density and total rows.
  table(node, caption, flow, depth) {
    caption ??= kids(node).find(
      (k) => k.nodeType === ELEMENT && k.localName === "caption",
    );
    const sources = [];
    const read = readTableElement(node, {
      maxCells: this.maxCells,
      rules: this.rules,
      sources,
    });
    if (!read) return;
    // Spans that overlap (malformed HTML) cannot be kept: the cells stay, unmerged.
    try {
      validateTable(read.table);
    } catch {
      this.count("span");
      read.table.rows = read.table.rows.map((row) =>
        row.map((slot) => {
          if (!slot || slot.covered) return null;
          const { colspan: _c, rowspan: _r, ...rest } = slot;
          return rest;
        }),
      );
    }
    // The reader gives the grid (spans, header rows, alignment); each cell's text is mapped here,
    // with every mark of the subset, its paragraphs as lines. Bold and italic set on the row or
    // the cell (Excel's class rules) apply to the whole cell.
    const content = new Map();
    for (const { r, c, cell, row } of sources) {
      let marks = [];
      for (const el of [row, cell]) {
        const css = declarations(el, this.rules);
        const bold = weight(css.get("font-weight")),
          italic = slant(css.get("font-style"));
        if (bold !== undefined)
          marks = bold
            ? M.strong.create().addToSet(marks)
            : M.strong.removeFromSet(marks);
        if (italic !== undefined)
          marks = italic
            ? M.em.create().addToSet(marks)
            : M.em.removeFromSet(marks);
      }
      content.set(`${r},${c}`, this.inline(cell, marks, depth + 1));
    }
    const extras = {
      ...ownTable(node, read.table),
      content: (r, c) => content.get(`${r},${c}`),
    };
    let cap = null;
    if (caption) {
      const content = this.inline(caption, [], depth + 1);
      if (content.length) cap = N.caption.create(null, content);
    }
    flow.blocks.push(tableFigure(read.table, this.used, cap, extras));
  }
}

// Widths, emphasis, density and total rows written as Text writes them (FORMAT.md › Table).
function ownTable(node, model) {
  const parts = kids(node).filter((k) => k.nodeType === ELEMENT);
  const colgroup = parts.find((p) => p.localName === "colgroup");
  const cols = colgroup
    ? kids(colgroup)
        .filter((k) => k.nodeType === ELEMENT && k.localName === "col")
        .map((col) => {
          const width = col.getAttribute("data-width");
          return {
            width: /^(100|[1-9][0-9]?)$/.test(width ?? "") ? width : null,
            emphasis: has(col, "emphasis"),
          };
        })
    : null;
  const width = model.rows[0].length;
  const totals = [];
  let r = 0;
  // Rows in the reader's order: header, body (bare rows too), footer. Footer rows are totals.
  const rows = (tag) =>
    tag === "tbody"
      ? parts.flatMap((p) =>
          p.localName === "tr" ? [p] : p.localName === "tbody" ? kids(p) : [],
        )
      : parts.filter((p) => p.localName === tag).flatMap(kids);
  for (const section of ["thead", "tbody", "tfoot"])
    for (const tr of rows(section))
      if (tr.nodeType === ELEMENT && tr.localName === "tr") {
        if (section === "tfoot" || (section === "tbody" && has(tr, "total")))
          totals.push(r);
        r++;
      }
  return {
    cols:
      cols?.length === width && cols.some((c) => c.width || c.emphasis)
        ? cols
        : null,
    compact: has(node, "compact"),
    totals,
  };
}

// Plain text as paragraphs, one per line (blank lines are not paragraphs).
export function textBlocks(text) {
  return text
    .replace(CONTROLS, "")
    .split(/\r\n?|\n/)
    .map((line) => line.replace(/[\t\f]/g, " ").trim())
    .filter(Boolean)
    .map((line) => N.paragraph.create(null, schema.text(line)));
}

// A figure standing for a pasted image until the runtime has its asset (T12b).
export const placeholder = (alt = "") =>
  N.image_figure.create({ id: "", width: "text", wrap: null, asset: "", alt });

// HTML (an inert root) as blocks, with what could not be represented; with `images`, the data:
// images among the blocks as placeholders ({node, …} in `images`).
export function fromHTML(root, options) {
  const mapper = new Mapper(root, options);
  const cell = copiedCell(root, mapper.rules);
  if (cell) {
    const content = mapper.inline(cell, [], 0);
    return {
      blocks: content.length ? [N.paragraph.create(null, content)] : [],
      lost: mapper.lost,
      images: [],
    };
  }
  return {
    blocks: mapper.blocks(),
    lost: mapper.lost,
    images: mapper.images ?? [],
  };
}

// Text copied inside one table cell of a ProseMirror editor (Text's own): ProseMirror wraps the
// cell in a table for transport and says so in data-pm-slice ("1 1 -3 […]", three wrappers). It
// is text, not a table: the cell's content is returned, or null for anything else. Each wrapper
// (table, row group, row, cell) holds nothing but the next one, and none is hidden.
function copiedCell(root, rules) {
  const only = (node) => {
    const parts = kids(node).filter(
      (k) =>
        k.nodeType === ELEMENT || (k.nodeType === TEXT && /\S/.test(k.data)),
    );
    return parts.length === 1 && parts[0].nodeType === ELEMENT
      ? parts[0]
      : null;
  };
  const table = only(root);
  if (
    table?.localName !== "table" ||
    !/^[1-9]\d* [1-9]\d* -\d+ /.test(table.getAttribute("data-pm-slice") ?? "")
  )
    return null;
  const chain = [table];
  let node = only(table);
  if (["thead", "tbody", "tfoot"].includes(node?.localName)) {
    chain.push(node);
    node = only(node);
  }
  if (node?.localName !== "tr") return null;
  chain.push(node);
  node = only(node);
  if (!["td", "th"].includes(node?.localName)) return null;
  chain.push(node);
  return chain.some((n) => hidden(declarations(n, rules))) ? null : node;
}

// Blocks as the inline content of one paragraph (a table cell, a caption, a title): their lines,
// joined by breaks; a table gives a line per row.
export const inlineLines = (blocks) => lines(blocks);
