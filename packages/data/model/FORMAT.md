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
  - row entries are `{style?, height?}`, where `height` (23–600 px; 23 is the standard row) is the **automatic** height written by the editor when wrapped text grows a row; rows are never sized by hand;
  - column entries are `{style?, width?}`, with `width` 8–2000 px, set by the user. These minimums keep the rendered grid bounded.

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

**Rendering (F02).** The grid resolves each property in layer order and draws every field without the calculation engine:
- fills and text colours with charte tokens; white text on dark fills unless a colour is given;
- borders once per shared edge: the heavier line wins (`double` over `medium` over `thin`), the lower or right cell on a tie; `total` and `output` borders come from their cell styles;
- general alignment by value (numbers and dates right, text left, booleans and errors centred), explicit alignment, and text at the bottom of the cell;
- unwrapped text overflowing into at most 20 empty neighbours; `centerContinuous` centring across the following empty `centerContinuous` cells; wrapped text inside its row height;
- column widths and stored row heights; the workbook `font` over the whole grid;
- the `dateStyle`, `scale` (k and M suffixes) and `negative` presets.

**Commands (F03).** Formatting commands write these fields without the engine, one undoable entry each:
- bold and italic toggles, text and fill colours, borders (all, outer, inner, one side or none, in `thin`, `medium` or `double` and a text-colour token), alignment, centre across selection and wrap; a value equal to what the cell inherits is removed rather than stored, and turning off an inherited property stores it explicitly (for example `bold: false` on a header);
- whole rows or columns (header click, Shift+Space, Ctrl+Space) write `rows`/`columns` styles and update their populated cells; a rectangle of more than 50,000 cells is refused;
- column widths by dragging a header edge, a width dialog or auto-fit; wrap, width and value edits re-measure the affected rows and store `rows.N.height`;
- Copy style tiles the source rectangle's `cellStyle`, `format` and `style` over the target;
- links (`Ctrl/Cmd+K`) are stored in `links`; a click shows the target, Ctrl/Cmd-click opens a web link in a new tab with `noopener`, and an internal link selects its range;
- Clear formatting removes `cellStyle`, `format` and `style` (and row or column styles for whole rows or columns), keeping values, links and widths.

**Panels (F05) and built-in chartes (TH01).** The Styles toolbar toggle and Format › Cell styles… open the fixed catalogue; the sheet bar's settings button and File › Document settings… open the theme and font pickers; File › Regional settings… sets the display `locale`. Panels open on the right (a bottom sheet below 720 px), one at a time. `theme` selects one of four built-in chartes embedded in the editor (blue is the html-slides default; red, green and black are checked for contrast), applied as an overlay; the document's `style#charte` is never rewritten and "Document charte" removes the field. `font` picks one of six fonts for the whole grid; "Charte font" removes it. Each change is one undoable entry and needs no network.

**Download PNG (F06).** File › Download selection as PNG (also in the cell menu) draws the selected rectangle from the model at 2×: displayed values in the workbook locale, catalogue and direct formatting, borders with the shared-edge rule, alignment, wrap and overflow, conditional highlights and data bars, row heights and column widths, and grid lines when they are shown; no headers. Whole rows or columns are cut to the used range. Colours and fonts are read from cells styled exactly like the grid's, then drawn on a canvas (no `foreignObject`), so built-in chartes and the charte font apply. It needs no engine: saved results are drawn, and when they are stale (or an edit is pending) a warning band is added at the top of the image. Selections over 5,000 cells or 8,000 px on a side are refused with guidance to print to PDF; past 16 megapixels at 2× the picture is drawn at 1×. Text overflowing from cells outside the selection is not drawn. Nothing is written to the workbook.

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

## Pivot tables

Optional `pivots` holds at most 50 definitions ([ADR-014](../../../docs/decisions/014-data-pivot-tables.md)):

