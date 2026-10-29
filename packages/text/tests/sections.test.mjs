// T16 section tooling on the 100-page fixture (bench/fixtures/report-100.html, about 50,000 words
// and 50 figures, regenerated here byte for byte): outline, show, replace and check. Replacing
// the first, a middle, the last and nested sections changes nothing outside them (prefix and
// suffix compared byte for byte, and a line diff); invalid replacements are refused through the
// command line and leave the file unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { longDocument } from "../bench/long-document.mjs";
import { parseFile } from "../model/parse.mjs";
import { openFile, saveFile } from "../editor/schema/document.mjs";
import { checkSource, sectionReport, formatReport } from "../tools/check.mjs";
import { outline, show, replace, SectionError } from "../tools/sections.mjs";
import { diffLines } from "../tools/pack.mjs";
import { markdownSource } from "../tools/markdown.mjs";
import { symlink } from "node:fs/promises";

const FIXTURE = new URL("../bench/fixtures/report-100.html", import.meta.url);
const TOOL = fileURLToPath(new URL("../tools/sections.mjs", import.meta.url));
const source = await readFile(FIXTURE, "utf8");
const lineOf = (text, offset) => text.slice(0, offset).split("\n").length;

test("the 100-page fixture: generated deterministically, valid, canonical, current", () => {
  const generated = longDocument({ pages: 100 });
  assert.equal(generated.html, source, "bench/long-document.mjs reproduces it");
  assert.ok(
    generated.words > 49000 && generated.words < 52000,
    `${generated.words} words`,
  );
  const report = checkSource(source);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(
    report.warnings,
    [],
    "canonical, labels and contents current",
  );
  assert.equal(report.protected.length, 0);
  const kinds = [
    ...source.matchAll(/<figure class="(chart|image|table)"/g),
  ].map((m) => m[1]);
  assert.deepEqual(
    {
      chart: kinds.filter((k) => k === "chart").length,
      image: kinds.filter((k) => k === "image").length,
      table: kinds.filter((k) => k === "table").length,
    },
    { chart: 20, image: 15, table: 15 },
  );
  assert.equal(report.coverage.figures, 50);
  assert.equal(report.coverage.threads, report.coverage.anchors);
  assert.ok(report.coverage.xrefs > 50 && report.coverage.assets === 15);
});

test("outline: every heading with its ID, number, level and word counts; show: its exact slice", () => {
  const { sections } = outline(source);
  assert.equal(sections.length, 90);
  assert.deepEqual(
    [1, 2, 3, 4].map((l) => sections.filter((s) => s.level === l).length),
    [10, 50, 20, 10],
  );
  const s = sections.find((x) => x.id === "sec-3-4");
  assert.equal(s.number, "3.4");
  assert.equal(s.title, "Volunteers: risks");
  assert.equal(s.parent, "ch-3");
  // A section's words are its own and its subsections'.
  const children = sections.filter((x) => x.parent === s.id);
  assert.equal(s.words, s.own + children.reduce((n, c) => n + c.words, 0));
  const chapters = sections.filter((x) => !x.parent);
  assert.equal(chapters.length, 10);
  // Chapters tile the article between the contents and the comments.
  chapters.slice(1).forEach((c, i) => assert.equal(c.start, chapters[i].end));
  const text = show(source, "sec-3-4");
  assert.equal(text, source.slice(s.start, s.end));
  assert.match(text, /^<h2 id="sec-3-4">Volunteers: risks<\/h2>\n/);
  assert.match(text, /\n<h4 id="sec-3-4-1-1">Method notes<\/h4>\n/);
  assert.ok(text.endsWith("\n") && !text.includes('<h2 id="sec-3-5"'));
  assert.ok(source.slice(s.end).startsWith('<h2 id="sec-3-5">'));
  assert.throws(() => show(source, "nowhere"), SectionError);
});

