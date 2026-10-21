# ADR-010 — Manual formatting and the IronCalc toolbar

Status: accepted by the user after a design review on 21 October 2026. Supersedes the tabbed native ribbon of [ADR-009](009-familiar-ribbon-without-react-runtime.md) and raises the Data code ceiling set in [ADR-003](003-html-office-and-data-runtime.md). The delivery implementation starts with the R05 spike; nothing here is implemented yet.

## Context

The [R04 assessment](../HTML-DATA-TOOLBAR-ASSESSMENT.md) showed that the actual IronCalc toolbar works against our canonical commands. About 61% of its bundle is React/React DOM and 17% is i18next; the IronCalc components themselves are about 55 kB. The user prefers IronCalc's appearance and wants its formatting features, not only the commands our current model supports. Loading the toolbar does not add workbook features: the canonical model, renderer, history and import must support them.

IronCalc's own model is not adopted as storage. It is an internal engine model, persisted as binary or XLSX with indexed style tables, and the standard document must render without loading the engine. Workbook JSON stays authoritative ([ADR-003](003-html-office-and-data-runtime.md), [ADR-005](005-data-storage.md)). We reuse IronCalc's formatting **vocabulary** (enum values, border styles, alignment names, theme slots) in readable per-cell JSON so the toolbar adapter remains thin.

## Decisions

### Layers

Effective appearance is resolved property by property: **cell style → column style → row style → cell `style` → conditional formatting** ([ADR-008](008-conditional-format-rules.md)). Formatting never changes values, invalidates calculation fingerprints or loads the calculation engine, except where stated below.

### Storage

- A cell may carry `cellStyle` (a catalogue reference), `style` (direct formatting) and `format` (number format). `cellStyle` replaces the former `role` field. The project is pre-release, so fixtures and tests are rewritten without a compatibility alias.
- `style` holds only overridden properties, using readable names aligned with ADR-008: `bold`, `italic`, `underline`, `strike`, `fontSize` (points, 1–409), `fontFamily`, `color`, `background`, `border.{top,right,bottom,left}: {style,color}`, `align.{horizontal,vertical,wrap}`.
- Column and row metadata may carry the same `style` object plus `width`/`height` in pixels (`customHeight` marks a manually set row). Stable row/column IDs carry them through structural edits.
- A **style-only cell** has no input or formula; it is blank for formulas and conditional rules. Row tables may carry style-only `cellMetadata` at null positions.
- A command that would write more than **50,000** individual cells is refused with guidance to select whole rows or columns. Full-row/column selections write row/column styles.

### Colours, theme and fonts

- A colour is either `#RRGGBB` or `{ "theme": <charte token>, "tint": -1…1 }`. Theme references follow the document's charte, so changing the charte recolours them.
- The charte gains optional Excel slot tokens `--dk1 --lt1 --dk2 --lt2 --accent1…--accent6 --hlink --folHlink`, defaulting from existing tokens (`--ink`, `--bg`, `--acc`, `--tint`, `--alert`, `--mid`, `--lig`…). Theme references may use any charte token, including these slots.
- The IronCalc theme picker lists the document charte and IronCalc's built-in themes (copied as static data). Choosing or editing a theme replaces the colour tokens of **this workbook's** embedded charte; it is undoable and may diverge from the shared Slides/Text brand. Fonts are not part of themes.
- `fontFamily` is accepted in the model (absent = charte font; a named font renders with the charte fallback stack) but has no picker, as in IronCalc. No fonts are embedded.

### Cell styles (named styles)

- One catalogue, distinct from the theme, whose colours reference the theme: our four semantic styles (`header`, `row-label`, `assumption`, `calculation`), IronCalc's built-in styles expressed with charte references, and custom styles in workbook-level `namedStyles: [{ id, name, style }]`.
- Excel "Input" and "Calculation" are our `assumption` and `calculation` (charte appearance, labelled accordingly), not duplicates. Built-in IDs are reserved lowercase names; custom styles get generated stable IDs and editable display names.
- Editing a style updates every cell using it. Deleting a style in use requires confirmation and leaves those cells without a cell style. IronCalc's custom-style editor is included.

### Geometry

- Explicit row heights and column widths in pixels; the virtual grid uses cumulative offsets and still renders only the visible viewport.
- Applying a font size or wrap measures only affected cells and grows non-custom rows in the same undoable command. There is no continuous auto-fit while scrolling. Header drag-resize and double-click auto-fit are included, with a keyboard alternative.

### Borders and alignment

