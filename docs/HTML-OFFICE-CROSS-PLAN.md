# html-office cross-product plan

Requested by the user on 22 October 2026. Decisions land in [ADR-011](decisions/011-html-office-shared-principles.md). Each task is a separate, reviewable increment. **Design comes before code**: no shared-shell implementation starts before U03 is accepted. U01–U03 were completed on 22 October 2026: the user chose variant A and native shared components (ADR-011 §7).

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
- **U04-Data** (replaces F04) can start after F01r.
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
- **U04-Slides**: move the top bar, context bar and reading pill onto the module (variant A floating settings bar) with no visible regression.
- **U04-Text**: build the editor on the module when Text starts.
- Gates as in each product plan: browser, keyboard, size and performance. Add a screen-reader pass (VoiceOver or NVDA) and Safari and Firefox runs, which R06 did not cover.

## X — Cross-product copy and paste

**X01 — Clipboard contract.** Scope M, research and ADR.
- Define the clipboard MIME types and payloads for ranges and tables, and for charts:
  - the html-office JSON payload, extending today's `html-office-range/1`;
  - semantic `text/html` and `text/plain` fallbacks for other applications.
- Chart payload: chart JSON plus its SVG preview.
- Mapping rules: Data ranges to Text and Slides tables, including merged cells, which Data lacks; number formats; theme colours; links.
- Tests: copy between products in separate tabs.

**X02 — Implementation per product pair.** Scope M each. Values only, no live link, as already specified for Text.

## L — Third-party notices

**L01 — Deduplicated embedded notices.** Scope S.
- Store each distinct licence text once, with the list of packages and copyright holders it covers.
- Keep notices collapsed and embedded; no external link (see ADR-011 §9).
- Measure the saving in the Data P&L and the Slides example.
- Verify that every bundled package is still attributed.

## S — Styling scope in Data

**S01 — Design session on Data styling — done 22 October 2026, see [ADR-012](decisions/012-data-formatting-vocabulary.md).**
- Revisit ADR-010's free direct styles in light of Slides' constrained vocabulary (theme colours, a few utility classes, no literal colours) and the request for a **fixed font size** in Data.
- Outcome: an amended ADR-010 and FORMAT.md. F01's model is adjusted before F02 renders anything.
- Blocks F02.

## T — Shared themes and document font

**T01 — Built-in chartes.** Scope S.
- Design the blue (current default), red, green and black (greyscale, single alert colour) chartes.
- Each defines every charte token, including chart palette and Data role tokens, with checked contrast (text on fills, white on dark fills).

**T02 — Theme and font settings per product.** Scope M each.
- Data: workbook `theme` and `font` with overlay rendering, undo, guide and tests.
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
