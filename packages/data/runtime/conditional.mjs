import {
  compileConditionalFormats,
  conditionalPresentation,
} from "../model/conditional.mjs";
import { tokenCss, DARK_FILLS } from "../model/formatting.mjs";
export function createConditionalDecorator(
  getBook,
  isSnapshotCurrent,
  getScales = () => ({}),
) {
  let definitions, compiled, fixed;
  return (element, sheetId, ref, cell) => {
    const book = getBook();
    if (!book.conditionalFormats?.length) return;
    if (definitions !== book.conditionalFormats) {
      definitions = book.conditionalFormats;
      compiled = compileConditionalFormats(book);
      fixed = Object.fromEntries(
        book.conditionalFormats
          .filter((r) => r.kind === "dataBar" && r.scale.kind === "fixed")
          .map((r) => [r.id, r.scale]),
      );
    }
    if (cell.formula && !isSnapshotCurrent()) {
      element.setAttribute(
        "aria-description",
        "Saved result is unverified or stale; conditional formatting unavailable.",
      );
      return;
    }
    const { highlight, bar, pendingBar } = conditionalPresentation(
      compiled,
      sheetId,
      ref,
      cell,
      { ...fixed, ...getScales() },
    );
    const descriptions = [];
    if (highlight) {
      // Charte tokens (ADR-012): a dark fill turns text white unless a colour is given.
      if (highlight.fill)
        element.style.backgroundColor = tokenCss(highlight.fill);
      if (highlight.color) element.style.color = tokenCss(highlight.color);
      else if (DARK_FILLS.includes(highlight.fill))
        element.style.color = tokenCss("bg");
      if (highlight.bold !== undefined)
        element.style.fontWeight = highlight.bold ? "bold" : "normal";
      if (highlight.italic !== undefined)
        element.style.fontStyle = highlight.italic ? "italic" : "normal";
      descriptions.push("Conditional highlight");
    }
    if (bar) {
      const fill = document.createElement("span"),
        axis = document.createElement("span"),
        text = document.createElement("span");
      fill.className = "data-bar-fill";
      axis.className = "data-bar-axis";
      text.className = "data-bar-text";
      fill.setAttribute("aria-hidden", "true");
      axis.setAttribute("aria-hidden", "true");
      Object.assign(fill.style, {
        left: `${bar.left}%`,
        width: `${bar.width}%`,
        backgroundColor: tokenCss(bar.color),
      });
      axis.style.left = `${bar.axis}%`;
      text.textContent = element.textContent;
      element.replaceChildren(fill, axis, text);
      descriptions.push(
        `Data bar: ${bar.negative ? "negative" : "nonnegative"}, ${bar.width.toFixed(1)}% of scale; zero axis ${bar.axis.toFixed(1)}%.`,
      );
    }
    if (pendingBar)
      descriptions.push("Automatic data bar unavailable or updating.");
    if (descriptions.length)
      element.setAttribute("aria-description", descriptions.join(". "));
  };
}
