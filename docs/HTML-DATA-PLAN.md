# HTML Data V1 implementation plan

Status: proposed implementation sequence, 15 October 2026. Product decisions are consolidated in the [Office specification](HTML-OFFICE-V1.md); [ADR-003](decisions/003-html-office-and-data-runtime.md) records the architecture. Implementation update, 19 October 2026: T01–T04 have a working experimental implementation; T05 browser evidence and T05b storage experiments are in [the Phase A report](../packages/data/PHASE-A-REPORT.md). The user approved hybrid JSON storage and policy A in [ADR-005](decisions/005-data-storage.md); its model/runtime adoption and unfamiliar-LLM evidence are included in T05b. T06–T10 and the shared-brand/range-formatting slice of T11 are merged; T11 sheet navigation is under verification. Later tasks continue under the autonomous authorisation recorded in [the progress ledger](HTML-DATA-PROGRESS.md). The earlier engine assessment alone did not complete these product tasks.

## Delivery rules and dependencies

The user authorised one draft PR through T05b on 19 October 2026, with separate incremental commits and storage selection held for joint review. Subsequent work uses small branches/PRs, each leaving Slides working and delivering a reviewable increment. Acceptance criteria below are the minimum verification contract; changes to them must be explicit. Do not treat document approval as evidence that an engine gate passed. Use fictional public fixtures throughout. Review the plan before beginning product implementation.

