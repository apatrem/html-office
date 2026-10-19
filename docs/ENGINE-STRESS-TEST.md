# Engine stress test for Text and Data

Status: initial assessment of 16 October 2026, decisions of 16–18 October, and a reproducible remeasurement on 18 October 2026. This checks the [Text specification](HTML-TEXT-V1.md) and [Office specification](HTML-OFFICE-V1.md) for LLM readability, weight and CDN use. Library-only sizes and proxy token counts are not release benchmarks or proof that the complete editor fits its budget.

## Method and reproduction

The committed [assessment harness](../tools/engine-assessment/README.md) contains pinned direct and transitive dependencies, exact bundle entries/options, fictional input fixtures, compression settings and [raw results](../tools/engine-assessment/results.json). It is development-only and adds no dependency to generated files or the plugin.

```sh
npm ci --prefix tools/engine-assessment --ignore-scripts
npm --prefix tools/engine-assessment test
npm --prefix tools/engine-assessment run measure -- --check
```

- Build with esbuild 0.28.2: browser platform, ES2022, bundled/minified ESM. Individual entries retain all exports; the combined ProseMirror entry retains each package namespace. These are conservative library probes, not minimal application builds. The assessment removes legal comments; product builds must include required notices in their code budget.
- Compression is local Node gzip level 9 / Brotli quality 11. Node/zlib versions are recorded; compressed figures can vary with those versions and are advisory in CI. They are **not measured CDN transfer sizes**.
- Token counts use `gpt-tokenizer` 4.0.3 with `o200k_base`, a proxy rather than a guarantee for another model. The exact Markdown/HTML snippets and deterministic raw-data recipe are committed.
- CI checks fixture/script/lockfile hashes, package versions, raw bundle bytes/hashes and tokens. It detects a change; it does not substitute for future product performance tests.
- The original 16 October entry points and samples were not retained: the 270,031-byte full-stack estimate and 157/336-token sample are historical observations, not reproduced here. The tables below use the committed 18 October fixtures and results.

## Text editor

Keep ProseMirror as the chosen candidate for its schema, transaction/history facilities and measured footprint. **Canonical HTML is our application contract, not an automatic property of the editor.** ProseMirror uses its own internal document tree; our parser/serialiser must preserve the authoritative HTML and pass T02's unchanged/targeted-edit tests. Lexical also supports HTML import/export; it has not been shown unsuitable merely because it has internal editor state. This correction does not change the selected candidate or waive the round-trip gate.

| Bundle (minified, retaining all exports) | Bytes |
| --- | --- |
| prosemirror-model 1.25.12 | 46,376 |
| prosemirror-state 1.4.4 | 65,753 |
| prosemirror-transform 1.12.2 | 57,100 |
| prosemirror-view 1.42.6 | 154,235 |
| prosemirror-tables 1.8.5 (with its dependencies) | 217,889 |
| **Combined stack**, also commands, keymap, history, inputrules, dropcursor, gapcursor and schema-list | **270,374** (83,854 gzip in this run) |

Per-package figures include shared dependencies and do not add up to the combined build. All package versions and exact namespace-export entries are in the harness manifest/lockfile and results.

This probe consumes **54.1%** of the 500,000-byte budget, leaving 229,626 bytes before our schema, source-preserving serialiser, UI, comments, numbering, Markdown conversion, paste mapping, CSS and notices. The actual editor must still be measured; this is not proof of sufficient headroom.

Decisions:

- Keep ProseMirror **embedded** for reliable prose editing on a fresh offline opening. A CDN-loaded editor could continue editing locally after successful loading in that session; connectivity is needed for the initial load when the component is unavailable, not for every edit. Browser cache is not an offline guarantee.
- Measure budget and round-trip fidelity from T02 ([Text plan](HTML-TEXT-PLAN.md)).

## Print and pagination

| Feature | Chrome/Edge assessment |
| --- | --- |
| `@page` margin boxes: headers, footers, `counter(page)` | Supported since Chrome 131 |
| `target-counter()`: target-page numbers for contents/cross-references | Not available for the required printed output in the assessed native path |
| `float: footnote`: page-foot notes | Not available in the assessed native path |

Browser evidence comes from the linked Chrome/Chromium sources and the earlier browser probe, not this size/token harness. A parser accepting a CSS expression is not proof that it prints correctly. Likewise, margin boxes do not establish an in-document paginated preview matching PDF; that remains a Text print feasibility gate.

The assessed paged.js polyfill is about 491 KiB before our editor. It is an optional future paginator candidate, not an embedded standard-mode dependency or a validated solution to every wrapping/table case.

