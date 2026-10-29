// Markdown to the canonical subset (T18): the deterministic conversion of the skill's passes.
// A section (or a new document's body) is written in Markdown; figures stand as one-line
// placeholders, [[block: chart | intent: "…" | id: fig-revenue]], each resolved from the
// document's existing figure with that ID or from a payload map keyed by ID. An intent is a
// description, never data. Prose goes through the paste mapping of T07 (editor/clipboard/), so
// Markdown, raw HTML in it included, enters only as the subset's constructs. Anything that cannot
// be placed or represented is refused with every reason, and nothing is written.
// FORMAT.md › Document tools describes the Markdown conventions and the payload map.
import { Transform } from "prosemirror-transform";
import { Fragment } from "prosemirror-model";
import { schema } from "../editor/schema/schema.mjs";
import { fromHTML, describeLost } from "../editor/clipboard/html.mjs";
import { markdownHTML, MAX_MARKDOWN } from "../editor/clipboard/markdown.mjs";
import { chartJSON, chartProblem } from "../editor/charts.mjs";
import { imageProblem } from "../editor/images.mjs";
import { usedIds, reserveIds } from "../editor/commands.mjs";
import { regenerate, fileFormat } from "../editor/numbering.mjs";
import { attr } from "../model/html.mjs";
import { parseInert } from "./node-dom.mjs";
import { drawCharts } from "./previews.mjs";

const N = schema.nodes,
  M = schema.marks;
const ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const KINDS = { chart: N.chart, image: N.image_figure, table: N.table_figure };

export class ConvertError extends Error {
  constructor(message, problems = []) {
    super(message);
    this.problems = problems;
  }
}

// ---------- the payload map ----------
const FIELDS = {
  chart: ["kind", "type", "data", "width", "caption"],
  image: ["kind", "asset", "file", "alt", "width", "wrap", "caption"],
  table: [
    "kind",
    "caption",
    "compact",
    "columns",
    "head",
    "body",
    "total",
    "rowHeaders",
  ],
};
const ALIGN = { left: "ta-l", center: "ta-c", right: "ta-r" };
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Every problem of one payload, as messages naming it.
function payloadProblems(id, p) {
  const out = [];
  const say = (m) => out.push(`payload "${id}": ${m}`);
  if (!ID.test(id)) say("the ID must match [A-Za-z][A-Za-z0-9_-]*");
  if (!plain(p)) return [`payload "${id}": expected an object`];
  if (!Object.hasOwn(FIELDS, p.kind))
    return [`payload "${id}": kind must be chart, image or table`];
  for (const key of Object.keys(p))
    if (!FIELDS[p.kind].includes(key))
      say(`unknown field "${key}" for a ${p.kind}`);
  if (p.caption !== undefined && typeof p.caption !== "string")
    say("caption is Markdown text");
  if (p.kind === "chart") {
    if (p.type !== undefined || p.data !== undefined) {
      const problem = chartProblem(p.type, p.data);
      if (problem) say(problem);
    }
    if (p.width !== undefined && !["text", "full"].includes(p.width))
      say('width is "text" or "full"');
  } else if (p.kind === "image") {
    if (p.asset !== undefined && p.file !== undefined)
      say("give asset or file, not both");
    for (const k of ["asset", "file", "alt", "width", "wrap"])
      if (p[k] !== undefined && p[k] !== null && typeof p[k] !== "string")
        say(`${k} is a string`);
  } else {
    if (p.compact !== undefined && typeof p.compact !== "boolean")
      say("compact is true or false");
    if (p.rowHeaders !== undefined && typeof p.rowHeaders !== "boolean")
      say("rowHeaders is true or false");
    for (const part of ["head", "body", "total"])
      if (
        p[part] !== undefined &&
        (!Array.isArray(p[part]) ||
          !p[part].every((row) => Array.isArray(row) && row.every(cellOk)))
      )
        say(
          `${part} is a list of rows, each a list of cells (text, a number, or {text, colspan, rowspan, align})`,
        );
    if (p.body !== undefined && !p.body.length)
      say("body needs at least one row");
    if (
      p.columns !== undefined &&
      (!Array.isArray(p.columns) ||
        !p.columns.every(
          (c) =>
            plain(c) &&
            Object.keys(c).every((k) =>
              ["width", "emphasis", "align"].includes(k),
            ) &&
            (c.width === undefined ||
              (Number.isInteger(c.width) && c.width >= 1 && c.width <= 100)) &&
            (c.emphasis === undefined || typeof c.emphasis === "boolean") &&
            (c.align === undefined || Object.hasOwn(ALIGN, c.align)),
        ))
    )
      say(
        "columns is a list of {width: 1–100, emphasis: true, align: left|center|right}",
      );
  }
  return out;
}
function cellOk(c) {
  if (typeof c === "string" || (typeof c === "number" && Number.isFinite(c)))
    return true;
  return (
    plain(c) &&
    Object.keys(c).every((k) =>
      ["text", "colspan", "rowspan", "align"].includes(k),
    ) &&
    (typeof c.text === "string" || typeof c.text === "number") &&
    [c.colspan, c.rowspan].every(
      (n) => n === undefined || (Number.isInteger(n) && n >= 1 && n <= 1000),
    ) &&
    (c.align === undefined || Object.hasOwn(ALIGN, c.align))
  );
}