// The changed lines of a replacement all lie inside the section, before and after.
function preserved(result, id) {
  const { output, start, end, length } = result;
  assert.equal(output.slice(0, start), source.slice(0, start), `${id}: before`);
  assert.equal(output.slice(start + length), source.slice(end), `${id}: after`);
  const old = [lineOf(source, start), lineOf(source, end) - 1];
  const now = [lineOf(output, start), lineOf(output, start + length) - 1];
  const changes = diffLines(source.split("\n"), output.split("\n")).filter(
    (e) => e.op !== " ",
  );
  assert.ok(changes.length > 0);
  for (const e of changes) {
    const [a, b] = e.op === "-" ? old : now;
    assert.ok(
      e.line >= a && e.line <= b,
      `${id}: ${e.op}${e.line} outside ${a}–${b}`,
    );
  }
  const report = checkSource(output);
  assert.deepEqual(report.errors, []);
  const file = parseFile(output);
  assert.equal(saveFile(file, openFile(file).doc), output, "canonical");
  return { changes, report };
}

// A section edited as an LLM would: new text in its first paragraph, one more paragraph at its end.
const edited = (id) =>
  show(source, id)
    .replace(/<p>[^<]{0,40}/, (m) => `${m} (revised)`)
    .replace(/\n$/, "\n<p>An added closing paragraph for this section.</p>\n");

test("replace: first, middle, last and nested sections; nothing outside them changes", () => {
  const { sections } = outline(source);
  const last = sections.filter((s) => s.level === 2).at(-1);
  for (const id of ["ch-1", "sec-5-3", last.id, "sec-7-4-1", "sec-2-4-1-1"]) {
    const result = replace(source, id, edited(id));
    const { changes, report } = preserved(result, id);
    assert.ok(
      changes.some(
        (e) => e.text === "<p>An added closing paragraph for this section.</p>",
      ),
    );
    assert.deepEqual(report.warnings, [], id);
    assert.equal(result.normalised, false);
  }
  assert.equal(last.id, "sec-10-5");
  assert.ok(
    outline(source).sections.find((s) => s.id === "sec-10-5").end ===
      source.indexOf('<section class="comments">'),
  );
});

test("replace: another spelling is rewritten into canonical form inside the section; a renamed heading leaves the contents stale", () => {
  const html = show(source, "sec-6-2")
    .replace('<h2 id="sec-6-2">', "<H2 id='sec-6-2'>")
    .replace("</h2>", "</H2>")
    .replace(/<p>/, "<p >");
  const result = replace(source, "sec-6-2", html);
  assert.equal(result.normalised, true);
  assert.equal(result.output, source, "the canonical form of the same section");
  const renamed = replace(
    source,
    "sec-6-2",
    show(source, "sec-6-2").replace(
      />Partners and schools: findings</,
      ">Partner findings<",
    ),
  );
  const { report } = preserved(renamed, "sec-6-2");
  assert.deepEqual(
    report.warnings.map((w) => w.code),
    ["stale-contents"],
  );
  assert.deepEqual(
    renamed.warnings.map((w) => w.split(":")[0]),
    ["stale-contents"],
  );
});

test("replace: removed commented text leaves an orphaned thread, reported", () => {
  const id = outline(source).sections.find(
    (s) =>
      s.own &&
      /<mark class="comment"/.test(
        source.slice(s.start, s.end).split("\n<h")[0],
      ),
  ).id;
  const html = show(source, id).replace(
    /<mark class="comment" data-ref="[^"]+">([^<]*)<\/mark>/,
    "$1",
  );
  const result = replace(source, id, html);
  preserved(result, id);
  assert.deepEqual(
    result.warnings.map((w) => w.split(":")[0]),
    ["orphaned-thread"],
  );
});

function cli(...args) {
  return spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf8" });
}
const cliAsync = (...args) =>
  new Promise((resolve) =>
    execFile(process.execPath, [TOOL, ...args], (error, stdout, stderr) =>
      resolve({ status: error ? error.code : 0, stdout, stderr }),
    ),
  );

