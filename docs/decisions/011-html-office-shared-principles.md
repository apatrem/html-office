# ADR-011 — Shared principles across html-office products

Status: proposed on 22 October 2026; §10 accepted in session S01 the same day. Sections marked **accepted** consolidate decisions already recorded elsewhere; sections marked **proposed** or **open** need the tasks in the [cross-product plan](../HTML-OFFICE-CROSS-PLAN.md) before acceptance. Applies to html-slides, html-data and html-text.

## Accepted (consolidated)

1. **One self-contained HTML file per document.** Content, editor, brand theme, embedded guide and saved previews travel together; recipients need only a browser. Optional components (calculation engine, chart library) load from pinned, integrity-checked sources or are embedded in offline builds. Sources: [ADR-001](001-v1-dom-and-migrations.md), [ADR-003](003-html-office-and-data-runtime.md), [Office V1](../HTML-OFFICE-V1.md).
2. **LLM-native documents.** The authoritative content is readable (semantic HTML for Slides/Text, versioned JSON for Data) and documented by an inert embedded guide ([ADR-002](002-embedded-guide.md)). Each product must pass an unfamiliar-LLM, HTML-only read/edit test. Engine or editor state is disposable.
3. **One skill per product, one plugin.** Slides, Data and Text each ship a focused skill when implemented, sharing the authoring rules of [Office V1](../HTML-OFFICE-V1.md#shared-authoring-and-quality-rules): validate, retry twice, then stop; teach with valid and invalid examples; measure against a committed heavy fixture in CI.
4. **One brand theme.** A single `style#charte` token set (colours, fonts, chart palette, logo, footer, locale) styles all three products; each adds only its own layout styles. Content never hard-codes colours or fonts outside the theme vocabulary.
5. **Charts.** One chart contract (types, JSON schema) implemented by a shared module on pinned, SRI-verified ECharts, with saved SVG previews for offline viewing and print.
6. **Embedded application-code ceilings (standard mode).** Data 750,000 bytes ([ADR-010](010-manual-formatting-and-ironcalc-toolbar.md)) and Text 500,000 bytes ([HTML-TEXT-V1](../HTML-TEXT-V1.md)). Content, saved results and previews are measured separately; offline builds may be larger.

## Proposed

7. **Consistent editor shell.** All three editors share one visual and interaction language derived from the IronCalc toolbar and our ribbon. The working hypothesis is two ribbon rows at the top (plus a formula bar in Data), and either floating settings or Data's sheet tabs at the bottom. This is decided only after design mock-ups (tasks U01–U03). Until then, ADR-010's single-band layout for Data is on hold, and the Data interface migration (F04) waits for U03.
8. **Cross-product copy and paste.** Tables and charts copy between Slides, Data and Text through one shared clipboard contract: a semantic HTML table and chart snapshot for any target, plus an html-office JSON payload for rich html-office targets. The canonical structures need not share the same DOM, but must map losslessly onto the shared payload (task X01). Text already specifies that values from Data arrive as a snapshot with no link to the source.
9. **Third-party notices stay inside the file, deduplicated.** MIT, ISC and similar licences require the copyright and permission notice to be included with copies of the software. A link to an external page would not reliably satisfy that requirement and would break offline and self-contained use. Notices therefore stay embedded, collapsed and outside the visible interface. Identical licence texts are stored once, with the list of copyright holders (task L01).

10. **Shared appearance settings** (decided in session S01, 22 October 2026; detailed in [ADR-012](012-data-formatting-vocabulary.md)):
    - Formatting uses the closed html-slides token vocabulary in every product; no literal colours, fonts or sizes in content.
    - A per-document **font** comes from one shared list: Arial (default), Verdana, Tahoma, Trebuchet MS, Georgia, Times New Roman. In Slides and Text it changes the **body** only; titles keep the charte's `--title-font` (default `--font`). In Data it applies to the whole grid.
    - A shared **theme picker** offers four built-in chartes (blue, red, green, black/greyscale) plus the document's own charte, which is never overwritten.
    - The active theme is a document field (`theme` in Data JSON; `data-theme` and `data-font` attributes in Slides and Text). Switching needs no network and creates no colour editor.
    - Organisation chartes are created by the skill (Slides V1-02, extended to all products).

## Open
- **A Slides code ceiling** has not been recorded; set one when Slides is next revised.
- **Data-set storage.** The best model for manipulating large tables is under research (task D01). [ADR-005](005-data-storage.md) remains in force until then.
