// Validator of the canonical Text subset (FORMAT.md). Works on the plain tree of html.mjs, so the
// Node tools (parse5, with line and column) and the browser (DOM, with paths only) apply the same rules.
//
// Three outcomes per finding:
// - errors: unsafe or malformed content. The file is rejected before editing.
// - protected: inert content outside the subset. Its top-level block is shown and kept intact, not edited.
// - warnings: valid content that needs attention (missing cross-reference target, orphaned thread…).
import {
  attributeProblem,
  styleProblem,
  assetProblem,
} from "../../../src/format.js";
import { registry } from "../../shared/charts/index.mjs";
import { strictValidate } from "../../shared/charts/schema.mjs";
import { attr, classes, elements, isBlank } from "./html.mjs";
import * as F from "./format.mjs";

class Context {
  errors = [];
  warnings = [];
  protected = [];
  ids = new Map();
  headings = new Set();
  figures = new Set();
  threads = new Map();
  refs = [];
  xrefs = [];
  toc = [];
  sections = [];
  previewIds = [];
  constructor(assets) {
    this.assets = assets;
  }
  finding(list, code, message, node, path, attribute) {
    const at = (attribute && node?.loc?.attrs?.[attribute]) || node?.loc;
    list.push({
      code,
      message,
      path,
      ...(at ? { line: at.line, col: at.col } : {}),
    });
  }
  error(code, message, node, path, attribute) {
    this.finding(this.errors, code, message, node, path, attribute);
  }
  warn(code, message, node, path, attribute) {
    this.finding(this.warnings, code, message, node, path, attribute);
  }
}

const nonBlank = (node) => node.children.filter((n) => !isBlank(n));
const isElement = (node, name) =>
  node?.type === "element" && node.ns === "html" && node.name === name;
const textOf = (node) =>
  node.children.map((n) => (n.type === "text" ? n.value : "")).join("");
const onlyText = (node) => node.children.every((n) => n.type === "text");
const label = (node) => {
  if (node.type !== "element") return `#${node.type}`;
  const id = attr(node, "id");
  const cls = classes(node)[0];
  return node.name + (id ? `#${id}` : cls ? `.${cls}` : "");
};
// Child paths number element siblings from 1: "article#doc > ul[3] > li[2]".
function childPath(path, parent, node) {
  if (node.type !== "element") return `${path} > ${label(node)}`;
  const index = elements(parent).indexOf(node) + 1;
  return `${path} > ${label(node)}${attr(node, "id") ? "" : `[${index}]`}`;
}

function unknownAttributes(node, allowed) {
  return node.attrs
    .filter(([name]) => !allowed.includes(name))
    .map(([name]) => `Attribute "${name}" on <${node.name}>`);
}
// Each class token must belong to one group; a group gives at most one token.
function classReasons(node, groups) {
  const reasons = [];
  const used = groups.map(() => 0);
  for (const token of classes(node)) {
    const g = groups.findIndex((group) => group.values.includes(token));
    if (g < 0) reasons.push(`Class "${token}" on <${node.name}>`);
    else if (++used[g] > 1)
      reasons.push(`More than one of ${groups[g].values.join(", ")}`);
  }
  groups.forEach((group, g) => {
    if (group.required && !used[g])
      reasons.push(`<${node.name}> needs class ${group.values.join(" or ")}`);
  });
  return reasons;
}

// ---------- safety: content never runs code, loads a resource or styles itself ----------
function registerId(ctx, node, path, id) {
  if (
    F.RESERVED_IDS.has(id) ||
    F.RESERVED_ID_PREFIXES.some((p) => id.startsWith(p))
  )
    ctx.error(
      "reserved-id",
      `ID "${id}" is reserved for the file`,
      node,
      path,
      "id",
    );
  else if (ctx.ids.has(id))
    ctx.error("duplicate-id", `Duplicate ID "${id}"`, node, path, "id");
  else ctx.ids.set(id, node);
}

function safety(node, parent, path, ctx, preview) {
  if (node.type !== "element") return;
  const name = node.name.toLowerCase();
  const chartData =
    name === "script" &&
    isElement(parent, "figure") &&
    classes(parent).includes("chart");
  if (
    F.FORBIDDEN_ELEMENTS.has(name) &&
    !chartData &&
    !(name === "title" && node.ns === "svg")
  )
    ctx.error(
      "forbidden-element",
      `<${node.name}> is not allowed in content`,
      node,
      path,
    );
  const inPreview =
    preview ||
    (node.ns === "svg" &&
      name === "svg" &&
      isElement(parent, "figure") &&
      classes(parent).includes("chart"));
  for (const [n, v] of node.attrs) {
    if (n.toLowerCase() === "style" && !inPreview) {
      ctx.error(
        "style-attribute",
        "style attributes are not allowed: use the classes of the format",
        node,
        path,
        n,
      );
      continue;
    }
    const problem = attributeProblem(n, v, node.ns === "html");
    if (problem) ctx.error("unsafe-attribute", problem, node, path, n);
    // IDs inside a saved chart preview are the renderer's (clip paths, gradients): see articleChecks.
    if (n === "id" && inPreview) ctx.previewIds.push({ id: v, node, path });
    else if (n === "id") registerId(ctx, node, path, v);
  }
  for (const child of node.children)
    safety(child, node, childPath(path, node, child), ctx, inPreview);
}

