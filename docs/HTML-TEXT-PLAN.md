# HTML Text V1 implementation plan

Status: proposed implementation sequence, 15 October 2026. Product and architecture decisions are in the [Text V1 specification](HTML-TEXT-V1.md); [ADR-004](decisions/004-html-text-format-and-editor.md) records the format and editor rationale, and the [Office specification](HTML-OFFICE-V1.md) the family-wide constraints. Text started on 25 October 2026 with T01–T03; T04–T06 followed on 27 October.

## Shared decisions since this plan

Decisions taken for the whole family after 15 October supersede parts of the tasks below. The task text is kept; read it with these changes:

- **Start condition.** Data Checkpoint B is met: T07–T11 are merged ([progress](HTML-DATA-PROGRESS.md)).
- **Editor shell (U04-Text).** The editor uses variant A built from the shared framework-free components in [`packages/shared/shell/`](../packages/shared/shell/README.md) ([ADR-011](decisions/011-html-office-shared-principles.md) §7): file bar with menus, one toolbar, the floating settings bar (theme and font, page count, zoom), and side panels for document settings, comments and outline. "Toolbar" in T06 means that toolbar; every command also has a menu entry. U04-Text starts in T03.
- **Brand theme and font (T04).** `style#charte` with the built-in chartes of TH01 ([`packages/shared/themes/chartes.mjs`](../packages/shared/themes/chartes.mjs)) applied as overlays, and the shared theme and font pickers. The document stores `data-theme` and `data-font` on `article#doc` (ADR-011 §10, TH02-Text); page format, margins, running header and heading numbers are Text's extras in the document-settings panel. "Data T11 role colours" now means the TH01 chartes.
- **Persistence (T03, T05).** The persistence module is still Data's (`packages/data/runtime/persistence.mjs`). T03 moves it to `packages/shared/` for both products, as U04-Slides did with the command module, without changing Data's behaviour.
- **Charts (T11).** X03 extracted the chart contract to [`packages/shared/charts/`](../packages/shared/charts/README.md) (PR #60), so T11 is only the Text part; the Slides PR #1 dependency is obsolete. T01 already validates chart JSON with the shared strict schemas.
- **Clipboard (T07, T10, T11).** Tables and charts copy through [ADR-013](decisions/013-cross-product-clipboard.md); the subset in [`packages/text/FORMAT.md`](../packages/text/FORMAT.md) maps onto its portable table.
- **Notices (T17, T18, T20).** ProseMirror's licences are embedded once each through the shared generator [`packages/shared/notices.mjs`](../packages/shared/notices.mjs) (L01, ADR-011 §9). They count in the 500,000-byte code budget.


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
- Status: implemented 25 October 2026 on `feature/text-t01-subset`, in review. [Format reference](../packages/text/FORMAT.md), validator and `tools/check.mjs` in `packages/text/`; 10 valid and 40 invalid fixtures; the compact example is `fixtures/valid/example.html`. The canonical byte form is documented in the format reference and enforced with the schema in T02.

### T02 — Build the ProseMirror schema with a byte-identical round trip

Dependencies: T01. Scope: M. Paths: `packages/text/editor/schema/`, parse/serialise modules and round-trip tests.

- Acceptance: the schema mirrors the subset one to one. Parsing then serialising any valid canonical fixture without edits reproduces it byte for byte, including attribute order, whitespace policy and entity escaping.
- Acceptance: out-of-schema inert content becomes a **protected block** that is displayed, kept intact and cannot be edited; anything unsafe is rejected before the editor opens. Nothing is dropped silently. Any normalisation lives in an explicit `pack` step with a reported diff.
- Verification: round-trip every T01 fixture plus generated variations (Unicode, HTML-like text, long documents); targeted edits change only the edited node in a serialised diff.
- Verification: measure the embedded code budget here, per component (each ProseMirror package, schema, serialiser), not first in T03. The full ProseMirror stack measured about 270 KB minified, 54% of the 500,000-byte budget, in the [engine stress test](ENGINE-STRESS-TEST.md#text-editor).
- Status: implemented 25 October 2026 on `feature/text-t02-schema`, in review. Parsing and serialising are our own adapters around a ProseMirror schema (`packages/text/editor/schema/`), not ProseMirror's DOM parser, so nothing outside the subset is dropped. Every valid fixture, 200 seeded documents (Unicode, markup-like text, every construct) and a 4,000-block document (about 1.6 MB) round-trip byte for byte. Targeted edits change only the edited line. Non-canonical sources are reported by `check` and rewritten only by `pack`, with a line diff. Code budget (`packages/text/bench/code-size.json`): the editor core (seven ProseMirror packages, validator, schema, parser, serialiser) and editing guard, with its licence notices and prepared as an inline script, is 294,310 bytes, leaving 205,690 under the ceiling before the shell and UI. Cross-lineage review: 10 findings, then 3 more in the re-verification round, all fixed: repaired protected content is refused instead of saved differently (every writer reads its output back); rows covered by rowspans; carriage returns; empty attributes; never-empty documents; a bounded line diff; notices counted; and an editing guard (`editor/schema/guard.mjs`) that unlinks footnotes and cross-references, gives repeated IDs fresh ones and fills table rows that edits leave short.

### T03 — Minimal editable and saveable Text HTML

Dependencies: T02, **[Data]** T07 persistence. Scope: M. Paths: `packages/text/runtime/`, build tool and browser smoke fixture.

- Acceptance: a short document opens from `file://`, accepts typing and undo/redo through ProseMirror history, and saves through the shared persistence module; the reopened file contains the edit and is otherwise byte-identical.
- Acceptance: prose editing works offline in the standard build. Report embedded application code, content, assets and total file bytes separately.
- Verification: real Chromium save/reopen test, canonical comparison and the standard code measurement against 500,000 bytes with recorded headroom; reject a prototype that requires a local server.
- Status: implemented 25 October 2026 on `feature/text-t03-editor`, in review. `packages/text/runtime/` validates the opened document with the T01 rules (an invalid file shows the errors and no editor), edits it with ProseMirror history and saves the captured zones plus article#doc through the persistence module, now [`packages/shared/persistence.mjs`](../packages/shared/persistence.mjs) for Data and Text. The shell is U04-Text's start: file bar, File/Edit/Help menus and a history toolbar. `tests/browser.mjs` (Chromium, `file://`, no network): typing, undo/redo, Save changes exactly one line, reopen is canonical, Save a copy, a different file is never overwritten, 14 protected blocks stay read-only and unchanged, invalid files are refused, a save that would reopen differently writes nothing. Every save is read back first (DOMParser, no script runs) and stops before writing if it would not reopen as the same document; links are kept off footnotes and cross-references while editing. The file is captured while `script#engine` (its last element) runs, so later nodes never enter it; a source that is not in canonical form where the browser can see it is neither saved nor copied until `pack.mjs` rewrites it; Enter at the end of a heading continues with a paragraph and never splits footnotes or table cells. Built example (`tools/build.mjs`): 323,737 bytes in total, of which 318,469 are application code (engine with notices 316,151), 5,082 content and 186 assets; headroom 181,531 under the 500,000 ceiling. Cross-lineage review: 3 findings (heading split IDs, Save a copy of non-canonical sources, capture timing), then 2 partial fixes in the re-verification round (whitespace between zones; an engine that is not the last classic script), all fixed with browser tests (16 checks). Known limit, documented in FORMAT.md: Save a copy cannot see spellings the HTML parser discards (`&#38;`, quotes, letter case), so a copy of such a file is canonical; `check` reports them and Save's byte comparison refuses them.

### T04 — Apply the brand theme, layout styles and fixed-width editing surface

Dependencies: T03. Scope: M. Paths: `packages/text/theme/`, shared brand variables, browser fixtures.

- Acceptance: the document reads brand variables from the same `charte` contract as Slides and Data; Text layout styles (heading scale, spacing, callouts, table styles, cover, page format, margins) live in `style#theme`. Switching the brand theme restyles the document without touching content.
- Acceptance: the editing surface uses the fixed text width of the selected page format (A4 or Letter), so line breaks match print. Semantic block styles and `ta-l`, `ta-c`, `ta-r`, `ta-j` alignment render; no per-selection font, size or colour controls exist.
- Verification: the same document under two brand themes and both page formats; compare line breaks with print output; confirm the default brand theme matches the Data T11 role colours.
- Status: implemented 27 October 2026 on `feature/text-t04-theme`, in review. [`theme/layout.css`](../packages/text/theme/layout.css) is the default `style#theme` (A4, 25 mm margins, 11 pt type scale, cover, callouts, quotes, code, figures, table roles), reading only charte tokens; the default `style#charte` is the html-slides default charte, equal to the TH01 blue charte and its Data roles (unit test). `#doc` is as wide as the page's text on screen and in print. The format gains `data-margins` (`narrow`, `normal`, `wide`, presets of the theme); each page format and margin combination has a named `@page`. The editor applies `data-theme` and `data-font` as Slides does (mirrored on `<html>` under the shared overlays, never saved) and edits all four attributes as undoable steps from the shared document-settings panel (theme, font, page format, margins), opened from the floating settings bar (with the text width) or File › Document settings. Heading numbers and the running header join the panel with T08 and T14, when they render. `tests/look-browser.mjs` (Chromium): a built-in charte changes only `data-theme` and undoes; the font changes the body only; A4, Letter and the margin presets give the page's text width; every line of the example breaks at the same character on screen and in print, for A4 and Letter; printed PDF pages have the chosen size; semantic blocks, alignment and table roles render; no font, size or colour control exists; the look is saved and reopens applied.

### T05 — Save, copy and recover in four browsers

Dependencies: T03, **[Data]** T07 persistence. Scope: M. Paths: Text save controls, Playwright Chromium/WebKit/Firefox configuration and tests.

- Acceptance: Chrome and Edge save directly to the chosen file with draft recovery. Safari and Firefox edit and save with a clearly labelled **Save a copy** that downloads a complete HTML. Unsaved, draft and saved states are distinct in every browser.
- Acceptance: failed or cancelled saves keep the work; edits made during a save stay dirty; external modification is detected before an overwrite where the browser allows it.
- Verification: local-file tests in all three engines with delayed/rejected writes, reload and recovery; reopen each saved copy and compare canonical content.
- Status: implemented 27 October 2026 on `feature/text-t05-saving`, in review. `runtime/saving.mjs` on [`packages/shared/persistence.mjs`](../packages/shared/persistence.mjs): where the browser can write a chosen file (Chrome, Edge), Save binds it as in T03; elsewhere (Safari, Firefox) the primary action is **Save a copy** (button, File menu and ⌘/Ctrl+S), and no Save command is shown. Every unsaved revision is kept as a draft in this browser's IndexedDB (`html-office-text-recovery`, keyed by the file's address): the article, written half a second after the last edit and when the page is hidden, and the file's other zones (assets, theme; without the engine), rewritten only when the stored ones differ, checked in the same transaction (another tab may have saved and removed them). A clean save or Discard removes it. Saving waits until the draft store has answered (at most five seconds) and while a found draft awaits a choice. Reopening offers the draft in a dialog that cannot be dismissed: Restore replaces the document, with the zones stored with the draft, and starts a new history (undo cannot bring back replaced zones); a draft made from another version of the file is restored as a copy, which Save writes only to a new, empty file. The editor refuses to delete a comment thread that text still refers to, so a kept draft always reopens. The state line distinguishes *No unsaved changes*, *Unsaved changes*, *Unsaved changes · draft kept in this browser* and *Copy downloaded · this file is not changed* (`data-state` saved, unsaved, draft, copied, saving); leaving with unsaved changes always warns (a requested copy may have been cancelled). `tests/saving-browser.mjs` runs from `file://` in Chromium locally and in WebKit and Firefox in CI (job `text-engines`): Save a copy as the labelled action and its states, the copy reopens canonical, a copy request still warns on leaving, draft restore, discard and restore as a copy (with its own assets, after the file lost them) after reopening, Save doing nothing while the draft store has not answered; in Chromium, cancelled, refused and delayed writes (an edit during the save stays unsaved), an externally changed file is not overwritten, and no draft survives a clean save. WebKit and Firefox keep drafts from `file://` too (CI).

Checkpoint A: untouched documents round-trip byte-identically; out-of-schema content is rejected or protected; editing and saving work from `file://` in all four browsers; the code budget passes with measured headroom for the remaining editor. If a gate fails, fix or document an explicit design reassessment before extending the product.

## Phase B: authoring features

### T06 — Edit blocks, inline formatting and links

Dependencies: T04. Scope: M. Paths: editor commands, keymaps, toolbar and browser tests.

- Acceptance: create and convert title, subtitle, H1–H4, body, lead, quote, callouts, caption and code blocks; bulleted and numbered lists with indent/outdent; bold, italic, underline, superscript/subscript, inline code, highlight and links; alignment; explicit page breaks and "start on a new page".
- Acceptance: new headings receive stable IDs that never change on later edits; Enter, Backspace and cross-block deletion produce only schema content; composition input (IME, autocorrect, dictation) is not interrupted.
- Verification: keyboard and pointer workflows in Chromium, WebKit and Firefox; composition tests; serialised diffs after each command contain only subset markup.
- Status: implemented 27 October 2026 on `feature/text-t06-editing`, in review. [`editor/commands.mjs`](../packages/text/editor/commands.mjs) holds the commands as ProseMirror commands over the schema. Paragraph styles (Body, Lead, Title, Subtitle, Heading 1–4, Quote, Note, Warning, Key message, Code, Caption) convert the selected blocks, lifting them out of quotes, callouts and lists as needed: Title makes the first block a cover, restyling the title dissolves the cover, Caption moves the paragraph after a figure into it (or adds one to a selected figure) and back out. Lists are edited flattened (item, level, kind) and rebuilt, since an item holds its text and one nested list: toggle, change kind, indent, outdent, Enter (an empty item leaves its level) and Backspace at an item's start. Bold, italic, underline, highlight, superscript/subscript (exclusive), inline code, links (http, https, mailto, through the shared link dialog, now usable without sheets), alignment (justify for paragraphs only), page breaks and "start on a new page". A new heading's ID comes from its text when it is created (`sec-…`, unique among content, protected and preview IDs) and never changes afterwards. A command that would lose content is unavailable: a footnote or comment anchor into a code block, or the ID of a heading that cross-references, the contents or comment threads point to. New IDs also avoid the file's other IDs. The toolbar has a paragraph-style menu button, text marks, link, lists and alignment, with pressed states; the Format and Insert menus hold every command, with shortcuts (Help › Keyboard shortcuts). Tests: `tests/commands.test.mjs` (each command, then 40 random sequences of 12 commands on random selections of the example: every result saves as a valid file that reopens identically, and a refused command changes nothing) and `tests/editing-browser.mjs` (Chromium locally, Firefox and WebKit in CI job `text-engines`: keyboard and pointer workflows, link dialog, styles, lists, alignment, page breaks, deletion across blocks, and IME composition through the Chrome DevTools Protocol in Chromium; each saved result is validated and canonical). Editing commands: 21,052 bytes minified alone.

### T07 — Paste and import Markdown

Dependencies: T06. Scope: M. Paths: clipboard mapping, Markdown import adapter and fixtures.

- Acceptance: paste from Word, web pages and Excel maps headings, inline formatting, lists, links and simple tables to destination styles and drops other formatting, Word-specific markup and comments. Images are embedded only through the asset path (T12). Plain-text paste inside a block stays available.
- Acceptance: Markdown import (CommonMark plus tables) uses the same mapping and reports constructs it could not represent. Imported or pasted content is data: no script, style or link is activated.
- Acceptance: html-office tables (Data ranges, Slides tables) paste through the shared clipboard module and mapping of [ADR-013](decisions/013-cross-product-clipboard.md) §3, and a Text table copy writes its envelope. This needs cross tasks X02a and X02b; chart paste belongs to T11.
- Verification: captured clipboard fixtures from Word, Google Docs, Excel and web pages; Markdown fixtures with tables, nested lists and HTML fragments; save/reopen and undo of each paste.
- Status: implemented 28 October 2026 on `feature/text-t07-paste`, in review. Every paste, drop and import goes through [`editor/clipboard/`](../packages/text/editor/clipboard/) and [`runtime/clipboard.mjs`](../packages/text/runtime/clipboard.mjs), never ProseMirror's DOM parser: html-office envelopes first ([ADR-013](decisions/013-cross-product-clipboard.md)), then the HTML, parsed in a detached `<template>` and mapped onto the subset (headings, paragraphs, lists including Word's `mso-list` paragraphs and Docs' nested lists, quotes, code, marks from tags or Word/Docs styles, `https`/`http`/`mailto` links, tables through the shared reader's new `readTableElement`), then plain text. Colours, fonts, alignment and Word markup are dropped; images (T12), charts (T11), rules, embedded objects and Word notes are left out and named in the status line. Text's own markup reads back as itself, so copying text between Text documents is lossless; a selected table copies as the envelope, a theme-styled table and TSV. ⌘⇧V / Ctrl+Shift+V and Edit › Paste as plain text paste plain paragraphs; Insert › Markdown… imports CommonMark (commonmark.js 0.31.2, the reference implementation, 34.6 KB minified with character references decoded by the browser) plus GitHub tables, through the same mapping. Pasted tables over 1,000 rows or 30 columns are refused. Tests: `tests/clipboard.test.mjs` (fixtures in the shape of Word, Docs and web-page clipboards, the shared Excel/Sheets/Word/Docs fixtures, Text's own fixtures read back, portable tables both ways, hostile HTML, Markdown) and `tests/clipboard-browser.mjs` (Chromium locally, Firefox and WebKit in `text-engines`: each paste saves valid and canonical and one undo restores the document; envelopes, refused pastes, plain text, cells and code, copy of a table and of a mixed selection, drop, Markdown dialog, Paste as plain text; no request and no script while pasting). Application code 368,915 → 449,251 bytes (+80,336: commonmark 34.6 KB, shared clipboard module 16.6 KB, Text paste mapping and runtime about 26 KB, notices 3 KB); headroom 50,749. Cross-lineage review (Codex gpt-6.1-sol): 11 findings, all fixed with tests: Markdown table limits checked before rendering, overlapping HTML spans, a table pasted into an empty paragraph, deep lists, control characters in envelopes, one undo step per paste, text copied inside a cell, header spans clipped to their row group (shared reader), GitHub tables before a setext underline, strict character references, the plain-text menu's size limit. Manual checks: [MANUAL-CHECKS.md](MANUAL-CHECKS.md) › 6 › T07.

