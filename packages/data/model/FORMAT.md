# HTML Data document contract — html-data/0.2

The single `script#workbook[type="application/json"]` is the authoritative saved workbook. `model/document.mjs` is its reader/writer, shared by the browser and authoring tools. Formula strings, typed values/results and all metadata remain readable JSON; engine objects are disposable derived state.

The document header and sparse cell schema are those of the validated `html-data/0.1` logical model in `workbook.mjs`, with document `version: "html-data/0.2"`. A reader derives that sparse logical model for calculation and fingerprints; it does not save a second copy alongside the document. Legacy sparse 0.1 files remain readable and save as 0.2. Unknown structural fields/versions fail validation rather than being discarded. This is a prototype contract, not the complete V1 schema.

## Sheet representations

Freeform sheets use `cells`, a map from Excel A1 addresses to explicit input/formula records. Formulas always remain there, with their full-precision typed `result`, role and format. An explicit blank is `{ "input": { "type": "blank" } }`; empty text has a text value of `""`. A missing cell has no record.

Authors declare a raw-data table with `sheet.metadata.layout: "table"`. The writer uses row storage if the A1 rectangle containing input cells is at least 60% populated and has at most 2,000,000 slots. It otherwise retains sparse cells without allocating the rectangle. These are conservative initial encoding rules, not engine capacity guarantees. One A1 table per sheet is supported initially; arbitrary offset/multiple blocks are not implemented.

A row table has these fields:

| Field | Meaning |
| --- | --- |
| `encoding` | Exactly `"rows"` |
| `height`, `width` | Positive integer dimensions, within Excel coordinate limits and the slot bound |
| `columnTypes` | One type per column: number, text, date, boolean, error or blank |
| `data` | Exactly `height` JSON row arrays, each with exactly `width` scalar/null entries |
| `overrides` | A1-addressed complete typed input cells for blanks or type exceptions |
| `cellMetadata` | A1-addressed role/format objects for non-null array inputs; never another value |

`null` means no array input at that position. A missing cell has no array value, override or sparse record. `""` is empty text, distinct from `null`. Explicit blanks and mixed-type exceptions use an override and a null placeholder. Sparse formulas may occupy null positions in the table rectangle. Inputs in that rectangle belong only to `data` or `overrides`; duplicate sources are rejected. Override coordinates must be inside the table; orphan/duplicate metadata and inconsistent dimensions are rejected.

Example sheet:

```json
{
  "id": "raw",
  "name": "Raw",
  "metadata": { "layout": "table" },
  "cells": { "C1": { "formula": "=B1*2", "result": { "type": "number", "value": 5 } } },
  "table": {
    "encoding": "rows", "height": 2, "width": 2,
    "columnTypes": ["text", "number"],
    "data": [["0012", 2.5], ["", null]],
    "overrides": { "B2": { "input": { "type": "blank" } } },
    "cellMetadata": {}
  }
}
```

Appending a raw record updates both `data` and `height`; width, column types, exceptions and metadata must remain consistent. Inserting/deleting model rows or columns requires formula/reference rewrites through the engine-backed structural tooling, not merely splicing an array. Named-range structural edits remain blocked pending T10.

## Precision, safety and saved results

Numbers are finite IEEE-754 doubles, independent of displayed rounding. Preserve literal `-0`; ordinary `JSON.stringify` converts it to `0`. Use the supplied serializer, which also escapes HTML delimiters, U+2028 and U+2029 for safe script embedding. Text remains literal data. Dates are Excel 1900 serials; typed spreadsheet errors remain errors. Generic metadata is inert JSON and must survive unrelated edits.

Policy A saves every populated formula result without a rectangular position cutoff. Snapshots identify engine/version, time and the calculation-relevant fingerprint. An input/formula edit invalidates the matching snapshot; retain the old fingerprint or remove the snapshot until recalculation. Do not invent or round saved results. Formatting does not invalidate calculations. The browser displays externally stale results as stale and recalculates with the same IronCalc worker. Standard mode loads the verified engine when needed; offline mode embeds it. There is no second formula evaluator.

See [ADR-005](../../../docs/decisions/005-data-storage.md) for the decision, [Phase A evidence](../PHASE-A-REPORT.md) for limits, and [the storage review](../bench/storage/REVIEW.md) for the isolated HTML-only trials. Later T06–T22 work remains separate.

## Structural edits and named references

Named ranges retain `{name, sheetId, ref}`. `ref` is an A1 rectangle or the explicit string `"#REF!"` when a structural edit removes every referenced cell. Partial deletion shrinks the range; insertion relocates or expands it. Stable sheet IDs remain unchanged. Row/column operations obtain formula rewrites from IronCalc and return them to the readable model. A generated filename or opaque engine state is never required to restore references.

IronCalc's current structural methods do not reliably relocate defined names, and its public binding accepts only range-shaped name definitions. The adapter therefore rebinds the canonical names after a structural operation. Broken names point to a derived typed `#REF!` cell in a temporary engine-only sheet. That helper contains no workbook inputs, is omitted from the document/model/results, and is recreated from the canonical broken binding on load. Formula strings such as `=Metric` stay readable and return a typed reference error after save/reopen. There is still one evaluator.

Structural input movement is lossless: an insertion that would push populated cells past Excel's row/column bounds is rejected before the engine changes. A blank tail of an explicit named range is clipped to grid bounds; a reference moved wholly beyond the grid becomes `#REF!`.

## Display and shared branding

`locale` is a supported Intl locale for number/date display only; all formulas retain English names and decimal syntax. Number, currency, accounting and percent formats round only the displayed value. Dates are Gregorian Excel 1900 serials, including the fictitious leap day at 60; date format hides fractions and displays `####` for negative serials or dates after 9999-12-31. Zero displays 1899-12-31. The original number/date scalar is never replaced by a formatted string. The 1900 compatibility convention follows [Microsoft documentation](https://learn.microsoft.com/en-US/office/troubleshoot/excel/wrongly-assumes-1900-is-leap-year).

`style#charte` embeds the same CSS brand tokens as Slides; Data builds accept `--charte FILE`. Optional semantic role tokens in the default shared brand are `--header-bg/--header-ink`, `--row-label-bg/--row-label-ink`, `--assumption-bg/--assumption-ink`, and `--calculation-bg`. Existing custom Slides themes without these tokens fall back to their `--ink`, `--bg`, `--acc`, `--lig`, `--alert`, `--callout`, `--tint`, and `--font` values. Formatting a selected rectangle is undoable and does not download the calculation engine or invalidate its fingerprint.
