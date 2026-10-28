// Comment threads (T13): anchors, threads and recovery as ProseMirror commands. A thread lives in
// section.comments; text refers to it with mark.comment[data-ref], which follows every edit
// through ProseMirror's mapping. A thread no mark refers to is orphaned: it is never reattached
// on its own. Recovery only proposes candidates (the exact quotation in the original section,
// then in the document, each occurrence apart); a candidate is applied when the person confirms
// it, and only if the document is still the one it was found in. Comment text is data.
import { closeHistory } from "prosemirror-history";
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

// The text quotations are made of, read the same way for a new thread and for recovery: text as
// written (spaces kept), a cross-reference as its label, a line break or a new textblock as
// "\n", a footnote's text where it is written. Code, protected blocks and comments are left out.
// ranges[i]: the document range character i stands for (null for a block boundary).
export function flatten(doc, from = 0, to = doc.content.size) {
  let text = "",
    started = false;
  const ranges = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if ([N.protected, N.comments, N.code_block].includes(node.type))
      return false;
    if (node.isTextblock) {
      if (started) {
        text += "\n";
        ranges.push(null);
      }
      started = true;
      return true;
    }
    if (node.isText) {
      const start = Math.max(from, pos),
        end = Math.min(to, pos + node.nodeSize);
      for (let p = start; p < end; p++) {
        text += node.text[p - pos];
        ranges.push([p, p + 1]);
      }
      return false;
    }
    if (node.isInline && node.isLeaf && pos >= from && pos + 1 <= to) {
      const leaf = node.type === N.xref ? node.attrs.label : "\n";
      for (const ch of leaf) {
        text += ch;
        ranges.push([pos, pos + 1]);
      }
    }
    return true;
  });
  return { text, ranges };
}
// At most n characters (code points, never half of one) from the start or the end of a text.
const first = (text, n) => Array.from(text).slice(0, n).join("");
const last = (text, n) => Array.from(text).slice(-n).join("");

// The headings that start sections, protected ones included (not a cover title):
// [{pos, id, level}].
function headings(doc) {
  const out = [];
  doc.forEach((node, pos) => {
    if (node.type === N.heading)
      out.push({ pos, id: node.attrs.id, level: node.attrs.level });
    else if (node.type === N.protected) {
      const tree = node.attrs.node;
      const id = tree.attrs?.find(([n]) => n === "id")?.[1];
      if (
        /^h[1-4]$/.test(tree.name ?? "") &&
        id &&
        !classes(tree).includes("title")
      )
        out.push({ pos, id, level: Number(tree.name[1]) });
    }
  });
  return out;
}

// Quote, section and context of a range, as a thread records them.
export function anchorContext(doc, from, to) {
  const $from = doc.resolve(from),
    $to = doc.resolve(to);
  const section =
    headings(doc)
      .filter((h) => h.pos < from)
      .at(-1)?.id ?? null;
  return {
    quote: flatten(doc, from, to).text,
    section,
    prefix: last(flatten(doc, $from.start(), from).text, CONTEXT) || null,
    suffix: first(flatten(doc, to, $to.end()).text, CONTEXT) || null,
  };
}

// Every thread in document order of its first anchor, orphans last: [{id, pos, node, anchors:
// [{from, to}], kept, orphan}]. kept: a mark inside a protected block refers to it.
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
      const prev = list.at(-1);
      if (prev && prev.to === pos) prev.to = pos + node.nodeSize;
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
      kept: kept.has(node.attrs.id),
      orphan: !anchors.length && !kept.has(node.attrs.id),
    });
  });
  const firstAt = (t) => (t.anchors.length ? t.anchors[0].from : Infinity);
  return out.sort((a, b) => firstAt(a) - firstAt(b));
}
const threadById = (doc, id) => threads(doc).find((t) => t.id === id) ?? null;

// Whether a comment mark can fall on some text of a range (never in code).
function markable(doc, from, to) {
  let text = false;
  doc.nodesBetween(from, to, (node, _pos, parent) => {
    if (node.isText && parent.type.allowsMarkType(COMMENT)) text = true;
  });
  return text;
}

