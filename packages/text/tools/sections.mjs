#!/usr/bin/env node
// Section tooling for long documents (T16): work on one section of a Text file at a time.
//   node sections.mjs outline <document.html> [--json]      headings, IDs, numbers, word counts
//   node sections.mjs show <document.html> <id>             one section, exactly as in the file
//   node sections.mjs replace <document.html> <id> <section.html> [--output <out.html>]
// A section runs from its heading to the next heading of the same or a higher level (FORMAT.md).
// replace swaps that slice for the given HTML: everything outside it stays byte for byte as it
// was, and the result must pass check.mjs. Anything else is refused and nothing is written.
// Exit code 1 on a refusal or an unknown ID, 2 on a usage error.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { parseFile } from "../model/parse.mjs";
import { sectionsOf, articleOf } from "../model/sections.mjs";
import { canonicalize } from "../editor/schema/document.mjs";
import { numbering, fileFormat } from "../editor/numbering.mjs";
import { checkSource } from "./check.mjs";

export class SectionError extends Error {
  constructor(message, problems = []) {
    super(message);
    this.problems = problems;
  }
}

// The sections of a source, with heading numbers and titles once the file is valid.
// report: check.mjs's report of the source, when the caller has it; numbers: false leaves the
// heading numbers out (one parse less).
export function outline(source, { report, numbers: wanted = true } = {}) {
  const file = parseFile(source);
  const article = articleOf(file);
  if (!article) throw new SectionError("The file has no article#doc");
  const found = sectionsOf(article);
  if (!found)
    throw new SectionError(
      "The article holds markup the HTML parser repaired (such as a stray </p> or a missing </article>): run check.mjs and pack.mjs",
    );
  const { blocks, sections } = found;
  report ??= checkSource(source);
  let numbers = new Map();
  if (report.ok && wanted) {
    const { doc } = canonicalize(source, parseFile);
    numbers = new Map(
      numbering(doc, { format: fileFormat(file) }).headings.map((h) => [
        h.id,
        h,
      ]),
    );
  }
  const text = (node) =>
    node.type === "text"
      ? node.value
      : (node.children ?? []).map(text).join("");
  for (const s of sections) {
    const h = numbers.get(s.id);
    s.number = h?.number ?? null;
    s.title = h?.text ?? text(blocks[s.from].node).replace(/\s+/g, " ").trim();
  }
  return { file, report, blocks, sections };
}

const find = (sections, id) => {
  const section = sections.find((s) => s.id === id);
  if (!section)
    throw new SectionError(
      `No section with the heading ID "${id}": outline lists them`,
    );
  return section;
};

export function show(source, id) {
  const { start, end } = find(outline(source).sections, id);
  return source.slice(start, end);
}