Start Data in `packages/data/`, with its own model, runtime build, tests and fixtures. Keep existing Slides source, commands, skill identity and release artifacts in place. The merged [Slides hardening PR #1](https://github.com/apatrem/html-office/pull/1) satisfies the prerequisite for later folder/identity migration; neither migration is included in this work. Data prototyping does not require either migration. Add the Data skill to the existing plugin only after the complete workflow is usable; keep the current plugin identifier until a dedicated compatibility change.

Do not add IronCalc or import/chart dependencies to the Slides runtime. Separate generated runtime code from readable workbook content and cache data. Share modules only after both products have demonstrated a common requirement. Likely paths below are proposed, not files that already exist. S means about 1–2 implementation/test files; M means about 3–5. Split further if an increment exceeds that scope.

Dependency order: T01 → T02 → T03 → T04 → T05 → T05b. Then T06 → T07 → T08 → T09 → T10 → T11. T12–T19 build on that model/editor foundation as identified below; T17 no longer waits for T15 (24 October 2026). T20–T22 integrate, measure and validate the whole product. Checkpoints are technical gates; an unmet gate stops dependent work until fixed or the tradeoff is recorded.

## Phase A: prove the model and engine before building the full editor

### T01 — Define a small, readable workbook contract

Dependencies: none. Scope: M. Paths: `packages/data/model/`, schema/reference fixtures and tests.

- Acceptance: a versioned sparse model represents two linked sheets, typed inputs/formulas/results, formats and stable IDs; explicitly defines ranges, blanks, errors, dates and cache fingerprints.
- Acceptance: validation rejects inconsistent model IDs/ranges and active markup while allowing explicitly typed spreadsheet reference errors; parsing/serialising preserves unrelated content. Embed JSON safely, including `</script>`, Unicode and HTML-like cell text.
- Verification: fixed valid/invalid fixtures and a model round trip; review a compact human-readable example without any engine binary state.

### T02 — Obtain precise typed IronCalc results and audit distribution

Dependencies: T01. Scope: M. Paths: `packages/data/engine/`, adapter tests and dependency notices.

- Acceptance: a pinned engine adapter reads/writes the canonical model and returns full-precision numbers, text, Boolean, blank and typed errors without parsing formatted strings. Document any required upstream/custom WASM binding and how to reproduce it.
- Acceptance: identify the complete compiled/runtime dependency licence closure and required notices; no paid component or unresolved incompatible distribution obligation. Verify JS/WASM provenance and record approved digests.
- Verification: precision/rounding/date/error probes, cross-sheet edit/recalculation and a reproducible adapter build. If typed access or licensing fails, record a blocker before dependent implementation.

### T03 — Build a minimal editable and saveable HTML

Dependencies: T02. Scope: M. Paths: `packages/data/runtime/`, build tool and browser smoke fixture.

- Acceptance: a two-sheet workbook opens under `file://`, shows saved results, accepts one assumption edit with IronCalc, and exports a complete HTML which reopens with the edit, formulas and results intact.
- Acceptance: the canonical JSON remains authoritative; undo of this edit restores both input and result state. Report embedded code/content/total file bytes separately.
- Verification: real Chromium save/reopen test, canonical-model comparison and the standard code measurement; reject a prototype that requires a local server.

### T04 — Prove on-demand and offline dependency loading

Dependencies: T03. Scope: M. Paths: Data loader/build modules and network browser tests.

- Acceptance: standard opening/formatting makes zero engine/chart/import-library requests; first calculation-changing edit loads a pinned verified JS/WASM pair. Offline build embeds the same pair and recalculates without HTTP requests.
- Acceptance: blocked network, wrong digest, cancellation/retry and a late load do not lose the attempted edit or silently change formulas/results. Reject changed bytes before execution; separate engine-ready from network-connected state.
- Verification: fresh browser contexts with offline, blocked and tampered responses; disconnect after loading and continue recalculating. Check the generated standard build remains below 500,000 embedded application-code bytes.

### T05 — Reproduce representative browser performance

Dependencies: T04. Scope: M. Paths: `packages/data/bench/`, worker adapter if warranted, benchmark evidence.

- Acceptance: record cold load, engine transfer/initialisation, input edit, recalculation, rendering, peak memory and HTML size for a representative P&L calculation fixture and 50k/100k-row datasets with linked sheets and thousands of formulas. Declare populated columns and formula distribution.
- Acceptance: compare aggregate reuse/preaggregation and worker execution. Proposed engineering targets are P&L input-to-result under 250 ms warm and no calculation-driven main-thread task over 100 ms; validate or revise with evidence before treating them as guarantees.
- Verification: record hardware, browser/engine versions, correctness totals and five warm runs. Reproduce the earlier 100k-row/two-column/1,000-SUMIFS case as a baseline; record larger-column stress cases without extrapolating capacity from row count alone.
- Verification: commit the P&L and large-data fixtures and the benchmark harness; CI runs them on every PR with the agreed thresholds (see [shared rules](HTML-OFFICE-V1.md#shared-authoring-and-quality-rules)), so a performance regression fails the build.

### T05b — Decide result and data storage from real-world workbooks

Decision update, 19 October 2026: [ADR-005](decisions/005-data-storage.md) selects compact JSON row arrays for declared dense raw-data tables, sparse records for freeform model sheets, JSON metadata, and policy A (all formula results). The [0.2 contract](../packages/data/model/FORMAT.md) is implemented at the document boundary shared by the builder, browser and range tools; normalized sparse engine state is derived. The isolated reading/editing trials and recipient checks are recorded in [the review packet](../packages/data/bench/storage/REVIEW.md). The acceptance criteria below remain the verification contract; this decision does not start T06.

Dependencies: T02, T05. Scope: M. Paths: `packages/data/bench/storage/`, a converter from XLSX to the T01 model, measurement report. Real workbooks stay outside the repository; commit only anonymised metrics and the fictional fixtures.

- Acceptance: measure at least five real workbooks of different shapes: a driver-based P&L or budget, a lookup-heavy operational model, a raw-data workbook of 50k+ rows, a scenario/financial model with NPV-style formulas, and one messy workbook built by a non-specialist. Suggested sources: the Enron spreadsheet corpus, public statistical XLSX files (for example data.gouv.fr), and anonymised user models measured locally. Record populated cells, formula cells, dependency depth and the share of formula cells in each class: references and arithmetic only (`+ - * /`, parentheses, unary minus); plus SUM/AVERAGE/MIN/MAX over ranges; plus ROUND/IF; everything else.
- Acceptance: compare three storage options on each workbook. **A:** save every formula result (the current specification). **B:** omit results for the simple class and compute them on open with a small reader-side evaluator, keeping IronCalc for everything else. **C:** save every result and also embed the small evaluator so simple input changes recalculate offline without IronCalc. For each, report HTML bytes, gzip bytes, proxy token count, the result snapshot's share of the total, evaluator code bytes and open-time compute.
- Acceptance: the evaluator, if built for B or C, must match IronCalc exactly on every simple-class cell of every workbook (full-precision doubles, blanks, errors, dates as serials, floating-point accumulation order). Any cell that depends on a non-simple cell is outside its scope. A single mismatch rules it out until fixed.
- Acceptance: run a reading test. Give an unfamiliar LLM the HTML for each option and ask for three totals and one explanation of a derived figure. Record whether it can answer without computing the values itself.
- Acceptance: assess data encoding separately from the A/B/C formula-result policy. For dense raw-data sheets, compare **per-cell JSON objects** (baseline), **compact JSON row and column arrays**, and **embedded CSV/TSV with a typed column schema**. JSON must not be judged solely from the verbose per-cell baseline. Use equivalent values and metadata in each candidate; report raw and gzip bytes, proxy tokens, parse/serialisation time, implementation/code-size cost and complete HTML size.
- Acceptance: distinguish dense imported tables from sparse freeform model sheets. Evaluate a hybrid workbook with compact table blocks for dense ranges, explicit cell/formula records for scattered inputs and calculations, and JSON metadata for sheet IDs, formats, scenarios and charts. Each range has exactly one authoritative representation; the displayed grid is derived. All blocks remain embedded in the same HTML, with no external data-file requirement.
- Acceptance: define and round-trip types and escaping for every encoding: numbers versus numeric-looking text (including leading zeros), Boolean values, absent cells/blanks versus empty text, dates, typed errors and formulas. CSV/TSV candidates require a column schema plus an explicit policy for mixed-type cells and overrides, locale-independent numeric encoding, quoted delimiters/newlines, Unicode and safe HTML embedding. Include full-precision numeric round trips and the metadata/override overhead in measurements.
- Acceptance: test range reads/writes, row/column insertion/deletion and formula-reference updates on each candidate. Give an unfamiliar LLM only the self-contained HTML and ask it to inspect types, edit a value and extend a table while preserving unrelated data; validate the resulting workbook. Compare reliability and editing simplicity alongside size, rather than selecting the smallest payload alone. HTML tables and binary/compressed payloads may be recorded as alternatives, but are not the default benchmark candidates: repeated markup and loss of direct LLM readability respectively work against the current goals.
- Decision rule: option A remains the default unless B or C shows a material benefit (proposed: at least 25% smaller total HTML, or a demonstrated need for offline input changes) together with exact conformance and no loss in the reading test. Adopting B or C reverses the "one engine" and "store all results" decisions in [ADR-003](decisions/003-html-office-and-data-runtime.md), so it must be recorded as an amendment to that ADR and the specification before T06.
- Decision rule: retain the current JSON contract until measurements justify a change; compare compact JSON arrays on equal terms with CSV/TSV. Record the selected encoding by range role, its schema and why the tradeoffs serve LLM readability/editability and portability. If it changes the canonical JSON contract, update ADR-003, the specification and the T01 model/prototype before T06; do not introduce competing live sources of truth.
- Verification: reproducible measurement script and report with workbook descriptions (not contents), tool versions and the tokenizer used; the T06 storage contract cites both the chosen A/B/C result policy and the data encodings.

Checkpoint A: typed output and licence gates pass; local-file save/reopen and both distribution modes work; code budget passes with measured editor headroom; browser evidence supports the target workload; the real-world storage decision (T05b) is recorded. If a gate fails, fix or document an explicit design reassessment before extending the product.

## Phase B: make results and manual editing reliable

### T06 — Persist calculated snapshots and identify stale work

Dependencies: T05b. Scope: M. Paths: model/cache, calculation scheduler and tests.

- Acceptance: formula results are saved as decided in T05b (by default every populated formula cell saves its typed result), with engine/version and calculation fingerprint; no rectangular position limit. Valid formula errors remain typed. Chart/pivot caches carry matching source revisions.
- Acceptance: calculation-changing edits invalidate results; formatting alone does not. A stale external LLM edit is visible on open; obsolete/failed calculations cannot publish a current snapshot. Missing snapshots never appear as zero.
- Verification: edit a precedent across sheets, reopen with no network, modify model JSON externally, and finish an older calculation after a newer edit. Check revision consistency and full-precision round trips.

### T07 — Save, copy and recover without losing edits

Dependencies: T06. Scope: M. Paths: Data persistence module, save controls and tests.

- Acceptance: direct Save uses an explicitly selected file where supported; Save a copy downloads a complete workbook. Opening directly from disk needs no installation/server. Label drafts, unsaved edits and durable saves distinctly.
- Acceptance: failures/cancellation/storage limits preserve editable work; edits during a save remain dirty. Detect disk changes before overwriting. Recovery identifies the corresponding workbook/revision and does not overwrite newer work silently.
- Verification: local-file tests with delayed/rejected writes, external modification, limited storage, reload and recovery; save during calculation and confirm stale results are not labelled current.

### T08 — Navigate and edit cells with undo

Dependencies: T07. Scope: M. Paths: virtualised grid, selection/formula controls and browser tests.

- Acceptance: keyboard/pointer navigation, one rectangular selection, cell/formula-bar editing and commit/cancel behave consistently. Large source sheets render a viewport rather than a DOM cell for every possible position.
- Acceptance: undo/redo restores canonical content and selection appropriately, recalculates through the same adapter, and persists accurately. Explain unsupported formulas with a cell error; do not execute cell strings as JavaScript.
- Verification: keyboard/browser workflows across text, number, formula and error cells; save/reopen and preservation comparison. Measure grid navigation on the large fixture.

### T09 — Copy ranges and fill formulas

Dependencies: T08. Scope: M. Paths: clipboard/fill commands and reference tests.

- Acceptance: rectangular internal copy/paste preserves supported formulas/formats and adjusts relative references; fill down/right respects absolute/mixed references. Normal text-selection copying remains available in cell editing.
- Acceptance: Excel/Markdown table paste is values-first, with explicit handling of leading zeros and ambiguous date/number locale. Unsupported clipboard formats fail visibly without partial corruption.
- Verification: mixed-reference/cross-sheet fixtures, quoted multiline tables and Markdown escaping; multi-cell undo plus save/reopen. No formula interpretation merely because imported text starts with `=`.

### T10 — Insert and delete rows/columns safely

Dependencies: T09. Scope: M. Paths: structural model commands, engine adapter and tests.

- Acceptance: row/column insertion/deletion updates formulas, names, dropdown/conditional ranges and chart/pivot sources, preserving stable sheet IDs; deleted references produce defined errors.
- Acceptance: engine reference rewrites return to canonical JSON, including dependent sheets. Each operation is undoable and survives saving without relying on binary engine state.
- Verification: before/after reference fixtures for absolute/mixed/cross-sheet ranges; remove a referenced range, undo, redo and reopen. Reuse these tests as later feature ranges are introduced.

### T11 — Organise sheets and apply the consulting theme

Dependencies: T10. Scope: M. Paths: sheet/group navigation, theme tokens and browser fixtures.

- Acceptance: sheets can be created, renamed and reordered within collapsible/reorderable Summary, Inputs/Hypotheses, Raw Data and Calculations groups; cross-sheet formulas follow renames. Calculation tabs are grey.
- Acceptance: deep-blue/white headers, light-blue/dark-blue row labels and pale-yellow/orange assumptions use semantic style roles; number/currency/accounting/date/% formats preserve typed values and locale-independent formulas.
- Acceptance: style roles take their colours and fonts from the shared Office brand theme (the Slides `charte` variables) rather than hard-coded values, so one brand theme styles decks, workbooks and Text documents. The consulting colours above are the default brand theme's values.
- Verification: save/reopen group order and collapsed state; inspect date/negative/currency/% precision, keyboard focus and selected/disabled states. Compare canonical values before/after formatting.

Checkpoint B: a user can edit, extend, undo and save a small multi-sheet model without losing formulas or unrelated data. Stale-result and concurrent-save cases pass. Recheck code size after the actual grid and persistence implementation.

## Phase C: add analytical workflows as separate slices

### T12 — Complete the agreed formula conformance suite

Dependencies: T10. Scope: M per family; split into aggregation/logic, lookup/text, and date/statistics/finance PRs. Paths: engine reference fixtures and conformance tests.

- Acceptance: every function in the specification has fixed expected scalar/range/error results, including lookup misses, blank criteria, percentile boundaries, date arithmetic and NPV timing. Test combinations and reference operations, not just function names.
- Acceptance: reference outputs have recorded provenance; unsupported behaviour is reported and tracked as a blocker. Do not silently replace errors with cached numeric values or shrink the contract.
- Verification: run the same fixtures through both distributions and the canonical-model round trip; include cycle handling and incorrect-argument tests.

### T13 — Select scenarios and validate dropdowns

Dependencies: T11, T12. Scope: M. Paths: scenarios/validation model, controls and tests.

- Acceptance: Base/Upside/Downside select distinct assumptions for one shared formula model; the selector and results survive saving without copying the entire workbook per scenario.
- Acceptance: dropdowns support static lists and cell ranges, persist definitions, and show invalid selections. Scenario/assumption changes require an available engine; no implicit offline snapshot switching is promised.
- Verification: fixed scenario totals, dependent dropdown edits, structural reference updates, undo/redo and offline load-failure behaviour.

### T14 — Add highlights and data bars

Dependencies: T11, T12. Scope: M. Paths: conditional rules, grid rendering and tests.

- Acceptance: highlights/data bars use explicit ranges, precedence, scaling and zero-axis behaviour for mixed signs; formulas/errors/blanks have defined rendering.
- Acceptance: rule creation/editing is undoable; results refresh with scenario/input changes and persist through save/reopen, without modifying underlying values.
- Verification: boundary/negative/constant ranges, overlapping rules, print view and structural range edits; measure only visible-cell rendering on the large fixture.

### T15 — Import CSV and supported XLSX content

Dependencies: T11, T12. Scope: M per format; separate CSV and XLSX PRs. Paths: import adapters, preview/report UI and fixtures.

- Acceptance: CSV and XLSX preview typed data and supported formulas before insertion; show locale ambiguity and unsupported-feature diagnostics without pretending Excel fidelity. Preserve source metadata without requiring an external path to reopen.
- Acceptance: keep data embedded and editable, restrict active/external content, and load the pinned XLSX component only for an import request. Include its licence/integrity notices and offline build path.
- Verification: quoted delimiters/multiline/Unicode/leading zeros, multiple sheets, dates, unsupported formulas and failed imports; verify no source data leaves the browser.

### T16 — Refresh an embedded source deliberately

Dependencies: T15. Scope: M. Paths: source metadata/refresh command, preview and tests.

- Acceptance: select a replacement local CSV/XLSX; preview changed columns/values and dependent impact before replacing the intended source range. Missing/renamed columns require an explicit resolution.
- Acceptance: warn about overwritten manual source edits, preserve unrelated model/scenario sheets and invalidate downstream caches correctly; refresh is undoable and source data stays freely editable.
- Verification: reordered/missing/added columns, changed row counts, cancelled refresh and save/reopen; verify no live external-file link is necessary.

### T17 — Build a basic editable pivot

Dependencies: T11, T12. Scope: M. Paths: pivot definition/aggregation, controls and fixtures.

Update, 24 October 2026: T15 is no longer a prerequisite. A pivot reads any in-workbook range or `sheet.table` (ADR-005), whether typed, pasted or written by an LLM; imported data later becomes one more source. The design is recorded in [ADR-013](decisions/013-data-pivot-tables.md).

- Acceptance: choose rows, columns, filters and SUM/COUNT/AVERAGE measures with totals; store definition, source and result revision in canonical JSON.
- Acceptance: explicit refresh follows changed source data, scenario/structural references and errors consistently; saved output is readable offline. Define collision-free ownership of the generated output range.
- Verification: known grouped totals, empty/missing categories and source refresh; edit/save/reopen the definition. Measure the large-data case; advanced fields/slicers remain deferred.

### T18 — Render charts with saved SVG previews

Dependencies: T13. Scope: M. Paths: Data chart bindings, lazy ECharts loader and browser tests.

- Acceptance: charts reference typed cell/range data and recalculate from matching revisions; number formats do not round source values. The P&L demonstrates revenue, margins and scenario comparisons.
- Acceptance: embed SVG snapshots; view/print without ECharts or network. Chart editing loads a pinned SRI-verified library, and an offline build edits without requests; preserve unrelated chart/model data.
- Acceptance: in edit mode, a chart creates its ECharts instance only when it first scrolls into view (IntersectionObserver); the others keep showing their SVG snapshot. Opening a workbook with many charts does not initialise them all.
- Verification: input/scenario change, stale/missing snapshot, failed/tampered library, structural range edits, undo and save/reopen; inspect SVG accessibility and print fidelity.

### T19 — Export selected data and report pages

Dependencies: T14, T17, T18. Scope: M per output; separate CSV and print PRs. Paths: Data export/print modules and fixtures.

- Acceptance: CSV exports selected-sheet calculated values with correct escaping/locale policy, no formulas/styles, and safe handling of formula-like text; stale/missing results require explicit resolution.
- Acceptance: selected-sheet print/PDF view supports page breaks, repeated headers, charts and legible units/formats without editor chrome. Editable HTML retains all model content; XLSX export stays deferred.
- Verification: parse exported CSV back to expected typed/display-policy values; inspect rendered multi-page PDF, negative data bars, chart SVGs and long tables. Repeat offline.

Checkpoint C: refresh → scenario → analysis/pivot/chart → save/reopen → CSV/print works on fictional fixtures. Verify all new range-bearing features under T10 structural tests, then check code size and dependency notices again.

## Phase D: prove the complete authoring and recipient workflow

### T20 — Package the usable Data skill and embedded contract

Dependencies: T19. Scope: M per workflow; separate document tooling from skill packaging. Paths: `packages/data/tools/`, `plugin/skills/html-data/`, references and package tests.

- Acceptance: range inspect/apply/recalculate/validate and standard/offline generation operate on canonical JSON with preservation checks; the embedded guide documents the complete format, errors, cache rules and compatible skill links without needing the repo.
- Acceptance: only now ship a working Data skill with the existing Slides skill; retain the plugin identity, paths/commands and release compatibility until a separate migration. Text is not shipped as a placeholder.
- Acceptance: the skill follows the [shared rules](HTML-OFFICE-V1.md#shared-authoring-and-quality-rules) rules: validated LLM output with at most two corrective retries, and valid/invalid example workbooks that double as test fixtures.
- Verification: install/extract the built plugin in a clean environment and generate/edit/validate a workbook. Inspect JSON escaping and link/version consistency; Slides commands/tests/releases still work.

### T21 — Publish the fictional P&L acceptance workbook

Dependencies: T20. Scope: M. Paths: public Data fixtures/examples and end-to-end tests.

- Acceptance: 12 actual months plus 12 forecast months, grouped sheets, consulting theme, scenarios/dropdowns, formats, conditional rules, pivot/charts and cash-flow NPV match known totals; a companion analysis area covers the entire formula suite.
- Acceptance: standard/offline HTML and CSV/print samples contain only clearly fictional public material and document their versions and measured file sizes. Do not publish scratch assessments, client themes, source paths or private reference files.
- Verification: regenerate from the skill, manually edit/extend the forecast, refresh source data, undo and save/reopen; compare expected formulas/results plus rendered output in Chrome and Edge, with offline reading in Safari/Firefox.

### T22 — Run the blind LLM test and release readiness review

Dependencies: T21. Scope: M. Paths: validation report, CI checks and release notes.

- Acceptance: give an unfamiliar LLM only the generated HTML and user task; it explains the model, changes an assumption, adds a formula and updates a chart while preserving unrelated data. Record mistakes and repairs; do not count an informed internal agent as a blind test.
- Acceptance: full Chrome/Edge workflows, Safari/Firefox viewing, file saving/recovery, integrity failures, offline operation, code budget, large-data benchmark and dependency-notice checks pass. Document remaining limitations and reproducible measurements.
- Verification: repeat from a clean checkout and extracted plugin; attach evidence and human review to the release PR. A passed local suite alone does not establish browser parity, Excel conformance, or blind-test success.

## Risks and stop conditions

| Risk | Required response |
| --- | --- |
| Typed result getter missing from published IronCalc binding | Prove a maintained adapter/binding before charts or cache fidelity; never parse display strings |
| Compiled dependency licence closure or integrity provenance unresolved | Do not distribute that build until resolved |
| Editor exceeds standard code budget | Measure by component, simplify or defer an explicitly agreed feature; do not quietly raise the limit |
| Large sheets freeze the UI or formula scans dominate | Benchmark worker/preaggregation and rendering; publish the real workload boundary |
| Canonical model, engine and saved results diverge | Stop dependent features until revision, rewrite and round-trip tests pass |
| Repository rename breaks installation/release discovery | Keep existing filenames/skill identity, use canonical new URLs and verify old redirects; migrate plugin identity separately |
| PDF or HTML-only LLM workflow fails | Fix the document contract/rendering and repeat the failing acceptance task before claiming V1 readiness |

No further product question is currently pending. Technical validation may expose a concrete tradeoff requiring a documented scope decision; it must not silently remove an approved requirement.
