# V1 plan — standalone, editable HTML presentations

Status: implemented core, usage validation pending; approved V1 additions not yet implemented. Roadmap updated on 18 October 2026. The delivered baseline below describes releases 0.7.0 and 0.7.1.

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

## Approved V1 backlog

The following features were approved for later V1 development: V1-01 to V1-05 on 15 October 2026, V1-06 and V1-07 on 18 October 2026. All are **planned, not started**. They are product scope and acceptance goals, not frozen implementation specifications or release commitments. Development order and technical details will be settled when each feature starts.

| ID | Feature | Status |
| --- | --- | --- |
| V1-01 | Copy/paste complete slides between documents in separate browser tabs | Planned |
| V1-02 | Create reusable themes from reference files | Planned |
| V1-03 | Confirm a short generation brief and default settings | Planned |
| V1-04 | Copy/paste individual elements and selections | Planned |
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

Recorded on 18 October 2026 from the review of the jayson-docs and jayson-editor projects and the engine stress test. These are candidates to evaluate later, **not approved scope**. Each needs its own scope decision before work starts.

| ID | Idea | Notes |
| --- | --- | --- |
| B-01 | Classic consulting diagrams as fixed layouts: 2×2 matrix, process in 3/4/5 steps, KPI cards, pyramid, funnel, roadmap, red/amber/green status table | Fixed number of cells per variant, each cell with its own V1-06 bounds; tables grow inside a fixed frame (jayson-docs D27) |
| B-02 | A private "firm context" folder for the skill | Markdown/JSON derivatives classed public, internal or confidential; assets referenced by path. Evaluate when V1-02 starts |
| B-03 | An origin for each theme: built-in, company-approved or personal | A personal theme can be promoted after review, with a check on receipt (jayson-docs D17). Evaluate when V1-02 starts |
| B-04 | A smaller ECharts build for all products | Only the chart types used plus the SVG renderer: 612 KB instead of 1,122 KB minified. Needs self-hosting through jsDelivr with integrity checks. See the [engine stress test](ENGINE-STRESS-TEST.md#echarts) |

## Validation still required

Run the context-free LLM test using only the generated HTML. Check a text change, an added slide, and chart data modification; review preservation and saved SVGs. Record five task comparisons including manual corrections, sharing, and later edits. Test file saving and reopening on another workstation and inspect PDF fidelity.

Automated success is necessary but does not prove these usage outcomes. See [VALIDATION-V1.md](VALIDATION-V1.md).

## V2 boundaries

Real-time collaboration, comments, signed updates, attached connectors, and PPTX export are outside V1. Begin a new architecture decision only after the usage evidence supports continuing.
