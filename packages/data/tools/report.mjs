import { readFile, writeFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const load = async (path) =>
  JSON.parse(await readFile(new URL(path, root), "utf8"));
const browser = await load("bench/browser-results.json"),
  main = await load("bench/main-thread-results.json"),
  real = await load("bench/storage/real-results.json"),
  fictional = await load("bench/storage/fictional-results.json"),
  cdn = await load("bench/cdn-results.json");
const n = (value) =>
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value),
  mb = (value) => n(value / 1e6),
  pct = (value) => n(value * 100) + "%";
const performanceRows = browser.cases
  .map(
    (c) =>
      `| ${c.id} | ${n(c.coldOpenMS)} | ${n(c.warmMaxMS)} | ${c.mainThreadMaxMS ? n(c.mainThreadMaxMS) : "none ≥50 ms"} | ${n(c.standardSize.applicationCodeBytes)} | ${mb(c.maximumSampledWasmMemoryBytes)} | ${mb(c.sampledPeakBrowserTreeRSSBytes)} |`,
  )
  .join("\n");
const raw = real.workbooks.find((b) => b.id === "B03");
const storageRows = raw.encodings
  .map(
    (e) =>
      `| ${e.encoding} | ${mb(e.minifiedPayloadBytes)} | ${n(e.minifiedPayloadProxyTokens)} | ${mb(e.totalHTMLBytes)} | ${mb(e.totalHTMLGzipBytes)} | ${n(e.parseMS)} |`,
  )
  .join("\n");
const corpusRows = real.workbooks
  .map(
    (b) =>
      `| ${b.id} | ${b.sheets} | ${n(b.populatedCells)} | ${n(b.formulaCells)} | ${b.dependencyDepth.maximumParsedDepth} / ${b.dependencyDepth.unresolvedFormulaCount} | ${b.evaluator.eligibleFormulaCells} / ${b.evaluator.checkedFormulaCells} | ${b.evaluator.evaluationError ?? `${b.evaluator.mismatches} mismatches`} |`,
  )
  .join("\n");
