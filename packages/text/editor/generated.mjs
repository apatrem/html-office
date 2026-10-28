// Generated content in the editor (T08): heading numbers and caption labels drawn as decorations
// (never saved), cross-references to missing targets flagged, and the saved generated content,
// cross-reference labels and contents lists, rewritten after every edit that can change them.
// Footnotes (T09) show as numbered references with a hover preview, open for editing while the
// cursor is in them, and are listed as notes at the end. The numbers come from numbering.mjs,
// the one function every view uses.
import { DOMSerializer } from "prosemirror-model";
import {
  Plugin,
  PluginKey,
  NodeSelection,
  TextSelection,
} from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import {
  AddMarkStep,
  RemoveMarkStep,
  ReplaceStep,
} from "prosemirror-transform";
import { schema } from "./schema/schema.mjs";
import { numbering, regenerate, DEFAULT_HEADING_FORMAT } from "./numbering.mjs";
export { themeFormat } from "./numbering.mjs";
import { HEADING_FORMAT } from "../model/format.mjs";

const N = schema.nodes;
export const generatedKey = new PluginKey("generated");

// Whether a transaction only changes text inside body textblocks: typing in a paragraph, list
// item, caption or cell (not a heading, whose text feeds contents and labels), or marking text.
// Numbers and labels cannot change then, so the decorations are only mapped.
function textOnly(tr) {
  return tr.steps.every((step, i) => {
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep)
      return true;
    if (!(step instanceof ReplaceStep) || step.structure) return false;
    const doc = tr.docs[i];
    const $from = doc.resolve(step.from);
    if (
      !$from.parent.isTextblock ||
      $from.parent.type === N.heading ||
      step.to > $from.end()
    )
      return false;
    const plain = (fragment) => {
      let ok = true;
      fragment.forEach((n) => (ok &&= n.isText || n.type === N.hard_break));
      return ok;
    };
    return (
      step.slice.openStart === 0 &&
      plain(step.slice.content) &&
      plain(doc.slice(step.from, step.to).content)
    );
  });
}

function decorations(doc, result) {
  const out = [];
  for (const { pos, number } of result.headings)
    if (number)
      out.push(
        Decoration.node(pos, pos + doc.nodeAt(pos).nodeSize, {
          "data-tx-number": number,
        }),
      );
  for (const { pos, number, label } of result.figures) {
    if (!number) continue;
    const figure = doc.nodeAt(pos);
    figure.forEach((child, offset) => {
      if (child.type !== N.caption) return;
      const at = pos + 1 + offset;
      out.push(
        Decoration.node(at, at + child.nodeSize, { "data-tx-label": label }),
      );
    });
  }
  const unnumbered = new Set(
    result.figures.filter((f) => !f.number).map((f) => f.id),
  );
  for (const { pos, target, missing } of result.xrefs)
    if (missing || unnumbered.has(target))
      out.push(
        Decoration.node(pos, pos + 1, {
          class: missing ? "tx-missing" : "tx-unnumbered",
          title: missing
            ? `No heading or figure "${target}": this cross-reference points nowhere`
            : "This figure has no caption, so it has no number",
        }),
      );
  for (const { pos, number, text } of result.footnotes)
    out.push(
      Decoration.node(pos, pos + doc.nodeAt(pos).nodeSize, {
        "data-tx-note": String(number),
        "data-tx-preview": text || "Empty note",
      }),
    );
  if (result.footnotes.length) {
    // The notes list goes at the end of the content, before the comments section.
    const last = doc.lastChild;
    const at =
      doc.content.size - (last.type === N.comments ? last.nodeSize : 0);
    const notes = result.footnotes.map((f) => doc.nodeAt(f.pos).content);
    out.push(
      Decoration.widget(at, (view) => notesList(view, notes), {
        key: `tx-notes:${JSON.stringify(notes.map((n) => n.toJSON()))}`,
        side: -1,
        ignoreSelection: true,
        stopEvent: () => true,
      }),
    );
  }
  return DecorationSet.create(doc, out);
}

// Puts the cursor at the end of footnote `index` (0-based), opening it for editing.
function goToNote(view, index) {
  const note = currentNumbering(view.state).footnotes[index];
  if (!note) return;
  const end = note.pos + view.state.doc.nodeAt(note.pos).nodeSize - 1;
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.create(view.state.doc, end))
      .scrollIntoView(),
  );
  view.focus();
}

