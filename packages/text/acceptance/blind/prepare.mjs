#!/usr/bin/env node
// T20 blind-test kit: prepares a kit folder outside the repository for a person to run
// (docs/blind-tests/TEXT-T20.md). Node only, no browser.
//
//   A/          the only folder given to the HTML-only session: the T19 report with three
//               comment threads, one carrying an instruction addressed to an assistant;
//   B/          the working folder of the skill session: its inputs (a brief, a cash update, a
//               colleague's Markdown draft, the T19 report and the 100-page fixture);
//   skill/      the html-text skill to install in the skill session, copied from the
//               repository's plugin/skills/html-text or from --skill (an extracted archive);
//   prompts-A.md, prompts-B.md   the prompts, pasted one at a time;
//   reference/  the baselines the scores compare with: never shown to either session.
//
// The report is built as T19 builds it (outline pass, then one convert/replace per section),
// without the browser review step: the threads are written into the canonical HTML here and
// the file is packed and checked.
//
// Usage: node packages/text/acceptance/blind/prepare.mjs <kit-folder> [--skill <dir>]
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REVIEW, LONG, THREADS } from "./tasks.mjs";

const run = promisify(execFile),
  here = dirname(fileURLToPath(import.meta.url)),
  acceptance = resolve(here, ".."),
  repo = resolve(here, "../../../..");

export const SKILL_DIR = join(repo, "plugin/skills/html-text");

