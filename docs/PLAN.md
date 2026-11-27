# V1 plan — standalone, editable HTML presentations

Status, 27 November 2026: release 0.7.2 is published ([v0.7.2](https://github.com/apatrem/html-office/releases/tag/v0.7.2), 18 November 2026) and 0.7.3, with the review fixes of PR #127, is the next step. The usage validation is now the go/stop measurement of [ADR-016](decisions/016-slides-go-stop-gate.md); the approved V1 additions that are still open wait for its outcome (see the backlog table). The delivered baseline below describes releases 0.7.0 and 0.7.1, then the work merged since (all of it in 0.7.2), each item with its pull request.

This remains the Slides plan within the renamed html-office repository. See the [Office V1 specification](HTML-OFFICE-V1.md) and [Data implementation plan](HTML-DATA-PLAN.md) for the new workbook scope, and the [Text roadmap](HTML-OFFICE-V1.md#text-roadmap) for the planned Word alternative. The seven approved Slides additions below remain planned; an [ideas backlog](#ideas-backlog-not-approved) records candidates that are not approved.

## Objective

Create and revise a presentation with an LLM, refine it in a browser, and deliver one HTML file plus an optional PDF. The file remains readable and editable without the authoring skill. Measure usefulness over five representative tasks before starting collaboration work.

## Architecture and scope

V1 uses semantic HTML for content, CSS variables for branding, named layouts, JSON-driven charts with SVG caches, and an embedded editor. Canvas: 1,280 ×720 px. First manual movement detaches a template slide and freezes every element's geometry, preserving neighbours.

The DOM is the current model; undo uses HTML snapshots. Stable identifiers support preservation checks, but do not enable concurrent conflict resolution. V2 requires a separate mutation/history architecture; it cannot simply attach collaboration to V1. See [ADR-001](decisions/001-v1-dom-and-migrations.md).

## Delivered capabilities

- Slide insertion, duplication, deletion, and reordering; text, shapes, images, tables, and seven chart types.
- Snapping, resize, alignment, distribution, theme-based formatting, chart/table data editing, footer controls, presentation, and PDF.
- Complete drafts with deck attributes and assets; queued saves preserve subsequent edits; errors and cancelled writes keep drafts.
- Inert preflight before execution, recognised script digests, network-limited rendering, and preservation comparison against stable references.
- Explicit migrations: `pack` preserves engine/theme/guide; `upgrade` replaces engine/guide with a backup; theme replacement is opt-in.
- Thumbnail layout preservation, rebinding after undo/redo, and refresh after delayed chart loading.
- A versioned, inert guide embedded before technical blocks; complete chart examples and compatible distribution links. See [ADR-002](decisions/002-embedded-guide.md).
- Pinned ECharts 6.1.0 with SHA-384 SRI/anonymous CORS, SVG fallback, and offline embedding.
- English documentation, UI, templates, and fictional examples. Public MIT repository, release archive, and CI.

Merged since 0.7.1:

- The shared editor shell, variant A (U04-Slides): file bar with menus, one toolbar and side panels, merged in PR #58 (24 October 2026).
- Deck theme and body font (TH02): `main#deck[data-theme]` overlays one of four built-in chartes and `data-font` picks one of six body fonts, set from the document-settings panel and undoable; `style#charte` is never rewritten. Merged in PR #64 (27 October 2026).
- Copy and paste of tables, with merged cells, between Slides, Data and other applications (X02b, PR #70) and of charts between decks and to other applications (X02c, PR #71), both 27 October 2026 ([ADR-013](decisions/013-cross-product-clipboard.md)).
- Save in place in Chrome and Edge: the opened file is chosen once in the save picker, remembered and reused on reopening; other browsers download copies. Merged in PR #108 (11 November 2026) for Slides, Data and Text.
- Table column widths: `<colgroup><col data-width="N">` (whole % of the table), Table › Column width… and Distribute columns evenly, carried by copy and paste (PR #111), and dragging the border between two columns, which changes that column and the frame's width (PR #112), both 18 November 2026.

## Approved V1 backlog

The following features were approved for later V1 development: V1-01 to V1-05 on 15 October 2026, V1-06 and V1-07 on 18 October 2026. Unless the table says otherwise, they are **planned, not started**. They are product scope and acceptance goals, not frozen implementation specifications or release commitments. Development order and technical details will be settled when each feature starts.

**Paused on 27 November 2026.** V1-02, V1-03, V1-05, V1-06 and V1-07 wait for the outcome of the go/stop measurement ([ADR-016](decisions/016-slides-go-stop-gate.md)): they resume only if it is *continue*.

| ID | Feature | Status |
| --- | --- | --- |
| V1-01 | Copy/paste complete slides between documents in separate browser tabs | Implemented on 22 November 2026 (ADR-013 amendment, PR #123); manual browser checks pending |
| V1-02 | Create reusable themes from reference files | Planned |
| V1-03 | Confirm a short generation brief and default settings | Planned |
| V1-04 | Copy/paste individual elements and selections | Started: tables and charts (ADR-013 X02b, X02c), merged in PRs #70 and #71 (27 October 2026) |
| V1-05 | Crop and replace images while preserving their frame | Planned |
| V1-06 | Check text density per layout region: a comfortable range and a maximum | Planned |
| V1-07 | Annotate the layout catalogue so an LLM picks layouts well | Planned |

### V1-01 — Copy/paste slides across documents

Copy a whole slide from one html-slides document to another in a different browser tab. **The pasted slide must match the destination theme**; this default was explicitly confirmed. V1 does not require preserving the source document's appearance as an alternative paste mode.

Acceptance goals:

- Keep slide content editable, including text, shapes, tables, chart data, images and notes; preserve manual placement where compatible with the destination layout.
- Transfer required assets and remap slide, element, asset and SVG identifiers without collisions. Preserve the source document and unrelated destination content.
- Use the destination's branding and chart palette, footer and page numbering. Check text fit and report overflow introduced by theme changes.
- Integrate with undo/redo, drafts and saving. After save and reopen, transferred images and chart snapshots remain available, including for offline reading.

Before implementation, define compatible document versions, insertion location and browser support/fallbacks. Define how pasting handles unavailable ECharts so that chart JSON, SVG snapshots and destination colours remain consistent.

Implemented on 22 November 2026 in PR #123 on the cross-product clipboard, as a third kind of envelope ([ADR-013, amendment](decisions/013-cross-product-clipboard.md#amendment-of-22-november-2026--whole-slides-kind-slide)). The points left open above were settled as defaults that the user may still overrule:

- **Copy:** Slide › Copy slide, a thumbnail's Copy slide button, or Cmd/Ctrl+C after clicking a thumbnail. **Paste:** Cmd/Ctrl+V outside text editing, Edit › Paste or Slide › Paste slide; the slide goes after the current slide, in one undo step.
- **Versions:** a slide from a later major format is refused with a notice; a layout the destination does not know becomes the default layout, with a notice.
- **Browsers:** between tabs of Chrome, Edge and Firefox through the custom clipboard type, and between Safari documents or different browsers through `text/html`; a slide with very large images travels by the custom type only. The released 0.7.2 editor refuses a slide with a notice.
- **Without ECharts:** the chart keeps its JSON and shows the source's preview, sanitised, until ECharts loads and redraws it in the destination's colours.
- **Other applications** receive the slide's text as simple HTML and as an outline, without a picture.

### V1-02 — Create and retain reusable themes

Add a skill workflow that derives a reusable theme from a set of reference files, saves the result, and makes it available to the skill when generating future documents. The requested outcome is a retained theme library, not a one-off recreation for a single deck.

Acceptance goals:

- Start with brand styling: colours, typography, chart palette, logos and footer conventions. Recreating a new layout system is a separate scope decision.
- Show a small preview deck with representative titles, text, tables and charts for review before retaining the theme.
- Give themes stable names and make saved themes selectable for new documents. Retain them across skill updates.
- Keep client-derived themes and reference files private; the public repository contains only material explicitly intended for public distribution.

Before implementation, settle supported reference file types and the storage model. Proposed approach: built-in themes ship with the skill; user-created themes live in a persistent private library discovered by the skill. Exact paths, versioning and naming remain open.

### V1-03 — Short generation brief and settings confirmation

Before creating a new document, collect language and theme choices and present a compact settings summary for approval. Reuse information already supplied by the user and the existing objective/audience/length brief, without asking the same questions again.

Acceptance goals:

- Show the proposed language, selected theme and defaults together: **16:9, ECharts via CDN, embedded SVG chart snapshots**.
- Explain the practical default: charts are readable offline from SVG snapshots; editing chart data requires a connection unless ECharts is embedded.
- Keep the confirmation concise, with an easy way to accept the proposed settings or request changes before generation.
- Persist language/locale so chart labels, numbers and dates follow the document language as well as slide text.

V1's proposed supported canvas remains 16:9. Additional aspect ratios require separate layout, editor and PDF work. SVG chart snapshots remain part of the portable document. Define the language/locale choices and how the offline chart-editing option is presented before implementation.

### V1-04 — Copy/paste elements and selections

Extend reuse to individual elements and multi-element selections, within a document and between documents. This shares the transfer foundation of V1-01 and follows the same destination-theme rule.

Acceptance goals:

- Preserve editable text, shapes, tables, charts and images, their required assets, and relative positions within a selection.
- Remap identifiers, keep pasted elements within the destination slide, and support undo/redo, drafts and save/reopen.
- Preserve normal text-selection copy/paste while editing text; define placement and repeated-paste behaviour before implementation.

Tables come first, through the cross-product clipboard of [ADR-013](decisions/013-cross-product-clipboard.md) (X02b, 27 October 2026): one selected `table.t` is copied, and a pasted table becomes a new element on the current slide, placed like an inserted element (a repeated paste is offset by 16 px), in one undoable step. Charts followed in X02c: one selected chart is copied, with a picture for other applications. Whole slides followed with V1-01. Other elements and multi-element selections remain planned.

### V1-05 — Crop and replace images

Add image cropping and replacement controls for manual refinement.

Acceptance goals:

- Crop an image within its existing frame without moving or resizing the frame or neighbouring elements; allow the crop to be readjusted.
- Replace the image while retaining the frame's position and dimensions; define how an existing crop adapts to a different image aspect ratio.
- Preserve useful alternative text or offer to update it, keep required assets embedded, and support undo/redo, drafts, save/reopen and PDF output.

### V1-06 — Text density checks per layout region

Today `check` reports overflow after rendering. Add explicit fill targets per layout region so an LLM gets earlier, more useful feedback. Adapted from the jayson-docs density model (decisions D23 and D26).

Acceptance goals:

- Each text region of each layout has two bounds. Above the **comfortable range**, `check` warns but does not fail. Above the **maximum**, it reports an error. Content is never truncated automatically.
- The comfortable range is derived from the region's geometry and effective font size, not set by hand: lines ≈ height / (font size × 1.2), characters per line ≈ width / (font size × 0.5), with the range at roughly 55–85% of that capacity. It flags under-filled as well as over-filled body regions. Titles and labels, which are meant to be sparse, only get a maximum.
- The two constants are calibrated once against a few real slides and recorded in a fixture. A test fails if the published bounds drift from the derivation.
- The bounds are documented in the format reference so an LLM can aim for them before running `check`.

Before implementation, decide which regions count as body regions, how bullets and table cells are measured, and how detached slides (with frozen geometry) are handled.

### V1-07 — Annotated layout catalogue for LLMs

Give each layout a short machine-readable entry in the format reference and the embedded guide. Adapted from the jayson-docs layout catalogue (decision D16).

Acceptance goals:

- Each entry states a **usage tier** (common, less common, rare), a "pick when…" sentence, and a map of its regions with their V1-06 bounds.
- The guidance tells an LLM to prefer common layouts and to justify a rare one. The catalogue informs the choice and the fill; it never lets the LLM place elements by coordinates.
- Layout names stay stable. The entries are generated from, or tested against, the layout definitions so they cannot drift.

## Ideas backlog (not approved)

Recorded on 18 October 2026 from the review of the jayson-docs and jayson-editor projects and the engine stress test; B-05 and B-06 were added on 27 November 2026 from two external reviews, to consider after the ADR-016 outcome. These are candidates to evaluate later, **not approved scope**. Each needs its own scope decision before work starts.

| ID | Idea | Notes |
| --- | --- | --- |
| B-01 | Classic consulting diagrams as fixed layouts: 2×2 matrix, process in 3/4/5 steps, KPI cards, pyramid, funnel, roadmap, red/amber/green status table | Fixed number of cells per variant, each cell with its own V1-06 bounds; tables grow inside a fixed frame (jayson-docs D27) |
| B-02 | A private "firm context" folder for the skill | Markdown/JSON derivatives classed public, internal or confidential; assets referenced by path. Evaluate when V1-02 starts |
| B-03 | An origin for each theme: built-in, company-approved or personal | A personal theme can be promoted after review, with a check on receipt (jayson-docs D17). Evaluate when V1-02 starts |
| B-04 | A smaller ECharts build for all products | Selected chart types plus the SVG renderer: about 610 KB instead of 1,122 KB minified in the reproducible probe. Savings apply to the ECharts component; whole-file savings and chart coverage still need validation. Needs a versioned distribution with integrity checks. See the [engine stress test](ENGINE-STRESS-TEST.md#echarts) |
| B-05 | An allow-list of permitted elements and attributes in the Slides content checker, instead of the list of forbidden ones | `src/format.js` refuses known active and raw-text elements (`ACTIVE_TAGS`) and `tools/validation.mjs` adds the parse–serialise–parse check, which closed the vector found on 22 November 2026; no exploit is known. An allow-list (the layouts, primitives, tables, figures, images and inline formatting of FORMAT and CATALOGUE, attributes per element, positional `style` only) would stop needing a patch for each parser quirk; `packages/text/model/format.mjs` is the stricter model to follow. Regression cases to keep: the payloads of the 22 November review, an unknown element, an `on*` attribute, a `javascript:` URL, an SVG `<animate>`, both example decks at zero errors. Deferred because changing the checker just before the measurement could refuse valid decks |
| B-06 | Split `src/engine/editor.js` by responsibility, with a size budget for `dist/engine.js` enforced by a test | `editor.js` is 1,089 lines and `dist/engine.js` 492,875 bytes on 27 November 2026 (about 340 KB in 0.4). Suggested split: selection and Moveable, text editing, insertion, slide operations, keyboard; behaviour unchanged, bundle no larger. A restructuring with no effect for the user, so it waits for the outcome |

## Validation still required

Run the go/stop measurement of [ADR-016](decisions/016-slides-go-stop-gate.md), which replaced the five task comparisons on 27 November 2026. Run the context-free LLM test using only the generated HTML. Check a text change, an added slide, and chart data modification; review preservation and saved SVGs. Test file saving and reopening on another workstation and inspect PDF fidelity.

Automated success is necessary but does not prove these usage outcomes. See [VALIDATION-V1.md](VALIDATION-V1.md).

## V2 boundaries

Real-time collaboration, comments, signed updates, attached connectors, and PPTX export are outside V1. Begin a new architecture decision only after the usage evidence supports continuing.
