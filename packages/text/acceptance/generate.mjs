#!/usr/bin/env node
// T19: generates the fictional acceptance report through the html-text skill, as an author and
// a reviewer would:
//   1. the skill is packaged afresh (as release.sh does) and its tools/document.mjs creates the
//      document from outline.md (every section and figure with its ID) and payloads.json, with
//      the brand charte brand.css;
//   2. each file of sections/ is converted (`convert`) and replaced into the document
//      (`replace`), one section per pass, and `check` finds nothing;
//   3. in Chromium, a reviewer opens the file and comments in the editor: one open thread, and
//      one thread with a reply that is then resolved; File › Save a copy;
//   4. `pack` writes the standard and offline files from the reviewed copy, `markdown` the
//      Markdown sample, and Chromium prints the PDF from the standard file;
//   5. the html-slides skill builds the companion deck with the same brand charte.
// The outputs and manifest.json (versions, sizes, pages) go to output/ (git-ignored).
// Usage: node packages/text/acceptance/generate.mjs [--out DIR]
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  cp,
  readFile,
  readdir,
  writeFile,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as playwright from "playwright";
import { packageSkill } from "../tools/skill.mjs";
import { measureFile } from "../tools/build.mjs";
import { readPDF } from "../tests/pdf.mjs";
import { ECHARTS_VERSION } from "../../shared/charts/echarts.mjs";

const run = promisify(execFile),
  here = dirname(fileURLToPath(import.meta.url)),
  repo = resolve(here, "../../..");
export const NAME = "fictional-business-review";
export const TITLE = "Business review 2026 and plan for 2027";
export const HEADER =
  "Larkfield Bakery Co-operative · Business review 2026 and plan for 2027";
export const REVIEW = {
  reviewer: "Dana Reyes (finance)",
  open: {
    quote: "Revenue grew 14% to EUR 9.6 million",
    text: "Please confirm this against the audited accounts before the report goes to the members.",
  },
  resolved: {
    quote: "Works start in March; baking starts in September.",
    text: "Is September still realistic for Riverside after the landlord's delay?",
    reply:
      "Yes: the landlord confirmed the handover for 1 March on 12 October.",
  },
};

// The released skills, packaged from the current sources as release.sh does.
export async function freshSkill() {
  const dir = await mkdtemp(join(tmpdir(), "html-text-t19-"));
  await cp(join(repo, "plugin"), join(dir, "plugin"), { recursive: true });
  await packageSkill(join(dir, "plugin/skills/html-text"));
  return {
    dir,
    text: join(dir, "plugin/skills/html-text/tools/document.mjs"),
    slides: join(dir, "plugin/skills/html-slides/tools/deck.mjs"),
  };
}

// The sections of pass 2, in file order: [file, heading ID].
export async function sectionFiles() {
  const names = (await readdir(join(here, "sections")))
    .filter((n) => n.endsWith(".md"))
    .sort();
  return Promise.all(
    names.map(async (name) => {
      const first = (
        await readFile(join(here, "sections", name), "utf8")
      ).split("\n")[0];
      return [
        join(here, "sections", name),
        /\{#([A-Za-z][\w-]*)/.exec(first)[1],
      ];
    }),
  );
}

// A reviewer's comments, made in the editor (T13): select the text, Insert comment, reply,
// resolve; then File › Save a copy.
async function review(browser, file, out) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(file).href);
  await page.waitForFunction(() => window.htmlText);
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  const panel = ".tx-drawer .tx-comments";
  const select = (text) =>
    page.evaluate((t) => {
      const { view } = window.htmlText;
      let from;
      view.state.doc.descendants((node, pos) => {
        if (from === undefined && node.isText && node.text.includes(t))
          from = pos + node.text.indexOf(t);
      });
      if (from === undefined) throw new Error(`Not in the document: ${t}`);
      view.dispatch(
        view.state.tr.setSelection(
          view.state.selection.constructor.create(
            view.state.doc,
            from,
            from + t.length,
          ),
        ),
      );
      view.focus();
    }, text);
  const comment = async (quote, text) => {
    await select(quote);
    await page.keyboard.press(`${mod}+Alt+KeyM`);
    await page.waitForSelector(`${panel} .tx-new textarea`);
    await page.fill(`${panel} .tx-new textarea`, text);
    await page.click(`${panel} .tx-new button:text-is('Comment')`);
    // The display name is asked once, with the first comment.
    const name = page.locator(`${panel} .tx-name input`);
    if ((await name.count()) && !(await name.inputValue())) {
      await page.fill(`${panel} .tx-name input`, REVIEW.reviewer);
      await page.click(`${panel} .tx-new button:text-is('Comment')`);
    }
    await page.waitForSelector(`${panel} .tx-new`, { state: "detached" });
  };
  await page.click(".tx-float button:has-text('Comments')");
  await comment(REVIEW.open.quote, REVIEW.open.text);
  await comment(REVIEW.resolved.quote, REVIEW.resolved.text);
  const threads = await page.evaluate(() =>
    [...document.querySelectorAll("#doc section.comments aside")].map(
      (a) => a.id,
    ),
  );
  const last = threads.at(-1);
  await page.fill(
    `${panel} [data-thread="${last}"] textarea`,
    REVIEW.resolved.reply,
  );
  await page.click(`${panel} [data-thread="${last}"] button:text-is('Reply')`);
  await page.focus(
    `${panel} [data-thread="${last}"] button:text-is('Resolve')`,
  );
  await page.keyboard.press("Enter");
  await page.click(".tx-shell [role=menubar] button:text-is('File')");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("[role=menu] [role^=menuitem]:has-text('Save a copy')"),
  ]);
  await download.saveAs(out);
  assert.deepEqual(errors, []);
  await page.close();
}

