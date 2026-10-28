// The asset store of a Text file (T12), Node and browser: the assets of the captured file tree
// and those added while editing. Saving writes only the assets the document uses, plus fonts
// (FORMAT.md › File zones, the Slides asset contract); an unchanged set keeps the zone's bytes.
import { attr, element, text } from "./html.mjs";
import { usedAssets } from "../editor/images.mjs";

const zoneOf = (file) => {
  const body = file.html.children.find((n) => n.name === "body");
  return body.children.find(
    (n) => n.type === "element" && attr(n, "id") === "assets",
  );
};

// The assets of a file (its captured tree) and those added while editing.
export function assetStore(file) {
  let original = {},
    all = {};
  const urls = new Map();
  const load = (tree) => {
    const zone = zoneOf(tree);
    try {
      original = zone
        ? JSON.parse(zone.children.map((c) => c.value).join(""))
        : {};
    } catch {
      original = {};
    }
    // Restoring a draft replaces the document and its history: the previous assets go.
    all = { ...original };
    urls.clear();
    store.version++;
  };
  const store = {
    version: 0,
    // A draft restored with other zones brings its own assets.
    reset: load,
    // The fonts of the store: [{family, type, data, weight, style}].
    fonts: () => Object.values(all).filter((a) => a.kind === "font"),
    url(key) {
      const a = all[key];
      if (!a?.data) return null;
      if (!urls.has(key))
        urls.set(key, `data:${a.type || "image/png"};base64,${a.data}`);
      return urls.get(key);
    },
    // Adds an image asset ({type, data}) under a fresh key: a1, a2…
    add(asset) {
      let n = 1;
      while (all[`a${n}`]) n++;
      all[`a${n}`] = { type: asset.type, data: asset.data };
      return `a${n}`;
    },
    // The file tree to save for `doc`: its assets zone holds the used images and every font.
    // The same keys as opened keep the zone unchanged.
    fileFor(tree, doc) {
      const used = usedAssets(doc);
      const keep = Object.fromEntries(
        Object.entries(all).filter(
          ([k, a]) => used.has(k) || a.kind === "font",
        ),
      );
      const keys = Object.keys(keep);
      const before = Object.keys(original);
      if (
        keys.length === before.length &&
        keys.every((k) => k in original && all[k] === original[k])
      )
        return tree;
      const zone = element(
        "script",
        [
          ["id", "assets"],
          ["type", "application/json"],
        ],
        [text(JSON.stringify(keep).replace(/</g, "\\u003c"))],
      );
      const swap = (node) => {
        if (node.name !== "body") return node;
        const children = node.children.filter(
          (n) => !(n.type === "element" && attr(n, "id") === "assets"),
        );
        if (keys.length) {
          // After article#doc, before the editor (FORMAT.md › File zones).
          const at = children.findIndex(
            (n) =>
              n.type === "element" &&
              ["engine", "echarts"].includes(attr(n, "id")),
          );
          children.splice(at < 0 ? children.length : at, 0, zone);
        }
        return { ...node, children };
      };
      return {
        ...tree,
        html: { ...tree.html, children: tree.html.children.map(swap) },
      };
    },
  };
  load(file);
  return store;
}

// The fonts of the asset store as @font-face rules. Their fields passed the asset contract when
// the file or draft was opened; each is checked again here, and a font that fails is left out,
// so no field can end the rule.
const FONT = {
  family: /^[\w -]{1,100}$/,
  type: /^font\/(woff2?|otf|ttf)$/,
  data: /^[A-Za-z0-9+/]*={0,2}$/,
};
export const fontCSS = (store) =>
  store
    .fonts()
    .filter(
      (a) =>
        Object.entries(FONT).every(([k, re]) => re.test(a[k] ?? "")) &&
        (a.weight === undefined || /^\d{3}$/.test(String(a.weight))) &&
        (a.style === undefined || /^(normal|italic|oblique)$/.test(a.style)),
    )
    .map(
      (a) =>
        `@font-face{font-family:"${a.family}";src:url(data:${a.type};base64,${a.data});font-weight:${a.weight ?? 400};font-style:${a.style ?? "normal"}}`,
    )
    .join("");
