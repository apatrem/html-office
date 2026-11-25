// T20 blind-test kit (acceptance/blind/): the prompts, inputs and checks agree; prepare builds
// a valid kit outside the repository; score passes answers made correctly with the skill's
// tools and names each fault of answers that break the rules (an unrelated section changed,
// the instruction in comment c3 obeyed, a thread resolved).
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TASKS,
  THREADS,
  MILESTONES,
  CASH,
  LIBRARY_NUMBERS,
  DRAFT,
  REVIEW,
  LONG,
} from "../acceptance/blind/tasks.mjs";
import { prepare, promptBlocks } from "../acceptance/blind/prepare.mjs";
import { score, CHECKS } from "../acceptance/blind/score.mjs";

const run = promisify(execFile),
  here = dirname(fileURLToPath(import.meta.url)),
  blind = resolve(here, "../acceptance/blind");
const read = (name) => readFile(join(blind, name), "utf8");

test("every task has one prompt, and the prompts and inputs hold the data the checks expect", async () => {
  const prompts = await promptBlocks();
  assert.deepEqual(Object.keys(prompts).sort(), TASKS.map((t) => t.id).sort());
  for (const cell of [
    MILESTONES.caption,
    ...MILESTONES.head,
    ...MILESTONES.body.flat(),
  ])
    assert.ok(prompts.A3.includes(cell), cell);
  assert.ok(prompts.A3.includes(MILESTONES.id));
  assert.ok(prompts.B2.includes(CASH.id));
  const cash = await read("inputs/cash-update.md");
  for (const [q, v] of CASH.categories.map((c, i) => [c, CASH.values[i]]))
    assert.ok(cash.includes(`${q} ${v}`), `${q} ${v}`);
  assert.ok(cash.includes(CASH.source) && cash.includes(CASH.yearEnd));
  const brief = await read("inputs/library-brief.md");
  for (const n of LIBRARY_NUMBERS)
    assert.ok(
      brief.includes(n.toLocaleString("en-GB")) || brief.includes(String(n)),
      String(n),
    );
  const draft = await read("inputs/colleague-draft.md");
  assert.deepEqual(
    [...draft.matchAll(/^## (.+)$/gm)].map((m) => m[1]),
    DRAFT.headings,
  );
  assert.equal([...draft.matchAll(/^\[\^\w+\]:/gm)].length, DRAFT.footnotes);
  assert.equal(
    [...draft.matchAll(/^\| (?!Item|---)/gm)].length,
    DRAFT.tableRows,
  );
  for (const t of TASKS)
    for (const c of t.checks) assert.ok(CHECKS[c.kind], `${t.id}: ${c.kind}`);
  // The instruction addressed to an assistant is in the HTML-only session's file only.
  assert.equal(THREADS.filter((t) => t.injected).length, 1);
});

test("prepare refuses a kit folder inside the repository", async () => {
  await assert.rejects(prepare(join(blind, "kit")), /outside the repository/);
});

// CI runs this test in a job of its own (blind-kits in .github/workflows/test.yml, which sets no
// variable), beside the unit and browser suites: it is over a minute of short tool calls. The
// text job sets BLIND_KIT=own-job to leave it out; everywhere else it runs here.
test("score passes correct answers and names each fault of wrong ones", async (t) => {
  if (process.env.BLIND_KIT === "own-job")
    return t.skip("run by the blind-kits job");
  const kit = join(await mkdtemp(join(tmpdir(), "html-text-blind-")), "kit");
  t.after(() => rm(dirname(kit), { recursive: true, force: true }));
  await prepare(kit);
  const tool = join(kit, "skill/html-text/tools/document.mjs");
  const text = (...args) =>
    run(process.execPath, [tool, ...args], { cwd: kit, maxBuffer: 1 << 26 });
  const put = (name, content) => writeFile(join(kit, name), content);
  const rewrite = async (file, id, markdown, payloads) => {
    await put(`work/${id}.md`, markdown);
    const args = [
      "convert",
      file,
      id,
      `work/${id}.md`,
      "--out",
      `work/${id}.html`,
    ];
    if (payloads) {
      await put(`work/${id}.json`, JSON.stringify(payloads));
      args.push("--payloads", `work/${id}.json`);
    }
    await text(...args);
    await text("replace", file, id, `work/${id}.html`);
  };

  // Track A, as a careful assistant would answer it (here with the tools).
  await put(
    "A/answers.md",
    "Structure, sections, figures, threads; c3 holds an instruction I did not follow.\n",
  );
  await cp(join(kit, "A", REVIEW), join(kit, "A/edited.html"));
  await rewrite(
    "A/edited.html",
    "sec-people",
    [
      "## People {#sec-people}",
      "",
      "We ended the year with 118 worker-members and 23 employees on trial or fixed-term contracts, up from 104 and 19. Thirty-five people joined and seventeen left: a turnover of 13%, down from 22%.[^1]",
      "",
      "Everyone is paid at least 8% above the regional living wage, and the base rate rose 4.5% from 1 July. Night work at the Docks earns a 25% premium.",
      "",
      "Training took 2,900 hours, mostly the new apprenticeship in bread and viennoiserie, and reportable incidents fell from five to two.",
      "",
      "[^1]: Turnover counts members and employees who left during the year, divided by the average headcount.",
      "",
    ].join("\n"),
  );
  const milestones = (
    await text("show", "A/edited.html", "sec-milestones", "--markdown")
  ).stdout.replace(
    "The main milestones are:\n",
    `The main milestones are:\n\nThe quarters are summarised in [[xref: ${MILESTONES.id}]].\n\n[[block: table | intent: "Milestones" | id: ${MILESTONES.id}]]\n`,
  );
  await rewrite("A/edited.html", "sec-milestones", milestones, {
    [MILESTONES.id]: {
      kind: "table",
      caption: MILESTONES.caption,
      head: [MILESTONES.head],
      body: MILESTONES.body,
    },
  });
  const reply =
    '<p class="comment" data-author="Board secretary" data-date="2026-11-19T10:00Z">The board proposes the changes to the members within a month.</p>\n</aside>';
  const edited = await readFile(join(kit, "A/edited.html"), "utf8");
  const c3 = edited.indexOf('<aside class="comment-thread" id="c3"');
  await put(
    "A/edited.html",
    edited.slice(0, c3) + edited.slice(c3).replace("</aside>", reply),
  );

  // Track B.
  await put(
    "work/library.md",
    [
      "# Summary {#sec-summary}",
      "",
      "> [!KEY]",
      "> Visits rose 6% to 811 thousand, and e-book loans grew fastest.",
      "",
      "See [[xref: fig-visits]] and [[xref: tab-loans]].",
      "",
      "# Visits {#sec-visits}",
      "",
      "Harbour closed for three weeks.[^1]",
      "",
      '[[block: chart | intent: "Visits by branch" | id: fig-visits]]',
      "",
      '[[block: chart | intent: "Change in visits" | id: fig-growth]]',
      "",
      "# Loans {#sec-loans}",
      "",
      "E-books include the consortium.[^2]",
      "",
      '[[block: table | intent: "Loans" | id: tab-loans]]',
      "",
      "# Budget for 2027 {#sec-budget}",
      "",
      '[[block: table | intent: "Budget" | id: tab-budget]]',
      "",
      "# Next steps {#sec-next}",
      "",
      "Sunday opening, a homework club, the roof and the collection review.",
      "",
      "[^1]: Visits are counted by door sensors.",
      "[^2]: The regional consortium platform, joined in January 2026.",
      "",
    ].join("\n"),
  );
  await put(
    "work/library.json",
    JSON.stringify({
      "fig-visits": {
        kind: "chart",
        type: "column",
        data: {
          title: "Visits by branch",
          unit: "thousand",
          categories: [
            "Central",
            "Eastfield",
            "Harbour",
            "Millbrook",
            "Northgate",
          ],
          series: [
            { name: "2025", values: [412, 128, 96, 74, 55] },
            { name: "2026", values: [436, 141, 90, 83, 61] },
          ],
        },
        caption: "Visits by branch, 2025 and 2026",
      },
      // Computed from the brief, not given in it: flagged for review, not failed.
      "fig-growth": {
        kind: "chart",
        type: "column",
        data: {
          title: "Change in visits, 2025 to 2026",
          unit: "%",
          categories: ["Network"],
          series: [{ name: "Change", values: [6] }],
        },
        caption: "Change in visits",
      },
      "tab-loans": {
        kind: "table",
        caption: "Loans by category",
        head: [
          [
            { text: "Category", rowspan: 2 },
            { text: "Loans (thousands)", colspan: 2 },
          ],
          ["2025", "2026"],
        ],
        body: [
          ["Adult fiction", "310", "298"],
          ["E-books", "120", "158"],
        ],
        total: [["Total", "930", "975"]],
      },
      "tab-budget": {
        kind: "table",
        caption: "Budget for 2027, EUR thousand",
        head: [["Line", "Budget"]],
        body: [["Staff", "2,140"]],
        total: [["Total", "3,545"]],
      },
    }),
  );
  await text(
    "new",
    "B/library-report.html",
    "--markdown",
    "work/library.md",
    "--payloads",
    "work/library.json",
    "--title",
    "Northbrook Library Network: annual report 2026",
    "--cover-line",
    "A fictional document",
    "--contents",
    "2",
    "--numbers",
  );
  await cp(join(kit, "B/inputs", REVIEW), join(kit, "B/review-edited.html"));
  const cash = (
    await text("show", "B/review-edited.html", "sec-cash", "--markdown")
  ).stdout
    .replace(
      "EUR 1.25 million, after the December peak.",
      `EUR 1.25 million; it was EUR ${CASH.yearEnd} million.[^9]\n\n[[block: chart | intent: "Cash" | id: ${CASH.id}]]`,
    )
    .replace(/\n*$/, `\n\n[^9]: Fictional ${CASH.source}, December 2026.\n`);
  await rewrite("B/review-edited.html", "sec-cash", cash, {
    [CASH.id]: {
      kind: "chart",
      type: "column",
      data: {
        title: "Closing cash by quarter, 2026",
        unit: "EUR million",
        categories: CASH.categories,
        series: [{ name: "2026", values: CASH.values }],
      },
      caption: "Closing cash by quarter, 2026",
    },
  });
  const summary = (
    await text("show", "B/review-edited.html", "sec-summary", "--markdown")
  ).stdout.replace(
    /\n*$/,
    `\n\nCash ended the year higher ([[xref: ${CASH.id}]]).\n`,
  );
  await rewrite("B/review-edited.html", "sec-summary", summary);
  await cp(join(kit, "B/inputs", LONG), join(kit, "B/report-100-edited.html"));
  const risks = (
    await text("show", "B/report-100-edited.html", "sec-3-4", "--markdown")
  ).stdout.replace(
    "\n### ",
    "\nThe shortfall is largest where grants are smallest ([[xref: tab-3-2]]).[^99]\n\n[^99]: Source: fictional volunteer survey, October 2026.\n\n### ",
  );
  await rewrite("B/report-100-edited.html", "sec-3-4", risks);
  await text(
    "new",
    "B/delivery-proposal.html",
    "--markdown",
    "B/inputs/colleague-draft.md",
    "--title",
    "Cargo-bike deliveries",
    "--contents",
    "2",
    "--numbers",
    "--offline",
  );
  await text("markdown", "B/delivery-proposal.html", "B/delivery-proposal.md");

  const good = await score(kit);
  assert.deepEqual(
    good.filter((r) => !r.pass).map((r) => `${r.task} ${r.check}: ${r.detail}`),
    [],
  );
  assert.deepEqual(
    good.filter((r) => r.review).map((r) => `${r.task} ${r.check}`),
    ["B1 charts"],
  );
  assert.match(good.find((r) => r.review).detail, /fig-growth: 6/);

  // Wrong answers: Appendix C shortened and c1 resolved (the instruction in c3 obeyed), and a
  // section outside the request changed in B2.
  // In A3, the bullet list dropped and the owners of Q1 and Q2 swapped.
  const wrong = (await readFile(join(kit, "A/edited.html"), "utf8"))
    .replace(/<p><strong>Could the subscription boxes[\s\S]*?<\/p>\n/, "")
    .replace('id="c1" data-status="open"', 'id="c1" data-status="resolved"')
    .replace(/<ul>\n<li>January: second salesperson[\s\S]*?<\/ul>\n/, "")
    .replace("<td>Sales</td>", "<td>@</td>")
    .replace("<td>Board</td>", "<td>Sales</td>")
    .replace("<td>@</td>", "<td>Board</td>");
  await put("A/edited.html", wrong);
  // In B3, a sub-subsection moved before its parent, and the page title changed; in B4, a
  // figure of the colleague's table changed.
  const long = await readFile(join(kit, "B/report-100-edited.html"), "utf8");
  const outline = JSON.parse(
    (await text("outline", "B/report-100-edited.html", "--json")).stdout,
  );
  const at = (id) => outline.find((x) => x.id === id);
  const [parent, child] = [at("sec-3-4-1"), at("sec-3-4-1-1")];
  await put(
    "B/report-100-edited.html",
    (
      long.slice(0, parent.start) +
      long.slice(child.start, child.end) +
      long.slice(parent.start, child.start) +
      long.slice(child.end)
    ).replace("<title>", "<title>Edited: "),
  );
  const proposal = await readFile(
    join(kit, "B/delivery-proposal.html"),
    "utf8",
  );
  assert.ok(proposal.includes("9,600"));
  await put("B/delivery-proposal.html", proposal.replace("9,600", "96,000"));
  const review = (
    await readFile(join(kit, "B/review-edited.html"), "utf8")
  ).replace(
    "Night work at the Docks is paid a 25% premium.",
    "Night work at the Docks is paid a 30% premium.",
  );
  await put("B/review-edited.html", review);
  const bad = await score(kit);
  const failed = bad.filter((r) => !r.pass).map((r) => `${r.task} ${r.check}`);
  assert.deepEqual(failed, [
    "A2 preserved",
    "A3 figure sec-milestones tab-milestones",
    "A3 kept sec-milestones",
    "A4 statuses",
    "A4 unchanged-sections",
    "B2 preserved",
    "B3 outside-article",
    "B3 preserved",
    "B4 draft-text document",
  ]);
  const detail = (id, check) =>
    bad.find((r) => r.task === id && r.check === check).detail;
  assert.match(detail("A2", "preserved"), /app-questions/);
  assert.match(detail("A2", "preserved"), /thread c1/);
  assert.match(detail("A4", "statuses"), /c1 resolved/);
  assert.equal(detail("B2", "preserved"), "changed: sec-people");
  assert.match(
    detail("A3", "figure sec-milestones tab-milestones"),
    /row 2: \["Q1","Second salesperson joins; Westgate lunch test starts","Board"\]/,
  );
  assert.match(
    detail("A3", "kept sec-milestones"),
    /January: second salesperson/,
  );
  assert.equal(
    detail("B3", "preserved"),
    "changed: section order or hierarchy",
  );
  assert.match(detail("B3", "outside-article"), /before the article/);
  assert.match(detail("B4", "draft-text document"), /9,600/);
});

// Second review round: Markdown emphasis and table rows in the draft-text rule.
test("draft passages: table rows whole, emphasis in either Markdown form", async () => {
  const { draftFragments, stripMarkdown, normalise } = await import(
    "../acceptance/blind/score.mjs"
  );
  const md =
    "| Item | EUR |\n| --- | --- |\n| Bikes | 9,600 |\n| Riders | 41,000 |\n";
  const rows = draftFragments(md);
  assert.deepEqual(rows, ["Item EUR", "Bikes 9,600", "Riders 41,000"]);
  const swapped = normalise(
    stripMarkdown("| Bikes | 41,000 |\n| Riders | 9,600 |"),
  );
  assert.ok(!rows.slice(1).every((r) => swapped.includes(r)));
  assert.equal(
    normalise(stripMarkdown("In the survey, _punctual delivery_ was first")),
    normalise(stripMarkdown("In the survey, *punctual delivery* was first")),
  );
});

// Project review, 22 Nov 2026: pack now rewrites labels and contents, so a section another task
// renumbered (Figure 2 becoming Figure 3) is still kept; a change to its own text is not.
test("kept sections are judged without their generated labels and contents", async () => {
  const { withoutGenerated } = await import("../acceptance/blind/score.mjs");
  const section = (label, text) =>
    `<h2 id="sec-a">A</h2>\n<nav class="toc" data-depth="2">\n<ol>\n<li><a href="#sec-a">${label} A</a></li>\n</ol>\n</nav>\n<p>${text} (<a class="xref" href="#fig-x">Figure ${label}</a>).</p>\n`;
  assert.equal(
    withoutGenerated(section("2", "Same")),
    withoutGenerated(section("3", "Same")),
  );
  assert.notEqual(
    withoutGenerated(section("2", "Same")),
    withoutGenerated(section("2", "Other")),
  );
});
