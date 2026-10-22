// Manual formatting contract (ADR-010): cell styles, direct style objects,
// row/column formatting and dimensions, links. Presentation only: none of it
// enters the calculation fingerprint.
import { parseAddress, parseRange, validateFormat } from "./workbook.mjs";

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

// Charte tokens usable as theme colour references, including the Excel theme
// slots that the charte defines or derives from its base colours.
export const THEME_TOKENS = [
  "ink",
  "acc",
  "mid",
  "lig",
  "alert",
  "tint",
  "callout",
  "bd",
  "t2",
  "bg",
  "dk1",
  "lt1",
  "dk2",
  "lt2",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "hlink",
  "folHlink",
];
// "none" explicitly suppresses a side inherited from a cell style, row or column.
export const BORDER_STYLES = [
  "none",
  "thin",
  "medium",
  "thick",
  "double",
  "dotted",
  "mediumdashed",
  "mediumdashdot",
  "mediumdashdotdot",
  "slantdashdot",
];
export const HORIZONTAL = [
  "general",
  "left",
  "center",
  "right",
  "centerContinuous",
];
export const VERTICAL = ["top", "center", "bottom"];

// Built-in cell styles. Our semantic styles keep their names; Excel's "Input"
// and "Calculation" are `assumption` and `calculation`, not duplicates.
const accents = [1, 2, 3, 4, 5, 6].flatMap((n) => [
  `accent${n}`,
  `accent${n}-20`,
  `accent${n}-40`,
  `accent${n}-60`,
]);
export const BUILTIN_CELL_STYLES = [
  "normal",
  "header",
  "rowHeader",
  "assumption",
  "calculation",
  "good",
  "bad",
  "neutral",
  "checkCell",
  "explanatoryText",
  "linkedCell",
  "note",
  "output",
  "warningText",
  "title",
  "heading1",
  "heading2",
  "heading3",
  "heading4",
  "total",
  "hyperlink",
  ...accents,
  "comma",
  "comma0",
  "currency",
  "currency0",
  "percent",
];
export const MAX_NAMED_STYLES = 200;
export const MAX_LINK_LENGTH = 2048;

export function validateColor(value, where = "colour") {
  if (typeof value === "string") {
    if (!/^#[0-9a-f]{6}$/i.test(value)) fail(`Invalid ${where}`);
    return;
  }
  fields(value, ["theme", "tint"], where);
  if (!THEME_TOKENS.includes(value.theme)) fail(`Unknown theme colour`);
  if (
    value.tint !== undefined &&
    (typeof value.tint !== "number" ||
      !Number.isFinite(value.tint) ||
      value.tint < -1 ||
      value.tint > 1)
  )
    fail("Theme tint must be between -1 and 1");
}

export function validateStyle(style, where = "style") {
  fields(
    style,
    [
      "bold",
      "italic",
      "underline",
      "strike",
      "fontSize",
      "fontFamily",
      "color",
      "background",
      "border",
      "align",
    ],
    where,
  );
  for (const key of ["bold", "italic", "underline", "strike"])
    if (style[key] !== undefined && typeof style[key] !== "boolean")
      fail(`Invalid ${key}`);
  if (
    style.fontSize !== undefined &&
    (typeof style.fontSize !== "number" ||
      !Number.isInteger(style.fontSize * 2) ||
      style.fontSize < 1 ||
      style.fontSize > 409)
  )
    fail("Font size must be 1–409 points in half-point steps");
  // A family name only: it is placed in CSS, so no quotes or punctuation.
  if (
    style.fontFamily !== undefined &&
    (typeof style.fontFamily !== "string" ||
      !/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,63}$/u.test(style.fontFamily))
  )
    fail("Invalid font family");
  if (style.color !== undefined) validateColor(style.color, "font colour");
  if (style.background !== undefined)
    validateColor(style.background, "background colour");
  if (style.border !== undefined) {
    fields(style.border, ["top", "right", "bottom", "left"], "border");
    for (const side of Object.values(style.border)) {
      fields(side, ["style", "color"], "border side");
      if (!BORDER_STYLES.includes(side.style)) fail("Invalid border style");
      if (side.style === "none" && side.color !== undefined)
        fail("A none border has no colour");
      if (side.color !== undefined) validateColor(side.color, "border colour");
    }
  }
  if (style.align !== undefined) {
    fields(style.align, ["horizontal", "vertical", "wrap"], "alignment");
    if (
      style.align.horizontal !== undefined &&
      !HORIZONTAL.includes(style.align.horizontal)
    )
      fail("Invalid horizontal alignment");
    if (
      style.align.vertical !== undefined &&
      !VERTICAL.includes(style.align.vertical)
    )
      fail("Invalid vertical alignment");
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
const knownCellStyle = (book, name) =>
  BUILTIN_CELL_STYLES.includes(name) ||
  (book.namedStyles ?? []).some((style) => style.id === name);
// Edit boundary: a cell entering a workbook must reference its catalogue, so
// publication can never produce a workbook that fails to save.
export function checkReferences(book, cell) {
  if (cell.cellStyle !== undefined && !knownCellStyle(book, cell.cellStyle))
    fail(`Unknown cell style: ${cell.cellStyle}`);
}
// Paste from another workbook: drop custom cell styles the destination does
// not define and report how many.
export function adaptReferences(book, cell) {
  if (cell === null || cell.cellStyle === undefined)
    return { cell, dropped: 0 };
  if (knownCellStyle(book, cell.cellStyle)) return { cell, dropped: 0 };
  const { cellStyle, ...rest } = cell;
  return { cell: rest, dropped: 1 };
}

export function validateNamedStyles(book) {
  const styles = book.namedStyles === undefined ? [] : book.namedStyles;
  if (!Array.isArray(styles) || styles.length > MAX_NAMED_STYLES)
    fail("Expected at most 200 custom cell styles");
  const ids = new Set(),
    names = new Set();
  for (const style of styles) {
    fields(style, ["id", "name", "style", "format"], "cell style");
    if (
      !id(style.id) ||
      ids.has(style.id) ||
      BUILTIN_CELL_STYLES.includes(style.id)
    )
      fail("Duplicate, invalid or reserved cell style ID");
    ids.add(style.id);
    if (
      typeof style.name !== "string" ||
      !style.name.trim() ||
      style.name.length > 64 ||
      names.has(style.name.trim().toLowerCase())
    )
      fail("Duplicate or invalid cell style name");
    names.add(style.name.trim().toLowerCase());
    validateStyle(style.style, "cell style definition");
    if (style.format !== undefined) validateFormat(style.format);
  }
  return new Set([...BUILTIN_CELL_STYLES, ...ids]);
}

// Row and column formatting/dimensions, keyed "1".."1048576" and "A".."XFD".
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
      fields(
        entry,
        axis === "rows" ? ["style", key, "customHeight"] : ["style", key],
        axis.slice(0, -1),
      );
      if (!Object.keys(entry).length) fail(`Empty ${axis.slice(0, -1)} entry`);
      if (entry.style !== undefined) validateStyle(entry.style);
      const max = axis === "rows" ? 600 : 2000;
      if (
        entry[key] !== undefined &&
        (!Number.isInteger(entry[key]) || entry[key] < 1 || entry[key] > max)
      )
        fail(`Invalid ${key}`);
      if (
        entry.customHeight !== undefined &&
        (entry.customHeight !== true || entry.height === undefined)
      )
        fail("customHeight requires an explicit height");
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
