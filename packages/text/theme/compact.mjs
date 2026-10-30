// A charte as Text documents embed it (T04): comments and spaces around punctuation removed.
// Node and the bundled document tools (T18) share it with theme/index.mjs.
export const compactCSS = (css) =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s*([{};:])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
