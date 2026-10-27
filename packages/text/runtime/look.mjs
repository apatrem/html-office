// Brand theme, font, page format and margins of the document (T04): attributes of article#doc,
// changed as undoable steps. The theme and font are mirrored on <html>, where the shared overlays
// apply, as Slides does with main#deck; the mirror is runtime state and never saved.
import { charteCSS } from "../../shared/themes/chartes.mjs";
import { FONTS as FONT_STACKS } from "../../shared/themes/fonts.mjs";
import { THEMES, FONTS, PAGES, MARGINS } from "../model/format.mjs";

// Built-in chartes recolour; a chosen font changes the body only (style#theme reads --body-font).
export const LOOK_CSS =
  charteCSS() +
  FONT_STACKS.map(
    ([id, , stack]) => `:root[data-font="${id}"]{--body-font:${stack}}`,
  ).join("");

const LOOK = {
  theme: ["data-theme", THEMES],
  font: ["data-font", FONTS],
  page: ["data-page", PAGES],
  margins: ["data-margins", MARGINS],
};

// The look attributes of article#doc in the editing view (the saved article comes from the serialiser).
export const lookAttributes = (doc) =>
  Object.fromEntries(
    Object.entries(LOOK)
      .filter(([key]) => doc.attrs[key] !== null)
      .map(([key, [name]]) => [name, doc.attrs[key]]),
  );

export function mirrorLook(doc) {
  const root = document.documentElement.dataset;
  for (const key of ["theme", "font"])
    if (doc.attrs[key]) root[key] = doc.attrs[key];
    else delete root[key];
}

// Sets one look attribute; "document" (the document's own charte, font or layout) removes it.
export const setLook = (key, value) => (state, dispatch) => {
  const next = value === "document" ? null : value;
  if (next !== null && !LOOK[key][1].includes(next)) return false;
  if (state.doc.attrs[key] === next) return false;
  dispatch?.(state.tr.setDocAttribute(key, next));
  return true;
};
