#!/usr/bin/env node
// html-text checker: validates a document against the canonical subset (FORMAT.md).
//   node check.mjs <document.html> [--section <id>] [--json]
// Lists errors (rejected), protected blocks (kept, not editable) and warnings, with line:column
// and the section they are in (T16), then what was checked: IDs, cross-references, assets and
// comment anchors. --section lists only the findings inside that section (sections.mjs outline).
// A valid document that is not in canonical form gets a not-canonical warning: run pack.mjs.
// Exit code 1 when at least one error remains (in the whole document, also with --section).
import { readFile } from "node:fs/promises";
import { parseFile } from "../model/parse.mjs";
import { validateFile } from "../model/validate.mjs";
import { canonicalize } from "../editor/schema/document.mjs";
import { attr, classes } from "../model/html.mjs";
import { usedAssets } from "../editor/images.mjs";
import { numbering, fileFormat } from "../editor/numbering.mjs";
import { sectionsOf, sectionAt, articleOf } from "../model/sections.mjs";

const excerpt = (text, offset) =>
  JSON.stringify(text.slice(offset, offset + 40));

// Generated content the editor would rewrite (T08): cross-reference labels and contents lists
// that differ from the numbering, located in the source. Protected blocks are left as written.
function staleFindings(file, doc, blocks) {
  const result = numbering(doc, { format: fileFormat(file) });
  const xrefs = [],
    tocs = [];
  const walk = (node) => {
    if (node.type !== "element") return;
    if (node.name === "a" && classes(node).includes("xref")) xrefs.push(node);
    else if (node.name === "nav" && classes(node).includes("toc"))
      tocs.push(node);
    node.children.forEach(walk);
  };
  for (const block of blocks) if (!block.protected) walk(block.node);
  const text = (node) => node.children.map((c) => c.value ?? "").join("");
  const at = (node) =>
    node.loc ? { line: node.loc.line, col: node.loc.col } : {};
  const out = [];
  result.xrefs.forEach((x, i) => {
    const node = xrefs[i];
    if (x.label !== null && node && text(node) !== x.label)
      out.push({
        code: "stale-label",
        message: `Cross-reference to "${x.target}" says ${JSON.stringify(text(node))}, not ${JSON.stringify(x.label)}: the editor rewrites it on open and save`,
        path: "article#doc",
        ...at(node),
      });
  });
  const entries = (list) =>
    list.map((e) => [e.target, e.label, entries(e.children)]);
  result.tocs.forEach((t, i) => {
    if (
      JSON.stringify(entries(doc.nodeAt(t.pos).attrs.entries)) !==
      JSON.stringify(entries(t.entries))
    )
      out.push({
        code: "stale-contents",
        message:
          "Contents differ from the headings: the editor rewrites them on open and save",
        path: "article#doc",
        ...at(tocs[i]),
      });
  });
  return out;
}

// Image assets no image refers to (T12): the editor leaves them out when it saves.
function unusedAssets(file, doc) {
  const body = file.html.children.find((n) => n.name === "body");
  const zone = body.children.find(
    (n) => n.type === "element" && attr(n, "id") === "assets",
  );
  if (!zone) return [];
  const used = usedAssets(doc);
  return Object.entries(JSON.parse(zone.children.map((c) => c.value).join("")))
    .filter(([key, a]) => a.kind !== "font" && !used.has(key))
    .map(([key]) => ({
      code: "unused-asset",
      message: `Asset "${key}" is used by no image: the editor leaves it out when it saves`,
      path: "script#assets",
      ...(zone.loc ? { line: zone.loc.line, col: zone.loc.col } : {}),
    }));
}

// What the checks covered, counted in the source: headings and figures (their IDs), cross-
// references, image assets and comment threads with their anchors (T16).
function coverage(file) {
  const c = { headings: 0, figures: 0, xrefs: 0, images: 0, anchors: 0 };
  const walk = (node) => {
    if (node.type !== "element") return;
    const k = classes(node);
    if (/^h[1-4]$/.test(node.name) && !k.includes("title")) c.headings++;
    else if (node.name === "figure") c.figures++;
    else if (node.name === "a" && k.includes("xref")) c.xrefs++;
    else if (node.name === "img") c.images++;
    else if (node.name === "mark" && k.includes("comment")) c.anchors++;
    else if (node.name === "aside" && k.includes("comment-thread"))
      c.threads = (c.threads ?? 0) + 1;
    node.children.forEach(walk);
  };
  const article = articleOf(file);
  if (article) walk(article);
  const body = file.html?.children.find((n) => n.name === "body");
  const zone = body?.children.find(
    (n) => n.type === "element" && attr(n, "id") === "assets",
  );
  try {
    c.assets = Object.keys(
      JSON.parse(zone?.children.map((n) => n.value).join("") || "{}"),
    ).length;
  } catch {
    c.assets = 0;
  }
  c.threads ??= 0;
  return c;
}

