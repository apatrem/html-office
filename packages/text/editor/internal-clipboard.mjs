// Copy, cut and paste inside the document keep everything the editor holds (footnotes,
// cross-references, comment anchors, marks), whatever the clipboard parser keeps (T09). The copied
// slice is remembered with the plain text written for it; a paste whose text/plain is that text,
// from this editor's own HTML, inserts the slice itself. Other pastes are left to the editor's
// clipboard handling (T07).
import { Plugin } from "prosemirror-state";

let last = null;
const textOf = (slice) =>
  slice.content.textBetween(0, slice.content.size, "\n\n", (leaf) =>
    leaf.type.name === "hard_break"
      ? "\n"
      : leaf.type.name === "xref"
        ? leaf.attrs.label
        : "",
  );

export const internalClipboard = () =>
  new Plugin({
    props: {
      clipboardTextSerializer(slice) {
        const text = textOf(slice);
        last = { slice, text };
        return text;
      },
      handlePaste(view, event) {
        const data = event.clipboardData;
        if (
          !last ||
          !data ||
          data.getData("text/plain") !== last.text ||
          !data.getData("text/html").includes("data-pm-slice")
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