// ---------- inline content ----------
const INLINE = { footnote: false, br: true, marks: [] };

function inline(children, ctx, path, options = INLINE) {
  const reasons = [];
  for (const node of children) {
    if (node.type === "text") continue;
    if (node.type === "comment") {
      reasons.push("HTML comment inside text");
      continue;
    }
    const n = node.name,
      cls = classes(node),
      p = `${path} > ${label(node)}`;
    if (node.ns !== "html") reasons.push(`<${n}> inside text`);
    else if (n === "mark" && cls.length) {
      if (cls.join(" ") !== "comment")
        reasons.push(`Class "${cls.join(" ")}" on <mark>`);
      reasons.push(...unknownAttributes(node, ["class", "data-ref"]));
      const ref = attr(node, "data-ref");
      if (ref === null) reasons.push("Comment mark without data-ref");
      else ctx.refs.push({ ref, node, path: p });
      reasons.push(...inline(node.children, ctx, path, options));
    } else if (F.MARKS.includes(n)) {
      const other = { sub: "sup", sup: "sub" }[n];
      if (node.attrs.length) reasons.push(`Attributes on <${n}>`);
      else if (other && options.marks.includes(other))
        reasons.push("Superscript and subscript combined");
      reasons.push(
        ...inline(node.children, ctx, path, {
          ...options,
          marks: [...options.marks, n],
        }),
      );
    } else if (n === "a" && cls.includes("xref")) {
      const href = attr(node, "href") ?? "";
      if (cls.length > 1) reasons.push(`Class "${cls.join(" ")}" on <a>`);
      reasons.push(...unknownAttributes(node, ["class", "href"]));
      if (!href.startsWith("#") || !F.ID.test(href.slice(1)))
        reasons.push("A cross-reference links to #id");
      else ctx.xrefs.push({ target: href.slice(1), node, path: p });
      if (!onlyText(node)) reasons.push("Markup inside a cross-reference");
    } else if (n === "a") {
      const href = attr(node, "href");
      reasons.push(...unknownAttributes(node, ["href"]));
      if (href === null) reasons.push("Link without href");
      else if (href.startsWith("#"))
        reasons.push("An internal link is a cross-reference (class xref)");
      else if (!F.LINK_URL.test(href))
        reasons.push("Link URL outside https:, http: and mailto:");
      reasons.push(...inline(node.children, ctx, path, options));
    } else if (n === "span" && cls.join(" ") === "footnote") {
      reasons.push(...unknownAttributes(node, ["class"]));
      if (options.footnote) reasons.push("Footnote inside a footnote");
      reasons.push(
        ...inline(node.children, ctx, path, {
          footnote: true,
          br: false,
          marks: [],
        }),
      );
    } else if (n === "br") {
      if (node.attrs.length) reasons.push("Attributes on <br>");
      if (!options.br) reasons.push("Line break inside a footnote");
    } else reasons.push(`<${n}> inside text`);
  }
  return reasons;
}

// ---------- blocks ----------
function paragraph(node, ctx, path, lead) {
  return [
    ...unknownAttributes(node, ["class"]),
    ...classReasons(node, [
      ...(lead ? [{ values: ["lead"] }] : []),
      { values: F.ALIGN },
    ]),
    ...inline(node.children, ctx, path),
  ];
}

function list(node, ctx, path) {
  const reasons = unknownAttributes(node, []);
  const items = nonBlank(node);
  if (!items.length) reasons.push(`Empty <${node.name}>`);
  for (const li of items) {
    if (!isElement(li, "li")) {
      reasons.push(`${label(li)} inside <${node.name}>`);
      continue;
    }
    const p = childPath(path, node, li);
    reasons.push(...unknownAttributes(li, []));
    const kids = nonBlank(li);
    const last = kids.at(-1);
    const nested = isElement(last, "ul") || isElement(last, "ol");
    const end = nested ? li.children.lastIndexOf(last) : li.children.length;
    if (nested && li.children.slice(end + 1).some((n) => !isBlank(n)))
      reasons.push("Text after a nested list");
    reasons.push(...inline(li.children.slice(0, end), ctx, p));
    if (nested) reasons.push(...list(last, ctx, childPath(p, li, last)));
  }
  return reasons;
}