// A payload map (JSON text or object), validated whole: Map id → payload. Throws with every problem.
export function readPayloads(json) {
  let map = json;
  if (typeof json === "string")
    try {
      map = JSON.parse(json);
    } catch (error) {
      throw new ConvertError("The payload map is not JSON", [error.message]);
    }
  if (!plain(map))
    throw new ConvertError("The payload map is one JSON object keyed by ID");
  const problems = Object.entries(map).flatMap(([id, p]) =>
    payloadProblems(id, p),
  );
  if (problems.length)
    throw new ConvertError("The payload map is not valid", problems);
  return new Map(Object.entries(map));
}

// ---------- Markdown ----------
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const PLACEHOLDER = /^\[\[block:\s*([a-z]+)\s*((?:\|[^|]*?)*)\]\]\s*$/;
const FIELD = /^\s*([a-z]+)\s*:\s*("(?:[^"\\]|\\.)*"|[^"]*?)\s*$/;
const token = (i) => `HTMLTEXTBLOCK${i}X`;

// One placeholder line: {kind, id, intent}, or a problem message.
function placeholder(line) {
  // Split on "|" outside quoted values.
  const m = /^\[\[block:\s*([a-z]+)\s*(.*)\]\]\s*$/.exec(line);
  if (!m) return null;
  const fields = {},
    parts = [];
  let cur = "",
    quoted = false;
  for (let i = 0; i < m[2].length; i++) {
    const c = m[2][i];
    if (c === "\\" && quoted) {
      cur += c + (m[2][++i] ?? "");
      continue;
    }
    if (c === '"') quoted = !quoted;
    if (c === "|" && !quoted) {
      parts.push(cur);
      cur = "";
    } else cur += c;
  }
  parts.push(cur);
  if (parts.shift().trim()) return null;
  for (const part of parts) {
    const f = FIELD.exec(part);
    if (!f || Object.hasOwn(fields, f[1])) return null;
    try {
      fields[f[1]] = f[2].startsWith('"') ? JSON.parse(f[2]) : f[2];
    } catch {
      return null;
    }
  }
  const unknown = Object.keys(fields).filter(
    (k) => !["intent", "id"].includes(k),
  );
  if (unknown.length) return { error: `unknown field "${unknown[0]}"` };
  if (!fields.id) return { error: "an id is required" };
  if (!ID.test(fields.id))
    return { error: `"${fields.id}" is not an ID ([A-Za-z][A-Za-z0-9_-]*)` };
  if (!Object.hasOwn(KINDS, m[1]))
    return { error: `kind "${m[1]}": use chart, image or table` };
  return { kind: m[1], id: fields.id, intent: fields.intent ?? "" };
}

// Lines outside fenced code blocks, as [index, line] pairs.
function* prose(lines) {
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const f = FENCE.exec(lines[i]);
    if (fence) {
      if (
        f &&
        f[1][0] === fence[0] &&
        f[1].length >= fence.length &&
        !lines[i].slice(f[0].length).trim()
      )
        fence = null;
    } else if (f) fence = f[1];
    else yield i;
  }
}

