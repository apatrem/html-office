// Keeps edited documents inside the subset where the schema alone cannot (FORMAT.md). After each
// changing transaction it repairs, in one appended step:
// - links over footnotes and cross-references (HTML cannot nest <a>): those nodes are unlinked;
// - repeated IDs (a split heading, a duplicated figure): later copies get a fresh ID;
// - table rows left short by an edit: empty cells fill the grid back to a rectangle.
// It also refuses a transaction that deletes a comment thread text still refers to.
import { Plugin } from "prosemirror-state";
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

// [{pos, id}] for every node after the first that repeats an ID.
export function repeatedIds(doc) {
  const seen = new Set(),
    found = [];
  doc.descendants((node, pos) => {
    if (!IDS.has(node.type.name)) return;
    if (seen.has(node.attrs.id)) found.push({ pos, id: node.attrs.id });
    seen.add(node.attrs.id);
  });
  return { seen, found };
}

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

function repair(state) {
  const tr = state.tr;
  for (const { node, pos } of linkConflicts(state.doc))
    tr.removeNodeMark(pos, link);
  const { seen, found } = repeatedIds(tr.doc);
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
    appendTransaction(transactions, _old, state) {
      return transactions.some((tr) => tr.docChanged) ? repair(state) : null;
    },
  });
