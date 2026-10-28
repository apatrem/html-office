// Comment threads (T13): anchors, threads and recovery as ProseMirror commands. A thread lives in
// section.comments; text refers to it with mark.comment[data-ref], which follows every edit
// through ProseMirror's mapping. A thread no mark refers to is orphaned: it is never reattached
// on its own. Recovery only proposes candidates (the exact quotation in the original section,
// then in the document, each occurrence apart); a candidate is applied when the person confirms
// it, and only if the document is still the one it was found in. Comment text is data.
import { schema } from "./schema/schema.mjs";
import { usedIds } from "./commands.mjs";
import { classes } from "../model/html.mjs";

const N = schema.nodes,
  COMMENT = schema.marks.comment;
const CONTEXT = 32;

// A UTC date as the format writes it: 2026-10-28T14:02Z.
export const commentDate = (date = new Date()) =>
  `${date.toISOString().slice(0, 16)}Z`;

// Comment refs inside protected blocks: those threads are attached there.
function treeRefs(tree, refs) {
  if (tree.type !== "element") return;
  const ref = tree.attrs.find(([n]) => n === "data-ref");
  if (tree.name === "mark" && ref && classes(tree).includes("comment"))
    refs.add(ref[1]);
  for (const child of tree.children) treeRefs(child, refs);
}

// The text of each textblock with its positions, inline nodes as U+FFFC: quotations are found in
// text only, never across a footnote, cross-reference or line break.
function textblocks(doc) {
  const out = [];
  doc.descendants((node, pos) => {
    if (node.type === N.protected || node.type === N.comments) return false;
    if (!node.isTextblock) return true;
    let text = "";
    const starts = [];
    node.forEach((child, offset) => {
      starts.push([text.length, pos + 1 + offset]);
      text += child.isText ? child.text : "￼";
    });
    out.push({ node, pos, text, starts });
    return false;
  });
  return out;
}
// The document position of an offset in a textblock's text.
function at(block, offset) {
  let found = block.starts[0] ?? [0, block.pos + 1];
  for (const s of block.starts) if (s[0] <= offset) found = s;
  return found[1] + (offset - found[0]);
}

// Quote, section and context of a range, as a thread records them.
export function anchorContext(doc, from, to) {
  const quote = doc.textBetween(from, to, " ", " ").replace(/\s+/g, " ");
  const $from = doc.resolve(from),
    $to = doc.resolve(to);
  const before = $from.parent.textBetween(0, $from.parentOffset, " ", " ");
  const after = $to.parent.textBetween(
    $to.parentOffset,
    $to.parent.content.size,
    " ",
    " ",
  );
  let section = null;
  doc.forEach((node, pos) => {
    if (node.type === N.heading && pos < from) section = node.attrs.id;
  });
  return {
    quote,
    section,
    prefix: before.slice(-CONTEXT) || null,
    suffix: after.slice(0, CONTEXT) || null,
  };
}

// Every thread in document order of its first anchor, orphans last: [{id, pos, node, anchors:
// [{from, to}], orphan}].
export function threads(doc) {
  const ranges = new Map(),
    kept = new Set();
  doc.descendants((node, pos) => {
    if (node.type === N.protected) {
      treeRefs(node.attrs.node, kept);
      return false;
    }
    if (!node.isInline) return true;
    for (const mark of node.marks) {
      if (mark.type !== COMMENT) continue;
      const list = ranges.get(mark.attrs.ref) ?? [];
      const last = list.at(-1);
      if (last && last.to === pos) last.to = pos + node.nodeSize;
      else list.push({ from: pos, to: pos + node.nodeSize });
      ranges.set(mark.attrs.ref, list);
    }
    return true;
  });
  const out = [];
  const section = doc.lastChild?.type === N.comments ? doc.lastChild : null;
  const start = section ? doc.content.size - section.nodeSize + 1 : 0;
  section?.forEach((node, offset) => {
    const anchors = ranges.get(node.attrs.id) ?? [];
    out.push({
      id: node.attrs.id,
      pos: start + offset,
      node,
      anchors,
      orphan: !anchors.length && !kept.has(node.attrs.id),
    });
  });
  const first = (t) => (t.anchors.length ? t.anchors[0].from : Infinity);
  return out.sort((a, b) => first(a) - first(b));
}
const threadById = (doc, id) => threads(doc).find((t) => t.id === id) ?? null;