- Nine IronCalc border styles. Toolbar presets (all, inner, outer, sides, centre lines, none) write only inside the selection. On a shared edge the heavier line wins; on a tie the lower/right cell wins. Dash-dot variants are approximated in CSS while the stored value stays exact. Borders draw above grid lines, survive hidden grid lines and print. **Diagonal borders are not supported** and are reported by import.
- Horizontal `general | left | center | right | centerContinuous`; vertical `top | center | bottom` (default `bottom`); `wrap` boolean. `general` aligns numbers/dates right, text left, booleans/errors centre. A **Centre across selection** entry is added to the IronCalc alignment menu by patch.
- Unwrapped text overflows into empty neighbouring cells, scanning at most 20 columns.

### Excluded from V1

- **Merged cells.** The merge button is hidden by patch. Import converts single-row centred merges to `centerContinuous` and unmerges others with diagnostics (non-anchor cells are empty in Excel).
- **Custom number-format codes.** The "Custom format" entry is removed by patch. Presets gain `dateStyle: short|long`, `scale: thousands|millions` and `negative: minus|parentheses|red|redParentheses`. Import maps unsupported codes to the nearest preset with diagnostics.
- **IronCalc's conditional-format panel.** The toolbar button opens our ADR-008 dialog. Colour scales and icon sets are possible post-V1 extensions.
- Distributed/fill/justify alignment, indentation, rotation, diagonal borders, double underline.

### Links, painter, clear, image

- `link` is `{ url }` (only `https:`, `http:`, `mailto:`; opened in a new tab with `noopener noreferrer`) or `{ sheetId, ref }` (relocated like named ranges, `#REF!` when its target is deleted). A click selects the cell and shows a popover; Cmd/Ctrl-click opens. The link dialog offers the built-in `hyperlink` cell style, checked by default.
- Copy style and Clear formatting act on `cellStyle`, `style` and `format` only. The painter tiles the source pattern, replaces rather than merges, and copies row/column styles for full selections. It does not copy values, links, dropdowns or conditional rules. Clear removes empty style-only cells and keeps values, links, dropdowns, conditional rules and dimensions.
- **Download PNG** renders an SVG of the selection from the model (displayed values, styles, borders, alignment, overflow, conditional highlights/bars, dimensions; no headers), then rasterises it at 2× through a canvas without `foreignObject`. Saved results are used without the engine; stale results add a warning band inside the image. Selections are capped (about 5,000 cells or 8,000 px) with guidance to use print/PDF.

### Regional settings

The IronCalc regional-settings panel is included. Its **locale** maps to the existing display `locale`. Formulas keep English function names and separators (ADR-003). R05 records how the panel's **language** (interface translations) and **time zone** (which affects volatile date functions and is therefore calculation-relevant) map to the model, with measured size, before either becomes a document field.

### Interface layout

A single IronCalc toolbar band replaces the tabbed ribbon, following the IronCalc application layout:

1. A thin file bar: workbook name, save status, `File` / `Insert` / `Data` menus for our product commands (save and save a copy, rows/columns/sheets, dropdowns, data-bar settings, later import/export/charts), and an always-visible scenario selector.
2. The complete IronCalc toolbar, including undo/redo.
3. The formula bar; 4. the grid; 5. sheet tabs with our groups at the bottom.

Menus use ARIA `menubar`/`menu` with keyboard navigation. Row/column header context menus provide insert, delete and resize. Shortcuts for save, undo/redo and emphasis work everywhere.

### Delivery and budget

- The standard-mode ceiling for **HTML Data** embedded application code becomes **750,000 uncompressed bytes**. HTML Text keeps 500,000 until decided separately.
- The toolbar is always embedded; no CDN UI request in standard mode. Only the calculation engine (and later charts/import components) loads on demand. `--offline` is unchanged.
- The toolbar is forked from pinned IronCalc onto **Preact** (`preact/compat`) instead of React, with a static dictionary instead of i18next and build-time SVG icons. The R05 spike confirms size and compatibility before the production migration. Preact is the first UI framework in the Data runtime; it is embedded and pinned, and updates require re-running the toolbar test suite.

## Consequences

The canonical schema, renderer, history, clipboard, structure relocation, print and import grow substantially; each is delivered as a separate increment with the existing review and performance gates. Viewing remains engine-free and request-free. Native tabbed ribbon tests are replaced by file bar/toolbar tests when the migration lands. Remaining headroom for import, charts, pivots and exports is measured after R05 and tracked in the progress ledger.
