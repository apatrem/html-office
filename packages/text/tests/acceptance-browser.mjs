// T19 end to end, in Chromium: acceptance/generate.mjs builds the fictional business review
// through the freshly packaged skill (outline pass, section passes, a reviewer's comments in the
// editor, standard and offline files, Markdown, PDF, the companion deck). The outputs are checked
// against every requirement of the plan; then a section is edited and extended by hand in the
// editor, saved as a copy and reopened, and extended again with the tools.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
import * as playwright from "playwright";
import { generate, NAME, HEADER, REVIEW } from "../acceptance/generate.mjs";
import { checkSource } from "../tools/check.mjs";
import { parseFile } from "../model/parse.mjs";
import { charteTokens } from "../../shared/charts/css-theme.mjs";

const pass = (what) => console.log(`PASS text acceptance: ${what}`);
const out = await mkdtemp(join(tmpdir(), "html-text-t19-out-"));
const { files, manifest } = await generate(out);
const standard = await readFile(files.standard, "utf8");
const esc = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const count = (re) => (standard.match(re) ?? []).length;

// ---- the document: every construct the plan asks for ----
const report = checkSource(standard);
assert.deepEqual(report.errors, []);
assert.deepEqual(report.warnings, [], "canonical, labels and contents current");
assert.match(
  standard,
  /<header class="cover">\n<h1 class="title">Business review 2026 and plan for 2027<\/h1>/,
);
assert.match(
  standard,
  /<nav class="toc" data-depth="2">\n<ol>\n<li><a href="#sec-summary">1 Executive summary<\/a><\/li>/,
);
assert.match(
  standard,
  /<article id="doc" data-format="1" lang="en-GB" data-heading-numbers="on" data-header="[^"]+">/,
);
assert.ok(count(/<p class="lead">/g) >= 4, "lead paragraphs");
for (const kind of ["note", "warning", "key"])
  assert.ok(standard.includes(`<aside class="callout ${kind}">`), kind);
const charts = standard.match(/<figure class="chart"[^]*?<\/figure>/g);
assert.equal(charts.length, 2);
for (const c of charts)
  assert.match(c, /\n<svg [^>]*class="render"[^>]*>[^]*<\/svg>\n<figcaption>/);