test("replace from the command line writes the file; invalid replacements are refused and change nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "text-sections-"));
  try {
    const doc = join(dir, "report.html");
    await writeFile(doc, source);
    const section = join(dir, "section.html");
    await writeFile(section, edited("sec-4-2"));
    const ok = cli("replace", doc, "sec-4-2", section);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(
      ok.stdout,
      /^Replaced section "sec-4-2" \(lines \d+–\d+, now \d+–\d+\); everything else is unchanged/,
    );
    preserved({ ...replace(source, "sec-4-2", edited("sec-4-2")) }, "sec-4-2");
    assert.equal(
      await readFile(doc, "utf8"),
      replace(source, "sec-4-2", edited("sec-4-2")).output,
    );
    await writeFile(doc, source);

    // A figure some other section refers to.
    const { sections } = outline(source);
    const figured = sections.find((s) => {
      if (s.level !== 2) return false;
      const own = source.slice(s.start, s.end).split("\n<h3")[0];
      const fig = /<figure class="\w+" id="([^"]+)"/.exec(own)?.[1];
      return (
        fig &&
        (source.slice(0, s.start) + source.slice(s.end)).includes(
          `href="#${fig}"`,
        )
      );
    });
    const figureRemoved = show(source, figured.id).replace(
      /<figure[\s\S]*?<\/figure>\n/,
      "",
    );
    const base = show(source, "sec-8-3");
    const cases = {
      "another heading ID": [
        base.replace('id="sec-8-3"', 'id="sec-8-3b"'),
        /must start with the heading id="sec-8-3"/,
      ],
      "another level": [
        base.replace(/^<h2(.*?)<\/h2>/, "<h3$1</h3>"),
        /level 2 heading/,
      ],
      "a second section inside": [
        base + '<h2 id="sec-extra">Extra</h2>\n<p>More.</p>\n',
        /must hold one section/,
      ],
      "a higher heading inside": [
        base.replace(/\n<p>/, '\n<h1 id="ch-new">New</h1>\n<p>'),
        /must hold one section/,
      ],
      "a script": [
        base.replace(/<p>/, "<p><script>alert(1)</script>"),
        /would not be valid[\s\S]*replacement line 2/,
      ],
      "a style attribute": [
        base.replace(/<p>/, '<p style="color:red">'),
        /would not be valid/,
      ],
      "a duplicate ID": [base + '<h3 id="sec-1-1">Copy</h3>\n', /duplicate-id/],
      "content outside the subset": [
        base + "<div>Loose block</div>\n",
        /protected block/,
      ],
      "an unknown comment thread": [
        base.replace(
          /<p>/,
          '<p><mark class="comment" data-ref="c999">x</mark>',
        ),
        /unknown-thread/,
      ],
      "a missing asset": [
        base +
          '<figure class="image" id="fig-new" data-width="text">\n<img data-asset="a999" alt="x">\n</figure>\n',
        /No asset "a999"/,
      ],
      "a referenced figure removed": [
        figureRemoved,
        /missing-target/,
        figured.id,
      ],
      "an unclosed element": [
        base.replace(/<p>/, "<blockquote>\n<p>"),
        /refused|outside the section|not be valid/,
      ],
      "a comments section": [
        base +
          '<section class="comments">\n<aside class="comment-thread" id="c900" data-status="open" data-quote="x">\n<p class="comment" data-author="A" data-date="2026-10-01T09:00Z">x</p>\n</aside>\n</section>\n',
        /refused|not be valid/,
      ],
      nothing: ["\n\n", /empty/],
    };
    // Each case on its own copy of the document, all at once.
    await Promise.all(
      Object.entries(cases).map(
        async ([name, [html, message, id = "sec-8-3"]], i) => {
          const copy = join(dir, `case-${i}.html`),
            input = join(dir, `case-${i}.section.html`);
          await writeFile(copy, source);
          await writeFile(input, html);
          const r = await cliAsync("replace", copy, id, input);
          assert.equal(r.status, 1, `${name}: ${r.stdout}`);
          assert.match(r.stderr, message, name);
          assert.match(r.stderr, /Nothing was written\.$/m, name);
          assert.equal(
            await readFile(copy, "utf8"),
            source,
            `${name}: file unchanged`,
          );
          assert.deepEqual(
            (await readdir(dir)).filter((f) => f.startsWith(`case-${i}.html.`)),
            [],
            `${name}: no temporary file`,
          );
          await rm(input);
          await rm(copy);
        },
      ),
    );
    const unknown = cli("replace", doc, "sec-none", section);
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /No section with the heading ID "sec-none"/);
    assert.deepEqual(
      (await readdir(dir)).sort(),
      ["report.html", "section.html"],
      "no temporary file left",
    );
    assert.equal(await readFile(doc, "utf8"), source);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("check: findings name their section; --section keeps one section's", () => {
  const broken = source
    .replace(
      /(<h2 id="sec-2-3">[\s\S]*?<p>)/,
      '$1<a class="xref" href="#fig-gone">Figure 99</a> ',
    )
    .replace(
      /(<h4 id="sec-6-4-1-1">[\s\S]*?<p>)/,
      '$1<a class="xref" href="#sec-gone">Section 99</a> ',
    );
  const report = checkSource(broken);
  const missing = report.warnings.filter((w) => w.code === "missing-target");
  assert.deepEqual(
    missing.map((w) => w.section),
    ["sec-2-3", "sec-6-4-1-1"],
  );
  assert.match(formatReport(report), /§sec-2-3  missing-target/);
  assert.match(
    formatReport(report),
    /Checked 90 heading\(s\) and 50 figure\(s\) with their IDs, \d+ cross-reference\(s\) \(2 without target\), 15 image\(s\) and 15 asset\(s\) \(0 unused\), \d+ comment thread\(s\) and \d+ anchor\(s\) \(0 orphaned\)/,
  );
  const ch6 = sectionReport(report, "ch-6");
  assert.deepEqual(
    ch6.warnings
      .filter((w) => w.code === "missing-target")
      .map((w) => w.section),
    ["sec-6-4-1-1"],
  );
  assert.equal(sectionReport(report, "ch-3").warnings.length, 0);
  assert.equal(sectionReport(report, "nowhere"), null);
  // Errors too.
  const invalid = source.replace('<h2 id="sec-9-2">', '<h2 id="sec-9-1">');
  const r = checkSource(invalid);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, "duplicate-id");
  assert.equal(r.errors[0].section, "sec-9-1");
  assert.equal(
    r.errors[0].line,
    lineOf(source, source.indexOf('<h2 id="sec-9-2">')),
  );
});

