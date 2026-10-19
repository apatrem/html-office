# HTML Data Phase A implementation and assessment

Status, 19 October 2026: T01–T04 implemented as an experimental prototype; T05 measurements recorded; T05b selects hybrid JSON and policy A following user approval and isolated HTML-only trials. The 0.2 document codec is adopted in the builder, browser and range tools. **T06 onward remains unstarted.** No complete V1 release or Data skill is claimed. The user authorised one draft PR with incremental commits through this point.

## Implemented proof

- A versioned sparse, readable JSON contract, typed inputs/formulas/results, stable sheet IDs/groups/names, separate formats, safe embedding and calculation fingerprints. Signed zero remains the JSON literal -0 rather than being rounded away.
- A narrow WASM binding to pinned, unmodified IronCalc 0.9.0 calculation code, with direct typed outputs. Precision, dates, blanks versus empty text, Boolean values, errors, named ranges and cross-sheet edits have tests.
- A target-specific Cargo licence closure, retained notices and two independent-path rebuilds with identical JavaScript/WASM/notices. See [rebuild instructions](engine/REBUILD.md) and [dependency audit](engine/dependency-audit.json).
- A standalone file:// workbook with saved results, small cell/formula editing workflow, formatting, undo and Save a copy. Standard opening and formatting request no engine. Offline HTML edits without HTTP requests.
- Pinned gzip transport and decoded-WASM integrity checks before execution. Blocked/tampered/cancelled loads preserve the attempted edit and allow retry. Invalid input keeps an already-loaded engine available. Worker calculation and result deltas keep raw sheets off the return path to the UI.
- Fictional 24-month P&L plus deterministic large-data generators, working storage-variant HTMLs, XLSX assessment conversion, range/structural experiments and reproducible measurements. Slides runtime, plugin identity and release artifacts are unchanged.

## Engine transfer and code budget

The custom WASM is 2,172,743 decoded bytes; its precompressed transport is **707,874 bytes**. The wrapper is 7,381 raw bytes. A fresh real HTTPS test observed both integrity checks passing on the first edit only; see [CDN receipt](bench/cdn-results.json). Browser-reported compressed wrapper body was 3,084 bytes. Fresh offline reopening relies on the embedded build, not HTTP cache assumptions.

Standard application code includes JavaScript, CSS, UI scaffold, all dependency notices and, conservatively, generated grid markup/text. Model JSON and the inert guide are content. Every measured standard fixture stays below **500,000 bytes**; offline code is larger because it contains the compressed engine. Data/content size is reported separately and can be much larger.

## Browser evidence before storage adoption

This initial receipt is retained as the sparse-storage baseline. The adopted-format rerun appears below.

Environment: 151.0.7922.34; Node v26.0.0; Apple M5; darwin/arm64. These are single-machine observations, with possible ambient load, not capacity or latency guarantees. Five warm input changes follow one engine load. Cold opening and initial dependency/model load are separate in [the complete receipt](bench/browser-results.json).

| Workload | Cold open ms | Max warm edit-to-paint ms | Recorded warm UI long task | Standard code bytes | Sampled WASM MB | Sampled browser-tree RSS MB |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
| pnl | 82 | 49.5 | none ≥50 ms | 230,581 | 1.7 | 811.4 |
| 100000x2-scans | 588.2 | 11,948.6 | none ≥50 ms | 236,022 | 87.2 | 1,312.1 |
| 50000x8-scans | 1,381.2 | 4,365.4 | none ≥50 ms | 245,247 | 148.7 | 2,554.2 |
| 50000x8-reused | 1,165.7 | 598.8 | none ≥50 ms | 245,247 | 148.1 | 2,488.5 |
| 100000x8-reused | 2,571.6 | 1,165.7 | none ≥50 ms | 245,249 | 294.2 | 3,918.6 |

Zero recorded long tasks means no task reached the observer's 50 ms threshold. The proposed P&L warm target (<250 ms) and warm calculation-driven UI-task target (<100 ms) passed locally. Large-data latency remains substantial. Aggregate reuse is an explicit fixture variant with identical expected results, not an automatic formula rewrite. All 1,000 result cells are checked after save for each large workload.

