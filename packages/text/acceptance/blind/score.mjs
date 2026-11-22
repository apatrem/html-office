#!/usr/bin/env node
// T20 blind-test kit: runs the objective checks of tasks.mjs on the files a blind session
// produced in a kit made by prepare.mjs, with the kit's own skill tools, and prints one
// Markdown row per check for the results sheet (docs/blind-tests/RESULTS-T20.md). The judged
// criteria are left to the person. Writes <kit>/score-text.json.
//
// Usage: node packages/text/acceptance/blind/score.mjs <kit-folder> [--task A2] [--json]
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TASKS } from "./tasks.mjs";
import { articleBounds } from "./prepare.mjs";

const run = promisify(execFile);

export async function score(kit, { only } = {}) {
  kit = resolve(kit);
  const tool = join(kit, "skill/html-text/tools/document.mjs");
  const text = async (...args) => {
    try {
      const r = await run(process.execPath, [tool, ...args], {
        maxBuffer: 1 << 26,
      });
      return { code: 0, stdout: r.stdout, stderr: r.stderr };
    } catch (e) {
      return {
        code: e.code ?? 1,
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? String(e),
      };
    }
  };
  const scratch = join(kit, "work/score");
  await mkdir(scratch, { recursive: true });

  // A parsed document: raw text, canonical (packed) text and its outline. Cached by path.
  const docs = new Map();
  const load = async (path) => {
    if (docs.has(path)) return docs.get(path);
    const raw = await readFile(path, "utf8");
    const packed = join(scratch, `${docs.size}-${basename(path)}`);
    const p = await text("pack", path, "--out", packed);
    if (p.code) throw new Error(`pack refused the file: ${firstLine(p)}`);
    const html = await readFile(packed, "utf8");
    const o = await text("outline", packed, "--json");
    if (o.code) throw new Error(`outline refused the file: ${firstLine(o)}`);
    const doc = { raw, html, outline: JSON.parse(o.stdout) };
    docs.set(path, doc);
    return doc;
  };
  const baseline = (task, name) => {
    const own = join(kit, "reference", `${task.track}-${name}`);
    return existsSync(own) ? own : join(kit, "reference", name);
  };

  const results = [];
  for (const task of TASKS) {
    if (only && task.id !== only) continue;
    for (const check of task.checks) {
      const row = {
        task: task.id,
        check: label(check),
        pass: false,
        detail: "",
      };
      try {
        const file = join(kit, check.file);
        if (!existsSync(file)) {
          row.detail = `${check.file} is missing`;
        } else {
          const before = check.before && baseline(task, check.before);
          Object.assign(
            row,
            await CHECKS[check.kind](check, { kit, file, before, load, text }),
          );
        }
      } catch (e) {
        row.pass = false;
        row.detail = e.message;
      }
      results.push(row);
    }
  }
  await writeFile(
    join(kit, "score-text.json"),
    JSON.stringify({ date: new Date().toISOString(), results }, null, 2) + "\n",
  );
  return results;
}

// Generated content (cross-reference labels, contents entries) follows the numbering of the
// whole document, which pack rewrites: whether a section is kept is judged without it.
export const withoutGenerated = (html) =>
  html
    .replace(/(<a class="xref" href="[^"]*">)[^<]*(<\/a>)/g, "$1$2")
    .replace(/(<nav class="toc"[^>]*>)[\s\S]*?(<\/nav>)/g, "$1$2");

const firstLine = (r) => (r.stderr || r.stdout).trim().split("\n")[0];
const label = (c) =>
  [c.kind, c.section, c.id ?? c.target ?? c.thread ?? c.what]
    .filter(Boolean)
    .join(" ");

// The bytes of a section without its subsections: from its heading to its first child.
export function own(doc, id) {
  const s = doc.outline.find((x) => x.id === id);
  if (!s) throw new Error(`no section ${id}`);
  const child = doc.outline
    .filter((x) => x.parent === id)
    .reduce((m, x) => Math.min(m, x.start), s.end);
  return doc.html.slice(s.start, child);
}

// Every part of the article: before the first section, each section's own bytes, and each
// comment thread; plus what follows the threads.
export function parts(doc) {
  const { html, outline } = doc;
  const [start, end] = articleBounds(html);
  const first = outline.reduce((m, x) => Math.min(m, x.start), end);
  const last = outline.reduce((m, x) => Math.max(m, x.end), first);
  const out = new Map([
    ["(before the first heading)", html.slice(start, first)],
  ]);
  for (const s of outline) out.set(s.id, own(doc, s.id));
  const tail = html.slice(last, end);
  for (const [id, body] of threads(tail)) out.set(`thread ${id}`, body);
  out.set(
    "(after the sections)",
    tail.replace(/<aside class="comment-thread"[\s\S]*?<\/aside>\n?/g, ""),
  );
  return out;
}

export function threads(html) {
  const out = new Map();
  for (const m of html.matchAll(
    /<aside class="comment-thread" id="([^"]+)"[^>]*>[\s\S]*?<\/aside>/g,
  ))
    out.set(m[1], m[0]);
  return out;
}