function cover(node, ctx, path, first) {
  const reasons = [
    ...unknownAttributes(node, ["class"]),
    ...(first ? [] : ["The cover must be the first block"]),
  ];
  const kids = nonBlank(node);
  kids.forEach((kid, i) => {
    const p = childPath(path, node, kid);
    if (i === 0) {
      if (!isElement(kid, "h1") || classes(kid).join(" ") !== "title")
        reasons.push("The cover starts with h1.title");
    } else if (i === 1 && classes(kid).join(" ") === "subtitle") {
      if (!isElement(kid, "p")) reasons.push("The subtitle is a paragraph");
    } else if (!isElement(kid, "p") || kid.attrs.length) {
      reasons.push(`${label(kid)} inside the cover`);
      return;
    }
    if (kid.type !== "element") return;
    reasons.push(...unknownAttributes(kid, i < 2 ? ["class"] : []));
    reasons.push(...inline(kid.children, ctx, p));
  });
  if (!kids.length) reasons.push("Empty cover");
  return reasons;
}

function heading(node, ctx, path) {
  const id = attr(node, "id");
  if (id === null)
    ctx.error("missing-id", `<${node.name}> needs a stable id`, node, path);
  else if (!F.ID.test(id))
    ctx.error("invalid-id", `Invalid ID "${id}"`, node, path, "id");
  else ctx.headings.add(id);
  if (classes(node).includes("title")) return ["h1.title belongs in the cover"];
  return [
    ...unknownAttributes(node, ["id", "class"]),
    ...classReasons(node, [
      { values: ["unnumbered"] },
      { values: ["new-page"] },
      { values: F.ALIGN.slice(0, 3) },
    ]),
    ...inline(node.children, ctx, path),
  ];
}

function tocList(node, ctx, path) {
  const reasons = unknownAttributes(node, []);
  const items = nonBlank(node);
  if (!items.length) reasons.push("Empty contents list");
  for (const li of items) {
    const kids = isElement(li, "li") ? nonBlank(li) : [];
    const [link, nested, ...rest] = kids;
    if (
      !isElement(link, "a") ||
      link.attrs.length !== 1 ||
      !onlyText(link) ||
      !/^#/.test(attr(link, "href") ?? "") ||
      li.attrs.length ||
      rest.length ||
      (nested && !isElement(nested, "ol"))
    ) {
      reasons.push("Contents entries are li > a[href=#id] (+ ol)");
      continue;
    }
    ctx.toc.push({
      target: attr(link, "href").slice(1),
      node: link,
      path: childPath(path, node, li),
    });
    if (nested) reasons.push(...tocList(nested, ctx, path));
  }
  return reasons;
}

function toc(node, ctx, path) {
  const reasons = unknownAttributes(node, ["class", "data-depth"]);
  if (!/^[1-4]$/.test(attr(node, "data-depth") ?? ""))
    reasons.push("nav.toc needs data-depth 1–4");
  const kids = nonBlank(node);
  if (kids.length > 1 || (kids.length && !isElement(kids[0], "ol")))
    reasons.push("nav.toc holds one generated <ol>");
  else if (kids.length) reasons.push(...tocList(kids[0], ctx, path));
  return reasons;
}

function block(node, ctx, path, first, last) {
  if (node.type === "text") return ["Text outside a block"];
  if (node.type === "comment") return ["HTML comment"];
  if (node.ns !== "html") return [`<${node.name}> outside a figure`];
  const cls = classes(node);
  const only = (name) => cls.join(" ") === name;
  switch (node.name) {
    case "p":
      return paragraph(node, ctx, path, true);
    case "h1":
    case "h2":
    case "h3":
    case "h4":
      return heading(node, ctx, path);
    case "ul":
    case "ol":
      return list(node, ctx, path);
    case "blockquote": {
      const kids = nonBlank(node);
      return [
        ...unknownAttributes(node, []),
        ...(kids.length ? [] : ["Empty quote"]),
        ...kids.flatMap((kid) =>
          isElement(kid, "p")
            ? paragraph(kid, ctx, childPath(path, node, kid), false)
            : [`${label(kid)} inside a quote`],
        ),
      ];
    }
    case "pre": {
      const [code] = node.children;
      return node.children.length === 1 &&
        isElement(code, "code") &&
        !code.attrs.length &&
        onlyText(code) &&
        !node.attrs.length
        ? []
        : ["Code blocks are <pre><code>text</code></pre>"];
    }
    case "hr":
      return only("page-break") && node.attrs.length === 1
        ? []
        : ['A rule is <hr class="page-break">'];
  }
  if (node.name === "header" && only("cover"))
    return cover(node, ctx, path, first);
  if (node.name === "nav" && only("toc")) return toc(node, ctx, path);
  if (node.name === "aside" && cls.includes("callout")) {
    const kids = nonBlank(node);
    return [
      ...unknownAttributes(node, ["class"]),
      ...classReasons(node, [
        { values: ["callout"], required: true },
        { values: F.CALLOUTS, required: true },
      ]),
      ...(kids.length ? [] : ["Empty callout"]),
      ...kids.flatMap((kid) => {
        const p = childPath(path, node, kid);
        if (isElement(kid, "p")) return paragraph(kid, ctx, p, false);
        if (isElement(kid, "ul") || isElement(kid, "ol"))
          return list(kid, ctx, p);
        return [`${label(kid)} inside a callout`];
      }),
    ];
  }
  if (node.name === "figure" && ["chart", "image", "table"].includes(cls[0])) {
    if (cls.length > 1)
      ctx.error(
        "malformed-figure",
        `Class "${cls.join(" ")}" on a figure`,
        node,
        path,
        "class",
      );
    ({ chart, image, table: tableFigure })[cls[0]](node, ctx, path);
    return [];
  }
  if (node.name === "section" && only("comments")) {
    comments(node, ctx, path, last);
    return [];
  }
  return [
    `<${node.name}${cls.length ? "." + cls.join(".") : ""}> is outside the Text subset`,
  ];
}