const pnl = fictional.workbooks.find((b) => b.id === "fictional-pnl");
const control = main.cases.find((c) => c.id === "100000x2-scans");
const report = `# HTML Data Phase A implementation and assessment

Status, 19 October 2026: T01–T04 implemented as an experimental prototype; T05 measurements recorded; T05b assessment ready for joint review. **Storage selection, unfamiliar-LLM tests and T06 onward remain pending.** No complete V1 release or Data skill is claimed. The user authorised one draft PR with incremental commits through this point.

## Implemented proof

- A versioned sparse, readable JSON contract, typed inputs/formulas/results, stable sheet IDs/groups/names, separate formats, safe embedding and calculation fingerprints. Signed zero remains the JSON literal -0 rather than being rounded away.
- A narrow WASM binding to pinned, unmodified IronCalc 0.9.0 calculation code, with direct typed outputs. Precision, dates, blanks versus empty text, Boolean values, errors, named ranges and cross-sheet edits have tests.
- A target-specific Cargo licence closure, retained notices and two independent-path rebuilds with identical JavaScript/WASM/notices. See [rebuild instructions](engine/REBUILD.md) and [dependency audit](engine/dependency-audit.json).
- A standalone file:// workbook with saved results, small cell/formula editing workflow, formatting, undo and Save a copy. Standard opening and formatting request no engine. Offline HTML edits without HTTP requests.
- Pinned gzip transport and decoded-WASM integrity checks before execution. Blocked/tampered/cancelled loads preserve the attempted edit and allow retry. Invalid input keeps an already-loaded engine available. Worker calculation and result deltas keep raw sheets off the return path to the UI.
- Fictional 24-month P&L plus deterministic large-data generators, working storage-variant HTMLs, XLSX assessment conversion, range/structural experiments and reproducible measurements. Slides runtime, plugin identity and release artifacts are unchanged.

## Engine transfer and code budget

The custom WASM is 2,172,743 decoded bytes; its precompressed transport is **707,874 bytes**. The wrapper is 7,381 raw bytes. A fresh real HTTPS test observed both integrity checks passing on the first edit only; see [CDN receipt](bench/cdn-results.json). Browser-reported compressed wrapper body was ${n(cdn.items.find((i) => i.kind === "js").wireSizes.responseBodySize)} bytes. Fresh offline reopening relies on the embedded build, not HTTP cache assumptions.

Standard application code includes JavaScript, CSS, UI scaffold, all dependency notices and, conservatively, generated grid markup/text. Model JSON and the inert guide are content. Every measured standard fixture stays below **500,000 bytes**; offline code is larger because it contains the compressed engine. Data/content size is reported separately and can be much larger.

## Browser evidence

Environment: ${browser.environment.browser}; Node ${browser.environment.node}; ${browser.environment.cpu}; ${browser.environment.platform}/${browser.environment.architecture}. These are single-machine observations, with possible ambient load, not capacity or latency guarantees. Five warm input changes follow one engine load. Cold opening and initial dependency/model load are separate in [the complete receipt](bench/browser-results.json).

| Workload | Cold open ms | Max warm edit-to-paint ms | Recorded warm UI long task | Standard code bytes | Sampled WASM MB | Sampled browser-tree RSS MB |
| --- | ---: | ---: | --- | ---: | ---: | ---: |
${performanceRows}

Zero recorded long tasks means no task reached the observer's 50 ms threshold. The proposed P&L warm target (<250 ms) and warm calculation-driven UI-task target (<100 ms) passed locally. Large-data latency remains substantial. Aggregate reuse is an explicit fixture variant with identical expected results, not an automatic formula rewrite. All 1,000 result cells are checked after save for each large workload.

Memory figures have different meanings: WASM is sampled allocated linear memory; process-tree RSS is sampled every 200 ms and includes Chromium overhead, shared pages and retained processes. RSS is not unique physical RAM or a per-workbook allocation and can miss short peaks. These large sparse-JSON fixtures also repeat per-cell formatting, so total HTML can reach hundreds of MB. Storage assessment includes metadata-light dense data to distinguish encoding costs from repeated cell metadata. Wider columns, other formula mixes and other browsers need their own measurements.

The separate main-thread control recorded calculation-driven tasks up to ${n(Math.max(...control.longTasks))} ms on the 100k/two-column/1,000-SUMIFS workload. See [control receipt](bench/main-thread-results.json). Timing varies across sessions; the worker's demonstrated benefit is responsiveness, not a claim of faster calculation.

CI runs unit/browser tests, code-budget checks and all committed workload recipes on every PR, enforcing the proposed P&L/UI targets. It does not fetch the real corpus. The local suite passes; consult the PR checks for current hosted-runner status.

## Storage evidence for joint selection

All five encodings round-trip identical converted canonical content and pass bounded edits, row/column reference rewrites and portable browser edit/save/reopen tests. Arrays, CSV and TSV use a shared typed schema and explicit exceptions; sparse regions remain cell records. No encoding is adopted by this report.

Example: B03 is a real public retail workbook sampled at 60,000 data rows plus a header. Original Excel caches are retained for storage measurement; freshness is unknown and no current IronCalc snapshot is claimed. Recalculation is separate for evaluator conformance. Unsupported import features and source-cache differences are counted in [real measurements](bench/storage/real-results.json).

| Encoding | Minified payload MB | Proxy tokens | Complete readable HTML MB | Gzip HTML MB | Parse/decode ms |
| --- | ---: | ---: | ---: | ---: | ---: |
${storageRows}

Minified payloads isolate representation; readable HTML also includes whitespace, code, schema and preview. Row arrays are written compactly by row, and long primitive vectors use 32 scalars per line. CSV/TSV is a JSON-escaped string in this experiment. Column arrays compress well but separate the values of one row; direct unfamiliar-LLM editing has not been measured. The token proxy uses pinned gpt-tokenizer/o200k_base in fixed character chunks, with possible boundary differences.

The fictional P&L's per-cell HTML is ${mb(pnl.encodings[0].totalHTMLBytes)} MB; dense alternatives add decoder/schema overhead and do not materially shrink this small model. Its saved-result snapshot accounts for ${pct(pnl.resultPolicies.A.resultSnapshotShareOfHTML)} of the HTML. See [fictional measurements](bench/storage/fictional-results.json) for all cases, including a metadata-light 50k-row table.

| Public workbook | Sheets | Populated cells | Formulas | Parsed dependency depth / unresolved formulas | Eligible / checked simple results | Evaluator result |
| --- | ---: | ---: | ---: | --- | --- | --- |
${corpusRows}

The small budget is not a full financial planning model; the schedule author's expertise is unverified. The operational lookup workbook uses structured references, and the valuation model uses complex/scoped names; assessment conversion reports these limitations. This is not an Excel fidelity or full formula-conformance gate. Only anonymised metrics/provenance are committed; source workbooks and their contents stay outside the repository.

## Result-policy assessment and remaining gates

A (save every populated formula result) remains the implemented default. B/C sizes are **counterfactual estimates**, including the measured small evaluator's code cost. They do not demonstrate a shipped reader or limited offline editor. The evaluator could not handle a real valuation-model range case; conformance is therefore not established. Cases with zero eligible cells provide no evaluator evidence. No second evaluator is included in the default runtime and no cache-elision policy is adopted.

Before T06, review the encoding by range role and A/B/C policy together, run the unfamiliar-LLM reading/editing tasks, and record any approved contract change in ADR-003 and the specification. Checkpoint A is not closed until that decision is recorded. The [review packet](bench/storage/REVIEW.md) supplies reproduction commands, provenance, limitations, working fictional variants and blind-test prompts.

## Local reproduction

See [README](README.md) for building standard/offline HTML and running the Data suite. Run browser workloads with:

\`\`\`bash
node --expose-gc packages/data/bench/browser.mjs --check --output packages/data/bench/browser-results.json
node packages/data/bench/main-thread.mjs
node packages/data/tests/cdn.mjs
\`\`\`

The online smoke is optional and separate from deterministic integrity-failure tests. Tests require the repository's pinned Playwright/Chromium developer environment; generated HTML itself needs only a supported browser.
`;
await writeFile(new URL("PHASE-A-REPORT.md", root), report);
