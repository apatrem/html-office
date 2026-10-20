# HTML Data ribbon assessment and implementation

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
