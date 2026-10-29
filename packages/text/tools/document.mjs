#!/usr/bin/env node
// html-text document tools (T18): the command line of the html-text skill, bundled into
// plugin/skills/html-text/tools/document.mjs (tools/skill.mjs). Node 18+, nothing else.
//   new       <out.html> [--markdown body.md] [--payloads map.json] [--title "…"] [--subtitle "…"]
//             [--cover-line "…"]… [--contents 1–4] [--numbers] [--lang en-GB] [--charte brand.css]
//             [--layout layout.css] [--theme blue|red|green|black] [--font arial|…] [--page a4|letter]
//             [--margins narrow|normal|wide] [--header "…"] [--offline] [--force]
//   pack      <file.html> [--out out.html] [--offline | --standard] [--charte brand.css]
//             [--layout layout.css] [--redraw]
//   add-image <file.html> <image> [--out out.html]
//   convert   <file.html> <id> <section.md> [--payloads map.json] [--drop id,…] [--out section.html]
//   outline   <file.html> [--json]          (sections.mjs, T16)
//   show      <file.html> <id> [--markdown]   (--markdown: section-markdown.mjs, for convert)
//   replace   <file.html> <id> <section.html> [--output out.html]
//   check     <file.html> [--section id] [--json]   (check.mjs)
//   markdown  <file.html> [out.md]                  (markdown.mjs, T15)
// Every command refuses invalid input with all its reasons and then writes nothing (exit code 1);
// 2 is a usage error. FORMAT.md › Document tools.
import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFile } from "../model/parse.mjs";
import { element, text, attr, elements } from "../model/html.mjs";
import { serializeFile } from "../model/file.mjs";
import { assetStore } from "../model/assets.mjs";
import { sectionsOf, articleOf } from "../model/sections.mjs";
import { schema } from "../editor/schema/schema.mjs";
import { articleHTML } from "../editor/schema/serialize.mjs";
import { openFile } from "../editor/schema/document.mjs";
import { CHARTES } from "../../shared/themes/chartes.mjs";
import { FONTS } from "../../shared/themes/fonts.mjs";
import { completeCharte } from "../../shared/charts/css-theme.mjs";
import { checkSource, run as checkCommand } from "./check.mjs";
import { pack as canonicalPack } from "./pack.mjs";
import { replace, run as sectionsCommand } from "./sections.mjs";
import { run as markdownCommand } from "./markdown.mjs";
import { measureFile, offlineECharts, embeddedECharts } from "./build.mjs";
import { guideZone } from "./guide.mjs";
import { compactCSS } from "../theme/compact.mjs";
import { rewrite, readPayloads, imageType, ConvertError } from "./convert.mjs";
import { drawCharts, echartsBytes } from "./previews.mjs";
import { sectionMarkdown } from "./section-markdown.mjs";

const N = schema.nodes;
const here = new URL(".", import.meta.url);
const exists = (url) =>
  access(url).then(
    () => true,
    () => false,
  );
const asset = (name) => new URL(`../assets/${name}`, here);

// ---------- what the tools embed: the skill's copies, or the repository's sources ----------
export async function loadEngine() {
  if (await exists(asset("engine.json")))
    return JSON.parse(await readFile(asset("engine.json"), "utf8"));
  // In the repository: built from the sources (esbuild). The path is computed so that bundling
  // the skill's tool does not include the build.
  const build = await import(new URL("./build.mjs", here).href);
  const { version, code } = await build.buildEngine();
  return { version, code };
}
async function echartsScript() {
  if (await exists(asset("echarts-notices.txt")))
    return offlineECharts(
      (await echartsBytes()).bytes,
      await readFile(asset("echarts-notices.txt"), "utf8"),
    );
  return embeddedECharts();
}
const read = (name, repoPath) =>
  exists(asset(name)).then((skill) =>
    readFile(skill ? asset(name) : new URL(repoPath, here), "utf8"),
  );
// The html-slides default charte, compacted as theme/index.mjs gives it to the fixtures.
export const defaultCharte = async () =>
  compactCSS(await read("default.css", "../../../src/theme/default.css"));
export const defaultLayout = () => read("layout.css", "../theme/layout.css");

