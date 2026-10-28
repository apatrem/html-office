// Generated numbers and labels (T08), from one pass over the document: heading numbers, figure
// and table numbers, cross-reference labels and contents entries. Pure (no DOM): the editor's
// decorations and regeneration, check.mjs, and the print and Markdown views all read it.
import { schema } from "./schema/schema.mjs";
import { HEADING_FORMAT } from "../model/format.mjs";
import { attr, classes, elements } from "../model/html.mjs";

const N = schema.nodes;

// The brand theme's heading format when style#theme sets none (--heading-format).
export const DEFAULT_HEADING_FORMAT = "1.1.1.1";

// A heading format value ("1.A.i.a", quoted or not), or the default.
export function themeFormat(value) {
  const format = String(value ?? "")
    .trim()
    .replace(/^["']|["']$/g, "");
  return HEADING_FORMAT.test(format) ? format : DEFAULT_HEADING_FORMAT;
}

// The heading format of a file (a parse.mjs or html.mjs tree): the last --heading-format
// declaration in style#theme, comments left out, or the default. The editor and check both use
// it, so they always agree (FORMAT.md › Numbering).
export function fileFormat(file) {
  const head = elements(file.html).find((n) => n.name === "head");
  const theme = head
    ? elements(head).find(
        (n) => n.name === "style" && attr(n, "id") === "theme",
      )
    : null;
  const css = (theme?.children.map((c) => c.value).join("") ?? "").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const found = [...css.matchAll(/--heading-format\s*:\s*([^;}]*)/g)];
  return themeFormat(found.at(-1)?.[1]);
}

const ROMAN = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];
const roman = (n) => {
  let out = "";
  for (const [value, digits] of ROMAN)
    for (; n >= value; n -= value) out += digits;
  return out;
};
// A, B… Z, AA, AB… (bijective base 26).
const letters = (n) => {
  let out = "";
  for (; n > 0; n = Math.floor((n - 1) / 26))
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
};
// One counter in a level's format: 1 (decimal), A/a (letters), I/i (Roman numerals).
export function formatNumber(n, token) {
  if (token === "A") return letters(n);
  if (token === "a") return letters(n).toLowerCase();
  // Roman numerals stop at 3999; larger counters stay decimal.
  if (token === "I") return n < 4000 ? roman(n) : String(n);
  if (token === "i") return n < 4000 ? roman(n).toLowerCase() : String(n);
  return String(n);
}

// Label words by language (the article's lang); other languages use English.
const WORDS = {
  en: { figure: "Figure", table: "Table", section: "Section" },
  fr: { figure: "Figure", table: "Tableau", section: "Section" },
};
export const words = (lang) =>
  WORDS[String(lang).slice(0, 2).toLowerCase()] ?? WORDS.en;

// The readable text of a heading: its text and cross-reference labels, footnotes left out,
// spaces collapsed.
export function labelText(node) {
  let out = "";
  node.forEach((child) => {
    if (child.isText) out += child.text;
    else if (child.type === N.xref) out += child.attrs.label;
    else if (child.type === N.hard_break) out += " ";
  });
  return out.replace(/\s+/g, " ").trim();
}

// The heading and figure IDs inside a protected block: cross-references to them keep their label.
function treeTargets(tree, ids) {
  if (tree.type !== "element") return;
  const id = attr(tree, "id");
  if (
    id !== null &&
    (/^h[1-4]$/.test(tree.name) ||
      (tree.name === "figure" &&
        ["chart", "image", "table"].includes(classes(tree)[0])))
  )
    ids.add(id);
  for (const child of tree.children) treeTargets(child, ids);
}

// A heading's own text: its text, without cross-references or footnotes.
const ownText = (node) => {
  let out = "";
  node.forEach((child) => {
    if (child.isText) out += child.text;
    else if (child.type === N.hard_break) out += " ";
  });
  return out.replace(/\s+/g, " ").trim();
};

// Contents entries for a depth: headings up to that level, each nested under the closest
// preceding heading of a higher level.
function contents(headings, depth) {
  const root = [],
    open = [];
  for (const h of headings) {
    if (h.level > depth) continue;
    while (open.length && open.at(-1).level >= h.level) open.pop();
    const entry = {
      target: h.id,
      label: h.number ? `${h.number} ${h.text}`.trim() : h.text,
      children: [],
    };
    (open.at(-1)?.entry.children ?? root).push(entry);
    open.push({ level: h.level, entry });
  }
  return root;
}

