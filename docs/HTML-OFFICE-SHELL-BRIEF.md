# html-office editor shell: design brief and audit (U01)

22 October 2026. Task U01 of the [cross-product plan](HTML-OFFICE-CROSS-PLAN.md). Docs only: nothing here changes product code. It feeds the mock-ups of U02 ([`docs/mockups/shell/`](mockups/shell/index.html)) and the user's choice in U03, which accepts [ADR-011](decisions/011-html-office-shared-principles.md) §7.

## 1. Purpose

Slides, Data and Text should look and behave like one family: the same top area, the same buttons and swatches, the same place for document settings, the same panels and the same narrow-width rules. Each product keeps its own canvas (slide, grid, page) and its own product-specific strip (Data's formula bar, Slides' thumbnails).

This brief records what exists today, every command each product exposes or has planned, and the constraints any shell must meet. It does not choose a layout.

## 2. Sources audited

| Product | Source | State |
| --- | --- | --- |
| Slides | `src/engine/view.js` (`toolbar`, `sidebar`, `helpPanel`, `UI_CSS`), `src/engine/editor.js` (panels, keyboard), `src/engine/templates.js` (layouts, elements, shapes, chart types), `src/engine/main.js` (handler map) | Shipped (plugin 0.7.1) |
| Data, native ribbon | `packages/data/tools/ribbon.mjs` (markup), `packages/data/runtime/ribbon.mjs` (tabs, layout), `packages/data/tools/build.mjs` (dialogs, grid, notices), `packages/data/tools/conditional-controls.mjs`, `packages/data/runtime/sheets.mjs` (sheet groups) | Working default until U04 |
| Data, IronCalc on Preact (R05) | `tools/ribbon-assessment/preact/` ([report](HTML-DATA-PREACT-SPIKE.md)), [ADR-010](decisions/010-manual-formatting-and-ironcalc-toolbar.md) "Interface layout", [ADR-012](decisions/012-data-formatting-vocabulary.md) §11 | Spike, measured before ADR-012; its trimming is still to do |
| Text | [HTML-TEXT-V1](HTML-TEXT-V1.md), [HTML-TEXT-PLAN](HTML-TEXT-PLAN.md) T06–T14, [ADR-004](decisions/004-html-text-format-and-editor.md) | Specified, not started |
| All | [ADR-011](decisions/011-html-office-shared-principles.md) §4, §6, §7, §10; [ADR-012](decisions/012-data-formatting-vocabulary.md); `src/theme/default.css` (charte tokens) | Accepted / proposed |

## 3. Current shells

### Slides

Already a two-row layout, but only in edit mode.

- **Reading mode:** the slides only, with a floating **pill** bottom right: Edit, Present, PDF, and Save when there are unsaved changes.
- **Edit mode:**
  - **Top bar** (48 px, fixed): document title; Undo, Redo; insert commands (Text, Shape ▾, Block ▾, Image, Table, Chart ▾); spacer; PDF, Save (orange when dirty), Done, Help.
  - **Context bar** (40 px, fixed, grey): changes with the selection. Nothing selected shows slide commands; a selected element shows text, colour, fill, arrange, and chart or table groups. Labels disappear in `compact` and `tiny` modes; the bar scrolls horizontally with a hidden scrollbar.
  - **Left sidebar** (196 px): thumbnails (click to go, drag to reorder) and a New slide ▾ button.
  - **Panels** are centred modal overlays (`.hs-panel`): Footer, Chart data, Help.
  - **Notifications** are banners (draft recovery, save fallback, ECharts unavailable).
- Toolbar chrome uses fixed greys and `system-ui`, not the charte; the canvas uses the charte.

### Data, native ribbon (ADR-009)

A vertical stack inside a page that also shows a document header:

1. Header: "HTML OFFICE · DATA · PREVIEW", title, engine and storage notes.
2. **Quick access**: DATA mark, Save, Save a copy, Undo, Redo.
3. **Ribbon**: tabs Home and Data (ARIA `tablist`, arrow/Home/End keys); groups labelled underneath.
4. **Editor context**: current sheet, and the scenario and dropdown-value selectors when relevant.
5. **Formula bar**: cell address, input type, value, Apply edit, Cancel calculation, Retry pending range.
6. Status lines (`#status`, `#save-status`), the grid, `#preview-note`, then **sheet groups** at the bottom (collapsible groups with ↑/↓ reordering and sheet buttons).
7. Embedded format guide and third-party notices as `<details>` under the editor.

