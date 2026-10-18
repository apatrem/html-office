# ADR-003 — HTML Office and the Data runtime

Status: accepted product direction on 15 October 2026; IronCalc selection is provisional pending the gates in the [implementation plan](../HTML-DATA-PLAN.md). Data is not yet implemented.

## Context

Slides established the single-file pattern: readable content, an embedded editor and guide, and saved SVG charts. Data must add spreadsheet modelling and analysis while keeping LLM read/write access and portability as its first drivers. A complete calculation engine does not fit the standard-mode embedded-code ceiling. The user approved the public repository rename to html-office and a planning branch/PR; this does not authorise merging the existing hardening PR or a plugin identity migration.

## Decision

Keep the existing repository/history and MIT project licence under html-office. Retain the html-slides skill identity, format, commands and release filenames. Plan focused Slides/Data/Text skills in one eventual plugin, shipping each only when implemented. Keep independent document models and runtime builds; share theme/packaging/persistence code only when implementations justify it. Defer folder moves and plugin-identity changes until compatibility can be verified, and land the pending Slides hardening before that migration.

Make readable, versioned workbook JSON authoritative. Preserve formula strings and full-precision typed inputs/results. Engine state is disposable; a binary snapshot cannot be the sole source. Both the browser and skill operate on the same model, including structural reference rewrites and saved cache revisions.

Use IronCalc as the one provisional calculation engine. Standard documents embed a reader/editor below 500,000 bytes of application code, with saved formula values and chart SVGs. Load pinned, integrity-checked IronCalc on the first calculation-changing edit; load ECharts and the XLSX component only when needed. After loading, calculation is local. Offline builds embed the same dependencies and may be larger. Do not depend on HTTP caches for offline reopening.

Store all populated formula results initially, regardless of formula simplicity or cell position. Snapshots support offline viewing, not arbitrary recalculation. Require an available engine before accepting calculation-changing browser edits; identify externally invalidated results as stale. A 1,000-row by 100-column cutoff would ignore dependency structure and is not justified by current measurements. Precomputed scenario snapshots are optional future work.

## Alternatives considered

- Always embed IronCalc: demonstrated in a roughly 2.81 MB engine-only HTML, exceeding the standard code budget. Keep this as the offline distribution mode.
- A custom small evaluator plus optional function packs: possible, but makes us responsible for parser, date/error semantics, dependencies and reference rewrites. Two unrelated engines risk different answers. Do not pursue for V1.
- xlsx-calc: excluded on maintenance grounds. Calx failed required probes; the tested Univer/Formualizer footprints did not demonstrate a smaller complete replacement. These assessments do not prove those projects unsuitable for every use.
- Browser Python: adds an interpreter without supplying spreadsheet semantics. Keep Python outside the generated runtime.
- Full spreadsheet UI/Excel round trips: larger scope than required. Build a bounded editor; import supported data/formulas with diagnostics and defer XLSX export.

## Consequences and validation

Standard HTML can open and display saved work offline, but needs a first engine load to recalculate. Offline HTML guarantees engine availability at a larger file size. Formula results, formatting and snapshot revisions must remain separate and precise. CDN requests reveal a network request to a third party, although workbook data is not uploaded.

Integration must prove typed result access (the assessed binding exposes formatted values rather than a direct typed-result getter), complete model round trips, formula/reference semantics, licensing of compiled dependencies, browser performance, and the code budget. The first acceptance artifact is a fictional P&L; the final format must pass the unfamiliar-LLM HTML-only test. See the [specification](../HTML-OFFICE-V1.md) for the complete agreed scope. No engine benchmark or licence claim here is a release guarantee. The [engine stress test](../ENGINE-STRESS-TEST.md) of 16 October 2026 rechecked IronCalc 0.9.0 (still no typed-value getter), the alternatives and the ECharts and XLSX dependencies.

Sources: [IronCalc source/licences](https://github.com/ironcalc/IronCalc), [WASM binding](https://github.com/ironcalc/IronCalc/blob/main/bindings/wasm/src/lib.rs), [SheetJS formula/value representation](https://docs.sheetjs.com/docs/csf/cell/), [GitHub repository rename behaviour](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository).