// Each finding with a line gets the ID of the innermost section it is in (or none).
function locate(source, file, report) {
  const article = articleOf(file);
  const found = article && sectionsOf(article);
  if (!found) return;
  report.sections = found.sections;
  // Line starts as the HTML parser counts lines: after CR LF, CR or LF.
  const starts = [0];
  for (const m of source.matchAll(/\r\n?|\n/g))
    starts.push(m.index + m[0].length);
  for (const f of [...report.errors, ...report.protected, ...report.warnings])
    if (f.line)
      f.section =
        sectionAt(report.sections, starts[f.line - 1] + f.col - 1)?.id ?? null;
}

export function checkSource(source) {
  const parsed = parseFile(source);
  const report = validateFile(parsed);
  report.coverage = coverage(parsed);
  if (!report.ok) {
    locate(source, parsed, report);
    return report;
  }
  const { canonical, difference, unstable, file, doc } = canonicalize(
    source,
    parseFile,
  );
  if (unstable) {
    report.ok = false;
    report.errors.push({
      code: "unstable",
      message: `Cannot be saved faithfully: ${unstable}. Usually markup the HTML parser repaired, inside a protected block`,
      path: "article#doc",
    });
  } else if (difference)
    report.warnings.push({
      code: "not-canonical",
      message: `Not in canonical form: expected ${excerpt(canonical, difference.offset)}, found ${excerpt(source, difference.offset)}. pack.mjs rewrites it`,
      path: "document",
      line: difference.line,
      col: difference.col,
    });
  if (!unstable)
    report.warnings.push(
      ...staleFindings(file, doc, report.blocks),
      ...unusedAssets(file, doc),
    );
  locate(source, parsed, report);
  return report;
}

export async function checkFile(file) {
  return checkSource(await readFile(file, "utf8"));
}

const at = (f) =>
  (f.line ? `${f.line}:${f.col}` : "-") + (f.section ? ` §${f.section}` : "");

// The findings inside one section (sections.mjs outline lists the IDs), or null for an unknown ID.
export function sectionReport(report, id) {
  const section = report.sections?.find((s) => s.id === id);
  if (!section) return null;
  const inside = (f) =>
    f.section !== undefined &&
    f.section !== null &&
    report.sections.some(
      (s) =>
        s.id === f.section && s.start >= section.start && s.start < section.end,
    );
  return {
    ...report,
    errors: report.errors.filter(inside),
    protected: report.protected.filter(inside),
    warnings: report.warnings.filter(inside),
    section: id,
  };
}

export function formatReport(report) {
  const lines = [
    ...report.errors.map(
      (f) => `error      ${at(f)}  ${f.code}: ${f.message} (${f.path})`,
    ),
    ...report.protected.map(
      (f) => `protected  ${at(f)}  ${f.path}: ${f.reasons.join("; ")}`,
    ),
    ...report.warnings.map(
      (f) => `warning    ${at(f)}  ${f.code}: ${f.message} (${f.path})`,
    ),
  ];
  lines.push(
    `${report.errors.length} error(s), ${report.protected.length} protected block(s), ${report.warnings.length} warning(s)${report.section ? ` in section ${report.section}` : ""}`,
  );
  const c = report.coverage;
  if (c && !report.section) {
    const n = (code) => report.warnings.filter((w) => w.code === code).length;
    lines.push(
      `Checked ${c.headings} heading(s) and ${c.figures} figure(s) with their IDs, ${c.xrefs} cross-reference(s) (${n("missing-target")} without target), ${c.images} image(s) and ${c.assets} asset(s) (${n("unused-asset")} unused), ${c.threads} comment thread(s) and ${c.anchors} anchor(s) (${n("orphaned-thread")} orphaned)`,
    );
  }
  return lines.join("\n");
}

// The command line, also run by document.mjs (T18). Returns the exit code.
export async function run(argv) {
  const args = [...argv];
  const at = args.indexOf("--section");
  const id = at >= 0 ? args.splice(at, 2)[1] : null;
  const file = args.find((a) => !a.startsWith("--"));
  if (!file || (at >= 0 && !id)) {
    console.error("usage: check.mjs <document.html> [--section <id>] [--json]");
    return 2;
  }
  const whole = await checkFile(file);
  const report = id ? sectionReport(whole, id) : whole;
  if (!report) {
    console.error(
      `No section with the heading ID "${id}": sections.mjs outline lists them`,
    );
    return 1;
  }
  const { blocks, sections, ...findings } = report;
  console.log(
    args.includes("--json")
      ? JSON.stringify(findings, null, 2)
      : formatReport(report),
  );
  return report.ok ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`)
  process.exitCode = await run(process.argv.slice(2));