// ---------- figures: malformed figures are errors ----------
function figureAttributes(node, ctx, path, required, optional = []) {
  for (const [n] of node.attrs)
    if (![...required, ...optional].includes(n))
      ctx.error(
        "malformed-figure",
        `Attribute "${n}" on figure.${classes(node)[0]}`,
        node,
        path,
        n,
      );
  for (const n of required)
    if (attr(node, n) === null)
      ctx.error(
        "malformed-figure",
        `figure.${classes(node)[0]} needs ${n}`,
        node,
        path,
      );
  const id = attr(node, "id");
  if (id !== null) {
    if (!F.ID.test(id))
      ctx.error("invalid-id", `Invalid ID "${id}"`, node, path, "id");
    ctx.figures.add(id);
  }
}

function caption(node, ctx, path) {
  if (node.attrs.length)
    ctx.error("malformed-figure", "Attributes on <figcaption>", node, path);
  for (const reason of inline(node.children, ctx, path))
    ctx.error("malformed-figure", `Caption: ${reason}`, node, path);
}

function leftovers(kids, ctx, path, figure) {
  for (const kid of kids)
    ctx.error(
      "malformed-figure",
      `Unexpected ${label(kid)} in figure.${figure}`,
      kid,
      path,
    );
}

function preview(node, ctx, path) {
  if (node.type !== "element") return;
  if (node.ns !== "svg" || !F.PREVIEW_ELEMENTS.has(node.name))
    ctx.error(
      "malformed-figure",
      `<${node.name}> in a chart preview`,
      node,
      path,
    );
  for (const child of node.children) preview(child, ctx, path);
}

function chart(node, ctx, path) {
  figureAttributes(node, ctx, path, ["class", "id", "data-type", "data-width"]);
  const type = attr(node, "data-type");
  if (type !== null && !Object.hasOwn(registry, type))
    ctx.error(
      "malformed-figure",
      `Unknown chart type "${type}"`,
      node,
      path,
      "data-type",
    );
  const width = attr(node, "data-width");
  if (width !== null && !F.CHART_WIDTHS.includes(width))
    ctx.error(
      "malformed-figure",
      `Chart data-width is ${F.CHART_WIDTHS.join(" or ")}`,
      node,
      path,
      "data-width",
    );
  const kids = nonBlank(node);
  const data = kids.shift();
  if (
    !isElement(data, "script") ||
    data.attrs.length !== 1 ||
    attr(data, "type") !== "application/json"
  ) {
    ctx.error(
      "malformed-figure",
      'figure.chart starts with <script type="application/json">',
      node,
      path,
    );
    if (data) kids.unshift(data);
  } else if (Object.hasOwn(registry, type ?? "")) {
    let json;
    try {
      json = JSON.parse(textOf(data));
    } catch (e) {
      ctx.error("chart-data", `Chart JSON: ${e.message}`, data, path);
    }
    if (json !== undefined)
      for (const problem of strictValidate(type, json))
        ctx.error("chart-data", problem, data, path);
  }
  if (kids[0]?.type === "element" && kids[0].ns === "svg") {
    preview(kids[0], ctx, path);
    kids.shift();
  } else
    ctx.warn(
      "missing-preview",
      "Chart without a saved SVG preview: it shows only once ECharts loads",
      node,
      path,
    );
  if (isElement(kids[0], "figcaption")) caption(kids.shift(), ctx, path);
  leftovers(kids, ctx, path, "chart");
}

