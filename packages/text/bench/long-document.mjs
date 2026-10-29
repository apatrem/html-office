#!/usr/bin/env node
// The long-document fixture (T16, reused by T17): a fictional programme review of about 500 words
// a page, generated deterministically (a seeded generator, no clock, no randomness), with one
// figure every two pages (charts, images, tables in a 4:3:3 ratio), footnotes, cross-references,
// comments, contents, callouts, lists, quotes and code, in canonical form with current labels.
//   node bench/long-document.mjs [--pages 100] [<output.html>]
// Default output: bench/fixtures/report-<pages>.html. tests/sections.test.mjs regenerates the
// committed 100-page file and compares it byte for byte.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { writeFile, mkdir } from "node:fs/promises";
import { Transform } from "prosemirror-transform";
import { schema } from "../editor/schema/schema.mjs";
import { articleHTML } from "../editor/schema/serialize.mjs";
import { regenerate } from "../editor/numbering.mjs";
import { element } from "../model/html.mjs";
import { CHARTE_CSS, LAYOUT_CSS } from "../theme/index.mjs";
import { random } from "../tests/generate.mjs";

const N = schema.nodes,
  M = schema.marks;
const WORDS_PER_PAGE = 500;

const VOCABULARY =
  `the a of and to in for with on by from across each every this that their our
site sites bed beds soil water compost seed seedling harvest crop crops volunteer volunteers team
teams region regions north south east west programme season seasons plan budget cost costs grant
partner partners school schools market markets survey surveys training visit visits tool tools
irrigation rainfall drought yield yields growth record records report review target targets plot
plots greenhouse orchard hedge pollinator pollinators storage delivery route routes community
kitchen sale sales member members trust council week weeks month months year years spring summer
autumn winter early late steady strong weak higher lower stable uneven local shared new existing
planned measured reported reviewed improved reduced extended opened closed trained recorded
supported delivered agreed expected remained rose fell doubled halved kept moved`
    .split(/\s+/)
    .filter(Boolean);
const CHAPTERS = [
  "Sites and soil",
  "Water and irrigation",
  "Volunteers",
  "Harvests",
  "Finance",
  "Partners and schools",
  "Training",
  "Equipment and storage",
  "Outreach and markets",
  "Outlook",
];
const ASPECTS = [
  "Context",
  "Findings",
  "Regional detail",
  "Risks",
  "Next steps",
];
const REGIONS = ["North", "South", "East", "West", "Coast", "Valley"];

const t = (s, marks) => schema.text(s, marks);
const p = (content, attrs = null) => N.paragraph.create(attrs, content);
const capital = (s) => s[0].toUpperCase() + s.slice(1);

