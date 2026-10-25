# html-office cross-product plan

Requested by the user on 22 October 2026. Decisions land in [ADR-011](decisions/011-html-office-shared-principles.md); the clipboard contract is [ADR-013](decisions/013-cross-product-clipboard.md). Each task is a separate, reviewable increment. **Design comes before code**: no shared-shell implementation starts before U03 is accepted. U01–U03 were completed on 22 October 2026: the user chose variant A and native shared components (ADR-011 §7).

## U — Consistent editor shell (Slides, Data, Text)

**U01 — Design brief and audit — done 22 October 2026, see the [shell brief](HTML-OFFICE-SHELL-BRIEF.md).** Scope S, docs only.
- Inventory the current editor shells: Slides toolbar and context toolbar, the Data ribbon and the R05 IronCalc toolbar, and the planned Text editor.
- List every command per product and where it lives today.
- Record constraints: keyboard and ARIA, 320–1440 px, print, engine-free formatting, code ceilings, shared charte.
- Starting hypothesis to test, not to assume: a cross between IronCalc's toolbar and our ribbon, with **two ribbon rows at the top** (plus a **formula bar** in Data); at the bottom, either **floating settings** or **Data's sheet tabs**.

**U02 — Mock-ups — done 22 October 2026, see the [mock-ups](mockups/shell/index.html); variant A chosen.** Scope M, static HTML mock-ups only, no product code.
- At least three distinct layout variants, each shown for all three products: top rows, formula bar, bottom area, side panels (cell styles, themes, regional settings, comments), and narrow-width behaviour.
- Use real command sets and the fictional fixtures.
- Present them side by side for the user's choice; iterate until one is chosen.

**U03 — Decision — done 22 October 2026, see [ADR-011](decisions/011-html-office-shared-principles.md) §7.** Scope S.
- Accept ADR-011 §7 with the chosen layout, interaction rules and a component list: buttons, menus, colour and border pickers, drawers, status area.
- Decide which components come from the IronCalc fork on Preact (R05) and which are shared native code.
- Amend ADR-010's layout section and re-sequence Data F04.

**R06 — Native shell spike for Data — done 22 October 2026, see the [report](HTML-DATA-NATIVE-SHELL-SPIKE.md).** It built variant A from framework-free components on R05's P&L sample.
- Sizes: the shell is 46,816 bytes (15,072 gzip), against 199,681 for the Preact toolbar. The standard P&L comes to 419,021 bytes (baseline 370,560) and the offline sample to 1,375,269.
- R05's functional, engine-failure and 320–1440 px checks pass.
- Formatting without an ADR-012 model is only recorded, so in the spike sample bold, italic, alignment, wrap, borders, colours, theme, font, regional settings and links do nothing visible yet.

