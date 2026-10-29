// T15 Markdown view and export in Node: every valid fixture projects to its committed Markdown
// (fixtures/markdown/*.md), and that Markdown, imported back through T07 (Insert › Markdown…),
// gives a document whose differences from the original are exactly the recorded, documented
// losses (fixtures/markdown/reimport.json; FORMAT.md › Markdown view and export). No text is
// lost apart from comments. MARKDOWN_SNAPSHOTS=write rewrites both records after a deliberate change.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFile,
  readdir,
  writeFile,
  mkdtemp,
  symlink,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { element, text } from "../model/html.mjs";
import { parseInert } from "../../../tests/helpers/inert-dom.mjs";
import { parseFile } from "../model/parse.mjs";
import { openFile, saveFile } from "../editor/schema/document.mjs";
import { schema } from "../editor/schema/schema.mjs";
import { fromHTML } from "../editor/clipboard/html.mjs";
import { markdownHTML } from "../editor/clipboard/markdown.mjs";
import { fileFormat } from "../editor/numbering.mjs";
import { toMarkdown } from "../editor/markdown.mjs";
import { markdownSource } from "../tools/markdown.mjs";

const N = schema.nodes,
  M = schema.marks;
const WRITE = process.env.MARKDOWN_SNAPSHOTS === "write";
const dir = new URL("../fixtures/valid/", import.meta.url);
const records = new URL("../fixtures/markdown/", import.meta.url);
const names = (await readdir(dir)).filter((f) => f.endsWith(".html")).sort();

// The Markdown imported as T07 imports it, as a document.
function reimport(markdown) {
  const { blocks, lost } = fromHTML(parseInert(markdownHTML(markdown)), {
    used: new Set(),
    targets: new Set(),
  });
  const doc = N.doc.create(
    { lang: "en" },
    blocks.length ? blocks : [N.paragraph.create()],
  );
  doc.check();
  return { doc, lost };
}

