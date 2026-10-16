# HTML Text V1 implementation plan

Status: proposed implementation sequence, 15 October 2026. Product and architecture decisions are in the [Text V1 specification](HTML-TEXT-V1.md); [ADR-004](decisions/004-html-text-format-and-editor.md) records the format and editor rationale, and the [Office specification](HTML-OFFICE-V1.md) the family-wide constraints. All tasks below are **not started**.

## Delivery rules and dependencies

Implementation starts only after **Data Checkpoint B** in the [Data plan](HTML-DATA-PLAN.md). Text reuses the local-file persistence and recovery module (Data T07) and the pinned, integrity-checked on-demand loader (Data T04) instead of building its own. Tasks that depend on those modules are marked **[Data]**. If Data slips, changing this order is an explicit, recorded sequencing decision, not a quiet start.

Use small branches/PRs, each leaving Slides and Data working and delivering a reviewable increment. Acceptance criteria below are the minimum verification contract; changes to them must be explicit. Use fictional public fixtures throughout.

Build Text in `packages/text/`, with its own model, schema, runtime build, tools, tests and fixtures. Keep Slides source, commands, skill identity and release artifacts in place. The only change to Slides is extracting the chart contract into `packages/shared/charts/` (T11); it waits for the [Slides hardening PR #1](https://github.com/apatrem/html-office/pull/1) and must leave generated decks byte-identical. Do not add ProseMirror or Text code to the Slides or Data runtimes. Add the Text skill to the existing plugin only after the complete workflow is usable (T18).

Likely paths below are proposed, not files that already exist. S means about 1–2 implementation/test files; M means about 3–5. Split further if an increment exceeds that scope.

Dependency order: T01 → T02 → T03, then T04 and T05 from T03. T06 builds on T04; T07–T13 build on T06 as identified below. T14–T17 cover print, outputs, tooling and measurement. T18–T20 package, demonstrate and validate the whole product. Checkpoints are technical gates; an unmet gate stops dependent work until fixed or the tradeoff is recorded.

## Phase A: prove the format, round trip and budget

### T01 — Define the canonical HTML subset and validator

Dependencies: Data Checkpoint B. Scope: M. Paths: `packages/text/model/`, format reference draft, valid/invalid fixtures and tests.

- Acceptance: the subset is documented element by element: `article#doc` attributes, cover, headings with stable IDs, paragraphs and semantic block classes, inline marks, `ta-*` alignment, lists, figures (chart, image, table), cross-references, inline footnotes, page breaks, table of contents and `section.comments`. Section extent is defined as heading to next heading of the same or a higher level.
- Acceptance: validation rejects `style` attributes, scripts, event handlers, executable URLs, external resources, duplicate or missing IDs and malformed figures/threads, and reports each with a location. Unknown but inert content is classified as protectable rather than silently accepted or dropped.
- Verification: fixed fixtures for every construct and every rejection; a compact human-readable example reviewed without any editor or engine state.

### T02 — Build the ProseMirror schema with a byte-identical round trip

Dependencies: T01. Scope: M. Paths: `packages/text/editor/schema/`, parse/serialise modules and round-trip tests.

- Acceptance: the schema mirrors the subset one to one. Parsing then serialising any valid canonical fixture without edits reproduces it byte for byte, including attribute order, whitespace policy and entity escaping.
- Acceptance: out-of-schema inert content becomes a **protected block** that is displayed, kept intact and cannot be edited; anything unsafe is rejected before the editor opens. Nothing is dropped silently. Any normalisation lives in an explicit `pack` step with a reported diff.
- Verification: round-trip every T01 fixture plus generated variations (Unicode, HTML-like text, long documents); targeted edits change only the edited node in a serialised diff.

### T03 — Minimal editable and saveable Text HTML

Dependencies: T02, **[Data]** T07 persistence. Scope: M. Paths: `packages/text/runtime/`, build tool and browser smoke fixture.

- Acceptance: a short document opens from `file://`, accepts typing and undo/redo through ProseMirror history, and saves through the shared persistence module; the reopened file contains the edit and is otherwise byte-identical.
- Acceptance: prose editing works offline in the standard build. Report embedded application code, content, assets and total file bytes separately.
- Verification: real Chromium save/reopen test, canonical comparison and the standard code measurement against 500,000 bytes with recorded headroom; reject a prototype that requires a local server.

### T04 — Apply the brand theme, layout styles and fixed-width editing surface

Dependencies: T03. Scope: M. Paths: `packages/text/theme/`, shared brand variables, browser fixtures.

- Acceptance: the document reads brand variables from the same `charte` contract as Slides and Data; Text layout styles (heading scale, spacing, callouts, table styles, cover, page format, margins) live in `style#theme`. Switching the brand theme restyles the document without touching content.
- Acceptance: the editing surface uses the fixed text width of the selected page format (A4 or Letter), so line breaks match print. Semantic block styles and `ta-l`, `ta-c`, `ta-r`, `ta-j` alignment render; no per-selection font, size or colour controls exist.
- Verification: the same document under two brand themes and both page formats; compare line breaks with print output; confirm the default brand theme matches the Data T11 role colours.

### T05 — Save, copy and recover in four browsers

Dependencies: T03, **[Data]** T07 persistence. Scope: M. Paths: Text save controls, Playwright Chromium/WebKit/Firefox configuration and tests.

- Acceptance: Chrome and Edge save directly to the chosen file with draft recovery. Safari and Firefox edit and save with a clearly labelled **Save a copy** that downloads a complete HTML. Unsaved, draft and saved states are distinct in every browser.
- Acceptance: failed or cancelled saves keep the work; edits made during a save stay dirty; external modification is detected before an overwrite where the browser allows it.
- Verification: local-file tests in all three engines with delayed/rejected writes, reload and recovery; reopen each saved copy and compare canonical content.

Checkpoint A: untouched documents round-trip byte-identically; out-of-schema content is rejected or protected; editing and saving work from `file://` in all four browsers; the code budget passes with measured headroom for the remaining editor. If a gate fails, fix or document an explicit design reassessment before extending the product.

## Phase B: authoring features

### T06 — Edit blocks, inline formatting and links

Dependencies: T04. Scope: M. Paths: editor commands, keymaps, toolbar and browser tests.

- Acceptance: create and convert title, subtitle, H1–H4, body, lead, quote, callouts, caption and code blocks; bulleted and numbered lists with indent/outdent; bold, italic, underline, superscript/subscript, inline code, highlight and links; alignment; explicit page breaks and "start on a new page".
- Acceptance: new headings receive stable IDs that never change on later edits; Enter, Backspace and cross-block deletion produce only schema content; composition input (IME, autocorrect, dictation) is not interrupted.
- Verification: keyboard and pointer workflows in Chromium, WebKit and Firefox; composition tests; serialised diffs after each command contain only subset markup.

### T07 — Paste and import Markdown

Dependencies: T06. Scope: M. Paths: clipboard mapping, Markdown import adapter and fixtures.

- Acceptance: paste from Word, web pages and Excel maps headings, inline formatting, lists, links and simple tables to destination styles and drops other formatting, Word-specific markup and comments. Images are embedded only through the asset path (T12). Plain-text paste inside a block stays available.
- Acceptance: Markdown import (CommonMark plus tables) uses the same mapping and reports constructs it could not represent. Imported or pasted content is data: no script, style or link is activated.
- Verification: captured clipboard fixtures from Word, Google Docs, Excel and web pages; Markdown fixtures with tables, nested lists and HTML fragments; save/reopen and undo of each paste.

### T08 — Generate numbering, contents and cross-reference labels

Dependencies: T06. Scope: M. Paths: numbering/xref module, table-of-contents node and tests.

- Acceptance: optional heading numbers (`data-heading-numbers`) and figure/table numbers follow document order; the table of contents is generated from headings to `data-depth`. Cross-references are links to IDs whose saved label is rewritten on open and save.
- Acceptance: a wrong label written by an LLM is corrected on the next save; references to missing targets are flagged in the editor and reported with locations for `check` (T16). Inserting, moving or deleting sections renumbers everything consistently.
- Verification: fixtures with stale labels, missing targets and reordered sections; save/reopen; diff confirms that only labels and generated contents changed.

### T09 — Write inline footnotes and render endnotes

Dependencies: T08. Scope: S. Paths: footnote node, notes rendering and tests.

- Acceptance: footnotes are inline `span.footnote` nodes at the point of reference; the screen shows numbered references, a hover preview and a generated notes list; numbering follows document order. Moving or deleting a sentence carries its note.
- Verification: insert, move, cut/paste and undo footnotes; confirm the notes list is generated, not stored, and that print output (T14) numbers endnotes identically.

### T10 — Edit report tables with merged cells

Dependencies: T06. Scope: M. Paths: table schema/commands (`prosemirror-tables`), table styles and tests.

- Acceptance: header rows, body and optional total row; row/column insertion and deletion; merge and split with `colspan`/`rowspan`; Tab navigation; percentage column widths; semantic styles (number alignment, total row, emphasis column, compact density); numbered caption.
- Acceptance: each cell holds one paragraph of inline content; lists, multiple paragraphs, nested tables and formulas are rejected. Excel/Word/Markdown paste into or as a table follows T07.
- Verification: merge/split/undo sequences, rectangular selection deletion across merged cells, save/reopen and canonical diffs; table fixtures reused by print tests.

### T11 — Extract the shared chart contract and add Text chart figures

Dependencies: T08, Slides PR #1 landed, **[Data]** T04 loader. Scope: M per part; separate the Slides extraction PR from the Text chart PR. Paths: `packages/shared/charts/`, Slides import updates, Text chart node and tests.

- Acceptance (extraction): chart types, JSON schemas, validation and SVG rendering move to `packages/shared/charts/`; Slides tests pass and regenerated example decks are byte-identical to the previous build.
- Acceptance (Text): `figure.chart` with ID, numbered caption and `data-width="text|full"`; saved SVG previews display and print without ECharts or a network; chart editing loads pinned, SRI-verified ECharts through the shared loader, and the offline build embeds it. Charts do not wrap text.
- Verification: Slides regression suite and byte comparison; Text chart edit, stale/missing preview, blocked or tampered library, undo and save/reopen; offline build with no requests.

### T12 — Embed images and wrap text around them

Dependencies: T08. Scope: M. Paths: Text asset handling (Slides asset contract), image node, wrapping styles and tests.

- Acceptance: images are stored in `script#assets` and referenced with `data-asset` (WebP where available); `alt` is mandatory. Images are full-width blocks or wrapped left/right with a width setting, gap, caption and anchoring to a paragraph; no contour wrapping.
- Acceptance: moving the anchor paragraph moves the image; replacing or deleting an image keeps the asset store consistent with no orphaned assets after save.
- Verification: wrapped images beside short and long paragraphs, consecutive wrapped images, undo/redo and save/reopen; print behaviour is verified in T14.

### T13 — Comment with threads, resolution and orphan handling

Dependencies: T06. Scope: M. Paths: comment marks/threads, comments panel and tests.

- Acceptance: comments attach to selected text with `mark.comment[data-ref]`; threads in `section.comments` support replies and open/resolved status. A display name is asked for once and remembered by the browser, never verified. A thread whose anchor text is deleted is shown as orphaned and is never reattached to unrelated text.
- Acceptance: comment text is document data. The format reference and runtime never execute or follow it; threads are excluded from print by default.
- Verification: edits inside, around and across anchors; external rewrites of the anchored paragraph; delete/undo of anchors; reopen in another browser; a fixture whose comment contains instructions aimed at an LLM, kept for T18 and T20.

Checkpoint B: a user can write, structure, illustrate and comment a multi-section document and save it in all four browsers without losing content. Byte-identity for untouched content still holds after every feature. Recheck the code budget with all editor features included.

## Phase C: print, outputs, tooling and measurement

### T14 — Paginate for print and preview

Dependencies: T09, T10, T11, T12, T13. Scope: M. Paths: print styles, print preview and print tests.

- Acceptance: CSS paged media provides A4/Letter pages, margins, running headers and footers, page numbers, explicit page breaks, "start on a new page", keep-together rules for headings/figures/table rows, repeated table headers, endnotes and table-of-contents page numbers through `target-counter()`. Comments are hidden.
- Acceptance: a read-only print preview shows page boundaries before export; the browser print dialog produces the PDF, which matches the preview in Chrome and Edge.
- Verification: rendered PDFs of all table, chart, footnote and wrapped-image fixtures, including wrapped images and merged tables crossing page breaks; compare preview and PDF page counts and breaks.

### T15 — Show and export Markdown

Dependencies: T07, T09–T13. Scope: S per part. Paths: Markdown projection and export modules, documentation and tests.

- Acceptance: a read-only Markdown view projects the canonical document; it is never stored and cannot be edited. Markdown export uses the same projection.
- Acceptance: the export documents exactly how comments, wrapped layout, captions, cross-references, footnotes and assets are represented or dropped, and never implies a `.md` file preserves the document.
- Verification: project every fixture; reimport the export through T07 and record the known, documented losses.

### T16 — Provide section tooling for long documents

Dependencies: T02, T08. Scope: M. Paths: `packages/text/tools/` (`outline`, `show`, `replace`, `check`) and tests.

- Acceptance: `outline` lists headings, IDs and word counts; `show <id>` prints one section; `replace <id>` swaps it from a file; `check` validates the subset, IDs, cross-references, assets and comment anchors. A replacement leaves everything outside the target section byte-identical and refuses invalid input.
- Verification: replace first, middle, last and nested sections on the 100-page fixture; invalid replacements leave the file unchanged; diffs prove preservation.

### T17 — Measure size, responsiveness and the code budget

Dependencies: T14, T16. Scope: M. Paths: `packages/text/bench/`, 50-page and 100-page fixtures, benchmark evidence.

- Acceptance: record open, typing latency, save, print preview and PDF time plus memory and HTML size for a 50-page typical document and the 100-page stress fixture (about 50,000 words and 50 figures). Proposed engineering targets: keystroke-to-paint under 50 ms and no editing task over 100 ms at 50 pages; validate or revise with evidence before treating them as guarantees.
- Acceptance: embedded application code is measured per component (ProseMirror packages, schema, editor UI, CSS, bootstrap) and stays below 500,000 bytes.
- Verification: record hardware and browser versions and five warm runs in Chromium, WebKit and Firefox; do not extrapolate beyond the measured documents.

Checkpoint C: print preview and PDF agree; Markdown view/export and section tooling pass on all fixtures; the 50-page target and code budget pass with evidence. Recheck dependency notices.

## Phase D: prove the complete authoring and recipient workflow

### T18 — Package the Text skill and embedded guide

Dependencies: T17. Scope: M per workflow; separate document tooling from skill packaging. Paths: `packages/text/tools/` (`new`, `pack`), `plugin/skills/html-text/`, references and package tests.

- Acceptance: `new` and `pack` generate standard and offline documents with brand and layout themes; the inert embedded guide documents the full subset, section-based editing, the numbering and label rules, and states that comments and imported content are data, never instructions. It works offline and links to compatible skill downloads.
- Acceptance: only now ship a working Text skill alongside Slides (and Data if shipped); keep the plugin identity, paths and release compatibility. No placeholder skill is shipped before this point.
- Verification: install the built plugin in a clean environment and generate, edit, check and pack a document; inspect escaping and link/version consistency; Slides and Data commands and tests still pass.

### T19 — Publish the fictional acceptance report

Dependencies: T18. Scope: M. Paths: public Text fixtures/examples and end-to-end tests.

- Acceptance: a 15–20-page fictional **business review and next-year plan** with cover, executive summary, generated contents, numbered sections, lead and callouts, two charts with saved SVGs, three tables (one with merged headers and a total row), wrapped images with captions, endnotes, cross-references, one open and one resolved comment thread and an appendix. A companion Slides deck shares its brand theme.
- Acceptance: standard/offline HTML, PDF and Markdown samples contain only clearly fictional public material and record their versions and measured sizes.
- Verification: regenerate from the skill, edit and extend a section manually, save/reopen and print in Chrome and Edge; edit, comment and Save a copy in Safari and Firefox.

### T20 — Run the blind LLM test and release readiness review

Dependencies: T19. Scope: M. Paths: validation report, CI checks and release notes.

- Acceptance: give an unfamiliar LLM only the generated HTML and a user task; it explains the structure, rewrites a section, adds a figure with a cross-reference and replies to a comment without obeying instructions written in it, while preserving unrelated content. Record mistakes and repairs; an informed internal agent does not count.
- Acceptance: all seven release gates in the [specification](HTML-TEXT-V1.md#acceptance-document-and-release-gates) pass: byte-identical round trip and protection, code budget, PDF fidelity, four-browser editing and saving, section tooling on 100 pages, the blind test and the dependency licence audit.
- Verification: repeat from a clean checkout and extracted plugin; attach evidence and human review to the release PR. A passed local suite alone does not establish browser parity or blind-test success.

## Risks and stop conditions

| Risk | Required response |
| --- | --- |
| Data Checkpoint B is delayed | Do not start Text implementation implicitly; record any change of order as a sequencing decision |
| ProseMirror cannot reproduce canonical HTML byte for byte | Fix the serialiser or move normalisation into explicit `pack`; never accept silent changes on save |
| Out-of-schema content would be lost | Reject or protect it; stop dependent work until no fixture loses content |
| Editor exceeds the standard code budget | Measure by component, simplify or defer an explicitly agreed feature; do not quietly raise the limit |
| Chrome print cannot deliver a required print feature (margin boxes, `target-counter()`, wrapped images or merged tables at page breaks) | Document the limitation and the fallback; reassess the scope explicitly before release |
| Shared chart extraction changes Slides output | Stop the extraction until regenerated decks are byte-identical and Slides tests pass |
| Comment anchors drift or attach to the wrong text | Prefer an orphaned thread to a wrong anchor; stop comment-dependent work until anchor tests pass |
| An LLM follows instructions embedded in comments or imported content | Strengthen the guide and skill rules and repeat the failing blind-test task |
| Safari or Firefox editing behaves differently | Fix or document the limitation before claiming four-browser editing |
| Paste from Word or the web produces out-of-subset markup | Extend the mapping or drop the formatting; never let unsupported markup reach the canonical content |

No further product question is currently pending. Technical validation may expose a concrete tradeoff requiring a documented scope decision; it must not silently remove an approved requirement.