const tables = standard.match(/<figure class="table"[^]*?<\/figure>/g);
assert.equal(tables.length, 3);
assert.match(
  tables[0],
  /<thead>\n<tr><th rowspan="2">Channel<\/th><th class="ta-c" colspan="2">Year<\/th><th class="ta-c" colspan="2">Change<\/th><\/tr>/,
);
assert.match(tables[0], /<tr class="total"><th>Revenue<\/th>/);
const wrapped = standard.match(
  /<figure class="image" id="[\w-]+" data-width="\d+" data-wrap="(left|right)">\n<img [^>]+>\n<figcaption>/g,
);
assert.ok(wrapped.length >= 2, "wrapped images with captions");
assert.ok(count(/<span class="footnote">/g) >= 5, "notes");
assert.ok(count(/<a class="xref" href="#/g) >= 15, "cross-references");
assert.match(
  standard,
  /<h1 class="unnumbered new-page" id="app-definitions">Appendix A\./,
);
assert.match(
  standard,
  new RegExp(
    `<aside class="comment-thread" id="c1" data-status="open" data-quote="${esc(REVIEW.open.quote)}"[^>]*>\\n<p class="comment" data-author="${esc(REVIEW.reviewer)}" data-date="[^"]+">${esc(REVIEW.open.text)}</p>\\n</aside>`,
  ),
);
assert.match(
  standard,
  new RegExp(
    `id="c2" data-status="resolved" data-quote="${esc(REVIEW.resolved.quote)}"[^]*?>${esc(REVIEW.resolved.text)}</p>\\n<p class="comment" data-author="${esc(REVIEW.reviewer)}"[^>]*>${esc(REVIEW.resolved.reply)}</p>`,
  ),
);
assert.equal(count(/<mark class="comment" data-ref="c[12]">/g), 2);
pass(
  `cover, contents, numbered sections, leads, callouts, 2 charts with saved SVGs, 3 tables (merged header, total row), ${wrapped.length} wrapped images, ${count(/class="footnote"/g)} notes, ${count(/class="xref"/g)} cross-references, appendices, an open and a resolved thread`,
);

// ---- outputs, versions and sizes ----
assert.ok(
  manifest.pdfPages >= 15 && manifest.pdfPages <= 20,
  `${manifest.pdfPages} pages`,
);
assert.ok(manifest.files[`${NAME}.html`].applicationCode < 600000);
const offline = await readFile(files.offline, "utf8");
assert.deepEqual(checkSource(offline).errors, []);
assert.equal(
  offline.slice(offline.indexOf("<article"), offline.indexOf("</article>")),
  standard.slice(standard.indexOf("<article"), standard.indexOf("</article>")),
  "the same document, standard and offline",
);
const markdown = await readFile(files.markdown, "utf8");
assert.match(markdown, /^# 1 Executive summary$/m);
assert.match(markdown, /^\*\*Table 1\.\*\* Revenue by channel/m);
assert.match(markdown, /^\[\^1\]: /m);
const deck = await readFile(files.deck, "utf8");
const charte = (html) =>
  charteTokens(/<style id="charte">([^]*?)<\/style>/.exec(html)[1]);
assert.deepEqual(
  charte(deck),
  charte(standard),
  "the deck shares the brand charte",
);
assert.equal((deck.match(/<section class="slide" id="s/g) ?? []).length, 5);
pass(
  `standard ${manifest.files[`${NAME}.html`].bytes} B (code ${manifest.files[`${NAME}.html`].applicationCode}), offline ${manifest.files[`${NAME}-offline.html`].bytes} B, PDF ${manifest.pdfPages} pages, Markdown, deck with the same charte`,
);

const browser = await playwright.chromium.launch();
try {
  // ---- the PDF: running header, page numbers, endnotes ----
  const { readPDF } = await import("./pdf.mjs");
  const pdf = readPDF(await readFile(files.pdf));
  const pages = pdf.pages.map((p) => p.text.replace(/\s+/g, " "));
  pages.forEach((text, i) => {
    assert.ok(text.includes(HEADER), `header on page ${i + 1}`);
    assert.ok(
      text.includes(`${i + 1} / ${pages.length}`),
      `number on page ${i + 1}`,
    );
  });
  assert.ok(
    pages.at(-1).includes("Fictional management accounts") ||
      pages.some((t) => /Notes/.test(t)),
  );
  assert.ok(
    !pages.join(" ").includes(REVIEW.open.text),
    "comments do not print",
  );
  pass("PDF: header and page number on every page, endnotes, no comments");

  // ---- offline: no request, the charts drawn ----
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  const requests = [];
  page.on(
    "request",
    (r) => r.url().startsWith("http") && requests.push(r.url()),
  );
  await page.route(/^https?:/, (route) => route.abort());
  await page.goto(pathToFileURL(files.offline).href);
  await page.waitForFunction(() => window.htmlText && window.echarts);
  assert.deepEqual(requests, []);
  pass("offline file opens with no request");

  // ---- edit and extend a section by hand, save a copy, reopen ----
  await page.goto(pathToFileURL(files.standard).href);
  await page.waitForFunction(() => window.htmlText);
  const added = "The board thanks every member who answered the autumn survey.";
  await page.evaluate((sentence) => {
    const { view } = window.htmlText;
    let end;
    view.state.doc.descendants((node, pos) => {
      if (
        end === undefined &&
        node.type.name === "paragraph" &&
        node.textContent.startsWith("The board also notes one lesson")
      )
        end = pos + node.nodeSize;
    });
    view.dispatch(
      view.state.tr.insert(
        end,
        view.state.schema.nodes.paragraph.create(
          null,
          view.state.schema.text(sentence),
        ),
      ),
    );
  }, added);
  await page.click(".tx-shell [role=menubar] button:text-is('File')");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("[role=menu] [role^=menuitem]:has-text('Save a copy')"),
  ]);
  const copy = join(out, `${NAME}-edited.html`);
  await download.saveAs(copy);
  const edited = await readFile(copy, "utf8");
  assert.deepEqual(checkSource(edited).errors, []);
  assert.ok(edited.includes(`<p>${added}</p>`));
  await page.goto(pathToFileURL(copy).href);
  await page.waitForFunction(() => window.htmlText);
  assert.equal(
    await page.evaluate(() => window.htmlText.serialize()),
    edited,
    "reopens as saved",
  );
  await page.close();
  pass(
    "a section edited and extended in the editor, saved as a copy and reopened unchanged",
  );

  // ---- then extended with the tools: show --markdown, convert, replace ----
  const tool = fileURLToPath(new URL("../tools/document.mjs", import.meta.url));
  const run = promisify(execFile);
  const { stdout } = await run(process.execPath, [
    tool,
    "show",
    copy,
    "sec-risks",
    "--markdown",
  ]);
  const md = join(out, "risks.md");
  await writeFile(
    md,
    `${stdout}\nThe register will be published to members each quarter from 2027.\n`,
  );
  await run(process.execPath, [
    tool,
    "convert",
    copy,
    "sec-risks",
    md,
    "--out",
    join(out, "risks.html"),
  ]);
  await run(process.execPath, [
    tool,
    "replace",
    copy,
    "sec-risks",
    join(out, "risks.html"),
  ]);
  const extended = await readFile(copy, "utf8");
  assert.deepEqual(checkSource(extended).errors, []);
  assert.ok(
    extended.includes(
      "<p>The register will be published to members each quarter from 2027.</p>",
    ),
  );
  const outside = (s) =>
    s.slice(0, s.indexOf('<h1 class="new-page" id="sec-risks">'));
  assert.equal(
    outside(extended),
    outside(edited),
    "everything before the section unchanged",
  );
  assert.equal(parseFile(extended).html.name, "html");
  pass("and extended again with show --markdown, convert and replace");
} finally {
  await browser.close();
}
