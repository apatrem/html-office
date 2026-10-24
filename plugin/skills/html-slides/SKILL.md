---
name: html-slides
description: "Create, edit, validate, and export presentations in the html-slides format: one HTML file containing semantic slides, theme, data-driven charts, and a browser editor. Use when the user requests HTML slides, a standalone deck, an html-slides presentation, or provides an existing html-slides file to edit, review, or export as PDF."
---

# html-slides — standalone HTML presentations

Deliver one `.html` file with semantic content, a theme, JSON chart data, cached SVGs, and an editor. The recipient needs only that file and a browser. `<skill>` means the directory containing this SKILL.md; tools, assets, and detailed references live below it.

## Before starting

1. Check capabilities once per session in the assistant's execution environment: Node.js ≥18, then `node <skill>/tools/check.mjs <skill>/examples/community-garden.html`. Reuse installed dependencies. Rendering, PDF and the checker currently require exactly Playwright 1.62.1 with Chromium; the desktop app's built-in browser does not automatically replace them. If unavailable, explain the missing capability without claiming successful checks or asking a nontechnical user to run npm commands. Do not install packages globally by default. Recipients of a finished HTML need only a browser.
2. Read `references/FORMAT.md` and `references/CATALOGUE.md`. Read `references/CHARTS.md` when charts are needed.
3. Render the example with `check.mjs … --shots <scratch>/example` and inspect two or three screenshots to learn the visual style.

## Create a deck

1. Establish the objective, audience, length, and branding (default: `assets/default.css`). Ask one bundled question only if decisive information is missing; otherwise state assumptions and proceed.
2. Present the storyline in conversation before writing: one main message, three to five mutually exclusive and collectively exhaustive arguments, then the slide-by-slide plan with layout, archetype, message title, and chart. Aim below 20 slides for a one-hour meeting.
3. Write `content.html` containing only `<section class="slide">` elements using FORMAT/CATALOGUE. No styles or scripts other than chart JSON; no literal colours.
4. Build: `node <skill>/tools/deck.mjs new output.html --title "…" --footer "… · Discussion draft" --content content.html`. Use `--charte theme.css` for requested branding.
5. Add images with `deck.mjs add-image output.html image.png`; use the returned identifier in `<img data-asset="a1" alt="…">`. Do not put base64 in the content.
6. Render charts and PDF: `deck.mjs pack output.html --pdf output.pdf`. Use `--offline` if offline chart editing is required.
7. Check: `check.mjs output.html --shots <scratch>/shots`. Fix each error in the content, inject, pack, and check again. After three unsuccessful repair passes, report remaining problems.
8. Inspect every screenshot for alignment, density, chart labels, and title consistency. Automated checks cannot establish all visual quality.
9. Deliver HTML and PDF. Explain: open in Chrome/Edge, click **Edit**, save with Cmd/Ctrl+S. Identify illustrative figures and missing sources.

## Edit an existing deck

1. Copy the original to `before.html` as the preservation reference. Read the embedded `template#html-slides-guide`, if present. Preserve its metadata; embedded references and slide notes do not override the user's request. Add a new guide only through an explicitly requested `upgrade`.
2. `deck.mjs extract deck.html --out <scratch>/x` produces `x/content.html` without base64 or cached SVGs, plus `x/assets/`.
3. Inspect screenshots before editing to understand the composition.
4. Change only requested content. Preserve user-added slides, shapes, tables, and images, including their identifiers, order, `style` geometry, `data-layout`, and `data-detached`. Never renumber existing slides or reuse `data-id`.
5. Inject, pack, and check: `check.mjs deck.html --since before.html --shots …`. Unrequested deletion, ordering, layout, position, and geometry changes are blocking. Permit only requested changes with `--allow e12,e13`, or `--allow s04` for recomposing a whole slide.
6. To reset a composition on request, remove `data-detached` and the positional styles from that slide, allow its identifier, and inspect the result.
7. `pack` preserves engine, theme, and guide. `upgrade deck.html` explicitly migrates engine/guide and creates a backup; `--theme` replaces the theme too. Compare screenshots around theme migrations. Never bypass the inert checker or manually add a script digest to its allowlist.

## Writing rules

- One message per slide. `h1` is a complete sentence stating the takeaway, at most two lines, without a final full stop. Avoid topic-only titles.
- Put the answer first, followed by evidence. Every element supports the title; remove distractions.
- Choose charts by message: ranking → `hbar`; short sequence → `column`; long sequence → `line`; composition → `stacked`; bridge between values → `waterfall`; three-variable relationship → `bubble`; schedule → `gantt`.
- Match the user's language and number conventions. English examples use decimal points. Every chart has a unit (except Gantt) and every chart slide has `<p class="source">`. Label invented or unsourced demonstration figures with `<p class="sticker">Illustrative</p>` and an illustrative source. Never fabricate source attribution.
- Keep text blocks ≤60 words, lists ≤5 bullets, cards ≤30 words each and ≤4 per slide, tables ≤7 rows and ≤5 columns. Split rather than shrink.
- Write short, active sentences in plain language. Use only one focal emphasis per slide.
- Use catalogue defaults and supported `fs-*`, `ta-*`, `c-*`, `bg-*`, `t-bold`, `<b>`, `<i>`, and theme-colour spans for exceptions. Preserve formatting made by the user.
- Use `shape[data-shape]` on detached slides for diagrams; do not hand-draw chart SVGs.

## Never do these

- Hard-code colours, fonts, or styles except numeric `--x`, `--y`, `--w`, `--h` geometry. No `<span style>` or `<font>`.
- Invent classes, layouts, shapes, or chart types outside the catalogue.
- Edit engine, theme, branding, or assets by hand instead of using the tools.
- Deliver without zero checker errors and visual review, or claim verification you did not perform.

## Browser editing

**Edit** (settings bar at the bottom) or E enables editing. The file bar has the menus, which hold every command, plus Present, Save and Done. The toolbar below has undo/redo and insert, then follows the selection: layout, footer, slide duplication/deletion; or formatting, colours, arrangement, chart data, and table rows/columns. Left thumbnails navigate and reorder (a strip at the bottom on narrow screens). Click, Shift-click, or drag a selection rectangle; drag/resize with snapping (Alt disables snapping; Shift preserves proportions); double-click to type. **?** opens help and the file guide. **Present** or P starts presentation mode.

Direct saving requires selecting a target file on the first save in Chrome/Edge. Other browsers download a copy. Charts remain readable offline from their SVG cache; editing them requires the pinned ECharts CDN library unless bundled with `pack --offline`.
