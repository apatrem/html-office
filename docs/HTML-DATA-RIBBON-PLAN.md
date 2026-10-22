# HTML Data ribbon assessment and implementation

Current checkpoint, 21 October 2026: after the R04 report the user chose a **lighter fork of the actual IronCalc toolbar on Preact** with its complete formatting features. The design is recorded in [ADR-010](decisions/010-manual-formatting-and-ironcalc-toolbar.md); R05 below is the spike, followed by production tasks F01–F06. The native ribbon remains the working default until F04. Import and T15–T22 remain paused. R01–R04 below are historical context.

Approved direction: 20 October 2026. The user requests a ribbon-based interface familiar to Excel users, asks for an assessment plan, then authorises implementation and resumption of the remaining Data plan. This replaces the earlier pause. Existing portability, JSON, engine, licence, code-size and performance requirements remain in force.

## R01 — Assess reuse before selecting an implementation

Compare (A) extracting/adapting IronCalc's actual toolbar and (B) a small native HTML ribbon using our existing commands. Pin the upstream source revision and dependency versions. Measure production minified raw JavaScript and CSS including peer runtimes, not just the upstream library bundle or compressed transfer size. Record any stubs or excluded integration work; a lower bound may reject an option but cannot prove it ready. Inspect licence declarations and the command/format/theme interfaces, lazy-engine coupling and accessibility/responsive behaviour.

Acceptance: a reproducible assessment records bytes, dependency and adapter requirements, expected familiar interaction, and a recommendation. The selected solution must leave the complete standard HTML below 500,000 raw application-code bytes; retain headroom for remaining V1 features. No runtime dependency is adopted merely to run the experiment.

Verification: reproduce measurements from pinned source and lockfile; distinguish measured facts from estimates. Review before merging the decision. Paths: isolated `tools/ribbon-assessment/`, report and ADR. Scope M.

## R02 — Deliver a familiar ribbon for existing commands

Implement the selected approach in a separate increment. Use labelled tabs/groups, quick-access save/undo/redo, a compact formula bar, and sheet navigation below the grid. Group existing commands under Home, Formulas, Data and View/File as appropriate; do not show inert buttons for unimplemented features. Keep scenario and selected-cell dropdowns readily accessible. Preserve shared branding and the existing canonical edit, formatting, history, save and recovery handlers.

Acceptance: the ribbon replaces the wall of controls, leaves more room for cells, uses keyboard-accessible tabs with arrow/Home/End navigation, and adapts to narrow widths without horizontal page overflow. Users can discover every implemented command; state and focus survive redraws. Opening/formatting still makes no engine requests. Ribbon state is presentation only and does not change workbook data or its calculation fingerprint.

Verification: browser tests cover tab navigation, format/edit/undo/retry/save/reopen, busy/cancel states and offline operation; inspect 320/768/1024/1440px output and accessible names/focus. Run existing suites plus code-size/P&L gates and independent review. Refresh the usable local test artifact. Paths: ribbon module/CSS, HTML shell, tests. Scope M per slice; keep markup/layout separate from any new workbook behaviour.

## R03 — Integrate the remaining roadmap

Place new conditional-format, import/refresh, pivot/chart and export commands into the appropriate ribbon groups as their features become usable. Preserve the T14–T22 acceptance criteria and independent review/CI gates. Do not introduce placeholders or silently remove approved functionality. Update the embedded guide and final fictional acceptance workbook as each feature lands.

No additional product question is needed to start. A concrete incompatibility requiring a budget or scope change must be raised before changing the agreed requirements.

## Assessment results and CDN alternative

The reproducible comparison is recorded in [the assessment report](../tools/ribbon-assessment/README.md), with pinned source, dependency lockfile and machine-readable measurements. Upstream source revision: `297553dc3a37ec6b0f4821055220e3d26c4ac6a1`.

