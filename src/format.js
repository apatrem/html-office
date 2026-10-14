// Vocabulary shared by the checker, the embedded reference and the engine.
export const FORMAT_VERSION = '1';
export const CONTENT_CLASSES = ['slide', 'dark', 'tracker', 'sticker', 'source', 'body', 'lead', 'callout', 'kpi', 'sm', 'stack', 'cards', 'card', 'n',
  'box', 'tint', 'accent', 'arrow', 'rule', 'shape', 't', 'steps', 'matrix', 'q', 'on', 'ylab', 'xlab', 'chart', 'in-panel', 'band', 'kicker', 'note',
  'cartouche', 'acc', 'num', 'quote', 'author', 'hl', 'neg', 't2', 'exh', 'notes', 'to-ai', 'tot',
  'fs-s', 'fs-m', 'fs-l', 'fs-xl', 'fs-xxl', 'ta-l', 'ta-c', 'ta-r', 't-bold', 't-italic',
  'c-ink', 'c-acc', 'c-mid', 'c-alert', 'c-t2', 'c-bg', 'bg-none', 'bg-tint', 'bg-lig', 'bg-mid', 'bg-acc', 'bg-alert', 'bg-dark',
  'cols-2', 'cols-3', 'cols-4', 'cols-5', 'w-2', 'w-3', 'w-4', 'w-5', 'w-6', 'w-7', 'w-8', 'w-9', 'w-10', 'w-12', 'r4'];

// ---------- safety rules: deck content never runs code or loads an external resource ----------
// Shared by the inert checker (tools/validation.mjs) and draft restoration in the engine.
export const ACTIVE_TAGS = ['iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'link', 'form',
  'animate', 'set', 'animatetransform', 'animatemotion'];
// Attributes that load or send to a URL and have no use in a deck.
const RESOURCE_ATTRS = ['srcset', 'background', 'poster', 'ping', 'action', 'formaction', 'lowsrc', 'dynsrc',
  'longdesc', 'codebase', 'archive', 'classid', 'manifest', 'icon', 'profile', 'data'];
const IMAGE_DATA = /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/i;
// CSS functions that fetch a resource; only same-document references (url(#id)) are allowed.
const CSS_FETCH = /(?:url|image-set|src)\s*\(\s*(?!['"]?#)/i;

// Returns a message when the attribute is forbidden, otherwise null.
// `html` is true for elements in the HTML namespace (false for SVG and MathML).
export function attributeProblem(name, rawValue, html) {
  const n = name.toLowerCase(), local = n.replace(/^xlink:/, '');
  const value = String(rawValue).replace(/[\u0000-\u0020]/g, '');
  if (/^on/.test(n) || n === 'srcdoc') return `Forbidden attribute "${name}"`;
  if (/^(javascript|vbscript):/i.test(value)) return 'Executable URLs are forbidden';
  if (RESOURCE_ATTRS.includes(n)) return `Forbidden attribute "${name}" (external resource)`;
  if (local === 'href' && /^data:/i.test(value)) return 'data: links are forbidden';
  // HTML links navigate only when clicked; SVG href and every src load immediately.
  if ((n === 'src' || local === 'href' && !html) && value && !value.startsWith('#') && !IMAGE_DATA.test(value))
    return 'External resources are forbidden';
  if ((n === 'style' || !html) && CSS_FETCH.test(rawValue)) return 'External resources are forbidden';
  return null;
}

// Style zones (theme, charte) may embed data: resources but never fetch or import anything.
export function styleProblem(css) {
  if (/@import/i.test(css)) return '@import is forbidden in styles';
  for (const m of css.matchAll(/(?:url|image-set|src)\s*\(\s*(['"]?)([^'")\s]*)/gi))
    if (!m[2].startsWith('#') && !/^data:/i.test(m[2])) return 'External resources are forbidden in styles';
  return null;
}

// Entries of the assets zone: images and fonts, base64 only.
export function assetProblem(key, a) {
  if (!/^[a-zA-Z][\w-]*$/.test(key)) return 'Invalid asset identifier';
  if (!a || typeof a !== 'object' || typeof a.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(a.data)) return `Invalid asset "${key}"`;
  if (a.kind === 'font') {
    if (!/^[\w -]+$/.test(a.family || '') || !/^font\/(woff2?|otf|ttf)$/.test(a.type || '') ||
      a.weight !== undefined && !/^\d{3}$/.test(String(a.weight)) || a.style !== undefined && !/^(normal|italic|oblique)$/.test(a.style))
      return `Invalid font "${key}"`;
  } else if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(a.type || '')) return `Invalid asset type "${key}"`;
  return null;
}