// The generated notes list (endnotes): read-only, never saved; a click opens that note.
function notesList(view, notes) {
  const serializer = DOMSerializer.fromSchema(schema);
  const section = document.createElement("section");
  section.className = "tx-notes";
  section.contentEditable = "false";
  section.setAttribute("aria-label", "Notes");
  const title = section.appendChild(document.createElement("p"));
  title.className = "tx-notes-title";
  title.textContent = "Notes";
  const list = section.appendChild(document.createElement("ol"));
  notes.forEach((content, i) => {
    const item = list.appendChild(document.createElement("li"));
    item.appendChild(serializer.serializeFragment(content));
    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
      goToNote(view, i);
    });
  });
  return section;
}

// The footnote holding the selection: {pos, end}, or null.
function openNote(state) {
  const { $from, $to } = state.selection;
  for (let d = $from.depth; d > 0; d--)
    if ($from.node(d).type === N.footnote) {
      const pos = $from.before(d);
      const end = pos + $from.node(d).nodeSize;
      return $to.pos <= end ? { pos, end } : null;
    }
  return null;
}

// format(): the brand theme's heading format, read when the plugin starts.
export function generatedContent({ format = DEFAULT_HEADING_FORMAT } = {}) {
  const options = { format };
  return new Plugin({
    key: generatedKey,
    options,
    state: {
      init: (_config, state) => {
        const result = numbering(state.doc, options);
        return { result, decorations: decorations(state.doc, result) };
      },
      apply(tr, value) {
        if (!tr.docChanged) return value;
        if (textOnly(tr))
          return {
            result: null,
            decorations: value.decorations.map(tr.mapping, tr.doc),
          };
        const result = numbering(tr.doc, options);
        return { result, decorations: decorations(tr.doc, result) };
      },
    },
    props: {
      // The footnote holding the cursor is open: its text shows for editing.
      decorations(state) {
        const set = generatedKey.getState(state).decorations;
        const open = openNote(state);
        return open
          ? set.add(state.doc, [
              // An empty note is an inline block, so the caret stays inside it.
              Decoration.node(open.pos, open.end, {
                class: open.end - open.pos > 2 ? "tx-open" : "tx-open tx-empty",
              }),
            ])
          : set;
      },
      // A click on a closed footnote reference opens it, with the cursor at its end.
      handleClick(view, _pos, event) {
        const el = event.target.closest?.(".footnote[data-tx-note]");
        if (!el || el.classList.contains("tx-open")) return false;
        goToNote(view, Number(el.dataset.txNote) - 1);
        return true;
      },
      // Right after a note, browsers type into the note's last text: typing goes after it.
      handleDOMEvents: {
        beforeinput(view, event) {
          const { selection } = view.state;
          if (
            event.inputType !== "insertText" ||
            !event.data ||
            !selection.empty ||
            selection.$from.nodeBefore?.type !== N.footnote
          )
            return false;
          event.preventDefault();
          view.dispatch(view.state.tr.insertText(event.data).scrollIntoView());
          return true;
        },
      },
      // Escape leaves an open footnote, after its reference.
      handleKeyDown(view, event) {
        if (event.key !== "Escape") return false;
        const open = openNote(view.state);
        if (!open) return false;
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(view.state.doc, open.end),
          ),
        );
        return true;
      },
    },
    // ProseMirror may put the browser's caret after the text before an empty note, where
    // typing would land outside it: the caret goes into the note's element.
    view: () => ({
      update(view) {
        const open = openNote(view.state);
        if (!open || open.end - open.pos > 2 || !view.hasFocus()) return;
        const el = view.nodeDOM(open.pos);
        const dom = view.dom.ownerDocument.getSelection();
        if (el && dom && !el.contains(dom.anchorNode)) dom.collapse(el, 0);
      },
    }),
    // Labels and contents follow every edit that changes structure, in the same undo step.
    appendTransaction(transactions, _old, state) {
      if (!transactions.some((tr) => tr.docChanged && !textOnly(tr)))
        return null;
      const tr = state.tr;
      const known = generatedKey.getState(state).result;
      return regenerate(tr, options, known)
        ? tr.setMeta("generated", true)
        : null;
    },
  });
}

// The current numbering (computed again when the last edit only mapped it).
export function currentNumbering(state) {
  const plugin = generatedKey.get(state);
  return (
    generatedKey.getState(state)?.result ??
    numbering(state.doc, plugin?.spec.options)
  );
}

