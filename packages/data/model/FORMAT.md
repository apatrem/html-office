# HTML Data document contract — html-data/0.2

The single `script#workbook[type="application/json"]` is the authoritative saved workbook. `model/document.mjs` is its reader/writer, shared by the browser and authoring tools. Formula strings, typed values/results and all metadata remain readable JSON; engine objects are disposable derived state.

The document header and sparse cell schema are those of the validated `html-data/0.1` logical model in `workbook.mjs`, with document `version: "html-data/0.2"`. A reader derives that sparse logical model for calculation and fingerprints; it does not save a second copy alongside the document. Legacy sparse 0.1 files remain readable and save as 0.2. Unknown structural fields/versions fail validation rather than being discarded. This is a prototype contract, not the complete V1 schema.

## Sheet representations

Freeform sheets use `cells`, a map from Excel A1 addresses to explicit input/formula records. Formulas always remain there, with their full-precision typed `result`, `cellStyle` and format. `cellStyle` names a cell style: `header`, `rowHeader`, `assumption`, `calculation` or `normal` (the default). An explicit blank is `{ "input": { "type": "blank" } }`; empty text has a text value of `""`. A missing cell has no record.

Authors declare a raw-data table with `sheet.metadata.layout: "table"`. The writer uses row storage if the A1 rectangle containing input cells is at least 60% populated and has at most 2,000,000 slots. It otherwise retains sparse cells without allocating the rectangle. These are conservative initial encoding rules, not engine capacity guarantees. One A1 table per sheet is supported initially; arbitrary offset/multiple blocks are not implemented.

A row table has these fields:

| Field | Meaning |
| --- | --- |
| `encoding` | Exactly `"rows"` |
| `height`, `width` | Positive integer dimensions, within Excel coordinate limits and the slot bound |
| `columnTypes` | One type per column: number, text, date, boolean, error or blank |
| `data` | Exactly `height` JSON row arrays, each with exactly `width` scalar/null entries |
| `overrides` | A1-addressed complete typed input cells for blanks or type exceptions |
| `cellMetadata` | A1-addressed `cellStyle`/format objects for non-null array inputs; never another value |

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

## Formatting, cell styles and links

[ADR-012](../../../docs/decisions/012-data-formatting-vocabulary.md) defines a **closed vocabulary aligned with html-slides**: charte tokens only, never literal colours, fonts or sizes. [ADR-010](../../../docs/decisions/010-manual-formatting-and-ironcalc-toolbar.md) keeps the layering and sheet-level links. None of these fields changes values or the calculation fingerprint. Appearance resolves property by property: cell style, then column `style`, then row `style`, then the cell's own `style`, then conditional formatting.

- **`cellStyle`** is one of a fixed catalogue: `normal` (default), `title`, `header`, `rowHeader`, `assumption`, `calculation`, `output`, `total`, `note`, `alert` and `hyperlink`. Their rendering comes from the charte. There are no custom styles.
- **`style`** holds only overridden properties:
  - `bold`, `italic`: booleans;
  - `color`: `ink`, `acc`, `mid`, `alert`, `t2` or `bg`;
  - `fill`: `none`, `tint`, `lig`, `mid`, `acc`, `alert` or `dark`. Text turns white on `mid`, `acc`, `alert` and `dark` unless `color` is given;
  - `border.{top,right,bottom,left}: {style, color?}`, where `style` is `none` (suppresses an inherited side, no colour), `thin`, `medium` or `double`, and `color` is a text-colour token (`ink` by default);
  - `align.horizontal`: `general`, `left`, `center`, `right` or `centerContinuous`;
  - `align.wrap`: boolean.

  There is one font size and no vertical alignment, underline, strike, font family, merges or diagonal borders.
- **Rows and columns.** A sheet may have `rows` keyed `"1"`–`"1048576"` and `columns` keyed `"A"`–`"XFD"`:
  - row entries are `{style?, height?}`, where `height` (1–600 px) is the **automatic** height written by the editor when wrapped text grows a row; rows are never sized by hand;
  - column entries are `{style?, width?}`, with `width` 1–2000 px, set by the user.

  Insertions and deletions move these entries with their row or column; entries in deleted rows or columns disappear.
