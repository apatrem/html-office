// Readers (ADR-013 §1, §5): carrier precedence and the inert HTML table
// reader. Clipboard HTML is parsed into a <template>, whose content belongs to
// an inert document with no browsing context: it runs no script and fetches
// nothing (tested in every engine). Its nodes are read as data and never
// inserted into the live document.
import { ClipboardError, safeURL } from "./errors.mjs";
import {
  MIME,
  LEGACY_MIME,
  ATTRIBUTE,
  LIMITS,
  decodeEnvelope,
} from "./envelope.mjs";
import { MAX_COLSPAN, MAX_ROWSPAN } from "./table.mjs";

export function parseInert(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

const ELEMENT = 1,
  TEXT = 3;
// Never rendered, or not cell text: their contents are ignored.
const HIDDEN = new Set([
  "head",
  "title",
  "meta",
  "link",
  "style",
  "script",
  "template",
  "noscript",
  "iframe",
  "object",
  "embed",
  "svg",
  "math",
  "xml",
  "select",
  "button",
  "caption",
  "colgroup",
]);
const BLOCK = new Set([
  "p",
  "div",
  "li",
  "ul",
  "ol",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "table",
  "tr",
  "dl",
  "dt",
  "dd",
]);
const children = (node) => Array.from(node.childNodes ?? []);
const blank = (s) => /^[\s ]*$/.test(s);

// Elements in document order, without recursion (clipboard HTML may be
// nested arbitrarily deep). `visit` returns false to skip a subtree.
function walk(root, visit) {
  const stack = children(root).reverse();
  while (stack.length) {
    const node = stack.pop();
    if (visit(node) === false) continue;
    const kids = children(node);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
}
export function findEnvelope(root) {
  let found = null;
  walk(root, (node) => {
    if (found !== null) return false;
    if (node.nodeType === ELEMENT && node.getAttribute(ATTRIBUTE) !== null)
      found = node.getAttribute(ATTRIBUTE);
  });
  return found;
}

// Class rules from the fragment's own <style> elements (Excel and Word put
// bold, italic and alignment there), for `.name` and `tag.name` selectors.
const MAX_CSS = 2 ** 20;
function classRules(root) {
  const rules = new Map();
  let css = "";
  walk(root, (node) => {
    if (node.nodeType === ELEMENT && node.localName === "style") {
      const text = node.textContent;
      if (css.length + text.length < MAX_CSS) css += text + "\n";
      return false;
    }
  });
  // One linear pass (no backtracking regular expression over untrusted
  // CSS): comments and HTML comment markers are skipped, at-rules ignored.
  const add = (selectors, body) => {
    if (selectors.includes("@")) return;
    for (const selector of selectors.split(",")) {
      const match = /^\s*[a-z0-9]*\.([\w-]+)\s*$/i.exec(selector);
      if (match) rules.set(match[1], (rules.get(match[1]) ?? "") + ";" + body);
    }
  };
  let selector = "",
    i = 0;
  while (i < css.length) {
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      i = end < 0 ? css.length : end + 2;
    } else if (css.startsWith("<!--", i)) i += 4;
    else if (css.startsWith("-->", i)) i += 3;
    else if (css[i] === "{") {
      const end = css.indexOf("}", i + 1),
        stop = end < 0 ? css.length : end;
      add(selector, css.slice(i + 1, stop).replace(/\/\*|\*\//g, ""));
      selector = "";
      i = stop + 1;
    } else if (css[i] === "}") {
      selector = "";
      i++;
    } else selector += css[i++];
  }
  return rules;
}
function declarations(element, rules) {
  let text = "";
  for (const name of (element.getAttribute("class") ?? "").split(/\s+/))
    if (rules.has(name)) text += ";" + rules.get(name);
  text += ";" + (element.getAttribute("style") ?? "");
  const out = new Map();
  for (const part of text.split(";")) {
    const at = part.indexOf(":");
    if (at > 0)
      out.set(
        part.slice(0, at).trim().toLowerCase(),
        part
          .slice(at + 1)
          .trim()
          .toLowerCase(),
      );
  }
  return out;
}
const hidden = (css) =>
  css.get("display") === "none" ||
  css.get("mso-hide") === "all" ||
  css.get("visibility") === "hidden";
function weight(value) {
  if (value === undefined) return undefined;
  if (value === "bold" || value === "bolder") return true;
  if (value === "normal" || value === "lighter") return false;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n >= 600 : undefined;
}
function slant(value) {
  if (value === undefined) return undefined;
  return value.startsWith("italic") || value.startsWith("oblique");
}

// A cell's displayed text and inline runs, as the browser would lay it out:
// collapsed white space, <br> as a line break and blocks on their own lines.
function cellContent(td, rules, base, counts) {
  const tokens = [],
    // Word and Docs align the paragraphs inside a cell, not the cell.
    aligns = new Set(),
    stack = [{ node: td, state: base, root: true }];
  while (stack.length) {
    const item = stack.pop();
    if (item.block) {
      tokens.push(item);
      continue;
    }
    const { node, state, root } = item;
    if (node.nodeType === TEXT) {
      tokens.push({ text: node.data.replace(/[ \t\n\r\f]+/g, " "), state });
      continue;
    }
    if (node.nodeType !== ELEMENT) continue;
    const tag = node.localName;
    if (!root && HIDDEN.has(tag)) continue;
    if (tag === "br") {
      tokens.push({ br: true });
      continue;
    }
    const css = declarations(node, rules);
    if (hidden(css)) continue;
    const next = { ...state };
    if (tag === "b" || tag === "strong") next.bold = true;
    if (tag === "i" || tag === "em") next.italic = true;
    next.bold = weight(css.get("font-weight")) ?? next.bold;
    next.italic = slant(css.get("font-style")) ?? next.italic;
    if (tag === "a" && node.getAttribute("href") !== null) {
      const href = node.getAttribute("href").trim();
      if (safeURL(href)) next.link = href;
      else {
        delete next.link;
        counts.links++;
      }
    }
    // Blocks (and cells of a nested table) sit on their own lines.
    const block = !root && (BLOCK.has(tag) || tag === "td" || tag === "th");
    if (block) {
      tokens.push({ block: true });
      stack.push({ block: true });
      if (tag === "p" || tag === "div")
        aligns.add(css.get("text-align") ?? node.getAttribute("align"));
    }
    const kids = children(node);
    for (let i = kids.length - 1; i >= 0; i--)
      stack.push({ node: kids[i], state: next });
  }
  const [align] = aligns.size === 1 ? aligns : [];
  return { ...normalise(tokens), align: align?.toLowerCase() };
}

// Characters with their inline state, then runs of equal state. White space
// between runs joins the run before it, so it never splits a bold cell.
function normalise(tokens) {
  const chars = [];
  let pendingBlock = false;
  const trimEnd = () => {
    while (chars.length && chars.at(-1).c === " ") chars.pop();
  };
  for (const token of tokens) {
    if (token.block) {
      pendingBlock = chars.length > 0;
      continue;
    }
    if (token.br) {
      trimEnd();
      chars.push({ c: "\n" });
      pendingBlock = false;
      continue;
    }
    for (const c of token.text) {
      const last = chars.at(-1)?.c;
      if (
        c === " " &&
        (!chars.length || last === " " || last === "\n" || pendingBlock)
      )
        continue;
      if (pendingBlock) {
        trimEnd();
        if (chars.length && chars.at(-1).c !== "\n") chars.push({ c: "\n" });
        pendingBlock = false;
      }
      chars.push({ c, state: token.state });
    }
  }
  const edge = (ch) => ch && /[\s\u00a0]/.test(ch.c);
  while (edge(chars.at(-1))) chars.pop();
  let start = 0;
  while (edge(chars[start])) start++;
  const runs = [];
  for (const { c, state } of chars.slice(start)) {
    const run = runs.at(-1);
    // Edges are trimmed, so white space always has a run before it.
    if (/[\s\u00a0]/.test(c)) {
      run.text += c;
      continue;
    }
    const key = `${!!state.bold}|${!!state.italic}|${state.link ?? ""}`;
    if (run?.key === key) run.text += c;
    else runs.push({ text: c, key, state });
  }
  const text = runs.map((r) => r.text).join("");
  const look = (s) => ({
    ...(s.bold ? { bold: true } : {}),
    ...(s.italic ? { italic: true } : {}),
    ...(s.link ? { link: { url: s.link } } : {}),
  });
  if (runs.length <= 1) return { text, ...look(runs[0]?.state ?? {}) };
  return {
    text,
    runs: runs.map((run) => ({ text: run.text, ...look(run.state) })),
  };
}

const spanOf = (element, name, max) => {
  const n = parseInt(element.getAttribute(name) ?? "1", 10);
  if (!Number.isFinite(n) || n < (name === "rowspan" ? 0 : 1)) return 1;
  return Math.min(n, max);
};
function tableRows(table) {
  const body = [],
    foot = [],
    head = [];
  for (const child of children(table)) {
    if (child.nodeType !== ELEMENT) continue;
    const tag = child.localName;
    if (tag === "tr") body.push({ tr: child });
    else if (["thead", "tbody", "tfoot"].includes(tag))
      for (const tr of children(child))
        if (tr.nodeType === ELEMENT && tr.localName === "tr")
          (tag === "thead" ? head : tag === "tfoot" ? foot : body).push({
            tr,
            header: tag === "thead",
          });
  }
  // Header rows render first and footers last, wherever they are written.
  return [...head, ...body, ...foot];
}

// The one table of an HTML fragment as a portable table, or null when the
// fragment has no table, several, or text outside it (a mixed selection,
// better served by text/plain).
export function readTable(root, { maxCells = Infinity } = {}) {
  const tables = [];
  let outside = false;
  walk(root, (node) => {
    if (node.nodeType === TEXT) {
      if (!blank(node.data)) outside = true;
      return;
    }
    if (node.nodeType !== ELEMENT) return false;
    if (HIDDEN.has(node.localName)) return false;
    if (node.localName === "table") {
      tables.push(node);
      return false;
    }
  });
  if (tables.length !== 1 || outside) return null;
  const rules = classRules(root),
    rows = tableRows(tables[0]),
    counts = { links: 0 };
  if (!rows.length) return null;
  const cellsOf = (tr) =>
    children(tr).filter(
      (n) => n.nodeType === ELEMENT && ["td", "th"].includes(n.localName),
    );
  // Bound the expanded size before allocating anything.
  let area = 0;
  rows.forEach(({ tr }, r) => {
    for (const td of cellsOf(tr)) {
      const down = spanOf(td, "rowspan", MAX_ROWSPAN) || rows.length - r;
      area +=
        spanOf(td, "colspan", MAX_COLSPAN) * Math.min(down, rows.length - r);
    }
  });
  const limit = `The pasted table is larger than ${maxCells.toLocaleString("en-US")} cells`;
  if (area > maxCells) throw new ClipboardError(limit);
  const grid = rows.map(() => []);
  let width = 0;
  rows.forEach(({ tr, header }, r) => {
    let c = 0;
    const rowCss = declarations(tr, rules);
    if (hidden(rowCss)) return;
    for (const td of cellsOf(tr)) {
      while (grid[r][c] !== undefined) c++;
      const across = spanOf(td, "colspan", MAX_COLSPAN),
        down = Math.min(
          spanOf(td, "rowspan", MAX_ROWSPAN) || rows.length - r,
          rows.length - r,
        ),
        css = declarations(td, rules),
        th = td.localName === "th" || header,
        { align: inner, ...content } = cellContent(
          td,
          rules,
          {
            bold: weight(rowCss.get("font-weight")) ?? th,
            italic: slant(rowCss.get("font-style")),
          },
          counts,
        ),
        align =
          css.get("text-align") ??
          td.getAttribute("align")?.toLowerCase() ??
          inner;
      for (let i = r; i < r + down; i++)
        for (let j = c; j < c + across; j++) grid[i][j] = { covered: true };
      grid[r][c] =
        content.text || across > 1 || down > 1
          ? {
              ...content,
              ...(th ? { header: true } : {}),
              ...(across > 1 ? { colspan: across } : {}),
              ...(down > 1 ? { rowspan: down } : {}),
              ...(["left", "center", "right"].includes(align) ? { align } : {}),
            }
          : null;
      c += across;
      width = Math.max(width, c);
    }
  });
  if (!width) return null;
  if (rows.length * width > maxCells) throw new ClipboardError(limit);
  const table = {
    rows: grid.map((row) =>
      Array.from({ length: width }, (_, c) => row[c] ?? null),
    ),
  };
  let headerRows = 0;
  while (
    headerRows < table.rows.length &&
    table.rows[headerRows].every((slot) => !slot || slot.covered || slot.header)
  )
    headerRows++;
  if (headerRows) table.headerRows = headerRows;
  return { table, dropped: counts };
}

// Reader precedence (ADR-013 §1). An absent carrier or an envelope of an
// unknown schema is skipped with a notice; a recognised envelope that is
// malformed, over a limit or unsafe throws, so the paste is aborted rather
// than falling back to displayed values.
export function readClipboard(
  data,
  { maxCells = Infinity, parse = parseInert } = {},
) {
  const types = Array.from(data.types ?? []),
    get = (type) => (types.includes(type) ? data.getData(type) : ""),
    notices = [];
  const skip = (schema) =>
    notices.push(
      `Clipboard data in an unsupported format (${schema}) was skipped; a newer version of html-office may be needed.`,
    );
  const custom = get(MIME);
  if (custom) {
    const read = decodeEnvelope(custom, { maxCells });
    if (read.envelope)
      return {
        source: "envelope",
        via: "custom",
        envelope: read.envelope,
        notices,
      };
    skip(read.skipped);
  }
  // HTML over its limit cannot be inspected and is treated as absent:
  // html-office never writes such HTML.
  const html = get("text/html"),
    fragment = html && html.length <= LIMITS.html ? parse(html) : null;
  if (fragment) {
    const attribute = findEnvelope(fragment);
    if (attribute !== null) {
      const read = decodeEnvelope(attribute, { maxCells });
      if (read.envelope)
        return {
          source: "envelope",
          via: "html",
          envelope: read.envelope,
          notices,
        };
      skip(read.skipped);
    }
  }
  const legacy = get(LEGACY_MIME);
  if (legacy) {
    if (legacy.length > LIMITS.json)
      throw new ClipboardError("the range clipboard data is too large");
    try {
      return { source: "legacy", range: JSON.parse(legacy), notices };
    } catch {
      throw new ClipboardError("the range clipboard data is not valid JSON");
    }
  }
  if (fragment) {
    const read = readTable(fragment, { maxCells });
    if (read) return { source: "table", ...read, notices };
  }
  if (types.includes("text/plain")) {
    const text = data.getData("text/plain");
    if (text.length > LIMITS.text)
      throw new ClipboardError("the clipboard text is too large");
    return { source: "text", text, notices };
  }
  return { source: "none", notices };
}