### T08 — Generate numbering, contents and cross-reference labels

Dependencies: T06. Scope: M. Paths: numbering/xref module, table-of-contents node and tests.

- Acceptance: optional heading numbers (`data-heading-numbers`) and figure/table numbers follow document order; the table of contents is generated from headings to `data-depth`. Cross-references are links to IDs whose saved label is rewritten on open and save.
- Acceptance: heading numbers are hierarchical with a format per level (decimal, letters, Roman numerals) taken from the brand theme, with a per-document override stored only when it differs. Unnumbered headings neither show a number nor advance the count; a numbered child builds its prefix only from numbered ancestors. One pure function computes every prefix for the editor, print and Markdown views.
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
- Status: implemented 28 October 2026 on `feature/text-t10-tables` (stacked on T07), in review. [`editor/tables.mjs`](../packages/text/editor/tables.mjs) on prosemirror-tables 1.8.1 (pinned, MIT): cell selection with the pointer and Shift+arrows, Insert › Table (a header row and two body rows), Table menu (rows above and below, columns left and right, delete rows, columns or table, merge and split, header rows, total rows, row headers, emphasis column, compact, column width in whole percent, distribute evenly, caption), Tab and Shift+Tab between cells (Tab in the last cell adds a row), alignment per selected cell. A table guard keeps the subset's shape after every change (header rows first with `th` only, a body row, no span across the header, total rows in the body, one `col` per column). Merged cells join their text with line breaks; deleting a cell selection empties the cells. Paste follows T07: a table pasted into a table fills its cells from the selected one and grows it within 1,000 × 30; anything pasted on a cell selection fills each selected cell; a cell selection copies as the html-office envelope. The caption is the figure's; its number comes from T08's labels. Tests: `tests/tables.test.mjs` (each command, the shape rules, undo, 40 random sequences of 15 commands on random cell selections that must save valid and canonical) and `tests/tables-browser.mjs` (Chromium locally, Firefox and WebKit in `text-engines`). Application code 449,251 → 486,224 bytes (+36,973: prosemirror-tables about 29 KB, commands and menu about 8 KB); headroom 13,776. Manual checks: [MANUAL-CHECKS.md](MANUAL-CHECKS.md) › 6 › T10.