| Option | Measured raw code | Findings / decision |
| --- | ---: | --- |
| Existing Data application before ribbon | 324,414 bytes | Complete standard P&L application, including the prototype controls. |
| IronCalc toolbar extraction | 390,411 bytes (367,698 JS + 22,713 CSS) | Includes React/React DOM and runtime peers. Size-only lower bound: WASM helpers stubbed; command adapters and complete notices excluded. Adding it to the existing host gives 714,825 bytes before removing old controls. Straightforward embedded reuse exceeds the 500,000-byte ceiling. |
| Native ribbon implemented for our commands | 331,613 bytes for the complete standard P&L application | A 7,199-byte increase over the baseline. Home/Data tabs, grouped commands, quick-access save/history, compact formula bar and bottom sheet groups; no new runtime dependency. P&L warm maximum 48.8 ms in the local receipt. |
| Ribbon loaded lazily from a CDN | Not measured or implemented | Retained as an option if richer editing later justifies it. The embedded-code ceiling does not itself rule this out. Requires a separate integrated size, latency, security, licence and offline assessment. |

The pinned IronCalc UI is a horizontally scrolling toolbar rather than Excel-style tabbed ribbon navigation. Reusing it would still require mapping its callbacks and formatting/theme concepts to our canonical commands, hiding unsupported actions, decoupling WASM helpers from calculation-engine initialization, and addressing keyboard/resize issues identified in the source inspection. Runtime package declarations are MIT/ISC and IronCalc offers MIT/Apache-2.0; licensing was not the rejection reason, and a completed redistribution/notice audit remains necessary before reuse.

The implemented native ribbon passes focused standard/offline tests for keyboard tabs, overflow reachability, resize, engine-free formatting, scenario/history, saved reopen and bounded print viewport. It is not a promise of Excel feature parity. The footprint/performance receipt is [ribbon-pnl-results.json](../packages/data/bench/ribbon-pnl-results.json).

### Optional CDN editing ribbon

The user explicitly confirmed on 20 October 2026 that **using a CDN for the editing ribbon is an available option if needed**. Keep this alternative available rather than treating all external UI code as prohibited. It does not change the current native implementation.

A future richer ribbon could be fetched only when the user enters editing, while viewing saved data/results/charts requires no ribbon request. Pin an immutable version and verify executable/CSS integrity before use; package dependencies into a verified bundle or verify the complete dependency closure rather than trusting an unchecked module graph. Keep existing canonical command adapters, readable document data and history/recovery semantics. Failed or unavailable loads must leave the document readable and preserve attempted edits with a clear retry path.

This moves code outside the standard embedded budget, but does not remove download, parsing, integration, accessibility or licence costs. Browser caching may reduce later transfers but cannot guarantee availability or eliminate the first download for each browser/cache state. The 115,378-byte gzip figure in the extraction probe is transfer information for the lower-bound JS/CSS measurement, not a measured complete CDN integration or first-edit latency. The complete adapter/runtime/notices and any real helper payload still need measurement.

Standard mode could require a connection for the first ribbon load. `--offline` must embed the same pinned editing assets and notices so editing remains available without a connection; its larger size is allowed under the existing offline policy. Preserve an immediately usable lightweight editing path where practical, or explicitly assess any change to the current engine-free formatting behaviour before adopting a mandatory remote ribbon.

## R04 — Functional IronCalc toolbar and delivery assessment

