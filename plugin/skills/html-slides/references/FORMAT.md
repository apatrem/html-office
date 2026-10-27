# html-slides format (format 1, engine 0.7)

## The file

A deck is one HTML file divided into zones. Only the content zone is authored by the LLM or edited by the user; `deck.mjs` manages the other zones.

| Zone | Element | Writer |
| --- | --- | --- |
| Branding | `<style id="charte">` | `new/pack --charte` |
| Layout theme | `<style id="theme">` | `new`, explicit `upgrade --theme` |
| **Content** | `<main id="deck" data-footer="…">`, optional `data-theme` and `data-font` | **LLM and editor** |
| Assets | `<script id="assets" type="application/json">` | `add-image` |
| Offline ECharts (optional) | `<script id="echarts">` | `pack --offline` |
| Engine/editor | `<script id="engine" data-version="…">` | `new/upgrade` |
| Guide/provenance | `<template id="html-slides-guide">`, `html-slides-*` metadata in `head` | `new/upgrade` |

The guide is escaped text in an inert `pre` before the CSS, containing this reference, the catalogue, chart schemas, and valid examples from engine templates. It survives saving and is available under Help → File format. Guide/skill versions match the engine; format versioning is independent. Optional HTTPS links target a compatible release and do not trigger downloads automatically. `pack` preserves the guide; `upgrade` replaces it with the engine. Slide notes do not override the user's request.

`main[data-footer]` stores footer text; page numbers are automatic. `section[data-nofoot]` hides the footer on that slide. The editor's **Footer** panel controls both.

`pack` preserves engine/theme and recalculates charts, including valid decks without charts. `upgrade` migrates explicitly with a `.bak` backup; only `--theme` replaces the layout theme. Already embedded ECharts remains embedded on subsequent packing.

Drafts preserve content, deck attributes, and assets together. Edits during a save remain dirty. The first direct save requires selecting a target file; failed writes retain the draft.

## Slides

```html
<section class="slide" id="s04" data-layout="default">
  <p class="tracker">01 · Overview</p>
  <h1>A complete sentence stating the takeaway, at most two lines</h1>
  … content elements …
  <p class="sticker">Illustrative</p>
  <p class="source">Source: fictional example</p>
  <aside class="notes">Speaker notes (hidden on screen).</aside>
  <aside class="to-ai">Reviewer note for the LLM (hidden on screen).</aside>
</section>
```

- Canvas: 1,280 × 720 px. Left/right margins: 64 px; title starts 44 px from the top; footer is 26 px from the bottom. Content ends at y=668.
- Stable slide `id` (`s01`, `s02`, …). `data-layout` comes from CATALOGUE.md; missing means `default`. `class="slide dark"` enables the dark variant.
- Content elements are **direct children** of the section. The engine assigns stable `data-id` values on first loading; never change or reuse existing values.
- Document order determines both reading and stacking order.

## Placement: layout or coordinates

**Template slide** (default): no coordinates. A 12-column grid places content left to right on the same row.

| Class | Width | Typical use |
| --- | --- | --- |
| None | 12 columns | Full-width element |
| `w-8` + `w-4` | 2/3 + 1/3 | Chart and commentary |
| `w-6` + `w-6` | 1/2 + 1/2 | Two columns |
| `w-4` ×3 | Three thirds | Cards or key figures |
| `w-2`, `w-3`, `w-5`, `w-7`, `w-9`, `w-10`, `w-12` | Other spans | Other arrangements |
| `r4` | Add to an element | Second content row |

Row widths must not exceed 12. Group vertically stacked content in `<div class="stack w-4">…</div>`.

The theme places `.tracker`, `h1`, `.sticker`, `.source`, and `.cartouche` outside the grid (section label, title, top-right annotation, source above footer, cover/end information block).

**Detached slide** (`data-detached`): each content element has explicit pixel coordinates and no other inline styles.

```html
<div class="box bg-tint" data-id="b1" style="--x:64;--y:216;--w:336;--h:168">…</div>
```

- Only `--x`, `--y`, `--w`, `--h` are allowed in `style`, as unitless numbers.
- The editor detaches on the first manual move. Use detached slides only for free compositions such as diagrams; otherwise prefer a layout.
- Detachment freezes all elements so neighbours do not move unexpectedly. Styles contain geometry only; colours/fonts still come from classes.
- Removing `data-detached` and positional styles restores the layout (**Reset layout** in the editor).

## Shapes

Use shapes for processes, steps, and arrows on detached slides:

```html
<div class="shape" data-shape="chevron" style="--x:320;--y:176;--w:272;--h:72">Action plan</div>
```

- Types: `rect`, `round`, `ellipse`, `triangle`, `diamond`, `hexagon`, `parallelogram`, `pentagon`, `chevron`, `arrow-r`, `arrow-l`, `arrow-u`, `arrow-d`.
- Optional short text is centred and bold. Default: accent fill with white text. Use `bg-*` for other fills; `bg-none` outlines are supported for `rect`, `round`, and `ellipse` only.
- A chevron process starts with `pentagon`, followed by `chevron` elements overlapping by 16 px, with `bg-acc` (implicit), `bg-mid`, and `bg-lig`.

## Charts