// Attributes that only name things (IDs, labels, data): their values are not compared.
const NAMING = new Set(
  "id target label level asset alt data type href ref quote section prefix suffix entries depth node preview lang cols"
    .split(" ")
    .concat(["status"]),
);
// Counts of nodes, marks and attribute values in a document.
function census(doc) {
  const c = {};
  const add = (k) => (c[k] = (c[k] ?? 0) + 1);
  doc.descendants((n) => {
    if (n.isText)
      return void n.marks.forEach((m) => add(`mark:${m.type.name}`));
    n.marks.forEach((m) => add(`mark:${m.type.name}`));
    add(n.type === N.heading ? `heading${n.attrs.level}` : n.type.name);
    for (const [k, v] of Object.entries(n.attrs))
      if (!NAMING.has(k) && v && v !== 1) add(`${n.type.name}.${k}=${v}`);
  });
  return c;
}
const delta = (a, b) =>
  Object.fromEntries(
    [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .sort()
      .filter((k) => (a[k] ?? 0) !== (b[k] ?? 0))
      .map((k) => [k, (b[k] ?? 0) - (a[k] ?? 0)]),
  );

// What the import has fewer of, by the row of FORMAT.md › Markdown view and export that says so.
const LOSS = [
  [/^(cover|title|subtitle)$/, "Cover"],
  [/^toc$/, "Contents"],
  [/^(heading|paragraph)\./, "Headings, Paragraphs"],
  // A list inside a callout is lines of a quote paragraph after the import.
  [
    /^(callout|callout\..*|bullet_list|ordered_list|list_item|list_text)$/,
    "Callouts",
  ],
  [/^page_break$/, "Page breaks"],
  [/^footnote$/, "Footnotes"],
  [/^xref$/, "Cross-references"],
  [/^(mark:comment|comments|comment_thread)$/, "Comments"],
  [/^(chart|chart\..*)$/, "Charts"],
  [/^(image_figure|image_figure\..*)$/, "Images"],
  [/^caption$/, "Captions"],
  [
    /^(table\.|table_row\.total|table_(cell|header)\.(colspan|rowspan|align))/,
    "Tables",
  ],
  [/^protected$/, "Protected blocks"],
];
// What the import has more of: the projection's own lines (cover lines, captions, chart and
// image lines, chart data tables, empty table header rows, callout labels, notes) and what
// they hold.
const ADDED =
  /^(paragraph|heading1|blockquote|bullet_list|ordered_list|list_item|list_text|hard_break|mark:strong|mark:em|table_figure|table|table_row|table_row\.head=true|table_header|table_cell|table_(cell|header)\.align=.*)$/;

// Words in reading order, footnotes after the text (where the Markdown puts them).
function words(doc) {
  let main = "",
    notes = "";
  doc.descendants((n) => {
    if (n.type === N.footnote) {
      notes += ` ${n.textContent} `;
      return false;
    }
    if (n.isText) main += n.text;
    else if (n.type === N.xref) main += n.attrs.label;
    else if (n.isBlock || n.type === N.hard_break) main += " ";
  });
  return (main + notes).match(/[\p{L}\p{N}]+/gu) ?? [];
}
// Content that survives the import changed: code blocks and inline code in order, link targets
// as a set.
function retained(doc, back) {
  const of = (d) => {
    const code = [],
      inline = [],
      links = [];
    d.descendants((n) => {
      if (n.type === N.code_block) code.push(n.textContent);
      if (n.isTextblock) {
        // Runs of inline code: consecutive code text in one block.
        let run = null;
        n.forEach((c) => {
          const coded = c.isText && c.marks.some((m) => m.type === M.code);
          if (coded)
            run === null
              ? inline.push((run = c.text))
              : (inline[inline.length - 1] = run += c.text);
          else run = null;
        });
      }
      for (const m of n.marks) if (m.type === M.link) links.push(m.attrs.href);
    });
    return { code, inline, links: [...new Set(links)].sort() };
  };
  const a = of(doc),
    b = of(back);
  return {
    code: a.code
      .map((text, i) => [text, b.code[i]])
      .filter(([x, y]) => x !== y),
    inline: a.inline
      .map((text, i) => [text, b.inline[i]])
      .filter(([x, y]) => x !== y),
    links: a.links.join("\n") === b.links.join("\n") ? [] : [a.links, b.links],
  };
}
const isSubsequence = (small, big) => {
  let i = 0;
  for (const w of big) if (w === small[i]) i++;
  return i === small.length;
};

const expected = WRITE
  ? {}
  : JSON.parse(await readFile(new URL("reimport.json", records), "utf8"));
const written = {};

for (const name of names)
  test(`Markdown projection and reimport: ${name}`, async () => {
    const source = await readFile(new URL(name, dir), "utf8");
    const file = parseFile(source);
    const doc = openFile(file).doc;
    const { markdown, lost } = markdownSource(source);
    // Never stored: projecting changes neither the document nor what saving writes.
    assert.ok(doc.eq(openFile(file).doc));
    assert.equal(saveFile(file, doc), saveFile(file, openFile(file).doc));
    assert.equal(
      markdown,
      toMarkdown(doc, { format: fileFormat(file) }).markdown,
    );
    const md = new URL(name.replace(/\.html$/, ".md"), records);
    if (WRITE) await writeFile(md, markdown);
    else assert.equal(markdown, await readFile(md, "utf8"), "projection");
    assert.match(
      markdown,
      /^<!-- Markdown export from html-text: a reading copy, not the document\./,
    );

    const back = reimport(markdown);
    const record = {
      differences: delta(census(doc), census(back.doc)),
      importReport: Object.fromEntries(back.lost),
      changed: retained(doc, back.doc),
      notice: Object.fromEntries(Object.entries(lost).filter(([, n]) => n)),
    };
    written[name] = record;
    if (!WRITE) assert.deepEqual(record, expected[name], "recorded losses");
    for (const [key, n] of Object.entries(record.differences))
      if (n < 0)
        assert.ok(
          LOSS.some(([pattern]) => pattern.test(key)),
          `undocumented loss: ${key}`,
        );
      else assert.match(key, ADDED, `unexpected addition: ${key}`);
    // Markdown has no carriage return: in code it reads back as a line feed (FORMAT.md).
    for (const [was, now] of record.changed.code)
      assert.equal(now, was.replace(/\r\n?/g, "\n"), "code text kept");
    // Inline code reads back as HTML text: runs of spaces become one (FORMAT.md).
    for (const [was, now] of record.changed.inline)
      assert.equal(now, was.replace(/\s+/g, " "), "inline code kept");
    assert.deepEqual(record.changed.links, [], "link targets kept");
    assert.ok(
      isSubsequence(words(doc), words(back.doc)),
      "every word of the text is in the import, in order",
    );
  });

test.after(async () => {
  if (WRITE)
    await writeFile(
      new URL("reimport.json", records),
      JSON.stringify(written, null, 2) + "\n",
    );
});

const p = (...content) => N.paragraph.create(null, content);
const t = (s, marks) => schema.text(s, marks);

test("Markdown text: characters Markdown reads as syntax come back as the same text", () => {
  const lines = [
    "# not a heading",
    "#hashtag and C# stay",
    "1. not a list",
    "2026) not a list either",
    "- dash",
    "+ plus",
    "> not a quote",
    "===",
    "---",
    "*stars* and _underscores_ and snake_case",
    "[brackets](https://example.org) and ![bang](x)",
    "<b>tag</b> and <!-- comment -->",
    "&amp; &#169; & alone",
    "a | b",
    "`ticks` and ``double``",
    "back\\slash \\* and trailing \\",
    "~~strike~~",
    "    four spaces",
    "ends with #",
  ];
  const doc = N.doc.create(
    null,
    lines.map((s) => p(t(s))),
  );
  const back = reimport(toMarkdown(doc).markdown).doc;
  const texts = [];
  back.forEach((n) => texts.push(n.textContent));
  assert.deepEqual(
    texts,
    lines.map((s) => s.replace(/^ +/, "")),
  );
});

test("Markdown marks: delimiters around spaces, breaks, code spans with backticks, links with parentheses", () => {
  const strong = [M.strong.create()],
    em = [M.em.create()];
  const link = [M.link.create({ href: "https://example.org/a_(b) c" })];
  const doc = N.doc.create(null, [
    p(t("a"), t(" bold ", strong), t("b")),
    p(t("x"), t("em", em), t("y")),
    p(t("one ` two", [M.code.create()]), t(" "), t("`x`", [M.code.create()])),
    p(t("link", link)),
    p(
      N.hard_break.create(),
      t("start"),
      N.hard_break.create(),
      t("end"),
      N.hard_break.create(),
    ),
    p(t("sup", [M.sup.create()]), t(" and "), t("hi", [M.highlight.create()])),
  ]);
  const { markdown } = toMarkdown(doc);
  assert.match(markdown, /^a \*\*bold\*\* b$/m);
  assert.match(markdown, /^x\*em\*y$/m);
  assert.match(markdown, /^``one ` two`` `` `x` ``$/m);
  assert.match(markdown, /\[link\]\(https:\/\/example\.org\/a_%28b%29%20c\)/);
  assert.match(markdown, /^start\\\nend$/m);
  const back = reimport(markdown).doc;
  const html = [];
  back.forEach((n) => html.push(n.toString()));
  assert.deepEqual(html, [
    'paragraph("a ", strong("bold"), " b")',
    'paragraph("x", em("em"), "y")',
    'paragraph(code("one ` two"), " ", code("`x`"))',
    'paragraph(link("link"))',
    'paragraph("start", hard_break, "end")',
    'paragraph(sup("sup"), " and ", highlight("hi"))',
  ]);
  assert.equal(
    back.child(3).firstChild.marks[0].attrs.href,
    "https://example.org/a_%28b%29%20c",
  );
});