Dialogs (`<dialog>`): conditional formatting, dropdown settings, manage sheets, paste table, recover unsaved work. Most commands are text buttons; there are no icons.

### Data, IronCalc toolbar on Preact (R05, ADR-010)

ADR-010 planned a **single toolbar band**: a thin file bar (name, save status, File / Insert / Data menus, scenario selector), the full IronCalc icon toolbar, the formula bar, the grid, and sheet tabs with groups at the bottom. A **right drawer** (360 px) hosts cell styles, themes and regional settings; links use a modal dialog. ADR-012 requires removing font size, underline, strike, vertical alignment, the theme drawer and the custom-style editor from that toolbar, and replacing the colour picker with charte swatches. The R05 spike predates ADR-012 and still contains them, so its sizes are the untrimmed baseline. ADR-011 §7 puts the layout itself on hold until U03.

R05 findings that constrain any shell: the toolbar needs its own stacking level above the grid; IronCalc's `Inter` must map to the charte font; several IronCalc fields rely on placeholders and need labels; the toolbar scrolls horizontally with keyboard-operable overflow arrows at 320 px.

### Text (planned)

No interface exists. The specification implies: a block-style picker (title, subtitle, H1–H4, body, lead, quote, callouts, caption, code), inline formatting, lists, alignment, links, page breaks, tables with merge/split, charts and wrapped images, footnotes, cross-references, table of contents, comments with a **comments panel**, a read-only Markdown view, print preview, page format, and the same save states as Data. Editing happens at the fixed text width of the page format.

## 4. Command inventory

"Where" is today's location. Shortcuts are listed where they exist. **Planned** commands come from accepted ADRs or plan tasks and must have a place in the shell even though they are not built yet.

### 4.1 Slides (shipped)