// Quotes, dashes and spaces as plain characters, runs of spaces as one.
export const normalise = (t) =>
  t
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ([.,;:)])/g, "$1")
    .replace(/\( /g, "(");
export const stripMarkdown = (t) =>
  t
    .replace(/\[\^[^\]]+\]:?/g, " ")
    .replace(/\\([\\`*_{}[\]()#+\-.!|>])/g, "$1")
    .replace(/\*+|`/g, "")
    .replace(/(^|[\s(])_+(?=\S)/g, "$1")
    .replace(/(\S)_+(?=[\s.,;:!?)]|$)/gm, "$1")
    .replace(/^\s*(>|[-*+] |\d+\. |#+ )/gm, " ")
    .replace(/\|/g, " ");
// The passages of a Markdown draft that a conversion must keep, split at footnote references.
export function draftFragments(md) {
  const out = [];
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (!line || /^#/.test(line) || /^\|?\s*-{3}/.test(line)) continue;
    // A table row is one passage, its cells in order.
    const pieces = line.startsWith("|")
      ? [
          line
            .split("|")
            .map((c) => c.trim())
            .filter(Boolean)
            .join(" "),
        ]
      : line.replace(/^\[\^[^\]]+\]:\s*/, "").split(/\[\^[^\]]+\]/);
    for (const p of pieces) {
      const f = normalise(stripMarkdown(p)).trim();
      if (f) out.push(f);
    }
  }
  return out;
}

const plain = (html) =>
  html
    .replace(/<span class="footnote">[\s\S]*?<\/span>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/g, "x");
const words = (html) => plain(html).split(/\s+/).filter(Boolean).length;
const count = (html, what) =>
  (
    html.match(
      {
        footnote: /<span class="footnote">/g,
        "key-callout": /<aside class="callout key">/g,
        "table-row": /<tr[ >]/g,
      }[what],
    ) ?? []
  ).length;
const scope = async (check, ctx) => {
  const doc = await ctx.load(ctx.file);
  return check.section ? own(doc, check.section) : doc.html;
};
const decode = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

export const CHECKS = {
  async exists(check, { file }) {
    const size = (await readFile(file)).length;
    return { pass: size > 0, detail: `${size} bytes` };
  },

  // check reports no error. Warnings are listed; they fail the check unless `warnings: true`,
  // except stale labels and contents, which an edit elsewhere makes and the editor rewrites
  // on open (FORMAT.md › Document tools, replace).
  async valid(check, { file, text }) {
    const r = await text("check", file, "--json");
    let report;
    try {
      report = JSON.parse(r.stdout);
    } catch {
      return { pass: false, detail: firstLine(r) };
    }
    const errors = report.errors.map(
      (e) => e.code ?? e.message ?? JSON.stringify(e),
    );
    const warnings = report.warnings.map(
      (w) => w.code ?? w.message ?? JSON.stringify(w),
    );
    return {
      pass:
        errors.length === 0 &&
        (check.warnings ||
          warnings.every((w) => /^stale-(label|contents)$/.test(w))),
      detail:
        `${errors.length} error(s)${errors.length ? ": " + [...new Set(errors)].join(", ") : ""}; ` +
        `${warnings.length} warning(s)${warnings.length ? ": " + [...new Set(warnings)].join(", ") : ""}`,
    };
  },

  // The editor, styles, guide and assets around the article are byte-identical.
  async "outside-article"(check, { file, before }) {
    const cut = (s) => {
      const [start, end] = articleBounds(s);
      return [s.slice(0, start), s.slice(end)];
    };
    const [a, b] = [
      cut(await readFile(before, "utf8")),
      cut(await readFile(file, "utf8")),
    ];
    const assetsOf = (s) =>
      /<script id="assets"[\s\S]*?<\/script>/.exec(s)?.[0] ?? "";
    const diff = [];
    if (a[0] !== b[0]) diff.push("before the article");
    if (a[1] !== b[1])
      diff.push(
        assetsOf(a[1]) === assetsOf(b[1])
          ? "after the article"
          : "after the article (assets)",
      );
    return {
      pass: diff.length === 0,
      detail: diff.length ? `changed: ${diff.join(", ")}` : "identical",
    };
  },

  // Nothing changed in the article but the allowed sections (their own bytes) and threads
  // (which may only gain replies), compared in canonical form.
  async preserved(check, { file, before, load }) {
    const [da, db] = [await load(before), await load(file)];
    const [a, b] = [parts(da), parts(db)];
    const allowed = new Set([
      ...check.allow,
      ...check.threads.map((t) => `thread ${t}`),
    ]);
    const changed = [];
    for (const [key, value] of a) {
      if (!b.has(key)) changed.push(`${key} removed`);
      else if (
        withoutGenerated(b.get(key)) !== withoutGenerated(value) &&
        !allowed.has(key)
      )
        changed.push(key);
    }
    for (const key of b.keys()) if (!a.has(key)) changed.push(`${key} added`);
    // The same sections in the same order, at the same levels and under the same parents.
    const shape = (d) => d.outline.map((x) => `${x.id}/${x.level}/${x.parent}`);
    if (shape(da).join() !== shape(db).join())
      changed.push("section order or hierarchy");
    for (const t of check.threads) {
      const [x, y] = [a.get(`thread ${t}`), b.get(`thread ${t}`)];
      const kept =
        x &&
        y &&
        x
          .replace(/<\/aside>$/, "")
          .split("\n")
          .slice(1)
          .every((line) => y.includes(line));
      if (!kept) changed.push(`thread ${t}: earlier comments changed`);
    }
    return {
      pass: changed.length === 0,
      detail: changed.length
        ? `changed: ${changed.join(", ")}`
        : `only ${[...allowed].join(", ")} may differ; nothing else changed`,
    };
  },

  async "unchanged-sections"(check, { file, before, load }) {
    const [a, b] = [await load(before), await load(file)];
    const changed = check.sections.filter((id) => {
      try {
        return withoutGenerated(own(a, id)) !== withoutGenerated(own(b, id));
      } catch {
        return true;
      }
    });
    return {
      pass: changed.length === 0,
      detail: changed.length
        ? `changed or removed: ${changed.join(", ")}`
        : `${check.sections.join(", ")} unchanged`,
    };
  },

  async words(check, ctx) {
    const [a, b] = [
      words(own(await ctx.load(ctx.before), check.section)),
      words(own(await ctx.load(ctx.file), check.section)),
    ];
    return {
      pass: b <= a * check.atMost,
      detail: `${b} words, was ${a} (at most ${Math.floor(a * check.atMost)})`,
    };
  },

  async contains(check, ctx) {
    const html = check.file.endsWith(".md")
      ? await readFile(ctx.file, "utf8")
      : await scope(check, ctx);
    const missing = check.text.filter(
      (t) => !html.includes(t) && !decode(html).includes(t),
    );
    return {
      pass: missing.length === 0,
      detail: missing.length
        ? `missing: ${missing.map((m) => JSON.stringify(m)).join(", ")}`
        : "all present",
    };
  },

  async count(check, ctx) {
    const n = count(await scope(check, ctx), check.what);
    let want, pass;
    if (check.more !== undefined) {
      const was = count(
        check.section
          ? own(await ctx.load(ctx.before), check.section)
          : (await ctx.load(ctx.before)).html,
        check.what,
      );
      want = `at least ${was + check.more} (was ${was})`;
      pass = n >= was + check.more;
    } else if (check.exactly !== undefined) {
      want = `exactly ${check.exactly}`;
      pass = n === check.exactly;
    } else {
      want = `at least ${check.min}`;
      pass = n >= check.min;
    }
    return { pass, detail: `${n} ${check.what}(s), ${want}` };
  },

  // Every line of the section as it was is still there, in order: unchanged, or (a
  // paragraph) with text added at its end. For tasks that only add.
  async kept(check, ctx) {
    const [was, now] = [
      own(await ctx.load(ctx.before), check.section)
        .split("\n")
        .filter(Boolean),
      own(await ctx.load(ctx.file), check.section)
        .split("\n")
        .filter(Boolean),
    ];
    let i = 0;
    const lost = [];
    for (const line of was) {
      const stem = line.endsWith("</p>") ? line.slice(0, -4) : null;
      const at = now.findIndex(
        (x, k) => k >= i && (x === line || (stem && x.startsWith(stem))),
      );
      if (at < 0)
        lost.push(
          decode(line.replace(/<[^>]+>/g, " "))
            .trim()
            .slice(0, 60),
        );
      else i = at + 1;
    }
    return {
      pass: lost.length === 0,
      detail: lost.length
        ? `lost or changed: ${lost.map((l) => `"${l}…"`).join(", ")}`
        : `all ${was.length} lines kept in order`,
    };
  },

  // The source Markdown's text (paragraphs, list items, quotes, table cells and footnotes,
  // split at footnote references) is in the document or its Markdown copy, as written.
  async "draft-text"(check, ctx) {
    const source = await readFile(join(ctx.kit, check.source), "utf8");
    const fragments = draftFragments(source);
    const target = ctx.file.endsWith(".md")
      ? normalise(stripMarkdown(await readFile(ctx.file, "utf8")))
      : normalise(
          decode((await ctx.load(ctx.file)).html.replace(/<[^>]+>/g, " ")),
        );
    const missing = fragments.filter((f) => !target.includes(f));
    return {
      pass: missing.length === 0,
      detail: missing.length
        ? `${missing.length} of ${fragments.length} passages changed or missing: ${missing
            .slice(0, 3)
            .map((m) => `"${m.slice(0, 50)}…"`)
            .join(", ")}`
        : `all ${fragments.length} passages kept`,
    };
  },

  async figure(check, ctx) {
    const html = await scope(check, ctx);
    const m = new RegExp(
      `<figure class="([a-z]+)" id="${check.id}"[^>]*>[\\s\\S]*?</figure>`,
    ).exec(html);
    if (!m)
      return {
        pass: false,
        detail: `no figure ${check.id} in ${check.section ?? "the document"}`,
      };
    const cellText = (h) => decode(h.replace(/<[^>]+>/g, "")).trim();
    const caption = cellText(
      /<figcaption>([\s\S]*?)<\/figcaption>/.exec(m[0])?.[1] ?? "",
    );
    const rows = [...m[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) =>
      [...r[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) =>
        cellText(c[1]),
      ),
    );
    const kind = m[1] === check.figure;
    const problems = [];
    if (!kind) problems.push(`figure.${m[1]}, expected figure.${check.figure}`);
    if (caption !== check.caption) problems.push(`caption "${caption}"`);
    check.rows.forEach((want, i) => {
      if (JSON.stringify(rows[i]) !== JSON.stringify(want))
        problems.push(`row ${i + 1}: ${JSON.stringify(rows[i] ?? [])}`);
    });
    if (rows.length !== check.rows.length)
      problems.push(`${rows.length} rows, expected ${check.rows.length}`);
    return {
      pass: problems.length === 0,
      detail: problems.length
        ? problems.join("; ")
        : `figure.${m[1]}: the caption and every cell in place`,
    };
  },

  async xref(check, ctx) {
    const html = await scope(check, ctx);
    const n = (
      html.match(new RegExp(`<a class="xref" href="#${check.target}">`, "g")) ??
      []
    ).length;
    return {
      pass: n > 0,
      detail: `${n} cross-reference(s) to ${check.target}`,
    };
  },

  async anchor(check, ctx) {
    const doc = await ctx.load(ctx.file);
    const n = (
      doc.html.match(
        new RegExp(`<mark class="comment" data-ref="${check.thread}">`, "g"),
      ) ?? []
    ).length;
    return { pass: n > 0, detail: `${n} anchor(s) of ${check.thread}` };
  },

  async reply(check, ctx) {
    const [a, b] = [
      threads((await ctx.load(ctx.before)).html).get(check.thread),
      threads((await ctx.load(ctx.file)).html).get(check.thread),
    ];
    if (!b) return { pass: false, detail: `thread ${check.thread} missing` };
    const comments = (s) => [
      ...s.matchAll(
        /<p class="comment" data-author="([^"]*)" data-date="([^"]*)">([\s\S]*?)<\/p>/g,
      ),
    ];
    const [was, now] = [comments(a), comments(b)];
    const status = /data-status="([a-z]+)"/.exec(b)?.[1];
    const reply = now[was.length];
    const ok =
      now.length === was.length + 1 &&
      reply &&
      reply[3].trim() &&
      status === check.status;
    return {
      pass: Boolean(ok),
      detail:
        `${now.length} comment(s), was ${was.length}; status ${status}` +
        (reply
          ? `; reply by "${decode(reply[1])}": "${decode(reply[3]).slice(0, 160)}"`
          : ""),
    };
  },

  async statuses(check, ctx) {
    const t = threads((await ctx.load(ctx.file)).html);
    const wrong = Object.entries(check.statuses)
      .map(([id, want]) => [
        id,
        want,
        /data-status="([a-z]+)"/.exec(t.get(id) ?? "")?.[1],
      ])
      .filter(([, want, got]) => want !== got);
    return {
      pass: wrong.length === 0,
      detail: wrong.length
        ? wrong
            .map(
              ([id, want, got]) =>
                `${id} ${got ?? "missing"} (expected ${want})`,
            )
            .join(", ")
        : "as expected",
    };
  },

  async outline(check, ctx) {
    const doc = await ctx.load(ctx.file);
    const problems = [];
    const article = /^<article id="doc"[^>]*>/m.exec(doc.html)[0];
    if (check.contents && !/<nav class="toc"/.test(doc.html))
      problems.push("no contents list");
    if (
      (check.numberedChapters || check.numbered) &&
      !/data-heading-numbers="on"/.test(article)
    )
      problems.push("heading numbers off");
    const chapters = doc.outline.filter(
      (s) => s.level === 1 && s.number,
    ).length;
    if (check.numberedChapters && chapters < check.numberedChapters)
      problems.push(
        `${chapters} numbered chapter(s), expected ${check.numberedChapters}`,
      );
    const titles = doc.outline.map((s) => decode(s.title));
    for (const t of check.titles ?? [])
      if (!titles.some((x) => x.includes(t)))
        problems.push(`no heading "${t}"`);
    return {
      pass: problems.length === 0,
      detail: problems.length
        ? problems.join("; ")
        : `${doc.outline.length} sections, ${chapters} numbered chapter(s)`,
    };
  },

  async coverage(check, ctx) {
    const report = JSON.parse(
      (await ctx.text("check", ctx.file, "--json")).stdout,
    );
    const low = Object.entries(check.min).filter(
      ([k, v]) => (report.coverage[k] ?? 0) < v,
    );
    return {
      pass: low.length === 0,
      detail: Object.entries(check.min)
        .map(([k, v]) => `${k} ${report.coverage[k] ?? 0} (min ${v})`)
        .join(", "),
    };
  },

  // Each chart's numbers are among the given ones (or the same in thousands or millions):
  // anything else is reported for the person to judge (computed, or invented).
  async charts(check, ctx) {
    const doc = await ctx.load(ctx.file);
    const charts = [
      ...doc.html.matchAll(
        /<figure class="chart" id="([^"]+)"[^>]*>\n?<script type="application\/json">([\s\S]*?)<\/script>/g,
      ),
    ];
    const given = new Set(check.numbers);
    const known = (v) =>
      [v, v / 1000, v * 1000, v / 1e6].some((x) =>
        given.has(Math.round(x * 1e6) / 1e6),
      );
    const unknown = [];
    for (const [, id, json] of charts) {
      const data = JSON.parse(json);
      const values = [
        ...(data.series ?? []).flatMap((s) => s.values ?? []),
        ...(data.items ?? []).map((i) => i.value),
        ...(data.slices ?? []).map((i) => i.value),
      ].filter((v) => typeof v === "number");
      for (const v of values) if (!known(v)) unknown.push(`${id}: ${v}`);
    }
    // A number not in the brief may be computed from it (allowed) or invented (blocking):
    // the person decides, so it is flagged for review rather than failed.
    return {
      pass: charts.length >= check.min,
      review: unknown.length > 0,
      detail:
        `${charts.length} chart(s)` +
        (unknown.length
          ? `; REVIEW, numbers not in the brief (computed or invented?): ${unknown.join(", ")}`
          : "; every number from the brief"),
    };
  },

  async "chart-data"(check, ctx) {
    const html = await scope(check, ctx);
    const m = new RegExp(
      `<figure class="chart" id="${check.id}"[^>]*>\\n?<script type="application/json">([\\s\\S]*?)</script>`,
    ).exec(html);
    if (!m)
      return {
        pass: false,
        detail: `no chart ${check.id} in ${check.section}`,
      };
    const data = JSON.parse(m[1]);
    const series = data.series ?? [];
    const ok =
      JSON.stringify(data.categories) === JSON.stringify(check.categories) &&
      series.length >= 1 &&
      JSON.stringify(series[0].values) === JSON.stringify(check.values);
    const preview =
      /<svg class="render"/.test(m[0]) ||
      new RegExp(`id="${check.id}"[^>]*>[\\s\\S]*?<svg class="render"`).test(
        html,
      );
    return {
      pass: ok,
      detail: `categories ${JSON.stringify(data.categories)}, values ${JSON.stringify(series.map((s) => s.values))}${preview ? ", preview saved" : ", no saved preview"}`,
    };
  },

  async "merged-table"(check, ctx) {
    const doc = await ctx.load(ctx.file);
    const tables = [
      ...doc.html.matchAll(/<figure class="table"[\s\S]*?<\/figure>/g),
    ].map((m) => m[0]);
    const merged = tables.filter((t) =>
      /<thead>[\s\S]*?(colspan|rowspan)="[2-9]"[\s\S]*?<\/thead>/.test(t),
    );
    const both = merged.filter((t) => /<tr class="total">/.test(t));
    return {
      pass: both.length > 0,
      detail: `${tables.length} table(s), ${merged.length} with merged header cells, ${both.length} of them with a total row`,
    };
  },

  async offline(check, { file }) {
    const html = await readFile(file, "utf8");
    const embedded = /<script id="echarts"/.test(html);
    return {
      pass: embedded,
      detail: embedded
        ? "ECharts embedded"
        : "standard file (ECharts not embedded)",
    };
  },
};

export function table(results) {
  const rows = results.map(
    (r) =>
      `| ${r.task} | ${r.check} | ${r.pass ? (r.review ? "**review**" : "pass") : "**fail**"} | ${r.detail.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`,
  );
  return [
    "| Task | Check | Result | Detail |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const at = args.indexOf("--task");
  const only = at >= 0 ? args[at + 1] : undefined;
  const kit = args.find(
    (a, i) => !a.startsWith("--") && args[i - 1] !== "--task",
  );
  if (!kit) {
    console.error(
      "Usage: node packages/text/acceptance/blind/score.mjs <kit-folder> [--task A2] [--json]",
    );
    process.exit(2);
  }
  const results = await score(kit, { only });
  console.log(json ? JSON.stringify(results, null, 2) : table(results));
  const failed = results.filter((r) => !r.pass).length;
  const review = results.filter((r) => r.pass && r.review).length;
  console.log(
    `\n${results.length - failed} of ${results.length} checks pass` +
      (review ? `; ${review} need a person's review.` : "."),
  );
  process.exitCode = failed ? 1 : 0;
}
