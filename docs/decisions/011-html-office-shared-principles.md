# ADR-011 — Shared principles across html-office products

Status: proposed on 22 October 2026; §10 accepted in session S01 and §7 accepted in U03 the same day. Sections marked **accepted** consolidate decisions already recorded elsewhere; sections marked **proposed** or **open** need the tasks in the [cross-product plan](../HTML-OFFICE-CROSS-PLAN.md) before acceptance. Applies to html-slides, html-data and html-text.

## Accepted (consolidated)

1. **One self-contained HTML file per document.** Content, editor, brand theme, embedded guide and saved previews travel together; recipients need only a browser. Optional components (calculation engine, chart library) load from pinned, integrity-checked sources or are embedded in offline builds. Sources: [ADR-001](001-v1-dom-and-migrations.md), [ADR-003](003-html-office-and-data-runtime.md), [Office V1](../HTML-OFFICE-V1.md).
2. **LLM-native documents.** The authoritative content is readable (semantic HTML for Slides/Text, versioned JSON for Data) and documented by an inert embedded guide ([ADR-002](002-embedded-guide.md)). Each product must pass an unfamiliar-LLM, HTML-only read/edit test. Engine or editor state is disposable.
3. **One skill per product, one plugin.** Slides, Data and Text each ship a focused skill when implemented, sharing the authoring rules of [Office V1](../HTML-OFFICE-V1.md#shared-authoring-and-quality-rules): validate, retry twice, then stop; teach with valid and invalid examples; measure against a committed heavy fixture in CI.
4. **One brand theme.** A single `style#charte` token set (colours, fonts, chart palette, logo, footer, locale) styles all three products; each adds only its own layout styles. Content never hard-codes colours or fonts outside the theme vocabulary.
5. **Charts.** One chart contract (types, JSON schema) implemented by a shared module on pinned, SRI-verified ECharts, with saved SVG previews for offline viewing and print.
6. **Embedded application-code ceilings (standard mode).** Data 750,000 bytes ([ADR-010](010-manual-formatting-and-ironcalc-toolbar.md)) and Text 500,000 bytes ([HTML-TEXT-V1](../HTML-TEXT-V1.md)). Content, saved results and previews are measured separately; offline builds may be larger.

## Accepted in U03 (22 October 2026)

7. **Consistent editor shell.** The user chose **variant A** of the [U02 mock-ups](../mockups/shell/index.html). The audit and constraints are in the [shell brief](../HTML-OFFICE-SHELL-BRIEF.md); the implementation evidence is the [R06 spike](../HTML-DATA-NATIVE-SHELL-SPIKE.md).
    - **Layout.**
      - Row 1 is the file bar: product mark, document title and save state, a complete menu bar (File, Edit, Insert, Format, the product's own menus, View, Help) and Save (plus Present in Slides).
      - Row 2 is one icon toolbar grouped by separators. In Slides it follows the selection, as today's context bar does.
      - Data adds the formula bar as row 3: name box, value, scenario selector and calculation state.
      - At the bottom, Data shows its sheet tabs and groups, with the document-settings button at the right end. Slides and Text show a floating settings bar (theme and font, slide or page count, zoom), which replaces the Slides reading-mode pill.
    - **Side panels** open over the canvas on the right (340 px), one at a time, and become a bottom sheet below 720 px:
      - document settings in every product;
      - cell styles and regional settings in Data;
      - comments and outline in Text;
      - chart data wherever charts exist.
    - **Document settings** have the same content in every product: theme (four built-ins plus the document charte) and font (six fonts), as in §10, plus the product's extras (Slides footer; Data regional settings; Text page format, margins, running header and heading numbers).
    - **Interaction rules.**
      - Every command has a home in the menus; the toolbar repeats the frequent ones.
      - Keyboard:
        - the menu bar moves with Left/Right, opens with Down, Enter or Space, and switches menus with Left/Right from inside a menu;
        - a toolbar is one tab stop with arrows, Home and End;
        - menus support arrow keys and type-ahead;
        - Escape closes a menu or popover and returns focus to its trigger;
        - a side panel takes focus on its heading and returns it to its toggle when closed;
        - modal dialogs use the native `<dialog>` element.
      - A visible label is the control's accessible name and stays so when it is visually collapsed.
      - Below 720 px, the menus collapse into ☰, the toolbar scrolls with keyboard-reachable overflow arrows, and the settings bar spans the width.
      - Shell chrome uses neutral UI greys; only the canvas and the colour swatches follow the charte.
      - Print hides all chrome.
      - A released shell never shows an inert command. A formatting control ships only with its model command (Data: F01r, F02, F03). Spikes and mock-ups may record intents and must say so on screen.
    - **Implementation: shared native components, no UI framework.** One framework-free module and stylesheet serves all three products. Its components:
      - buttons and toggles, menu button, menu bar and menu;
      - toolbar, popover;
      - colour swatches (ADR-012 tokens), border picker;
      - side panel, dialog;
      - the document-settings, cell-style and regional panels;
      - floating settings bar, status area;
      - Data's formula bar and sheet bar.
      
      The IronCalc toolbar fork on Preact (R05) is **not adopted**; IronCalc remains the calculation engine only.
    - **Measured in R06** (standard mode, fictional P&L):
      - native shell: 45,444 bytes (14,357 gzip), no runtime dependency, against 199,681 for the R05 Preact toolbar;
      - complete P&L application code: 417,611 bytes (baseline 370,560 with today's ribbon; about 580,000 projected with the Preact toolbar), leaving about 332,000 bytes under the 750,000 ceiling;
      - offline sample: 1,373,859 bytes.

## Proposed

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