// A new thread on the selected text, with its first comment ({author, text, date}).
export const addComment = (entry) => (state, dispatch) => {
  const { from, to, empty } = state.selection;
  if (empty || !entry.text?.trim() || !entry.author?.trim()) return false;
  // The mark must fall on some text (never inside code).
  let text = false;
  state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (node.isText && parent.type.allowsMarkType(COMMENT)) text = true;
  });
  if (!text) return false;
  if (dispatch) {
    const taken = usedIds(state.doc);
    let n = 1;
    while (taken.has(`c${n}`)) n++;
    const thread = N.comment_thread.create({
      id: `c${n}`,
      status: "open",
      ...anchorContext(state.doc, from, to),
      entries: [
        {
          author: entry.author.trim(),
          date: entry.date ?? commentDate(),
          text: entry.text.trim(),
        },
      ],
    });
    const tr = state.tr.addMark(from, to, COMMENT.create({ ref: `c${n}` }));
    const last = tr.doc.lastChild;
    if (last.type === N.comments) tr.insert(tr.doc.content.size - 1, thread);
    else tr.insert(tr.doc.content.size, N.comments.create(null, thread));
    dispatch(tr);
  }
  return true;
};

// Changes a thread's attributes through `change(attrs)`.
const changeThread = (id, change) => (state, dispatch) => {
  const t = threadById(state.doc, id);
  if (!t) return false;
  const attrs = change(t.node.attrs);
  if (!attrs) return false;
  dispatch?.(state.tr.setNodeMarkup(t.pos, null, attrs));
  return true;
};
export const reply = (id, entry) =>
  changeThread(id, (a) =>
    entry.text?.trim() && entry.author?.trim()
      ? {
          ...a,
          entries: [
            ...a.entries,
            {
              author: entry.author.trim(),
              date: entry.date ?? commentDate(),
              text: entry.text.trim(),
            },
          ],
        }
      : null,
  );
export const setStatus = (id, status) =>
  changeThread(id, (a) =>
    a.status !== status && ["open", "resolved"].includes(status)
      ? { ...a, status }
      : null,
  );

// Deletes a thread and every mark that refers to it; the section goes with its last thread.
export const deleteThread = (id) => (state, dispatch) => {
  const t = threadById(state.doc, id);
  if (!t) return false;
  if (dispatch) {
    const tr = state.tr;
    const mark = COMMENT.create({ ref: id });
    for (const { from, to } of t.anchors) tr.removeMark(from, to, mark);
    const section = tr.doc.lastChild;
    if (section.childCount === 1)
      tr.delete(tr.doc.content.size - section.nodeSize, tr.doc.content.size);
    else tr.delete(t.pos, t.pos + t.node.nodeSize);
    dispatch(tr);
  }
  return true;
};

// Places where an orphaned thread's exact quotation occurs, as proposals: those in its original
// section first, then the rest of the document, every occurrence apart, with context. Nothing is
// chosen. [{from, to, before, after, inSection, doc}]
export function candidates(doc, id) {
  const t = threadById(doc, id);
  if (!t?.orphan) return [];
  const quote = t.node.attrs.quote;
  if (!quote) return [];
  // The section's extent: from its heading to the next heading of the same or a higher level.
  let section = null;
  if (t.node.attrs.section) {
    let level = 0;
    doc.forEach((node, pos) => {
      if (node.type !== N.heading) return;
      if (section && !section.end && node.attrs.level <= level)
        section.end = pos;
      if (node.attrs.id === t.node.attrs.section) {
        section = { start: pos, end: 0 };
        level = node.attrs.level;
      }
    });
    if (section && !section.end) section.end = doc.content.size;
  }
  const found = [];
  for (const block of textblocks(doc)) {
    for (
      let i = block.text.indexOf(quote);
      i >= 0;
      i = block.text.indexOf(quote, i + 1)
    ) {
      const from = at(block, i),
        to = at(block, i + quote.length);
      found.push({
        from,
        to,
        before: block.text.slice(Math.max(0, i - CONTEXT), i),
        after: block.text.slice(i + quote.length, i + quote.length + CONTEXT),
        inSection: !!section && from >= section.start && to <= section.end,
        doc,
      });
    }
  }
  return [
    ...found.filter((c) => c.inSection),
    ...found.filter((c) => !c.inSection),
  ];
}

// Attaches an orphaned thread to a candidate the person confirmed: only in the document the
// candidate was found in, where the range still holds the quotation and the thread is still
// orphaned. The thread's section and context follow the new place.
export const confirmCandidate = (id, candidate) => (state, dispatch) => {
  const t = threadById(state.doc, id);
  if (!t?.orphan || candidate.doc !== state.doc) return false;
  const { from, to } = candidate;
  if (
    from < 0 ||
    to > state.doc.content.size ||
    state.doc.textBetween(from, to, " ", " ") !== t.node.attrs.quote
  )
    return false;
  if (dispatch) {
    const { section, prefix, suffix } = anchorContext(state.doc, from, to);
    dispatch(
      state.tr
        .addMark(from, to, COMMENT.create({ ref: id }))
        .setNodeMarkup(t.pos, null, {
          ...t.node.attrs,
          section,
          prefix,
          suffix,
        }),
    );
  }
  return true;
};