Memory figures have different meanings: WASM is sampled allocated linear memory; process-tree RSS is sampled every 200 ms and includes Chromium overhead, shared pages and retained processes. RSS is not unique physical RAM or a per-workbook allocation and can miss short peaks. These large sparse-JSON fixtures also repeat per-cell formatting, so total HTML can reach hundreds of MB. Storage assessment includes metadata-light dense data to distinguish encoding costs from repeated cell metadata. Wider columns, other formula mixes and other browsers need their own measurements.

The separate main-thread control recorded calculation-driven tasks up to 10,934 ms on the 100k/two-column/1,000-SUMIFS workload. See [control receipt](bench/main-thread-results.json). Timing varies across sessions; the worker's demonstrated benefit is responsiveness, not a claim of faster calculation.

CI runs unit/browser tests, code-budget checks and all committed workload recipes on every PR, enforcing the proposed P&L/UI targets. It does not fetch the real corpus. The local suite passes; consult the PR checks for current hosted-runner status.

## Storage evidence used for selection

All five encodings round-trip identical converted canonical content and pass bounded edits, row/column reference rewrites and portable browser edit/save/reopen tests. Arrays, CSV and TSV use a shared typed schema and explicit exceptions; sparse regions remain cell records. These original comparison receipts predate the selection in [ADR-005](../../docs/decisions/005-data-storage.md); they remain unchanged as measurement evidence.

Example: B03 is a real public retail workbook sampled at 60,000 data rows plus a header. Original Excel caches are retained for storage measurement; freshness is unknown and no current IronCalc snapshot is claimed. Recalculation is separate for evaluator conformance. Unsupported import features and source-cache differences are counted in [real measurements](bench/storage/real-results.json).

| Encoding | Minified payload MB | Proxy tokens | Complete readable HTML MB | Gzip HTML MB | Parse/decode ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| per-cell | 26.9 | 8,409,705 | 61.5 | 2.8 | 1,046.2 |
| rows | 8.1 | 2,964,708 | 14.2 | 1.1 | 661.1 |
| columns | 8 | 2,903,583 | 13.6 | 0.8 | 646.6 |
| csv | 7.7 | 2,860,039 | 12.7 | 1.1 | 731.5 |
| tsv | 8.1 | 2,917,310 | 13.1 | 1.1 | 688.4 |

Minified payloads isolate representation; readable HTML also includes whitespace, code, schema and preview. Row arrays are written compactly by row, and long primitive vectors use 32 scalars per line. CSV/TSV is a JSON-escaped string in this experiment. Column arrays compress well but separate the values of one row; the isolated unfamiliar-LLM trials below assess editing without establishing a statistically reliable ranking. The token proxy uses pinned gpt-tokenizer/o200k_base in fixed character chunks, with possible boundary differences.

The fictional P&L's per-cell HTML is 0.3 MB; dense alternatives add decoder/schema overhead and do not materially shrink this small model. Its saved-result snapshot accounts for 7.1% of the HTML. See [fictional measurements](bench/storage/fictional-results.json) for all cases, including a metadata-light 50k-row table.

| Public workbook | Sheets | Populated cells | Formulas | Parsed dependency depth / unresolved formulas | Eligible / checked simple results | Evaluator result |
| --- | ---: | ---: | ---: | --- | --- | --- |
| B01 | 3 | 52 | 18 | 3 / 0 | 18 / 18 | 0 mismatches |
| B02 | 9 | 547 | 240 | 2 / 234 | 0 / 0 | 0 mismatches |
| B03 | 1 | 457,896 | 0 | 0 / 0 | 0 / 0 | 0 mismatches |
| B04 | 21 | 8,532 | 5,056 | 34 / 1843 | 3004 / 0 | Range outside aggregate |
| B05 | 1 | 223 | 56 | 7 / 0 | 56 / 56 | 0 mismatches |

The small budget is not a full financial planning model; the schedule author's expertise is unverified. The operational lookup workbook uses structured references, and the valuation model uses complex/scoped names; assessment conversion reports these limitations. This is not an Excel fidelity or full formula-conformance gate. Only anonymised metrics/provenance are committed; source workbooks and their contents stay outside the repository.

## Result-policy assessment

A (save every populated formula result) remains the implemented default. B/C sizes are **counterfactual estimates**, including the measured small evaluator's code cost. They do not demonstrate a shipped reader or limited offline editor. The evaluator could not handle a real valuation-model range case; conformance is therefore not established. Cases with zero eligible cells provide no evaluator evidence. No second evaluator is included in the default runtime and no cache-elision policy is adopted.