- **Document settings.**
  - `font`: one of `arial`, `verdana`, `tahoma`, `trebuchet`, `georgia` or `times`; absent means the charte font.
  - `theme`: one of `blue`, `red`, `green` or `black`, a built-in charte overlaid on the document's own `style#charte`, which is never rewritten; absent means the document charte.
- **A style-only cell** has no `input` or `formula` and is blank for formulas and conditional rules. In row-table sheets it stays in sparse `cells`. `cellMetadata` may hold `cellStyle`, `format` and `style` for array values.
- **Links** live per sheet in `links`, keyed by A1 cell, like Excel's worksheet hyperlink list. There are at most 10,000 per sheet, and a linked cell needs no cell record. Each link is `{url}` or `{sheetId, ref}`:
  - `url` accepts only `https:`, `http:` or `mailto:` and is at most 2,048 characters;
  - `ref` is an A1 cell or range, relocated by structural edits like named ranges, and becomes `"#REF!"` when its target is deleted.

  A link moves with its cell and disappears with its deleted row or column. Value edits, text-table paste and formatting never touch links. A rich copy carries the links of its cells. On paste, the pasted rectangle takes the source links exactly, published with its cells in one undoable step. Internal links to sheets missing from the destination are dropped with a notice, and unsafe schemes reject the paste.
- **Number formats** may add:
  - `dateStyle: "short" | "long"` for `date`;
  - `scale: "thousands" | "millions"` for number, currency and accounting;
  - `negative: "minus" | "parentheses" | "red" | "redParentheses"` for number, currency, accounting and percent.

  Custom Excel format codes are not accepted.

Rendering, commands, theme switching and the toolbar that use these fields are delivered separately (F02–F06, T01–T02). Until then the browser preserves them through edits, paste, history, recovery and saving; catalogue cell styles and conditional tokens already render.

## Sheet navigation

Groups are `{id,name,sheetIds,kind?,collapsed?}`. `kind` is `summary`, `inputs`, `raw`, or `calculations`; it supplies semantic navigation styling. `sheetIds` order controls tab order, while the workbook sheets array retains engine order and stable IDs. Existing custom groups and ungrouped sheets remain readable; navigation derives missing default groups and presents ungrouped sheets under Raw Data until an explicit change saves that organisation. Group collapse/order and moves do not alter calculation inputs or require the engine. Create/rename operations validate new names and calculate before publication; renamed formulas return from IronCalc to JSON. Legacy files whose sheet names start/end with an apostrophe can still be read; new create/rename commands reject those names. All operations participate in history and draft recovery.

## Dropdown and scenario definitions

Optional `validations` contains `{id,sheetId,ref,source}` records. IDs are unique and target rectangles on a sheet cannot overlap. A source is `{kind:"list",values:[typedValue,...]}` or `{kind:"range",sheetId,ref}`. Static lists contain 1–1,000 non-error typed choices; a workbook has at most 1,000 definitions. `ref` uses ordinary A1 ranges or the preserved `#REF!` tombstone. No per-cell metadata duplicates these definitions.

Optional `scenario:{validationId}` points to one single-cell dropdown (or its deleted `#REF!` target). The canonical selector input stores the choice; visible assumption cells hold the alternatives once, and ordinary formulas choose among them in IronCalc. There is no per-scenario workbook or result cache. Dropdown validity and source staleness are derived, never saved as flags.

Scenario targets must contain inputs, not formulas. An absent/blank selector is still editable; a deleted target is inactive until restored. Singleton ranges such as `B2:B2` normalize to the canonical cell `B2` for selection/edit checks. Formula assignments to an active selector reject the whole batch before any cell changes. Generic computed dropdown targets remain readable and cannot be overwritten by choosing an item.

Membership compares typed values without text/number/date coercion or case folding; numeric signed zeros compare equal. Duplicate choices collapse in source order. Range sources exclude holes, blanks and empty text. Formula-based choices require a verified current snapshot. Unresolved sources distinguish `reason:"stale"`, `"missing"` and `"error"`; raw input sources do not depend on unrelated formula caches. An invalid current value is distinct from an unresolved/broken source. At most 10,000 source cells and 1,000 distinct options are expanded for a dropdown; larger stored references remain readable and report `too-large`, with no partial list.

