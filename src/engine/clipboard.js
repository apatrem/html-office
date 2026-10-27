// Slides on the shared clipboard (ADR-013, X02b). A selected table.t is copied as the html-office
// envelope, a semantic table for other applications and TSV. A pasted table (html-office, Excel,
// Sheets, Word, Docs, web pages, TSV) becomes a new table.t built from the validated portable
// model: clipboard nodes are never inserted into the deck.
import { SCHEMA, ClipboardError, readClipboard, writeClipboard, validateTable, tableText, fromTSV } from '../../packages/shared/clipboard/index.mjs';
import { FORMAT_VERSION } from '../format.js';
import { tableGrid } from './tables.js';

// Largest table pasted into a slide (ADR-013 §3); density stays a checker matter.
export const LIMIT = { rows: 50, columns: 12 };
const tooLarge = () => new ClipboardError(`a slide table holds at most ${LIMIT.rows} rows and ${LIMIT.columns} columns`);

// ---------- a table.t as a portable table ----------
const BLOCK = new Set(['p', 'div', 'li', 'ul', 'ol', 'h3', 'h4', 'blockquote']);
// Inline classes of Slides text as token appearance: hl and neg are bold accent and bold alert.
function spanLook(el, look) {
  const next = { ...look };
  for (const c of el.classList) {
    if (c.startsWith('c-')) next.color = c.slice(2);
    if (c === 't2') next.color = 't2';
    if (c === 'hl' || c === 'neg') { next.bold = true; next.color = c === 'hl' ? 'acc' : 'alert'; }
  }
  return next;
}
// The cell's displayed text and runs: white space collapsed, <br> and blocks as line breaks.
function cellContent(cell, base) {
  const chars = [];
  let pending = false;
  const put = (ch, look) => {
    const last = chars[chars.length - 1]?.ch;
    if (ch === ' ' && (!chars.length || last === ' ' || last === '\n' || pending)) return;
    if (pending && chars.length) {
      while (chars[chars.length - 1]?.ch === ' ') chars.pop();
      if (chars[chars.length - 1]?.ch !== '\n') chars.push({ ch: '\n', look });
    }
    pending = false;
    chars.push({ ch, look });
  };
  const visit = (node, look) => {
    if (node.nodeType === 3) { for (const ch of node.data.replace(/[ \t\n\r\f]+/g, ' ')) put(ch, look); return; }
    if (node.nodeType !== 1 || node.hasAttribute('data-ui')) return;
    const tag = node.localName;
    if (tag === 'br') { while (chars[chars.length - 1]?.ch === ' ') chars.pop(); chars.push({ ch: '\n', look }); pending = false; return; }
    let next = look;
    if (tag === 'b' || tag === 'strong') next = { ...next, bold: true };
    if (tag === 'i' || tag === 'em') next = { ...next, italic: true };
    if (tag === 'span') next = spanLook(node, next);
    if (BLOCK.has(tag)) pending = chars.length > 0;
    for (const child of node.childNodes) visit(child, next);
    if (BLOCK.has(tag)) pending = chars.length > 0;
  };
  for (const child of cell.childNodes) visit(child, base);
  while (chars.length && /\s/.test(chars[chars.length - 1].ch)) chars.pop();
  // Runs of equal look. White space between two runs of the same look takes that look, so
  // <b>a</b> <b>b</b> stays one bold run; elsewhere it keeps its own.
  const key = look => `${!!look.bold}|${!!look.italic}|${look.color || ''}`;
  const space = x => /\s/.test(x.ch), after = [];
  for (let i = chars.length - 1, next = null; i >= 0; i--) { after[i] = next; if (!space(chars[i])) next = chars[i].look; }
  for (let i = 0, before = null; i < chars.length; i++) {
    if (!space(chars[i])) before = chars[i].look;
    else if (before && after[i] && key(before) === key(after[i])) chars[i].look = before;
  }
  const runs = [];
  for (const { ch, look } of chars) {
    const run = runs[runs.length - 1], k = key(look);
    if (run && run.key === k) run.text += ch;
    else runs.push({ text: ch, key: k, look });
  }
  const text = runs.map(r => r.text).join('');
  const out = ({ bold, italic, color }) => ({ ...(bold ? { bold } : {}), ...(italic ? { italic } : {}), ...(color ? { color } : {}) });
  if (runs.length <= 1) return { text, ...out(runs[0]?.look || {}) };
  return { text, runs: runs.map(r => ({ text: r.text, ...out(r.look) })) };
}
const alignOf = cl => (cl.contains('ta-l') ? 'left' : cl.contains('ta-c') ? 'center' : cl.contains('ta-r') || cl.contains('n') ? 'right' : undefined);

