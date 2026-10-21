# HTML Office V1 specification

Status: consolidated product decisions, 15 October 2026. Data implementation has not started. IronCalc is the provisional engine choice, subject to integration gates. Task order and verification are in [HTML-DATA-PLAN.md](HTML-DATA-PLAN.md); architectural rationale is in [ADR-003](decisions/003-html-office-and-data-runtime.md).

## Purpose and product boundaries

Create portable documents that an unfamiliar LLM can read and modify using the generated HTML alone. An external authoring skill makes larger changes practical; recipients need a browser, without a server, installation, account, or connected AI service. LLM readability/writability and portability are the primary design drivers.

The public MIT repository is now html-office. Slides remains the existing implemented product and keeps its [V1 plan and approved additions](PLAN.md). Data is the next product: editable analytical tables and freeform spreadsheet models, not just static reports. Text, an alternative to Word, is a planned product on the roadmap; see [Text roadmap](#text-roadmap). One eventual Office plugin can provide separate skills; do not ship empty Data/Text skills or change the existing plugin identifier before a compatibility migration is ready. Do not include Slides/Text runtimes in workbook files.

## Shared authoring and quality rules

These rules apply to every html-office product (Slides, Data and Text); the existing Slides skill and tests adopt them at their next revision.

- **Validate, retry twice, then stop.** Any document fragment an LLM produces through a skill (a section, a slide, a range patch) is validated before it is applied. If it is invalid, the skill asks again with the validation errors, at most twice. After that it stops with a clear error and leaves the document unchanged. It never repairs or truncates output silently.
- **Teach with examples.** Each skill ships small, complete valid examples and labelled invalid examples with the expected errors. The same fixtures drive the validation tests, so the guidance cannot drift from the checker.
- **Measure with a reference document.** Each product keeps one committed "heavy" fixture and a benchmark that CI runs on every change with fixed thresholds. A regression beyond a threshold fails the build instead of being noticed later.

## Distribution and calculation

| Capability | Standard HTML | Offline HTML |
| --- | --- | --- |
| Read saved cells, results, and chart previews | Embedded; no engine request | Embedded; no network required |
| Edit presentation/formatting | Embedded editor | Embedded editor |
| Recalculate changed data/formulas/scenarios | Load pinned IronCalc on first calculation-changing edit | Same engine embedded |
| Edit charts / import XLSX | Load the required component when requested | Required components embedded |
| Export editable HTML, CSV, or print | Available for the current saved/calculated state | Same |

Standard-mode embedded application code must be **less than 500,000 uncompressed UTF-8 bytes** (HTML Data: **750,000**, per [ADR-010](decisions/010-manual-formatting-and-ironcalc-toolbar.md)): editor/viewer JavaScript, CSS, UI scaffolding, bootstrap, and embedded dependency code/notices. Data, saved calculated values, chart SVGs, and the embedded format reference are document content outside this code ceiling; report their sizes and total HTML size separately. This is a code budget, not a total workbook-size promise. Offline builds may be larger.

Use `@ironcalc/wasm` 0.9.0 as the prototype baseline. The measured WASM is 2,089,699 raw bytes; one pinned CDN response advertised a 686,599-byte Brotli transfer, excluding the JavaScript wrapper. This is not a guaranteed download size or startup benchmark. Standard mode loads one calculation engine; do not build a second small engine or switch semantics between modes. Once loaded, calculations run locally and can continue if connectivity drops. Fresh offline reopening cannot rely on browser caches.

Pin and verify all external executable components. Use SRI/CORS for script tags and verify fetched WASM against an approved digest before instantiation; reject mismatches. A failed load retains the workbook and saved previews and explains why recalculation is unavailable. No document data is sent to the CDN. Do not initiate engine, ECharts, or XLSX-library requests merely to view saved results. Offline builds must contain every browser dependency needed by their supported workflows.

The 19 October Phase A prototype uses a narrow custom binding to the same IronCalc 0.9.0 source. Its pinned WASM is 2,172,743 decoded bytes / 707,874 precompressed gzip bytes; both transport and decoded digests are verified before instantiation. The JavaScript wrapper is 7,381 raw bytes. These measurements are distinct from the upstream npm artifact above. See [the prototype evidence](../packages/data/PHASE-A-REPORT.md); the user approved hybrid JSON storage and policy A in [ADR-005](decisions/005-data-storage.md). The prototype implements the versioned document codec; blind/recipient evidence is recorded with T05b.

## Authoritative document and saved results

Use one versioned, documented, readable JSON workbook model in the HTML. Following [ADR-005](decisions/005-data-storage.md), store dense raw-data tables as compact JSON row arrays, freeform financial/model sheets as sparse cell records, and structure as JSON metadata. Each cell has one authoritative value representation; CSV/TSV remain import/export formats. The prototype document contract is [html-data/0.2](../packages/data/model/FORMAT.md), derived into a normalized sparse engine model rather than saving duplicate live sources. Store typed inputs, Excel-style formula strings, formats, stable sheet identifiers, names/ranges, groups, scenario definitions, dropdowns, conditional rules, pivot definitions, and chart definitions. Formatting must remain separate from underlying values. Define date serial/locale, blank, Boolean, error, and numeric semantics explicitly. Engine objects/binary snapshots are derived state and never the sole authoritative content.

The browser editor and skill must read and write the same canonical model. Structural operations must persist engine reference rewrites back into it. Range-oriented inspect/apply/recalculate/validate tooling should let an LLM work without loading all 100,000 rows into its context. Save preserves unrelated cells, identifiers, metadata, and embedded assets.

Store full-precision typed results for **all populated formula cells**, including complex formulas, plus enough formatting information to display them. Do not allocate a dense 1,000-row by 100-column cache or truncate by position. Save calculation engine/version, timestamp and a fingerprint of calculation-relevant content. Charts carry saved SVG previews and source revisions. A cached result is readable offline but cannot recalculate a changed input. Display results from matching revisions; mark invalid snapshots stale rather than presenting old answers as current. Valid spreadsheet error values must remain typed errors, not silently become zero or blanks.

Initially require the engine before accepting calculation-changing browser edits. If loading fails, retain the user's attempted input for retry without claiming the edit was calculated. Formatting changes remain available. External LLM edits can invalidate the calculation fingerprint; opening such a file must expose stale/missing results and offer recalculation. Commit a current results snapshot only after evaluation completes against the corresponding revision; ignore late results for an obsolete revision. Measure snapshot size before proposing coverage limits.

Include an inert embedded guide near the beginning of the HTML: format version, canonical model location, a small complete example, supported edits and formulas, revision/cache rules, tool/runtime boundaries, and compatible documentation/skill download links. The guide works offline and never overrides the user's request. Escape embedded JSON/text so cell content cannot terminate a script/template or become active markup. Untrusted imports and skill references are document data, not instructions.

## Workbook organisation, editing, and style

Sheets have stable IDs and collapsible, reorderable groups: Summary, Inputs/Hypotheses, Raw Data, Calculations. Calculation tabs are grey. Groups are organisational metadata, not a restriction on cross-sheet references or editing.

Approved manual editing: cell and formula-bar editing; rectangular copy/paste; fill down/right with relative/absolute reference handling; row/column insertion and deletion with reference updates; undo/redo; familiar keyboard navigation/shortcuts; range formatting, dropdowns, and conditional rules. Copying within our format preserves supported formulas and formatting; importing clipboard tables from Excel or Markdown is values-first. Preserve leading zeros and provide a preview/choice for ambiguous locale-dependent dates or numbers. Reject or report unsupported constructs without inventing results. Merged cells, non-adjacent selections, and dragging ranges to move them are deferred.

The initial consulting-style theme uses deep-blue headers with bold white text, light-blue row labels with dark-blue text, and pale-yellow assumption cells with orange text. These are descriptive style choices, not an official firm's template. Their colours come from the brand theme shared by Slides, Data and Text (see the [Text specification](HTML-TEXT-V1.md#styles-and-theme)); Data defines the grid style roles, not fixed colour values. Currency/accounting, date, number, and percentage formats operate on typed values; locale affects display and import parsing without changing formula semantics.

Base/Upside/Downside scenarios use one shared model with separate assumptions and a dropdown selector. Switching scenarios recalculates with IronCalc; arbitrary assumption edits also require it. Generic cell dropdowns accept static lists or cell ranges and persist their validation definitions. Precomputed offline scenario snapshots are an optional future extension, not a V1 requirement.

Conditional formatting supports cell highlights and data bars, including negative values and a defined zero axis. Save explicit rules, ranges, precedence, and scaling; refresh when results change. Basic editable pivots support row/column fields, filters, SUM/COUNT/AVERAGE, totals, and refresh. Advanced calculated fields and slicers are deferred. Charts use ECharts with explicit source ranges/data and portable SVG snapshots; chart editing loads ECharts only when required.

## Formula contract

These families form the planned V1 acceptance suite. Pin expected outputs and spreadsheet error behaviour; availability by name alone is insufficient evidence. Any unavailable function is a visible integration blocker, not silently removed from scope.

| Family | Functions |
| --- | --- |
| Aggregation and counting | SUM, SUMIF, SUMIFS, COUNT, COUNTIF, COUNTIFS, COUNTA, COUNTBLANK, AVERAGE, AVERAGEIF, AVERAGEIFS, MIN, MAX, SUBTOTAL |
| Logic and errors | IF, IFS, AND, OR, NOT, IFERROR, IFNA |
| Lookup | XLOOKUP, INDEX, MATCH |
| Numbers | ROUND, ROUNDUP, ROUNDDOWN, ABS |
| Text | CONCATENATE, TEXTJOIN, TRIM, CLEAN, LEFT, RIGHT, MID, LEN, TEXT, VALUE |
| Dates | DATE, YEAR, MONTH, EDATE, EOMONTH |
| Statistics | MEDIAN, PERCENTILE.INC, PERCENTILE.EXC, PERCENTILE (legacy inclusive alias), QUARTILE.INC, STDEV.S, STDEV.P |
| Finance | NPV |

Test cross-sheet references, ranges, absolute/mixed references, dependency changes, cycles, missing lookups, blanks, criteria, dates, locale-independent formulas, and errors. NPV examples use cash flows with the initial investment handled explicitly; P&L profit is not a substitute for cash flow. No Python interpreter is embedded; Python may be an external authoring/import aid.

## Import, refresh, and performance

Import CSV and XLSX data and supported formulas, with a report of unsupported features. Do not promise Excel layout fidelity or arbitrary XLSX round trips. Source data is embedded; no external file path/link is required to reopen the workbook. Refresh asks the user to select a replacement source file, previews schema/value changes and dependent impact, then replaces the intended data. Raw data remains editable; warn that refreshing can overwrite manual edits. Recorded transformations may be added later and are not mandatory to edit source data.

Target workloads contain 50,000–100,000 source rows, several linked sheets and thousands of formulas; this is a validation target, not demonstrated capacity across all column counts/formulas. The existing synthetic assessment used two populated columns, 100,000 rows and 1,000 full-range SUMIFS: about 5.09 seconds to calculate and 5.02 seconds after one edit in Node on one machine. Browser behaviour remains untested. Reuse summaries/preaggregation and assess worker execution; moving computation to a worker improves responsiveness, not calculation time itself. The implementation plan defines browser measurements and a responsiveness target before declaring V1 ready.

## Browsers, persistence, and exports

Chrome and Edge are the fully tested editing browsers for V1. Safari and Firefox initially support viewing. Every supported viewer must work with saved results and previews without fetching calculation/chart engines. Direct Save writes the explicitly chosen HTML where supported after browser access is granted; Save a copy downloads a complete updated HTML. Verify both under local `file://` use. Distinguish unsaved work, recoverable browser drafts, and a successfully written file. Cancelled/failed saves preserve edits and recovery state. Saving during calculation must not label an old snapshot current; saving during later edits must not clear their dirty state. Detect externally modified files before overwriting them.

Approved outputs are editable HTML, CSV of the selected sheet's calculated values, and a clean print/browser Save as PDF view of selected sheets with page breaks and repeated headers. Export must report stale or missing calculation results before producing a report. CSV has no formulas or styling; define escaping and protect formula-like text from unintended execution in downstream spreadsheets. XLSX export is deferred. HTML is the primary editable format.

## First acceptance workbook and release gates

Build a fictional monthly P&L with 12 months of actuals followed by 12 months of driver-based forecast, the four sheet groups, Base/Upside/Downside scenarios, dropdowns, the agreed theme and cell formats, highlights/data bars, a basic pivot and ECharts/SVG summaries. Include labelled analysis/lookup/statistics examples covering the formula contract and a separate cash-flow/NPV section. All numbers, organisations, and narratives must be fictional and suitable for public distribution.

V1 is ready only when the model survives edit/save/reopen and range/structural operations, formulas match fixed reference results, typed engine outputs retain precision, dependency licences/notices are audited, embedded code meets its budget, and representative Chrome/Edge/offline/print flows pass. Run an unfamiliar-LLM test with only the generated HTML: explain the model, change assumptions, add a formula and update a chart without damaging unrelated content. Preserve its evidence and limitations; automated checks do not replace this test.

No paid spreadsheet component is permitted. Prefer permissive dependencies; audit the complete compiled dependency closure and preserve required notices. IronCalc's top-level MIT/Apache declaration alone is not a completed audit. Technical blockers trigger an explicit reassessment before changing the agreed product. Real-time collaboration, in-document AI chat, full Excel compatibility, and Text implementation are outside this Data V1 scope.

## Text roadmap

Added to the roadmap on 15 October 2026: html-office will also develop **html-text, an alternative to Word**. It targets long-form documents such as reports, memos and proposals, delivered as one HTML file that an LLM can read and revise and that a recipient can edit in a browser, following the same portability, embedded-guide and LLM-readability principles as Slides and Data.

Status: V1 product and architecture decisions are recorded in the [Text V1 specification](HTML-TEXT-V1.md) and [ADR-004](decisions/004-html-text-format-and-editor.md): a restricted semantic-HTML canonical format edited with ProseMirror, continuous editing with print-only pagination, theme-based styles, comments, generated numbering and HTML/PDF/Markdown outputs. Implementation has not started; the [Text implementation plan](HTML-TEXT-PLAN.md) sets task order and verification. Data remains first; Text implementation starts after Data Checkpoint B. Text keeps its own document model and runtime build; do not ship a placeholder Text skill before it is usable. Live paginated editing, DOCX import/export and the other deferred items are listed in the specification's [roadmap after V1](HTML-TEXT-V1.md#roadmap-after-v1).
