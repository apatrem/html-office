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

## Charts

Optional `charts` holds at most 50 charts (T18, [ADR-013](../../../docs/decisions/013-cross-product-clipboard.md) §4). A chart stores the chart-level options of the shared Slides chart contract (`packages/shared/charts/`) plus one binding:

```json
{
  "id": "revenueTrend",
  "sheetId": "summary",
  "anchor": "D2",
  "width": 600,
  "height": 300,
  "type": "line",
  "options": { "title": "Monthly revenue and net income", "unit": "EUR", "decimals": 0 },
  "source": { "sheetId": "chartdata", "ref": "A1:C25" },
  "preview": { "svg": "<svg …>…</svg>", "revision": "<64 hex>" }
}
```

- **Type and options.** `type` is one of the Slides chart types (`column`, `hbar`, `stacked`, `line`, `waterfall`, `bubble`, `gantt`). `options` holds only chart-level fields, checked by the shared strict schema: `title`, `unit`, `decimals`, `prefix`, `suffix`, `highlight`, and per type `percent`/`horizontal`/`totals`, `labels`/`scale`, `increase`, `xLabel`/`yLabel`/`xUnit`/`yUnit`/`xRef`/`yRef`. Data arrays (`categories`, `series`, `items`, `points`, `tasks`) are refused: they come from the binding.
- **Binding.** `source.ref` is one rectangular A1 block, header row first, whose columns follow the type's table adapter:
  - `column`, `hbar`, `line`, `stacked`: a category column, then one column per series, named by the header row;
  - `waterfall`: label, value, total (`TRUE`, or text such as `y`);
  - `bubble`: name, x, y, size;
  - `gantt`: task, start, end, group, highlight (fewer trailing columns are allowed).
- **Derived data.** The chart JSON is the adapter's `fromRows` over the block's typed values, recomputed after every change and never saved. Labels use the displayed text. Numbers and dates keep full precision, so number formats never round what a chart draws. Gantt dates become ISO text. In category charts, blanks, text, errors and missing formula results become missing points (`null`). Other types need every value: the chart is shown as invalid, naming the offending cells (including dates the grid shows as `####`). Formula values come from the saved results; while those are not verified (header formulas included), the chart says its values are not recalculated.
- **Placement.** `anchor` is the top-left cell on `sheetId`. `width` is 160–2,000 px and `height` 120–1,600 px. The title and unit are drawn above the plot, as in Slides.
- **Preview.** `preview.svg` is the plot drawn by ECharts' SVG renderer, at most 2 Mi UTF-16 code units, starting with `<svg`. It is shown as an image, so it never runs scripts or loads resources, and viewing or printing needs neither ECharts nor a network. `preview.revision` is the SHA-256 of what it shows: type, chart JSON, size and the effective charte colours and font, so a new charte or built-in theme also makes it out of date. A preview whose revision no longer matches is out of date. Missing and out-of-date previews are marked in the editor. Saving writes the drawings of charts redrawn in this session; other previews are kept as they were. Drawings are made without interactive state (legend toggles, hover), and one longer than the limit is not kept: the chart then reopens without a preview. The repository build draws missing previews from the saved results. Never write a preview by hand.
- **ECharts.** The editor loads the pinned, SRI-verified library only to draw or edit charts: after a chart command, after Redraw, or when a workbook change leaves a chart on screen out of date. A blocked or tampered library leaves the saved previews in place, marked out of date. Offline builds embed the same verified bytes as inert text (`script#echarts-source`, `type="text/plain"`), run only when a chart is first drawn or edited, so a workbook without charts never executes it. Once the library is available, a chart creates its ECharts instance only when it first scrolls into view.
- **Structural edits.** A chart moves with its anchor cell (to the first surviving row or column when its own is deleted). Its data range shifts and shrinks like a dropdown source; a deleted range becomes `"#REF!"`, and the chart says its data range was deleted. Undo restores both. Charts own no cells and never block row or column operations; a chart may read a pivot table's output.
- **Commands.** Insert › Chart… creates a chart from the selection, placed two columns to its right. Format › Chart settings… opens the selected chart in the side panel: type, data range, options and placement. Edit › Duplicate chart copies it with the same binding, and Edit › Delete chart (or Delete on the selected chart) removes it. Data › Redraw charts loads the library. Every change is one undoable step and needs no calculation engine. Chart copy and paste between documents are cross task X02d.

