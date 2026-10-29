// File › Markdown view and Export Markdown (T15): the projection of editor/markdown.mjs, drawn
// from the document as it is now (unsaved edits included). The view is read-only and the export
// a download: neither is stored in the file or the draft, nor read back.
import { h } from "../../shared/shell/dom.mjs";
import { modal } from "../../shared/shell/dialogs.mjs";

const HINT =
  "A read-only Markdown projection of this document, for reading and copying. It is not the document and is never saved with it: comments, layout, styles, IDs, cross-reference links, image pictures and chart drawings are not kept (see the note at the top).";

// The Markdown file as a download named after the document.
export function exportMarkdown(markdown, name) {
  const url = URL.createObjectURL(
    new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
  );
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// The view: the Markdown in a read-only text area, with Copy and Export.
export function markdownView(markdown, name, say) {
  const area = h("textarea", {
    readonly: true,
    rows: 18,
    spellcheck: "false",
    class: "tx-md tx-md-view",
    "aria-label": "Markdown",
    // WebKit goes back in history on Backspace in a read-only field.
    onkeydown: (e) => e.key === "Backspace" && e.preventDefault(),
  });
  area.value = markdown;
  const action = (label, onclick, cls = "sh-ghost") =>
    h("button", { type: "button", class: `sh-b sh-t ${cls}`, onclick }, label);
  const copy = async () => {
    area.select();
    try {
      await navigator.clipboard.writeText(markdown);
    } catch {
      document.execCommand("copy");
    }
    say("Markdown copied: a reading copy, not the document.");
  };
  const dialog = modal(
    "Markdown view",
    [h("p", { class: "sh-hint" }, HINT), area],
    [
      action("Copy", copy),
      action("Export .md", () => {
        exportMarkdown(markdown, name);
        say(
          `Markdown export ${name} downloaded: a reading copy, not the document.`,
        );
      }),
      h("span", { class: "sh-spacer" }),
      action("Close", () => dialog.close("close"), "sh-primary"),
    ],
  );
  area.focus();
  area.setSelectionRange(0, 0);
  return dialog;
}
