# ADR-016 — Slides go/stop gate: generation measured against PPTX

Status: **accepted**, 27 November 2026. The owner settled each point below in a question-by-question session, after two external reviews of the repository made the same day. Amended the same day after the cross-lineage review of PR #131: the definitions of section 6 made exact, the single retry removed, the rule for a failed sharing check added (the last two by the owner's choice). **Not run yet.**

## Context

The plan of 10 October 2026 set a gate before any expansion: five mission decks with a time log, and "if phase 3 shows no net gain, keep the skill and the checker and stop there". [VALIDATION-V1.md](../VALIDATION-V1.md) carried it as five task comparisons that time a person against PowerPoint. They were never defined or run.

In the meantime the repository grew from one product to three. Slides is released (0.7.2); Data and Text are built and not released. Both reviews of 27 November 2026 name the same problem: the scope grew before the gate was passed, and nobody knows whether html-slides is worth using instead of what consultants already have.

Two facts shaped the decision:

- **The owner's time is the bottleneck.** Timing a person on five decks, twice each, was estimated at 10 to 15 hours, and every status line in [STATUS.md](../STATUS.md) already waits for the owner.
- **The real alternative has changed.** At the end of 2026 a consultant does not build a deck by hand: an assistant writes the `.pptx` and the person retouches it in PowerPoint.

## Decision

### 1. Freeze Data and Text

No new Data or Text feature until this gate gives its outcome. Defect fixes stay allowed. The blind tests T20 and T22 are postponed. Nothing is deleted and nothing is restructured: the code stays on `main`, outside the plugin archive.

### 2. What is compared

The same deck, generated twice by the same assistant: once as html-slides with the released skill, once as a `.pptx` with the assistant's own PowerPoint skill.

- Assistant and model: Claude Opus 5.5, effort High, in Claude Code. One model only, so that the gap comes from the format and its tools, not from the assistant.
- Each run starts in a new session, with no memory of another run.
- The reference is not PowerPoint by hand: that comparison would flatter html-slides and say nothing about the choice a firm has today.

### 3. What is measured

The assistant's work, **not a person's time**. For each subject and each format:

1. **Generation time**: from the brief to a file that passes the format's own checks, with no human step.
2. **Time for three later edits**, applied after a scripted move of elements that is the same on both sides, standing for a person's manual positioning. The run also records whether the moved elements kept their place.
3. **Remaining defects**, counted on the PDF of each result (see 5).
4. **Tokens used.**

Each subject and format is run **three times**: one generation time proves nothing, because it varies from run to run. Every run starts from a new session (see 2), so the order of the runs does not matter.

A run that fails or is cut off still counts. Its time and tokens are recorded up to the failure or the time limit, for the generation and for the edits. The kit fixes the time limit and what ends a run as a failure before the pilot, the same for both formats.

### 4. The five subjects

Fictional briefs, written before any run. Each brief fixes the message of every slide and the figures, and the three later edits, so that only production is measured.

| No. | Subject | Slides | What it exercises |
| --- | --- | --- | --- |
| 1 | Progress update for a steering committee | 8 | Many charts, updated figures |
| 2 | Commercial proposal | 8 | Approach, schedule (Gantt), team, fees |
| 3 | Diagnostic | 8 | Comparisons, a waterfall, a 2×2 matrix |
| 4 | Summary for senior management | 5 | Dense text, titles that state the message |
| 5 | Free-composition diagrams | 5 | Shapes placed by hand, then edits by the assistant |

### 5. Counting defects

- **One rendering for both formats.** Every result is converted to PDF, then to page images. The count sees only those images.
- **A defect list written before the runs**: text that overflows or is cut, overlapping elements, a visible misalignment, a chart whose values differ from the brief, requested content that is missing, a requested edit that was not made. Each kind is classed blocking or minor by a definition fixed in advance.
- **The counter is a model of the other family** (Codex), as for code reviews, and it is not told which format a page comes from.
- **The owner checks a sample** of about twenty pages drawn at random. If the owner's count differs clearly from the counter's, the defect list is made more precise and the count is redone.
- The html-slides checker is part of the product and runs during generation. It takes no part in the count: PPTX has no equivalent, and using it would favour one format.

### 6. Reading the results

A run is **usable** when the generation and the three edits both finished, and the final file opens, passes its format's own checks, has no blocking defect and kept the scripted moves after the edits. A series of edits that did not finish makes the run unusable.

**Quality of html-slides against PPTX** (first axis):

Minor defects are compared per usable result: for each format, the minor defects of its usable runs divided by the number of those runs. Call D the html-slides figure divided by the PPTX figure.

- **Better**: at least as many usable runs, D ≤ 0.75 (at least 25 % fewer minor defects), and the owner does not prefer PPTX on more subjects than html-slides.
- **Worse**: fewer usable runs, or D ≥ 1.25 (at least 25 % more minor defects), or the owner prefers PPTX on three subjects or more.
- **Equivalent**: everything else.

When PPTX has no minor defect, D does not exist: html-slides with none either meets neither defect condition, and html-slides with any meets the *worse* one.

The owner gives **one preference per subject**: html-slides, PPTX, or equivalent. For each subject they are shown three run slots per format: each final PDF that exists, and "no result" for a run that produced none. They judge the two sets, preferably without knowing which format produced which. If neither format produced a final PDF for a subject, the preference is *equivalent*. *Equivalent* counts for neither side.