function image(node, ctx, path) {
  figureAttributes(
    node,
    ctx,
    path,
    ["class", "id", "data-width"],
    ["data-wrap"],
  );
  const wrap = attr(node, "data-wrap"),
    width = attr(node, "data-width");
  if (wrap !== null && !F.WRAPS.includes(wrap))
    ctx.error(
      "malformed-figure",
      `Image data-wrap is ${F.WRAPS.join(" or ")}`,
      node,
      path,
      "data-wrap",
    );
  const widths = wrap === null ? F.IMAGE_WIDTHS : F.WRAP_WIDTHS;
  if (width !== null && !widths.includes(width))
    ctx.error(
      "malformed-figure",
      `${wrap === null ? "A block" : "A wrapped"} image has data-width ${widths.join(", ")}`,
      node,
      path,
      "data-width",
    );
  const kids = nonBlank(node);
  const img = kids[0];
  if (!isElement(img, "img"))
    ctx.error("malformed-figure", "figure.image starts with <img>", node, path);
  else {
    kids.shift();
    const p = childPath(path, node, img);
    for (const [n] of img.attrs)
      if (!["data-asset", "alt"].includes(n))
        ctx.error("malformed-figure", `Attribute "${n}" on <img>`, img, p, n);
    const alt = attr(img, "alt"),
      asset = attr(img, "data-asset");
    if (!alt?.trim())
      ctx.error("missing-alt", "Images need a text alternative (alt)", img, p);
    if (asset === null)
      ctx.error("malformed-figure", "Images reference data-asset", img, p);
    else if (ctx.assets && !ctx.assets.has(asset))
      ctx.error(
        "unknown-asset",
        `No asset "${asset}" in script#assets`,
        img,
        p,
        "data-asset",
      );
  }
  if (isElement(kids[0], "figcaption")) caption(kids.shift(), ctx, path);
  leftovers(kids, ctx, path, "image");
}

const SPAN = /^[1-9][0-9]*$/;

function rows(section, ctx, path, head) {
  const grid = [];
  const body = nonBlank(section);
  if (!body.length)
    ctx.error("malformed-table", `Empty <${section.name}>`, section, path);
  body.forEach((tr, r) => {
    if (!isElement(tr, "tr")) {
      ctx.error(
        "malformed-table",
        `${label(tr)} in <${section.name}>`,
        tr,
        path,
      );
      return;
    }
    const p = childPath(path, section, tr);
    for (const [n] of tr.attrs)
      if (n !== "class" || head)
        ctx.error("malformed-table", `Attribute "${n}" on <tr>`, tr, p, n);
    if (
      !head &&
      attr(tr, "class") !== null &&
      classes(tr).join(" ") !== "total"
    )
      ctx.error("malformed-table", 'A row class is "total"', tr, p, "class");
    grid[r] ??= [];
    let col = 0;
    for (const cell of nonBlank(tr)) {
      const cp = childPath(p, tr, cell);
      if (!(isElement(cell, "td") && !head) && !isElement(cell, "th")) {
        ctx.error(
          "malformed-table",
          `${label(cell)} in a ${head ? "header" : "body"} row`,
          cell,
          cp,
        );
        continue;
      }
      for (const [n, v] of cell.attrs) {
        if (n === "colspan" || n === "rowspan") {
          const limit = n === "colspan" ? 1000 : 65534;
          if (!SPAN.test(v) || Number(v) > limit)
            ctx.error("malformed-table", `Invalid ${n} "${v}"`, cell, cp, n);
        } else if (n !== "class")
          ctx.error(
            "malformed-table",
            `Attribute "${n}" on <${cell.name}>`,
            cell,
            cp,
            n,
          );
      }
      const cls = classes(cell);
      if (cls.length > 1 || (cls.length && !F.CELL_ALIGN.includes(cls[0])))
        ctx.error(
          "malformed-table",
          `Cell class is one of ${F.CELL_ALIGN.join(", ")}`,
          cell,
          cp,
          "class",
        );
      for (const reason of inline(cell.children, ctx, cp))
        ctx.error("malformed-table", `Cell: ${reason}`, cell, cp);
      const span = (n) =>
        SPAN.test(attr(cell, n) ?? "") ? Number(attr(cell, n)) : 1;
      const colspan = span("colspan"),
        rowspan = span("rowspan");
      while (grid[r][col]) col++;
      for (let dr = 0; dr < rowspan; dr++) {
        if (r + dr >= body.length) {
          ctx.error(
            "malformed-table",
            "rowspan runs past its row group",
            cell,
            cp,
            "rowspan",
          );
          break;
        }
        grid[r + dr] ??= [];
        for (let dc = 0; dc < colspan; dc++) grid[r + dr][col + dc] = true;
      }
      col += colspan;
    }
  });
  return grid.map((row) =>
    row.length && row.every(Boolean) && row.length === Object.keys(row).length
      ? row.length
      : -1,
  );
}

