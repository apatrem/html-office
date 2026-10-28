// Images in the editor (T12): picking and shrinking files, the image view and the image dialog.
// Assets follow the Slides contract (script#assets, base64, WebP where the browser can encode
// it, at most 1,600 px wide); model/assets.mjs keeps them and writes the used ones on save.
import { Plugin, NodeSelection } from "prosemirror-state";
import { h } from "../../shared/shell/dom.mjs";
import { modal, field } from "../../shared/shell/dialogs.mjs";
import { imageProblem } from "../editor/images.mjs";
import { fontCSS } from "../model/assets.mjs";
import { WRAP_WIDTHS } from "../model/format.mjs";

// An SVG as an image may only draw itself: parsed inert (DOMParser runs nothing), it keeps SVG
// elements, references inside itself (#id) and its own styles; scripts, foreign content, event
// handlers, entity declarations and anything it would load or embed (an image, a font, a
// stylesheet, even a data: one, whose size no limit has checked) are removed. Returns the SVG
// text, or null when it is not one.
const SVG = "http://www.w3.org/2000/svg";
const OUTSIDE = /url\(\s*['"]?\s*(?!#)|@import/i;
export function cleanSVG(text) {
  if (/<!ENTITY/i.test(text)) return null;
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (
    root?.namespaceURI !== SVG ||
    root.localName !== "svg" ||
    doc.getElementsByTagName("parsererror").length
  )
    return null;
  for (const el of [root, ...root.querySelectorAll("*")]) {
    if (!el.isConnected) continue;
    if (
      el.namespaceURI !== SVG ||
      ["script", "foreignObject"].includes(el.localName) ||
      (el.localName === "style" && OUTSIDE.test(el.textContent))
    ) {
      el.remove();
      continue;
    }
    for (const { name, value } of [...el.attributes]) {
      const link = name === "href" || name.endsWith(":href");
      if (link && !value.trim().startsWith("#")) {
        // An image, filter image or use of something outside goes whole; a link loses its address.
        if (["image", "feImage", "use"].includes(el.localName)) {
          el.remove();
          break;
        }
        el.removeAttribute(name);
      } else if (/^on/i.test(name) || OUTSIDE.test(value))
        el.removeAttribute(name);
    }
  }
  return new XMLSerializer().serializeToString(root);
}

// A picked image file reduced to at most 1,600 px wide, WebP when the browser encodes it, else
// JPEG for a JPEG and PNG for the rest (PNG keeps transparency). GIF (which may be animated) is
// kept as it is, SVG as cleanSVG leaves it. Returns {type, data (base64)}.
export async function shrinkImage(file) {
  const base64 = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  if (file.type === "image/gif")
    return { type: file.type, data: await base64(file) };
  if (file.type === "image/svg+xml") {
    const svg = cleanSVG(await file.text());
    if (svg === null) throw new Error("not an SVG image");
    return { type: file.type, data: await base64(new Blob([svg])) };
  }
  const bitmap = await createImageBitmap(file);
  const k = Math.min(1, 1600 / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * k));
  canvas.height = Math.max(1, Math.round(bitmap.height * k));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const encode = (type, quality) =>
    new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  let blob = await encode("image/webp", 0.82);
  // Safari encodes no WebP: it returns a PNG instead.
  if (!blob || blob.type !== "image/webp")
    blob =
      file.type === "image/jpeg"
        ? await encode("image/jpeg", 0.85)
        : await encode("image/png");
  return { type: blob.type, data: await base64(blob) };
}

// The editing view of an image figure: the picture (not editable) and its caption.
function imageView(store, edit) {
  return (node, view, getPos) => {
    const dom = document.createElement("figure");
    const frame = dom.appendChild(document.createElement("div"));
    frame.className = "tx-image";
    frame.contentEditable = "false";
    const img = frame.appendChild(document.createElement("img"));
    // A click on the picture selects the figure (Backspace deletes it, Alt+Shift+↑/↓ moves it);
    // a double click opens its settings.
    const select = () => {
      const pos = getPos();
      if (pos === undefined) return false;
      view.dispatch(
        view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)),
      );
      view.focus();
      return true;
    };
    frame.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      select();
    });
    frame.addEventListener("dblclick", (event) => {
      event.preventDefault();
      if (select()) edit();
    });
    const contentDOM = dom.appendChild(document.createElement("div"));
    dom.className = "image";
    const render = (n) => {
      dom.id = n.attrs.id;
      dom.dataset.width = n.attrs.width;
      if (n.attrs.wrap) dom.dataset.wrap = n.attrs.wrap;
      else delete dom.dataset.wrap;
      img.dataset.asset = n.attrs.asset;
      img.alt = n.attrs.alt;
      const url = store.url(n.attrs.asset);
      if (url && img.getAttribute("src") !== url) img.src = url;
    };
    render(node);
    return {
      dom,
      contentDOM,
      update(next) {
        if (next.type !== node.type) return false;
        node = next;
        render(next);
        return true;
      },
      ignoreMutation: (m) =>
        m.type !== "selection" && !contentDOM.contains(m.target),
    };
  };
}