### T11 — Extract the shared chart contract and add Text chart figures

Dependencies: T08, Slides PR #1 landed, **[Data]** T04 loader. Scope: M per part; separate the Slides extraction PR from the Text chart PR. Paths: `packages/shared/charts/`, Slides import updates, Text chart node and tests.

- Note: per [ADR-013](decisions/013-cross-product-clipboard.md) decision 2, the extraction is done earlier as cross-product task X03, before Data T18. T11 keeps only the Text part and depends on X03. Chart copy and paste with Slides (ADR-013 §4) are T11 acceptance items once X02c exists. Charts with Data follow in cross task X02f, after X02d and T11.
- Acceptance (extraction): chart types, JSON schemas, validation and SVG rendering move to `packages/shared/charts/`; Slides tests pass and regenerated example decks are byte-identical to the previous build.
- Acceptance (Text): `figure.chart` with ID, numbered caption and `data-width="text|full"`; saved SVG previews display and print without ECharts or a network; chart editing loads pinned, SRI-verified ECharts through the shared loader, and the offline build embeds it. Charts do not wrap text.
- Acceptance (Text): in edit mode, a chart creates its ECharts instance only when it first scrolls into view (IntersectionObserver); the others keep showing their SVG preview, so a long document with many figures stays responsive.
- Verification: Slides regression suite and byte comparison; Text chart edit, stale/missing preview, blocked or tampered library, undo and save/reopen; offline build with no requests.

