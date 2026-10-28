// Image figures (T12): insert, change and move them as ProseMirror commands. An image is stored
// once in script#assets (the Slides asset contract) and referenced by data-asset; alt text is
// required. A wrapped image floats beside the blocks after it: it is anchored to the next block,
// and moving that block (moveBlock) moves its anchored images with it.
import { NodeSelection, TextSelection } from "prosemirror-state";
import { schema } from "./schema/schema.mjs";
import { usedIds } from "./commands.mjs";
import { IMAGE_WIDTHS, WRAP_WIDTHS, WRAPS } from "../model/format.mjs";

const N = schema.nodes;

// The selected image figure, or the one whose caption holds the cursor: {pos, node}.
export function imageAt(state) {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type === N.image_figure)
    return { pos: sel.from, node: sel.node };
  const { $from } = sel;
  for (let d = $from.depth; d > 0; d--)
    if ($from.node(d).type === N.image_figure)
      return { pos: $from.before(d), node: $from.node(d) };
  return null;
}

// Whether attributes describe a valid image figure (FORMAT.md › Image).
export function imageProblem({ alt, width, wrap }) {
  if (!String(alt ?? "").trim()) return "Describe the image (alt text).";
  if (wrap === null || wrap === undefined)
    return IMAGE_WIDTHS.includes(width) ? "" : "Choose text or full width.";
  if (!WRAPS.includes(wrap)) return "Wrap left or right.";
  return WRAP_WIDTHS.includes(width)
    ? ""
    : "Choose a width for a wrapped image.";
}

// A figure ID from the alt text, unique in the file: fig-raised-beds, fig-raised-beds-2.
export function figureId(alt, taken) {
  const slug = alt
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 32)
    .replace(/^-+|-+$/g, "");
  const base = `fig-${slug || "image"}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

// Where a new figure goes: a wrapped one before the top-level block holding the selection (or
// `$from`, a drop position) (it anchors to it), any other after it; never before the cover nor
// after the comments.
export function figurePosition(state, wrapped, $from = state.selection.$from) {
  const doc = state.doc;
  const index = Math.min($from.index(0), doc.childCount - 1);
  const block = doc.child(index);
  let start = 0;
  for (let i = 0; i < index && i < doc.childCount; i++)
    start += doc.child(i).nodeSize;
  if (block.type === N.comments) return start;
  if (block.type === N.cover || !wrapped) return start + block.nodeSize;
  return start;
}

// attrs: {asset, alt, width, wrap}; the new figure is selected.
export const insertImage = (attrs) => (state, dispatch) => {
  const { asset, alt, width = "text", wrap = null } = attrs;
  if (!asset || imageProblem({ alt, width, wrap })) return false;
  if (dispatch) {
    const at = figurePosition(state, !!wrap);
    const id = figureId(alt, usedIds(state.doc));
    const tr = state.tr.insert(
      at,
      N.image_figure.create({ id, width, wrap, asset, alt: alt.trim() }),
    );
    dispatch(
      tr.setSelection(NodeSelection.create(tr.doc, at)).scrollIntoView(),
    );
  }
  return true;
};

// The image figure with an ID: {pos, node}, or null once it is gone.
export function imageById(state, id) {
  let found = null;
  state.doc.forEach((node, pos) => {
    if (node.type === N.image_figure && node.attrs.id === id)
      found = { pos, node };
  });
  return found;
}

// Changes an image figure: the one with ID `id`, or the one at the selection; any of {asset, alt,
// width, wrap}. A dialog names its figure by ID, so an edit made meanwhile never retargets it.
export const setImage =
  (changes, id = null) =>
  (state, dispatch) => {
    const found = id === null ? imageAt(state) : imageById(state, id);
    if (!found) return false;
    const next = { ...found.node.attrs, ...changes };
    next.alt = String(next.alt ?? "").trim();
    if (!next.asset || imageProblem(next)) return false;
    const same = Object.keys(next).every(
      (k) => next[k] === found.node.attrs[k],
    );
    if (same) return false;
    if (dispatch) {
      const tr = state.tr.setNodeMarkup(found.pos, null, next);
      tr.setSelection(NodeSelection.create(tr.doc, found.pos));
      dispatch(tr);
    }
    return true;
  };

// ---------- moving blocks with their anchored images ----------
const fixed = (node) => node.type === N.cover || node.type === N.comments;
const wrapped = (node) => node.type === N.image_figure && node.attrs.wrap;

// The top-level blocks as units: a block with the wrapped images just before it. [{from, to, fixed}]
function units(doc) {
  const out = [];
  let pending = null,
    pos = 0;
  doc.forEach((node) => {
    const end = pos + node.nodeSize;
    if (wrapped(node)) pending ??= pos;
    else {
      out.push({ from: pending ?? pos, to: end, fixed: fixed(node) });
      pending = null;
    }
    pos = end;
  });
  if (pending !== null) out.push({ from: pending, to: pos, fixed: false });
  return out;
}

// Moves the block holding the selection (with its anchored images) above the previous block
// (dir -1) or below the next one (dir 1). The cover and the comments do not move.
export const moveBlock = (dir) => (state, dispatch) => {
  const { from, to } = state.selection;
  const list = units(state.doc);
  const i = list.findIndex((u) => from >= u.from && from < u.to);
  if (i < 0 || to > list[i].to) return false;
  const j = i + dir;
  if (list[i].fixed || !list[j] || list[j].fixed) return false;
  if (dispatch) {
    const [a, b] = dir < 0 ? [list[j], list[i]] : [list[i], list[j]];
    const first = state.doc.slice(a.from, a.to).content;
    const second = state.doc.slice(b.from, b.to).content;
    const tr = state.tr.replaceWith(a.from, b.to, second.append(first));
    // The selection keeps its place in the moved block.
    const shift = dir < 0 ? -(a.to - a.from) : b.to - b.from;
    const sel = state.selection;
    tr.setSelection(
      sel instanceof NodeSelection
        ? NodeSelection.create(tr.doc, sel.from + shift)
        : TextSelection.create(tr.doc, sel.anchor + shift, sel.head + shift),
    );
    dispatch(tr.scrollIntoView());
  }
  return true;
};

// Asset keys the document uses: image figures, and img[data-asset] inside protected blocks.
export function usedAssets(doc) {
  const keys = new Set();
  const tree = (node) => {
    if (node.type !== "element") return;
    const asset =
      node.name === "img" && node.attrs.find(([n]) => n === "data-asset");
    if (asset) keys.add(asset[1]);
    node.children.forEach(tree);
  };
  doc.descendants((node) => {
    if (node.type === N.image_figure) keys.add(node.attrs.asset);
    else if (node.type === N.protected) tree(node.attrs.node);
    return node.isBlock && !node.isTextblock;
  });
  return keys;
}
