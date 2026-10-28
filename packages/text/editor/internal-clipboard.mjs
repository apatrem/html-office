// Copy, cut and paste inside the document keep everything the editor holds (footnotes,
// cross-references, comment anchors, marks), whatever the clipboard parser keeps (T09). Each copy
// is remembered with a random token written into its HTML; a paste carrying that token, from this
// editor's own HTML, inserts the remembered slice itself. A paste as plain text (Shift), a copy
// from another tab or document, and every other paste are left to the editor's clipboard handling
// (T07).
import { Plugin } from "prosemirror-state";

const ATTRIBUTE = "data-tx-clip";
const token = () =>
  Array.from(crypto.getRandomValues(new Uint32Array(2)), (n) =>
    n.toString(36),
  ).join("");

export function internalClipboard() {
  // pending: the slice ProseMirror is copying; last: the copy on the clipboard, with its token.
  let pending = null,
    last = null;
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
  return new Plugin({
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
        const html = event.clipboardData?.getData("text/html") ?? "";
        if (
          !last ||
          view.input?.shiftKey ||
          !html.includes(`${ATTRIBUTE}="${last.id}"`)
        )
          return false;
        let tr;
        try {
          tr = view.state.tr.replaceSelection(last.slice);
        } catch {
          return false;
        }
        view.dispatch(tr.scrollIntoView().setMeta("uiEvent", "paste"));
        return true;
      },
    },
  });
}
