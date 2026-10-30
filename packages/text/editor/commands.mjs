// Editing commands of the subset (T06): block styles, lists, inline marks, links, alignment and
// page breaks, as ProseMirror commands. Each writes only schema content; a command that would
// lose content (a footnote in a code block, a heading inside a quote) is unavailable instead.
// Block commands keep the selection by textblock order: restyling never reorders textblocks.
import { Fragment } from "prosemirror-model";
import { TextSelection, NodeSelection } from "prosemirror-state";
import { liftTarget, findWrapping } from "prosemirror-transform";
import { schema } from "./schema/schema.mjs";
import { reserveIds, reservedIds } from "./schema/guard.mjs";
import { RESERVED_IDS, LINK_URL } from "../model/format.mjs";

const N = schema.nodes,
  M = schema.marks;
const LISTS = [N.bullet_list, N.ordered_list];
const FIGURES = [N.chart, N.image_figure, N.table_figure];
const WRAPPERS = [N.blockquote, N.callout];

// ---------- IDs ----------
function treeIds(tree, ids) {
  if (tree.type !== "element") return;
  for (const [name, value] of tree.attrs) if (name === "id") ids.add(value);
  for (const child of tree.children) treeIds(child, ids);
}
export { reserveIds };
// Every ID the article uses or may not use: nodes, protected blocks, chart previews, the file's
// other elements, reserved.
export function usedIds(doc) {
  const ids = new Set([...RESERVED_IDS, ...reservedIds()]);
  doc.descendants((node) => {
    if (typeof node.attrs.id === "string") ids.add(node.attrs.id);
    if (node.type === N.protected) treeIds(node.attrs.node, ids);
    if (node.type === N.chart && node.attrs.preview)
      treeIds(node.attrs.preview, ids);
  });
  return ids;
}
function treeTargets(tree, out) {
  if (tree.type !== "element") return;
  for (const [name, value] of tree.attrs)
    if (name === "href" && value.startsWith("#")) out.add(value.slice(1));
    else if (name === "data-section") out.add(value);
  for (const child of tree.children) treeTargets(child, out);
}
// IDs that other content points to: cross-references, comment threads' sections (protected blocks
// included). A heading they name keeps its ID: it cannot become text. Contents entries do not
// count: they are regenerated, so a heading that leaves simply loses its entry.
export function referencedIds(doc) {
  const out = new Set();
  doc.descendants((node) => {
    if (node.type === N.xref) out.add(node.attrs.target);
    else if (node.type === N.comment_thread && node.attrs.section)
      out.add(node.attrs.section);
    else if (node.type === N.protected) treeTargets(node.attrs.node, out);
  });
  return out;
}
const keepsId = (doc, node) =>
  node.type === N.heading && referencedIds(doc).has(node.attrs.id);

