import {tokenize, TokenType as T} from '@csstools/css-tokenizer';

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
const RESOURCE_FUNCTIONS = new Set(['url', 'src', 'image', 'image-set', '-webkit-image-set']);
const SVG_URL_ATTRIBUTES = new Set(['fill', 'stroke', 'filter', 'clip-path', 'mask', 'cursor',
  'marker', 'marker-start', 'marker-mid', 'marker-end', 'color-profile']);

// Token values have already been CSS-unescaped. Quoted url() and every image-set()
// candidate are strings; unquoted url() has its own token. Do not inspect ordinary
// strings (content, font names, MIME types) as URLs. Dynamic URL substitution is refused.
function cssResourceProblem(css, allowData) {
  let malformed = false;
  const tokens = tokenize({css: String(css)}, {onParseError: () => { malformed = true; }});
  const stack = [];
  const closers = new Map([[T.OpenParen, T.CloseParen], [T.OpenSquare, T.CloseSquare], [T.OpenCurly, T.CloseCurly]]);
  const allowed = value => value.startsWith('#') || allowData && /^data:/i.test(value);
  for (const [type, , , , data] of tokens) {
    if (type === T.AtKeyword && data.value.toLowerCase() === 'import') return '@import is forbidden in styles';
    if (type === T.URL && !allowed(data.value)) return 'External resources are forbidden';
    if (type === T.String && RESOURCE_FUNCTIONS.has(stack.at(-1)?.name) && !allowed(data.value))
      return 'External resources are forbidden';
    if (type === T.Function) {
      const name = data.value.toLowerCase();
      if (['var', 'attr'].includes(name) && stack.some(x => RESOURCE_FUNCTIONS.has(x.name)))
        return 'Dynamic resource URLs are forbidden';
      stack.push({name, close: T.CloseParen});
    } else if (closers.has(type)) stack.push({name: '', close: closers.get(type)});
    else if ([T.CloseParen, T.CloseSquare, T.CloseCurly].includes(type)) {
      if (stack.at(-1)?.close !== type) return 'Malformed CSS is forbidden';
      stack.pop();
    }
  }
  return malformed || stack.length ? 'Malformed CSS is forbidden' : null;
}

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
  if (n === 'style' || !html && SVG_URL_ATTRIBUTES.has(local)) return cssResourceProblem(rawValue, false);
  return null;
}

// Style zones (theme, charte) may embed data: resources but never fetch or import anything.
export function styleProblem(css) {
  return cssResourceProblem(css, true);
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
