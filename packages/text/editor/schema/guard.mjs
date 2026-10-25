// Keeps edited documents inside the subset where the schema alone cannot (FORMAT.md › Inline content):
// HTML cannot nest <a>, so a link never covers a footnote or a cross-reference. A transaction that
// would put one there (Add link over a selection, typing at a link's edge) leaves those nodes unlinked.
import { Plugin } from "prosemirror-state";
import { schema } from "./schema.mjs";

const link = schema.marks.link;

export function linkConflicts(doc) {
  const found = [];
  doc.descendants((node, pos) => {
    if (
      (node.type.name === "footnote" || node.type.name === "xref") &&
      link.isInSet(node.marks)
    )
      found.push({ node, pos });
    // Text inside a linked footnote cannot be linked either.
    return node.type.name !== "xref";
  });
  return found;
}

export const subsetGuard = () =>
  new Plugin({
    appendTransaction(transactions, _old, state) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const conflicts = linkConflicts(state.doc);
      if (!conflicts.length) return null;
      const tr = state.tr;
      for (const { node, pos } of conflicts)
        tr.removeMark(pos, pos + node.nodeSize, link);
      return tr;
    },
  });