// Formatting classes of the element holding the table (the editor's toolbar sets them there)
// apply to every cell: bold, italic, text colour, alignment and fill.
function elementLook(table) {
  const classes = new Set([...table.classList, ...(table.closest('section.slide > *')?.classList || [])]);
  const look = {}, token = prefix => [...classes].find(c => c.startsWith(prefix))?.slice(prefix.length);
  if (classes.has('t-bold')) look.bold = true;
  if (classes.has('t-italic')) look.italic = true;
  if (token('c-')) look.color = token('c-');
  const align = { l: 'left', c: 'center', r: 'right' }[token('ta-')], fill = token('bg-');
  return { look, align, fill: fill && fill !== 'none' ? fill : undefined };
}

export function tableModel(table) {
  const g = tableGrid(table), element = elementLook(table);
  if (!g.width) throw new ClipboardError('the table is empty');
  const rows = g.rows.map((tr, r) => Array.from({ length: g.width }, (_, c) => {
    const a = g.slots[r][c];
    if (!a) return null;
    if (a.r !== r || a.c !== c) return { covered: true };
    const th = a.cell.localName === 'th', align = alignOf(a.cell.classList) || element.align, slot = cellContent(a.cell, element.look);
    if (!slot.text && !th && !align && a.rs === 1 && a.cs === 1) return null;
    if (element.fill) slot.fill = element.fill;
    if (th) slot.header = true;
    if (a.cs > 1) slot.colspan = a.cs;
    if (a.rs > 1) slot.rowspan = a.rs;
    if (align) slot.align = align;
    return slot;
  }));
  let headerRows = 0;
  while (headerRows < rows.length && g.slots[headerRows].length === g.width && g.slots[headerRows].every(a => a.cell.localName === 'th')) headerRows++;
  const model = { rows };
  if (headerRows) model.headerRows = headerRows;
  const totals = g.rows.flatMap((tr, r) => (tr.classList.contains('tot') ? [r] : []));
  if (totals.length) model.totalRows = totals;
  return validateTable(model);
}

// Literal styles for other applications, read from the rendered cell (ADR-013 §3): the one
// place where charte tokens become colours.
function literal(cell, slot, color) {
  const cs = getComputedStyle(cell), align = { start: 'left', end: 'right' }[cs.textAlign] || cs.textAlign;
  let out = `color:${(slot?.color && color(slot.color)) || cs.color};font-weight:${slot?.bold ? 700 : cs.fontWeight};` +
    `font-style:${slot?.italic ? 'italic' : cs.fontStyle};text-align:${align};`;
  if (!/^(transparent|rgba\(.*,\s*0\))$/.test(cs.backgroundColor)) out += `background-color:${cs.backgroundColor};`;
  for (const side of ['Top', 'Right', 'Bottom', 'Left'])
    if (cs[`border${side}Style`] !== 'none' && parseFloat(cs[`border${side}Width`]) > 0)
      out += `border-${side.toLowerCase()}:${cs[`border${side}Width`]} ${cs[`border${side}Style`]} ${cs[`border${side}Color`]};`;
  return out;
}

// Writes every flavour from one copy event; throws a ClipboardError when the table cannot be copied.
export function copyTable(data, table) {
  const model = tableModel(table), g = tableGrid(table), slide = table.closest('section.slide') || document.documentElement;
  const color = token => getComputedStyle(slide).getPropertyValue('--' + token).trim() || null;
  return writeClipboard(data, {
    envelope: { schema: SCHEMA, kind: 'table', source: { product: 'slides', format: FORMAT_VERSION }, table: model },
    table: model,
    text: tableText(model),
    html: { css: (slot, r, c) => literal(g.slots[r][c].cell, slot, color), color }
  });
}

