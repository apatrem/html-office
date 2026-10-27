// Seeded random documents built with the schema, for round-trip properties and size tests.
import { schema } from "../editor/schema/schema.mjs";

const N = schema.nodes,
  M = schema.marks;

export function random(seed) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 2 ** 32;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
  };
}

// Text that stresses escaping and the parser: markup-like text, entities, no-break and
// astral characters, combining marks, right-to-left scripts and comment delimiters.
const PIECES = [
  "Revenue",
  "grew",
  "18%",
  "in",
  "2026",
  "<p>",
  "</script>",
  "&amp;",
  "&",
  "<!--",
  "-->",
  "]]>",
  '"quoted"',
  "'single'",
  "a\u00a0b",
  "déjà",
  "Ωmega",
  "漢字",
  "🌱",
  "👩‍💻",
  "e\u0301",
  "שלום",
  "مرحبا",
  "x<y>z",
  "\u200b",
];

export function words(r, count) {
  return Array.from({ length: count }, () => r.pick(PIECES)).join(" ");
}

const MARKS = ["link", "strong", "em", "u", "highlight", "sub", "sup", "code"];

function marks(r, refs) {
  let set = [];
  for (const name of MARKS)
    if (r.chance(0.2)) {
      const mark =
        name === "link"
          ? M.link.create({ href: `https://example.org/${r.int(9)}?a=1&b="2"` })
          : M[name].create();
      set = mark.addToSet(set);
    }
  if (refs.length && r.chance(0.15))
    set = M.comment.create({ ref: r.pick(refs) }).addToSet(set);
  return set;
}

function inline(r, ctx, { footnotes = true } = {}) {
  const out = [];
  const count = 1 + r.int(5);
  for (let i = 0; i < count; i++) {
    const kind = r.int(10);
    // Links hold only text and line breaks (no nested <a>).
    const set = marks(r, ctx.refs).filter((m) => kind > 1 || m.type !== M.link);
    if (kind === 0 && footnotes)
      out.push(
        N.footnote.create(null, inline(r, ctx, { footnotes: false }), set),
      );
    else if (kind === 1 && ctx.targets.length)
      out.push(
        N.xref.create(
          { target: r.pick(ctx.targets), label: words(r, 2) },
          null,
          set,
        ),
      );
    else if (kind === 2 && footnotes)
      out.push(N.hard_break.create(null, null, set));
    else out.push(schema.text(words(r, 1 + r.int(6)), set));
  }
  return out;
}

function list(r, ctx, depth = 0) {
  return N[r.chance(0.5) ? "bullet_list" : "ordered_list"].create(
    null,
    Array.from({ length: 1 + r.int(3) }, () =>
      N.list_item.create(null, [
        N.list_text.create(null, r.chance(0.1) ? [] : inline(r, ctx)),
        ...(depth < 2 && r.chance(0.25) ? [list(r, ctx, depth + 1)] : []),
      ]),
    ),
  );
}

const ALIGNS = [null, "ta-l", "ta-c", "ta-r", "ta-j"];

function block(r, ctx) {
  const id = () => `id-${ctx.ids++}`;
  switch (r.int(10)) {
    case 0: {
      const target = id();
      ctx.targets.push(target);
      ctx.headings.push(target);
      return N.heading.create(
        {
          level: 1 + r.int(4),
          id: target,
          unnumbered: r.chance(0.2),
          newPage: r.chance(0.1),
          align: r.pick(ALIGNS.slice(0, 4)),
        },
        inline(r, ctx),
      );
    }
    case 1:
      return list(r, ctx);
    case 2:
      return N.blockquote.create(null, [
        N.paragraph.create({ align: r.pick(ALIGNS) }, inline(r, ctx)),
      ]);
    case 3:
      return N.callout.create({ kind: r.pick(["note", "warning", "key"]) }, [
        N.paragraph.create(null, inline(r, ctx)),
        list(r, ctx),
      ]);
    case 4:
      return N.code_block.create(null, [
        schema.text(`${words(r, 3)}\n\tindented ${words(r, 2)}\n`),
      ]);
    case 5: {
      const target = id();
      ctx.targets.push(target);
      const width = 1 + r.int(4);
      const cell = (header) =>
        N[header ? "table_header" : "table_cell"].create(
          { align: r.pick([null, "ta-l", "ta-c", "ta-r"]) },
          r.chance(0.1) ? [] : inline(r, ctx, { footnotes: false }),
        );
      const row = (head) =>
        N.table_row.create(
          { head, total: !head && r.chance(0.2) },
          Array.from({ length: width }, () => cell(head || r.chance(0.2))),
        );
      return N.table_figure.create({ id: target }, [
        ...(r.chance(0.5) ? [N.caption.create(null, inline(r, ctx))] : []),
        N.table.create(
          {
            compact: r.chance(0.3),
            cols: r.chance(0.5)
              ? Array.from({ length: width }, () => ({
                  width: String(1 + r.int(100)),
                  emphasis: r.chance(0.2),
                }))
              : null,
          },
          [
            ...(r.chance(0.5) ? [row(true)] : []),
            ...Array.from({ length: 1 + r.int(3) }, () => row(false)),
          ],
        ),
      ]);
    }
    case 6:
      return N.page_break.create();
    default:
      return N.paragraph.create(
        { lead: r.chance(0.1), align: r.pick(ALIGNS) },
        r.chance(0.05) ? [] : inline(r, ctx),
      );
  }
}

// A valid document: cover, contents, blocks and comment threads that every comment mark refers to.
export function generate(seed, blocks = 30) {
  const r = random(seed);
  const threads = Array.from({ length: r.int(3) }, (_, i) => `c${i + 1}`);
  const ctx = { ids: 0, targets: [], headings: [], refs: threads };
  const content = Array.from({ length: blocks }, () => block(r, ctx));
  const doc = N.doc.create(
    {
      lang: r.pick(["en-GB", "fr-FR", "de"]),
      headingNumbers: r.chance(0.5),
      theme: r.pick([null, "green"]),
      page: r.pick([null, "a4", "letter"]),
      margins: r.pick([null, "narrow", "wide"]),
    },
    [
      N.cover.create(null, [
        N.title.create(null, [schema.text(words(r, 4))]),
        N.subtitle.create(null, [schema.text(words(r, 3))]),
      ]),
      N.toc.create({
        depth: 2,
        entries: ctx.headings
          .slice(0, 3)
          .map((target) => ({ target, label: words(r, 2), children: [] })),
      }),
      ...content,
      ...(threads.length
        ? [
            N.comments.create(
              null,
              threads.map((id) =>
                N.comment_thread.create({
                  id,
                  status: r.pick(["open", "resolved"]),
                  quote: words(r, 3),
                  prefix: r.chance(0.5) ? words(r, 1) : null,
                  entries: [
                    {
                      author: "Alex",
                      date: "2026-10-15T14:02Z",
                      text: `${words(r, 5)}\nsecond line`,
                    },
                  ],
                }),
              ),
            ),
          ]
        : []),
    ],
  );
  return doc;
}

export const envelope = (article) =>
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Generated</title>\n</head>\n<body>\n${article}\n</body>\n</html>\n`;