function tableFigure(node, ctx, path) {
  figureAttributes(node, ctx, path, ["class", "id"]);
  const kids = nonBlank(node);
  if (isElement(kids[0], "figcaption")) caption(kids.shift(), ctx, path);
  const table = kids.shift();
  if (!isElement(table, "table")) {
    ctx.error("malformed-figure", "figure.table holds a <table>", node, path);
    if (table) kids.unshift(table);
    leftovers(kids, ctx, path, "table");
    return;
  }
  leftovers(kids, ctx, path, "table");
  const p = childPath(path, node, table);
  for (const [n] of table.attrs)
    if (n !== "class")
      ctx.error("malformed-table", `Attribute "${n}" on <table>`, table, p, n);
  if (attr(table, "class") !== null && classes(table).join(" ") !== "compact")
    ctx.error(
      "malformed-table",
      'The table class is "compact"',
      table,
      p,
      "class",
    );
  const parts = nonBlank(table);
  const colgroup = isElement(parts[0], "colgroup") ? parts.shift() : null;
  const thead = isElement(parts[0], "thead") ? parts.shift() : null;
  const tbody = isElement(parts[0], "tbody") ? parts.shift() : null;
  for (const part of parts)
    ctx.error(
      "malformed-table",
      `Unexpected ${label(part)} in <table>`,
      part,
      p,
    );
  if (!tbody) {
    ctx.error("malformed-table", "A table has one <tbody>", table, p);
    return;
  }
  const widths = [
    ...(thead ? rows(thead, ctx, childPath(p, table, thead), true) : []),
    ...rows(tbody, ctx, childPath(p, table, tbody), false),
  ];
  const width = widths[0];
  if (widths.some((w) => w !== width || w < 0))
    ctx.error(
      "malformed-table",
      "Rows do not form a rectangular grid",
      table,
      p,
    );
  if (colgroup) {
    const cp = childPath(p, table, colgroup);
    if (colgroup.attrs.length)
      ctx.error("malformed-table", "Attributes on <colgroup>", colgroup, cp);
    const cols = nonBlank(colgroup);
    for (const col of cols) {
      if (!isElement(col, "col")) {
        ctx.error("malformed-table", `${label(col)} in <colgroup>`, col, cp);
        continue;
      }
      for (const [n, v] of col.attrs)
        if (n === "data-width") {
          if (!/^([1-9][0-9]?|100)$/.test(v))
            ctx.error(
              "malformed-table",
              `Column data-width is a percentage 1–100, not "${v}"`,
              col,
              cp,
              n,
            );
        } else if (n !== "class" || v !== "emphasis")
          ctx.error(
            "malformed-table",
            `Attribute ${n}="${v}" on <col>`,
            col,
            cp,
            n,
          );
    }
    if (width > 0 && cols.length !== width)
      ctx.error(
        "malformed-table",
        `${cols.length} <col> for a grid of ${width} columns`,
        colgroup,
        cp,
      );
  }
}

// ---------- comment threads: malformed threads are errors ----------
function comments(node, ctx, path, last) {
  const fail = (message, n = node, p = path, a) =>
    ctx.error("malformed-thread", message, n, p, a);
  if (!last) fail("section.comments is the last block of article#doc");
  if (node.attrs.length !== 1) fail("section.comments has only its class");
  const threads = nonBlank(node);
  if (!threads.length) fail("Empty section.comments: remove it");
  for (const thread of threads) {
    const p = childPath(path, node, thread);
    if (
      !isElement(thread, "aside") ||
      classes(thread).join(" ") !== "comment-thread"
    ) {
      fail(`${label(thread)} in section.comments`, thread, p);
      continue;
    }
    const allowed = [
      "class",
      "id",
      "data-status",
      "data-quote",
      "data-section",
      "data-prefix",
      "data-suffix",
    ];
    for (const [n] of thread.attrs)
      if (!allowed.includes(n))
        fail(`Attribute "${n}" on a comment thread`, thread, p, n);
    const id = attr(thread, "id");
    if (id === null) fail("A comment thread needs an id", thread, p);
    else if (!F.ID.test(id))
      ctx.error("invalid-id", `Invalid ID "${id}"`, thread, p, "id");
    else ctx.threads.set(id, { node: thread, path: p });
    if (!F.THREAD_STATUS.includes(attr(thread, "data-status")))
      fail(
        `data-status is ${F.THREAD_STATUS.join(" or ")}`,
        thread,
        p,
        "data-status",
      );
    if (!attr(thread, "data-quote"))
      fail("A thread keeps its quoted text in data-quote", thread, p);
    const section = attr(thread, "data-section");
    if (section !== null) ctx.sections.push({ section, node: thread, path: p });
    const entries = nonBlank(thread);
    if (!entries.length)
      fail("A thread holds at least one p.comment", thread, p);
    for (const entry of entries) {
      const ep = childPath(p, thread, entry);
      if (!isElement(entry, "p") || classes(entry).join(" ") !== "comment") {
        fail(`${label(entry)} in a comment thread`, entry, ep);
        continue;
      }
      for (const [n] of entry.attrs)
        if (!["class", "data-author", "data-date"].includes(n))
          fail(`Attribute "${n}" on a comment`, entry, ep, n);
      if (!attr(entry, "data-author")?.trim())
        fail("A comment needs data-author", entry, ep);
      if (!F.COMMENT_DATE.test(attr(entry, "data-date") ?? ""))
        fail(
          "data-date is UTC ISO 8601, for example 2026-10-15T14:02Z",
          entry,
          ep,
          "data-date",
        );
      if (!onlyText(entry)) fail("Comment text is plain text", entry, ep);
    }
  }
}

