# ADR-013 — Basic editable pivot tables (Data T17)

Status: accepted for implementation, 24 October 2026. Scope from the [Office specification](../HTML-OFFICE-V1.md): row and column fields, filters, SUM/COUNT/AVERAGE, totals and an explicit refresh. Calculated fields, slicers, subtotals, date grouping and "show values as" are deferred.

## Context

[T17](../HTML-DATA-PLAN.md#t17--build-a-basic-editable-pivot) listed T15 (CSV/XLSX import) as a dependency. A pivot only needs a rectangle of typed records with a header row. Every workbook already has those: freeform ranges and dense `sheet.table` sheets (ADR-005), whether typed, pasted (T09) or written by an LLM. **Import is therefore not a prerequisite.** An imported table later becomes one more source. T11 (sheets, styles) and T12 (formula conformance) are merged.

The output must stay readable without the engine, follow source changes only when the user refreshes, and never overwrite cells it does not own. ADR-003 keeps one calculation engine.

## Decision

### Definition

Optional workbook `pivots`, an array of at most 50 definitions:

```json
{
  "id": "revenueByRegion",
  "name": "Revenue by region",
  "source": { "sheetId": "raw", "ref": "A1:E2001" },
  "output": { "sheetId": "summary", "ref": "H2:L9" },
  "rows": ["Region"],
  "columns": ["Quarter"],
  "filters": [{ "field": "Channel", "values": [{ "type": "text", "value": "Online" }] }],
  "values": [{ "field": "Revenue", "aggregate": "sum" }],
  "refreshed": { "fingerprint": "<64 hex>", "at": "2026-10-24T09:30:00.000Z" }
}
```

- `source.ref` is an A1 rectangle whose first row holds field names. Without `ref`, the source is the sheet's used range from A1 to its last populated row and column, so records appended to a `sheet.table` are picked up at the next refresh. A source without `ref` must be on another sheet than the output.
- Fields are named by their header label: the header cell's text, or the canonical string of a number or Boolean. A field used in a definition must match exactly one header cell. Names keep the definition readable and survive column moves. A renamed or deleted header makes refresh fail with an explicit message.
- `rows` (0–4), `columns` (0–2) and `filters` (0–4) use distinct fields. `values` holds 1–8 measures; `aggregate` is `sum`, `count` or `average`.
- A filter keeps records whose value is in `values`, a list of typed values (`{"type":"blank"}` for blanks). Membership is typed, as for dropdowns.
- `refreshed` is absent until the first refresh.

### Ownership of the output range

`output.ref` is the rectangle the pivot owns. Its top-left cell is the anchor. Without `refreshed` it must be the anchor alone, and no stored output may exceed the 200,000-cell output limit, so an edited file cannot claim ordinary cells or an unbounded range.

- A refresh computes the new rectangle from the anchor. It is refused, with nothing changed, when that rectangle would cover a cell holding an input or formula outside the pivot's current rectangle. It is also refused when it would overlap another pivot's output or its own source.
- The refresh writes every cell of the new rectangle and clears the cells of the old one that fall outside. Direct formatting (`style`) on a cell it overwrites is kept. The pivot sets values, cell styles and number formats.
- Cell edits, pastes, fills and dropdown choices into an owned rectangle are refused with a message. Formatting is allowed.
- Row and column insertions or deletions that would cut through an output rectangle, or delete part of it, are refused. Edits elsewhere move the output, and shift or shrink the source as for dropdown sources. A source deleted entirely becomes `"#REF!"`, which a refresh reports.
- Deleting a pivot removes its definition and the values it wrote, keeping direct formatting. Like a refresh, it is one undoable step.

Validation rejects pivots whose outputs overlap each other, and an output that overlaps its own source.

### Computation: model code in the IronCalc worker

Refresh runs in the existing engine worker. The worker first recalculates, so formula results in the source are current, including scenario choices. Then `model/pivot.mjs` aggregates the typed values the engine holds. The worker returns the output cells. The main thread checks ownership and writes them through the ordinary edit pipeline (`editMany` + `calculate`). The output cells, the new definition and the snapshot form one history entry. Formulas that read the pivot output are recalculated with it.

The alternative was to write SUMIFS/COUNTIFS/AVERAGEIFS formulas into the output. It was rejected for three reasons, checked on the pinned engine:

- **Typing.** IronCalc's criteria coerce and fold case: `COUNTIF` counts both the number 5 and the text "5" for the criterion 5, and treats "North" and "north" as equal. Typed grouping would disagree with those formulas.
- **Cost.** Every later recalculation of the workbook would rescan the source for each output cell. Over 100,000 records, that would slow down unrelated edits.
- **Refresh contract.** Formula values would change without a refresh, while the item list would not, so a pivot would be half refreshed.

Aggregation is not a formula evaluator. It applies three fixed aggregations to typed values, as the data-bar summaries do (ADR-008). Sums add numbers in source row order. On the probes, IronCalc's `SUM` and `AVERAGE` give the same doubles, and an engine test checks this.

### Semantics

- **Records** are the rows below the header. Rows with no populated cell across the source width are skipped; a row populated only in unused columns is still a record. Header formulas without verified results are resolved by the worker after recalculation, not rejected beforehand, and a filter's item list waits for verified results.
- **Items** group by typed value, with no case folding or text-to-number coercion. Signed zeros are equal. Missing and blank cells form one `(blank)` item. Empty text is a separate text item.
- **Order.** Items are sorted ascending: numbers, dates, text (case-insensitive, ties case-sensitive, by code unit, so the result does not depend on the browser's locale), Booleans (FALSE first), errors in the order of `ERRORS`, and `(blank)` last.
- **Labels** are typed input cells holding the item value. They carry the format of the item's first source cell, so dates display as dates. Errors are typed error cells.
- **SUM** adds numbers and dates, ignoring text, Booleans and blanks. A group with no numbers sums to 0; a sum that overflows is `#NUM!`, as with IronCalc's `SUM`. The first error in source order makes the result that error.
- **COUNT** counts non-blank values of the field, including text, Booleans, errors and empty text (Excel's pivot "Count").
- **AVERAGE** is SUM divided by the count of numbers and dates. With no number it is `#DIV/0!`; errors propagate as for SUM.
- **Empty intersections.** A row and column combination with no record stays empty.
- **Totals.** A total row appears when there are row fields, and total columns when there are column fields. Totals are aggregated from the records, not from the cells shown, so an average total is the average of all records.

### Layout

With row fields R (k of them), column fields C (m) and measures V (v), the output has m + 1 header rows:

- Header rows 1 to m hold the column field name in the last label column, then the item of that column field above each data column, and `Total` above the total columns.
- The last header row holds the row field names, then the measure label above each data column (`Sum of Revenue`, `Count of Units`, `Average of Price`).
- Each body row holds k labels, then one value per column item and measure, then the totals.
- The final `Total` row closes the table.
- There is always at least one label column; without row fields the single body row is labelled `Total`.

Cell styles: `header` for header rows, `rowHeader` for labels, `total` for the total row and columns. Values of SUM and AVERAGE copy the number format of the field's first source cell.

Limits: 10,000 row items, 500 column items, 200,000 output cells, a source of at most 5,000,000 cells and Excel's grid bounds. Larger pivots are refused with a message.

### Revision, saving and staleness

`refreshed.fingerprint` is the source revision: a SHA-256 of the computational definition and the typed source values (header row and used columns). Output values are ordinary typed input cells, so a saved file shows them without the engine, in PNG downloads and in print. Formulas can reference them.

The recovery worker recomputes each pivot's fingerprint from its decoded document after changes, as it does for data-bar summaries. The state is derived and never saved:

| State | Meaning |
| --- | --- |
| `current` | The fingerprint matches |
| `stale` | Source values or the definition changed since the refresh, including a scenario switch or an external edit |
| `unverified` | The source holds formulas whose saved results are not verified current |
| `never` | Not refreshed yet |
| `error` | A field, the source or the output cannot be resolved |

The panel shows the state, owned cells carry a marker, and a stale pivot keeps its last values until refreshed. Nothing refreshes automatically.

### Editor

Insert › Pivot table… and Data › Pivot tables… open a side panel (ADR-011 §7). It edits the source, the output anchor, the row, column and filter fields, filter items and the measures. Update applies the definition and refreshes in one step. Refresh, Refresh all pivots (Data menu) and Delete are also available. Choosing an item list for a filter scans one source column on demand.

## Consequences

Pivots work on any in-workbook data now. Import (T15) adds sources later without changing this contract. A refresh needs the engine, as every calculation-changing edit does; viewing does not. An external LLM can edit a definition and reopen: the pivot shows `stale` until it is refreshed, and its saved cells stay readable meanwhile.