const escapeHTML = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

// The Markdown with placeholders as tokens, footnotes as span.footnote and [[xref: id]] as
// a.xref; what it names: placeholders, cross-reference targets, comment anchors.
function prepare(markdown, problems) {
  if (markdown.length > MAX_MARKDOWN)
    throw new ConvertError(
      `The Markdown is over ${MAX_MARKDOWN.toLocaleString("en")} characters`,
    );
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [],
    notes = new Map();
  const at = (i) => `line ${i + 1}`;
  for (const i of [...prose(lines)]) {
    const line = lines[i];
    if (/^\s*\[\[block\b/i.test(line)) {
      const p = /^\s/.test(line) ? null : placeholder(line);
      if (!p)
        problems.push(
          `${at(i)}: a placeholder is one line on its own, at the start of the line (outside lists and quotes): [[block: chart|image|table | intent: "…" | id: …]]`,
        );
      else if (p.error) problems.push(`${at(i)}: ${p.error}`);
      else {
        blocks.push({ ...p, line: i + 1 });
        lines[i] = `\n${token(blocks.length - 1)}\n`;
      }
      continue;
    }
    const def = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/.exec(line);
    if (def) {
      if (notes.has(def[1]))
        problems.push(`${at(i)}: footnote [^${def[1]}] is defined twice`);
      notes.set(def[1], { text: def[2].trim(), line: i + 1, used: 0 });
      lines[i] = "";
    }
  }
  const targets = new Set(),
    anchors = new Set();
  for (const i of [...prose(lines)]) {
    lines[i] = lines[i]
      .replace(/\[\^([^\]\s]+)\]/g, (whole, label) => {
        const note = notes.get(label);
        if (!note) {
          problems.push(`${at(i)}: footnote [^${label}] has no definition`);
          return whole;
        }
        note.used++;
        return `<span class="footnote">${note.text}</span>`;
      })
      .replace(/\[\[xref:\s*([^\]\s]*)\s*\]\]/g, (whole, id) => {
        if (!ID.test(id)) {
          problems.push(`${at(i)}: [[xref: ${id}]] does not name an ID`);
          return whole;
        }
        targets.add(id);
        return `<a class="xref" href="#${id}">${id}</a>`;
      });
    for (const m of lines[i].matchAll(/<a\s+class="xref"\s+href="#([^"]*)"/g))
      targets.add(m[1]);
    for (const m of lines[i].matchAll(
      /<mark\s+class="comment"\s+data-ref="([^"]*)"/g,
    ))
      anchors.add(m[1]);
  }
  for (const [label, note] of notes)
    if (!note.used)
      problems.push(
        `line ${note.line}: footnote [^${label}] is defined but not referenced`,
      );
  return { markdown: lines.join("\n"), blocks, targets, anchors };
}

const HEADING_CLASSES = ["unnumbered", "new-page", "ta-l", "ta-c", "ta-r"];
const PARAGRAPH_CLASSES = ["lead", "ta-l", "ta-c", "ta-r", "ta-j"];
const CALLOUTS = {
  NOTE: "note",
  TIP: "note",
  KEY: "key",
  IMPORTANT: "key",
  WARNING: "warning",
  CAUTION: "warning",
};

