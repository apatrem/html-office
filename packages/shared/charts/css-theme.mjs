// Charte tokens read from CSS text (TH01): the custom properties a charte declares on the root,
// the theme() of index.mjs computed from them without a browser, and the completion of a custom
// charte with the default charte's core tokens. Used by the Node tools of Data and Text.

// Rules whose declarations reach the root element, as theme() reads it.
const ROOT_SELECTORS = [":root", "html", "*"];

// The custom properties a charte declares on the root, by name, in source
// order (a later declaration wins). Only rules selecting the root count, at
// the top level or in an @layer block: declarations in @media or other
// blocks, on other elements or from an @import are not read. Strings, comments and parentheses are skipped as CSS
// tokenizes them, so "/*" in a string or ";" in url(…) ends nothing.
export function charteTokens(css) {
  const tokens = {};
  let depth = 0,
    parens = 0,
    prelude = "",
    root = false,
    layer = -1,
    declaration = "";
  const flush = () => {
    const m = /^\s*--([\w-]+)\s*:([\s\S]*)$/.exec(declaration);
    if (m && m[2].trim()) tokens[m[1]] = m[2].trim();
    declaration = "";
  };
  for (let i = 0; i < css.length; i++) {
    let c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end < 0 ? css.length : end + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c && css[j] !== "\n")
        j += css[j] === "\\" ? 2 : 1;
      c = css.slice(i, j + 1);
      i = j;
    } else if (c === "(") parens++;
    else if (c === ")") parens = Math.max(0, parens - 1);
    else if (parens === 0 && c === "{") {
      if (depth++ === 0) {
        layer = /^\s*@layer\b/i.test(prelude) ? i + 1 : -1;
        root = prelude
          .split(",")
          .some((s) => ROOT_SELECTORS.includes(s.trim().toLowerCase()));
        prelude = declaration = "";
      }
      continue;
    } else if (parens === 0 && c === "}") {
      if (depth === 1 && root) flush();
      // An @layer block is a stylesheet of its own.
      if (depth === 1 && layer >= 0)
        Object.assign(tokens, charteTokens(css.slice(layer, i)));
      depth = Math.max(0, depth - 1);
      continue;
    } else if (parens === 0 && c === ";") {
      if (depth === 0) prelude = "";
      else if (depth === 1 && root) flush();
      continue;
    }
    if (depth === 0) prelude += c;
    else if (depth === 1 && root) declaration += c;
  }
  // The end of the stylesheet closes an open rule, as in the browser.
  if (depth === 1 && root) flush();
  if (depth === 1 && layer >= 0)
    Object.assign(tokens, charteTokens(css.slice(layer)));
  return tokens;
}

// The theme() of the shared chart module, read from charte CSS text: the
// document's tokens, then a built-in charte's overlay, with var() references
// resolved as the browser computes them.
export function cssTheme(css, overlay = {}) {
  const tokens = { ...charteTokens(css), ...overlay };
  // var(--name, fallback) with nested fallbacks, as CSS substitutes them.
  function resolve(value, depth = 0) {
    if (depth > 10) return "";
    let out = "",
      i = 0;
    for (let start; (start = value.indexOf("var(", i)) >= 0; ) {
      let level = 0,
        end = start + 3;
      for (; end < value.length; end++)
        if (value[end] === "(") level++;
        else if (value[end] === ")" && --level === 0) break;
      const inner = value.slice(start + 4, end),
        comma = inner.indexOf(","),
        name = (comma < 0 ? inner : inner.slice(0, comma))
          .trim()
          .replace(/^--/, "");
      out +=
        value.slice(i, start) +
        (tokens[name] !== undefined
          ? resolve(tokens[name], depth + 1)
          : comma < 0
            ? ""
            : resolve(inner.slice(comma + 1), depth + 1));
      i = end + 1;
    }
    return (out + value.slice(i)).trim();
  }
  for (const key of Object.keys(tokens)) tokens[key] = resolve(tokens[key]);
  // A token the charte leaves out reads as "", as getPropertyValue() does.
  const get = (name) => tokens[name] ?? "";
  return {
    ink: get("ink"),
    acc: get("acc"),
    mid: get("mid"),
    lig: get("lig"),
    alert: get("alert"),
    t2: get("t2"),
    bd: get("bd"),
    w: tokens.bg || "#fff",
    font: tokens.font || "Arial, sans-serif",
  };
}

// The charte's core tokens: colours and font. The optional role tokens
// (--header-bg…) fall back to these in the editor's own CSS.
export const CHARTE_TOKENS = [
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
  "font",
];

// A custom charte that leaves core tokens out takes the default charte's
// value for each of them, in a cascade layer named first (an @layer
// statement may precede @import): it ranks below every other declaration,
// including those charteTokens() does not read (@import, @media).
export function completeCharte(css, defaults) {
  const own = charteTokens(css),
    base = charteTokens(defaults),
    missing = CHARTE_TOKENS.filter((name) => !(name in own));
  if (!missing.length) return { css, missing };
  const rule = missing.map((name) => `--${name}:${base[name]}`).join(";");
  return {
    css: `@layer charte-defaults;\n${css.replace(/\s*$/, "")}\n/* Tokens this charte leaves out, from the default charte. */\n@layer charte-defaults{:root{${rule}}}\n`,
    missing,
  };
}
