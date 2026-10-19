# ADR-005 — Hybrid JSON workbook storage

Status: accepted by the user and adopted on 19 October 2026. Six fresh-context HTML-only trials and independent recipient checks passed; the model, builder, browser and range tools implement the selected document format. This refines the data representation in [ADR-003](003-html-office-and-data-runtime.md), without changing its one-engine or saved-results decisions.

## Decision

Use compact JSON row arrays for dense raw-data tables, sparse JSON cell records for freeform financial/model sheets, and JSON metadata for workbook structure, formats and other definitions. Each cell has exactly one authoritative value representation. All content remains embedded in one HTML; neither external data files nor engine binary state are required to read it.

Retain policy A: save the full-precision typed result of every populated formula cell, together with the engine/version, calculation fingerprint and timestamp. Keep IronCalc as the single calculation engine, running in a worker and loaded on demand in standard mode. Offline builds embed the same engine. Do not add the assessment-only small evaluator to V1.

CSV and TSV remain import/export formats. Column arrays and delimited strings are comparison candidates, not additional product storage modes. Native row arrays still require explicit rules for dates, errors, missing cells, blanks, empty text and mixed-type exceptions. The [0.2 document contract](../../packages/data/model/FORMAT.md) defines the adopted typed-column schema, overrides and single-source rules. Empty text is a native JSON string in the adopted row format; explicit blanks and type exceptions use overrides.

## Evidence and tradeoffs

On the 60,000-row public retail sample, minified payloads measured 26.9 MB for per-cell JSON, 8.1 MB for row arrays and 7.7 MB for CSV. CSV's roughly 5% payload saving does not justify another text parsing/escaping layer as the default. Readable full-HTML size also reflects formatting and JSON string escaping; it is not solely an intrinsic encoding cost. Column arrays compress well but separate one record's values. Sparse records remain appropriate for small financial models, where dense codecs add overhead without a material size benefit.

The preference for row locality and explicit JSON scalars is an engineering judgment. The trials demonstrate successful reading/editing on the tested task, not superior unfamiliar-LLM reliability across workloads. [Measurements and limitations](../../packages/data/PHASE-A-REPORT.md) remain authoritative, including incomplete XLSX conversion and original source-cache freshness being unknown.

The small evaluator has unresolved conformance on a real valuation model, and cache savings do not establish a reason to reverse the single-engine decision. Stored results enable offline reading; they do not promise offline recalculation without an available engine.

## Adoption gate

Run isolated HTML-only reading/editing trials on fictional workbooks, comparing row arrays with per-cell, column-array, CSV and TSV candidates. Give each fresh assistant only its HTML and the same task; do not provide repository helpers or this decision. Validate saved totals, type distinctions, a 3% assumption edit, a raw-table extension, unrelated canonical content, unchanged runtime bytes and stale-result identification. Recalculate and reopen the selected candidate separately after validating the returned file. Record failures and corrective retries honestly. One trial per encoding is an initial compatibility check, not a statistical ranking of LLM performance.

The [trial receipts](../../packages/data/bench/storage/blind-results.json) record all six successful responses, hashes, explanations, zero corrective retries, canonical/byte checks and browser reopening. The adopted-format trial additionally recalculates through verified IronCalc, matches an independent pinned-engine calculation, saves and reopens current offline. The versioned document codec, embedded guide, builder, browser save path and range tools now implement this representation consistently; legacy sparse documents remain readable. The storage decision/adoption portion of T05b and Checkpoint A is recorded. Existing corpus/Excel-fidelity limitations remain documented; this is not V1 release approval. Experimental alternative codecs retain their assessment labels. T06 onward does not start implicitly.

Compact storage is not a calculation optimization or a memory guarantee. Rebenchmark the adopted runtime before claiming a capacity improvement. Prefer explicit aggregate reuse when authoring large models; do not silently rewrite users' formulas.