// ---------- options ----------
const VALUE = new Set(
  "markdown payloads title subtitle cover-line contents lang charte layout theme font page margins header out drop output section".split(
    " ",
  ),
);
export function parseArgs(argv) {
  const out = { _: [], "cover-line": [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) out._.push(a);
    else if (VALUE.has(a.slice(2))) {
      const v = argv[++i];
      if (v === undefined) throw usage(`${a} needs a value`);
      if (a === "--cover-line") out["cover-line"].push(v);
      else out[a.slice(2)] = v;
    } else out[a.slice(2)] = true;
  }
  return out;
}
class Failure extends Error {
  constructor(message, problems = [], code = 1) {
    super(message);
    this.problems = problems;
    this.code = code;
  }
}
const USAGE = `Usage: document.mjs <command> …
  new <out.html> [--markdown body.md] [--payloads map.json] [--title "…"] [--subtitle "…"] [--cover-line "…"]… [--contents 1-4] [--numbers] [--lang en-GB] [--charte brand.css] [--layout layout.css] [--theme blue|red|green|black] [--font arial|verdana|tahoma|trebuchet|georgia|times] [--page a4|letter] [--margins narrow|normal|wide] [--header "…"] [--offline] [--force]
  pack <file.html> [--out out.html] [--offline | --standard] [--charte brand.css] [--layout layout.css] [--redraw]
  add-image <file.html> <image> [--out out.html]
  convert <file.html> <id> <section.md> [--payloads map.json] [--drop id,…] [--out section.html]
  outline <file.html> [--json] | show <file.html> <id> [--markdown] | replace <file.html> <id> <section.html> [--output out.html]
  check <file.html> [--section id] [--json] | markdown <file.html> [out.md]`;
const usage = (message) => new Failure(`${message}\n${USAGE}`, [], 2);
const oneOf = (name, value, values) => {
  if (value !== undefined && !values.includes(value))
    throw usage(`--${name} is one of ${values.join(", ")}`);
};

// A document's text. Bytes that are not UTF-8 would be rewritten as U+FFFD anywhere in the
// file when it is written back: such a file is refused, as the section tools refuse it.
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
async function readDocument(path) {
  try {
    return UTF8.decode(await readFile(path));
  } catch (error) {
    if (error.code) throw error;
    throw new Failure(`${path} is not valid UTF-8; nothing was written`);
  }
}

// ---------- zones ----------
const zone = (parent, id) =>
  parent.children.find((n) => n.type === "element" && attr(n, "id") === id);
const style = (id, css) => {
  if (/<\/style/i.test(css))
    throw new Failure(`style#${id}: the stylesheet cannot close its element`);
  return element("style", [["id", id]], [text(css.trim())]);
};
const generator = (version) =>
  element("meta", [
    ["name", "generator"],
    ["content", `html-text ${version}`],
  ]);

// A brand charte: the default, or a file whose missing core tokens take the default's values.
async function charteCSS(path, notes) {
  const fallback = await defaultCharte();
  if (!path) return fallback;
  const { css, missing } = completeCharte(
    await readFile(path, "utf8"),
    fallback,
  );
  if (missing.length)
    notes.push(
      `The charte leaves out ${missing.map((n) => `--${n}`).join(", ")}: the default charte's values are used.`,
    );
  return css;
}

// The file's zones around article#doc, with the editor (and ECharts offline) last.
function withScripts(file, engine, echarts) {
  const body = elements(file.html).find((n) => n.name === "body");
  const kept = body.children.filter(
    (n) =>
      !(n.type === "element" && ["engine", "echarts"].includes(attr(n, "id"))),
  );
  if (echarts)
    kept.push(element("script", [["id", "echarts"]], [text(echarts)]));
  kept.push(
    element(
      "script",
      [
        ["id", "engine"],
        ["data-version", engine.version],
      ],
      [text(engine.code)],
    ),
  );
  body.children = kept;
}

// Writes `html` to `path` after checking it: a tool never writes a file with errors.
async function writeChecked(path, html) {
  const report = checkSource(html);
  if (!report.ok)
    throw new Failure(
      "The result would not be valid; nothing was written",
      report.errors.map((f) => `${f.code}: ${f.message} (${f.line}:${f.col})`),
    );
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(path, html);
  return report;
}
const sizeLine = (html) => {
  const s = measureFile(html);
  return `${s.total.toLocaleString("en")} bytes: application code ${s.applicationCode.toLocaleString("en")}, content ${s.content.toLocaleString("en")}, assets ${s.assets.toLocaleString("en")}, guide ${s.guide.toLocaleString("en")}${s.echarts ? `, offline ECharts ${s.echarts.toLocaleString("en")}` : ""}`;
};