## Imported sources

Optional `sources` holds at most 100 descriptions of imported files (T15). The imported values are ordinary cells of a `table` sheet; a source only says where they came from, so the file reopens and stays editable without the original file or its path.

```json
{
  "id": "source-1",
  "sheetId": "import-1",
  "ref": "A1:E4",
  "kind": "csv",
  "file": { "name": "ventes.csv", "bytes": 182, "modified": "2026-10-28T09:12:00.000Z", "sha256": "<64 hex>" },
  "importedAt": "2026-10-28T10:00:00.000Z",
  "options": { "encoding": "windows-1252", "delimiter": ";", "header": true, "decimal": "comma", "dates": "dmy" },
  "columns": [{ "name": "Région", "type": "auto", "fingerprint": "<64 hex>" }]
}
```

- **File.** `name` is the file name only, never a path (browsers do not give one). `bytes`, the optional `modified` time and `sha256` of the bytes identify the version that was read.
- **Kind.** `csv` or `xlsx`. An `xlsx` source is one worksheet of the file: `options` is `{"sheet": "<its name in the file>", "header": true|false}` and every column type is `auto`.
- **Options.** How a CSV file was read: `encoding` (`utf-8`, `windows-1252`, `macintosh`, `iso-8859-15`, `utf-16le`, `utf-16be`), `delimiter` (`,` `;` tab `|`), whether the first row held column names, the decimal separator (`point` or `comma`) and the date order (`dmy` or `mdy`; ISO dates read the same in both). A refresh (T16) reads a replacement file the same way.
- **Columns.** One entry per source column, left to right: the header text (or the column letter without a header row), the type the person chose (`auto`, `text`, `number`, `date`, `boolean`), and a SHA-256 `fingerprint` of the column's typed inputs at import, header included. A refresh compares fingerprints to tell which columns were edited by hand since.
- **Range.** `ref` shifts and shrinks with row and column operations like a dropdown source; a deleted range becomes `"#REF!"`. A column inserted inside the range is recorded in `columns` as `{"inserted": true}` (the person's own column, which a refresh leaves alone); a deleted column leaves the list.

Reading a CSV (Data › Import CSV…):

- The file is read in the page and never uploaded. The importer is a separate script (`script#import-source`, inert text) that runs only when a file is picked; the import itself recalculates with the same IronCalc worker as any edit.
- Encoding: a byte-order mark decides, otherwise strict UTF-8, otherwise Windows-1252 (what Excel for Windows writes), with a note. The delimiter comes from an Excel `sep=` first line, or is the one giving the most consistent field count over the first 50 records (on a tie: tab, semicolon, then comma, since a decimal comma splits as evenly as the real delimiter).
- Fields follow RFC 4180: quoted delimiters, doubled quotes and multiline fields (line breaks stored as `\n`). A quote inside an unquoted field is kept as text and counted; an unclosed quote refuses the file with its line number. Shorter rows are padded with missing cells and counted. Empty fields are missing cells. Limits: 64 MB, 2,000,000 cells, Excel's row and column counts; a larger file is refused, never truncated.
- Values are typed one by one, as Excel does: `TRUE`/`FALSE` (and `VRAI`/`FAUX`), dates (ISO, year-first, day-first or month-first with `/`, `.` or `-`, two-digit years as in Excel, optional time, ISO seconds with their fraction), then numbers (thousands grouped with spaces under either convention, with commas under the decimal point or points under the decimal comma; a sign or accounting parentheses; `$ € £ ¥` giving a currency format; a trailing `%` giving a percent). Everything else is literal text; text that looks like a formula stays text and is counted. A column with a value that cannot be an ordinary number under the possible conventions (the chosen one, or both while undecided) because of a leading zero (grouped or not) or more than 15 significant digits for a value of 10¹⁵ or more (including decimal and scientific forms) stays text, so codes and identifiers keep every digit. The person may set a column to Text, Number, Date or TRUE/FALSE; values that do not read as that type stay text and are counted.
- The decimal separator and the date order are decided from the values that will be typed: the header row and columns kept as text (by the rule above or by the person) say nothing, a column set to Number says nothing about dates, and one set to Date nothing about decimals. A first-row value that reads as a number or date under any convention is not a column name. A value that reads only one way decides. When values read both ways (`1,234`, `03/04/2026`) or the file mixes conventions, the import is blocked until the person chooses. Nothing is guessed.
- A first row of distinct labels over typed data is a header (style `header`), which the person may override. The import adds one `table` sheet in Raw Data, named after the file, and its source, as one undoable step.

Reading an XLSX workbook (Data › Import XLSX…, ADR-015):

- The reader is SheetJS Community Edition 0.20.3 (`xlsx.mini.min.js`, Apache-2.0), pinned by its SHA-384. Offline builds embed it (`script#xlsx-source`, base64, inert); standard builds fetch it from `https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.mini.min.js` only when an XLSX file is picked (anonymous CORS, no credentials, no referrer). Either way its digest is checked before it runs, and it runs only in a worker whose network functions are removed, with the file's bytes; the page receives plain values. The file is never uploaded. Password-protected files and Excel 97–2003 `.xls` files are refused with guidance. Limits: 64 MB and 2,000,000 cells; a sheet whose used range (A1 to its last cell) spans more than 10,000,000 cells is not offered, and the note says so.
- The person chooses the worksheets (visible ones are chosen; hidden ones may be added) and sees the first 20 rows and 30 columns of each, with the formulas behind saved values. Each chosen worksheet becomes a `table` sheet in Raw Data with its own source, at the same cell addresses; a name the workbook already has gets a ` (2)` suffix and formulas follow. Workbook-wide named ranges of one rectangle on an imported sheet become named ranges when the name is free.
- Values keep their types: text (leading zeros included), numbers, TRUE/FALSE, errors, and numbers with a date format as dates (from the 1904 system converted to 1900). Number formats become Data's presets (number, percent, currency, accounting, digits, thousands or millions, negative styles) only where one shows the value as Excel does; others (zero padding such as `00000`, units such as `0.00" kg"`, fractions, scientific) are shown as General, and times of day and elapsed durations (`[h]:mm`) stay numbers (Data has no time format). Both are counted.
- Formulas are imported and recalculated by IronCalc. A formula Data cannot run is imported as the value the file saved, with the reason counted: another workbook (external link), an Excel table reference, a range across sheets, a sheet not imported, an array formula, or a named range the file defines that is not imported (it must not read a workbook name of the same name). Such a formula without a saved value is left empty, and that is named separately. In a 1904 workbook, a formula showing a date keeps the (converted) date it saved, since its date arithmetic counts from 1904. Names follow Excel's scopes: a name local to a sheet blocks only formulas on that sheet (or qualified with it). After the import, formulas whose recalculated result differs from the file's saved value (a function or name Data lacks) are reported with an example.
- Not imported, and named before anything changes: macros (never run), data connections and queries (never run), ActiveX controls, links to other workbooks, pivot tables (their saved cells are imported), charts, pictures, embedded objects, slicers, comments, hyperlinks, merged ranges, conditional formats, data validation, sheet protection, fonts, colours, borders, widths and heights.

Refreshing a source (Data › Refresh source…, T16):

- The person picks a replacement file for the source of the current sheet; there is no live link, and the workbook never needs the original file. The file is read like the source was (saved options and column types by name), and the options can be changed in the dialog.
- Columns match by header text (by position without a header row). An existing column the new file lacks blocks the refresh until the person chooses: take another column of the new file (a rename), clear the column, or keep its current values. Columns of the new file nobody takes are added on the right. Existing columns keep their positions, so formulas reading them by position stay right. A column cleared by a refresh is recorded with an empty name and stays cleared.
- The dialog shows, before anything changes: rows before and after, per column the number of changed values with examples, the new range, and what follows from it. Formulas that will recalculate are counted by sheet: those reading the source range (directly or through a named range) and every formula that follows them on any sheet, with the sheets each group follows. Pivot tables and charts reading a changed cell, named ranges over one, and the conditional rules and dropdowns of the sheet are listed too. References are read from the formula text: INDIRECT counts as reading the source range, OFFSET as reading the whole sheet. On a very large workbook the count stops after a fixed amount of work and says more formulas may follow.
- Hand edits: a column whose fingerprint no longer matches was edited since the import or last refresh. If the refresh would change it (including a kept column losing rows the new file no longer has), the person must confirm replacing those edits. Once Refresh is clicked the plan is locked; closing the dialog while it commits cancels it.
- New rows or columns may only write empty cells outside the old range; otherwise the refresh is refused until those cells are moved.
- A refreshed cell takes the file's value and keeps its presentation (cell style, direct style, and a number format the person set). A value that disappears leaves a style-only cell where the cell was formatted.
- An XLSX source is refreshed from one worksheet of the replacement workbook, by default the one with the source's sheet name. Formulas come with the values. Those reading another sheet of the file follow the sheet imported from it from the same workbook (a source with the same file name or bytes); any other sheet counts as not imported. Formulas using a name the replacement defines differently from the workbook keep their saved values. When the refresh puts the file's columns at other positions, formula references to the sheet's own columns move with them; a range whose columns would no longer sit together in the same order keeps its saved value, and the dialog counts those; one with no saved value would be left empty, which the person must confirm. References follow the source's rows too when rows were inserted above it.
- The refresh is one undoable calculation step: changed cells and the updated source (range, file, time, options, columns and new fingerprints). Pivot tables reading the sheet become out of date until refreshed; charts redraw; conditional rules and formulas follow the recalculated values.

## CSV export

File › Export sheet as CSV… writes the selected sheet from A1 to its last cell holding a formula or a non-blank input (style-only cells and explicit blanks do not extend it), so cell positions survive. Every row has the same number of fields. Formulas, formatting, links, charts and other sheets are never exported. The file is UTF-8 with a byte-order mark, CRLF line ends and RFC 4180 quoting (a field holding the separator, a quote, a line break or edge spaces is quoted, quotes doubled).

- **Calculated values** (default): numbers at full precision (shortest round-trip form, no grouping, currency, percent scaling or `k`/`M`), date-formatted numbers as ISO `yyyy-mm-dd` (with ` hh:mm:ss` when there is a time; serial 60 is `1900-02-29`; out-of-range serials stay numbers), `TRUE`/`FALSE`, error codes such as `#DIV/0!`, and text as stored.
- **Displayed text**: each value exactly as the grid shows it in the workbook `locale`.
- **Separators**: by default from the workbook `locale`. A locale whose decimal mark is a comma (for example `fr-FR`, `de-DE`) gets semicolons and decimal commas, as Excel expects there; others get commas and decimal points. The dialog offers the other pair.
- **Formula-like text**: text whose first character, after any spaces, control characters (NUL included) or invisible characters (zero-width, soft hyphen, byte-order mark), is `=`, `+`, `-` or `@` (or their full-width forms), or that starts with a tab or carriage return, gets a leading apostrophe so spreadsheets read it as text (CSV injection). Numbers are never altered.
- **Stale or missing results**: the export needs an explicit choice when a formula on the sheet has no saved result, when the sheet has formulas and the saved results are not verified as current, or when a pivot table writing to the sheet is out of date. *Recalculate and export* recalculates with the engine first (and refreshes the pivot tables when one is out of date); *Export saved values* writes the saved values as they are, leaves formulas without a result empty and adds `-stale` to the file name. An edit that failed to calculate is not part of the workbook and is not exported.
- Dates whose time rounds past 9999-12-31 23:59:59 stay numbers.
- Sheets of more than 10,000,000 fields (rows × columns from A1) are refused. XLSX export is deferred.

## Print / PDF

File › Print / PDF… (or Cmd/Ctrl+P) prints the selected sheet; the browser's print dialog offers Save as PDF. Printing reads the model only: no engine, no network, and the workbook is not changed.

- **Range**: from A1 to the last cell record, style-only cells included. Empty sheets and prints of more than 50,000 cells are refused (export CSV instead).
- **Look**: the grid's rules, as for the PNG download: displayed values with their number formats, cell styles and direct formatting, borders (each shared edge once, heavier wins), alignment, wrap, overflow into empty cells (clipped at the printed columns), conditional highlights and data bars, column widths and row heights, grid lines as shown on screen. No headers, selection or other editor chrome.
- **Pages**: A4 or Letter (Letter by default for `en-US` and other Letter regions), portrait or landscape (landscape by default when portrait would need scaling), 12 mm margins. Rows never split across pages. Leading rows whose filled cells all use the `header` cell style repeat at the top of every page by default (0–5 rows, adjustable, and never more than a quarter of the printed page high, the most browsers repeat). Repetition is the browser's: Chrome and Edge repeat them; Safari may print them on the first page only.
- **Wide sheets**: fitted to the page width when that keeps at least 60% of the size; otherwise split into pages across, each starting with the first column (0–5 repeated columns, adjustable). Either can be chosen.
- **Charts** on the sheet follow the table, each kept on one page, as the drawing shown on screen: the live drawing, or the saved SVG preview; a note marks a missing or out-of-date preview.
- **Stale results**: unverified saved results, an uncalculated edit, or a pivot table on the sheet not known to be current (out of date, or its check pending or failed) add the PNG's warning band at the top.
- The browser's own Print command prints the sheet with the defaults; a refused sheet prints the reason instead of the editor.

## Tools and patches

`tools/workbook.mjs` (Node 18+) works on this canonical JSON inside an HTML Data file and rewrites only `script#workbook`; everything else in the file stays byte-identical. The [examples](../examples/README.md) double as its test fixtures.

| Command | What it does |
| --- | --- |
| `new OUT --model model.json [--offline] [--charte f.css] [--force]` | Validates a canonical workbook, calculates every result, draws chart previews and writes a standard or offline file |
| `extract FILE [--out model.json] [--charte-out theme.css]` | Prints the canonical JSON; `--charte-out` also writes the file's brand stylesheet (`style#charte`) for `new --charte` |
| `inspect FILE [--range Sheet!A1:D20] [--json]` | Summarises sheets, results, pivots, charts and imported sources, or lists up to 5,000 cells with their displayed text |
| `apply FILE PATCH (--out OUT \| --in-place) [--no-recalculate] [--refresh-pivots] [--dry-run]` | Validates the patch, writes it, recalculates, redraws out-of-date previews, and refuses any change outside the patch |
| `recalculate FILE (--out OUT \| --in-place) [--refresh-pivots]` | Recalculates every result, optionally refreshes pivot tables, and redraws previews |
| `validate FILE [--range R] [--since BEFORE --allow R1,R2 --allow-fields F1,F2] [--allow-stale]` | Reports missing or stale results, stale pivots and previews, error results in a range, and changes not allowed since BEFORE: cells outside the `--allow` ranges, and workbook fields not named in `--allow-fields` (those a patch replaced with `set`). Results, chart previews and pivot stamps and extents are caches; a pivot's anchor cell is not |

A command that finds errors lists them all, each with its location (`Sheet!A1`, `edits[2]`, `rows[0].values[1][3]`, `set.x`, `workbook`), writes nothing and exits with code 1; usage errors exit with 2. Outputs are written to a temporary file and then renamed, so an interrupted write never leaves a partial file. Caches may change in any edit (results, chart previews, pivot stamps and pivot output cells); everything else outside the patch, including chart and pivot definitions, must stay identical.

A patch is a JSON object:

```json
{
  "edits": [
    { "sheet": "Inputs", "ref": "B4", "cell": { "input": { "type": "number", "value": 40 } } },
    { "sheet": "Budget", "ref": "A6", "cell": { "cellStyle": "note" } },
    { "sheet": "Budget", "ref": "C9", "cell": null }
  ],
  "rows": [{ "sheet": "Sales", "at": "A10", "values": [["West", "Q2", 7, true, null]] }],
  "set": { "theme": "green" }
}
```

- `edits`: `sheet` is a stable ID or an exact name. A cell replaces the input or formula. Presentation fields it leaves out (`cellStyle`, `format`, `style`) are kept, `null` removes one, and a cell with only presentation fields keeps its value. `null` deletes the cell. `result` is never written: recalculation computes it.
- `rows`: rectangular blocks of JSON numbers, strings and booleans written as typed inputs from `at`; `null` leaves a cell unchanged. Use `edits` for dates, errors and formulas.
- `set`: replaces whole workbook fields: `validations`, `scenario`, `conditionalFormats`, `pivots`, `charts`, `names`, `groups`, `locale`, `theme`, `font`, `metadata` (`null` removes one). Sheets are added, renamed or reordered in the browser.
- Pivot output cells and formulas in the scenario selector are refused. Every patch is validated as a whole: a refused patch changes nothing.
- `sources` is not settable: imported files are read, and refreshed, only in the browser (Data › Import CSV…, Import XLSX…, Refresh source…), and `validate --since` reports any change to it. Patching cells of an imported sheet is a hand edit: the source's column fingerprints no longer match, so a later refresh asks before replacing those values.

