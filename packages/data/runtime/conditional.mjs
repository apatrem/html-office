import { colorCSS, fillCSS, DARK_FILLS } from "../model/formatting.mjs";
import {
  compileConditionalFormats,
  conditionalPresentation,
} from "../model/conditional.mjs";
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
      // Tokens render like html-slides c-* / bg-* (white text on dark fills).
      if (highlight.fill) {
        element.style.backgroundColor = fillCSS(highlight.fill);
        if (!highlight.color && DARK_FILLS.includes(highlight.fill))
          element.style.color = colorCSS("bg");
      }
      if (highlight.color) element.style.color = colorCSS(highlight.color);
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
        backgroundColor: colorCSS(bar.color),
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