export function longDocument({ pages = 100 } = {}) {
  const r = random(20261029);
  const target = pages * WORDS_PER_PAGE;
  const chapters = Math.max(2, Math.round(pages / 10));
  const figuresWanted = Math.round(pages / 2);
  const sentence = (min = 8, max = 18) => {
    const n = min + r.int(max - min + 1);
    return (
      capital(Array.from({ length: n }, () => r.pick(VOCABULARY)).join(" ")) +
      "."
    );
  };
  const ctx = {
    words: 0,
    footnotes: 0,
    figures: [],
    sections: [],
    threads: [],
    assets: {},
  };
  const count = (s) => (ctx.words += s.split(/\s+/).filter(Boolean).length);

  // A paragraph of 4–7 sentences with, now and then, marks, a footnote, a cross-reference to an
  // earlier figure or section, or a comment anchor.
  function paragraph(section) {
    const content = [];
    const n = 4 + r.int(4);
    for (let i = 0; i < n; i++) {
      const s = sentence();
      count(s);
      if (i === 1 && r.chance(0.03)) {
        const words = s.split(" ");
        const quote = words.slice(0, 3).join(" ");
        const id = `c${ctx.threads.length + 1}`;
        ctx.threads.push({ id, quote, section });
        content.push(t(quote, [M.comment.create({ ref: id })]));
        content.push(t(" " + words.slice(3).join(" ") + " "));
        continue;
      }
      if (i === 2 && r.chance(0.2)) {
        const words = s.split(" ");
        content.push(t(words.slice(0, 2).join(" ") + " "));
        content.push(t(words[2], [M[r.pick(["strong", "em"])].create()]));
        content.push(t(" " + words.slice(3).join(" ") + " "));
        continue;
      }
      content.push(t(s + " "));
      if (i === 0 && r.chance(0.15)) {
        const note = sentence(6, 12);
        count(note);
        ctx.footnotes++;
        content.push(N.footnote.create(null, t(note)));
        content.push(t(" "));
      }
    }
    if (r.chance(0.35) && (ctx.figures.length || ctx.sections.length > 1)) {
      const figure = ctx.figures.length && r.chance(0.7);
      const target = figure
        ? r.pick(ctx.figures)
        : r.pick(ctx.sections.slice(0, -1));
      content.push(t("See "), N.xref.create({ target, label: "" }), t("."));
      count("See it.");
    } else content[content.length - 1] = trimEnd(content.at(-1));
    return p(content);
  }
  const trimEnd = (node) =>
    node.isText ? t(node.text.trimEnd(), node.marks) : node;
  const heading = (level, id, text) => {
    ctx.sections.push(id);
    count(text);
    return N.heading.create(
      { level, id, newPage: level === 1 && ctx.sections.length > 1 },
      t(text),
    );
  };

  function chart(id) {
    const type = r.pick(["column", "line", "hbar", "stacked"]);
    const categories = REGIONS.slice(0, 3 + r.int(4));
    const series = ["2025", "2026"].map((name) => ({
      name,
      values: categories.map(() => Math.round(r.next() * 900 + 100) / 10),
    }));
    const title = `${r.pick(["Yield", "Visits", "Volunteer hours", "Water use", "Sales"])} by region`;
    const data = JSON.stringify({ title, unit: "index", categories, series });
    const bars = categories.map((_, i) =>
      element(
        "rect",
        [
          ["x", String(40 + i * 55)],
          ["y", String(170 - Math.round(series[1].values[i] * 1.5))],
          ["width", "40"],
          ["height", String(Math.round(series[1].values[i] * 1.5))],
          ["fill", "#14517A"],
        ],
        [],
        "svg",
      ),
    );
    const preview = element(
      "svg",
      [
        ["xmlns", "http://www.w3.org/2000/svg"],
        ["class", "render"],
        ["viewBox", "0 0 400 200"],
      ],
      [element("g", [], bars, "svg")],
      "svg",
    );
    return N.chart.create(
      { id, type, width: r.chance(0.25) ? "full" : "text", data, preview },
      N.caption.create(null, t(`${title}, 2025 and 2026`)),
    );
  }
  function image(id) {
    const key = `a${Object.keys(ctx.assets).length + 1}`;
    const hue = r.int(360);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><rect width="160" height="100" fill="hsl(${hue} 35% 85%)"/><path d="M0 80 Q40 ${30 + r.int(40)} 80 70 T160 60 V100 H0Z" fill="hsl(${hue} 45% 45%)"/></svg>`;
    ctx.assets[key] = {
      type: "image/svg+xml",
      data: Buffer.from(svg).toString("base64"),
    };
    const wrap = r.chance(0.4) ? r.pick(["left", "right"]) : null;
    return N.image_figure.create(
      {
        id,
        width: wrap ? r.pick(["33", "40"]) : "text",
        wrap,
        asset: key,
        alt: `Fictional drawing of planting beds at the ${r.pick(REGIONS).toLowerCase()} site`,
      },
      N.caption.create(null, t(`The ${r.pick(REGIONS).toLowerCase()} site`)),
    );
  }
  function table(id) {
    const cell = (s, attrs = null, type = N.table_cell) =>
      type.create(attrs, s ? t(s) : null);
    const regions = REGIONS.slice(0, 3 + r.int(3));
    const rows = regions.map((name) => {
      const a = Math.round(r.next() * 90 + 10) / 10,
        b = Math.round(r.next() * 90 + 10) / 10;
      return [name, a, b];
    });
    const sum = (k) =>
      String(Math.round(rows.reduce((s, row) => s + row[k], 0) * 10) / 10);
    return N.table_figure.create({ id }, [
      N.caption.create(
        null,
        t(
          `${r.pick(["Costs", "Grants", "Harvest", "Hours"])} by region, thousands`,
        ),
      ),
      N.table.create(null, [
        N.table_row.create({ head: true }, [
          cell("Region", { rowspan: 2 }, N.table_header),
          cell("Value", { colspan: 2 }, N.table_header),
        ]),
        N.table_row.create({ head: true }, [
          cell("2025", { align: "ta-r" }, N.table_header),
          cell("2026", { align: "ta-r" }, N.table_header),
        ]),
        ...rows.map(([name, a, b]) =>
          N.table_row.create(null, [
            cell(name),
            cell(String(a), { align: "ta-r" }),
            cell(String(b), { align: "ta-r" }),
          ]),
        ),
        N.table_row.create({ total: true }, [
          cell("Total"),
          cell(sum(1), { align: "ta-r" }),
          cell(sum(2), { align: "ta-r" }),
        ]),
      ]),
    ]);
  }
  const KINDS = [
    "chart",
    "table",
    "image",
    "chart",
    "table",
    "image",
    "chart",
    "chart",
    "table",
    "image",
  ];
  const figure = (id) => {
    const kind = KINDS[ctx.figures.length % KINDS.length];
    const node = { chart, image, table }[kind](
      `${kind === "table" ? "tab" : "fig"}-${id}`,
    );
    ctx.figures.push(node.attrs.id);
    return node;
  };

  const sectionsTotal = chapters * (1 + ASPECTS.length * 1.6);
  // Paragraphs average about 90 words: stop half a paragraph short of the share.
  const budget = target / sectionsTotal - 45;
  // Paragraphs until the section has its share of the words.
  const prose = (id) => {
    const out = [];
    const start = ctx.words;
    while (ctx.words - start < budget) out.push(paragraph(id));
    return out;
  };
  const list = (ordered) =>
    N[ordered ? "ordered_list" : "bullet_list"].create(
      null,
      Array.from({ length: 3 + r.int(3) }, () => {
        const s = sentence(4, 9).slice(0, -1);
        count(s);
        return N.list_item.create(null, N.list_text.create(null, t(s)));
      }),
    );

  const blocks = [
    N.cover.create(null, [
      N.title.create(null, t("Northwind Gardens programme review 2022–2026")),
      N.subtitle.create(null, t("A fictional long document")),
      p(
        t(`About ${pages} pages, generated for section tooling and benchmarks`),
      ),
    ]),
    N.toc.create({ depth: 2 }),
  ];
  for (let c = 1; c <= chapters; c++) {
    const name =
      CHAPTERS[(c - 1) % CHAPTERS.length] +
      (c > CHAPTERS.length ? ` ${Math.ceil(c / CHAPTERS.length)}` : "");
    const ch = `ch-${c}`;
    blocks.push(heading(1, ch, name), ...prose(ch));
    blocks.push(
      N.callout.create(
        { kind: r.pick(["note", "key", "warning"]) },
        p(t(sentence())),
      ),
    );
    for (let s = 1; s <= ASPECTS.length; s++) {
      const id = `sec-${c}-${s}`;
      blocks.push(heading(2, id, `${name}: ${ASPECTS[s - 1].toLowerCase()}`));
      const text = prose(id);
      const half = Math.ceil(text.length / 2);
      blocks.push(...text.slice(0, half));
      if (ctx.figures.length < figuresWanted) blocks.push(figure(`${c}-${s}`));
      blocks.push(...text.slice(half));
      if (s % 2 === 0) {
        const sub = `${id}-1`;
        blocks.push(
          heading(3, sub, `${REGIONS[(c + s) % REGIONS.length]} detail`),
          ...prose(sub),
          list(s % 4 === 0),
        );
        if (s === 4) {
          const deep = `${sub}-1`;
          blocks.push(heading(4, deep, "Method notes"), ...prose(deep));
          blocks.push(
            N.code_block.create(
              null,
              t(`index = value / baseline\nbaseline = ${c * 10}`),
            ),
          );
        }
      }
      if (s === 3) blocks.push(N.blockquote.create(null, p(t(sentence()))));
    }
  }
  const quoteOf = new Map(ctx.threads.map((th) => [th.id, th]));
  blocks.push(
    N.comments.create(
      null,
      ctx.threads.map((th, i) =>
        N.comment_thread.create({
          id: th.id,
          status: i % 3 === 2 ? "resolved" : "open",
          quote: quoteOf.get(th.id).quote,
          section: th.section,
          entries: [
            {
              author: ["Alex", "Sam", "Robin"][i % 3],
              date: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T09:${String(i % 60).padStart(2, "0")}Z`,
              text: sentence(6, 14),
            },
          ],
        }),
      ),
    ),
  );
  const doc = N.doc.create({ lang: "en-GB", headingNumbers: true }, blocks);
  doc.check();
  const tr = new Transform(doc);
  regenerate(tr, {});
  const assets = JSON.stringify(ctx.assets);
  const html = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="generator" content="html-text bench/long-document.mjs">',
    `<title>Northwind Gardens programme review (${pages} pages, fictional)</title>`,
    '<meta name="html-text-format-version" content="1">',
    `<style id="charte">${CHARTE_CSS}</style>`,
    `<style id="theme">${LAYOUT_CSS}</style>`,
    "</head>",
    "<body>",
    articleHTML(tr.doc),
    `<script id="assets" type="application/json">${assets}</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
  return {
    html,
    words: ctx.words,
    figures: ctx.figures.length,
    footnotes: ctx.footnotes,
    threads: ctx.threads.length,
  };
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
  const at = args.indexOf("--pages");
  const pages = at >= 0 ? Number(args.splice(at, 2)[1]) : 100;
  const output =
    args[0] ??
    new URL(`fixtures/report-${pages}.html`, import.meta.url).pathname;
  const result = longDocument({ pages });
  await mkdir(new URL("fixtures/", import.meta.url), { recursive: true });
  await writeFile(output, result.html);
  console.log(
    `${output}: ${result.html.length.toLocaleString("en")} characters, ${result.words.toLocaleString("en")} words, ${result.figures} figures, ${result.footnotes} footnotes, ${result.threads} comment threads`,
  );
}
