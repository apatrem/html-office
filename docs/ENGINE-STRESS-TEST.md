# Engine stress test for Text and Data

Status: assessment of 16 October 2026, with the decisions taken from it on 16–18 October 2026. It checks the engine choices in the [Text specification](HTML-TEXT-V1.md) and the [Office specification](HTML-OFFICE-V1.md) against three criteria: readability by an LLM, weight, and use of a CDN. Measurements are one-off and machine-independent (sizes) or indicative (tokens); they are not release benchmarks.

## Method

- Sizes come from npm packages bundled with esbuild 0.28.2 (`--bundle --minify --format=esm`). Compressed sizes use `gzip -9` and `brotli -q 11`.
- Token counts use `gpt-tokenizer` 4.0.3 (o200k encoding) as a proxy. Claude's tokenizer differs, so treat ratios as indicative and absolute counts as unreliable.
- Browser support was checked against Chromium's issue tracker and Chrome's developer documentation (sources below).
- Versions: ProseMirror packages as listed below, `@ironcalc/wasm` 0.9.0, `echarts` 6.1.0, `@formulajs/formulajs` 4.6.1. For comparison, the Slides engine (`engine.js`) is 366 KB in 0.7.1.

## Text editor

ProseMirror remains the right choice: it is MIT-licensed, it is the only candidate that keeps semantic HTML as the canonical content, and TipTap is built on it anyway. Lexical would make its own JSON model canonical.

| Bundle (minified) | Bytes |
| --- | --- |
| prosemirror-model 1.25.12 | 46,376 |
| prosemirror-state 1.4.4 | 65,753 |
| prosemirror-transform 1.12.2 | 57,100 |
| prosemirror-view 1.42.6 | 154,235 |
| prosemirror-tables 1.8.5 (with its dependencies) | 217,889 |
| **Full stack**: the above plus commands, keymap, history, inputrules, dropcursor, gapcursor and schema-list | **270,031** (84,120 gzip) |

Per-package figures include shared dependencies, so they do not add up to the full stack.

The full stack uses **54% of the 500,000-byte code budget** before any Text code. That leaves about 230 KB for the schema, serialiser, editor UI, comments, numbering, the Markdown view, paste mapping and CSS: feasible, but tight. The Slides engine alone is larger than that today.

Decisions:

- Keep ProseMirror **embedded** in the standard build. Loading it from a CDN would save about 270 KB per file, but every edit would then need a network connection, and offline prose editing is a core requirement.
- Measure the budget per component from task T02, not first in T03 ([Text plan](HTML-TEXT-PLAN.md)).

## Print and pagination

| Feature | Chrome/Edge support |
| --- | --- |
| `@page` margin boxes: running headers, footers, `counter(page)` | Yes, since Chrome 131 |
| `target-counter()`: page numbers in a table of contents or cross-reference | No. The Chromium request has been open since 2017; a July 2026 design document has no owner |
| `float: footnote`: notes at the foot of each page | No |

The paged.js polyfill would provide the missing features, but its minified build is about 491 KB, close to the whole code budget, and its last release is 0.4.3 (2024).

Decisions:

- **Table-of-contents page numbers are removed from Text V1** and listed on the [roadmap](HTML-TEXT-V1.md#roadmap-after-v1) (18 October 2026). The table of contents prints as links. Running headers, footers and page numbers stay in V1.
- Footnotes keep printing as endnotes in V1, as already specified.
- If paged.js is used later, load it on demand for print only, never in the standard build.

## LLM readability

| Sample | Markdown | Canonical HTML subset | Ratio |
| --- | --- | --- | --- |
| Short report section: heading, paragraph with footnote and cross-reference, 3-item list, 3-row table with total, second heading | 157 tokens | 336 tokens | **2.14×** |

This table-heavy sample sits above ADR-004's 1.3–2× estimate. Mostly prose would be closer to the low end. HTML stays canonical for the reasons in [ADR-004](decisions/004-html-text-format-and-editor.md); the cost is limited by section tooling and by generating in Markdown first, then converting to the subset ([Text specification](HTML-TEXT-V1.md#size-and-llm-workflow)).

| Sample | CSV | Per-cell JSON | Ratio |
| --- | --- | --- | --- |
| 1,000 rows × 8 columns of raw data | 50,023 bytes, 29,938 tokens | 163,135 bytes, 74,939 tokens | **2.5× tokens, 3.3× bytes** |

At that ratio, a 100,000-row sheet would be about 16 MB of JSON instead of 5 MB of CSV (extrapolated). Data task [T05b](HTML-DATA-PLAN.md#t05b--decide-result-and-data-storage-from-real-world-workbooks) compares per-cell JSON with a columnar typed block on real workbooks before the model is fixed.

## Data calculation engine

IronCalc remains the right choice.

- **Version:** `@ironcalc/wasm` 0.9.0 is still the latest release. Its WebAssembly binary is 2,089,699 bytes raw, 716,801 bytes gzip and 541,861 bytes Brotli, plus a 69,762-byte JavaScript wrapper. Loading it on demand from a pinned CDN with a verified digest, as specified, keeps it out of the standard code budget.
- **Typed results:** the binding exposes `getCellContent`, `getCellType`, `getFormattedCellValue`, `toBytes`/`fromBytes` and `applyExternalDiffs`, but **no typed-value getter**. Task T02 remains a blocker and should plan for a small custom binding.

| Alternative | Finding |
| --- | --- |
| HyperFormula 3.5.0 | GPL-3.0 or a commercial licence: excluded |
| formula.js 4.6.1 | MIT, about 140 KB minified, but functions only: no parser, references or dependency graph. Using it means building the small evaluator ADR-003 rejected |
| fast-formula-parser 1.0.19 | No release since 2023 |

The idea of a small reader-side evaluator for simple formulas (arithmetic, SUM) instead of, or in addition to, saved results is tested on real workbooks in [T05b](HTML-DATA-PLAN.md#t05b--decide-result-and-data-storage-from-real-world-workbooks).

## ECharts

| Build | Minified | gzip |
| --- | --- | --- |
| Full `echarts.min.js` 6.1.0 (current) | 1,121,883 | 369,270 |
| Custom: bar, line, scatter and custom charts; grid, legend, tooltip, mark line and dataset components; SVG renderer | 611,639 | 209,212 |

A custom build would roughly halve the offline builds and the CDN transfer for all three products. It must then be self-hosted with an integrity digest, for example through jsDelivr's mirror of this repository. Recorded as backlog item [B-04](PLAN.md#ideas-backlog-not-approved); not approved.

## XLSX import

The obvious library, SheetJS, stopped publishing to npm at `xlsx` 0.18.5. That version has published security advisories, and current builds are distributed from SheetJS's own CDN. Data task T15 must name its component, source, version, integrity digest and licence before work starts.

## Sources

- [Chrome: add content to page margins when printing (Chrome 131)](https://developer.chrome.com/blog/print-margins)
- [Chromium issue 40529223: cross-references from CSS Generated Content for Paged Media](https://issues.chromium.org/issues/40529223)
- [IronCalc WASM binding](https://github.com/ironcalc/IronCalc/blob/main/bindings/wasm/src/lib.rs)
- npm registry metadata for the packages above, read on 16 October 2026
