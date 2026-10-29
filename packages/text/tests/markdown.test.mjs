// T15 Markdown view and export in Node: every valid fixture projects to its committed Markdown
// (fixtures/markdown/*.md), and that Markdown, imported back through T07 (Insert › Markdown…),
// gives a document whose differences from the original are exactly the recorded, documented
// losses (fixtures/markdown/reimport.json; FORMAT.md › Markdown view and export). No text is
// lost apart from comments. MARKDOWN_SNAPSHOTS=write rewrites both records after a deliberate change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
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