// ---------- new ----------
export async function newDocument(args, log = console.log) {
  const [out] = args._;
  if (!out) throw usage("new needs the output file");
  if (!args.force && (await exists(resolve(out))))
    throw new Failure(`${out} already exists (add --force to overwrite)`);
  oneOf("theme", args.theme, Object.keys(CHARTES));
  oneOf(
    "font",
    args.font,
    FONTS.map(([id]) => id),
  );
  oneOf("page", args.page, ["a4", "letter"]);
  oneOf("margins", args.margins, ["narrow", "normal", "wide"]);
  if (args.contents !== undefined && !/^[1-4]$/.test(args.contents))
    throw usage("--contents is a depth from 1 to 4");
  const lang = args.lang ?? "en-GB";
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang))
    throw usage("--lang is a language tag such as en-GB or fr-FR");
  if (args.header !== undefined && !/^\S(.{0,118}\S)?$/.test(args.header))
    throw usage(
      "--header is one line of at most 120 characters, without leading or trailing spaces",
    );
  const notes = [];
  const engine = await loadEngine();
  const title = args.title ?? "";
  const file = {
    doctype: "html",
    children: [],
    html: element(
      "html",
      [["lang", lang]],
      [
        element(
          "head",
          [],
          [
            element("meta", [["charset", "utf-8"]]),
            element("meta", [
              ["name", "viewport"],
              ["content", "width=device-width, initial-scale=1"],
            ]),
            generator(engine.version),
            element("title", [], [text(title || "Document")]),
            element("meta", [
              ["name", "html-text-format-version"],
              ["content", "1"],
            ]),
            guideZone(engine.version),
            style("charte", await charteCSS(args.charte, notes)),
            style(
              "theme",
              args.layout
                ? await readFile(args.layout, "utf8")
                : await defaultLayout(),
            ),
          ],
        ),
        element("body", [], [element("article", [["id", "doc"]])]),
      ],
    ),
  };
  file.children = [file.html];
  // The starting document: the cover and contents, then one empty paragraph that the Markdown
  // replaces.
  const t = (s) => (s ? [schema.text(s)] : []);
  const blocks = [];
  if (title || args.subtitle || args["cover-line"].length)
    blocks.push(
      N.cover.create(null, [
        N.title.create(null, t(title)),
        ...(args.subtitle ? [N.subtitle.create(null, t(args.subtitle))] : []),
        ...args["cover-line"].map((line) => N.paragraph.create(null, t(line))),
      ]),
    );
  if (args.contents)
    blocks.push(N.toc.create({ depth: Number(args.contents) }));
  const start = schema.nodes.doc.create(
    {
      lang,
      headingNumbers: !!args.numbers,
      theme: args.theme ?? null,
      font: args.font ?? null,
      page: args.page ?? null,
      margins: args.margins ?? null,
      header: args.header ?? null,
    },
    [...blocks, N.paragraph.create()],
  );
  const store = assetStore(file);
  const assets = new Set();
  const payloadDir = args.payloads ? dirname(resolve(args.payloads)) : ".";
  const addAsset = async (path, problems, where) => {
    let bytes;
    try {
      bytes = await readFile(resolve(payloadDir, path));
    } catch (error) {
      problems.push(
        `${where}: cannot read ${path} (${error.code ?? error.message})`,
      );
      return null;
    }
    const type = imageType(bytes);
    if (!type) {
      problems.push(
        `${where}: ${path} is not a PNG, JPEG, GIF, WebP or SVG image`,
      );
      return null;
    }
    const key = store.add({ type, data: bytes.toString("base64") });
    assets.add(key);
    return key;
  };
  const { doc, notes: done } = await rewrite(
    { file, doc: start, from: blocks.length, to: blocks.length + 1 },
    args.markdown ? await readFile(args.markdown, "utf8") : "",
    {
      payloads: args.payloads
        ? readPayloads(await readFile(args.payloads, "utf8"))
        : new Map(),
      assets,
      addAsset,
    },
  );
  const saved = store.fileFor(file, doc);
  withScripts(saved, engine, args.offline ? await echartsScript() : null);
  const html = serializeFile(saved, articleHTML(doc));
  const report = await writeChecked(out, html);
  for (const n of [...notes, ...done]) log(`note     ${n}`);
  for (const w of report.warnings)
    log(`warning  ${w.line}:${w.col}  ${w.code}: ${w.message}`);
  log(
    `Created ${out} (html-text ${engine.version}, ${args.offline ? "offline" : "standard"}): ${sizeLine(html)}.`,
  );
}