// ---------- article#doc ----------
function articleAttributes(article, ctx, path) {
  for (const [n] of article.attrs)
    if (!F.ARTICLE_ATTRIBUTES.includes(n))
      ctx.error(
        "article-attribute",
        `Unknown attribute "${n}" on article#doc`,
        article,
        path,
        n,
      );
  const check = (name, valid, message, required = false) => {
    const value = attr(article, name);
    if (value === null ? required : !valid(value))
      ctx.error("article-attribute", message, article, path, name);
  };
  check(
    "data-format",
    (v) => v === F.FORMAT_VERSION,
    `data-format="${F.FORMAT_VERSION}" is required`,
    true,
  );
  check(
    "lang",
    (v) => F.LANG.test(v),
    "lang is a language tag such as en-GB",
    true,
  );
  check(
    "data-heading-numbers",
    (v) => v === "on",
    'data-heading-numbers is "on" or absent',
  );
  check(
    "data-heading-format",
    (v) => F.HEADING_FORMAT.test(v),
    "data-heading-format is four levels such as 1.A.i.a",
  );
  check(
    "data-theme",
    (v) => F.THEMES.includes(v),
    `data-theme is ${F.THEMES.join(", ")}`,
  );
  check(
    "data-font",
    (v) => F.FONTS.includes(v),
    `data-font is ${F.FONTS.join(", ")}`,
  );
  check(
    "data-page",
    (v) => F.PAGES.includes(v),
    `data-page is ${F.PAGES.join(" or ")}`,
  );
}

const result = (ctx, blocks) => ({
  ok: ctx.errors.length === 0,
  errors: ctx.errors,
  warnings: ctx.warnings,
  protected: ctx.protected,
  blocks,
});

function articleChecks(article, ctx) {
  const path = "article#doc";
  articleAttributes(article, ctx, path);
  for (const child of article.children)
    safety(child, article, childPath(path, article, child), ctx, false);
  const nodes = nonBlank(article);
  if (!nodes.length)
    ctx.error("empty-document", "article#doc has no content", article, path);
  const blocks = nodes.map((node, i) => {
    const p = childPath(path, article, node);
    const reasons = block(node, ctx, p, i === 0, i === nodes.length - 1);
    if (reasons.length)
      ctx.protected.push({
        path: p,
        reasons,
        ...(node.loc ? { line: node.loc.line, col: node.loc.col } : {}),
      });
    return { node, protected: reasons.length > 0 };
  });
  for (const { ref, node, path: p } of ctx.refs)
    if (!ctx.threads.has(ref))
      ctx.error(
        "unknown-thread",
        `Comment mark refers to no thread "${ref}"`,
        node,
        p,
        "data-ref",
      );
  const previews = new Set();
  for (const { id, node, path: p } of ctx.previewIds) {
    if (ctx.ids.has(id) || F.RESERVED_IDS.has(id))
      ctx.error(
        "duplicate-id",
        `Chart preview ID "${id}" is also a content ID`,
        node,
        p,
        "id",
      );
    else if (previews.has(id))
      ctx.warn(
        "preview-id",
        `Chart preview ID "${id}" repeats in another preview: refresh the previews`,
        node,
        p,
        "id",
      );
    previews.add(id);
  }
  const referenced = new Set(ctx.refs.map((r) => r.ref));
  for (const [id, thread] of ctx.threads)
    if (!referenced.has(id))
      ctx.warn(
        "orphaned-thread",
        `Thread "${id}" is not attached to any text`,
        thread.node,
        thread.path,
      );
  for (const { target, node, path: p } of ctx.xrefs)
    if (!ctx.headings.has(target) && !ctx.figures.has(target))
      ctx.warn(
        "missing-target",
        `Cross-reference to missing heading or figure "${target}"`,
        node,
        p,
        "href",
      );
  for (const { target, node, path: p } of ctx.toc)
    if (!ctx.headings.has(target))
      ctx.warn(
        "stale-contents",
        `Contents entry for missing heading "${target}"`,
        node,
        p,
        "href",
      );
  for (const { section, node, path: p } of ctx.sections)
    if (!ctx.headings.has(section))
      ctx.warn(
        "unknown-section",
        `Thread section "${section}" is not a heading ID`,
        node,
        p,
        "data-section",
      );
  return blocks;
}