export async function generate(out = join(here, "output")) {
  await mkdir(out, { recursive: true });
  const skill = await freshSkill();
  const work = join(skill.dir, "work");
  await mkdir(work);
  const text = (...args) =>
    run(process.execPath, [skill.text, ...args], { cwd: here });
  const draft = join(work, `${NAME}-draft.html`);
  // 1. The outline pass: every section and figure, with the brand charte.
  await text(
    "new",
    draft,
    "--markdown",
    "outline.md",
    "--payloads",
    "payloads.json",
    "--title",
    TITLE,
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
    HEADER,
  );
  // 2. The section passes.
  for (const [file, id] of await sectionFiles()) {
    const section = join(work, `${id}.html`);
    await text("convert", draft, id, file, "--out", section);
    await text("replace", draft, id, section);
  }
  const checked = await text("check", draft);
  assert.match(
    checked.stdout,
    /^0 error\(s\), 0 protected block\(s\), 0 warning\(s\)$/m,
  );
  // 3. The reviewer, in the editor.
  const browser = await playwright.chromium.launch();
  const files = {};
  try {
    const reviewed = join(work, `${NAME}-reviewed.html`);
    await review(browser, draft, reviewed);
    // 4. Standard, offline, Markdown and PDF.
    files.standard = join(out, `${NAME}.html`);
    files.offline = join(out, `${NAME}-offline.html`);
    files.markdown = join(out, `${NAME}.md`);
    files.pdf = join(out, `${NAME}.pdf`);
    files.deck = join(out, `${NAME}-deck.html`);
    await text("pack", reviewed, "--out", files.standard, "--standard");
    await text("pack", reviewed, "--out", files.offline, "--offline");
    for (const f of [files.standard, files.offline]) await text("check", f);
    await text("markdown", files.standard, files.markdown);
    const page = await browser.newPage();
    // The PDF is printed with no network: the saved chart previews print as they are.
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(pathToFileURL(files.standard).href);
    await page.waitForFunction(() => window.htmlText);
    const pdf = readPDF(
      await page.pdf({ path: files.pdf, preferCSSPageSize: true }),
    );
    files.pages = pdf.pages.length;
    files.chromium = browser.version();
    await page.close();
  } finally {
    await browser.close();
  }
  // 5. The companion deck, with the same charte.
  await run(
    process.execPath,
    [
      skill.slides,
      "new",
      files.deck,
      "--title",
      TITLE,
      "--footer",
      "Larkfield Bakery Co-operative · fictional",
      "--charte",
      "brand.css",
      "--content",
      "deck-content.html",
      "--force",
    ],
    { cwd: here },
  );
  // The manifest: versions and measured sizes.
  const plugin = JSON.parse(
    await readFile(join(repo, "plugin/.claude-plugin/plugin.json"), "utf8"),
  );
  const engine = JSON.parse(
    await readFile(
      join(skill.dir, "plugin/skills/html-text/assets/engine.json"),
      "utf8",
    ),
  );
  const sizes = measureFile(await readFile(files.standard, "utf8"));
  const offline = measureFile(await readFile(files.offline, "utf8"));
  const size = async (f) => (await stat(f)).size;
  const manifest = {
    title: TITLE,
    generated: new Date().toISOString().slice(0, 10),
    versions: {
      "html-text": engine.version,
      format: 1,
      echarts: ECHARTS_VERSION,
      "html-slides deck engine": (
        await readFile(
          join(skill.dir, "plugin/skills/html-slides/assets/VERSION"),
          "utf8",
        )
      ).trim(),
      plugin: `${plugin.name} ${plugin.version}`,
      node: process.version,
      chromium: files.chromium,
    },
    pdfPages: files.pages,
    files: {
      [`${NAME}.html`]: {
        bytes: await size(files.standard),
        applicationCode: sizes.applicationCode,
        content: sizes.content,
        assets: sizes.assets,
        guide: sizes.guide,
      },
      [`${NAME}-offline.html`]: {
        bytes: await size(files.offline),
        applicationCode: offline.applicationCode,
        echarts: offline.echarts,
      },
      [`${NAME}.pdf`]: { bytes: await size(files.pdf), pages: files.pages },
      [`${NAME}.md`]: { bytes: await size(files.markdown) },
      [`${NAME}-deck.html`]: { bytes: await size(files.deck) },
    },
  };
  await writeFile(
    join(out, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return { out, files, manifest };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const at = process.argv.indexOf("--out");
  const { manifest, out } = await generate(
    at > 0 ? resolve(process.argv[at + 1]) : undefined,
  );
  console.log(JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${out}.`);
}