// ---------- pack ----------
export async function packDocument(args, log = console.log) {
  const [input] = args._;
  if (!input) throw usage("pack needs the document");
  if (args.offline && args.standard)
    throw usage("Choose --offline or --standard, not both");
  const out = args.out ?? input;
  const source = await readDocument(input);
  let packed;
  try {
    packed = canonicalPack(source);
  } catch (error) {
    throw new Failure(
      `${error.message}. Run check for every location; nothing was written.`,
    );
  }
  for (const c of packed.changes)
    log(`${c.op} ${String(c.line).padStart(5)}  ${c.text}`);
  const notes = [];
  const file = parseFile(packed.canonical);
  const head = elements(file.html).find((n) => n.name === "head");
  const body = elements(file.html).find((n) => n.name === "body");
  const offline = args.offline || (!args.standard && !!zone(body, "echarts"));
  const engine = await loadEngine();
  // The tools' zones: generator, guide, and the stylesheets that were asked for.
  const put = (node, before) => {
    const id = attr(node, "id"),
      at = head.children.findIndex(
        (n) =>
          n.type === "element" &&
          (id ? attr(n, "id") === id : attr(n, "name") === "generator"),
      );
    if (at >= 0) head.children[at] = node;
    else {
      const b = head.children.findIndex(
        (n) => n.type === "element" && before(n),
      );
      head.children.splice(b < 0 ? head.children.length : b, 0, node);
    }
  };
  put(generator(engine.version), (n) => n.name === "title");
  put(guideZone(engine.version), (n) => n.name === "style");
  if (args.charte)
    put(style("charte", await charteCSS(args.charte, notes)), () => false);
  if (args.layout)
    put(style("theme", await readFile(args.layout, "utf8")), () => false);
  const { doc: opened } = openFile(file);
  const { doc, drawn, failed } = await drawCharts(file, opened, {
    redraw: !!args.redraw,
  });
  for (const id of failed)
    notes.push(`chart "${id}": no preview could be drawn`);
  withScripts(file, engine, offline ? await echartsScript() : null);
  const html = serializeFile(file, articleHTML(doc));
  const report = await writeChecked(out, html);
  for (const n of notes) log(`note     ${n}`);
  for (const w of report.warnings)
    log(`warning  ${w.line}:${w.col}  ${w.code}: ${w.message}`);
  log(
    `${packed.changes.length} line(s) rewritten into canonical form, ${drawn} chart preview(s) drawn; wrote ${out} (html-text ${engine.version}, ${offline ? "offline" : "standard"}): ${sizeLine(html)}.`,
  );
}

// ---------- add-image ----------
// Adds one image to script#assets and prints its key; everything else stays byte for byte.
export async function addImage(args, log = console.log) {
  const [input, image] = args._;
  if (!input || !image)
    throw usage("add-image needs the document and the image");
  const source = await readDocument(input);
  const report = checkSource(source);
  if (!report.ok)
    throw new Failure(
      "The document has errors: run check",
      report.errors.map((f) => `${f.code}: ${f.message}`),
    );
  const bytes = await readFile(image);
  const type = imageType(bytes);
  if (!type)
    throw new Failure(`${image} is not a PNG, JPEG, GIF, WebP or SVG image`);
  const file = parseFile(source);
  const body = elements(file.html).find((n) => n.name === "body");
  const old = zone(body, "assets");
  const store = assetStore(file);
  const key = store.add({ type, data: bytes.toString("base64") });
  const all = old ? JSON.parse(old.children.map((c) => c.value).join("")) : {};
  all[key] = { type, data: bytes.toString("base64") };
  const json = JSON.stringify(all).replace(/</g, "\\u003c");
  const line = `<script id="assets" type="application/json">${json}</script>`;
  let html;
  if (old)
    html = source.slice(0, old.loc.offset) + line + source.slice(old.loc.end);
  else {
    const next = zone(body, "echarts") ?? zone(body, "engine") ?? null;
    const at = next ? next.loc.offset : body.loc.closing;
    html = `${source.slice(0, at)}${line}\n${source.slice(at)}`;
  }
  await writeChecked(args.out ?? input, html);
  log(key);
  log(
    `Added ${type} ${image} (${bytes.length.toLocaleString("en")} bytes) as asset "${key}"; refer to it as "asset": "${key}" in a payload. Until a figure uses it, check reports it unused.`,
  );
}

