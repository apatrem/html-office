# html-office cross-product plan

Requested by the user on 22 October 2026. Decisions land in [ADR-011](decisions/011-html-office-shared-principles.md). Each task is a separate, reviewable increment. **Design comes before code**: no shared-shell implementation starts before U03 is accepted.

## U — Consistent editor shell (Slides, Data, Text)

**U01 — Design brief and audit.** Scope S, docs only.
- Inventory the current editor shells: Slides toolbar and context toolbar, the Data ribbon and the R05 IronCalc toolbar, and the planned Text editor.
- List every command per product and where it lives today.
- Record constraints: keyboard and ARIA, 320–1440 px, print, engine-free formatting, code ceilings, shared charte.
- Starting hypothesis to test, not to assume: a cross between IronCalc's toolbar and our ribbon, with **two ribbon rows at the top** (plus a **formula bar** in Data); at the bottom, either **floating settings** or **Data's sheet tabs**.

**U02 — Mock-ups.** Scope M, static HTML mock-ups only, no product code.
- At least three distinct layout variants, each shown for all three products: top rows, formula bar, bottom area, side panels (cell styles, themes, regional settings, comments), and narrow-width behaviour.
- Use real command sets and the fictional fixtures.
- Present them side by side for the user's choice; iterate until one is chosen.

**U03 — Decision.** Scope S.
- Accept ADR-011 §7 with the chosen layout, interaction rules and a component list: buttons, menus, colour and border pickers, drawers, status area.
- Decide which components come from the IronCalc fork on Preact (R05) and which are shared native code.
- Amend ADR-010's layout section and re-sequence Data F04.

**U04 — Shared shell implementation.** One task per product. Scope M each.
- A shared shell module and CSS tokens in the existing build, behind each product's code ceiling.
- Data first (replaces F04), then Slides, then Text when its editor exists.
- Browser, keyboard, size and performance gates as in each product plan.

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