**U04 — Shared native shell implementation.** One task per product. Scope M each.
- One framework-free module and stylesheet (proposed `packages/shared/shell/`), built into each product behind its code ceiling. Start from R06's components and replace its assessment bridge with a deliberate command/state API.
- **U04-Data** (replaces F04) — implemented 22 October 2026 on `feature/u04-data-shell`, awaiting review. The shared module is [`packages/shared/shell/`](../packages/shared/shell/README.md); the side-by-side comparison is in [`packages/data/bench/shell-variant-a/`](../packages/data/bench/shell-variant-a/index.html). Screen-reader, Safari and Firefox passes are still open (see below).
  - It ships the file bar and menus and the variant A formula bar and sheet bar.
  - Its toolbar holds only the commands today's runtime already applies and renders end to end:
    - history;
    - number formats;
    - the five rendered cell styles (normal, header, row label, assumption, calculation);
    - clear formatting;
    - clipboard, rows and columns, sheets;
    - dropdowns, conditional formatting and the scenario selector.
  - It removes the tabbed ribbon and its page-wide CSS, which leaks into the shell (R06 finding 1).
  - It shows no inert button. Each later control joins the shell in the task that makes it work:
    - the other catalogue styles with F02 (rendering);
    - emphasis, alignment, wrap, colours, borders and links with F02/F03;
    - the cell-style panel, the document-settings button with its theme and font panel, and regional settings with F05.
  - **Visual parity with variant A is an acceptance gate.** The R06 sample is still far from the mock-up; its [side-by-side comparison](HTML-DATA-NATIVE-SHELL-SPIKE.md#gap-to-variant-a) lists the gaps:
    - the page frame and status lines;
    - the four-field formula bar;
    - the scenario row;
    - grid density and colours;
    - the boxed sheet groups;
    - the keyboard hint line.
    
    U04-Data captures the same states at 1440 × 900 and 375 × 812 and compares them with the variant A screenshots. It must show at least the mock-up's grid rows (32 and 28, header included) with no page scroll.
- **U04-Slides** — implemented 24 October 2026 on `claude/u04-slides-shell-da5e2d`, awaiting review. The side-by-side comparison (mock-up, before, after) is in [`docs/shell-variant-a-slides/`](shell-variant-a-slides/index.html). Screen-reader, Safari and Firefox passes are still open (see below).
  - The top bar, context bar and reading pill are rebuilt from the shared module:
    - a file bar with the product mark, title and save state, the menu bar (File, Edit, Insert, Format, Slide, Arrange, Table, View, Help), Present, Save and Done;
    - one toolbar: history and insert, then the groups of the current selection, as the context bar did;
    - the floating settings bar, which replaces the pill: Edit, Present, PDF and Save (when there are unsaved changes) while reading, the slide position while editing.
  - Below 720 px (or whenever the file bar would overflow) the menus collapse into ☰, the toolbar scrolls and the thumbnails become a strip above the settings bar; the slide gets the full width (335 px at 375, against 139 before).
  - Commands are registered on the shared command/state API, now [`packages/shared/shell/commands.mjs`](../packages/shared/shell/commands.mjs) (moved from Data). Every command has a home in the menus; disabled entries stay listed, inert ones never are. A browser check runs every menu entry and chrome button and fails if one changes nothing (`tests/shell.test.mjs`).
  - Intentional changes from variant A: insert commands are icon buttons; colours open the shared swatch pickers instead of 13 inline swatches; the old pill's place moves from the bottom right to the bottom centre. Saved decks are byte-identical to those saved before (engine apart).
  - The settings bar has no theme, font or zoom yet: theme and font come with TH02, and zoom is not a command Slides has.
  - Size: the standard engine grows from 375,094 to 398,471 bytes (121,292 to 129,032 gzip). Data-only panel styles moved to [`panels.css`](../packages/shared/shell/panels.css) so Slides does not carry them; the Data P&L's application code grows from 454,195 to 457,118 bytes (the Slides icons in the shared set).
  - The version stays 0.7.1; the committed example decks are regenerated with this engine (the bump happens at release).
- **U04-Text**: build the editor on the module when Text starts.
- Gates as in each product plan: browser, keyboard, size and performance. Add a screen-reader pass (VoiceOver or NVDA) and Safari and Firefox runs, which R06 did not cover.

## X — Cross-product copy and paste

**X01 — Clipboard contract — done 24 October 2026, see [ADR-013](decisions/013-cross-product-clipboard.md); the user took its four decisions the same day.** Scope M, research and ADR.
- Carriers: one `html-office-clip/1` envelope written by the `copy` event in the custom type `application/x-html-office+json` and, for Safari and cross-browser paste, as JSON in a `data-html-office` attribute of the semantic `text/html` flavour; `text/plain` TSV for everything else. Chromium evidence is in the [proof of concept](research/x01-clipboard-poc/README.md); Safari's sanitiser was read in WebKit source.
- Tables use one portable model (displayed text, optional Data typed value and format, merges, token names only). The ADR maps Data, Slides and Text in both directions, including merges, number formats, theme tokens, links and cell styles.
- Charts travel as the Slides chart contract JSON plus the SVG preview and a PNG for other applications. A bound Data chart becomes a values snapshot; values only, never a live link.
- Security rules, the X02 test plan and the X02 split below.

**X02 — Implementation per product pair.** Values only, no live link. Each increment is one PR, scope M; the test plan is in ADR-013 §6.
- **X02a — Shared clipboard module; Data → Data and Data → other applications.** `packages/shared/clipboard/` (envelope, carriers, limits, table model, inert HTML reader, writers). Data writes the envelope and a semantic `text/html` table, and reads html-office and Excel/Sheets/Word/Docs HTML tables.
  - **Implemented 25 October 2026** ([module README](../packages/shared/clipboard/README.md)). Data's copy writes the envelope (with the unchanged `range`, plus the portable `table` up to 20,000 cells), a semantic `text/html` table with literal charte styles and Excel/Sheets exact-value hints, and full-precision `text/plain` with ISO dates. Paste follows the reader precedence; tables from Excel, Sheets, Word and Docs are typed values-first and open the paste dialog when a cell is ambiguous.
  - Tests: module unit tests with Excel, Sheets, Word and Docs fixtures (hand-written to each application's clipboard structure, not captured); Data browser tests for two `file://` tabs, two `localhost` ports, each carrier fall-back and hostile clipboards; the inert parse makes no request and runs no script in Chromium 151 and WebKit 26.5 locally, and in all three engines in the `clipboard-engines` CI job.
  - Open gates (manual): Excel and Google Sheets exact values from Data's `text/html`, and the Safari/Firefox/cross-browser and native-application matrix of ADR-013 §6. Firefox Nightly did not start on the development Mac, so Firefox runs only in CI.
  - Size: the Data P&L's application code grows from 345,369 to 370,067 bytes (+24,698; the shared module alone is 16.6 KB minified).
- **X02b — Data ⇄ Slides tables.** Slides element copy and table paste; Data reads Slides tables. Slides tables gain merged cells (decision 3). The alternate option, splitting merges on paste, is allowed only if merges prove incompatible with Slides editing, checking or print.
- **X02c — Slides ⇄ Slides charts and charts → other applications.** Chart copy (envelope, PNG, async upgrade) and paste, with the SVG sanitiser. After X03.
- **X02d — Data charts → Slides; Slides charts → Data.** Values snapshot from bindings; cells plus a bound chart in Data (decision 1). After X02c and Data T18, which delivers only the binding model.
- **Text pairs** need no separate increment for tables or Slides charts. They are acceptance items of Text T07/T10 for tables (after X02a and X02b) and of T11 for Slides charts (after X02c and X03).
- **X02f — Text ⇄ Data charts.** After X02d and Text T11.

**X03 — Extract the shared chart module.** Scope M. ADR-013 §4 and decision 2; it takes the extraction part of Text T11 forward. **Delivered as PR 1 of the session working on the shared chart module and Data T18**, before its T18 PR. It is not a separate task.
- Move the chart registry, types, validation, `theme()`, the pinned SRI ECharts loader and SVG preview capture from `src/engine/charts.js` and `src/charts/` to `packages/shared/charts/`, so Slides, Data (T18) and Text (T11) draw charts with the same code and the same pinned ECharts (embedded in offline builds).
- Acceptance as Text T11's extraction: Slides tests pass and regenerated example decks are byte-identical.
- Also add strict per-type chart schemas (allow-listed fields and types) and lossless table adapters (Gantt keeps task `highlight`), with tests, outside the byte-identical rendering path.
- Record the follow-up for a document `locale` in chart number formatting (today `en-US`).

## L — Third-party notices

**L01 — Deduplicated embedded notices.** Scope S.
- Store each distinct licence text once, with the list of packages and copyright holders it covers.
- Keep notices collapsed and embedded; no external link (see ADR-011 §9).
- Measure the saving in the Data P&L and the Slides example.
- Verify that every bundled package is still attributed.

Implemented 24 October 2026 on `feature/l01-notices`, in review. One generator, [`packages/shared/notices.mjs`](../packages/shared/notices.mjs), serves both products:
- **How texts are grouped.** Licence files are cut into sections at `=====`/`~~~~` lines, and Apache-2.0 texts into heading, terms and appendix. Copyright lines are lifted out, and sections whose wording is identical apart from whitespace share one stored text, listed with its packages and copyright holders. Different wording is never merged (for example MIT "(including the next paragraph)", or the http and https Apache headings). A file's other sections stay together, with pointers to the texts lifted out of them, including licence texts embedded in a larger notice (the Rust `AUTHORS-MIT:` sections).
- **Data.** `engine/THIRD-PARTY-NOTICES.txt` is unchanged, so `rebuild.sh --check` still compares it. `tools/notices.mjs` reads it back, checks it against `dependency-audit.json` (file digest, and each package's own texts) and the Help dialog embeds the grouped text.
  - The 47 retained texts become 22 blocks: **197,573 → 42,627 bytes** of text, 201,131 → 43,343 once HTML-escaped.
  - Standard P&L application code: **503,157 → 345,369 bytes** (−157,788) on `main` after T17; offline P&L 1,459,416 → 1,301,628.
- **Slides.** The engine comment previously held a truncated MIT text that referred to `THIRD_PARTY_NOTICES.md` and named Moveable and Selecto "and their dependencies". It is now generated, and attributes:
  - the LICENSE and NOTICE files of each bundled package and of html-slides;
  - code that published packages inline (keycode, `@egjs/component`, `@cfcs/core`, `react-moveable`, `react-css-styled`) and tslib legal comments, including one under Apache-2.0;
  - ECharts, which `pack --offline` embeds unchanged beside the engine, with its NOTICE, zrender and d3.
  
  Packages without a licence file cite the canonical texts in [`packages/shared/licences/`](../packages/shared/licences/). The MIT and Apache texts are each stored once.
  - Engine comment: **1,090 → 21,487 bytes** (+20,397 per deck, most of it the Apache-2.0 text).
  - Example decks, on `main` after U04-Slides: catalogue 483,215 → 503,612 bytes, community garden 473,766 → 494,163. The catalogue's application code (engine, theme, charte and scaffold, without the embedded guide and slides) is about 437,700 bytes, under the 500,000 ceiling.
- **Tests.** `tests/notices.test.mjs` and `packages/data/tests/notices.test.mjs` use an independent checker, [`notices-check.mjs`](../packages/shared/notices-check.mjs). They fail if:
  - a package is not listed (Cargo closure, Rust standard-library notices, npm packages bundled or inlined, ECharts);
  - a line of a package's licence file is missing from the blocks listing that package;
  - a licence wording is stored twice.

## S — Styling scope in Data

**S01 — Design session on Data styling — done 22 October 2026, see [ADR-012](decisions/012-data-formatting-vocabulary.md).**
- Revisit ADR-010's free direct styles in light of Slides' constrained vocabulary (theme colours, a few utility classes, no literal colours) and the request for a **fixed font size** in Data.
- Outcome: an amended ADR-010 and FORMAT.md. F01's model is adjusted before F02 renders anything.
- Blocks F02.

## TH — Shared themes and document font

**TH01 — Built-in chartes — merged with Data F05 (PR #54) in [`packages/shared/themes/chartes.mjs`](../packages/shared/themes/chartes.mjs).** Scope S. Blue is the Slides default; two of its pairs are below 4.5:1 (white on `mid` 4.29, alert on assumption 4.30) and are recorded in the test rather than changed for every product.
- Design the blue (current default), red, green and black (greyscale, single alert colour) chartes.
- Each defines every charte token, including chart palette and Data role tokens, with checked contrast (text on fills, white on dark fills).

**TH02 — Theme and font settings per product.** Scope M each.
- Data: workbook `theme` and `font` with overlay rendering, undo, guide and tests — merged with F05 (PR #54).
- Slides: `data-theme` and `data-font`, body font only.
- Text: the same as Slides, when its editor exists.

The setting's placement follows the shell design (U03).

## D — Data-set model research

**D01 — Literature and benchmark review: how should large tables be stored for LLM and tool manipulation?** Scope M, research report.
- Candidates:
  - today's row arrays with typed columns and overrides ([ADR-005](decisions/005-data-storage.md));
  - columnar arrays;
  - CSV/TSV and CSVW / Frictionless Table Schema metadata;
  - Excel-style named tables (ListObjects with structured references);
  - Arrow-like layouts;
  - semantic HTML tables.
- Sources: published evaluations of LLM table understanding and editing by serialization format, plus the standards documentation.
- Criteria:
  - LLM read/append/filter/aggregate accuracy;
  - editing locality, schema evolution and typed values;
  - size;
  - streaming and partial reads by tools;
  - fit with formulas and structured references.
- Deliverable: a recommendation; JSON is acceptable if documented as the best fit.

**D02 — Blind trials.** If D01 recommends a change, repeat ADR-005's HTML-only blind trials on the top two candidates before any migration.
