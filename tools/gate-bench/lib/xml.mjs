// A small XML reader for the parts of a .pptx that the bench touches. It keeps the source offsets of
// every element, so that a change is a splice of the original text and everything else stays byte
// for byte as the generating tool wrote it. Not a general parser: no DTD, no entity declarations.

const TAG = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export const decode = text => text.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (all, name) => {
  if (name[0] === '#') return String.fromCodePoint(name[1] === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
  return ENTITIES[name] ?? all;
});
export const encode = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// Returns the root element. Each element: { name, attrs, start, openEnd, closeStart, end, selfClosing,
// children, parent }. `start`..`end` spans the whole element; `openEnd`..`closeStart` its content.
export function parse(source) {
  const top = { name: '#document', attrs: {}, children: [], start: 0, end: source.length };
  let current = top;
  TAG.lastIndex = 0;
  for (let match; (match = TAG.exec(source));) {
    const [text, closing, name, attributes, selfClosing] = match;
    if (!name) continue;
    if (closing) {
      if (current.name !== name) throw new Error(`XML: </${name}> closes <${current.name}> at ${match.index}`);
      current.closeStart = match.index;
      current.end = match.index + text.length;
      current = current.parent;
      continue;
    }
    const attrs = {};
    for (const a of attributes.matchAll(ATTR)) attrs[a[1]] = decode(a[2] ?? a[3]);
    const node = { name, attrs, start: match.index, openEnd: match.index + text.length, children: [], parent: current, selfClosing: !!selfClosing };
    current.children.push(node);
    if (selfClosing) { node.closeStart = node.openEnd; node.end = node.openEnd; }
    else current = node;
  }
  if (current !== top) throw new Error(`XML: <${current.name}> is not closed`);
  if (top.children.length !== 1) throw new Error('XML: one root element expected');
  return top.children[0];
}

export const child = (node, name) => node?.children.find(c => c.name === name) ?? null;
export const children = (node, name) => (node ? node.children.filter(c => c.name === name) : []);
export function descendants(node, name, out = []) {
  for (const c of node?.children ?? []) { if (c.name === name) out.push(c); descendants(c, name, out); }
  return out;
}
export const inner = (source, node) => source.slice(node.openEnd, node.closeStart);

// Applies [{ start, end, text }] to the source; the spans must not overlap.
export function splice(source, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].end > sorted[i - 1].start) throw new Error('XML: overlapping edits');
  let out = source;
  for (const edit of sorted) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  return out;
}