// Lines as the HTML parser counts them.
const lineOf = (text, offset) => text.slice(0, offset).split(/\r\n?|\n/).length;
const counted = (warnings) => {
  const out = new Map();
  for (const w of warnings) {
    const key = `${w.code}: ${w.message}`;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
};

// The source with the section `id` replaced by `html` (the section's new HTML, its heading first).
// Returns {output, start, end, length, normalised, warnings}: the section's old range, its new
// length, whether the HTML was rewritten into canonical form, and check's new warnings.
export function replace(source, id, html) {
  const before = outline(source, { numbers: false });
  if (!before.report.ok)
    throw new SectionError(
      "The document has errors: run check.mjs",
      before.report.errors,
    );
  const odd = before.report.warnings.find((w) => w.code === "not-canonical");
  if (odd)
    throw new SectionError(
      `The document is not in canonical form at line ${odd.line}: run pack.mjs first`,
    );
  const target = find(before.sections, id);
  if (!html.trim()) throw new SectionError("The replacement is empty");
  // The replacement ends as the section did: with a line break, unless the section was the
  // article's last text, written without one.
  if (!html.endsWith("\n") && source[target.end - 1] === "\n") html += "\n";
  const prefix = source.slice(0, target.start),
    suffix = source.slice(target.end);
  const candidate = prefix + html + suffix;
  const first = lineOf(candidate, prefix.length);
  // Findings in the replacement are located by its own lines, the others by the document's.
  const added = html.split("\n").length - 1,
    removed = source.slice(target.start, target.end).split("\n").length - 1;
  const where = (f) =>
    !f.line
      ? ""
      : f.line < first
        ? ` (document line ${f.line})`
        : f.line < first + added
          ? ` (replacement line ${f.line - first + 1})`
          : ` (document line ${f.line - added + removed})`;
  const report = checkSource(candidate);
  if (!report.ok)
    throw new SectionError(
      "The document would not be valid",
      report.errors.map((f) => `${f.code}: ${f.message}${where(f)}`),
    );
  // A replacement in another spelling is rewritten into canonical form, if that changes nothing
  // outside it.
  const output = report.warnings.some((w) => w.code === "not-canonical")
    ? canonicalize(candidate, parseFile).canonical
    : candidate;
  if (
    !output.startsWith(prefix) ||
    !output.endsWith(suffix) ||
    output.length < prefix.length + suffix.length
  )
    throw new SectionError(
      "The replacement would change the document outside the section (an unclosed or misplaced element?)",
    );
  const length = output.length - prefix.length - suffix.length;
  const final = output === candidate ? report : checkSource(output);
  const after = outline(output, { report: final, numbers: false });
  const section = after.sections.find((s) => s.start === target.start);
  const problems = [];
  if (section?.id !== id)
    problems.push(`The replacement must start with the heading id="${id}"`);
  else if (section.level !== target.level)
    problems.push(
      `The heading must stay a level ${target.level} heading (h${target.level}): changing the level changes other sections`,
    );
  else if (section.end !== target.start + length)
    problems.push(
      `The replacement must hold one section: a heading of level ${target.level} or higher, a cover or a comments section inside it would end it early`,
    );
  // Protected content enters only as it was: each block kept from the old section, byte for
  // byte, at most as many times as it was there.
  const kept = new Map();
  before.blocks.slice(target.from, target.to).forEach((b, i) => {
    if (!before.report.blocks[target.from + i]?.protected) return;
    const bytes = source.slice(b.start, b.end);
    kept.set(bytes, (kept.get(bytes) ?? 0) + 1);
  });
  after.blocks.forEach((b, i) => {
    const inside = b.start >= target.start && b.start < target.start + length;
    if (!inside || !after.report.blocks[i]?.protected) return;
    const bytes = output.slice(b.start, b.end);
    if (kept.get(bytes) > 0) kept.set(bytes, kept.get(bytes) - 1);
    else
      problems.push(
        `New content outside the subset at replacement line ${lineOf(output, b.start) - first + 1}: it would be a protected block`,
      );
  });
  // References from the rest of the document must still reach their targets.
  const old = counted(before.report.warnings);
  const fresh = [];
  for (const [key, n] of counted(final.warnings))
    for (let k = old.get(key) ?? 0; k < n; k++) fresh.push(key);
  for (const key of fresh.filter((k) => k.startsWith("missing-target")))
    problems.push(`${key}: keep the ID or change the cross-reference first`);
  if (problems.length)
    throw new SectionError("The replacement was refused", problems);
  return {
    output,
    start: target.start,
    end: target.end,
    length,
    normalised: output !== candidate,
    warnings: fresh,
  };
}

const usage = `usage: sections.mjs outline <document.html> [--json]
       sections.mjs show <document.html> <id>
       sections.mjs replace <document.html> <id> <section.html> [--output <out.html>]`;

function printOutline({ sections }) {
  const lines = [
    "words  own    id                          heading",
    ...sections.map(
      (s) =>
        `${String(s.words).padStart(5)}  ${String(s.own).padStart(5)}  ${s.id.padEnd(26)}  ${"  ".repeat(s.level - 1)}${s.number ? s.number + " " : ""}${s.title}`,
    ),
  ];
  const top = sections.filter((s) => !s.parent);
  lines.push(
    `${sections.length} section(s), ${top.reduce((n, s) => n + s.words, 0)} words in sections`,
  );
  return lines.join("\n");
}

// Run as a command, also through a symbolic link or a path with escaped characters.
const main = () => {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false; // standard input, or no script at all
  }
};
if (main()) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const at = args.indexOf("--output");
  const target = at >= 0 ? args.splice(at, 2)[1] : null;
  const [command, path, id, input] = args.filter((a) => a !== "--json");
  const ok =
    (at < 0 || (target && !target.startsWith("--") && command === "replace")) &&
    { outline: path, show: path && id, replace: path && id && input }[command];
  if (!ok) {
    console.error(usage);
    process.exit(2);
  }
  // Bytes that are not UTF-8 would be rewritten as U+FFFD, outside the section too: refused.
  const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const read = async (file) => {
    const bytes = await readFile(file);
    try {
      return { bytes, text: utf8.decode(bytes) };
    } catch {
      throw new SectionError(`${file} is not valid UTF-8`);
    }
  };
  try {
    const { bytes, text: source } = await read(path);
    if (command === "outline") {
      const result = outline(source);
      console.log(
        json
          ? JSON.stringify(
              result.sections.map(({ from, to, ...s }) => s),
              null,
              2,
            )
          : printOutline(result),
      );
    } else if (command === "show") process.stdout.write(show(source, id));
    else {
      const result = replace(source, id, (await read(input)).text);
      const written = Buffer.from(result.output);
      const head = Buffer.byteLength(source.slice(0, result.start)),
        tail = Buffer.byteLength(source.slice(result.end));
      // The bytes around the section, compared as bytes.
      if (
        !written.subarray(0, head).equals(bytes.subarray(0, head)) ||
        !written
          .subarray(written.length - tail)
          .equals(bytes.subarray(bytes.length - tail))
      )
        throw new SectionError("The file would change outside the section");
      const out = target ?? path;
      // Written to a new file of its own next to the destination (never an existing one, never
      // through a link), then renamed over it: never a half-written file.
      const temporary = `${out}.${randomBytes(6).toString("hex")}.tmp`;
      await writeFile(temporary, written, { flag: "wx" });
      try {
        await rename(temporary, out);
      } catch (error) {
        // Only the file this run created is removed.
        await rm(temporary, { force: true });
        throw error;
      }
      const lines = (a, b) => `${lineOf(source, a)}–${lineOf(source, b) - 1}`;
      console.log(
        `Replaced section "${id}" (lines ${lines(result.start, result.end)}, now ${lineOf(result.output, result.start)}–${lineOf(result.output, result.start + result.length) - 1})${result.normalised ? ", rewritten into canonical form" : ""}; everything else is unchanged. Wrote ${out}.`,
      );
      for (const w of result.warnings) console.log(`warning  ${w}`);
    }
  } catch (error) {
    if (!(error instanceof SectionError)) throw error;
    console.error(error.message);
    for (const p of error.problems)
      console.error(
        `  ${typeof p === "string" ? p : `${p.code}: ${p.message}`}`,
      );
    console.error("Nothing was written.");
    process.exit(1);
  }
}
