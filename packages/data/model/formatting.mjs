// Formatting contract (ADR-010 layering and links, ADR-012 vocabulary): cell
// styles, direct styles, row/column formatting and dimensions, links, document
// font and theme. Presentation only: none of it enters the fingerprint.
import { parseAddress, parseRange } from "./workbook.mjs";

const fail = (message) => {
  throw new Error(message);
};
const object = (v) =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
function fields(value, allowed, where) {
  if (!object(value)) fail(`${where}: expected object`);
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) fail(`${where}: unknown field ${key}`);
}
const id = (v) => typeof v === "string" && /^[a-zA-Z][\w-]{0,79}$/.test(v);

// Closed vocabulary shared with html-slides (ADR-012): charte tokens only,
// never literal colours, fonts or sizes.
export const TEXT_COLORS = ["ink", "acc", "mid", "alert", "t2", "bg"];
export const FILLS = ["none", "tint", "lig", "mid", "acc", "alert", "dark"];
// Fills on which text turns white unless a text colour is given (as in Slides).
export const DARK_FILLS = ["mid", "acc", "alert", "dark"];
// "none" explicitly suppresses a side inherited from a cell style, row or column.
export const BORDER_STYLES = ["none", "thin", "medium", "double"];
export const HORIZONTAL = [
  "general",
  "left",
  "center",
  "right",
  "centerContinuous",
];
// Per-document font: fonts present on both Windows and macOS.
export const FONTS = {
  arial: "Arial, Helvetica, sans-serif",
  verdana: "Verdana, Geneva, sans-serif",
  tahoma: "Tahoma, Verdana, sans-serif",
  trebuchet: '"Trebuchet MS", Helvetica, sans-serif',
  georgia: 'Georgia, "Times New Roman", serif',
  times: '"Times New Roman", Times, serif',
};
// Built-in chartes overlaid on the document's own charte (never rewritten).
export const THEMES = ["blue", "red", "green", "black"];
// The fixed cell-style catalogue; there are no custom styles.
export const BUILTIN_CELL_STYLES = [
  "normal",
  "title",
  "header",
  "rowHeader",
  "assumption",
  "calculation",
  "output",
  "total",
  "note",
  "alert",
  "hyperlink",
];
export const MAX_LINK_LENGTH = 2048;
// CSS for tokens, mirroring html-slides' c-* and bg-* classes.
export const colorCSS = (token) => `var(--${token})`;
export const fillCSS = (token) =>
  ({
    none: "transparent",
    tint: "var(--callout)",
    lig: "var(--lig)",
    mid: "var(--mid)",
    acc: "var(--acc)",
    alert: "var(--alert)",
    dark: "var(--ink)",
  })[token];

const token = (value, allowed, where) => {
  if (!allowed.includes(value))
    fail(`Invalid ${where}: use one of ${allowed.join(", ")}`);
};

export function validateStyle(style, where = "style") {
  fields(style, ["bold", "italic", "color", "fill", "border", "align"], where);
  for (const key of ["bold", "italic"])
    if (style[key] !== undefined && typeof style[key] !== "boolean")
      fail(`Invalid ${key}`);
  if (style.color !== undefined) token(style.color, TEXT_COLORS, "text colour");
  if (style.fill !== undefined) token(style.fill, FILLS, "fill");
  if (style.border !== undefined) {
    fields(style.border, ["top", "right", "bottom", "left"], "border");
    for (const side of Object.values(style.border)) {
      fields(side, ["style", "color"], "border side");
      token(side.style, BORDER_STYLES, "border style");
      if (side.style === "none" && side.color !== undefined)
        fail("A none border has no colour");
      if (side.color !== undefined)
        token(side.color, TEXT_COLORS, "border colour");
    }
  }
  if (style.align !== undefined) {
    fields(style.align, ["horizontal", "wrap"], "alignment");
    if (style.align.horizontal !== undefined)
      token(style.align.horizontal, HORIZONTAL, "horizontal alignment");
    if (style.align.wrap !== undefined && typeof style.align.wrap !== "boolean")
      fail("Invalid wrap");
  }
}