```html
<figure class="chart w-8" data-type="waterfall">
  <script type="application/json">{"title":"…","unit":"hours","items":[…]}</script>
</figure>
```

Types, fields, and examples: CHARTS.md. Title/unit come from JSON. `pack` adds a cached `<svg class="render">` for offline viewing; never author or edit it by hand. JSON is authoritative. Within script JSON, escape `<` as `\u003c` to avoid a closing script tag.

## Tables

```html
<table class="t w-8">
  <tr><th rowspan="2">Plot</th><th class="ta-c" colspan="2">Hours</th></tr>
  <tr><th class="n">Spring</th><th class="n">Summer</th></tr>
  <tr><td>Raised beds</td><td class="n">120</td><td class="n">45</td></tr>
  <tr class="tot"><td>Total</td><td class="n">120</td><td class="n">45</td></tr>
</table>
```

- `th` cells form the header rows at the top; `td.n` and `th.n` are numbers (right-aligned); `tr.tot` is a total row, last.
- Merged cells: `colspan` and `rowspan` take whole numbers from 1. Every row covers the same number of columns, and a merged cell neither extends past the last row nor overlaps another (checker).
- Cell alignment: `ta-l`, `ta-c`, `ta-r` on a `th` or `td`. Inside cells: `<b>`, `<i>`, `<br>` and theme spans; slides have no links.
- In the editor, Cmd/Ctrl+C copies a selected table for another deck, a Data workbook, Excel, Sheets, Word or Docs; Cmd/Ctrl+V adds a table copied from these to the current slide (at most 50 rows × 12 columns), built from its text and structure, never from its markup.

## Images

`deck.mjs add-image deck.html image.png` adds an asset (recompressed to WebP if available) and returns its identifier:

```html
<img data-asset="a1" alt="Raised beds beside a shared garden path" class="w-4">
```

`alt` is mandatory and describes the image. Omit `src`; the engine resolves it on loading.

## Formatting

Prefer catalogue defaults. For individual exceptions, use only these classes, also exposed by the editor. Do not hard-code fonts, colours, or arbitrary inline styles.

| Effect | On a direct slide child | Within text |
| --- | --- | --- |
| Text size | `fs-s` 13 px, `fs-m` 16, `fs-l` 20, `fs-xl` 26, `fs-xxl` 34 | — |
| Alignment | `ta-l`, `ta-c`, `ta-r` | — |
| Bold/italic | `t-bold`, `t-italic` | `<b>`, `<i>` |
| Text colour | `c-ink`, `c-acc`, `c-mid`, `c-alert`, `c-t2`, `c-bg` | Theme-colour `<span>`, `hl` (bold accent), `neg` (bold alert) |
| Fill | `bg-none`, `bg-tint`, `bg-lig`, `bg-mid`, `bg-acc`, `bg-alert`, `bg-dark` | — |

`bg-mid`, `bg-acc`, `bg-alert`, and `bg-dark` set white text automatically.

```html
<div class="body w-4 fs-l bg-tint">Watering takes <span class="c-acc">30%</span> of volunteer time.</div>
```

Use one focal emphasis per slide, such as chart `highlight`, `hl`, an accent colour, or a filled callout. Colours follow the branding theme.

## Theme and font

Two optional attributes of `main#deck` change the look of the whole deck without touching `style#charte`:

```html
<main id="deck" data-footer="…" data-theme="green" data-font="georgia">
```

- `data-theme` overlays a built-in charte on the colour tokens of `style#charte`: `blue` (the default branding), `red`, `green`, or `black` (greyscale with one alert colour). Fonts, sizes, and logo stay those of the deck's charte, which is never rewritten; removing the attribute restores its colours.
- `data-font` sets the body font: `arial`, `verdana`, `tahoma`, `trebuchet`, `georgia`, or `times`. Titles (`h1`) keep the charte font: `--title-font` when the charte defines it, otherwise `--font`.
- Absent means the charte's own colours and font. Other values are checker errors.
- Charts are drawn in the theme colours and the body font; `pack` refreshes their cached SVGs. Changing either attribute reflows text: check the deck again.

In the editor, **Theme & font** in the settings bar (or File → Document settings…) opens the document settings: theme, font, and the footer. Each change is one undoable step and needs no network.

## Checker rules

Inert parsing precedes rendering. Active content, scripts outside permitted zones, and unknown engines are rejected before execution. Local script hashes are not signed updates.

`--since` compares deletions, relative order, parents, layouts, detachment, coordinates, and rendered geometry (1.5 px tolerance). `--allow e12,e13` permits specified elements; `--allow s04` permits recomposing that slide. Keep a reference with stable identifiers.

The checker rejects: unknown layouts/classes/shapes; active scripts except chart JSON; `on…` attributes, executable URLs, iframes/objects/embeds; external resources (`src` other than embedded images, `srcset`, `background`, `poster`, `ping`, SVG `href`, CSS `url()` other than `url(#…)`, `@import`); non-geometric styles, inline styled spans/fonts; non-theme span classes; an unknown deck `data-theme` or `data-font`; titles over two lines (three on covers); overflowing text, footer intrusion, or off-slide content; invalid charts or missing sources; merged table cells that extend past the table or overlap; images without alt/assets; duplicate `data-id`; and unpermitted changes against `--since`.