// ---------- commands ----------
// A footnote at the end of the selection, with the cursor in it (not inside code or a note).
export function insertFootnote(state, dispatch) {
  const { $to } = state.selection;
  const parent = $to.parent;
  if (!parent.inlineContent) return false;
  const index = $to.index();
  if (!parent.canReplaceWith(index, index, N.footnote)) return false;
  if (dispatch) {
    // Not inside a link: HTML cannot nest <a> (the guard would unlink it anyway).
    const marks = $to.marks().filter((m) => m.type !== schema.marks.link);
    const tr = state.tr.insert($to.pos, N.footnote.create(null, null, marks));
    dispatch(
      tr
        .setSelection(TextSelection.create(tr.doc, $to.pos + 1))
        .scrollIntoView(),
    );
  }
  return true;
}

// Heading numbers on or off.
export const setHeadingNumbers = (on) => (state, dispatch) => {
  if (state.doc.attrs.headingNumbers === on) return false;
  dispatch?.(state.tr.setDocAttribute("headingNumbers", on));
  return true;
};
// A heading format, stored only when it differs from the theme's ("document" removes it).
export const setHeadingFormat = (value, theme) => (state, dispatch) => {
  const next = value === "document" || value === theme ? null : value;
  if (next !== null && !HEADING_FORMAT.test(next)) return false;
  if (state.doc.attrs.headingFormat === next) return false;
  dispatch?.(state.tr.setDocAttribute("headingFormat", next));
  return true;
};

// Where a new top-level block goes: after the block holding the selection, before comments.
function blockEnd(state) {
  const { $from, to } = state.selection;
  const doc = state.doc;
  let at = $from.depth ? $from.after(1) : to;
  if (doc.lastChild.type === N.comments)
    at = Math.min(at, doc.content.size - doc.lastChild.nodeSize);
  return at;
}
// A contents block (two levels), generated at once.
export function insertContents(state, dispatch) {
  if (dispatch) {
    const at = blockEnd(state);
    const tr = state.tr.insert(at, N.toc.create({ depth: 2 }));
    dispatch(
      tr.setSelection(NodeSelection.create(tr.doc, at)).scrollIntoView(),
    );
  }
  return true;
}
// The selected contents block, if any.
export const selectedContents = (state) =>
  state.selection instanceof NodeSelection &&
  state.selection.node.type === N.toc
    ? state.selection
    : null;
export const setContentsDepth = (depth) => (state, dispatch) => {
  const selection = selectedContents(state);
  if (!selection || ![1, 2, 3, 4].includes(depth)) return false;
  if (selection.node.attrs.depth === depth) return false;
  if (dispatch) {
    const tr = state.tr.setNodeAttribute(selection.from, "depth", depth);
    dispatch(tr.setSelection(NodeSelection.create(tr.doc, selection.from)));
  }
  return true;
};

// Headings and figures a cross-reference can point to, in document order:
// [{id, kind ("heading" | "figure" | "table"), level, label, text}].
export function referenceTargets(state) {
  const result = currentNumbering(state);
  const caption = (figure) =>
    [figure.firstChild, figure.lastChild].find((c) => c?.type === N.caption);
  return [
    ...result.headings.map((h) => ({ ...h, kind: "heading" })),
    ...result.figures.map((f) => ({
      ...f,
      text: caption(state.doc.nodeAt(f.pos))?.textContent.trim() ?? "",
    })),
  ]
    .sort((a, b) => a.pos - b.pos)
    .map(({ id, kind, level, text }) => ({
      id,
      kind,
      level,
      label: result.labels.get(id),
      text,
    }));
}
// A cross-reference at the cursor (replacing the selection), labelled from its target.
export const insertXref = (target) => (state, dispatch) => {
  const { $from, $to } = state.selection;
  const parent = $from.parent;
  // In any inline content that takes one (a footnote too), never in code.
  if (
    !parent.inlineContent ||
    !$from.sameParent($to) ||
    !parent.canReplaceWith($from.index(), $to.indexAfter(), N.xref) ||
    (target !== null && !currentNumbering(state).labels.has(target))
  )
    return false;
  if (dispatch && target) {
    const label = currentNumbering(state).labels.get(target);
    // Not inside a link: HTML cannot nest <a> (the guard would unlink it anyway).
    const marks = ($from.marks() ?? []).filter(
      (m) => m.type !== schema.marks.link,
    );
    dispatch(
      state.tr
        .replaceSelectionWith(
          N.xref.create({ target, label }, null, marks),
          false,
        )
        .scrollIntoView(),
    );
  }
  return true;
};