// Every picture of the document from the store: figures and images inside protected blocks,
// which are drawn from their saved tree (the src is never part of the document).
// Each element is resolved once per asset and store version, so a selection change costs no
// picture data.
const resolved = new WeakMap();
function resolveImages(root, store) {
  for (const img of root.querySelectorAll("img[data-asset]")) {
    const key = `${store.version}:${img.dataset.asset}`;
    if (resolved.get(img) === key) continue;
    resolved.set(img, key);
    const url = store.url(img.dataset.asset);
    if (url && img.getAttribute("src") !== url) img.src = url;
  }
}

// Draws image figures from the store and installs its fonts; a double click on a picture opens
// its settings. A restored draft brings other assets: every picture and font follows.
export const imagePlugin = (store, edit) =>
  new Plugin({
    view(view) {
      const style = document.createElement("style");
      document.head.append(style);
      let version = -1;
      const sync = () => {
        if (version !== store.version) {
          version = store.version;
          style.textContent = fontCSS(store);
        }
        resolveImages(view.dom, store);
      };
      sync();
      return { update: sync, destroy: () => style.remove() };
    },
    props: { nodeViews: { image_figure: imageView(store, edit) } },
  });

const LAYOUTS = [
  ["text", "Text width"],
  ["full", "Full width"],
  ["left", "Wrap left"],
  ["right", "Wrap right"],
];

// The image dialog: alt text (required), layout and width; for an image already in the
// document, Replace picks another file. initial: {alt, width, wrap} or null for a new image.
// onSave({alt, width, wrap}) applies; onReplace() picks a file; done() runs when it closes
// without either (it puts the selection back).
export function imageDialog({ initial, preview, onSave, onReplace, done }) {
  const alt = h("textarea", {
    rows: "2",
    placeholder: "What the image shows, for readers who cannot see it",
  });
  alt.value = initial?.alt ?? "";
  const layout = h(
    "select",
    {},
    LAYOUTS.map(([value, label]) => h("option", { value }, label)),
  );
  layout.value = initial?.wrap ?? initial?.width ?? "text";
  const width = h(
    "select",
    {},
    WRAP_WIDTHS.map((w) =>
      h("option", { value: w }, `${w}% of the text width`),
    ),
  );
  width.value = initial?.wrap ? initial.width : "33";
  const widthField = field("Width", width);
  const error = h("p", { class: "sh-err", role: "status" });
  const attrs = () => {
    const wrap = ["left", "right"].includes(layout.value) ? layout.value : null;
    return {
      alt: alt.value.trim(),
      wrap,
      width: wrap ? width.value : layout.value,
    };
  };
  const save = h(
    "button",
    { type: "button", class: "sh-b sh-t sh-primary" },
    initial ? "Apply" : "Insert",
  );
  const sync = () => {
    widthField.hidden = !attrs().wrap;
    const problem = imageProblem(attrs());
    save.disabled = !!problem;
    error.textContent = alt.value.trim() ? problem : "";
  };
  alt.addEventListener("input", sync);
  layout.addEventListener("change", sync);
  width.addEventListener("change", sync);
  let result = null;
  const dialog = modal(
    initial ? "Image" : "Insert image",
    [
      preview
        ? h("img", { class: "tx-image-preview", src: preview, alt: "" })
        : null,
      field("Alt text (required)", alt),
      h("div", { class: "sh-two" }, field("Layout", layout), widthField),
      h(
        "p",
        { class: "sh-hint" },
        "A wrapped image floats beside the paragraphs after it and moves with the next one (Alt+Shift+↑/↓).",
      ),
      error,
    ],
    [
      onReplace
        ? h(
            "button",
            {
              type: "button",
              class: "sh-b sh-t sh-ghost",
              onclick: () => {
                result = "replace";
                dialog.close();
              },
            },
            "Replace image…",
          )
        : null,
      h("span", { class: "sh-spacer" }),
      h(
        "button",
        {
          type: "button",
          class: "sh-b sh-t sh-ghost",
          onclick: () => dialog.close(),
        },
        "Cancel",
      ),
      save,
    ],
    {
      onClose: () => {
        if (result === "save") onSave(attrs());
        else if (result === "replace") onReplace();
        else done();
      },
      opener: { isConnected: false },
    },
  );
  save.addEventListener("click", () => {
    if (save.disabled) return;
    result = "save";
    dialog.close();
  });
  sync();
  alt.focus();
}

// A file the browser cannot decode as an image.
export function imageError(name) {
  const dialog = modal(
    "Image not inserted",
    h(
      "p",
      {},
      `“${name}” could not be read as an image (PNG, JPEG, WebP, GIF or SVG).`,
    ),
    [
      h("span", { class: "sh-spacer" }),
      h(
        "button",
        {
          type: "button",
          class: "sh-b sh-t sh-primary",
          onclick: () => dialog.close(),
        },
        "OK",
      ),
    ],
  );
}

// Asks for an image file; resolves to the File, or null when cancelled.
export function pickImage() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
    input.addEventListener("change", () => resolve(input.files[0] ?? null));
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}