Row/column operations shift both target and source ranges; partial deletions shrink and complete deletions retain `#REF!`. Header history restores definitions and the scenario descriptor. Metadata-only definition edits keep calculation snapshots current; an existing worker can replace its validation header through `EngineClient.configureValidations({validations,scenario})` without reloading or recalculating the engine. A null/absent scenario removes the descriptor at this API boundary; canonical documents omit that field. Validate the entire prospective header before publishing it.

Browser selection controls use that same input: Scenario stays visible across sheets, and Dropdown value appears for the focused validated cell. Option labels use the target cell format; the stored typed value and precision stay unchanged. Calculated targets and unresolved/empty/oversized sources disable selection with a reason. An out-of-list current value stays visible and is flagged until replaced. Choosing an option is an ordinary undoable calculation edit, with the existing pending-range retry and uncalculated-copy behaviour on engine failure.

The browser Dropdown settings dialog creates/edits/removes definitions, assigns a single input selector and repairs broken ranges. List entry uses one selected scalar type; existing mixed/blank/multiline choices can be retained exactly using Keep existing typed values. Definition changes preserve cells/results and use header history/recovery. A loaded worker accepts the validated header before canonical publication; failed/cancelled synchronization discards that worker and leaves the previous header intact. Metadata Undo/Redo synchronizes any warm worker too. Pending formula edits are preflighted against a proposed scenario selector before publication, so saving the draft cannot create a computed selector.

## Conditional formatting rules

Optional `conditionalFormats` is an ordered array of at most 100 rules. Shared fields are `{id,sheetId,ref,kind}` with a stable sheet ID and A1 rectangle or inactive `#REF!`. The first matching highlight and first applicable data bar independently win; a highlight uses one whole style without merging later matches. Reorder the array to change precedence. Metadata commands preserve inputs/results; structural edits relocate these ranges and header history restores them.

A highlight adds `condition:{operator,values:[typedValue,...]}` and `style:{fill?,color?,bold?,italic?}` (at least one style field), using the same tokens as cell `style`. Operators `eq/ne` take one typed value; ordered `gt/gte/lt/lte` take one number/date; inclusive `between/notBetween` take two ordered same-type numbers/dates; `contains` takes one case-sensitive text value; `isBlank/isError` take an empty values array. Typed comparisons do not coerce. Empty text differs from blank; missing formula results do not satisfy blank tests. Error cells match explicit error predicates/comparisons rather than ordinary numeric/text conditions. Browser formula highlights require a verified current snapshot; raw input highlights are available before engine loading. Cached stale/unverified formulas retain their displayed value but receive no highlight. Format > Conditional formatting manages highlights without recalculation; priority changes require saving any rule edits first. Data bar rendering uses derived worker summaries. The same Conditional formatting manager creates, edits, removes and reorders both kinds, with automatic or fixed bounds and separate positive/negative colours. Changing kind explicitly preserves rule identity/order while replacing its kind-specific fields. Automatic bounds exclude stale/unverified formula results. Summary replies apply only to the current document revision; pending edits use the committed cells for scale analysis. Storage failure preserves analysis; an actual worker failure removes automatic bars until reopening, while fixed bars and editing remain available. No derived scale or geometry is persisted.

A data bar adds `scale:{kind:"auto"}` or `scale:{kind:"fixed",min,max}`, plus required `positive` and `negative` text-colour tokens (the dialog proposes `acc` and `alert`). Fixed finite bounds must satisfy `min <= 0 <= max` and `min < max`. Automatic bounds include zero and ignore text/booleans/blanks/errors/missing results. Numbers and dates, including saved formula results, supply full-precision values. Positive/negative bars share a zero axis; fixed-range overflow clips visually; constant nonzero data fills its side, and all-zero data produces zero width. Scale summaries are derived, not another saved source of cell values. Core definitions currently precede browser rendering/authoring under T14.
