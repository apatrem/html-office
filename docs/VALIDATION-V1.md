# V1 validation log

Automated checks cover chart validation, safe HTML handling, preservation, complete drafts and save races, thumbnails, embedded documentation, SRI/CORS rejection, offline use, and the browser editor.

The 0.6.1 baseline passed 39 regression tests plus the editor workflow and 27 example/catalogue slides. A live CDN check confirmed bytes matching the pinned package and successful SRI loading. Routine tests serve local approved bytes and do not depend on the network.

Release 0.7.0 replaces all distributed decks with fictional English topics. Local verification passed all 39 regression tests and the complete editor workflow, with zero checker errors on all 27 slides. Screenshots were reviewed and the PDFs contain the expected 9 and 18 pages. The public repository starts with a fresh history: earlier local example decks and historical planning notes are not published.

Release 0.7.1 keeps drafts after the download fallback, flags drafts made from another version of a file, strips restored drafts of code and external resources, rejects more external-resource attributes and CSS fetches in the inert check, and limits trusted engines to published releases plus the current build. CSS resource checks use the pinned CSS tokenizer to decode escapes and inspect every image candidate, including dynamic URL refusal. Draft identity recognises both the opened file and the snapshot actually written, covering edits made during saving and Save As. Local verification passed all 49 regression tests and the complete editor workflow, with zero checker errors on all 27 example slides.

Release 0.7.2 (published on 18 November 2026) moves the Slides editor onto the shared html-office shell, adds a deck theme and body font, table column widths with border dragging, merged cells from pasted tables, copy and paste of tables across decks, Data, Text and other applications and of charts across decks and to other applications, and save in place with a remembered file in Chrome and Edge. The plugin archive ships the html-slides skill only: the html-data and html-text skills stay in the repository until their blind tests, and the release script refuses an archive holding another skill. Local verification: `npm run release` passed end to end, with all 101 regression tests, the Chromium editor and shell workflows, and the Slides clipboard, chart clipboard, save-in-place and table-width checks; zero checker errors on all 27 example slides, and the PDFs contain 9 and 18 pages.

Release 0.7.3 (prepared, not yet published; 27 November 2026) carries what `main` held after 0.7.2 and changes no product behaviour in the release commit itself. For a user: Enter in a paragraph or title adds a line break instead of an invalid block; printing from edit mode gives one page per slide at the page origin; a draft offer that is not answered is no longer destroyed by a later notice, and until it is answered the editor refuses edit mode and Save; an older draft can no longer be saved over a newer remembered file, and a lost file binding recovers on the next Save; duplicate or missing slide ids are repaired and reported by the checker; the checker and the editor refuse markup that would re-parse differently after an undo, a duplicate or a restore; and a whole slide can be copied and pasted between decks (V1-01). Local verification: `npm run release` passed end to end, then `npm test` passed again on the same tree: 143 regression tests, the Chromium editor and shell workflows, and the Slides clipboard, chart clipboard, slide clipboard and table-width checks (the Firefox and WebKit runs are left to CI, as Firefox does not launch on the preparing workstation). The archive (1.0 MB) holds the `.claude-plugin`, licence and notice files and `skills/html-slides` only, and the archive check passed. `check.mjs` reports zero errors on the 27 example slides (9 and 18), and the PDFs contain 9 and 18 pages. Not verified here: publication, the download link (it works once the owner publishes), and the manual checks on other workstations.

File System Access is tested with a simulated writable target; actual Chromium downloads/reopening are tested too. Direct saving on another workstation remains a manual check.

## Go/stop measurement (ADR-016)

Since 27 November 2026 the gate before any further feature work is the measurement decided in [ADR-016](decisions/016-slides-go-stop-gate.md). It replaces the five task comparisons that timed a person against PowerPoint (kept under History below). The ADR holds the protocol and the decision grid; this section holds the results. **Every cell stays empty until a run produces it: nothing here is estimated or filled in advance.**

In short: Claude Opus 5.5 (effort High, Claude Code, a new session per run) generates each subject as html-slides and as a `.pptx`, three times each, then applies three edits after a scripted move of elements. A model of the other family counts the defects on page images; the owner checks a sample and judges the PDFs.

