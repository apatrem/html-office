// Keeps edited documents inside the subset where the schema alone cannot (FORMAT.md). After each
// changing transaction it repairs, in one appended step:
// - links over footnotes and cross-references (HTML cannot nest <a>): those nodes are unlinked;
// - repeated IDs (a split heading, a pasted copy): the node that had the ID keeps it, and the
//   copies get a fresh one, so references never move to a copy;
// - table rows left short by an edit: empty cells fill the grid back to a rectangle;
// - comment threads an edit removed (Select all, then typing): they come back, orphaned.
// It also refuses a transaction that deletes a comment thread text still refers to. Only
// deleteThread (marked with DROP) and undo or redo remove threads.
import { Plugin } from "prosemirror-state";
import { Mapping } from "prosemirror-transform";
import { isHistoryTransaction } from "prosemirror-history";
import { schema } from "./schema.mjs";
import { classes } from "../../model/html.mjs";

// IDs of the file outside the article (its title, guide, zones), set by the editor on open:
// fresh IDs (here and for new headings, editor/commands.mjs) never take one.
let fileIds = new Set();
export const reserveIds = (ids) => (fileIds = new Set(ids));
export const reservedIds = () => fileIds;

const N = schema.nodes,
  link = schema.marks.link;
const IDS = new Set([
  "heading",
  "chart",
  "image_figure",
  "table_figure",
  "comment_thread",
]);

export function linkConflicts(doc) {
  const found = [];
  doc.descendants((node, pos) => {
    if (
      (node.type === N.footnote || node.type === N.xref) &&
      link.isInSet(node.marks)
    )
      found.push({ node, pos });
  });
  return found;
}

export const DROP = "dropThread";

// [{pos, id}] for every node that repeats an ID, except the one that keeps it: the one at
// keep.get(id) when there is one, the first otherwise.
export function repeatedIds(doc, keep = new Map()) {
  const all = new Map(),
    found = [];
  doc.descendants((node, pos) => {
    if (IDS.has(node.type.name))
      all.set(node.attrs.id, [...(all.get(node.attrs.id) ?? []), pos]);
  });
  for (const [id, list] of all) {
    const kept = list.includes(keep.get(id)) ? keep.get(id) : list[0];
    for (const pos of list) if (pos !== kept) found.push({ pos, id });
  }
  return { seen: new Set(all.keys()), found };
}

// The threads of the comments section (the last block).
const threadsOf = (doc) =>
  doc.lastChild?.type === N.comments ? doc.lastChild.content.content : [];

// Missing cells per row of a table, from its spans: [{row, missing}] with the row's end position.
export function shortRows(table, pos) {
  const grid = [];
  const ends = [];
  let at = pos + 1;
  table.forEach((row, _o, r) => {
    grid[r] ??= [];
    let col = 0;
    row.forEach((cell) => {
      while (grid[r][col]) col++;
      for (let dr = 0; dr < cell.attrs.rowspan; dr++)
        for (let dc = 0; dc < cell.attrs.colspan; dc++)
          (grid[r + dr] ??= [])[col + dc] = true;
      col += cell.attrs.colspan;
    });
    at += row.nodeSize;
    ends.push({ end: at - 1, head: row.attrs.head });
  });
  const width = Math.max(
    1,
    ...grid.slice(0, table.childCount).map((r) => r.length),
  );
  return ends
    .map((e, r) => ({
      ...e,
      missing: width - (grid[r] ?? []).slice(0, width).filter(Boolean).length,
    }))
    .filter((e) => e.missing > 0);
}

// old: the state before `transactions`, which led to `state`.
function repair(state, old, transactions) {
  const tr = state.tr;
  for (const { node, pos } of linkConflicts(state.doc))
    tr.removeNodeMark(pos, link);
  // Where each ID's node from before the edit is now.
  const mapping = new Mapping(),
    keep = new Map();
  for (const t of transactions) mapping.appendMapping(t.mapping);
  old.doc.descendants((node, pos) => {
    const to = mapping.mapResult(pos, 1);
    if (IDS.has(node.type.name) && !to.deleted && !keep.has(node.attrs.id))
      keep.set(node.attrs.id, to.pos);
  });
  const { seen, found } = repeatedIds(tr.doc, keep);
  for (const { pos, id } of found) {
    let n = 2;
    while (seen.has(`${id}-${n}`) || fileIds.has(`${id}-${n}`)) n++;
    seen.add(`${id}-${n}`);
    tr.setNodeAttribute(pos, "id", `${id}-${n}`);
  }
  const tables = [];
  tr.doc.descendants((node, pos) => {
    if (node.type === N.table) tables.push({ node, pos });
    return node.type !== N.table;
  });
  for (const { node, pos } of tables.reverse())
    for (const { end, head, missing } of shortRows(node, pos).reverse())
      tr.insert(
        end,
        Array.from({ length: missing }, () =>
          (head ? N.table_header : N.table_cell).create(),
        ),
      );
  const ids = new Set(threadsOf(tr.doc).map((t) => t.attrs.id));
  const lost = transactions.some(
    (t) => t.getMeta(DROP) || isHistoryTransaction(t),
  )
    ? []
    : threadsOf(old.doc).filter((t) => !ids.has(t.attrs.id));
  if (lost.length)
    tr.insert(
      tr.doc.content.size - (ids.size ? 1 : 0),
      ids.size ? lost : N.comments.create(null, lost),
    );
  return tr.docChanged ? tr : null;
}

// Comment anchors (marks, and mark.comment in protected blocks) whose thread is missing.
function treeRefs(tree, refs) {
  if (tree.type !== "element") return;
  const ref = tree.attrs.find(([name]) => name === "data-ref");
  if (tree.name === "mark" && ref && classes(tree).includes("comment"))
    refs.add(ref[1]);
  for (const child of tree.children) treeRefs(child, refs);
}
export function lostThreads(doc) {
  const threads = new Set(),
    refs = new Set();
  doc.descendants((node) => {
    if (node.type === N.comment_thread) threads.add(node.attrs.id);
    else if (node.type === N.protected) treeRefs(node.attrs.node, refs);
    for (const mark of node.marks)
      if (mark.type === schema.marks.comment) refs.add(mark.attrs.ref);
  });
  return [...refs].filter((ref) => !threads.has(ref));
}

export const subsetGuard = () =>
  new Plugin({
    // A thread that text still refers to cannot be deleted (the file would be invalid); comment
    // editing is T13. The comments section is the last block: unchanged, it is the same node.
    filterTransaction(tr, state) {
      if (!tr.docChanged || tr.doc.lastChild === state.doc.lastChild)
        return true;
      return lostThreads(tr.doc).length <= lostThreads(state.doc).length;
    },
    appendTransaction(transactions, old, state) {
      return transactions.some((tr) => tr.docChanged)
        ? repair(state, old, transactions)
        : null;
    },
  });
