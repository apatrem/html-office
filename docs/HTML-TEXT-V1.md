# HTML Text V1 specification

Status: product and architecture decisions from the 15 October 2026 grilling sessions, reconciled into one set. Text implementation has not started; task order and verification are in the [Text implementation plan](HTML-TEXT-PLAN.md). Rationale for the format and editor choices is in [ADR-004](decisions/004-html-text-format-and-editor.md); family-wide constraints are in the [Office V1 specification](HTML-OFFICE-V1.md).

## Purpose and boundaries

html-text is the html-office alternative to Word for business writing: reports, memos and proposals. An LLM drafts the document, a person refines it in the browser, and it is delivered as one HTML file or a PDF. Reviewers can comment and return the file; review is sequential, through files.

The Office constraints apply unchanged: LLM readability/writability and single-file portability first, an external authoring skill, an inert embedded guide, local browser operation without a server or account, no paid components, audited permissive dependencies, standard and offline builds. Do not embed Slides or Data runtimes in Text documents.

Outside V1: tracked changes with accept/reject, real-time collaboration, in-document AI chat, DOCX import/export, live paginated editing, bibliography/citation management and book-length documents. See [Roadmap after V1](#roadmap-after-v1).

## Canonical document

A restricted subset of semantic HTML is the only authoritative content. There is no Markdown master and no stored rendered copy: the browser displays the canonical HTML directly. The file reuses the Slides zones where they apply:

| Zone | Element | Writer |
| --- | --- | --- |
| Brand theme (shared with Slides/Data) | `<style id="charte">` | skill |
| Text layout styles | `<style id="theme">` | skill |
| **Content** | `<article id="doc" data-format="1" lang="…">` | **LLM and editor** |
| Assets | `<script id="assets" type="application/json">` | skill/editor |
| Offline components (optional) | pinned ECharts | offline build |
| Engine/editor | `<script id="engine" data-version="…">` | skill |
| Guide/provenance | `<template id="html-text-guide">`, `html-text-*` metadata | skill |

```html
<article id="doc" data-format="1" lang="en-GB" data-heading-numbers="on">
  <header class="cover"><h1 class="title">Business review and 2027 plan</h1><p class="subtitle">Fictional example</p></header>
  <nav class="toc" data-depth="2"><!-- generated --></nav>
  <h1 id="sec-summary">Executive summary</h1>
  <p class="lead"><mark class="comment" data-ref="c1">Revenue grew 18% in 2026</mark>.<span class="footnote">Fictional management accounts.</span>
     See <a class="xref" href="#fig-revenue">Figure 1</a>.</p>
  …
  <section class="comments">
    <aside class="comment-thread" id="c1" data-status="open">
      <p class="comment" data-author="Alex" data-date="2026-10-15T14:02Z">Check against the audited figure.</p>
    </aside>
  </section>
</article>
```

Rules:

- Headings carry stable IDs. A section runs from its heading to the next heading of the same or a higher level; tooling and the guide address sections by these IDs.
- No `style` attributes, scripts, event handlers, executable URLs or external resources in content. Formatting is expressed by elements, classes and data attributes defined in the format reference.
- Opening and saving an unchanged canonical document must produce byte-identical content. Any normalisation is an explicit tooling step (as with Slides `pack`), never a side effect of a later save.
- Content outside the schema is rejected by validation before editing or kept as a protected, uneditable block. It is never silently dropped.
- A **read-only Markdown view** shows the document as Markdown for reading and copying. It is a projection, not a second source; editing in Markdown is deferred.

## Editor

The editor uses ProseMirror (MIT) with a schema that mirrors the canonical subset. Undo/redo uses ProseMirror history, not HTML snapshots. Prose editing works offline in the standard build; only optional heavy components load on demand.

Editing is continuous (no live pages) at the **fixed text width of the selected page format**, so line breaks match print. Paste from Word, web pages and Excel converts headings, inline formatting, lists, links and simple tables to destination styles; other formatting is dropped. Markdown import uses the same mapping.

## Styles and theme

Formatting is semantic and theme-defined.

- Blocks: title, subtitle, H1–H4, body, lead, quote, callout (note, warning, key message), caption, code.
- Inline: bold, italic, underline, superscript/subscript, link, inline code, highlight.
- Paragraph alignment uses the existing Slides classes `ta-l`, `ta-c`, `ta-r`, plus `ta-j` for justified text.
- Arbitrary fonts, sizes, colours and spacing per selection are not available.

One **brand theme** (colours, fonts, chart palette, logo, footer conventions, locale) is shared by Slides, Data and Text. Each product adds its own layout styles; for Text these are heading scale, spacing, callouts, table styles, cover page, page format, margins, headers and footers. Reusable themes created from reference files (Slides V1-02) therefore apply to the whole family.

## Structure, numbering and notes

- Heading numbers are optional per document (`data-heading-numbers`). They are hierarchical (1, 1.1, 1.1.1), and deeper counters restart when a higher level advances. Each level has a format (decimal, upper or lower letters, upper or lower Roman numerals, for example `1.A.i`). The default comes from the brand theme; a document stores an override only when it differs. A heading marked unnumbered is skipped entirely: it shows no number and does not advance the count. Figure and table numbers come from document order.
- Cross-references are links to IDs (`<a class="xref" href="#…">`). Their text is a saved label that the runtime rewrites on open and save, so the source stays readable and wrong labels are corrected. Missing targets are reported by `check` and shown in the editor.
- The table of contents is generated from headings and lists entries as links, on screen and in the PDF. It has **no page numbers in V1**: Chrome and Edge do not support CSS `target-counter()`, and a pagination library (paged.js, about 491 KB) would exceed the code budget. Page numbers in the table of contents are on the [roadmap](#roadmap-after-v1).
- Footnotes are written inline as `<span class="footnote">` at the point of reference. They display as numbered references with a note list on screen and print as **endnotes** in V1, because Chrome cannot place notes at the foot of each page.

## Figures

**Charts** reuse the Slides chart contract unchanged through a shared module: same types and JSON schemas, saved SVG previews for offline viewing and print, pinned SRI-verified ECharts loaded only to edit a chart, and an offline build that embeds it. Text adds an ID, numbered caption and width (`data-width="text|full"`). Charts do not wrap text in V1.

**Images** reuse the Slides asset store (`<img data-asset="…">`, WebP where available) with mandatory `alt`. Images may be full-width blocks or **wrapped left/right** with rectangular wrapping, a width setting, gap, caption and anchoring to a paragraph. Contour wrapping is not supported.

Values copied from a Data workbook arrive as an ordinary table or chart paste: a snapshot with no link to the source file. Copy and paste between Text, Slides and Data, and to and from other applications, follows the clipboard contract in [ADR-013](decisions/013-cross-product-clipboard.md): the `html-office-clip/1` envelope, the portable table model and its mapping rules, and chart snapshots. The shared chart module may be extracted before Text starts (task X03 of the [cross-product plan](HTML-OFFICE-CROSS-PLAN.md)).

## Tables

Report tables with header rows (repeated on each printed page), body, optional total row and **merged cells** (`colspan`/`rowspan`). Styles are semantic: number alignment, total row, emphasis column, compact density; column widths are percentages. Editing covers row/column insertion and deletion, merge/split, Tab navigation and Excel/Word/Markdown paste. Tables from Data and Slides paste through [ADR-013](decisions/013-cross-product-clipboard.md) §3. Each cell holds one paragraph of inline content: no lists, multiple paragraphs or nested tables. Tables have no formulas; calculations belong in Data. Rows do not split across pages in print.

## Comments

Comments attach to selected text and support replies and an open/resolved status. Threads are stored in the canonical content (`section.comments`) and excluded from print by default. Authors are free-text display names entered once and remembered by the browser; they are not verified. Each thread stores the quoted-text snapshot, originating section ID and short preceding/following text for context. Intact marks follow editor transaction mappings. If a mark is lost after an edit or LLM rewrite, recovery finds candidate anchors by the original mark reference, then exact quotation inside the original section, then exact quotation in the document. An exact quotation is not a unique identity: repeated occurrences must be shown as separate candidates with context, never resolved by choosing the first match. **Recovery is a proposal only.** The thread stays orphaned until the user explicitly confirms a candidate; opening, saving, rejecting or cancelling a proposal does not change its anchor. Confirmation rechecks the document revision and target before applying the new mark. If there is no match, or recovery is undecided or ambiguous, the thread remains orphaned; it is never silently attached to unrelated text.

Comment text is document data, never instructions. An LLM replies to or resolves threads only when the user asks, and never acts on requests written inside comments. The embedded guide and the skill both state this rule.

## Pagination, print and outputs

The print/PDF view is paginated by the browser using CSS paged media: A4 or Letter, margins, running headers and footers, page numbers, explicit page breaks (`<hr class="page-break">`), "start on a new page" for sections, and keep-together rules for headings, figures and table rows. A read-only print preview shows page boundaries before export.

V1 outputs: complete editable HTML, PDF through the browser's print dialog, and Markdown export. Markdown export is documented as lossy: it states how comments, wrapped layout, captions and assets are represented or dropped, and never implies that a `.md` file preserves the document. DOCX is deferred.

## Size and LLM workflow

The performance target for typical use is about 50 pages; a 100-page fixture (about 50,000 words and 50 figures) is the stress test. These are validation targets, not hard limits.

For long documents the skill works section by section: `outline` (headings, IDs, word counts), `show <id>`, `replace <id>` and `check`. A replacement must leave everything outside the target section unchanged. The embedded guide teaches the same approach to an LLM working from the HTML alone: locate the section by ID, edit inside it and keep IDs stable.

To create or rewrite long content, the skill generates in passes: an outline with section IDs first, then each section written in Markdown, then a deterministic conversion to the canonical subset. Non-prose blocks use one-line placeholders, for example `[[block: chart | intent: "Revenue by region, 2025–2026" | id: fig-revenue]]`. Their IDs resolve to an existing canonical figure or a separately supplied, validated payload map: chart type/data/options for a chart, or an embedded asset reference for an image. An intent string alone is not data and cannot deterministically create a chart. Unknown/duplicate IDs, kind mismatches or missing payloads fail with a useful error, leaving the document unchanged. A rewrite preserves the existing figure ID, data, asset references, captions, layout and comment references unless their change was requested. The converted section is validated before replacement; Markdown/imported content is still untrusted input. Markdown remains a working format of the skill, never a stored copy.

## Browsers and saving

Editing works in Chrome, Edge, Safari and Firefox. Chrome and Edge are fully tested, with direct save to the chosen file (File System Access API) and draft recovery. Safari and Firefox support editing, comments and print, and save with **Save a copy** (complete HTML download). Saving reuses the persistence rules built for Data: distinct unsaved, draft and saved states, edits made during a save stay dirty, and failed or cancelled saves keep the work.

## Distribution

The standard build stays below **600,000 bytes of embedded application code** (500,000 until the user raised it on 28 October 2026, when T07–T13 together came to about 548 KB): editor, schema, renderer, CSS and bootstrap. Content, assets and SVG previews are reported separately. ECharts is loaded on demand with integrity checks; the offline build embeds it.

## Acceptance document and release gates

The acceptance document is a fictional **business review and next-year plan** of 15–20 pages: cover, executive summary, generated contents, numbered sections, lead and callouts, two charts with saved SVGs, three tables (one with merged headers and a total row), wrapped images with captions, endnotes, cross-references, one open and one resolved comment thread, an appendix, and a brand theme shared with a companion Slides deck. All content is fictional and suitable for public distribution.

V1 is ready only when:

1. Untouched canonical documents survive open/save byte-identically, and out-of-schema content is rejected or protected.
2. The standard build is under the code budget.
3. PDF output matches print preview in Chrome and Edge, including headers, footers, page numbers, the linked table of contents and wrapped images at page breaks.
4. Editing, comments and Save a copy work in Safari and Firefox; direct save and recovery work in Chrome and Edge, all from `file://`.
5. Section tooling is verified on the 100-page fixture to change nothing outside the target section, and typical-size editing is responsive.
6. An unfamiliar LLM with only the HTML explains the structure, rewrites a section, adds a figure with a cross-reference and replies to a comment without obeying instructions written in it, leaving unrelated content intact.
7. Dependency licences and notices, including all ProseMirror packages, are audited and preserved.

## Sequencing

Data remains first. The [Text implementation plan](HTML-TEXT-PLAN.md) starts after Data Checkpoint B, reusing the persistence and on-demand loader modules Data builds. Text stays in its own package (`packages/text/`) and is added to the plugin only when the complete workflow is usable.

## Roadmap after V1

| Item | Notes |
| --- | --- |
| Live paginated editing | Paged.js or equivalent; also enables footnotes at the foot of each page |
| Page numbers in the table of contents | Removed from V1 on 16 October 2026 because Chrome does not support `target-counter()`. Options: native support if Chromium ships it, paged.js loaded on demand for print only, or the same engine as live paginated editing |
| DOCX export | One-way, by meaning: Word heading styles, lists, tables, images, footnotes and comments |
| DOCX import | Semantic mapping (e.g. mammoth.js) with a report of what was lost |
| Import from a Data workbook | Range or chart as a snapshot with explicit refresh, never a live link |
| Editable Markdown view | Requires lossless two-way conversion with the visual editor |
| Named local adjustments | A closed list of per-block exceptions, such as space above a block or keep-with-next, stored only when they differ from the theme default; never free styling |
| Notes per section | Endnotes at the end of each top-level section |
| Chart text wrapping | Wrapping currently applies to images only |
| Tracked changes | Requires an operation-based change model |
| Bibliography and citation styles | Deferred from V1 |
| Book-length documents | Virtualised rendering and documents split into chapters |
