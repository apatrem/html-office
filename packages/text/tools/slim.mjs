// What the Text build leaves out of the editor because the editor never uses it (code budget, T17).
// Nothing here changes what runs: each step removes code or styles that cannot be reached, and
// fails the build if a later change starts to reach them.
//
// - commonmark has no "sideEffects" field, so esbuild keeps every module its index re-exports;
//   the editor imports Parser, HtmlRenderer and Node, never XmlRenderer.
// - prosemirror-tables builds three header-toggling commands and the column-resizing plugin's key
//   when it loads; the editor uses none of them (it has its own column resizing), and the calls
//   are marked pure so that esbuild drops them with the code only they reach. (A PluginKey
//   records its name to make the next key of that name unique; no other key is called
//   "tableColumnResizing".)
// - The shared shell's stylesheets carry rules for Data's pickers and panels; Text's build drops
//   the rules whose selectors name a class from UNUSED_SHELL_CLASSES, and the build stops if the
//   editor's code names one of those classes.
// - The shared icon set keeps only the icons the editor's code names in a string literal (icon
//   names are always literals: dom.mjs's icon(name) and button({ ic })).

import { readFile } from "node:fs/promises";
import { ICONS } from "../../shared/shell/icons.mjs";

// Packages whose modules have no side effects of their own, so unused ones are dropped.
const SIDE_EFFECT_FREE = /\/node_modules\/(commonmark|mdurl)\//;

export const sideEffectFree = {
  name: "side-effect-free",
  setup(b) {
    b.onResolve({ filter: /.*/ }, async (a) => {
      if (a.pluginData?.sideEffectFree) return;
      const r = await b.resolve(a.path, {
        kind: a.kind,
        importer: a.importer,
        resolveDir: a.resolveDir,
        pluginData: { sideEffectFree: true },
      });
      if (r.errors.length || !SIDE_EFFECT_FREE.test(r.path)) return r;
      return { ...r, sideEffects: false };
    });
  },
};

// Top-level bindings of bundled libraries whose initial call has no side effect: [module, names].
export const PURE_CALLS = [
  [
    "prosemirror-tables/dist/index.js",
    [
      "toggleHeaderRow",
      "toggleHeaderColumn",
      "toggleHeaderCell",
      "columnResizingPluginKey",
    ],
  ],
];

// Marks those calls /* @__PURE__ */; a binding that is not found stops the build (the library
// changed: check the list again).
export const pureCalls = {
  name: "pure-calls",
  setup(b) {
    for (const [module, names] of PURE_CALLS)
      b.onLoad(
        {
          filter: new RegExp(
            `/node_modules/${module.replace(/[./]/g, "\\$&")}$`,
          ),
        },
        async (a) => {
          let code = await readFile(a.path, "utf8");
          for (const name of names) {
            const at = new RegExp(`^(var|let|const) ${name} = (?=\\w)`, "m");
            if (!at.test(code))
              throw new Error(`${module}: no top-level call bound to ${name}`);
            code = code.replace(at, "$& /* @__PURE__ */ ");
          }
          return { loader: "js", contents: code };
        },
      );
  },
};

// Classes of packages/shared/shell/*.css that no Text code creates: Data's colour, fill and border
// pickers (pickers.mjs), its cell-style grid and key-value table (panels.mjs), its link target,
// and the panel button row. A family ("sh-sw-ink", "sh-cs-note") is matched by its stem.
export const UNUSED_SHELL_CLASSES =
  /^sh-(pick|chip|fsep|colour|sw[\w-]*|pop-(h|n|sw|borders)|link-target|bpresets|seg|line[\w-]*|kv|style-grid|st-[\w-]*|cs-[\w-]*|prow)$/;

// Names in the editor's code that would build one of those classes: whole names and stems
// ("sh-sw-" in `sh-sw-${token}`). The code is the bundle built without its stylesheets.
export function unusedClassesNamed(code, unused = UNUSED_SHELL_CLASSES) {
  return [...new Set(code.match(/[\w-]+/g))].filter((w) => unused.test(w));
}

// Splits minified CSS at the top level of `text`: [prelude, body] per rule, body null for a
// statement. Strings, parentheses and brackets are skipped as units.
function blocks(text) {
  const out = [];
  let i = 0,
    start = 0;
  const skip = (j) => {
    const q = text[j];
    if (q === '"' || q === "'") {
      for (j++; j < text.length && text[j] !== q; j++)
        if (text[j] === "\\") j++;
      return j;
    }
    if (q === "(" || q === "[") {
      const close = q === "(" ? ")" : "]";
      for (j++; j < text.length && text[j] !== close; j++) j = skip(j);
      return j;
    }
    return j;
  };
  while (i < text.length) {
    const c = text[i];
    if (c === "{") {
      let depth = 1,
        j = i + 1;
      for (; j < text.length && depth; j++) {
        j = skip(j);
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
      }
      out.push([text.slice(start, i), text.slice(i + 1, j - 1)]);
      i = start = j;
    } else if (c === ";") {
      out.push([text.slice(start, i + 1), null]);
      i = start = i + 1;
    } else i = skip(i) + 1;
  }
  if (text.slice(start).trim()) throw new Error("Unterminated CSS rule");
  return out;
}

// The selector list's members (commas inside :is(), :not() or attributes stay).
function selectors(prelude) {
  const out = [];
  let depth = 0,
    start = 0,
    quote = null;
  for (let i = 0; i < prelude.length; i++) {
    const c = prelude[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && !depth) {
      out.push(prelude.slice(start, i));
      start = i + 1;
    }
  }
  out.push(prelude.slice(start));
  return out;
}

// Minified CSS without the selectors that name an unused class, and without rules (in @media
// too) left with no selector. Other at-rules are kept as they are.
export function pruneCSS(css, unused = UNUSED_SHELL_CLASSES) {
  // Class tokens of a selector: strings and attribute conditions hold none.
  const names = (selector) =>
    [
      ...selector
        .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, "")
        .replace(/\[[^\]]*\]/g, "")
        .matchAll(/\.([\w-]+)/g),
    ].some((m) => unused.test(m[1]));
  return blocks(css)
    .map(([prelude, body]) => {
      if (body === null) return prelude;
      if (/^@media\b/.test(prelude)) {
        const inner = pruneCSS(body, unused);
        return inner ? `${prelude}{${inner}}` : "";
      }
      if (prelude.startsWith("@")) return `${prelude}{${body}}`;
      const kept = selectors(prelude).filter((s) => !names(s));
      return kept.length ? `${kept.join(",")}{${body}}` : "";
    })
    .join("");
}

// The icons named by a string literal in the editor's code (built with an empty icon set).
export function iconsNamed(code, icons = ICONS) {
  const literals = new Set(
    [...code.matchAll(/(["'`])([A-Za-z]\w*)\1/g)].map((m) => m[2]),
  );
  return Object.fromEntries(
    Object.entries(icons).filter(([name]) => literals.has(name)),
  );
}