// format: the brand theme's default heading format; the article's data-heading-format wins.
// Returns, with positions in `doc`:
// - headings: [{pos, id, level, number, text}], number null when unnumbered or numbers are off;
// - figures: [{pos, id, kind ("figure" | "table"), number, label}], number null without a caption;
// - xrefs: [{pos, target, label, missing}]: label is what the cross-reference must say, or null
//   to keep it (a target inside a protected block); missing when the target does not exist;
// - tocs: [{pos, entries}], the generated entries of each contents block;
// - labels: Map of target ID to label.
export function numbering(doc, { format = DEFAULT_HEADING_FORMAT } = {}) {
  const tokens = (doc.attrs.headingFormat ?? format).split(".");
  const on = doc.attrs.headingNumbers;
  const word = words(doc.attrs.lang);
  const headings = [],
    figures = [],
    tocs = [],
    labels = new Map(),
    kept = new Set();
  // counters[k] and numbered[k]: the count at level k and whether the current level-k ancestor
  // is numbered. Any heading restarts the deeper levels; only a numbered one advances its own.
  const counters = [0, 0, 0, 0, 0],
    numbered = [false, false, false, false, false];
  let figureCount = 0,
    tableCount = 0;
  doc.forEach((node, pos) => {
    if (node.type === N.heading) {
      const { level, id } = node.attrs;
      for (let k = level + 1; k <= 4; k++) {
        counters[k] = 0;
        numbered[k] = false;
      }
      numbered[level] = on && !node.attrs.unnumbered;
      let number = null;
      if (numbered[level]) {
        counters[level]++;
        const parts = [];
        for (let k = 1; k <= level; k++)
          if (numbered[k]) parts.push(formatNumber(counters[k], tokens[k - 1]));
        number = parts.join(".");
      }
      headings.push({ pos, id, level, number, node });
      if (number) labels.set(id, `${word.section} ${number}`);
    } else if ([N.chart, N.image_figure, N.table_figure].includes(node.type)) {
      const kind = node.type === N.table_figure ? "table" : "figure";
      const captioned = node.firstChild?.type === N.caption;
      const number = !captioned
        ? null
        : kind === "table"
          ? ++tableCount
          : ++figureCount;
      const label = number ? `${word[kind]} ${number}` : word[kind];
      figures.push({ pos, id: node.attrs.id, kind, number, label });
      labels.set(node.attrs.id, label);
    } else if (node.type === N.toc) tocs.push({ pos, depth: node.attrs.depth });
    else if (node.type === N.protected) treeTargets(node.attrs.node, kept);
  });
  // A heading's text names it in contents and, when it has no number, in cross-references. A
  // cross-reference inside it reads as its target's number label, or as an unnumbered target
  // heading's own text (never that heading's references): one level, so references between
  // headings, a heading's reference to itself included, always settle at once.
  const own = new Map(
    headings.filter((h) => !h.number).map((h) => [h.id, ownText(h.node)]),
  );
  for (const h of headings) {
    let text = "";
    h.node.forEach((child) => {
      if (child.isText) text += child.text;
      else if (child.type === N.hard_break) text += " ";
      else if (child.type === N.xref) {
        const { target, label } = child.attrs;
        text += labels.get(target) ?? own.get(target) ?? label;
      }
    });
    h.text = text.replace(/\s+/g, " ").trim();
    delete h.node;
  }
  for (const h of headings) if (!h.number) labels.set(h.id, h.text);
  const xrefs = [];
  doc.descendants((node, pos) => {
    if (node.type !== N.xref) return true;
    const { target } = node.attrs;
    const label = labels.get(target);
    xrefs.push({
      pos,
      target,
      label: label ?? null,
      missing: label === undefined && !kept.has(target),
    });
    return false;
  });
  return {
    headings,
    figures,
    xrefs,
    tocs: tocs.map(({ pos, depth }) => ({
      pos,
      entries: contents(headings, depth),
    })),
    labels,
  };
}

const sameEntries = (a, b) =>
  a.length === b.length &&
  a.every(
    (e, i) =>
      e.target === b[i].target &&
      e.label === b[i].label &&
      sameEntries(e.children, b[i].children),
  );

// Sets every cross-reference label and contents list that differs from the numbering on `tr`
// (positions do not move: labels and entries are attributes). The numbering does not depend on
// the labels it rewrites, so one pass settles them. Returns whether anything changed.
export function regenerate(tr, options) {
  const result = numbering(tr.doc, options);
  let changed = false;
  for (const { pos, label } of result.xrefs)
    if (label !== null && tr.doc.nodeAt(pos).attrs.label !== label) {
      tr.setNodeAttribute(pos, "label", label);
      changed = true;
    }
  for (const { pos, entries } of result.tocs)
    if (!sameEntries(tr.doc.nodeAt(pos).attrs.entries, entries)) {
      tr.setNodeAttribute(pos, "entries", entries);
      changed = true;
    }
  return changed;
}
