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
// Grid classes for a cell. Linked cells take the hyperlink style automatically
// and are underlined (ADR-012 §3, §8); neither is stored as formatting.
export function cellClasses(cell, linked) {
  const style = cell.cellStyle ?? (linked ? "hyperlink" : "normal");
  return linked ? `${style} linked` : style;
}
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
      // Heights are automatic: at least the standard 23 px row. Widths are at
      // least 8 px. These minimums also bound the grid's rendered viewport.
      const [min, max] = axis === "rows" ? [23, 600] : [8, 2000];
      if (
        entry[key] !== undefined &&
        (!Number.isInteger(entry[key]) || entry[key] < min || entry[key] > max)
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

// Borders drawn by catalogue styles (ADR-012 §8). Their fills, colours and
// emphasis come from charte classes in the stylesheet; borders are data so the
// shared-edge rule sees them.
const line = (style) => ({ style, color: "ink" });
export const CELL_STYLE_BORDERS = {
  output: {
    top: line("thin"),
    right: line("thin"),
    bottom: line("thin"),
    left: line("thin"),
  },
  total: { top: line("thin"), bottom: line("double") },
};
// Effective direct formatting of a cell, resolved property by property and
// border side by side: cell style borders, column, row, then the cell's own
// style (ADR-010 layers). Conditional formatting applies after, when drawing.
// Returns null when nothing applies.
export function effectiveStyle(cellStyle, columnStyle, rowStyle, cellOwnStyle) {
  const border = CELL_STYLE_BORDERS[cellStyle];
  if (!border && !columnStyle && !rowStyle && !cellOwnStyle) return null;
  const result = border ? { border: { ...border } } : {};
  for (const layer of [columnStyle, rowStyle, cellOwnStyle]) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer))
      result[key] =
        key === "border" || key === "align"
          ? { ...result[key], ...value }
          : value;
  }
  return result;
}
const WEIGHT = { none: 0, thin: 1, medium: 2, double: 3 };
// One shared edge: the upper (or left) cell's bottom (right) side against the
// lower (right) cell's top (left). The heavier line wins; on a tie the lower
// or right cell wins. Returns the winning {style, color} or null.
export function resolveEdge(first, second) {
  const a = WEIGHT[first?.style] ?? 0,
    b = WEIGHT[second?.style] ?? 0;
  if (!a && !b) return null;
  const side = b >= a ? second : first;
  return { style: side.style, color: side.color ?? "ink" };
}

// ---- Formatting commands (F03) ----
// Refused above this many individual cells; whole rows or columns write
// row or column styles instead (ADR-010 storage).
export const MAX_FORMAT_CELLS = 50000;
// Emphasis and fill that catalogue styles draw from the stylesheet, so a
// command knows when turning a property off must be stored explicitly.
const CATALOGUE = {
  title: { bold: true },
  header: { bold: true, fill: true },
  rowHeader: { fill: true },
  assumption: { fill: true },
  calculation: { fill: true },
  output: { bold: true },
  total: { bold: true },
  note: { italic: true },
  alert: { bold: true },
};
// What a cell would show without its own style.
export function inheritedStyle(cellStyle, columnStyle, rowStyle) {
  const look = CATALOGUE[cellStyle] ?? {},
    style = effectiveStyle(cellStyle, columnStyle, rowStyle) ?? {};
  return {
    ...style,
    bold: style.bold ?? !!look.bold,
    italic: style.italic ?? !!look.italic,
    fill: style.fill ?? (look.fill ? "catalogue" : "none"),
  };
}
// Applies a patch to a style: null removes a property (or a border side or
// alignment field); empty groups disappear. Returns undefined when empty.
export function applyStylePatch(style, patch) {
  const next = { ...style };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "border" || key === "align") {
      const inner = { ...next[key] };
      for (const [field, part] of Object.entries(value))
        if (part === null) delete inner[field];
        else inner[field] = part;
      if (Object.keys(inner).length) next[key] = inner;
      else delete next[key];
    } else if (value === null) delete next[key];
    else next[key] = value;
  }
  return Object.keys(next).length ? next : undefined;
}
// A property set to the value the cell inherits is removed instead of stored.
export function settle(patch, inherited) {
  const out = {};
  for (const [key, value] of Object.entries(patch))
    if (key === "align") {
      out.align = {};
      for (const [field, part] of Object.entries(value))
        out.align[field] =
          part ===
          (inherited.align?.[field] ?? (field === "wrap" ? false : "general"))
            ? null
            : part;
    } else if (key === "border") out.border = value;
    else out[key] = value === inherited[key] ? null : value;
  return out;
}
export const BORDER_PRESETS = [
  "all",
  "outer",
  "inner",
  "top",
  "bottom",
  "left",
  "right",
  "none",
];
// Border sides a preset writes on one cell of a selection. `at` tells where
// the cell sits: {top, bottom, left, right} booleans for the selection's
// edges; a whole-row style has no left/right edge, a column no top/bottom.
// "none" writes an explicit none only where an inherited side would show.
export function borderPatch(preset, at, line, inheritedBorder = {}) {
  const sides = {
    all: ["top", "right", "bottom", "left"],
    outer: ["top", "right", "bottom", "left"].filter((side) => at[side]),
    inner: ["top", "right", "bottom", "left"].filter(
      (side) => at[side] === false,
    ),
    top: at.top ? ["top"] : [],
    bottom: at.bottom ? ["bottom"] : [],
    left: at.left ? ["left"] : [],
    right: at.right ? ["right"] : [],
    none: [],
  }[preset];
  if (!sides) throw new Error("Unknown border preset");
  const border = {};
  if (preset === "none")
    for (const side of ["top", "right", "bottom", "left"])
      border[side] =
        inheritedBorder[side] && inheritedBorder[side].style !== "none"
          ? { style: "none" }
          : null;
  else for (const side of sides) border[side] = { ...line };
  return { border };
}
