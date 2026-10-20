import {
  compileConditionalFormats,
  conditionalPresentation,
} from "../model/conditional.mjs";
export function createConditionalDecorator(getBook, isSnapshotCurrent) {
  let definitions, compiled;
  return (element, sheetId, ref, cell) => {
    const book = getBook();
    if (!book.conditionalFormats?.length) return;
    if (definitions !== book.conditionalFormats) {
      definitions = book.conditionalFormats;
      compiled = compileConditionalFormats(book);
    }
    if (cell.formula && !isSnapshotCurrent()) {
      element.setAttribute(
        "aria-description",
        "Saved result is unverified or stale; conditional formatting unavailable.",
      );
      return;
    }
    const { highlight } = conditionalPresentation(compiled, sheetId, ref, cell);
    if (!highlight) return;
    if (highlight.background)
      element.style.backgroundColor = highlight.background;
    if (highlight.color) element.style.color = highlight.color;
    if (highlight.bold !== undefined)
      element.style.fontWeight = highlight.bold ? "bold" : "normal";
    element.setAttribute("aria-description", "Conditional highlight");
  };
}
