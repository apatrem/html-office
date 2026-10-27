// The default look of a Text document (T04), Node only: the html-slides default charte for
// style#charte (the brand contract shared with Slides and Data, TH01 "blue") and the Text layout
// theme for style#theme. The editor adds the built-in charte and font overlays at runtime.
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

export const LAYOUT_CSS = read("./layout.css").trim();
export const CHARTE_CSS = read("../../../src/theme/default.css")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\s*([{};:])\s*/g, "$1")
  .replace(/;}/g, "}")
  .trim();