| Group | Command | Where | Shortcut |
| --- | --- | --- | --- |
| Mode | Edit / Done | Pill (reading), top bar (editing) | E |
| | Present | Pill | P; arrows, Space, PageUp/Down, Escape |
| | Help and shortcuts; File format guide | Top bar → modal | ? |
| File | Save (direct, or Save a copy fallback in Safari/Firefox) | Top bar, pill | Cmd+S |
| | Print / PDF | Top bar, pill | — |
| | Draft recovery (restore / discard) | Banner on open | — |
| History | Undo, Redo | Top bar | Cmd+Z, Cmd+Shift+Z, Cmd+Y |
| Insert | Text box | Top bar | — |
| | Shape ▾: rectangle, rounded rectangle, ellipse, triangle, diamond, hexagon, parallelogram, pentagon arrow, chevron, right/left/up/down arrow; thin arrow → and ↓; rule | Top bar menu | — |
| | Block ▾: box, tinted box, callout, key figure | Top bar menu | — |
| | Image (embedded) | Top bar | — |
| | Table | Top bar | — |
| | Chart ▾: columns, horizontal bars, stacked bars, lines, waterfall, bubbles, Gantt | Top bar menu | — |
| Slide | New slide ▾ (12 layouts) | Sidebar | — |
| | Layout ▾ (title only, impact title, left title, section divider, quote, panel 1/4, 1/3, 1/2, 2/3, three lines, cover, end) | Context bar, slide | — |
| | Reset layout | Context bar, slide | — |
| | Footer text and hide on this slide | Context bar → modal | — |
| | Duplicate slide, delete slide | Context bar, slide | — |
| | Go to / reorder slides | Sidebar thumbnails (drag) | — |
| Text | Bold, italic | Context bar, element | Cmd+B, Cmd+I |
| | Smaller / larger text (`fs-*` steps) | Context bar, element | — |
| | Align left, centre, right | Context bar, element | — |
| Colour | Text: ink, acc, mid, alert, t2, bg | Context bar swatches | — |
| | Fill: none, tint, lig, mid, acc, alert, dark | Context bar swatches | — |
| | Clear formatting | Context bar | — |
| Arrange | Align left/centre/right/top/middle/bottom; distribute horizontally/vertically; bring forward, send backward | Context bar → Arrange ▾ | Cmd+], Cmd+[ |
| Element | Duplicate, delete | Context bar | Cmd+D, Delete |
| | Move, resize, nudge (8 px, Alt 1 px), free move, keep ratio | Canvas | Arrows, Alt, Shift |
| | Type in element | Canvas | Double-click, Enter; Escape |
| Chart | Edit data (title, unit, highlight, rows, series, advanced JSON) | Context bar → modal | — |
| Table | Insert/delete row, insert/delete column | Context bar | — |
| **Planned** | Theme (4 built-ins + document charte), document font (body only) | ADR-011 §10, TH02; no place yet | — |

### 4.2 Data (native ribbon today, plus planned)

| Group | Command | Where today | Planned by |
| --- | --- | --- | --- |
| File | Save, Save a copy | Quick access | — |
| | Recover draft (restore / discard) | Modal on open | — |
| | Embedded guide, third-party notices | `<details>` under the editor | L01 |
| | Export CSV, print / PDF of selected sheets | — | T19 |
| | Download PNG of selection | File menu, cell menu (F06) | — |
| | Import CSV / XLSX, refresh source | — | T15, T16 |
| History | Undo, Redo | Quick access | — |
| Clipboard | Copy and paste ranges with formats (`application/x-html-office-range+json`, plus TSV) | Grid, Cmd/Ctrl+C and V | X01 extends it across products |
| | Paste table (Excel / Markdown / CSV, value typing) | Home → modal | — |
| | Fill down, fill right | Home | — |
| | Copy style (painter), clear formatting | — | F03 |
| Styles | Cell style: normal, header, row label, assumption, calculation | Home select + Format selection | ADR-012: 11-style catalogue panel (adds title, output, total, note, alert, hyperlink) |
| | Conditional formatting (highlight, data bar) | Home → modal | ADR-012 §10 tokens |
| Number | Format: general, number, currency, accounting, date, percent; decimals; currency code; more decimals | Home | ADR-010 presets: short/long date, thousands/millions, negative styles; fewer decimals |
| Font | Bold, italic | — | ADR-012 §3 |
| Colour | Text colour (6 tokens), fill (7 tokens) | — | ADR-012 §2 |
| Borders | Four sides × none/thin/medium/double, colour token; presets (all, inner, outer, none…) | — | ADR-012 §5 |
| Alignment | General/left/centre/right, centre across selection, wrap | — | ADR-012 §6 |
| Cells | Insert/delete rows, insert/delete columns | Home | Header context menus (ADR-010) |
| | Column width (drag, keyboard, auto-fit) | — | F03 |
| | Link (https, http, mailto, internal sheet/cell) and link popover | — | F03 |
| Sheets | Manage sheets: create, rename, move to group, earlier, later | Home → modal | — |
| | Select sheet; collapse/expand group; move group earlier/later | Bottom sheet groups | — |
| Calculate | Recalculate; cancel calculation; retry pending range | Home; formula bar | — |
| Data | Dropdown settings (list or range, scenario selector) | Data tab → modal | — |
| | Scenario selector; dropdown value | Editor context strip | Always visible (ADR-010) |
| | Pivot, charts | — | T17, T18 |
| Edit | Cell address, input type, value, apply edit; F2 edits the active cell | Formula bar, grid | — |
| View | Grid lines on/off | — | ADR-010 |
| Document settings | Theme (blue, red, green, black, document charte) | — | ADR-012 §9, TH02 |
| | Document font (6 fonts) | — | ADR-012 §4, TH02 |
| | Regional settings: locale (display); time zone under review | — | ADR-010, F05 |

### 4.3 Text (all planned)

| Group | Command | Source |
| --- | --- | --- |
| File | Save (Chrome/Edge direct), Save a copy, draft recovery | Spec "Browsers and saving", T05 |
| | Print preview, PDF | T14, spec "Outputs" |
| | Export Markdown, read-only Markdown view | T15 |
| | Read-only Markdown view | Spec "Canonical document" |
| | Import Markdown (paste mapping) | T07 |
| History | Undo, Redo | ProseMirror history |
| Blocks | Title, subtitle, H1–H4, body, lead, quote, callout (note, warning, key message), caption, code | T06 |
| Lists | Bulleted, numbered, indent, outdent | T06 |
| Inline | Bold, italic, underline, superscript, subscript, inline code, highlight, link | T06 |
| Paragraph | Align left, centre, right, justify (`ta-l/c/r/j`) | Spec "Styles and theme" |
| | Page break, start on a new page | T06 |
| Insert | Table, chart (Slides types), image (full width or wrapped left/right), footnote, cross-reference, table of contents | T08–T12 |
| Table | Insert/delete row/column, merge, split, header row, total row, emphasis column, compact density, column widths | T10 |
| Figure | Chart data (shared panel), width text/full, caption; image alt, width, wrap side | T11, T12 |
| Structure | Heading numbers on/off and format per level; outline / go to section | T08, spec |
| Review | Add comment, reply, resolve, reopen; orphan recovery (confirm candidate) | T13 |
| Document settings | Page format A4/Letter, margins, running header/footer | T14 |
| | Theme (4 built-ins + document charte), document font (body only) | ADR-011 §10, TH02 |

### 4.4 Shared command families

The shell's job is to put these in the same place and with the same control in all three products.

| Family | Slides | Data | Text | Proposed shared control |
| --- | --- | --- | --- | --- |
| Save, save a copy, print/PDF, recovery | ✓ | ✓ | ✓ | File area; one save-state indicator |
| Undo, redo | ✓ | ✓ | ✓ | Always-visible pair, top-left |
| Bold, italic | ✓ | planned | ✓ (+ underline, sup/sub) | Toggle buttons |
| Text colour (6 tokens) | ✓ | planned | — (highlight only) | One swatch component |
| Fill (7 tokens) | ✓ | planned | — (callouts by style) | Same swatch component |
| Horizontal alignment | ✓ (L/C/R) | planned (+ general, across, wrap) | ✓ (+ justify) | Segmented buttons or menu |
| Styles from a closed catalogue | layouts, blocks | 11 cell styles | block styles | Style picker / gallery |
| Insert table, chart, image | ✓ | charts planned | ✓ | Insert area |
| Chart data editing | ✓ | planned | ✓ | Shared chart panel |
| Theme and document font | planned | planned | planned | **Document settings** (ADR-011 §10) |
| Help, shortcuts, embedded guide | ✓ | `<details>` | planned | Help menu |
| Side panel | — (modals) | right drawer (R05) | comments | One drawer component |

## 5. Constraints

### Accessibility and keyboard

- Every command reachable by keyboard; visible focus; no hover-only command.
- Toolbars follow the ARIA `toolbar` pattern (one tab stop, arrow keys inside) or `tablist`/`tabpanel` for tabbed ribbons, as today's Data ribbon does. Menus use `menu`/`menuitem` with focus returned to the trigger (verified in R05).
- Toggle buttons expose `aria-pressed`; swatches have accessible names ("Accent fill"), not colour alone.
- Side panels are labelled regions (non-modal) or `dialog` (modal), with Escape to close and focus return.
- Labels, not placeholders, on every field (R05 finding 3).
- Existing shortcuts stay: Cmd/Ctrl+S, Z, Shift+Z, Y, B, I, D, ], [; Slides E, P, ?; Data arrows, Shift+arrows, Enter, F2 and Escape in the grid, plus Cmd/Ctrl+C and V for rich range copy and paste. Tab leaves the grid today.
- Status messages use `role="status"`; save state is announced, not only coloured.
- Colour contrast of shell chrome ≥ 4.5:1 for text, 3:1 for icons and focus rings; chartes are checked in TH01.

### Widths and density

- 320 to 1440 px with no page-level horizontal scroll (Data R02/R05 gate). Toolbars may scroll inside themselves with keyboard-operable overflow arrows.
- Touch targets ≥ 24 px (WCAG 2.2 AA); 30–32 px buttons as Slides today.
- The canvas must keep most of the height: Data needs as many grid rows as possible; Slides scales the 16:9 slide to fit.
- Desktop is the primary target. Narrow widths must remain usable for reading, light edits and review, not full authoring.

### Print

- Shell chrome never prints. Print shows content only: slides one per page, Data selected sheets with repeated headers, Text paged with running headers.
- Slides and Text use the browser print dialog; Text adds a print preview (T14).

### Engine-free formatting in Data

- Viewing and formatting never load the calculation engine or make a network request. The shell must render, and every formatting control must work, while the engine is absent, loading, blocked or cancelled.
- Busy states disable only calculation-changing commands; the shell shows calculation state and retry.

### Code ceilings (standard mode)

- Data 750,000 bytes of embedded application code. The R05 P&L sample uses 558,873 with the untrimmed Preact toolbar and drawer, leaving about 191 kB for F01–F06 and T15–T22. Shell code competes with features.
- Text 500,000 bytes, which must also hold ProseMirror and its packages.
- Slides has no recorded ceiling (ADR-011, open).
- A shared shell must therefore be small native code (or the IronCalc/Preact components Data already pays for) and should not add a framework to Slides or Text.

### Shared charte and vocabulary

- One `style#charte` token set styles all three products (ADR-011 §4). Default tokens: `--ink`, `--acc`, `--mid`, `--lig`, `--alert`, `--tint`, `--callout`, `--bd`, `--t2`, `--bg`, `--font`, plus Data roles (`--header-*`, `--row-label-*`, `--assumption-*`, `--calculation-bg`).
- Closed formatting vocabulary (ADR-012): text colours `ink acc mid alert t2 bg`; fills `none tint lig mid acc alert dark`; bold and italic (Text adds underline, sup/sub, code, highlight); borders `none thin medium double`; no font size in Data, steps only in Slides; no literal colours or fonts in content.
- Shell chrome itself should use neutral UI greys, not the document charte, so that switching theme recolours the document and its swatches but not the buttons. Swatches always render the active charte.

### Shared document settings (ADR-011 §10)

- **Font**: Arial (default), Verdana, Tahoma, Trebuchet MS, Georgia, Times New Roman. Body only in Slides and Text (titles keep `--title-font`); whole grid in Data. Absent means the charte font.
- **Theme**: blue, red, green, black (greyscale plus one alert colour), plus "Document charte" when the file has an organisation charte. Stored as `theme` in Data JSON, `data-theme` and `data-font` in Slides and Text. No network, no colour editor, undoable.
- Text adds page format, margins, headers and footers; Data adds regional settings (locale). These are document settings too and should sit next to theme and font.

## 6. Shell anatomy to design

Every variant in U02 must place each of these zones for all three products:

1. **Identity and file**: product mark, document title, save state, Save, Save a copy, print/PDF, help.
2. **Command rows**: history, formatting, insert, product commands.
3. **Product strip**: Data's formula bar and scenario selector; nothing equivalent in Slides and Text.
4. **Canvas**: slide stage with thumbnails, grid, or page.
5. **Bottom area**: Data's sheet tabs and groups; Slides and Text have none today.
6. **Side panels**: cell styles, regional settings, comments, chart data, document settings.
7. **Document settings**: theme and font, plus page format (Text) and regional settings (Data).
8. **Narrow width**: what collapses, scrolls or moves at 375 px.

## 7. Hypothesis to test in U02

From ADR-011 §7: a cross between IronCalc's toolbar and our ribbon, with **two ribbon rows at the top** (plus a formula bar in Data), and at the bottom either **floating settings** or **Data's sheet tabs**. U02 shows it as one variant among at least three, not as the answer.

Criteria for comparing variants in U03:

- **Consistency**: the same control in the same place across products.
- **Discoverability** of every command in §4 without inert placeholders.
- **Canvas height** at 1440 × 900 and at 375 px, especially grid rows in Data.
- **Narrow-width behaviour** without page overflow.
- **Keyboard model** simplicity (number of tab stops to reach a command).
- **Code cost** against the ceilings, and reuse of IronCalc/Preact components already paid for in Data.
- **Migration cost** from today: Slides already has two rows; Data has a tabbed ribbon; Text starts fresh.

## 8. Questions for U03

1. Which layout variant, and which bottom area for Slides and Text (floating settings, status bar, or nothing)?
2. Are document settings one shared panel (theme, font, plus product extras) in all products?
3. Do side panels overlay the canvas or push it, and can two be open at once?
4. Does Data keep IronCalc's components (toolbar, drawer, link dialog) restyled to the shared shell, or does the shared native shell replace them? This decides how much of R05's 199,681 bytes stay.
5. Does the Slides reading-mode pill become the shared "floating settings" pattern, or disappear?
6. Shell chrome in neutral greys (recommended above) or in charte colours?
