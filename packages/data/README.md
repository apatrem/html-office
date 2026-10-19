# HTML Data — Phase A prototype

Work authorised through T05b only. The user approved hybrid JSON storage and policy A in [ADR-005](../../docs/decisions/005-data-storage.md); T06 and later product features are out of scope for this PR. This package is independent of Slides and is not yet a distributed skill.

The [html-data/0.2 document contract](model/FORMAT.md) uses compact JSON row arrays for declared dense raw-data tables, sparse cell records for freeform models, and JSON metadata. Every populated formula result is saved. Other encodings remain assessment candidates only.

## T01 contract

`model/workbook.mjs` validates `html-data/0.1`. Sheet IDs are stable; formula references use sheet names and Excel A1 syntax. Rows are 1–1,048,576, columns A–XFD. Ranges are bounded A1 rectangles. Missing cells are absent; explicit blanks have `{type:"blank"}`; empty text is `{type:"text",value:""}`. Errors are explicit typed spreadsheet codes. Dates are Excel 1900 serials (including its fictitious leap day); no locale-dependent date text is canonical. Numbers are finite IEEE-754 doubles, preserved without display rounding. Locale is initially en-US and engine timezone UTC; display formats are separate.

A cell has an `input` or `formula`, optional typed formula `result`, semantic `role` and `format`. Unknown structural fields are rejected. Arbitrary JSON metadata remains inert and survives bounded edits. Cell text may contain literal markup but is never HTML. JSON escaping prevents script termination and preserves Unicode. No executable content is accepted in model fields.

The SHA-256 calculation fingerprint includes typed inputs, formulas, sheet identity/order/names, named ranges and the date system. It excludes results, formats and descriptive metadata. Snapshots identify engine, fingerprint and calculation time. Fingerprints detect stale results, not authenticity. Missing/stale snapshots must be visible in the prototype.

Run model tests: `node --test packages/data/tests/model.test.mjs`.

## Build and verify

A finished HTML opens directly in a browser; recipients do not install these developer tools. From the repository root:

```bash
npm ci
npm ci --prefix packages/data --ignore-scripts
npx playwright install chromium
npm run test:data
node packages/data/tools/build.mjs --input packages/data/fixtures/pnl.json --output dist/data/pnl.html
node packages/data/tools/build.mjs --input packages/data/fixtures/pnl.json --offline --output dist/data/pnl-offline.html
```

The prototype has cell/formula editing, formatting, undo and Save a copy. The grid is a bounded preview, with all workbook cells retained in the HTML. The P&L has 12 actual and 12 forecast months. Cash flow is simplified to net income; the annual discount rate is converted to a monthly rate, with the initial investment outside NPV. Full grid editing, recovery, scenarios, charts, pivots, imports and a distributable Data skill belong to later tasks.

The default document is hybrid JSON with every formula result saved. Declare raw-data sheets with `metadata.layout: "table"`; the writer uses bounded row blocks when dense enough and otherwise retains sparse cells. Freeform sheets remain sparse. The browser, builder and range tools share the same document codec, which derives the validated sparse 0.1 engine model and saves 0.2 documents. Legacy sparse files remain readable. `-0` is written as the valid JSON literal `-0`; native `JSON.stringify` would lose its sign. All display rounding stays separate from saved numbers. Runtime calculations use one IronCalc engine in a worker. A result delta avoids copying raw sheets back to the UI. Undo restores canonical values and results; edits made while a dependency is unavailable remain in the form for retry.

Standard builds fetch a pinned JavaScript wrapper and precompressed WASM only on a calculation-changing edit. The loader checks the compressed digest, decompresses with the browser's native gzip stream, checks the decoded WASM digest and size, then executes the verified pair. Offline builds embed the same compressed pair. Runtime notices are included in the code budget; model JSON and the format guide are content. For a conservative budget, the generated grid markup and its displayed text also count as application code.

See [the implementation/assessment report](PHASE-A-REPORT.md), [engine rebuild instructions](engine/REBUILD.md), [dependency audit](engine/dependency-audit.json) and [the storage review packet](bench/storage/REVIEW.md). The approved storage decision, isolated HTML-only trials and remaining limitations are recorded there; no cache-elision or second-evaluator policy is adopted. The experimental codecs and small evaluator live under `bench/storage/`; the evaluator is not included in the default runtime.