// Links are inert data; only web and mail targets may ever be opened. They
// live per sheet, keyed by A1 cell (like Excel's worksheet hyperlinks), so
// structural relocation and history cost is proportional to the link count.
export function validateLinkShape(link) {
  if (object(link) && "url" in link) {
    fields(link, ["url"], "link");
    if (
      typeof link.url !== "string" ||
      link.url.length > MAX_LINK_LENGTH ||
      !/^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(link.url)
    )
      fail("Links accept only https, http or mailto targets");
    let parsed;
    try {
      parsed = new URL(link.url);
    } catch {
      fail("Invalid link URL");
    }
    if (!["https:", "http:", "mailto:"].includes(parsed.protocol))
      fail("Links accept only https, http or mailto targets");
    return;
  }
  fields(link, ["sheetId", "ref"], "link");
  if (!id(link.sheetId)) fail("Invalid link sheet");
  if (link.ref !== "#REF!") parseRange(link.ref);
}
export const MAX_LINKS_PER_SHEET = 10000;
export function validateSheetLinks(sheet, sheetIds) {
  if (sheet.links === undefined) return;
  if (!object(sheet.links)) fail("Expected links object");
  const entries = Object.entries(sheet.links);
  if (entries.length > MAX_LINKS_PER_SHEET)
    fail("Expected at most 10,000 links per sheet");
  for (const [ref, link] of entries) {
    parseAddress(ref);
    validateLinkShape(link);
    if ("sheetId" in link && !sheetIds.has(link.sheetId))
      fail("Unknown link sheet");
  }
}
const knownCellStyle = (book, name) => BUILTIN_CELL_STYLES.includes(name);
// Edit boundary: a cell entering a workbook must reference its catalogue, so
// publication can never produce a workbook that fails to save.
export function checkReferences(book, cell) {
  if (cell.cellStyle !== undefined && !knownCellStyle(book, cell.cellStyle))
    fail(`Unknown cell style: ${cell.cellStyle}`);
}
// Paste from an older or foreign payload: drop cell styles outside the
// catalogue and report how many.
export function adaptReferences(book, cell) {
  if (cell === null || cell.cellStyle === undefined)
    return { cell, dropped: 0 };
  if (knownCellStyle(book, cell.cellStyle)) return { cell, dropped: 0 };
  const { cellStyle, ...rest } = cell;
  return { cell: rest, dropped: 1 };
}

// Row and column formatting/dimensions, keyed "1".."1048576" and "A".."XFD".
// Column widths are set by the user; row heights are automatic (standard, or
// grown by wrapped cells) and stored so files open without re-measuring.
export function validateAxes(sheet) {
  for (const [axis, key] of [
    ["rows", "height"],
    ["columns", "width"],
  ]) {
    if (sheet[axis] === undefined) continue;
    if (!object(sheet[axis])) fail(`Expected ${axis} object`);
    for (const [name, entry] of Object.entries(sheet[axis])) {
      if (axis === "rows") {
        if (!/^[1-9]\d{0,6}$/.test(name)) fail("Invalid row key");
        parseAddress("A" + name);
      } else {
        if (!/^[A-Z]{1,3}$/.test(name)) fail("Invalid column key");
        parseAddress(name + "1");
      }
      fields(entry, ["style", key], axis.slice(0, -1));
      if (!Object.keys(entry).length) fail(`Empty ${axis.slice(0, -1)} entry`);
      if (entry.style !== undefined) validateStyle(entry.style);
      const max = axis === "rows" ? 600 : 2000;
      if (
        entry[key] !== undefined &&
        (!Number.isInteger(entry[key]) || entry[key] < 1 || entry[key] > max)
      )
        fail(`Invalid ${key}`);
    }
  }
}

// Rich paste: the pasted rectangle takes the source links exactly (a target
// without a source link loses its own). Untrusted payload links are
// validated; internal links to sheets this workbook lacks are dropped.
export function pastedLinks(book, sheetId, edits, links, origin) {
  const result = new Map();
  let dropped = 0;
  for (const edit of edits) {
    const p = parseAddress(edit.ref),
      source = links?.[`${p.row - origin.row},${p.column - origin.column}`];
    let link = null;
    if (source !== undefined) {
      validateLinkShape(source);
      if (
        "sheetId" in source &&
        !book.sheets.some((s) => s.id === source.sheetId)
      )
        dropped++;
      else link = source;
    }
    result.set(edit.ref, link);
  }
  // The resulting sheet must stay within the per-sheet link limit.
  const sheet = book.sheets.find((s) => s.id === sheetId),
    count = new Set(Object.keys(sheet?.links ?? {}));
  for (const [ref, link] of result)
    if (link) count.add(ref);
    else count.delete(ref);
  if (count.size > MAX_LINKS_PER_SHEET)
    fail("Paste would exceed 10,000 links on this sheet");
  return { links: result, dropped };
}
// Applies link changes carried by edits ({link: object | null}) to a sheet.
export function applyLinkEdits(sheet, edits) {
  const changes = edits.filter((edit) => edit.link !== undefined);
  if (!changes.length) return sheet;
  const links = { ...sheet.links };
  for (const edit of changes)
    if (edit.link === null) delete links[edit.ref];
    else links[edit.ref] = edit.link;
  const next = { ...sheet };
  if (Object.keys(links).length) next.links = links;
  else delete next.links;
  return next;
}

// Presentation fields a value edit or paste must keep on its target cell.
export const PRESENTATION_FIELDS = ["cellStyle", "format", "style"];
export const presentation = (cell) =>
  Object.fromEntries(
    PRESENTATION_FIELDS.filter((key) => cell[key] !== undefined).map((key) => [
      key,
      cell[key],
    ]),
  );