Status: assessment completed on 21 October 2026; delivery choice remains open. Results and limitations are in [the functional assessment report](HTML-DATA-TOOLBAR-ASSESSMENT.md), tracked in [issue #38](https://github.com/apatrem/html-office/issues/38), ahead of any delivery selection. The user prefers IronCalc's appearance and requests this assessment as a separate task. **115 kB compressed is not itself a reason to reject CDN delivery.** The existing extraction is a size-only lower bound with throwing helper stubs, not a working toolbar. This task must produce functional evidence before recommending a production choice.

Compare these three candidates on the same fictional P&L workbook and supported command set:

| Candidate | Prototype / comparison required |
| --- | --- |
| A — Actual IronCalc toolbar, lazy CDN | Adapt the pinned upstream toolbar, package its complete runtime dependency closure, and load it on explicit editing activation. Use immutable assets with executable/CSS integrity verification. Distinguish local HTTP simulation from an actual CDN measurement. |
| B — Our lightweight implementation | Use the current native ribbon as the measured baseline; provide a bounded visual/interaction prototype closer to the preferred IronCalc toolbar. Identify what can match through CSS/layout and what would require new components. Do not call the existing ribbon a completed visual replica. |
| C — Actual IronCalc toolbar, compressed inside HTML | Reuse A's functional toolbar and adapters, storing compressed assets inside the file and decoding locally. Include loader, compression encoding, notices, integrity verification, browser support and save/reopen behavior in the measurement. No ribbon network request is allowed. |

The standard-mode embedded-code ceiling remains 500,000 bytes. Report stored HTML bytes and decoded executable/CSS bytes separately; compression does not silently redefine the existing raw application-code accounting. A budget interpretation or exception, if needed for C, belongs in the user decision. Offline distribution may be larger under the existing policy. Readable canonical workbook data and the embedded LLM guide must remain directly readable rather than compressed with the UI.

### R04a — Working upstream command path

Dependencies: completed R01–R02 and T14. Scope M, isolated assessment tools and a small command adapter.

- [x] Pin source, lock dependencies and replace every throwing probe helper with real behavior; record local upstream patches and complete redistribution notices.
- [x] Wire supported actions through the existing canonical commands, history and recovery. Verify undo/redo, supported number formats and conditional-format dialog entry, with selection state reflected in the toolbar. List unsupported commands explicitly and hide or visibly disable them; no fake handlers or new formatting schema merely to make the probe look complete.
- [x] Demonstrate editing, scenario recalculation and save/reopen on a usable fictional workbook. Formatting must not initialize the calculation engine; any unavoidable coupling is a reported blocker, not a hidden requirement change.

Verification: focused adapter/helper tests and real-browser edit/history/save/reopen checks. Archive pinned source, reproducible build instructions, supported-command matrix and a runnable HTML sample. Checkpoint: establish functional feasibility before drawing conclusions from bundle size.

### R04b — Two delivery paths for the same upstream toolbar

Dependency: R04a. Scope M, loaders, isolated build variants and browser checks.

- [x] Produce A and C using the same adapter and asset revision, plus an embedded `--offline` variant for A. Viewing the standard document must not request toolbar assets. Test activation from a local `file://` HTML, including CORS and integrity behavior.
- [x] Test first load, cached reopen, disconnected startup, blocked/corrupt assets and retry. A failure leaves the workbook readable, preserves pending edits and provides a clear recovery/fallback path. Offline files must edit with zero network requests; explicitly record compression API support/fallback limits.
- [x] Verify save-copy and reopen retain the chosen prototype's assets/configuration and behavior. Include JS, CSS, peers, real helpers, adapters, loaders and required notices in all size totals.

Verification: browser request logs and integrity/failure tests for both distributions. Record actual transfer bytes separately from gzip/Brotli estimates, alongside asset hashes and the test serving environment. Do not publish a production CDN endpoint or replace the default editor as part of this experiment.

### R04c — Lightweight visual alternative

Dependencies: R04a's command matrix; can precede R04b if useful. Scope M, assessment-only native markup/CSS and interaction checks.

- [x] Provide a comparable usable sample showing how closely a lightweight implementation can match the preferred IronCalc appearance for the same supported actions.
- [x] Verify keyboard focus/menu operation, labels and overflow/resize at narrow and desktop widths; compare those same interactions with the upstream prototypes.
- [x] Record added code/dependencies, components still requiring implementation, and ongoing maintenance of a replica versus the upstream extraction and patches.

Verification: screenshots at 320/768/1024/1440px and focused browser flows. Preserve the current production ribbon while the comparison remains open.

### R04d — Evidence report and user decision

Dependencies: R04b and R04c. Scope S, report and sample links.

- [x] Publish one comparison table covering complete HTML/stored/decoded code size, compressed payload plus encoding/loader overhead, first-edit and cached latency, parsing/decompression/main-thread work, network/offline behavior, supported actions, accessibility, licences and maintenance. Use identical workbook/browser/hardware, disclose cache/network conditions and repeated-run ranges; distinguish measured results from estimates.
- [x] Supply reproducible commands and three clearly labelled usable HTML samples, a recommendation with limitations, and independent review of the functional prototypes. Run the existing correctness/code-size/P&L gates on any proposed production-path change; do not weaken them to make a candidate pass.
- [x] **Stop for the user's choice between A, B and C.** Record a new decision only after that choice; do not change the shipped default, reinterpret the size ceiling, or resume import automatically.

Completion means decision-ready evidence, not adoption of a preferred candidate. ADR-009 remains the current implementation record while this selection is reopened.


## R05 — Preact fork spike (C-léger 1)

Status: spike completed on 21 October 2026; see [the spike report](HTML-DATA-PREACT-SPIKE.md). Recommendation: Preact for F04. Assessment tooling only; production Data sources and gates stay unchanged.

Build the pinned IronCalc toolbar (`297553dc3a37ec6b0f4821055220e3d26c4ac6a1`) against `preact/compat` instead of React, replacing i18next with a static dictionary of the keys actually used and `lucide-react` with build-time SVG icons. Include the toolbar and the right-drawer panels it opens or ADR-010 requires: cell styles (catalogue, custom-style editor), themes (list, preview, editor) and regional settings. Built-in themes/locales/time zones that upstream reads from WASM are copied as static data. Apply ADR-010 patches: add **Centre across selection**, hide merge, remove custom number formats, keep R04's accessibility/capability patches.

- Measure raw/gzip JS and CSS per component and per dependency, with the complete notice text. Compare with R04's React build (395,103 bytes) and project the standard P&L total against the 750,000-byte ceiling.
- Re-run R04's functional/failure browser cases on an embedded Preact variant; record every React-19/`preact/compat` incompatibility and the patch or workaround used.
- Panels may use a recording host stub where ADR-010 model features do not exist yet; record which callbacks are wired and which only record intents.
- Decision gate: confirm Preact for F04, or fall back to a framework-free port if compatibility or size fails. Report to the user before production migration.

## Production tasks after R05

Each task is a separate reviewable increment with the existing unit/browser/format/P&L gates and independent review. Paths are indicative.

- **F01 — Model and contract** (implemented on `feature/data-format-model`: F01a rename and ceiling, F01b schema and validation, F01c structural relocation and history). `cellStyle` replaces `role` (fixtures rewritten), cell/row/column `style`, dimensions, style-only cells, `namedStyles`, `link`, colour/theme references, charte slot tokens, enriched number-format presets. Validation, history/recovery round trips, structural relocation of row/column styles and internal links, embedded guide update, and the 750,000-byte Data ceiling in build/bench gates.
- **F02 — Rendering** (blocked by cross-plan S01: Data styling scope). Layer resolution, fonts, theme colours with tint, borders with shared-edge rule, alignment, `centerContinuous`, bounded text overflow, variable row/column sizes in the virtual grid, print. Viewing stays engine-free; large-sheet navigation gates unchanged.
- **F03 — Commands.** Formatting commands with the 50,000-cell guard, command-time auto-fit, resize by drag/keyboard, painter, clear formatting, links and popover, clipboard/fill carrying formatting.
- **F04 — Interface migration** (replaced by cross-plan U04 after the editor-shell design U01–U03). Embedded Preact toolbar behind a deliberate command/state API (replacing R04's source injection), file bar menus, context menus, scenario selector and sheet tabs; remove the tabbed ribbon and replace its tests.
- **F05 — Panels.** Cell-style catalogue and editor, theme picker/editor writing the workbook charte, regional settings.
- **F06 — PNG.** Model-generated SVG of the selection rasterised to PNG, stale-result band and size limits.

T15 import acceptance gains ADR-010 conversions: merges to `centerContinuous` or unmerge, number-format codes to presets, diagonal borders and unsupported alignment reported in diagnostics.