### T12 — Embed images and wrap text around them

Dependencies: T08. Scope: M. Paths: Text asset handling (Slides asset contract), image node, wrapping styles and tests.

- Acceptance: images are stored in `script#assets` and referenced with `data-asset` (WebP where available); `alt` is mandatory. Images are full-width blocks or wrapped left/right with a width setting, gap, caption and anchoring to a paragraph; no contour wrapping.
- Acceptance: moving the anchor paragraph moves the image; replacing or deleting an image keeps the asset store consistent with no orphaned assets after save.
- Verification: wrapped images beside short and long paragraphs, consecutive wrapped images, undo/redo and save/reopen; print behaviour is verified in T14.

### T13 — Comment with threads, resolution and orphan handling

Dependencies: T06. Scope: M. Paths: comment marks/threads, comments panel and tests.

- Acceptance: comments attach to selected text with `mark.comment[data-ref]`; threads in `section.comments` support replies and open/resolved status. A display name is asked for once and remembered by the browser, never verified. A thread whose anchor text is deleted is shown as orphaned and is never reattached to unrelated text.
- Acceptance: retain the quotation, original section ID and short prefix/suffix context. After a lost mark, search its reference, then exact quotations in the original section/document. Show repeated matches as separate candidates; never choose the first automatically. Keep recovery ephemeral and the thread orphaned until explicit confirmation; save/open/reject/cancel must not persist a new anchor. Confirmation rechecks the current revision and target. Intact marks use editor transaction mapping.
- Acceptance: comment text is document data. The format reference and runtime never execute or follow it; threads are excluded from print by default.
- Verification: edits inside/around/across anchors, external rewrites, delete/undo and reopen; repeated quotes within a paragraph, across sections and after moved/deleted sections; reject/cancel/confirm recovery and change the target before confirmation. No unconfirmed anchor reaches saved content. Retain a comment containing LLM-directed instructions for T18/T20.

