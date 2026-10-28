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
    all = { ...all, ...original };
    urls.clear();
  };
  load(file);
  return {
    // A draft restored with other zones brings its own assets.
    reset: load,
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
}