test("Markdown blocks: lists of one kind in a row stay apart, code fences outrun the code, pipes in cells", () => {
  const item = (s) => N.list_item.create(null, N.list_text.create(null, t(s)));
  const code = "```\nfenced inside\n````";
  const cell = (s, marks) => N.table_cell.create(null, t(s, marks));
  const doc = N.doc.create(null, [
    N.bullet_list.create(null, [item("a")]),
    N.bullet_list.create(null, [item("b")]),
    N.bullet_list.create(null, [item("c")]),
    N.ordered_list.create(null, [item("one")]),
    N.ordered_list.create(null, [item("two")]),
    N.code_block.create(null, t(code)),
    N.table_figure.create({ id: "tab-1" }, [
      N.table.create(null, [
        N.table_row.create(null, [
          cell("a | b"),
          cell("x | y", [M.code.create()]),
        ]),
      ]),
    ]),
  ]);
  const { markdown } = toMarkdown(doc);
  assert.match(markdown, /^- a\n\n\* b\n\n- c\n\n1\. one\n\n1\) two$/m);
  const back = reimport(markdown).doc;
  const kinds = [];
  back.forEach((n) => kinds.push(n.type.name));
  assert.deepEqual(kinds, [
    "bullet_list",
    "bullet_list",
    "bullet_list",
    "ordered_list",
    "ordered_list",
    "code_block",
    "table_figure",
  ]);
  assert.equal(back.child(5).textContent, code);
  const row = back.child(6).lastChild.lastChild;
  assert.equal(row.child(0).textContent, "a | b");
  assert.equal(row.child(1).textContent, "x | y");
  assert.ok(row.child(1).firstChild.marks.some((m) => m.type === M.code));
});