Checkpoint B: a user can write, structure, illustrate and comment a multi-section document and save it in all four browsers without losing content. Byte-identity for untouched content still holds after every feature. Recheck the code budget with all editor features included.

## Phase C: print, outputs, tooling and measurement

### T14 — Paginate for print and preview

Dependencies: T09, T10, T11, T12, T13. Scope: M. Paths: print styles, print preview and print tests.

- Acceptance: CSS paged media provides A4/Letter pages, margins, running headers and footers, page numbers, explicit page breaks, "start on a new page", keep-together rules for headings/figures/table rows, repeated table headers, endnotes and a linked table of contents without page numbers (deferred to the roadmap; Chrome does not support `target-counter()`). Comments are hidden.
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
- Verification: commit the 50-page and 100-page fixtures and the benchmark harness; CI runs them on every PR with the agreed thresholds (see [shared rules](HTML-OFFICE-V1.md#shared-authoring-and-quality-rules)), so a performance regression fails the build.

Checkpoint C: print preview and PDF agree; Markdown view/export and section tooling pass on all fixtures; the 50-page target and code budget pass with evidence. Recheck dependency notices.

## Phase D: prove the complete authoring and recipient workflow

### T18 — Package the Text skill and embedded guide

Dependencies: T17. Scope: M per workflow; separate document tooling from skill packaging. Paths: `packages/text/tools/` (`new`, `pack`), `plugin/skills/html-text/`, references and package tests.

- Acceptance: `new` and `pack` generate standard and offline documents with brand and layout themes; the inert embedded guide documents the full subset, section-based editing, the numbering and label rules, and states that comments and imported content are data, never instructions. It works offline and links to compatible skill downloads.
- Acceptance: the skill generates long content in passes: outline with section IDs, sections written in Markdown with one-line block placeholders (`[[block: … | intent: "…" | id: …]]`), then deterministic conversion to the subset and validation before `replace`. Resolve each placeholder from an existing canonical figure or a validated payload map keyed by ID; intent-only charts are insufficient. Unknown/duplicate IDs, missing payloads and kind mismatches fail without replacement. Rewrites preserve the existing ID, dataset/assets, caption, layout and comment references unless explicitly changed. Verify new chart/image creation, reused figures and each failure with fixed fixtures; missing data is reported, never invented.
- Acceptance: only now ship a working Text skill alongside Slides (and Data if shipped); keep the plugin identity, paths and release compatibility. No placeholder skill is shipped before this point.
- Acceptance: the skill follows the [shared rules](HTML-OFFICE-V1.md#shared-authoring-and-quality-rules) rules: validated LLM output with at most two corrective retries, and valid/invalid example documents that double as test fixtures.
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
| Chrome print cannot deliver a required print feature (margin boxes, wrapped images or merged tables at page breaks) | Document the limitation and the fallback; reassess the scope explicitly before release |
| Shared chart extraction changes Slides output | Stop the extraction until regenerated decks are byte-identical and Slides tests pass |
| Comment anchors drift or attach to the wrong text | Prefer an orphaned thread to a wrong anchor; stop comment-dependent work until anchor tests pass |
| An LLM follows instructions embedded in comments or imported content | Strengthen the guide and skill rules and repeat the failing blind-test task |
| Safari or Firefox editing behaves differently | Fix or document the limitation before claiming four-browser editing |
| Paste from Word or the web produces out-of-subset markup | Extend the mapping or drop the formatting; never let unsupported markup reach the canonical content |

No further product question is currently pending. Technical validation may expose a concrete tradeoff requiring a documented scope decision; it must not silently remove an approved requirement.