// The trailing {#id .class} of a heading or paragraph, moved onto the element.
function attributes(node, allowed, ids, problems) {
  const last = node.childNodes.at(-1);
  if (last?.nodeType !== 3) return;
  const m = /\s*\{\s*((?:[#.][A-Za-z][\w-]*\s*)+)\}\s*$/.exec(last.data);
  if (!m) return;
  const classes = [];
  for (const t of m[1].trim().split(/\s+/)) {
    if (t[0] === "#" && ids) node.setAttribute("id", t.slice(1));
    else if (t[0] === "." && allowed.includes(t.slice(1)))
      classes.push(t.slice(1));
    else
      return problems.push(
        `"{${m[1].trim()}}" after "${node.textContent.slice(0, 40)}": ${t[0] === "#" ? "only headings take an ID" : `class ${t.slice(1)} is not one of ${allowed.join(", ")}`}`,
      );
  }
  last.data = last.data.slice(0, m.index);
  if (classes.length) node.setAttribute("class", classes.join(" "));
}

// Headings, paragraph classes and GitHub's callout quotes ("> [!NOTE]") on the rendered HTML.
function decorate(node, problems) {
  for (const child of node.childNodes) {
    if (child.nodeType !== 1) continue;
    const name = child.localName;
    if (/^h[1-6]$/.test(name))
      attributes(child, HEADING_CLASSES, true, problems);
    else if (name === "p")
      attributes(child, PARAGRAPH_CLASSES, false, problems);
    else if (name === "blockquote") {
      const first = child.children[0];
      const text = first?.localName === "p" && first.childNodes[0];
      const m =
        text?.nodeType === 3 && /^\[!([A-Z]+)\][ \t]*\n?/.exec(text.data);
      if (m && CALLOUTS[m[1]]) {
        text.data = text.data.slice(m[0].length);
        if (!first.textContent.trim() && !first.children.length)
          child.childNodes.splice(child.childNodes.indexOf(first), 1);
        child.localName = "aside";
        child.setAttribute("class", `callout ${CALLOUTS[m[1]]}`);
      }
    }
    decorate(child, problems);
  }
}

// Markdown (prepared) as blocks, through the T07 mapping. Refuses what it would leave out.
function markdownBlocks(markdown, options, problems) {
  const root = parseInert(markdownHTML(markdown));
  decorate(root, problems);
  const { blocks, lost } = fromHTML(root, options);
  const said = describeLost(lost);
  if (said)
    problems.push(
      `${said} Write only what the subset holds (FORMAT.md › Document tools).`,
    );
  return blocks;
}

// Inline Markdown (a caption, a table cell) as inline nodes of one paragraph.
function inlineContent(text, options, problems, where) {
  const { markdown } = prepare(String(text), problems);
  const blocks = markdownBlocks(markdown, options, problems);
  if (blocks.length > 1 || (blocks[0] && blocks[0].type !== N.paragraph)) {
    problems.push(`${where}: one line of text, without blocks`);
    return [];
  }
  return blocks[0] ? [...blocks[0].content.content] : [];
}

// ---------- figures from payloads ----------
const IMAGE_TYPES = [
  [
    "image/png",
    (b) => b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
  ],
  ["image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/gif", (b) => /^GIF8[79]a/.test(b.subarray(0, 6).toString("latin1"))],
  [
    "image/webp",
    (b) =>
      b.subarray(0, 4).toString("latin1") === "RIFF" &&
      b.subarray(8, 12).toString("latin1") === "WEBP",
  ],
  [
    "image/svg+xml",
    (b) =>
      /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/.test(
        b.subarray(0, 512).toString("utf8"),
      ),
  ],
];
export function imageType(bytes) {
  return IMAGE_TYPES.find(([, test]) => test(bytes))?.[0] ?? null;
}

function tableNode(id, p, old, ctx, problems) {
  const where = `table "${id}"`;
  const head = p.head ?? [],
    body = p.body,
    total = p.total ?? [];
  if (!body) {
    problems.push(`${where}: body is required`);
    return null;
  }
  // Column of each cell once spans are expanded, for the columns' alignment.
  const taken = [];
  const rows = [...head, ...body, ...total].map((row, r) => {
    const group = r < head.length ? 0 : 1;
    let col = 0;
    return row.map((c) => {
      const cell = typeof c === "object" ? c : { text: c };
      while (taken[r]?.[col]) col++;
      const span = { colspan: cell.colspan ?? 1, rowspan: cell.rowspan ?? 1 };
      for (let dr = 0; dr < span.rowspan; dr++)
        for (let dc = 0; dc < span.colspan; dc++)
          (taken[r + dr] ??= [])[col + dc] = group + 1;
      const out = { ...cell, ...span, col };
      col += span.colspan;
      return out;
    });
  });
  const width = Math.max(...taken.map((r) => r?.length ?? 0));
  if (p.columns && p.columns.length !== width)
    problems.push(
      `${where}: columns lists ${p.columns.length} column(s), the table has ${width}`,
    );
  const cols = p.columns?.some((c) => c.width !== undefined || c.emphasis)
    ? p.columns.map((c) => ({
        width: c.width === undefined ? null : String(c.width),
        emphasis: !!c.emphasis,
      }))
    : null;
  const nodes = rows.map((row, r) => {
    const isHead = r < head.length,
      isTotal = r >= head.length + body.length;
    return N.table_row.create(
      { head: isHead, total: isTotal },
      row.map((cell, i) => {
        const align = ALIGN[cell.align ?? p.columns?.[cell.col]?.align] ?? null;
        const type =
          isHead || (p.rowHeaders && i === 0 && cell.col === 0)
            ? N.table_header
            : N.table_cell;
        return type.create(
          { colspan: cell.colspan, rowspan: cell.rowspan, align },
          inlineContent(cell.text, ctx.options, problems, `${where} cell`),
        );
      }),
    );
  });
  const caption =
    p.caption !== undefined
      ? p.caption
        ? N.caption.create(
            null,
            inlineContent(p.caption, ctx.options, problems, `${where} caption`),
          )
        : null
      : old?.firstChild?.type === N.caption
        ? old.firstChild
        : null;
  try {
    const table = N.table.create({ compact: !!p.compact, cols }, nodes);
    return N.table_figure.create({ id }, caption ? [caption, table] : [table]);
  } catch (error) {
    problems.push(`${where}: ${error.message}`);
    return null;
  }
}

// The figure for a placeholder: the existing one (`old`), changed by its payload when there is one.
async function figureNode(block, payload, old, ctx, problems) {
  const { id, kind } = block;
  const where = `${kind} "${id}"`;
  if (payload && payload.kind !== kind) {
    problems.push(`${where}: its payload is of kind ${payload.kind}`);
    return null;
  }
  if (!payload) return old;
  const caption = () => {
    if (payload.caption === undefined) {
      const kept = old?.firstChild?.type === N.caption ? old.firstChild : null;
      return kept ? [kept] : [];
    }
    return payload.caption
      ? [
          N.caption.create(
            null,
            inlineContent(
              payload.caption,
              ctx.options,
              problems,
              `${where} caption`,
            ),
          ),
        ]
      : [];
  };
  if (kind === "chart") {
    const type = payload.type ?? old?.attrs.type,
      data = payload.data ?? (old ? JSON.parse(old.attrs.data) : undefined),
      width = payload.width ?? old?.attrs.width ?? "text";
    if (type === undefined || data === undefined) {
      problems.push(
        `${where}: a new chart needs type and data in its payload (an intent is not data)`,
      );
      return null;
    }
    const problem = chartProblem(type, data);
    if (problem) {
      problems.push(`${where}: ${problem}`);
      return null;
    }
    const same =
      old &&
      type === old.attrs.type &&
      width === old.attrs.width &&
      chartJSON(data) === old.attrs.data;
    return N.chart.create(
      {
        id,
        type,
        width,
        data: same ? old.attrs.data : chartJSON(data),
        preview: same ? old.attrs.preview : null,
      },
      caption(),
    );
  }
  if (kind === "image") {
    let asset = payload.asset ?? old?.attrs.asset;
    if (payload.file !== undefined) {
      if (!ctx.addAsset) {
        problems.push(
          `${where}: "file" adds an asset, which a section cannot: run document.mjs add-image first and give its key as "asset"`,
        );
        return null;
      }
      asset = await ctx.addAsset(payload.file, problems, where);
      if (!asset) return null;
    }
    if (!asset) {
      problems.push(
        `${where}: a new image needs "asset" or "file" in its payload`,
      );
      return null;
    }
    if (!ctx.assets.has(asset)) {
      problems.push(`${where}: asset "${asset}" is not in script#assets`);
      return null;
    }
    const attrs = {
      id,
      asset,
      alt: payload.alt ?? old?.attrs.alt,
      width: payload.width ?? old?.attrs.width ?? "text",
      wrap:
        payload.wrap !== undefined ? payload.wrap : (old?.attrs.wrap ?? null),
    };
    const problem = imageProblem(attrs);
    if (problem) {
      problems.push(`${where}: ${problem}`);
      return null;
    }
    return N.image_figure.create(attrs, caption());
  }
  if (payload.body === undefined && old) {
    // Only the caption or density changes.
    const table = old.lastChild;
    const t =
      payload.compact === undefined
        ? table
        : table.type.create(
            { ...table.attrs, compact: payload.compact },
            table.content,
          );
    return N.table_figure.create({ id }, [...caption(), t]);
  }
  return tableNode(id, payload, old, ctx, problems);
}

// ---------- the rewrite ----------
const commentRefs = (fragment) => {
  const refs = new Set();
  fragment.descendants((n) => {
    for (const m of n.marks) if (m.type === M.comment) refs.add(m.attrs.ref);
  });
  return refs;
};
const isFigure = (n) => Object.values(KINDS).includes(n.type);
// Figures among top-level nodes, by ID.
const figuresIn = (nodes) =>
  new Map(nodes.filter(isFigure).map((n) => [n.attrs.id, n]));

// IDs of a parsed file outside article#doc.
export function zoneIds(file) {
  const ids = [];
  const walk = (node) => {
    if (node.type !== "element") return;
    if (node.name === "article" && attr(node, "id") === "doc") return;
    const id = attr(node, "id");
    if (id) ids.push(id);
    node.children.forEach(walk);
  };
  walk(file.html);
  return ids;
}

// Replaces the top-level blocks [from, to) of `doc` with the converted Markdown.
// file: the parsed file (style#charte, style#theme, script#assets); assets: Set of asset keys;
// payloads: Map from readPayloads; drop: IDs of figures and comment threads that may disappear;
// addAsset(file, problems, where): embeds an image file, returning its key (new documents only);
// level: the section's heading level and id, when a section is rewritten.
// Returns {doc, notes}: the whole new document (labels and contents regenerated, new charts
// drawn) and what the conversion did. Throws ConvertError with every problem.
export async function rewrite(
  { file, doc, from, to, section = null },
  markdown,
  { payloads = new Map(), drop = [], assets = new Set(), addAsset = null } = {},
) {
  const problems = [],
    notes = [];
  const before = [],
    old = [],
    after = [];
  doc.forEach((node, _, i) =>
    (i < from ? before : i < to ? old : after).push(node),
  );
  const prepared = prepare(markdown, problems);
  // IDs: everything in the file except the old section's headings, which the Markdown may keep.
  reserveIds(zoneIds(file));
  const used = usedIds(doc);
  const oldHeadings = new Set();
  for (const node of old)
    if (node.type === N.heading) oldHeadings.add(node.attrs.id);
  for (const id of oldHeadings) used.delete(id);
  const outside = figuresIn([...before, ...after]),
    inside = figuresIn(old);
  const seen = new Set();
  for (const b of prepared.blocks) {
    if (seen.has(b.id))
      problems.push(`line ${b.line}: "${b.id}" is placed twice`);
    seen.add(b.id);
    if (outside.has(b.id))
      problems.push(
        `line ${b.line}: "${b.id}" is a figure of another section: a figure is placed once`,
      );
    else if (used.has(b.id) && !inside.has(b.id))
      problems.push(
        `line ${b.line}: "${b.id}" is already the ID of something else in the document`,
      );
    used.add(b.id);
  }
  // Cross-reference targets: headings and figures outside, the placeholders and the headings the
  // Markdown names.
  const targets = new Set();
  for (const n of [...before, ...after])
    if (n.type === N.heading || isFigure(n)) targets.add(n.attrs.id);
  for (const b of prepared.blocks) targets.add(b.id);
  for (const m of prepared.markdown.matchAll(/\{\s*#([A-Za-z][\w-]*)/g))
    targets.add(m[1]);
  for (const id of prepared.targets)
    if (!targets.has(id))
      problems.push(
        `the cross-reference to "${id}" has no target: a heading or figure ID of the document or of this section`,
      );
  const threads = new Set();
  doc.descendants((n) => {
    if (n.type === N.comment_thread) threads.add(n.attrs.id);
  });
  for (const ref of prepared.anchors)
    if (!threads.has(ref))
      problems.push(`the comment anchor names "${ref}", which is not a thread`);
  const options = { used, targets, threads };
  const blocks = markdownBlocks(prepared.markdown, options, problems);
  const ctx = { options, assets, addAsset };
  // Placeholders: token paragraphs at the top level, each replaced by its figure.
  const placed = new Set();
  const content = [];
  for (const block of blocks) {
    const m =
      block.type === N.paragraph &&
      /^HTMLTEXTBLOCK(\d+)X$/.exec(block.textContent);
    if (!m) {
      content.push(block);
      continue;
    }
    const b = prepared.blocks[Number(m[1])];
    placed.add(b.id);
    const existing = inside.get(b.id) ?? null;
    if (existing && existing.type !== KINDS[b.kind]) {
      problems.push(
        `line ${b.line}: "${b.id}" is a ${Object.keys(KINDS).find((k) => KINDS[k] === existing.type)}, not a ${b.kind}`,
      );
      continue;
    }
    const payload = payloads.get(b.id) ?? null;
    if (!existing && !payload) {
      problems.push(
        `line ${b.line}: no figure "${b.id}" in this section and no payload for it: supply its data (an intent is not data)`,
      );
      continue;
    }
    const node = await figureNode(b, payload, existing, ctx, problems);
    if (node) {
      content.push(node);
      notes.push(
        `${b.kind} "${b.id}": ${!existing ? "created from its payload" : payload ? "changed by its payload" : "kept as it was"}`,
      );
    }
  }
  const leftover = Fragment.from(content);
  leftover.descendants((n) => {
    if (n.isText && /HTMLTEXTBLOCK\d+X|\[\[(block|xref)\b/.test(n.text))
      problems.push(
        `a placeholder is not on a line of its own at the top level: "${n.text.slice(0, 60)}"`,
      );
  });
  for (const [id, node] of inside)
    if (!placed.has(id) && !drop.includes(id))
      problems.push(
        `${node.type === N.chart ? "chart" : node.type === N.table_figure ? "table" : "image"} "${id}" is in the section but not placed: add [[block: … | id: ${id}]] or drop it explicitly`,
      );
  const kept = commentRefs(leftover);
  for (const ref of commentRefs(Fragment.from(old)))
    if (!kept.has(ref) && !drop.includes(ref))
      problems.push(
        `comment thread "${ref}" is anchored in the section: keep <mark class="comment" data-ref="${ref}">…</mark> around the text it comments, or drop it explicitly (the thread is then orphaned)`,
      );
  for (const [id] of payloads)
    if (!placed.has(id)) notes.push(`payload "${id}" is not placed here`);
  if (section) {
    const first = content[0];
    if (first?.type !== N.heading || first.attrs.id !== section.id)
      problems.push(
        `the Markdown starts with the section's heading, level ${section.level}, with its ID: ${"#".repeat(section.level)} Title {#${section.id}}`,
      );
    else if (first.attrs.level !== section.level)
      problems.push(
        `the heading of "${section.id}" stays a level ${section.level} heading (${"#".repeat(section.level)})`,
      );
    for (const node of content.slice(1))
      if (node.type === N.heading && node.attrs.level <= section.level)
        problems.push(
          `"${node.textContent.slice(0, 40)}" is a heading of level ${node.attrs.level}: inside this section, headings are below level ${section.level}`,
        );
  }
  for (const node of content)
    if (node.type === N.heading && !oldHeadings.has(node.attrs.id))
      notes.push(`heading "${node.attrs.id}" (new)`);
  if (problems.length)
    throw new ConvertError("The Markdown was not converted", problems);
  let next;
  try {
    next = doc.type.create(doc.attrs, [...before, ...content, ...after]);
    next.check();
  } catch (error) {
    throw new ConvertError("The Markdown was not converted", [error.message]);
  }
  const tr = new Transform(next);
  regenerate(tr, { format: fileFormat(file) });
  // New charts are drawn with the document's charte.
  const { doc: drawn, failed } = await drawCharts(file, tr.doc);
  for (const id of failed)
    notes.push(`chart "${id}": no preview could be drawn`);
  return { doc: drawn, notes };
}