// Each comment command is its own undo step: undoing a status never takes a reply with it.
const step = (tr) => closeHistory(tr);

// A new thread on the selected text, with its first comment ({author, text, date}).
export const addComment = (entry) => (state, dispatch) => {
  const { from, to, empty } = state.selection;
  if (empty || !entry.text?.trim() || !entry.author?.trim()) return false;
  if (!markable(state.doc, from, to)) return false;
  const context = anchorContext(state.doc, from, to);
  if (!context.quote) return false;
  if (dispatch) {
    const taken = usedIds(state.doc);
    let n = 1;
    while (taken.has(`c${n}`)) n++;
    const thread = N.comment_thread.create({
      id: `c${n}`,
      status: "open",
      ...context,
      entries: [
        {
          author: entry.author.trim(),
          date: entry.date ?? commentDate(),
          text: entry.text.trim(),
        },
      ],
    });
    const tr = step(state.tr).addMark(
      from,
      to,
      COMMENT.create({ ref: `c${n}` }),
    );
    const lastBlock = tr.doc.lastChild;
    if (lastBlock.type === N.comments)
      tr.insert(tr.doc.content.size - 1, thread);
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
  dispatch?.(step(state.tr).setNodeMarkup(t.pos, null, attrs));
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

// Deletes a thread and every mark that refers to it; the section goes with its last thread. A
// thread a protected block refers to cannot go: that block keeps its mark.
export const deleteThread = (id) => (state, dispatch) => {
  const t = threadById(state.doc, id);
  if (!t || t.kept) return false;
  if (dispatch) {
    const tr = step(state.tr);
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
// chosen. A quotation may run across blocks or through a footnote, as a new thread's may.
// [{from, to, before, after, inSection, doc}]
export function candidates(doc, id) {
  const t = threadById(doc, id);
  if (!t?.orphan) return [];
  const quote = t.node.attrs.quote;
  if (!quote) return [];
  // The section's extent: from its heading to the next heading of the same or a higher level.
  let section = null;
  const list = headings(doc);
  const i = list.findIndex((h) => h.id === t.node.attrs.section);
  if (i >= 0) {
    const next = list.slice(i + 1).find((h) => h.level <= list[i].level);
    section = { start: list[i].pos, end: next?.pos ?? doc.content.size };
  }
  const { text, ranges } = flatten(doc);
  const found = [];
  for (
    let at = text.indexOf(quote);
    at >= 0;
    at = text.indexOf(quote, at + 1)
  ) {
    const start = ranges[at],
      end = ranges[at + quote.length - 1];
    if (!start || !end) continue;
    const [from] = start,
      [, to] = end;
    if (!markable(doc, from, to)) continue;
    found.push({
      from,
      to,
      before: last(text.slice(0, at), CONTEXT),
      after: first(text.slice(at + quote.length), CONTEXT),
      inSection: !!section && from >= section.start && to <= section.end,
      doc,
    });
  }
  return [
    ...found.filter((c) => c.inSection),
    ...found.filter((c) => !c.inSection),
  ];
}

// Attaches an orphaned thread to a candidate the person confirmed: only in the document the
// candidate was found in, where the range still holds the quotation, can take the mark, and the
// thread is still orphaned. The thread's section and context follow the new place.
export const confirmCandidate = (id, candidate) => (state, dispatch) => {
  const t = threadById(state.doc, id);
  if (!t?.orphan || candidate.doc !== state.doc) return false;
  const { from, to } = candidate;
  if (
    from < 0 ||
    to > state.doc.content.size ||
    flatten(state.doc, from, to).text !== t.node.attrs.quote ||
    !markable(state.doc, from, to)
  )
    return false;
  const { section, prefix, suffix } = anchorContext(state.doc, from, to);
  const tr = step(state.tr)
    .addMark(from, to, COMMENT.create({ ref: id }))
    .setNodeMarkup(t.pos, null, { ...t.node.attrs, section, prefix, suffix });
  if (threadById(tr.doc, id)?.orphan !== false) return false;
  dispatch?.(tr);
  return true;
};