// A new heading's ID, from its text when it is created; later edits never change it.
export function headingId(text, taken) {
  const slug = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
  const base = `sec-${slug || "section"}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

// ---------- textblocks and the selection ----------
function allTextblocks(doc) {
  const out = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    out.push({ node, pos });
    return false;
  });
  return out;
}
const blockAt = (doc, i) => allTextblocks(doc)[i];
// The selection as [textblock index, offset in it], for text selections.
function bookmark(state) {
  const blocks = allTextblocks(state.doc);
  const at = (p) => {
    const i = blocks.findIndex(
      ({ node, pos }) => p > pos && p < pos + node.nodeSize,
    );
    return i < 0 ? null : [i, p - blocks[i].pos - 1];
  };
  const { anchor, head } = state.selection;
  const a = at(anchor),
    h = at(head);
  if (!(state.selection instanceof TextSelection) || !a || !h) return null;
  return { a, h, lo: Math.min(a[0], h[0]), hi: Math.max(a[0], h[0]) };
}
// before: the document the bookmark was taken in. Code that became text lost one position per
// "\r\n" (one line break), so offsets after them move back.
function restore(tr, mark, before) {
  const blocks = allTextblocks(tr.doc);
  const old = before && allTextblocks(before);
  const pos = ([i, offset]) => {
    const was = old?.[i].node;
    if (was?.type === N.code_block && blocks[i].node.type !== N.code_block)
      offset -= (was.textContent.slice(0, offset).match(/\r(?=\n)/g) ?? [])
        .length;
    return blocks[i].pos + 1 + Math.min(offset, blocks[i].node.content.size);
  };
  tr.setSelection(TextSelection.create(tr.doc, pos(mark.a), pos(mark.h)));
}
// The textblock around a position, and its container.
function around(doc, pos) {
  const $pos = doc.resolve(pos + 1);
  return { $pos, parent: $pos.node($pos.depth - 1) };
}
const textOf = (node) => node.textContent;

// ---------- block styles ----------
export const STYLES = [
  ["body", "Body"],
  ["lead", "Lead"],
  ["title", "Title"],
  ["subtitle", "Subtitle"],
  ["h1", "Heading 1"],
  ["h2", "Heading 2"],
  ["h3", "Heading 3"],
  ["h4", "Heading 4"],
  ["quote", "Quote"],
  ["note", "Note"],
  ["warning", "Warning"],
  ["key", "Key message"],
  ["code", "Code"],
  ["caption", "Caption"],
];

// The style of the textblock holding the cursor: one of STYLES, "list", "cover" (a cover line),
// "cell", or null outside text (a selected figure).
export function styleAt(state) {
  const $from = state.selection.$from;
  let d = $from.depth;
  while (d > 0 && !$from.node(d).isTextblock) d--;
  const node = $from.node(d);
  if (!node.isTextblock) return null;
  const up = d > 0 ? $from.node(d - 1) : null;
  switch (node.type) {
    case N.heading:
      return `h${node.attrs.level}`;
    case N.title:
    case N.subtitle:
    case N.caption:
      return node.type.name;
    case N.code_block:
      return "code";
    case N.list_text:
      return "list";
    case N.paragraph:
      if (up.type === N.blockquote) return "quote";
      if (up.type === N.callout) return up.attrs.kind;
      if (up.type === N.cover) return "cover";
      return node.attrs.lead ? "lead" : "body";
  }
  return "cell";
}

// Inline content as code text, or null when code cannot hold it (footnotes, cross-references,
// comment anchors would be lost). Line breaks become "\n".
function asCode(node) {
  let text = "",
    ok = true;
  node.forEach((child) => {
    if (M.comment.isInSet(child.marks)) ok = false;
    else if (child.isText) text += child.text;
    else if (child.type === N.hard_break) text += "\n";
    else ok = false;
  });
  return ok ? (text ? Fragment.from(schema.text(text)) : Fragment.empty) : null;
}
// Code text as inline content: a line ending (\n, \r, \r\n) becomes a line break and a tab a space,
// as inline text would read them.
function fromCode(node) {
  const parts = [];
  node.textContent
    .replace(/\t/g, " ")
    .split(/\r\n?|\n/)
    .forEach((line, i) => {
      if (i) parts.push(N.hard_break.create());
      if (line) parts.push(schema.text(line));
    });
  return Fragment.from(parts);
}
// Changes one textblock's type and attributes in place (same size, so positions inside stay).
function retype(tr, pos, type, attrs) {
  const node = tr.doc.nodeAt(pos);
  if (node.type === type && type !== N.heading) {
    for (const [k, v] of Object.entries(attrs))
      if (node.attrs[k] !== v) tr.setNodeAttribute(pos, k, v);
    return true;
  }
  if (type !== N.heading && keepsId(tr.doc, node)) return false;
  if (type === N.heading && node.type === N.heading) {
    if (node.attrs.level !== attrs.level)
      tr.setNodeAttribute(pos, "level", attrs.level);
    return true;
  }
  const content =
    type === N.code_block
      ? node.type === N.code_block
        ? node.content
        : asCode(node)
      : node.type === N.code_block
        ? fromCode(node)
        : node.content;
  if (!content || !type.validContent(content)) return false;
  const align =
    "align" in (type.spec.attrs ?? {}) && node.attrs.align !== "ta-j"
      ? (node.attrs.align ?? null)
      : type === N.paragraph
        ? (node.attrs.align ?? null)
        : undefined;
  const next = type.create(
    { ...(align !== undefined ? { align } : {}), ...attrs },
    content,
  );
  tr.replaceWith(pos, pos + node.nodeSize, next);
  return true;
}

// Lifts textblock i out of quotes and callouts, splitting them around it.
function liftOut(tr, i, types = WRAPPERS) {
  for (;;) {
    const { pos } = blockAt(tr.doc, i);
    const { $pos, parent } = around(tr.doc, pos);
    if (!types.includes(parent.type)) return true;
    const range = $pos.blockRange();
    const target = range && liftTarget(range);
    if (target == null) return false;
    tr.lift(range, target);
  }
}

// ---------- lists, flattened: one entry per item, with its depth and list ----------
function outerList(doc, pos) {
  const $pos = doc.resolve(pos + 1);
  for (let d = 1; d <= $pos.depth; d++)
    if (LISTS.includes($pos.node(d).type))
      return { node: $pos.node(d), pos: $pos.before(d) };
  return null;
}
function flatten(list, depth = 0, out = [], ids = { n: 0 }) {
  const id = ids.n++;
  list.forEach((item) => {
    out.push({ text: item.firstChild, depth, kind: list.type, list: id });
    if (item.childCount > 1) flatten(item.child(1), depth + 1, out, ids);
  });
  return out;
}
// Lists from entries; a nested list takes the kind of its first item (an item holds one nested
// list).
function build(entries) {
  // An entry's level is the number of open items above it, so siblings stay siblings when the
  // items before them have gone (into paragraphs, or a level up).
  const open = [];
  entries = entries.map((e) => {
    while (open.length && open.at(-1) >= e.depth) open.pop();
    const depth = open.length;
    open.push(e.depth);
    return { ...e, depth };
  });
  let i = 0;
  const level = (depth) => {
    const kind = entries[i].kind,
      items = [];
    while (
      i < entries.length &&
      entries[i].depth === depth &&
      (depth > 0 || entries[i].kind === kind)
    ) {
      const e = entries[i++];
      const nested =
        i < entries.length && entries[i].depth > depth
          ? [level(depth + 1)]
          : [];
      items.push(N.list_item.create(null, [e.text, ...nested]));
    }
    return kind.create(null, items);
  };
  const lists = [];
  while (i < entries.length) lists.push(level(0));
  return lists;
}
// Entries marked `para` become paragraphs between the lists rebuilt from the others.
function rebuild(entries) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length) out.push(...build(run));
    run = [];
  };
  for (const e of entries)
    if (e.para) {
      flush();
      out.push(N.paragraph.create(null, e.text.content));
    } else run.push(e);
  flush();
  return out;
}
// The outermost lists holding textblocks lo..hi, last first, each with its entries and which of
// them are selected (by textblock index).
function listsIn(doc, lo, hi) {
  const blocks = allTextblocks(doc);
  const found = new Map();
  for (let i = lo; i <= hi; i++) {
    if (blocks[i].node.type !== N.list_text) continue;
    const list = outerList(doc, blocks[i].pos);
    if (!found.has(list.pos)) {
      const first = blocks.findIndex((b) => b.pos > list.pos);
      found.set(list.pos, {
        ...list,
        first,
        entries: flatten(list.node),
        selected: new Set(),
      });
    }
    const l = found.get(list.pos);
    l.selected.add(i - l.first);
  }
  return [...found.values()].sort((a, b) => b.pos - a.pos);
}
function replaceList(tr, list, entries) {
  tr.replaceWith(list.pos, list.pos + list.node.nodeSize, rebuild(entries));
}
// Selected entries with the items nested under them (they move together).
function withChildren(entries, selected) {
  const out = new Set();
  // The shallowest selected item stays the ancestor until its subtree ends.
  let under = -1;
  entries.forEach((e, i) => {
    if (under >= 0 && e.depth > under) out.add(i);
    else {
      under = -1;
      if (selected.has(i)) {
        out.add(i);
        under = e.depth;
      }
    }
  });
  return out;
}
function unlist(tr, lo, hi) {
  for (const list of listsIn(tr.doc, lo, hi))
    replaceList(
      tr,
      list,
      list.entries.map((e, i) =>
        list.selected.has(i) ? { ...e, para: true } : e,
      ),
    );
}
// Shifts selected items (and their children) by delta levels; below the top they become paragraphs.
function shift(tr, lo, hi, delta) {
  const lists = listsIn(tr.doc, lo, hi);
  if (!lists.length) return false;
  for (const list of lists) {
    const moved = withChildren(list.entries, list.selected);
    const first = Math.min(...list.selected);
    if (delta > 0) {
      const before = list.entries[first - 1];
      if (!before || before.depth < list.entries[first].depth) return false;
    }
    const next = list.entries.map((e, i) =>
      !moved.has(i)
        ? e
        : e.depth + delta < 0
          ? { ...e, para: list.selected.has(i) }
          : { ...e, depth: e.depth + delta },
    );
    // A moved item takes the kind of the level it joins, if that level has items before it.
    next.forEach((e, i) => {
      if (!moved.has(i) || e.para || !list.selected.has(i)) return;
      for (let j = i - 1; j >= 0 && next[j].depth >= e.depth; j--)
        if (next[j].depth === e.depth && !next[j].para) {
          next[i] = { ...e, kind: next[j].kind };
          return;
        }
    });
    replaceList(tr, list, next);
  }
  return true;
}

const blockCommand = (apply) => (state, dispatch) => {
  const mark = bookmark(state);
  if (!mark) return false;
  const tr = state.tr;
  if (apply(tr, mark.lo, mark.hi) === false || !tr.docChanged) return false;
  if (dispatch) {
    restore(tr, mark, state.doc);
    dispatch(tr.scrollIntoView());
  }
  return true;
};
const allBlocks = (doc, lo, hi) => allTextblocks(doc).slice(lo, hi + 1);

// Bulleted or numbered list: paragraphs become items; items of the other kind change kind (with
// their sibling items); a list of this kind is turned back into paragraphs.
export const toggleList = (kind) =>
  blockCommand((tr, lo, hi) => {
    const blocks = allBlocks(tr.doc, lo, hi);
    const inList = (b) => b.node.type === N.list_text;
    if (blocks.every((b) => inList(b) && outerKind(tr.doc, b.pos) === kind))
      return unlist(tr, lo, hi);
    for (const b of blocks)
      if (
        !inList(b) &&
        (b.node.type !== N.paragraph ||
          around(tr.doc, b.pos).parent.type === N.cover)
      )
        return false;
    // Lists first (last to first), then runs of sibling paragraphs.
    for (const list of listsIn(tr.doc, lo, hi)) {
      const lists = new Set(
        [...list.selected].map((i) => list.entries[i].list),
      );
      replaceList(
        tr,
        list,
        list.entries.map((e) => (lists.has(e.list) ? { ...e, kind } : e)),
      );
    }
    for (let i = hi; i >= lo; i--) {
      if (!liftOut(tr, i, [N.blockquote])) return false;
      const { node, pos } = blockAt(tr.doc, i);
      if (node.type !== N.paragraph) continue;
      tr.replaceWith(
        pos,
        pos + node.nodeSize,
        kind.create(
          null,
          N.list_item.create(null, N.list_text.create(null, node.content)),
        ),
      );
    }
    joinLists(tr);
  });
function outerKind(doc, pos) {
  const $pos = doc.resolve(pos + 1);
  return $pos.node($pos.depth - 2).type;
}
// Adjacent lists of one kind become one list.
function joinLists(tr) {
  for (let again = true; again; ) {
    again = false;
    tr.doc.descendants((node, pos) => {
      if (again || !node.isBlock) return false;
      if (LISTS.includes(node.type)) {
        const next = tr.doc.nodeAt(pos + node.nodeSize);
        if (next?.type === node.type) {
          tr.join(pos + node.nodeSize);
          again = true;
        }
        return false;
      }
      return true;
    });
  }
}
export const indent = blockCommand((tr, lo, hi) => shift(tr, lo, hi, 1));
export const outdent = blockCommand((tr, lo, hi) => shift(tr, lo, hi, -1));

// Enter in a list item: an empty item moves up a level (out of the list at the top); otherwise
// the item splits, and the items nested under it follow the new one.
export function splitListItem(state, dispatch) {
  const { $from, $to, empty } = state.selection;
  // A selection within list items is deleted first, in the same transaction.
  if (!empty) {
    if ($from.parent.type !== N.list_text || $to.parent.type !== N.list_text)
      return false;
    const deleted = state.tr.deleteSelection();
    const mid = state.apply(deleted);
    if (!mid.selection.empty || mid.selection.$from.parent.type !== N.list_text)
      return false;
    return splitListItem(
      mid,
      dispatch &&
        ((tr) => {
          for (const step of tr.steps) deleted.step(step);
          const { anchor, head } = tr.selection;
          dispatch(
            deleted
              .setSelection(TextSelection.create(deleted.doc, anchor, head))
              .scrollIntoView(),
          );
        }),
    );
  }
  if ($from.parent.type !== N.list_text) return false;
  if ($from.parent.content.size === 0) return outdent(state, dispatch);
  const mark = bookmark(state);
  const list = listsIn(state.doc, mark.lo, mark.lo)[0];
  const i = [...list.selected][0];
  const e = list.entries[i];
  const offset = $from.parentOffset;
  const parts = [
    { ...e, text: e.text.cut(0, offset) },
    { ...e, text: e.text.cut(offset) },
  ];
  const tr = state.tr;
  replaceList(tr, list, [
    ...list.entries.slice(0, i),
    ...parts,
    ...list.entries.slice(i + 1),
  ]);
  if (dispatch) {
    restore(tr, { a: [mark.lo + 1, 0], h: [mark.lo + 1, 0] });
    dispatch(tr.scrollIntoView());
  }
  return true;
}
// Enter in a title followed by a subtitle (nothing may come between them): at the end it moves
// into the subtitle; elsewhere it does nothing.
export function titleEnter(state, dispatch) {
  const { $from, empty } = state.selection;
  // A selection goes to the usual delete-and-split path.
  if (!empty || $from.parent.type !== N.title) return false;
  const next = $from.node(-1).maybeChild($from.indexAfter(-1));
  if (next?.type !== N.subtitle) return false;
  if (dispatch && $from.parentOffset === $from.parent.content.size)
    dispatch(
      state.tr.setSelection(TextSelection.create(state.doc, $from.after() + 1)),
    );
  return true;
}
// Backspace at the start of a list item moves it up a level.
export function liftListItem(state, dispatch) {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type !== N.list_text || $from.parentOffset > 0)
    return false;
  return outdent(state, dispatch);
}
export const inList = (state) =>
  state.selection.$from.parent.type === N.list_text;
export const listKind = (state) =>
  inList(state) ? outerKind(state.doc, state.selection.$from.before()) : null;

// ---------- block style commands ----------
const PLAIN = {
  body: [N.paragraph, { lead: false }],
  lead: [N.paragraph, { lead: true }],
  h1: [N.heading, { level: 1 }],
  h2: [N.heading, { level: 2 }],
  h3: [N.heading, { level: 3 }],
  h4: [N.heading, { level: 4 }],
  code: [N.code_block, {}],
};

// The cover's blocks become ordinary paragraphs: the title, once restyled, no longer heads one.
function dissolveCover(tr) {
  const cover = tr.doc.firstChild;
  const blocks = [];
  cover.forEach((node) => blocks.push(N.paragraph.create(null, node.content)));
  tr.replaceWith(0, cover.nodeSize, blocks);
}

function plainStyle(tr, lo, hi, style) {
  const [type, attrs] = PLAIN[style];
  const start = allBlocks(tr.doc, lo, hi);
  // Cover blocks: restyling the title dissolves the cover; Body turns a subtitle into a cover
  // line; other styles stay out of the cover. Blocks after the cover are restyled as usual.
  let skip = new Set();
  if (start.some((b) => b.node.type === N.title)) dissolveCover(tr);
  else {
    skip = new Set(
      start
        .map((b, k) =>
          around(tr.doc, b.pos).parent.type === N.cover ? lo + k : -1,
        )
        .filter((i) => i >= 0),
    );
    if (skip.size && style !== "body") return false;
    for (const b of start)
      if (b.node.type === N.subtitle) tr.setNodeMarkup(b.pos, N.paragraph);
  }
  const rest = [];
  for (let i = lo; i <= hi; i++) if (!skip.has(i)) rest.push(i);
  if (
    rest.some((i) =>
      [N.caption, N.table_cell, N.table_header].includes(
        blockAt(tr.doc, i).node.type,
      ),
    )
  )
    return false;
  unlist(tr, lo, hi);
  for (const i of rest) if (!liftOut(tr, i)) return false;
  const taken = usedIds(tr.doc);
  for (const i of rest) {
    const { node, pos } = blockAt(tr.doc, i);
    const extra =
      type === N.heading && node.type !== N.heading
        ? { id: headingId(textOf(node), taken) }
        : {};
    if (!retype(tr, pos, type, { ...attrs, ...extra })) return false;
  }
}

// Quotes hold paragraphs; callouts hold paragraphs and lists. The selected blocks become body
// paragraphs (lists stay in a callout) and are wrapped, or a callout around them changes kind.
function wrapStyle(tr, lo, hi, style) {
  const quote = style === "quote";
  const blocks = allBlocks(tr.doc, lo, hi);
  if (
    blocks.some(
      (b) =>
        ![N.paragraph, N.heading, N.list_text].includes(b.node.type) ||
        around(tr.doc, b.pos).parent.type === N.cover,
    )
  )
    return false;
  const callouts = blocks.map((b) => wrapperOf(tr.doc, b.pos, N.callout));
  if (!quote && callouts.every((pos) => pos !== null)) {
    for (const pos of new Set(callouts))
      if (tr.doc.nodeAt(pos).attrs.kind !== style)
        tr.setNodeAttribute(pos, "kind", style);
    return;
  }
  if (
    quote &&
    blocks.every((b) => wrapperOf(tr.doc, b.pos, N.blockquote) !== null)
  )
    return false;
  if (quote) unlist(tr, lo, hi);
  for (let i = lo; i <= hi; i++) if (!liftOut(tr, i)) return false;
  for (let i = lo; i <= hi; i++) {
    const { node, pos } = blockAt(tr.doc, i);
    if (node.type === N.heading) {
      if (!retype(tr, pos, N.paragraph, { lead: false })) return false;
    } else if (node.type === N.paragraph && node.attrs.lead)
      tr.setNodeAttribute(pos, "lead", false);
  }
  const first = blockAt(tr.doc, lo).pos,
    last = blockAt(tr.doc, hi).pos;
  const range = tr.doc
    .resolve(first + 1)
    .blockRange(tr.doc.resolve(last + 1), (n) => n.type === N.doc);
  const wrapping =
    range &&
    findWrapping(
      range,
      quote ? N.blockquote : N.callout,
      quote ? null : { kind: style },
    );
  if (!wrapping) return false;
  tr.wrap(range, wrapping);
}
function wrapperOf(doc, pos, type) {
  const $pos = doc.resolve(pos + 1);
  for (let d = $pos.depth - 1; d > 0; d--)
    if ($pos.node(d).type === type) return $pos.before(d);
  return null;
}

// Title: the first block of a document without a cover becomes its title.
function titleStyle(tr, lo, hi) {
  const { node, pos } = blockAt(tr.doc, lo);
  if (
    lo !== hi ||
    pos !== 0 ||
    ![N.paragraph, N.heading].includes(node.type) ||
    keepsId(tr.doc, node)
  )
    return false;
  tr.replaceWith(
    0,
    node.nodeSize,
    N.cover.create(null, N.title.create(null, node.content)),
  );
}
// Subtitle: the cover line after the title, or the block after a cover holding only its title.
function subtitleStyle(tr, lo, hi) {
  const { node, pos } = blockAt(tr.doc, lo);
  if (lo !== hi || node.type === N.subtitle) return false;
  const cover = tr.doc.firstChild.type === N.cover ? tr.doc.firstChild : null;
  if (!cover || (cover.child(0).nodeSize + 1 !== pos && pos !== cover.nodeSize))
    return false;
  if (pos === cover.nodeSize) {
    if (
      cover.childCount !== 1 ||
      ![N.paragraph, N.heading].includes(node.type) ||
      keepsId(tr.doc, node)
    )
      return false;
    tr.delete(pos, pos + node.nodeSize);
    tr.insert(cover.nodeSize - 1, N.subtitle.create(null, node.content));
  } else tr.setNodeMarkup(pos, N.subtitle);
}
// Caption: a selected figure without one gets an empty caption; a paragraph right after a figure
// without one becomes it. A caption restyled leaves its figure, as the block after it.
function captionIn(state, dispatch) {
  const sel = state.selection;
  if (sel instanceof NodeSelection && FIGURES.includes(sel.node.type)) {
    const figure = sel.node;
    if (hasCaption(figure)) return false;
    const at = figure.type === N.table_figure ? sel.from + 1 : sel.to - 1;
    if (dispatch) {
      const tr = state.tr.insert(at, N.caption.create());
      dispatch(
        tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView(),
      );
    }
    return true;
  }
  const { $from, empty } = sel;
  if (!empty && $from.parent !== sel.$to.parent) return false;
  if ($from.parent.type !== N.paragraph || $from.depth !== 1) return false;
  const index = $from.index(0);
  const figure = index > 0 ? state.doc.child(index - 1) : null;
  if (!figure || !FIGURES.includes(figure.type) || hasCaption(figure))
    return false;
  if (dispatch) {
    const block = $from.parent,
      start = $from.before(1),
      figureStart = start - figure.nodeSize,
      offset = $from.parentOffset;
    const tr = state.tr.delete(start, start + block.nodeSize);
    const at = figure.type === N.table_figure ? figureStart + 1 : start - 1;
    tr.insert(at, N.caption.create(null, block.content));
    dispatch(
      tr
        .setSelection(TextSelection.create(tr.doc, at + 1 + offset))
        .scrollIntoView(),
    );
  }
  return true;
}
const hasCaption = (figure) =>
  figure.firstChild?.type === N.caption || figure.lastChild?.type === N.caption;
function captionOut(state, dispatch, style) {
  const { $from } = state.selection;
  if ($from.parent.type !== N.caption || !(style in PLAIN)) return false;
  const [type, attrs] = PLAIN[style];
  const caption = $from.parent;
  const figureDepth = $from.depth - 1;
  const after = $from.after(figureDepth);
  let block;
  if (type === N.code_block) {
    const code = asCode(caption);
    if (!code) return false;
    block = type.create(attrs, code);
  } else
    block = type.create(
      type === N.heading
        ? { ...attrs, id: headingId(textOf(caption), usedIds(state.doc)) }
        : attrs,
      caption.content,
    );
  if (dispatch) {
    const offset = $from.parentOffset;
    const start = $from.before();
    const tr = state.tr
      .insert(after, block)
      .delete(start, start + caption.nodeSize);
    const at = tr.mapping.map(after) - block.nodeSize;
    dispatch(
      tr
        .setSelection(TextSelection.create(tr.doc, at + 1 + offset))
        .scrollIntoView(),
    );
  }
  return true;
}

export const setStyle = (style) => (state, dispatch) => {
  if (style === "caption") return captionIn(state, dispatch);
  if (styleAt(state) === "caption") return captionOut(state, dispatch, style);
  return blockCommand((tr, lo, hi) =>
    style === "title"
      ? titleStyle(tr, lo, hi)
      : style === "subtitle"
        ? subtitleStyle(tr, lo, hi)
        : style in PLAIN
          ? plainStyle(tr, lo, hi, style)
          : wrapStyle(tr, lo, hi, style),
  )(state, dispatch);
};

// ---------- alignment, page breaks ----------
// value: null (left, the default), "ta-c", "ta-r" or "ta-j" (paragraphs only).
export const setAlign = (value) => (state, dispatch) => {
  const tr = state.tr;
  let any = false;
  // By range: a cell selection (T10) covers its cells, not the rows between them.
  for (const { $from, $to } of state.selection.ranges)
    state.doc.nodesBetween($from.pos, $to.pos, (node, pos, parent) => {
      if (!node.isTextblock) return true;
      if (!("align" in node.attrs) || parent.type === N.cover) return false;
      if (value === "ta-j" && node.type !== N.paragraph) return false;
      any = true;
      if (node.attrs.align !== value) tr.setNodeAttribute(pos, "align", value);
      return false;
    });
  if (!any) return false;
  if (dispatch && tr.docChanged) dispatch(tr);
  return true;
};
export const alignAt = (state) => {
  const node = state.selection.$from.parent;
  return "align" in node.attrs ? node.attrs.align : undefined;
};

// A page break after the top-level block holding the selection (before the comments section).
export function insertPageBreak(state, dispatch) {
  const { $from, to } = state.selection;
  let at = $from.depth ? $from.after(1) : to;
  if (
    state.doc.nodeAt(at === state.doc.content.size ? at - 1 : at)?.type ===
      N.comments ||
    (at === state.doc.content.size && state.doc.lastChild.type === N.comments)
  )
    at = state.doc.content.size - state.doc.lastChild.nodeSize;
  if (dispatch)
    dispatch(state.tr.insert(at, N.page_break.create()).scrollIntoView());
  return true;
}
// "Start on a new page", for the selected headings.
export function toggleNewPage(state, dispatch) {
  const headings = [];
  state.doc.nodesBetween(
    state.selection.from,
    state.selection.to,
    (node, pos) => {
      if (node.type === N.heading) headings.push({ node, pos });
      return !node.isTextblock;
    },
  );
  if (!headings.length) return false;
  const on = !headings.every((h) => h.node.attrs.newPage);
  if (dispatch) {
    const tr = state.tr;
    for (const h of headings) tr.setNodeAttribute(h.pos, "newPage", on);
    dispatch(tr);
  }
  return true;
}
export const newPageAt = (state) => {
  const node = state.selection.$from.parent;
  return node.type === N.heading ? node.attrs.newPage : null;
};

// ---------- marks and links ----------
export function markActive(state, type) {
  const { from, to, empty, $from } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  let all = true,
    any = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return true;
    any = true;
    if (!type.isInSet(node.marks)) all = false;
  });
  return any && all;
}
// The extent of a mark around a position in its textblock.
function markRange($pos, type) {
  const parent = $pos.parent;
  let start = $pos.index(),
    end = $pos.indexAfter();
  const has = (i) =>
    i >= 0 && i < parent.childCount && type.isInSet(parent.child(i).marks);
  if (!has(start)) {
    if (!has(start - 1)) return null;
    start--;
    end = start + 1;
  }
  const mark = type.isInSet(parent.child(start).marks);
  const same = (i) =>
    i >= 0 && i < parent.childCount && mark.isInSet(parent.child(i).marks);
  while (same(start - 1)) start--;
  while (same(end)) end++;
  let from = $pos.start();
  for (let i = 0; i < start; i++) from += parent.child(i).nodeSize;
  let to = from;
  for (let i = start; i < end; i++) to += parent.child(i).nodeSize;
  return { from, to, mark };
}
export function linkAt(state) {
  const { $from, from, to, empty } = state.selection;
  if (empty) return markRange($from, M.link)?.mark.attrs.href ?? null;
  let href = null;
  state.doc.nodesBetween(from, to, (node) => {
    const m = M.link.isInSet(node.marks);
    if (m) href ??= m.attrs.href;
  });
  return href;
}
// Why an address cannot be a link (FORMAT.md › Inline content), or "": the link dialog and
// setLink share it, so the dialog never accepts an address the command refuses.
export function linkProblem(href) {
  if (!LINK_URL.test(href))
    return "Write the full address, starting with https://, http:// or mailto:.";
  // Control characters do not survive the HTML parser; spaces, quotes and brackets need encoding.
  if (/[\s<>"\u0000-\u001f\u007f]/.test(href))
    return "Spaces, quotes, angle brackets and control characters must be encoded (%20…).";
  return "";
}
// Links a non-empty selection, or changes the link around the cursor.
export const setLink = (href) => (state, dispatch) => {
  if (linkProblem(href)) return false;
  let { from, to, empty, $from } = state.selection;
  if (empty) {
    const r = markRange($from, M.link);
    if (!r) return false;
    ({ from, to } = r);
  }
  if (!canMark(state.doc, from, to, M.link)) return false;
  if (dispatch)
    dispatch(
      state.tr
        .removeMark(from, to, M.link)
        .addMark(from, to, M.link.create({ href })),
    );
  return true;
};
export function removeLink(state, dispatch) {
  let { from, to, empty, $from } = state.selection;
  if (empty) {
    const r = markRange($from, M.link);
    if (!r) return false;
    ({ from, to } = r);
  } else if (!linkAt(state)) return false;
  if (dispatch) dispatch(state.tr.removeMark(from, to, M.link));
  return true;
}
function canMark(doc, from, to, type) {
  let ok = false;
  doc.nodesBetween(from, to, (node) => {
    if (node.inlineContent && node.type.allowsMarkType(type)) ok = true;
    return !ok;
  });
  return ok;
}
