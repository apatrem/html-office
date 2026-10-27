// A read-only DOM view of parse5's tree, so the clipboard HTML reader runs in
// Node. parse5 parses a fragment in a <template> context, like parseInert.
import { parseFragment } from 'parse5';

function wrap(node) {
  if (node.nodeName === '#text') return { nodeType: 3, data: node.value, childNodes: [] };
  if (node.nodeName === '#comment') return { nodeType: 8, data: node.data, childNodes: [] };
  const kids = node.nodeName === 'template' ? node.content.childNodes : node.childNodes ?? [];
  let wrapped;
  return {
    nodeType: node.nodeName === '#document-fragment' ? 11 : 1,
    localName: node.tagName,
    get childNodes() { return (wrapped ??= kids.map(wrap)); },
    getAttribute(name) { return node.attrs?.find(a => a.name === name)?.value ?? null; },
    get textContent() {
      const out = [];
      const visit = n => n.nodeName === '#text' ? out.push(n.value) : (n.childNodes ?? []).forEach(visit);
      visit(node);
      return out.join('');
    },
  };
}
export const parseInert = html => wrap(parseFragment(html));