| Step | Who | Status |
| --- | --- | --- |
| Release 0.7.3, so that the measurement runs on the corrected version | An agent prepares, the owner publishes | Prepared, not published |
| Measurement kit: five briefs with their edits, defect list, bench, token cost of an edit on the example decks | An agent | Pending |
| Pilot: one subject, one run per format (extra runs, not part of the campaign's results); estimated token cost of the campaign | An agent; the owner decides to launch the rest | Pending |
| Campaign: 30 generations, 30 series of edits | An agent | Pending |
| Defect count on page images | Codex | Pending |
| Sample of about twenty pages, and a judgement per subject on the PDFs | The owner | Pending |
| Sharing check: a recipient opens and edits a file on another workstation | The owner | Pending |
| Outcome: continue, maintain Slides alone, or stop | The owner | Pending |

### Results per subject

Times and tokens are totals over the three runs; the grid divides them by the number of usable runs.

| Subject | Format | Usable runs (of 3) | Generation time | Time for the three edits | Moves kept | Blocking defects | Minor defects | Tokens | Owner's preference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 Steering committee update | html-slides | — | — | — | — | — | — | — | — |
| 1 Steering committee update | PPTX | — | — | — | — | — | — | — | |
| 2 Commercial proposal | html-slides | — | — | — | — | — | — | — | — |
| 2 Commercial proposal | PPTX | — | — | — | — | — | — | — | |
| 3 Diagnostic | html-slides | — | — | — | — | — | — | — | — |
| 3 Diagnostic | PPTX | — | — | — | — | — | — | — | |
| 4 Summary for senior management | html-slides | — | — | — | — | — | — | — | — |
| 4 Summary for senior management | PPTX | — | — | — | — | — | — | — | |
| 5 Free-composition diagrams | html-slides | — | — | — | — | — | — | — | — |
| 5 Free-composition diagrams | PPTX | — | — | — | — | — | — | — | |

### Reading

| | html-slides | PPTX | Difference |
| --- | --- | --- | --- |
| Usable runs (of 15) | — | — | — |
| Minor defects | — | — | — |
| Subjects where the owner prefers this format | — | — | — |
| Time per usable result | — | — | — |
| Tokens per usable result | — | — | — |

Quality (better, equivalent, worse): —. Cost (cheaper, comparable, dearer): —. Sharing check: —. Outcome: **not decided**.

## Manual checks pending

- Context-free LLM test: only HTML supplied; targeted text edit, new slide, chart edit, then preservation and rendering review.
- Three LLM edits after manual positioning, checked with `--since` and screenshots.
- Chrome/Edge direct save, close, and reopen with images, charts, and footer.
- Independent recipient on another workstation repeats the workflow without assistance.
- Safari/Firefox download/reopen if used.
- Offline reading and chart editing with `--offline`.
- PDF comparison: fonts, sources, images, pagination.
- Real sharing through the intended channel, documenting opening restrictions.
- Large-deck interaction and draft storage capacity.
- The go/stop measurement completed and its outcome recorded (above, and as a change of status of ADR-016).

## History

### Five task comparisons (replaced on 27 November 2026 by ADR-016)

The original gate, from the plan of 10 October 2026. It was never defined or run. The owner replaced it with the measurement above, which measures the assistant's work instead of a person's time.

Choose five representative tasks with fixed briefs and three later edits. Include text, charts, and free compositions. Measure all active time: planning, generation, visual correction, manual editing, LLM revision, sharing, and reopening. Track blocked/waiting time separately. Compare with the same tasks in PowerPoint.

| Task | Brief and edits | PowerPoint minutes | html-slides minutes | Net gain | Defects/evidence | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | To define | — | — | — | — | Pending |
| 2 | To define | — | — | — | — | Pending |
| 3 | To define | — | — | — | — | Pending |
| 4 | To define | — | — | — | — | Pending |
| 5 | To define | — | — | — | — | Pending |

Net gain = PowerPoint time − html-slides time. Include failures and rework, not just initial generation.
