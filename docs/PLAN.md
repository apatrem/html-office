# V1 plan — standalone, editable HTML presentations

Status: implemented core, usage validation pending. Updated for release 0.7.0 on 14 October 2026.

## Objective

Create and revise a presentation with an LLM, refine it in a browser, and deliver one HTML file plus an optional PDF. The file remains readable and editable without the authoring skill. Measure usefulness over five representative tasks before starting collaboration work.

## Architecture and scope

V1 uses semantic HTML for content, CSS variables for branding, named layouts, JSON-driven charts with SVG caches, and an embedded editor. Canvas: 1,280 ×720 px. First manual movement detaches a template slide and freezes every element's geometry, preserving neighbours.

The DOM is the current model; undo uses HTML snapshots. Stable identifiers support preservation checks, but do not enable concurrent conflict resolution. V2 requires a separate mutation/history architecture; it cannot simply attach collaboration to V1. See [ADR-001](decisions/001-v1-dom-et-migrations.md).

## Delivered capabilities

- Slide insertion, duplication, deletion, and reordering; text, shapes, images, tables, and seven chart types.
- Snapping, resize, alignment, distribution, theme-based formatting, chart/table data editing, footer controls, presentation, and PDF.
- Complete drafts with deck attributes and assets; queued saves preserve subsequent edits; errors and cancelled writes keep drafts.
- Inert preflight before execution, recognised script digests, network-limited rendering, and preservation comparison against stable references.
- Explicit migrations: `pack` preserves engine/theme/guide; `upgrade` replaces engine/guide with a backup; theme replacement is opt-in.
- Thumbnail layout preservation, rebinding after undo/redo, and refresh after delayed chart loading.
- A versioned, inert guide embedded before technical blocks; complete chart examples and compatible distribution links. See [ADR-002](decisions/002-guide-embarque.md).
- Pinned ECharts 6.1.0 with SHA-384 SRI/anonymous CORS, SVG fallback, and offline embedding.
- English documentation, UI, templates, and fictional examples. Public MIT repository, release archive, and CI.

## Validation still required

Run the context-free LLM test using only the generated HTML. Check a text change, an added slide, and chart data modification; review preservation and saved SVGs. Record five task comparisons including manual corrections, sharing, and later edits. Test file saving and reopening on another workstation and inspect PDF fidelity.

Automated success is necessary but does not prove these usage outcomes. See [VALIDATION-V1.md](VALIDATION-V1.md).

## V2 boundaries

Real-time collaboration, comments, signed updates, attached connectors, and PPTX export are outside V1. Begin a new architecture decision only after the usage evidence supports continuing.