// Regressions from the T15 review: each input reads back as intended.
const back = (doc) => {
  const { markdown } = toMarkdown(doc);
  const { doc: d } = reimport(markdown);
  return { markdown, doc: d, first: d.firstChild };
};

test("Markdown review: ! before a link, one-word notes, entities in addresses, comments inside marks", () => {
  const link = (href) => [M.link.create({ href })];
  let r = back(
    N.doc.create(null, p(t("!"), t("linked", link("https://example.org/")))),
  );
  assert.match(r.markdown, /^\\!\[linked\]/m);
  assert.equal(r.first.toString(), 'paragraph("!", link("linked"))');
  r = back(
    N.doc.create(null, p(t("Body"), N.footnote.create(null, t("word")))),
  );
  assert.match(r.markdown, /^\[\^1\]: <!---->word$/m);
  assert.deepEqual(words(r.doc), ["Body", "1", "1", "word"]);
  const href = "https://example.org/?x=&#x41;&amp;y";
  r = back(N.doc.create(null, p(t("x", link(href)))));
  assert.equal(r.first.firstChild.marks[0].attrs.href, href);
  const comment = M.comment.create({ ref: "c1" }),
    code = M.code.create(),
    em = M.em.create();
  r = back(
    N.doc.create(null, [
      p(t("alpha", [code]), t("beta", [comment, code]), t("gamma", [code])),
      p(t("a", [em]), t("b", [comment, em]), t("c", [em])),
    ]),
  );
  assert.match(r.markdown, /^`alphabetagamma`$/m);
  assert.match(r.markdown, /^\*abc\*$/m);
  assert.equal(r.doc.child(0).toString(), 'paragraph(code("alphabetagamma"))');
  assert.equal(r.doc.child(1).toString(), 'paragraph(em("abc"))');
});

test("Markdown review: emphasis next to punctuation and code, code around breaks, cover title hashes", () => {
  const em = [M.em.create()],
    code = M.code.create();
  const r = back(
    N.doc.create(null, [
      N.cover.create(null, N.title.create(null, t("C #"))),
      p(t("a"), t("!", em), t("b")),
      p(t("a"), t("b", [M.em.create(), code]), t("c")),
      p(
        t("a", [code]),
        N.hard_break.create(null, null, [code]),
        t("b", [code]),
      ),
      p(t("31%", [M.strong.create()]), t(" and "), t("B", [M.strong.create()])),
    ]),
  );
  const kids = [];
  r.doc.forEach((n) => kids.push(n.toString()));
  assert.deepEqual(kids, [
    'heading("C #")',
    'paragraph("a", em("!"), "b")',
    'paragraph("a", em(code("b")), "c")',
    'paragraph(code("a"), hard_break, code("b"))',
    'paragraph(strong("31%"), " and ", strong("B"))',
  ]);
  assert.match(r.markdown, / and \*\*B\*\*$/m);
});

test("Markdown review: lists stay apart across left-out blocks; chart labels with line breaks stay in their cells", () => {
  const item = (s) => N.list_item.create(null, N.list_text.create(null, t(s)));
  const data = JSON.stringify({
    title: "Two\nlines",
    categories: ["North\nSouth", "East"],
    series: [{ name: "A\nB", values: [1, 2] }],
  });
  const r = back(
    N.doc.create(null, [
      N.ordered_list.create(null, item("a")),
      N.page_break.create(),
      N.ordered_list.create(null, item("b")),
      p(),
      N.ordered_list.create(null, item("c")),
      N.chart.create({ id: "fig-1", type: "column", data }),
    ]),
  );
  const kinds = [];
  r.doc.forEach((n) => kinds.push(n.type.name));
  assert.deepEqual(kinds, [
    "ordered_list",
    "ordered_list",
    "ordered_list",
    "paragraph",
    "table_figure",
  ]);
  const rows = r.doc.lastChild.lastChild;
  assert.equal(rows.child(0).child(1).textContent, "A B");
  assert.equal(rows.child(1).child(0).textContent, "North South");
  assert.match(r.markdown, /^\*Chart \(column\): Two lines\*$/m);
});