```json
{
  "id": "revenueByRegion",
  "name": "Revenue by region",
  "source": { "sheetId": "sales", "ref": "A1:F2001" },
  "output": { "sheetId": "summary", "ref": "B3:E9" },
  "rows": ["Region"],
  "columns": ["Quarter"],
  "filters": [{ "field": "Channel", "values": [{ "type": "text", "value": "Online" }] }],
  "values": [{ "field": "Revenue", "aggregate": "sum" }],
  "refreshed": { "fingerprint": "<64 hex>", "at": "2026-10-24T09:30:00.000Z" }
}
```

- **Source.** `source.ref` is an A1 rectangle whose first row names the fields. Without `ref`, the source is the sheet's used range from A1, leaving out other pivots' outputs on that sheet, so rows appended to a `table` sheet are included at the next refresh; such a source must be on another sheet than the output. A field is named by its header cell's text (or the canonical string of a number or Boolean) and must match exactly one header cell.
- **Fields.** `rows` (0–4), `columns` (0–2) and `filters` (0–4) use distinct fields. `values` holds 1–8 measures with `aggregate` `sum`, `count` or `average`. A filter keeps the records whose value is in its typed `values` list (`{"type":"blank"}` keeps blanks).
- **Output.** `output.ref` is the rectangle the pivot owns; its top-left cell is the anchor. Without `refreshed` it must be the anchor alone, and it never exceeds 200,000 cells. Outputs of different pivots never overlap, and an output never overlaps its own source.
- **Refresh stamp.** `refreshed.fingerprint` is the source revision: a SHA-256 of the definition and the typed values of the used fields, independent of where the source sits on its sheet. It is absent until the first refresh.

**Output cells are ordinary typed input cells**, so saved files show them without the engine, PNG downloads and print include them, and formulas may read them:
- The table has one header row per column field, then a row with the row-field names and measure labels (`Sum of Revenue`, `Count of Units`, `Average of Price`), one body row per row item, and a `Total` row when there are row fields. Total columns follow when there are column fields.
- Cell styles are `header`, `rowHeader` and `total`. SUM and AVERAGE values copy the number format of the field's first numeric source cell; labels copy the format of their item's first source cell.
- A refresh writes every cell of its new rectangle and clears what it owned outside it, keeping direct `style` on cells it overwrites. It is refused, with nothing changed, if the rectangle would cover an input or formula it does not own, or another pivot's output.
- Cell edits, pastes and fills into an owned rectangle are refused; formatting is allowed. Row and column insertions or deletions that would split or partly delete an output are refused; elsewhere they move the output whole and shift or shrink the source (a deleted source becomes `"#REF!"`).

**Semantics.**
- Rows with no populated cell across the source width are skipped; any other row is a record, even when its used fields are blank.
- Items group by typed value, without case folding or text/number coercion; signed zeros are equal. Missing and blank cells form one `(blank)` item; empty text is its own item.
- Items sort numbers, dates, text (case-insensitive by code unit, then case-sensitive), Booleans, errors, then `(blank)`.
- SUM adds numbers and dates in source order, as IronCalc's `SUM` does, and ignores text, Booleans and blanks; an overflowing sum or average is `#NUM!`. COUNT counts every non-blank value. AVERAGE divides the sum by the count of numbers and is `#DIV/0!` without one.
- An error value makes SUM and AVERAGE that error (the first one in source order); COUNT still counts it.
- A row and column combination without records stays empty. Totals aggregate the records themselves, so an average total is the average of all records.
- Limits: 10,000 row items, 500 column items, 200,000 output cells and a 5,000,000-cell source.

**Refresh and freshness.**
- Nothing refreshes automatically. Refresh runs in the calculation worker: it recalculates (so formula sources and scenarios are current), aggregates the engine's typed values, and publishes the output cells, the definition and the snapshot as one undoable step.
- The editor derives a state from the fingerprint, never saved: `current`, `stale` (source values or definition changed, including a scenario switch or an external edit), `unverified` (source formulas whose saved results are not verified), `never` or `error`. Owned cells of a pivot that is not current are hatched until it is refreshed.
- Data › Pivot tables… and Insert › Pivot table… open the panel; Data › Refresh all pivot tables refreshes each in turn.
- Calculated fields, slicers, subtotals, date grouping and "show values as" are not supported.