test("the long fixture through the other tools: Markdown export, and sections.mjs through a symbolic link", async () => {
  const started = performance.now();
  const { markdown, lost } = markdownSource(source);
  assert.ok(performance.now() - started < 5000);
  assert.equal(lost.charts + lost.images, 35);
  assert.equal(
    (markdown.match(/^#{1,4} /gm) ?? []).length,
    91,
    "cover title and 90 headings",
  );
  const dir = await mkdtemp(join(tmpdir(), "text-sections-link-"));
  try {
    const link = join(dir, "sections.mjs");
    await symlink(TOOL, link);
    const r = spawnSync(
      process.execPath,
      [link, "outline", fileURLToPath(FIXTURE)],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\n90 section\(s\), \d+ words in sections\n$/);
  } finally {
    await rm(dir, { recursive: true });
  }
});

// Regressions from the T16 review, on small documents.
const small = (article) =>
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Small</title>\n</head>\n<body>\n<article id="doc" data-format="1" lang="en">\n${article}</article>\n</body>\n</html>\n`;

test("review: the temporary file is new and never followed through a link; non-UTF-8 bytes and a missing --output value are refused", async () => {
  const dir = await mkdtemp(join(tmpdir(), "text-sections-review-"));
  try {
    const doc = join(dir, "report.html"),
      input = join(dir, "section.html");
    const text = small('<h1 id="a">A</h1>\n<p>Old.</p>\n');
    await writeFile(doc, text);
    await symlink(doc, `${doc}.tmp`);
    await writeFile(input, '<h1 id="a">A</h1>\n<p>New.</p>\n');
    const r = cli("replace", doc, "a", input);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(await readFile(doc, "utf8"), text.replace("Old.", "New."));
    assert.equal(
      await readFile(`${doc}.tmp`, "utf8"),
      text.replace("Old.", "New."),
      "the link still points to the document",
    );
    assert.deepEqual((await readdir(dir)).sort(), [
      "report.html",
      "report.html.tmp",
      "section.html",
    ]);

    const broken = Buffer.from(text.replace("<title>Small", "<title>\u0000"));
    broken[broken.indexOf(0)] = 0xff;
    await writeFile(doc, broken);
    const bad = cli("replace", doc, "a", input);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /is not valid UTF-8/);
    assert.ok((await readFile(doc)).equals(broken));

    await writeFile(doc, text);
    const usage = cli("replace", doc, "a", input, "--output");
    assert.equal(usage.status, 2);
    assert.equal(await readFile(doc, "utf8"), text);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("review: repaired markup, a file without body, a protected section of another class, other end tags", () => {
  const repaired = small('<h1 id="a">A</h1>\n<p>end</p></p>\n');
  const report = checkSource(repaired);
  assert.ok(report.warnings.some((w) => w.code === "not-canonical"));
  assert.throws(() => outline(repaired), /repaired/);
  const frameset =
    "<!doctype html><html><head><title>T</title></head><frameset></frameset></html>";
  assert.ok(checkSource(frameset).errors.some((e) => e.code === "structure"));
  JSON.stringify(checkSource(frameset));

  const legacy = small(
    '<h1 id="a">A</h1>\n<section class="comments legacy">Old content</section>\n<h1 id="b">B</h1>\n<p>After.</p>\n',
  );
  assert.deepEqual(
    outline(legacy).sections.map((s) => s.id),
    ["a", "b"],
  );
  assert.match(show(legacy, "a"), /legacy">Old content<\/section>\n$/);

  const spaced = small('<h1 id="a">A</h1>\n<p>Last.</p>\n').replace(
    "</article>",
    "</article   >",
  );
  assert.equal(show(spaced, "a"), '<h1 id="a">A</h1>\n<p>Last.</p>\n');
  const open = small('<h1 id="a">A</h1>\n<p>Last.</p>').replace(
    "</article>\n",
    "",
  );
  assert.equal(show(open, "a"), '<h1 id="a">A</h1>\n<p>Last.</p>');
});

test("review: words across inline markup, protected blocks counted, an unchanged last text section, CR line breaks", () => {
  const marked = small(
    '<h1 id="a">A</h1>\n<p>hel<strong>lo</strong> world</p>\n',
  );
  assert.equal(outline(marked).sections[0].words, 3);

  const legacy = small(
    '<h1 id="a">A</h1>\n<div>Legacy block</div>\n<p>Text.</p>\n',
  );
  const one = replace(
    legacy,
    "a",
    '<h1 id="a">A</h1>\n<div>Legacy block</div>\n<p>New.</p>\n',
  );
  assert.equal(one.output, legacy.replace("Text.", "New."));
  assert.throws(
    () =>
      replace(
        legacy,
        "a",
        '<h1 id="a">A</h1>\n<div>Legacy block</div>\n<div>Legacy block</div>\n',
      ),
    (e) => e.problems.some((p) => /protected block/.test(p)),
  );

  // The article's last block is loose text written without a line break before </article>.
  const loose = small('<h1 id="a">A</h1>\nLoose text');
  assert.equal(checkSource(loose).ok, true);
  assert.ok(
    !checkSource(loose).warnings.some((w) => w.code === "not-canonical"),
    "canonical",
  );
  assert.equal(replace(loose, "a", show(loose, "a")).output, loose);

  const cr = small(
    '<h1 id="a">A</h1>\n<p>One.</p>\n<h1 id="b">B</h1>\n<p>See <a class="xref" href="#gone">Section 9</a>.</p>\n',
  ).replace(/\n/g, "\r");
  const report = checkSource(cr);
  const missing = report.warnings.find((w) => w.code === "missing-target");
  assert.equal(missing.section, "b");
  assert.equal(
    sectionReport(report, "b").warnings.filter(
      (w) => w.code === "missing-target",
    ).length,
    1,
  );
});