// ---------- convert ----------
// The section `id` rewritten from Markdown, as the HTML replace takes; the document is unchanged.
export async function convertSection(source, id, markdown, options = {}) {
  // openFile refuses a document with errors; replace() below checks the rest.
  const file = parseFile(source);
  const found = sectionsOf(articleOf(file));
  const section = found?.sections.find((s) => s.id === id);
  if (!section)
    throw new Failure(
      `No section with the heading ID "${id}": outline lists them`,
    );
  let doc;
  try {
    ({ doc } = openFile(file));
  } catch (error) {
    throw new Failure(
      "The document has errors: run check",
      (error.report?.errors ?? []).map((f) => `${f.code}: ${f.message}`),
    );
  }
  if (doc.childCount !== found.blocks.length)
    throw new Failure(
      "The document's blocks do not match its sections: run pack first",
    );
  const assetsZone = zone(
    elements(file.html).find((n) => n.name === "body"),
    "assets",
  );
  const assets = new Set(
    Object.keys(
      assetsZone
        ? JSON.parse(assetsZone.children.map((c) => c.value).join(""))
        : {},
    ),
  );
  const { doc: next, notes } = await rewrite(
    { file, doc, from: section.from, to: section.to, section },
    markdown,
    { ...options, assets },
  );
  // The section as the whole document now serialises it (labels regenerated).
  const whole = serializeFile(file, articleHTML(next));
  const after = sectionsOf(articleOf(parseFile(whole)));
  const fresh = after.sections.find((s) => s.id === id);
  const html = whole.slice(fresh.start, fresh.end);
  // What replace will check, checked now.
  const result = replace(source, id, html);
  return { html, notes, warnings: result.warnings };
}

async function convertCommand(args, log) {
  const [input, id, markdownFile] = args._;
  if (!input || !id || !markdownFile)
    throw usage("convert needs the document, the section ID and the Markdown");
  const { html, notes, warnings } = await convertSection(
    await readDocument(input),
    id,
    await readFile(markdownFile, "utf8"),
    {
      payloads: args.payloads
        ? readPayloads(await readFile(args.payloads, "utf8"))
        : new Map(),
      drop: args.drop ? args.drop.split(",").map((s) => s.trim()) : [],
    },
  );
  if (args.out) await writeFile(args.out, html);
  else process.stdout.write(html);
  const say = args.out ? log : (m) => console.error(m);
  for (const n of notes) say(`note     ${n}`);
  for (const w of warnings) say(`warning  ${w} (after replace)`);
  if (args.out)
    log(
      `Wrote section "${id}" to ${args.out}: replace it into the document with replace.`,
    );
}

// ---------- show --markdown ----------
async function showMarkdown(args) {
  const [input, id] = args;
  if (!input || !id) {
    console.error(USAGE);
    return 2;
  }
  try {
    process.stdout.write(sectionMarkdown(await readFile(input, "utf8"), id));
    return 0;
  } catch (error) {
    if (!(error instanceof ConvertError)) throw error;
    console.error(error.message);
    return 1;
  }
}

// ---------- the command line ----------
export async function main(argv, log = console.log) {
  const [command, ...rest] = argv;
  // The T15 and T16 commands keep their own command lines.
  if (command === "show" && rest.includes("--markdown"))
    return showMarkdown(rest.filter((a) => a !== "--markdown"));
  if (["outline", "show", "replace"].includes(command))
    return sectionsCommand([command, ...rest]);
  if (command === "check") return checkCommand(rest);
  if (command === "markdown") return markdownCommand(rest);
  const commands = {
    new: newDocument,
    pack: packDocument,
    "add-image": addImage,
    convert: (a) => convertCommand(a, log),
  };
  try {
    if (!Object.hasOwn(commands, command))
      throw usage(`Unknown command ${command ?? ""}`.trim());
    await commands[command](parseArgs(rest), log);
    return 0;
  } catch (error) {
    if (!(error instanceof Failure || error instanceof ConvertError))
      throw error;
    console.error(error.message);
    for (const p of error.problems) console.error(`  ${p}`);
    if (error instanceof ConvertError) console.error("Nothing was written.");
    return error.code ?? 1;
  }
}

// Run as a command, also through a symbolic link or a path with escaped characters.
const isMain = () => {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
};
if (isMain()) process.exitCode = await main(process.argv.slice(2));
