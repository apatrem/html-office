// Print and print preview (T14). The browser prints the page: style#theme sets the page size,
// margins and breaks, and this module adds what the editing view lacks: the running header in the
// top margin (@page; style.css numbers the pages), a print-only copy of each table's header rows
// (the editing view keeps them in the tbody, so a table crossing pages would not repeat them) and
// the read-only preview. The preview lays the document out in columns one page high, so the
// browser fragments it as it fragments printed pages, and draws a page behind each column.
import { Plugin } from "prosemirror-state";
import { DOMSerializer } from "prosemirror-model";
import { h, button } from "../../shared/shell/dom.mjs";
import { headerCSS } from "./look.mjs";

// The table as its schema draws it, with a thead before the tbody holding a copy of the header
// rows, refreshed once the rows are drawn. The editor never reads the copy.
class TableView {
  constructor(node) {
    this.node = node;
    ({ dom: this.dom, contentDOM: this.contentDOM } = DOMSerializer.renderSpec(
      document,
      node.type.spec.toDOM(node),
    ));
    this.head = this.dom.insertBefore(
      h("thead", { class: "tx-print-head" }),
      this.contentDOM,
    );
    this.sync();
  }
  update(node) {
    if (!node.sameMarkup(this.node)) return false;
    this.node = node;
    this.sync();
    return true;
  }
  sync() {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      this.head.replaceChildren(
        ...[...this.contentDOM.children]
          .filter((tr) => tr.classList.contains("tx-head"))
          .map((tr) => tr.cloneNode(true)),
      );
    });
  }
  ignoreMutation(m) {
    return m.type !== "selection" && !this.contentDOM.contains(m.target);
  }
}

export const printPlugin = () =>
  new Plugin({
    view(view) {
      const style = document.head.appendChild(h("style"));
      let header;
      const update = (view) => {
        if (view.state.doc.attrs.header === header) return;
        header = view.state.doc.attrs.header;
        style.textContent = headerCSS(header);
      };
      update(view);
      return { update, destroy: () => style.remove() };
    },
    props: { nodeViews: { table: (node) => new TableView(node) } },
  });

// The document's print rules (@media print), applied to the preview on screen; the chrome's own
// (.sh-…) and the preview's (.tx-sheets) are left out, since the preview shows them.
function printRules() {
  let css = "";
  const add = (rules, print) => {
    for (const rule of rules)
      if (rule instanceof CSSMediaRule)
        add(rule.cssRules, print || rule.media.mediaText.includes("print"));
      else if (print && !/\.sh-|\.tx-sheets/.test(rule.selectorText ?? ""))
        css += rule.cssText;
  };
  for (const sheet of document.styleSheets)
    try {
      add(sheet.cssRules, false);
    } catch {
      // A sheet the page cannot read has no rules for the document.
    }
  return `@media screen{:root.tx-preview{${css}}}`;
}

// Columns do not repeat table headers as pages do. Where a table continues on a later page, its
// first row there is pushed down by the header's height (a rule of the preview only) and the
// header drawn over the space; page by page, since each push moves what follows.
function repeatHeads(doc, left, stride, style) {
  const page = (el) =>
    Math.floor((el.getClientRects()[0].left - left + 1) / stride);
  const pushed = [];
  let css = "";
  style.textContent = "";
  for (;;) {
    let found = null;
    for (const thead of doc.querySelectorAll("thead.tx-print-head")) {
      const height = thead.getBoundingClientRect().height;
      if (!height) continue;
      const tbody = thead.nextElementSibling;
      let at = page(thead);
      for (const tr of tbody.children) {
        if (!tr.getClientRects().length) continue;
        const now = page(tr);
        if (now > at && !pushed.some((p) => p.tr === tr)) {
          found = { thead, tbody, tr, height, at: now };
          break;
        }
        at = now;
      }
      if (found) break;
    }
    if (!found) return pushed;
    pushed.push(found);
    const cell = found.tr.firstElementChild;
    if (!cell) continue;
    const id = found.tbody.closest("figure").id;
    const k = [...found.tbody.children].indexOf(found.tr) + 1;
    css += `#${id} tbody>tr:nth-child(${k})>*{padding-top:${parseFloat(getComputedStyle(cell).paddingTop) + found.height}px}`;
    style.textContent = `@media screen{${css}}`;
  }
}