test("Markdown review: protected text keeps words whole and leaves hidden content out; long code and large tables", () => {
  const tree = element(
    "section",
    [],
    [
      element(
        "p",
        [["class", "other"]],
        [text("foo"), element("strong", [], [text("bar")]), text("baz")],
      ),
      element("div", [["hidden", ""]], [text("secret")]),
      element("p", [], [text("next")]),
    ],
  );
  const { markdown } = toMarkdown(
    N.doc.create(null, N.protected.create({ node: tree })),
  );
  assert.match(markdown, /^foobarbaz next$/m);
  assert.doesNotMatch(markdown, /secret/);
  const code = "` x ".repeat(140000);
  const long = toMarkdown(
    N.doc.create(null, [
      N.code_block.create(null, t(code)),
      p(t(code, [M.code.create()])),
    ]),
  ).markdown;
  assert.ok(long.includes(code.trim()));
  const size = 300;
  const cell = N.table_cell.create(null, t("1"));
  const row = N.table_row.create(null, Array(size).fill(cell));
  const table = N.table_figure.create(
    { id: "tab-1" },
    N.table.create(null, Array(size).fill(row)),
  );
  const started = performance.now();
  toMarkdown(N.doc.create(null, table));
  const ms = performance.now() - started;
  assert.ok(ms < 3000, `${size * size} cells in ${Math.round(ms)} ms`);
});

test("Markdown review: the command line runs through a symbolic link", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "text-markdown-"));
  try {
    const link = join(tmp, "markdown.mjs");
    await symlink(
      fileURLToPath(new URL("../tools/markdown.mjs", import.meta.url)),
      link,
    );
    const r = spawnSync(
      process.execPath,
      [link, fileURLToPath(new URL("minimal.html", dir))],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.match(
      r.stdout,
      /^<!-- Markdown export[\s\S]*\n\nOne paragraph\.\n$/,
    );
  } finally {
    await rm(tmp, { recursive: true });
  }
});

test("Markdown re-verification: escaped backslash before a link, notes with no-break spaces, references in code, details", () => {
  const link = [M.link.create({ href: "https://example.org/" })];
  let r = back(N.doc.create(null, p(t("\\!"), t("linked", link))));
  assert.equal(r.first.toString(), 'paragraph("\\\\!", link("linked"))');
  r = back(
    N.doc.create(null, p(t("Body"), N.footnote.create(null, t("a\u00a0b")))),
  );
  assert.match(r.markdown, /^\[\^1\]: <!---->a\u00a0b$/m);
  assert.ok(words(r.doc).includes("a"));
  const code = [M.code.create()];
  const { markdown } = toMarkdown(
    N.doc.create(null, [
      N.heading.create({ level: 1, id: "h1" }, t("Title")),
      p(
        t("a", code),
        N.xref.create({ target: "h1", label: "Title" }, null, code),
        t("b", code),
      ),
    ]),
  );
  assert.match(markdown, /^`a``Title``b`$/m);
  const tree = element(
    "details",
    [["open", ""]],
    [element("summary", [], [text("Title")]), text("Body")],
  );
  assert.match(
    toMarkdown(N.doc.create(null, N.protected.create({ node: tree }))).markdown,
    /^Title Body$/m,
  );
  const inlineCode = reimport(
    toMarkdown(N.doc.create(null, p(t("a  b", code)))).markdown,
  ).doc;
  assert.deepEqual(
    retained(N.doc.create(null, p(t("a  b", code))), inlineCode).inline,
    [["a  b", "a b"]],
  );
});

test("Markdown re-verification: importing the tool from standard input does not throw", () => {
  const r = spawnSync(process.execPath, ["--input-type=module", "-"], {
    input: `import ${JSON.stringify(new URL("../tools/markdown.mjs", import.meta.url).href)}; console.log("imported");`,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "imported\n");
});
