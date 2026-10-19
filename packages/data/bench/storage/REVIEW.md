# T05b joint storage review

Status: the user approved [ADR-005](../../../../docs/decisions/005-data-storage.md), and the hybrid [0.2 document contract](../../model/FORMAT.md) is adopted. Dense declared raw-data tables use row arrays; freeform financial/model sheets remain sparse; metadata stays JSON. Policy A saves every formula result, with one IronCalc engine. Six isolated HTML-only trials and independent recipient checks passed. T06 has not started.

## Two independent decisions

1. **Data encoding:** per-cell objects; compact JSON row arrays; compact JSON column arrays; typed CSV; typed TSV. Dense blocks are tested alongside sparse cell records, with identical values, formulas, results and metadata. A range has one authoritative representation. All data stays embedded in the HTML.
2. **Formula-result policy:** A saves every result; B would omit eligible simple results and derive them on open; C would save everything and add limited offline recalculation. B/C sizes are counterfactual estimates. Their reader/editor integration is not implemented or approved. The assessment-only evaluator is never included in the default runtime. It could not evaluate an implicit range case in the real valuation model, so conformance is not established and those alternatives cannot be adopted from the current evidence.

Encoding measurements include minified payload bytes and proxy tokens as well as the actual readable HTML, gzip size, decoder code, parsing and encoding time. Primitive JSON arrays are formatted with at most 32 scalars per line so array indentation is not mistaken for an inherent JSON cost. CSV/TSV is currently a JSON-escaped string with a column schema; a separate literal text block is a possible follow-up, not a measured candidate. Native JSON arrays also share a column schema in this experiment; a more specialised mixed-type native-array encoding might avoid some overrides.

A table begins at A1 and has explicit dimensions, column types, scalar data, typed overrides and cell metadata. Null JSON entries or empty delimited fields mean absent cells. Explicit blanks, empty text and mixed-type exceptions use non-duplicated overrides. Formula cells remain sparse records. Dates, typed errors, leading-zero strings, Boolean values, signed zero, extreme doubles, quotes, newlines, Unicode and literal HTML-like text have round-trip tests. Dense selection uses a documented experimental 60% occupancy threshold and a two-million-slot bound; it described the comparison heuristic. The adopted writer additionally requires explicit `sheet.metadata.layout: "table"`; unmarked freeform sheets remain sparse. The adopted contract retains the 60%/two-million-slot bounds as conservative initial rules and stores empty text directly in a text row-array slot.

## Reproduce

From the repository root:

```bash
# Fictional artifacts: writes working standard HTMLs into dist/data-storage/.
node --expose-gc packages/data/bench/storage/assess.mjs --output packages/data/bench/storage/fictional-results.json

# Public source workbooks must stay OUTSIDE the checkout.
python3 packages/data/bench/storage/fetch.py /tmp/html-office-storage-sources
node --expose-gc packages/data/bench/storage/assess.mjs --sources /tmp/html-office-storage-sources/measurement-sources.json --output packages/data/bench/storage/real-results.json

# Bounded HTML-only tools; only the workbook payload is rewritten.
node packages/data/bench/storage/range.mjs inspect dist/data-storage/fictional-pnl-rows.html inputs B2:B8
node packages/data/bench/storage/range.mjs apply input.html patch.json output.html --recalculate
```

An edit patch is `{"edits":[{"sheetId":"inputs","ref":"B2","cell":{"input":{"type":"number","value":0.03}}}]}`. Structural assessment patches may use `{"structural":[{"sheetId":"inputs","axis":"row","index":2,"count":1}]}`. Row/column insertion/deletion and engine formula rewrites are tested through every codec. Named-range structural edits explicitly stop pending the T10 command contract; this is not the full structural editor. Encoding changes and range tooling presently decode/re-encode the selected workbook, with measured costs; no claim of streaming or constant-time whole-file edits is made.

