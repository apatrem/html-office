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
