// The comments panel (T13): threads in document order with replies, open/resolved status and
// deletion; a new comment on the selected text; orphaned threads with recovery. Recovery lists
// candidates (highlighted while you look at them) and changes nothing until you confirm one; a
// candidate from an older revision of the document is refused. Comment text is shown as text,
// never as markup, and the display name is asked once and kept in this browser, never verified.
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { h } from "../../shared/shell/dom.mjs";
import * as K from "../editor/comments.mjs";

const NAME_KEY = "html-office:text-author";
const readName = () => {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
};
const keepName = (name) => {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Private windows may refuse: the name is asked again next time.
  }
};

// Highlights: the active thread's anchors and the candidate being looked at. Never saved; gone
// at the next edit.
const key = new PluginKey("tx-comments");
export const commentHighlights = () =>
  new Plugin({
    key,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const ranges = tr.getMeta(key);
        if (ranges)
          return DecorationSet.create(
            tr.doc,
            ranges.map(({ from, to, cls }) =>
              Decoration.inline(from, to, { class: cls }),
            ),
          );
        return tr.docChanged ? DecorationSet.empty : set;
      },
    },
    props: { decorations: (state) => key.getState(state) },
  });

// The panel's content, drawn again by render() when the document changes. view: the editor view;
// report(message) shows a message in the state line.
export function commentsPanel(view, report) {
  const root = h("div", { class: "tx-comments" });
  let recovery = null,
    draft = null;
  const run = (command) => command(view.state, view.dispatch);
  const highlight = (ranges) =>
    view.dispatch(view.state.tr.setMeta(key, ranges));
  const focusRange = ({ from, to }) => {
    view.dispatch(
      view.state.tr
        .setSelection(TextSelection.create(view.state.doc, from, to))
        .scrollIntoView(),
    );
  };
  const name = h("input", {
    type: "text",
    value: readName(),
    placeholder: "Your name, shown with your comments",
    "aria-label": "Your name",
  });
  name.addEventListener("change", () => keepName(name.value.trim()));
  const author = () => {
    const value = name.value.trim();
    if (!value) {
      name.focus();
      report("Enter your name first: it is shown with your comments.");
      return null;
    }
    keepName(value);
    return value;
  };
  const text = (value) => document.createTextNode(value);

  // A new comment on the selected text: the range is kept with the document it was taken from.
  function start() {
    const { from, to, empty } = view.state.selection;
    if (empty) return report("Select the text to comment on first.");
    draft = {
      from,
      to,
      doc: view.state.doc,
      quote: K.anchorContext(view.state.doc, from, to).quote,
    };
    render(true);
    root.querySelector(".tx-new textarea")?.focus();
  }
  function post(area) {
    const who = author();
    if (!who || !draft) return;
    if (view.state.doc !== draft.doc) {
      draft = null;
      render(true);
      return report("The document changed: select the text again.");
    }
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, draft.from, draft.to),
      ),
    );
    if (!run(K.addComment({ author: who, text: area.value })))
      return report("A comment needs text, on text that can hold it.");
    draft = null;
    render(true);
  }

  function card(t) {
    const a = t.node.attrs;
    const head = h(
      "div",
      { class: "tx-thread-head" },
      h(
        "span",
        { class: `tx-status tx-${t.orphan ? "orphan" : a.status}` },
        t.orphan ? "Orphaned" : a.status === "open" ? "Open" : "Resolved",
      ),
      // The quotation takes you to the commented text (a button: keyboard too).
      t.anchors.length
        ? h(
            "button",
            {
              type: "button",
              class: "tx-thread-go",
              "data-control": "go",
              title: "Show the commented text",
              onclick: () => {
                focusRange(t.anchors[0]);
                highlight(t.anchors.map((r) => ({ ...r, cls: "tx-active" })));
                view.focus();
              },
            },
            h("q", {}, text(a.quote)),
          )
        : h("q", {}, text(a.quote)),
    );
    const entries = a.entries.map((e) =>
      h(
        "div",
        { class: "tx-entry" },
        h(
          "p",
          { class: "tx-who" },
          text(
            `${e.author} · ${e.date.replace("T", " ").replace("Z", " UTC")}`,
          ),
        ),
        h("p", {}, text(e.text)),
      ),
    );
    const area = h("textarea", {
      rows: "2",
      "aria-label": "Reply",
      "data-control": "reply",
    });
    const actions = h(
      "div",
      { class: "tx-thread-actions" },
      h(
        "button",
        {
          type: "button",
          class: "sh-b sh-t sh-ghost",
          onclick: () => {
            const who = author();
            if (!who) return;
            // Emptied before the reply redraws the panel, so it is never posted twice.
            const typed = area.value;
            area.value = "";
            if (!run(K.reply(t.id, { author: who, text: typed })))
              area.value = typed;
          },
        },
        "Reply",
      ),
      h(
        "button",
        {
          type: "button",
          class: "sh-b sh-t sh-ghost",
          "data-control": "status",
          onclick: () =>
            run(K.setStatus(t.id, a.status === "open" ? "resolved" : "open")),
        },
        a.status === "open" ? "Resolve" : "Reopen",
      ),
      // A thread a protected block refers to stays: that block keeps its mark.
      t.kept
        ? null
        : h(
            "button",
            {
              type: "button",
              class: "sh-b sh-t sh-ghost",
              "data-control": "delete",
              onclick: () => run(K.deleteThread(t.id)),
            },
            "Delete",
          ),
    );
    const box = h(
      "article",
      {
        class: `tx-thread${t.orphan ? " tx-orphaned" : ""}`,
        "data-thread": t.id,
      },
      head,
      t.kept
        ? h("p", { class: "sh-hint" }, "Attached inside a protected block.")
        : null,
      entries,
      t.orphan ? orphan(t) : null,
      area,
      actions,
    );
    return box;
  }

  // An orphaned thread: why, and recovery on request.
  function orphan(t) {
    const note = h(
      "p",
      { class: "sh-hint" },
      "The text this thread was attached to is gone. It stays here, unattached, until you choose where it belongs.",
    );
    if (recovery?.id !== t.id)
      return [
        note,
        h(
          "button",
          {
            type: "button",
            class: "sh-b sh-t sh-ghost",
            onclick: () => {
              recovery = {
                id: t.id,
                list: K.candidates(view.state.doc, t.id),
                doc: view.state.doc,
              };
              render(true);
            },
          },
          "Find the quoted text…",
        ),
      ];
    const { list } = recovery;
    const close = () => {
      recovery = null;
      highlight([]);
      render(true);
    };
    return [
      note,
      h(
        "p",
        { class: "sh-hint" },
        list.length
          ? `${list.length} place${list.length > 1 ? "s" : ""} hold${list.length > 1 ? "" : "s"} the quoted text exactly. Nothing changes until you attach the thread to one.`
          : "The quoted text is nowhere in the document. The thread stays unattached.",
      ),
      h(
        "ol",
        { class: "tx-candidates" },
        list.map((c, i) =>
          h(
            "li",
            {
              onmouseenter: () =>
                highlight([{ from: c.from, to: c.to, cls: "tx-candidate" }]),
            },
            h(
              "p",
              {},
              text(
                `${c.inSection ? "In its section" : "Elsewhere"}: …${c.before}`,
              ),
              h("mark", { class: "tx-quote" }, text(t.node.attrs.quote)),
              text(`${c.after}…`),
            ),
            h(
              "button",
              {
                type: "button",
                class: "sh-b sh-t sh-ghost",
                "aria-label": `Attach to place ${i + 1}`,
                onclick: () => {
                  if (!run(K.confirmCandidate(t.id, c))) {
                    report(
                      "The document changed since the search: search again before attaching.",
                    );
                    recovery = {
                      id: t.id,
                      list: K.candidates(view.state.doc, t.id),
                      doc: view.state.doc,
                    };
                    return render(true);
                  }
                  recovery = null;
                  render(true);
                  report("Thread attached.");
                },
              },
              "Attach here",
            ),
          ),
        ),
      ),
      h(
        "button",
        { type: "button", class: "sh-b sh-t sh-ghost", onclick: close },
        "Cancel",
      ),
    ];
  }

  // Drawn again when the document changed, or when `force` (the panel's own state changed);
  // highlights and selection changes leave it as it is.
  let drawn = null;
  function render(force = false) {
    if (!force && drawn === view.state.doc) return;
    drawn = view.state.doc;
    // A search made on an older document is shown no more: it would attach to stale positions.
    if (recovery && recovery.doc !== view.state.doc) recovery = null;
    const all = K.threads(view.state.doc);
    const fresh = h(
      "div",
      { class: "tx-comments" },
      h("label", { class: "tx-name" }, "Your name", name),
      draft
        ? h(
            "div",
            { class: "tx-new" },
            h("q", {}, text(draft.quote)),
            h("textarea", {
              rows: "3",
              "aria-label": "New comment",
              "data-control": "new",
            }),
            h(
              "div",
              { class: "tx-thread-actions" },
              h(
                "button",
                {
                  type: "button",
                  class: "sh-b sh-t sh-primary",
                  onclick: (e) =>
                    post(e.target.closest(".tx-new").querySelector("textarea")),
                },
                "Comment",
              ),
              h(
                "button",
                {
                  type: "button",
                  class: "sh-b sh-t sh-ghost",
                  onclick: () => {
                    draft = null;
                    render(true);
                  },
                },
                "Cancel",
              ),
            ),
          )
        : h(
            "button",
            {
              type: "button",
              class: "sh-b sh-t sh-ghost",
              onclick: start,
            },
            "Comment on the selection",
          ),
      all.length
        ? all.map(card)
        : h("p", { class: "sh-hint" }, "No comments yet."),
    );
    // A redraw keeps what is being typed, and the control that had the keyboard with its caret.
    const where = (el) =>
      `${el.closest("[data-thread]")?.dataset.thread ?? "new"}:${el.dataset.control ?? el.localName}`;
    const typing = [...root.querySelectorAll("textarea")].map((t) => [
      where(t),
      t.value,
    ]);
    const active = root.contains(document.activeElement)
      ? document.activeElement
      : null;
    const focus = active && {
      key: where(active),
      range: active.localName === "textarea" && [
        active.selectionStart,
        active.selectionEnd,
      ],
    };
    root.replaceChildren(...fresh.childNodes);
    const find = (key) =>
      [...root.querySelectorAll("textarea, button, input")].find(
        (el) => where(el) === key,
      );
    for (const [key, value] of typing) {
      const area = find(key);
      if (area) area.value = value;
    }
    const target = focus && find(focus.key);
    if (target) {
      target.focus({ preventScroll: true });
      if (focus.range) target.setSelectionRange(...focus.range);
    }
  }
  render(true);
  return { root, render, start };
}