`real-results.json` contains only measurements, diagnostics, public-source provenance and generic descriptions. No source cells, formulas, comments or real workbook contents are committed. The five sources cover a small departmental budget, an operational lookup model, a 60,000-row retail sample, a 21-sheet NPV valuation and a loosely structured schedule. The budget is smaller than a full P&L, and the schedule author's expertise is unverified. The committed fictional P&L and lookup fixtures complement these coverage limits. Storage measurements preserve the original Excel cached values, whose freshness is unknown. A separate IronCalc recalculation supplies evaluator-conformance references, with source-cache differences counted. Source styles are only partly imported (date recognition is retained). Structured references, scoped/complex names and other unsupported XLSX features are reported; the assessment converter does not establish Excel import fidelity. That belongs to T15.

## Blind-test packet

Give a fresh assistant only one generated HTML and the following task, without the repository or this review:

> Explain the workbook's storage format and distinguish numbers, text, blank and missing cells. Report three saved totals and explain one derived figure without independently recomputing its value. Change monthly participant growth to 3%, preserving all unrelated data and runtime code. Add a labelled derived total or extend a raw-data row, then identify any stale results. Return the modified HTML and explain the changes.

Use the P&L variants for source comprehension/model editing and the large raw-data variants for schema/row-extension tests. Validate the returned HTML with `readHTML`/range tooling, compare unrelated canonical data, recalculate with the pinned engine, and reopen in a browser. Record mistakes, repairs, context/token use and which values the assistant had to compute itself. The current authoring session and automated round trips do not count as an unfamiliar-LLM test.

## Recorded decision and trials

The user accepted the hybrid row-array/sparse-record recommendation and policy A on 19 October 2026. [ADR-005](../../../../docs/decisions/005-data-storage.md), the Office specification and the model contract record the decision. The builder, browser save path and range tools share the adopted codec; no second saved source of truth is introduced.

The [trial receipt](blind-results.json) contains five original comparison trials plus a sixth confirmation of the adopted 0.2 format and embedded guide. Each fresh sub-agent had no conversation history and was instructed to access only its own HTML/task, with no repository helpers or network. Isolation was procedural in a shared workspace, not an OS sandbox. All packets combine a fictional P&L with 50,000 raw-data records, typed exceptions and signed zero. The same task asks for saved totals/explanation, type identification, growth changed to 3%, one appended row and stale results, preserving unrelated content. All six passed independent canonical, saved-total and outside-payload byte checks without corrective LLM retries. The type and NPV explanations were reviewed against the saved model.

All six edited files reopened stale in Chromium with zero engine requests while viewing. The selected file then recalculated through the verified pinned engine, exactly matched an independent engine calculation apart from timestamp, saved, and reopened current offline. Browser QA is separate from the blind assistant's own assertions. No claim of cross-browser parity, statistical superiority, model diversity or token efficiency follows from these trials. Exact model identifiers and usage metrics were not exposed. B/C remain ineligible; these policy-A trials do not validate their unimplemented readers/editors.

Reproduce packets and independently validate returned files from the repository root:

```bash
# Use a new directory; prepare refuses to overwrite earlier inputs.
node packages/data/bench/storage/blind.mjs prepare /tmp/html-data-blind
node packages/data/bench/storage/blind.mjs prepare-selected /tmp/html-data-blind
# Give each packet directory to a different fresh assistant; do not expose validators.
# Each assistant returns edited.html and report.json alongside its input.
node packages/data/bench/storage/blind.mjs validate /tmp/html-data-blind
node packages/data/bench/storage/blind-browser.mjs /tmp/html-data-blind
```

The original trials used the pre-adoption comparison artifacts; hashes in the receipt identify those exact files. Regeneration with a later runtime may produce different hashes while retaining the same fictional task/data. Do not treat the informed authoring session or validator self-checks as additional blind trials. The adopted-format browser workload rerun is [recorded separately](../hybrid-browser-results.json); original assessment/performance receipts are retained unchanged. Large-data memory and repeated full-range calculation costs remain limitations. T06 onward is unstarted.