// Validates article#doc alone (the browser runtime, before editing). `assets` is the set of asset keys, if known.
export function validateArticle(article, { assets = null } = {}) {
  const ctx = new Context(assets);
  return result(ctx, articleChecks(article, ctx));
}

const ZONE_META = /^(viewport|generator|html-text-[a-z-]+)$/;

// Validates a complete file (parse.mjs parseFile, or html.mjs fromDocument): its zones, then article#doc.
export function validateFile(file) {
  const ctx = new Context(null);
  const html = file.html;
  if (file.doctype !== "html")
    ctx.error(
      "doctype",
      "The file starts with <!doctype html>",
      html,
      "document",
    );
  for (const node of file.children)
    if (node !== html && !isBlank(node))
      ctx.error(
        "outside-html",
        `${label(node)} outside <html>`,
        node,
        "document",
      );
  const head = html && elements(html).find((n) => n.name === "head");
  const body = html && elements(html).find((n) => n.name === "body");
  if (!head || !body) {
    ctx.error("structure", "The file needs <head> and <body>", html, "html");
    return result(ctx, []);
  }
  for (const node of head.children) {
    if (isBlank(node)) continue;
    const p = childPath("head", head, node);
    const id = node.type === "element" ? attr(node, "id") : null;
    if (isElement(node, "meta")) {
      const name = attr(node, "name");
      const ok =
        (node.attrs.length === 1 &&
          attr(node, "charset")?.toLowerCase() === "utf-8") ||
        (node.attrs.length === 2 &&
          name !== null &&
          ZONE_META.test(name) &&
          attr(node, "content") !== null);
      if (!ok)
        ctx.error(
          "head",
          "Only charset, viewport, generator and html-text-* metadata",
          node,
          p,
        );
    } else if (
      isElement(node, "title") ||
      (isElement(node, "template") && id === "html-text-guide")
    ) {
      for (const [n, v] of node.attrs) {
        const problem = attributeProblem(n, v, true);
        if (problem) ctx.error("unsafe-attribute", problem, node, p, n);
      }
    } else if (
      isElement(node, "style") &&
      (id === "charte" || id === "theme") &&
      node.attrs.length === 1
    ) {
      const problem = styleProblem(textOf(node));
      if (problem)
        ctx.error("unsafe-style", `style#${id}: ${problem}`, node, p);
    } else ctx.error("head", `Unexpected ${label(node)} in <head>`, node, p);
  }
  let article = null,
    assets = new Set();
  for (const node of body.children) {
    if (isBlank(node)) continue;
    const p = childPath("body", body, node);
    const id = node.type === "element" ? attr(node, "id") : null;
    if (isElement(node, "article") && id === "doc" && !article) article = node;
    else if (
      isElement(node, "script") &&
      id === "assets" &&
      attr(node, "type") === "application/json" &&
      node.attrs.length === 2
    ) {
      let entries;
      try {
        entries = JSON.parse(textOf(node));
      } catch (e) {
        ctx.error("assets", `script#assets: ${e.message}`, node, p);
      }
      if (
        entries !== undefined &&
        (typeof entries !== "object" ||
          entries === null ||
          Array.isArray(entries))
      )
        ctx.error("assets", "script#assets holds one JSON object", node, p);
      else
        for (const [key, value] of Object.entries(entries ?? {})) {
          const problem = assetProblem(key, value);
          if (problem) ctx.error("assets", problem, node, p);
          else assets.add(key);
        }
    } else if (
      isElement(node, "script") &&
      (id === "engine" || id === "echarts") &&
      attr(node, "src") === null
    ) {
      // Written by the build tools, never by the LLM or the editor.
    } else ctx.error("body", `Unexpected ${label(node)} in <body>`, node, p);
  }
  if (!article) {
    ctx.error("structure", "The file needs one article#doc", body, "body");
    return result(ctx, []);
  }
  ctx.assets = assets;
  return result(ctx, articleChecks(article, ctx));
}