// The prompts of one track, from PROMPTS.md: everything under "## Track A" (or B).
export async function prompts(track) {
  const text = await readFile(join(here, "PROMPTS.md"), "utf8");
  const parts = text.split(/^## /m);
  const part = parts.find((p) => p.startsWith(`Track ${track}`));
  assert.ok(part, `PROMPTS.md has no "## Track ${track}" part`);
  return `## ${part.trimEnd()}\n`;
}

// Every "### X1 …" heading with the text of its first ```text block.
export async function promptBlocks() {
  const text = await readFile(join(here, "PROMPTS.md"), "utf8");
  const blocks = {};
  for (const m of text.matchAll(
    /^### ([AB]\d)\b[^\n]*\n[\s\S]*?```text\n([\s\S]*?)```/gm,
  ))
    blocks[m[1]] = m[2];
  return blocks;
}

// The canonical article: from its opening tag at the start of a line to the first
// "</article>" line after it (the editor's code also contains that text).
export function articleBounds(html) {
  const start = html.search(/^<article id="doc"/m);
  const end = html.indexOf("\n</article>", start) + 1;
  assert.ok(start >= 0 && end > start, "no article#doc at the start of a line");
  return [start, end];
}

const escapeAttr = (s) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const escapeText = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Writes comment threads into a canonical document: each quote, found once in the article as
// plain text, is wrapped in its anchor, and section.comments goes last in the article.
export function addThreads(html, outline, threads) {
  let out = html;
  for (const t of threads) {
    const quote = escapeText(t.quote);
    const at = out.indexOf(quote);
    assert.ok(at > 0, `quote of ${t.id} not found`);
    assert.equal(
      out.indexOf(quote, at + 1),
      -1,
      `quote of ${t.id} found twice`,
    );
    const owner = outline
      .filter((s) => s.start <= at && at < s.end)
      .sort((a, b) => b.start - a.start)[0];
    assert.equal(
      owner?.id,
      t.section,
      `quote of ${t.id} is not in ${t.section}`,
    );
    out =
      out.slice(0, at) +
      `<mark class="comment" data-ref="${t.id}">${quote}</mark>` +
      out.slice(at + quote.length);
  }
  const block = [
    '<section class="comments">',
    ...threads.flatMap((t) => [
      `<aside class="comment-thread" id="${t.id}" data-status="${t.status}" data-quote="${escapeAttr(t.quote)}" data-section="${t.section}">`,
      ...t.comments.map(
        ([author, date, text]) =>
          `<p class="comment" data-author="${escapeAttr(author)}" data-date="${date}">${escapeText(text)}</p>`,
      ),
      "</aside>",
    ]),
    "</section>",
  ].join("\n");
  const [, end] = articleBounds(out);
  assert.ok(end > 0 && !out.includes('<section class="comments">'));
  return out.slice(0, end) + block + "\n" + out.slice(end);
}

export async function prepare(kit, { skill = SKILL_DIR } = {}) {
  kit = resolve(kit);
  const inside = relative(repo, kit);
  if (!inside.startsWith("..") && !isAbsolute(inside))
    throw new Error(
      "Prepare the kit outside the repository: a blind session must not see it.",
    );
  if (existsSync(kit) && (await readdir(kit)).length)
    throw new Error(`${kit} is not empty: use a new folder for each run.`);
  for (const d of ["A", "B/inputs", "reference", "work"])
    await mkdir(join(kit, d), { recursive: true });
  // The skill exactly as given (an extracted archive) or as the repository ships it.
  await cp(resolve(skill), join(kit, "skill/html-text"), { recursive: true });
  const tool = join(kit, "skill/html-text/tools/document.mjs");
  const text = (...args) =>
    run(process.execPath, [tool, ...args], {
      cwd: acceptance,
      maxBuffer: 1 << 26,
    });

  // The T19 report, passes 1 and 2.
  const draft = join(kit, "work/draft.html");
  await text(
    "new",
    draft,
    "--markdown",
    "outline.md",
    "--payloads",
    "payloads.json",
    "--title",
    "Business review 2026 and plan for 2027",
    "--subtitle",
    "Larkfield Bakery Co-operative",
    "--cover-line",
    "Report of the board to the members · 12 December 2026",
    "--cover-line",
    "A fictional document: the co-operative, its sites, people and figures are invented",
    "--contents",
    "2",
    "--numbers",
    "--charte",
    "brand.css",
    "--header",
    "Larkfield Bakery Co-operative · Business review 2026 and plan for 2027",
  );
  const sections = (await readdir(join(acceptance, "sections")))
    .filter((n) => n.endsWith(".md"))
    .sort();
  for (const name of sections) {
    const file = join(acceptance, "sections", name);
    const id = /\{#([A-Za-z][\w-]*)/.exec(
      (await readFile(file, "utf8")).split("\n")[0],
    )[1];
    const part = join(kit, `work/${id}.html`);
    await text("convert", draft, id, file, "--out", part);
    await text("replace", draft, id, part);
  }
  // The threads: c1 and c2 for the skill session, c1–c3 for the HTML-only session.
  const html = await readFile(draft, "utf8");
  const outline = JSON.parse((await text("outline", draft, "--json")).stdout);
  const variants = {
    A: THREADS,
    B: THREADS.filter((t) => !t.injected),
  };
  for (const [track, threads] of Object.entries(variants)) {
    const raw = join(kit, `work/${track}-threads.html`);
    await writeFile(raw, addThreads(html, outline, threads));
    const out = join(kit, `reference/${track}-${REVIEW}`);
    await text("pack", raw, "--out", out, "--standard");
    const report = JSON.parse((await text("check", out, "--json")).stdout);
    assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
    assert.equal(report.warnings.length, 0, JSON.stringify(report.warnings));
    assert.equal(report.coverage.threads, threads.length);
    assert.equal(report.coverage.anchors, threads.length);
  }
  await cp(join(kit, `reference/A-${REVIEW}`), join(kit, "A", REVIEW));
  await cp(join(kit, `reference/B-${REVIEW}`), join(kit, "B/inputs", REVIEW));
  await cp(
    join(acceptance, "../bench/fixtures", LONG),
    join(kit, "reference", LONG),
  );
  await cp(join(kit, "reference", LONG), join(kit, "B/inputs", LONG));
  for (const name of await readdir(join(here, "inputs")))
    await cp(join(here, "inputs", name), join(kit, "B/inputs", name));
  // The prompts and a short read-me for the person.
  await writeFile(join(kit, "prompts-A.md"), await prompts("A"));
  await writeFile(join(kit, "prompts-B.md"), await prompts("B"));
  const scorer = join(here, "score.mjs");
  await writeFile(
    join(kit, "KIT.md"),
    [
      "# T20 blind-test kit (html-text)",
      "",
      "Follow docs/blind-tests/TEXT-T20.md in the repository. In short:",
      "",
      "- Session A (HTML only): give the assistant the folder `A/` and nothing else; paste the prompts of `prompts-A.md` one at a time.",
      "- Session B (skill): install `skill/html-text` in the assistant, open it in `B/`, paste the prompts of `prompts-B.md` one at a time.",
      "- Never show `reference/`, `work/` or this file to either session.",
      "",
      "Then score the outputs:",
      "",
      "```bash",
      `node ${scorer} ${kit}`,
      "```",
      "",
    ].join("\n"),
  );
  return kit;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--skill");
  const skill = at >= 0 ? args.splice(at, 2)[1] : undefined;
  if (args.length !== 1) {
    console.error(
      "Usage: node packages/text/acceptance/blind/prepare.mjs <kit-folder> [--skill <dir>]",
    );
    process.exit(2);
  }
  const kit = await prepare(args[0], { skill });
  console.log(`Kit ready in ${kit}. Next: ${join(kit, "KIT.md")}`);
}
