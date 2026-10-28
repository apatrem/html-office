// Copy, cut and paste inside the document keep everything the editor holds (footnotes,
// cross-references, comment anchors, marks), whatever the clipboard parser keeps (T09). Each copy
// is remembered with a random token written into its HTML; a paste carrying that token, from this
// editor's own HTML, inserts the remembered slice itself. A paste as plain text (Shift), a copy
// from another tab or document, and every other paste are left to the editor's clipboard handling
// (T07).
import { Fragment, Slice } from "prosemirror-model";
import { Plugin } from "prosemirror-state";

const ATTRIBUTE = "data-tx-clip";
const token = () =>
  Array.from(crypto.getRandomValues(new Uint32Array(2)), (n) =>
    n.toString(36),
  ).join("");

// The slice without what a paste must not create: comment threads, and comment anchors except
// one moving back (cut, then pasted) for a thread of `doc` that no longer has any.
export function withoutNewComments(slice, doc) {
  const threads = new Set(),
    anchored = new Set();
  doc.descendants((node) => {
    if (node.type.name === "comment_thread") threads.add(node.attrs.id);
    for (const mark of node.marks)
      if (mark.type.name === "comment") anchored.add(mark.attrs.ref);
  });
  const keep = (mark) =>
    mark.type.name !== "comment" ||
    (threads.has(mark.attrs.ref) && !anchored.has(mark.attrs.ref));
  const dropped = [false, false];
  const clean = (fragment, top) => {
    const out = [];
    fragment.forEach((node, _offset, i) => {
      if (["comments", "comment_thread"].includes(node.type.name)) {
        if (top && i === 0) dropped[0] = true;
        if (top && i === fragment.childCount - 1) dropped[1] = true;
        return;
      }
      const marks = node.marks.filter(keep);
      out.push(
        node.isLeaf
          ? node.mark(marks)
          : node.type.create(node.attrs, clean(node.content, false), marks),
      );
    });
    return Fragment.fromArray(out);
  };
  const content = clean(slice.content, true);
  return new Slice(
    content,
    dropped[0] ? 0 : slice.openStart,
    dropped[1] ? 0 : slice.openEnd,
  );
}

export function internalClipboard() {
  // pending: the slice ProseMirror is copying; last: the copy on the clipboard, with its token.
  let pending = null,
    last = null;
  // This copy's slice when the paste carries its token in HTML (not a Shift paste), or null.
  const lookup = (view, event) => {
    const html = event.clipboardData?.getData("text/html") ?? "";
    return last &&
      !view.input?.shiftKey &&
      html.includes(`${ATTRIBUTE}="${last.id}"`)
      ? last.slice
      : null;
  };
  // After ProseMirror wrote the copy (its listener comes first): the token goes into the element
  // that carries data-pm-slice.
  const mark = (event) => {
    const data = event.clipboardData;
    const html = data?.getData("text/html");
    if (!pending || !html?.includes("data-pm-slice")) return;
    const id = token();
    data.setData(
      "text/html",
      html.replace("data-pm-slice", `${ATTRIBUTE}="${id}" data-pm-slice`),
    );
    last = { slice: pending, id };
    pending = null;
  };
  const plugin = new Plugin({
    view(view) {
      view.dom.addEventListener("copy", mark);
      view.dom.addEventListener("cut", mark);
      return {
        destroy() {
          view.dom.removeEventListener("copy", mark);
          view.dom.removeEventListener("cut", mark);
        },
      };
    },
    props: {
      // Called by ProseMirror for every copy and cut, before it writes the clipboard.
      transformCopied(slice) {
        pending = slice;
        return slice;
      },
      handlePaste(view, event) {
        const remembered = lookup(view, event);
        if (!remembered) return false;
        let tr;
        try {
          // Anchors are counted without the text the paste replaces.
          const rest = view.state.tr.deleteSelection().doc;
          const slice = withoutNewComments(remembered, rest);
          if (!slice.size) return false;
          tr = view.state.tr.replaceSelection(slice);
        } catch {
          return false;
        }
        view.dispatch(tr.scrollIntoView().setMeta("uiEvent", "paste"));
        return true;
      },
    },
  });
  // A copy written by the editor's own handler (a table as the envelope, T07) is remembered too,
  // with its token in the HTML, so a paste in this document brings back its footnotes and
  // cross-references.
  plugin.remember = (slice, data) => {
    const html = data.getData("text/html");
    if (!html) return;
    const id = token();
    data.setData(
      "text/html",
      html.replace(/<([a-z][\w-]*)/i, `<$1 ${ATTRIBUTE}="${id}"`),
    );
    last = { slice, id };
    pending = null;
  };
  plugin.lookup = lookup;
  return plugin;
}
