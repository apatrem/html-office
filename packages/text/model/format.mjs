// Vocabulary of the canonical Text subset (FORMAT.md), shared by the validator, the schema and the guide.
import { THEME_NAMES } from "../../shared/themes/chartes.mjs";

export const FORMAT_VERSION = "1";

// Stable IDs on headings, figures and comment threads: usable unescaped in href="#…" and CSS selectors.
export const ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
// IDs of the file's zones and the runtime; content never uses them.
export const RESERVED_IDS = new Set([
  "doc",
  "charte",
  "theme",
  "assets",
  "engine",
  "echarts",
  "html-text-guide",
  "shell-layer",
]);
export const RESERVED_ID_PREFIXES = ["sh-", "tx-"];

export const LANG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;
export const HEADING_FORMAT = /^[1AaIi](\.[1AaIi]){3}$/;
export const THEMES = Object.keys(THEME_NAMES);
// The ids of the shared font list (packages/shared/shell/panels.mjs FONTS).
export const FONTS = [
  "arial",
  "verdana",
  "tahoma",
  "trebuchet",
  "georgia",
  "times",
];
export const PAGES = ["a4", "letter"];
export const MARGINS = ["narrow", "normal", "wide"];

// Attributes of article#doc, in canonical order.
export const ARTICLE_ATTRIBUTES = [
  "id",
  "data-format",
  "lang",
  "data-heading-numbers",
  "data-heading-format",
  "data-theme",
  "data-font",
  "data-page",
  "data-margins",
];

export const ALIGN = ["ta-l", "ta-c", "ta-r", "ta-j"];
export const CELL_ALIGN = ["ta-l", "ta-c", "ta-r"];
export const HEADING_CLASSES = ["unnumbered", "new-page"];
export const CALLOUTS = ["note", "warning", "key"];
export const CHART_WIDTHS = ["text", "full"];
export const IMAGE_WIDTHS = ["text", "full"];
export const WRAP_WIDTHS = ["25", "33", "40", "50"];
export const WRAPS = ["left", "right"];
export const THREAD_STATUS = ["open", "resolved"];
export const COMMENT_DATE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?Z$/;
export const LINK_URL = /^(https?:\/\/|mailto:)\S/i;
// Inline marks without attributes, outermost first. mark.comment and links have attributes.
export const MARKS = ["strong", "em", "u", "mark", "sub", "sup", "code"];
// Elements a saved chart preview may contain (the ECharts SVG renderer's output).
export const PREVIEW_ELEMENTS = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "defs",
  "clipPath",
  "linearGradient",
  "radialGradient",
  "stop",
  "title",
  "desc",
]);
// Never allowed in content: they run code, load resources, take input or play media.
export const FORBIDDEN_ELEMENTS = new Set([
  "script",
  "plaintext",
  "xmp",
  "noembed",
  "noframes",
  "style",
  "noscript",
  "template",
  "slot",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "base",
  "link",
  "meta",
  "title",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "option",
  "optgroup",
  "datalist",
  "video",
  "audio",
  "source",
  "track",
  "canvas",
  "portal",
  "dialog",
  "foreignobject",
  "animate",
  "set",
  "animatetransform",
  "animatemotion",
]);