**Cost** (second axis): the time to obtain a usable result, and the tokens to obtain one. Each is the total over all runs of the five subjects, failed runs included, generation plus edits, divided by the number of usable runs. A format that fails one run in three is thus charged for the rerun. For time and for tokens, divide the html-slides figure by the PPTX figure; R is the larger of the two ratios, so the less favourable measure decides.

| Quality of html-slides | Cheaper (R ≤ 0.80) | Comparable (0.80 < R < 1.20) | Dearer (R ≥ 1.20) |
| --- | --- | --- | --- |
| **Better** | Continue | Continue | Maintain Slides alone |
| **Equivalent** | Maintain Slides alone; Continue if R ≤ 0.50 | Stop | Stop |
| **Worse** | Stop | Stop | Stop |

If a format has no usable run, it has no cost per usable result. html-slides with none: *stop*. PPTX with none and html-slides with at least one: quality is *better* and cost is *cheaper*.

The middle row is deliberate: at equal quality, a format the client cannot reopen in PowerPoint must be clearly cheaper to justify itself.

One further rule, **sharing**: *continue* also requires that a recipient opens and edits a generated file on another workstation without a blocker. The owner checks this by hand. If something blocks, it is fixed and the owner repeats the check once; a second failure turns *continue* into *maintain Slides alone*. Until the check is done, a grid result of *continue* stays pending.

The results are read **once**. There is no retry near a boundary: with three outcomes, *maintain Slides alone* already is the middle ground.

### 7. The three outcomes

| Outcome | What follows |
| --- | --- |
| **Continue** | Slides development resumes (V1-02 to V1-07, then the runtime). Data and Text are re-examined one at a time, each with its own measured need, before any unfreeze. |
| **Maintain Slides alone** | Defect fixes and the runtime (Playwright dependency) only. Data and Text stay frozen. No V1-02 to V1-07. |
| **Stop** | The skill and the checker are kept as they are, as the plan of 10 October 2026 provided. No new product work. |

### 8. Order of work

1. **Release 0.7.3**, so that the measurement runs on the corrected version a user would receive. An agent prepares it; the owner publishes.
2. **The measurement kit**: the five briefs with their edits, the defect list, the bench (timing, the scripted move, the conversion of `.pptx` to PDF), and the token cost of an edit on the example decks.
3. **A pilot**: one subject, one run per format. It shows that the bench works, and its measured cost gives an estimate of the campaign's cost, labelled as an estimate. The owner then decides to launch the campaign: 30 generations and 30 series of edits. The pilot's two runs are extra and do not enter the campaign's results.
4. **The campaign**, the count, the owner's sample and judgement, the sharing check, and the outcome, recorded in [VALIDATION-V1.md](../VALIDATION-V1.md) and as a change of this record's status.

Until the outcome, these wait: V1-02 to V1-07, the allow-list for the checker and the split of `editor.js` ([PLAN.md](../PLAN.md), ideas B-05 and B-06). One exception: a defect that blocks the measurement is fixed at once.

Separately, the owner spends about one hour trying the released plugin in Claude Desktop and in ChatGPT Desktop (install it, ask for the example deck, note what fails). The trial fixes nothing. It tells how large the runtime problem is for users who are not developers, for the day the outcome is read.

## What this replaces, and what it does not measure

This record **replaces the stop criterion as the plan wrote it** (a person's net time against PowerPoint). The owner chose to measure the assistant's generation instead. An agent can then run the measurement, three times per case, without the owner's hours.

Its limits are known and accepted:

- **The editor is not measured.** Retouching in the browser and in PowerPoint is assumed equivalent, which rather favours html-slides.
- **The count is not truly blind.** A trained eye recognises the format from a page image. The defect list fixed in advance and the owner's sample limit this bias; they do not remove it.
- **The thresholds (25 %, 20 %, 50 %) are judgement**, fixed before measuring so that an average result cannot be read both ways.
- **One model.** A result that holds only with the strongest model would be worth knowing; that would be a second campaign.
- **The runtime is not measured.** The runs happen in Claude Code, where the skill works. Whether it runs in the desktop applications is the one-hour trial's question.

## Options considered

| Option | Why not |
| --- | --- |
| A person's time, as the plan wrote it | 10 to 15 hours of the owner's time, one run per case, and the author of the tool as the only tester |
| Generation time alone | A format that quickly produces a deck to redo would win wrongly |
| One threshold on time (50 %) | At close times the outcome would be "stop" even with clearly fewer defects |
| One weighted score | The weights are arbitrary and hide the trade-off |
| One retry for a result close to a boundary (fix the costliest defects, rerun two subjects) | First adopted, then removed by the owner after the review of PR #131: "close", the subjects to rerun and how to combine the results were undefined, and a retry of one format alone weakens a rule fixed in advance |
| Counting by Claude, or by the owner | A model marking its own work; or several hours on about 400 pages |
| A second generating model (GPT) | Double the cost, and the counter would mark its own family's work |

## Consequences

- The bench is a development tool: nothing in it ships and it adds no package to the products. Converting `.pptx` to PDF needs PowerPoint or LibreOffice on the measuring machine; the pilot settles which.
- From now on a new product, a cross-product feature or a raised size ceiling needs a written decision of the owner that cites measured usage ([AGENTS.md](../../AGENTS.md)).
- [VALIDATION-V1.md](../VALIDATION-V1.md) keeps the former comparison table under its History heading.