Decisions:

- **Table-of-contents page numbers are outside Text V1**, on the [roadmap](HTML-TEXT-V1.md#roadmap-after-v1). Contents entries remain links; ordinary page-number footers stay in V1.
- Footnotes print as endnotes in V1.
- If a paginator is adopted later, assess pinned on-demand loading for print and embedding in offline builds. Live paginated editing is a separate scope decision.

## LLM readability

| Committed sample | Markdown | Canonical HTML snippet | Ratio |
| --- | --- | --- | --- |
| Heading, prose/footnote/cross-reference, 3-item list, 3-row table with total, second heading | 121 tokens | 253 tokens | **2.09×** |

The snippets express the same narrative. HTML additionally carries stable IDs and footnote/cross-reference/total-row semantics; this is not a lossless representation-equivalence test. One table-heavy example cannot predict every report's token ratio. HTML remains canonical for [ADR-004's](decisions/004-html-text-format-and-editor.md) reasons; section tooling and Markdown-first drafting reduce how much markup an LLM must rewrite.

| Deterministic raw-data sample | CSV | Addressed per-cell JSON | Ratio |
| --- | --- | --- | --- |
| 1,000 data rows × 8 columns, plus headers | 47,697 bytes, 25,583 tokens | 190,001 bytes, 69,649 tokens | **2.72× tokens, 3.98× bytes** |

JSON stores addressed `{value: …}` cells; CSV omits addresses and requires an import typing policy. Both exclude the full workbook, styles and saved formula results. Do not extrapolate these counts into a claimed 100,000-row workbook footprint. [T05b](HTML-DATA-PLAN.md#t05b--decide-result-and-data-storage-from-real-world-workbooks) measures real shapes and compares typed/columnar storage before the model is fixed.

## Data calculation engine

Keep the pinned IronCalc 0.9.0 prototype baseline.

- **Local sizes:** WASM 2,089,699 raw bytes, 716,788 gzip and 541,861 Brotli in this run; JavaScript wrapper 69,762 raw bytes. The approved on-demand CDN/digest path keeps it out of standard-mode embedded code. CDN compression settings and actual transferred bytes may differ.
- **Typed results:** the assessed binding has content/type/formatted getters but no direct typed-value getter. T02 still needs to prove full-precision result access and any custom binding before product integration. Measuring assets does not test calculations or licence closure.

Alternatives from the original assessment: HyperFormula 3.5.0's GPL/commercial distribution was set aside under the proposed permissive-only policy; Formula.js provides functions, not a workbook parser/dependency engine (142,226 bytes in this library probe); fast-formula-parser 1.0.19 has an old release history. This harness does not retest their formula conformance or maintenance status.

A small reader-side evaluator remains an experiment in [T05b](HTML-DATA-PLAN.md#t05b--decide-result-and-data-storage-from-real-world-workbooks); changing the one-engine/saved-result decisions needs its explicit ADR amendment.

## ECharts

| Build | Raw minified bytes | Local gzip bytes |
| --- | --- | --- |
| Shipped `echarts.min.js` 6.1.0 | 1,121,883 | 368,202 |
| Custom bar, line, scatter, custom; grid, legend, tooltip, mark line, dataset; SVG renderer | 610,417 | 208,168 |

The custom build reduces **the ECharts component** by 45.6% raw / 43.5% gzip in this run. It does **not** halve complete offline files: those also contain editor code, data, SVGs and, for offline Data, IronCalc. Measure whole-file savings separately. Local compressed sizes do not guarantee CDN transfer savings.

Adoption would require a versioned distribution source, integrity digest and regression checks for every supported chart type. [B-04](PLAN.md#ideas-backlog-not-approved) remains unapproved; no shipped chart build changes in this assessment.

## XLSX import

The original assessment flagged the old npm `xlsx` 0.18.5 package and its published advisories, with current SheetJS builds distributed separately. Data T15 must pin the chosen component/source/version/digest/licence before implementation. XLSX import is not exercised by this harness.

## Sources

- [Committed harness, commands and limitations](../tools/engine-assessment/README.md)
- [ProseMirror document model](https://raw.githubusercontent.com/ProseMirror/website/master/markdown/guide/doc.md)
- [Lexical HTML import/export implementation](https://github.com/facebook/lexical/blob/main/packages/lexical-html/src/index.ts)
- [Chrome print margins](https://developer.chrome.com/blog/print-margins)
- [Chromium issue 40529223](https://issues.chromium.org/issues/40529223)
- [IronCalc WASM binding](https://github.com/ironcalc/IronCalc/blob/main/bindings/wasm/src/lib.rs)