## Adopted storage and HTML-only trials

[ADR-005](../../docs/decisions/005-data-storage.md) selects compact JSON row arrays for declared dense raw-data tables, sparse cell records for freeform financial models, JSON metadata and policy A. The [html-data/0.2 contract](model/FORMAT.md) is implemented by one document codec shared by the builder, browser and range tools. The sparse 0.1 engine model is derived in memory; only one representation is saved for each value. Legacy sparse files remain readable. CSV/TSV and column arrays remain comparison formats, with no second evaluator shipped.

Six fresh sub-agents received no conversation history, repository sources or storage recommendation. Each received only an HTML and the same task: read three saved totals, explain a derived figure and tricky types, change growth to 3%, append a record, preserve unrelated content, and identify stale results without calculating. Five trials compare the original encoding candidates; the sixth confirms the adopted 0.2 format and guide. All use a fictional P&L plus 50,000 raw-data rows. Isolation was procedural in a shared workspace, not an OS sandbox. Exact token use and model identifiers were not exposed; no token-efficiency ranking is claimed.

| Encoding | Independent canonical/byte validation | Corrective retries | Browser reopening |
| --- | --- | ---: | --- |
| per-cell | pass | 0 | stale as expected |
| rows | pass | 0 | stale as expected |
| columns | pass | 0 | stale as expected |
| csv | pass | 0 | stale as expected |
| tsv | pass | 0 | stale as expected |
| hybrid | pass | 0 | stale as expected |

Independent checks verified full-precision saved totals, exact requested edits, signed zero, all unrelated canonical data and byte-identical content outside the payload. Reports correctly distinguish blank, empty text and absence and explain the NPV precedents. All six edited files reopen stale without engine requests. The selected file additionally recalculates through verified IronCalc, matches an independent pinned-engine calculation exactly apart from timestamp, saves, and reopens current offline. See [trial receipts](bench/storage/blind-results.json). One trial per candidate is compatibility evidence, not proof of superiority or general LLM reliability. The ineligible B/C evaluator alternatives do not gain conformance from these policy-A trials.

## Adopted-format browser rerun

Same workload recipes and gates, with dense raw sheets explicitly declared as tables and their original per-cell formats retained. Environment and full metrics: [hybrid browser receipt](bench/hybrid-browser-results.json). Original and new runs occurred separately on the same machine; timing differences are not a controlled performance comparison.

| Workload | Cold open ms | Max warm edit-to-paint ms | Recorded warm UI long task | Standard code bytes | Standard HTML MB |
| --- | ---: | ---: | --- | ---: | ---: |
| pnl | 71.8 | 49.3 | none ≥50 ms | 233,280 | 0.3 |
| 100000x2-scans | 712.9 | 12,780.1 | none ≥50 ms | 238,721 | 35.3 |
| 50000x8-scans | 1,594.6 | 6,398.4 | none ≥50 ms | 247,946 | 68.3 |
| 50000x8-reused | 1,460.9 | 599 | none ≥50 ms | 247,946 | 68.3 |
| 100000x8-reused | 2,980.2 | 1,265.8 | none ≥50 ms | 247,948 | 136.1 |

All adopted-format gates pass locally. Table encoding reduces serialized value overhead but retains repeated format metadata; memory remains substantial and calculation-heavy scans remain slow. Aggregate reuse is still an authoring technique, not an automatic formula rewrite. Checkpoint A's storage decision/adoption is recorded; the documented corpus, Excel-fidelity, browser-coverage and workload limitations remain. T06 and later features are not implemented. The [review packet](bench/storage/REVIEW.md) supplies reproduction commands and blind-test details.

## Local reproduction

See [README](README.md) for building standard/offline HTML and running the Data suite. Run browser workloads with:

```bash
node --expose-gc packages/data/bench/browser.mjs --check --output packages/data/bench/browser-results.json
node packages/data/bench/main-thread.mjs
node packages/data/tests/cdn.mjs
```

The online smoke is optional and separate from deterministic integrity-failure tests. Tests require the repository's pinned Playwright/Chromium developer environment; generated HTML itself needs only a supported browser.