// A copy of a table's header at (x, y): its cells where they are drawn on the first page. Outside
// #doc the editor's styles do not apply: a footnote shows as its number, a comment's mark goes.
function headCopy({ thead }, x, y) {
  const box = thead.getBoundingClientRect();
  return h(
    "table",
    {
      class: `${thead.parentElement.className} tx-repeat`,
      style: `left:${x}px;top:${y}px;width:${box.width}px;height:${box.height}px`,
    },
    h(
      "thead",
      {},
      [...thead.querySelectorAll("th")].map((th) => {
        const r = th.getBoundingClientRect();
        const copy = th.cloneNode(true);
        for (const note of copy.querySelectorAll(".footnote"))
          note.replaceWith(h("sup", {}, note.dataset.txNote ?? ""));
        for (const mark of copy.querySelectorAll("mark.comment"))
          mark.replaceWith(...mark.childNodes);
        copy.style.cssText = `left:${r.left - box.left}px;top:${r.top - box.top}px;width:${r.width}px;height:${r.height}px`;
        return copy;
      }),
    ),
  );
}

// The read-only print preview: print() prints, close() returns to editing (Escape too).
export function printPreview(view, print) {
  const root = document.documentElement;
  const count = h("span", { class: "tx-preview-count", role: "status" });
  let open = null;
  function layout() {
    if (!open) return;
    const doc = view.dom;
    const box = doc.getBoundingClientRect();
    const margin = parseFloat(getComputedStyle(doc).paddingTop);
    const gap = parseFloat(getComputedStyle(doc).columnGap) - 2 * margin;
    const stride = box.width + gap;
    const pushed = repeatHeads(doc, box.left, stride, open.repeat);
    // Each copy at the top of its page's text, where print repeats the header.
    open.heads.replaceChildren(
      ...pushed.map((p) => {
        const from = p.thead.getBoundingClientRect();
        const first = Math.floor((from.left - box.left + 1) / stride);
        return headCopy(
          p,
          from.left + (p.at - first) * stride + scrollX,
          box.top + margin + scrollY,
        );
      }),
    );
    const range = document.createRange();
    range.selectNodeContents(doc);
    const right = range.getBoundingClientRect().right;
    const pages = Math.max(1, Math.floor((right - box.left - 1) / stride) + 1);
    const header = view.state.doc.attrs.header ?? "";
    const band = (cls, text) =>
      h("div", { class: cls, style: `height:${margin}px` }, text);
    open.layer.replaceChildren(
      ...Array.from({ length: pages }, (_, i) =>
        h(
          "div",
          {
            class: "tx-page",
            style: `left:${box.left + scrollX + i * stride}px;top:${box.top + scrollY}px;width:${box.width}px;height:${box.height}px`,
          },
          band("tx-page-head", header),
          band("tx-page-foot", `${i + 1} / ${pages}`),
        ),
      ),
    );
    count.textContent = `${pages} page${pages > 1 ? "s" : ""}`;
    open.pages = pages;
  }
  function keys(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (
      event.key === "Backspace" ||
      ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() !== "p")
    ) {
      // Nothing edits the document while it is previewed (undo, paste, save shortcuts), and
      // Backspace never leaves the page (WebKit goes back with it).
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }
  function show() {
    if (open) return;
    const close_ = button({
      label: "Close preview",
      text: "Close preview",
      title: "Back to editing (Esc)",
      onClick: () => close(),
    });
    open = {
      style: document.head.appendChild(h("style", {}, printRules())),
      repeat: document.head.appendChild(h("style")),
      heads: document.body.appendChild(
        h("div", { class: "tx-sheets tx-heads", "aria-hidden": "true" }),
      ),
      layer: document.body.appendChild(
        h("div", { class: "tx-sheets", "aria-hidden": "true" }),
      ),
      bar: document.body.appendChild(
        h(
          "div",
          {
            class: "sh-root tx-preview-bar",
            role: "region",
            "aria-label": "Print preview",
          },
          h("strong", {}, "Print preview"),
          count,
          h("span", { class: "sh-spacer" }),
          button({
            label: "Print / PDF",
            text: "Print / PDF",
            cls: "sh-primary",
            onClick: () => print(),
          }),
          close_,
        ),
      ),
    };
    root.classList.add("tx-preview");
    // inert: no caret, no selection, no input while the document is shown as pages.
    view.dom.inert = true;
    addEventListener("keydown", keys, true);
    scrollTo(0, 0);
    layout();
    document.fonts?.ready.then(layout);
    close_.focus();
  }
  function close() {
    if (!open) return;
    removeEventListener("keydown", keys, true);
    for (const el of [
      open.style,
      open.repeat,
      open.layer,
      open.heads,
      open.bar,
    ])
      el.remove();
    open = null;
    root.classList.remove("tx-preview");
    view.dom.inert = false;
    view.focus();
    view.dispatch(view.state.tr.scrollIntoView());
  }
  return {
    show,
    close,
    // Redrawn after any change while it is open (a chart drawn, a paste, a draft restored), once
    // the tables have copied their header rows.
    update: () => open && queueMicrotask(layout),
    get pages() {
      return open?.pages ?? null;
    },
  };
}