// ---------- a portable table as a new table.t ----------
const escape = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
// Slides text has no links (counted) and no fills; header and total rows are bold already.
function runHTML(run, strong, dropped) {
  if (run.link) dropped.links++;
  const bold = run.bold && !strong;
  let html = escape(run.text).replace(/\n/g, '<br>');
  if (bold && (run.color === 'alert' || run.color === 'acc')) html = `<span class="${run.color === 'alert' ? 'neg' : 'hl'}">${html}</span>`;
  else {
    if (run.color) html = `<span class="c-${run.color}">${html}</span>`;
    if (bold) html = `<b>${html}</b>`;
  }
  return run.italic ? `<i>${html}</i>` : html;
}
// Data cell styles as Slides text (ADR-013 §3 mapping table).
function styled(slot) {
  const look = { bold: slot.bold, italic: slot.italic, color: slot.color };
  if (slot.cellStyle === 'alert') Object.assign(look, { bold: look.bold ?? true, color: look.color ?? 'alert' });
  if (slot.cellStyle === 'note') Object.assign(look, { italic: look.italic ?? true, color: look.color ?? 't2' });
  if (slot.cellStyle === 'title' || slot.cellStyle === 'output') look.bold ??= true;
  return look;
}
export function tableElement(table) {
  const header = table.headerRows ?? 0, totals = new Set(table.totalRows ?? []), dropped = { links: 0 };
  const rows = table.rows.map((row, r) => {
    const tot = r >= header && totals.has(r);
    const cells = row.map((slot, c) => {
      if (slot?.covered) return '';
      const tag = r < header || slot?.header ? 'th' : 'td';
      if (!slot) return `<${tag}></${tag}>`;
      const align = slot.align ?? table.columns?.[c]?.align;
      const attrs = (align === 'right' ? ' class="n"' : align === 'center' ? ' class="ta-c"' : '') +
        (slot.colspan > 1 ? ` colspan="${slot.colspan}"` : '') + (slot.rowspan > 1 ? ` rowspan="${slot.rowspan}"` : '');
      const strong = tag === 'th' || tot;
      const body = slot.runs ? slot.runs.map(run => runHTML(run, strong, dropped)).join('')
        : runHTML({ text: slot.text, link: slot.link, ...styled(slot) }, strong, dropped);
      return `<${tag}${attrs}>${body}</${tag}>`;
    });
    return `<tr${tot ? ' class="tot"' : ''}>${cells.join('')}</tr>`;
  });
  return { html: `<table class="t">${rows.join('')}</table>`, dropped };
}

// ---------- reading a paste ----------
// Returns { table, notices } for a table, { chart } for a chart envelope, or null when the clipboard
// holds no table. Throws a ClipboardError when the paste must be refused (deck unchanged).
export function readPaste(data, options = {}) {
  let read;
  try { read = readClipboard(data, { ...options, maxCells: LIMIT.rows * LIMIT.columns }); }
  catch (e) { throw e instanceof ClipboardError && /more than|larger than/.test(e.message) ? tooLarge() : e; }
  const notices = [...read.notices];
  let table, dropped = 0;
  if (read.source === 'envelope') {
    const { envelope } = read;
    if (envelope.kind === 'chart') return { chart: envelope, notices };
    // A Data range above the text/html limit travels without its portable table.
    if (!envelope.table) throw tooLarge();
    table = envelope.table;
    if (envelope.source.stale) notices.push('The copied Data results were not recalculated in the source.');
  } else if (read.source === 'legacy') throw new ClipboardError('this Data copy is from an older version of Data; copy the range again');
  else if (read.source === 'table') { table = validateTable(read.table); dropped = read.dropped?.links ?? 0; }
  else if (read.source === 'text' && read.text.includes('\t')) {
    const rows = fromTSV(read.text, { maxCells: LIMIT.rows * LIMIT.columns });
    table = validateTable({ rows: rows.map(row => row.map(text => (text ? { text } : null))) });
  } else return null;
  if (table.rows.length > LIMIT.rows || table.rows[0].length > LIMIT.columns) throw tooLarge();
  const built = tableElement(table), links = built.dropped.links + dropped;
  if (links) notices.push(`${links} ${links === 1 ? 'link was' : 'links were'} not carried over (slides have no links).`);
  return { html: built.html, columns: table.rows[0].length, notices };
}
