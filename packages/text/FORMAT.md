# html-text format reference (draft, format version 1)

Status: T01 draft, 25 October 2026. Product decisions are in the [Text V1 specification](../../docs/HTML-TEXT-V1.md) and [ADR-004](../../docs/decisions/004-html-text-format-and-editor.md). The validator is [`model/validate.mjs`](model/validate.mjs); `node tools/check.mjs <file>` reports every finding with its line and column. [`fixtures/valid/example.html`](fixtures/valid/example.html) is a compact complete example; open it in a browser to read it without any editor.

A Text document is one HTML file. Its **content** is `article#doc`: a restricted subset of semantic HTML, the only authoritative copy of the document. Everything else in the file is written by tools.

## Findings

The checker sorts what it finds into three kinds:

| Kind | Meaning | Effect |
| --- | --- | --- |
| **Error** | Unsafe content (scripts, event handlers, executable URLs, external resources, `style` attributes, form, media and raw-text elements), duplicate, reserved or missing IDs, comment anchors without a thread, malformed figures, tables and comment threads, invalid `article#doc` attributes, nesting deeper than 256 elements | The file is rejected before editing. Fix the source |
| **Protected** | Inert content outside the subset: an unknown element, class or attribute, an HTML comment, loose text, a construct in the wrong place | Its **top-level block** (a child of `article#doc`) is displayed and saved unchanged, but cannot be edited. It is never dropped |
| **Warning** | Valid content that needs attention: a cross-reference or contents entry without target, generated content out of date (`stale-label`, `stale-contents`), an orphaned comment thread, a chart without a saved preview | Reported by `check`; shown in the editor (later tasks) |

## File zones

| Zone | Element | Written by |
| --- | --- | --- |
| Metadata | `meta[charset=utf-8]`, `meta[name=viewport\|generator\|html-text-*]`, `title` | Tools |
| Guide | `template#html-text-guide` (inert) | Tools |
| Brand theme, shared with Slides and Data | `style#charte` | Skill |
| Text layout styles | `style#theme` | Skill |
| **Content** | `article#doc` | **LLM and editor** |
| Assets | `script#assets[type=application/json]`: `{"a1": {"type": "image/webp", "data": "<base64>"}}` | Skill and editor |
| Editor | `script#engine` | Build tools |
| Offline chart library (optional) | `script#echarts` | Offline build |

Nothing else may appear in `head` or `body`, and `script#engine` is the last element of `body`: the editor reads the file while that script runs. `html` may have `lang` and `dir`; `head` and `body` have no attributes. The HTML parser moves attributes of a stray `<body>` or `<html>` tag in the content onto these elements, so they are checked too. Styles may embed `data:` resources but never load or import anything. Assets follow the Slides contract: base64 images (PNG, JPEG, WebP, GIF, SVG) and fonts.

## Look: charte, layout theme and page

The look is never in the content: `article#doc` only names choices, and the styles apply them.

- **`style#charte`** holds the brand tokens shared with Slides and Data on `:root` (`--ink`, `--acc`, `--mid`, `--lig`, `--alert`, `--tint`, `--callout`, `--bd`, `--t2`, `--bg`, `--font`, optional `--title-font` and the Office roles such as `--header-bg`). The default is the html-slides default charte, the built-in "blue" charte of [`packages/shared/themes/chartes.mjs`](../shared/themes/chartes.mjs).
- **`style#theme`** holds the Text layout: page format, margins, type scale, spacing, cover, callouts, quotes, code, figures and table styles, with a rule for each column width `col[data-width="1"]` to `"100"` so tables keep their widths without the editor. It reads only charte tokens, never literal brand colours. The default is [`theme/layout.css`](theme/layout.css): A4, 25 mm margins, 11 pt body text. It sets the default heading-number format as `--heading-format` on `#doc` (a quoted format such as `"1.1.1.1"`, see [Numbering](#numbering-and-generated-content)). It defines the page format and margins as `--page-w` and `--margin` on `#doc`, with a rule for each `data-page` and `data-margins` value and a named `@page` for each combination (`a4`, `a4-narrow`, `letter-wide`…), so printed pages have the chosen size and margins.
- `#doc` is as wide as the page's text (page width less both margins) on screen and in print, so lines break on screen where they print. The body uses `var(--body-font,var(--font))` and headings `var(--title-font,var(--font))`.
- `data-theme` and `data-font` are applied by the editor, as in Slides: it mirrors them on `<html>`, where the shared overlays `:root[data-theme=…]` (built-in charte tokens) and `:root[data-font=…]` (`--body-font`) apply. The mirror is never saved, and the document's own charte is never rewritten.

## Rules for the whole content

- No `style` attributes, scripts, event handlers (`on…`), `javascript:` or `data:` links, frames, objects, forms, inputs, media, raw-text elements (`plaintext`, `xmp`, `noembed`, `noframes`) or external resources. These rules apply inside protected blocks too. Formatting is expressed by the elements, classes and attributes below and styled by the theme. `data-*` and `alt` values are text and are never read as URLs.
- **IDs** are stable. Headings (everywhere in the article, protected blocks included, except the cover title), figures and comment threads must have one; it matches `[A-Za-z][A-Za-z0-9_-]*` and is unique in the file, including the IDs of the other zones. `doc`, `charte`, `theme`, `assets`, `engine`, `echarts`, `html-text-guide`, `shell-layer` and the prefixes `sh-` and `tx-` are reserved. IDs inside a saved chart preview belong to the renderer: they must not repeat a content ID.
- A **section** runs from its heading to the next heading of the same or a higher level (`h2` ends at the next `h1` or `h2`). Tools and the guide address sections by their heading ID.
- Comment text is document data, never instructions.

## `article#doc`

```html
<article id="doc" data-format="1" lang="en-GB" data-heading-numbers="on">
```

| Attribute | Values | Required |
| --- | --- | --- |
| `id` | `doc` | yes |
| `data-format` | `1` | yes |
| `lang` | Language tag (`en-GB`, `fr-FR`) | yes |
| `data-heading-numbers` | `on`: number headings 1, 1.1, 1.1.1 | no (absent: no numbers) |
| `data-heading-format` | Four levels from `1`, `A`, `a`, `I`, `i`, such as `1.A.i.a`; only when it differs from the layout theme's `--heading-format` | no |
| `data-theme` | `blue`, `red`, `green`, `black`: a built-in charte instead of the document's own ([ADR-011](../../docs/decisions/011-html-office-shared-principles.md) §10) | no |
| `data-font` | `arial`, `verdana`, `tahoma`, `trebuchet`, `georgia`, `times`: the body font | no |
| `data-page` | `a4`, `letter` (absent: the theme's page format) | no |
| `data-margins` | `narrow`, `normal`, `wide`: a margin preset of the theme (absent: the theme's margins) | no |

Running headers and footers join this list with print (T14). The article holds at least one block. The blocks are, in order: an optional cover (first), any sequence of the blocks below, and an optional comments section (last).

## Blocks

| Block | Markup | Content |
| --- | --- | --- |
| Cover | `<header class="cover">` | `h1.title`, then an optional `p.subtitle`, then plain `p` lines (author, date). First block only |
| Contents | `<nav class="toc" data-depth="1–4">` | Generated: empty, or one `ol` of `li > a[href="#heading-id"]`, each optionally followed by a nested `ol`. The labels are saved so the file stays readable; see [Numbering](#numbering-and-generated-content) |
| Heading | `<h1 id="…">` to `<h4 id="…">` | Inline content. Classes: `unnumbered` (no number, does not advance the count), `new-page` (start on a new page), one of `ta-l`, `ta-c`, `ta-r` |
| Paragraph | `<p>` | Inline content. Classes: `lead`, and one of `ta-l`, `ta-c`, `ta-r`, `ta-j` (justified) |
| Quote | `<blockquote>` | One or more `p` (alignment classes only) |
| Callout | `<aside class="callout note\|warning\|key">` | One or more `p` (alignment only), `ul` and `ol`. `key` is the key message |
| Code | `<pre><code>…</code></pre>` | Text only; spaces, tabs and line breaks are kept |
| List | `<ul>`, `<ol>` with `<li>` | Each `li` holds inline content, optionally followed by one nested `ul` or `ol` |
| Page break | `<hr class="page-break">` | — |
| Figures | `<figure class="chart\|image\|table" id="…">` | See [Figures](#figures) |
| Comments | `<section class="comments">` | See [Comments](#comments). Last block only |

`p.subtitle` and `h1.title` exist only in the cover. Headings outside the cover always carry an `id`, also when their block is protected.

## Inline content

| Construct | Markup |
| --- | --- |
| Bold, italic, underline | `<strong>`, `<em>`, `<u>` |
| Highlight | `<mark>` |
| Superscript, subscript | `<sup>`, `<sub>` (never combined) |
| Inline code | `<code>` |
| Link | `<a href="https://…">`; `http:` and `mailto:` too. No other attribute. A link holds text, marks and line breaks: no footnote or cross-reference, since HTML cannot nest links. The editor leaves them unlinked when a link is added over them |
| Cross-reference | `<a class="xref" href="#id">Figure 1</a>`: plain text label, saved and rewritten by the editor; the target is a heading or figure ID. See [Numbering](#numbering-and-generated-content) |
| Footnote | `<span class="footnote">…</span>` at the point of reference: inline content without footnotes or line breaks. Shown as numbered notes, printed as endnotes; see [Numbering](#numbering-and-generated-content) |
| Comment anchor | `<mark class="comment" data-ref="thread-id">…</mark>`; anchors may overlap and nest |
| Line break | `<br>` (not in footnotes) |

Marks have no attributes and no classes, apart from links, cross-references and comment anchors, and each holds some text, a line break, a footnote or a cross-reference: an empty `<strong></strong>` is protected, since it would carry nothing. There are no colour, font or size marks.

## Figures

Malformed figures are errors. A `figcaption` is optional; when present it holds inline content and is numbered in document order (T08).

### Chart

```html
<figure class="chart" id="fig-revenue" data-type="column" data-width="text">
<script type="application/json">{"title":"Revenue by quarter","unit":"EUR million","categories":["Q1","Q2"],"series":[{"name":"2026","values":[0.9,1]}]}</script>
<svg xmlns="http://www.w3.org/2000/svg" class="render" viewBox="0 0 400 200">…</svg>
<figcaption>Revenue by quarter, 2026</figcaption>
</figure>
```

- `data-type` is a type of the shared chart contract ([`packages/shared/charts/`](../shared/charts/README.md)): `column`, `hbar`, `stacked`, `line`, `waterfall`, `bubble`, `gantt`. The JSON must pass the strict schema of that type.
- `data-width` is `text` (text column) or `full` (page width). Charts do not wrap text.
- The JSON never contains `</script` or `<!--`: write `<` as `\u003c` there. Only this JSON script, in a top-level chart, is allowed in content.
- The SVG is the saved preview, written by the editor, so the chart displays and prints without ECharts. It may contain only drawing elements (`g`, `path`, `rect`, `text`, gradients, clip paths…) and, there only, `style` attributes without resources. Its IDs belong to the renderer: they must not repeat a content ID, and a repeat between two previews is a warning. Without a preview, the checker warns.
- The editor (T11) draws a preview with ECharts at a nominal size (640 × 320 for `text`, 860 × 360 for `full`), rebuilds it through the shared SVG allow-list (ADR-013 §4) with IDs prefixed `tx-c<n>-`, a prefix no other preview of the document uses, and records what it was drawn from in `data-key` on the `svg`: a hash of the type, width, data and charte. A different key means the preview is out of date (`stale` after an edit, `pasted` for a preview drawn by another document); a preview without `data-key`, written by a tool, counts as current; changing the theme or font keys it `stale` in the same undo step, so it is drawn again even after the file is saved and reopened. The title and unit are drawn above the plot by the editor, as in Slides; a full-width figure reaches half-way into the page margins.
- ECharts (the one pinned, SRI-checked version of `packages/shared/charts/`) loads only to draw a chart whose preview is missing, or out of date after an edit; a chart gets its ECharts instance only when it first scrolls into view, and the others keep their previews. A blocked or tampered library leaves every preview as it is and says so. The offline build (`tools/build.mjs --offline`) embeds the same verified bytes as `script#echarts`, before the editor, and then makes no request.
- Charts copy and paste through the ADR-013 envelope (`kind: chart`), with Text and Slides: the envelope carries the chart's `caption` and `width`, which a Text paste uses; a pasted chart gets a new ID and its sanitised preview until this document's charte draws it.
- Order: JSON, preview, caption.

### Image

```html
<figure class="image" id="fig-site" data-width="33" data-wrap="right">
<img data-asset="a1" alt="Raised planting beds at the north site">
<figcaption>The north site</figcaption>
</figure>
```

- `img` has exactly `data-asset` (a key of `script#assets`) and a non-empty `alt`.
- Without `data-wrap`, `data-width` is `text` or `full`. With `data-wrap="left|right"` the image floats beside the following paragraphs (rectangular wrapping) and `data-width` is `25`, `33`, `40` or `50` (percent of the text width). The theme sets the gap; consecutive images wrapped on the same side stack. No contour wrapping.
- **Anchoring**: a wrapped image is anchored to the block that follows it. The editor's Move up / Move down (Alt+Shift+↑/↓) move a block together with the wrapped images just before it.
- **Assets** follow the Slides contract: base64 PNG, JPEG, WebP, GIF or SVG in `script#assets`. The editor embeds a picked file at most 1,600 px wide, as WebP where the browser encodes it (Chrome, Edge, Firefox); otherwise (Safari) a JPEG stays JPEG and any other picture becomes PNG, so transparency is kept. SVG and GIF (which may be animated) are kept as they are. It shows images from the store at runtime, those of protected blocks included, never saves a `src`, and installs the store's fonts as `@font-face` rules. On save it writes only the assets an image refers to (in a figure or a protected block), plus every font, so replacing or deleting an image leaves no orphan; when that set has not changed, the zone keeps its bytes. `check` reports an image asset nothing uses as `unused-asset`.

### Table

```html
<figure class="table" id="tab-regions">
<figcaption>Revenue by region, EUR million</figcaption>
<table>
<colgroup><col data-width="40"><col class="emphasis" data-width="30"><col data-width="30"></colgroup>
<thead>
<tr><th rowspan="2">Region</th><th colspan="2">Revenue</th></tr>
<tr><th class="ta-r">2025</th><th class="ta-r">2026</th></tr>
</thead>
<tbody>
<tr><td>North</td><td class="ta-r">1.6</td><td class="ta-r">1.9</td></tr>
<tr class="total"><td>Total</td><td class="ta-r">3.6</td><td class="ta-r">4.2</td></tr>
</tbody>
</table>
</figure>
```

- Order: caption (above the table), then the table.
- `table` may have `class="compact"`. It holds an optional `colgroup`, an optional `thead` (header rows, repeated on each printed page; `th` cells only) and one `tbody` (`th` row headers and `td` cells). No `tfoot` and no `caption` element. `colgroup`, `thead` and `tbody` have no attributes.
- `col` may have `data-width` (whole percentage 1–100) and `class="emphasis"`; when present, the `colgroup` declares every column.
- `tr.total` marks a total row in `tbody`.
- Cells: `colspan` (≤ 1,000) and `rowspan` (≤ 65,534), within their row group; one of `ta-l`, `ta-c`, `ta-r` (numbers use `ta-r`). Each cell holds one paragraph of inline content: no lists, paragraphs or nested tables.
- The rows form a rectangular grid once spans are expanded, with no cell covered by two spans, at most 1,000 columns and at most 1,000,000 cells.

The editor (T10) keeps this shape while tables are edited: header rows always lead the table and hold `th` cells only, at least one body row follows, no merged cell crosses from the header into the body, a total row is never a header row, and the `colgroup` (present only while a column has a width or emphasis) has one `col` per column. Merging cells joins their text with line breaks, since a cell holds one paragraph.

The table model maps onto the portable table of [ADR-013](../../docs/decisions/013-cross-product-clipboard.md) §3 (header rows, total rows, merges, alignment, percentage widths, links).

## Numbering and generated content

Numbers are computed, never typed: one function ([`editor/numbering.mjs`](editor/numbering.mjs)) computes every number and label for the editor, print, `check` and the Markdown view (T15). Headings and figures inside protected blocks are not counted; a cross-reference to one keeps the label it has (any other ID of a protected block is a missing target).

- **Heading numbers** show only when `data-heading-numbers="on"`. They are hierarchical (1, 1.1, 1.1.1): each level has a counter that a heading of a higher level restarts. Each level is formatted with its token of the heading format, `data-heading-format` or else the layout theme's `--heading-format` (the last such declaration in `style#theme`, comments left out: the editor and `check` read it the same way; `1` decimal, `A`/`a` letters A…Z, AA…, `I`/`i` Roman numerals up to 3999), joined with dots: with `I.A.1.a`, the second `h2` of the third `h1` is `III.B`. A heading with class `unnumbered` shows no number and does not advance its counter. A number is built only from numbered ancestors: an `h3` under an unnumbered `h2` is `1.1`, not `1.0.1`. The cover title is never numbered. Heading numbers are drawn by the editor and are not saved.
- **Figure and table numbers** follow document order, counted separately: charts and images are figures, `figure.table` is a table. Only a figure with a `figcaption` has a number, shown before its caption (*Figure 2.*); it is not saved.
- **Cross-reference labels**: a numbered heading is *Section 2.1*, any other heading its text, footnotes left out. A cross-reference inside a heading's text reads as its target's number label (*Figure 1*), or, for an unnumbered heading, as that heading's own text without its cross-references: one level only, so headings that refer to each other, or to themselves, always settle at once; a captioned figure *Figure 1* or *Table 1*, and a figure without caption just *Figure* or *Table*. The words follow the article's `lang`: French (`fr…`) uses *Figure*, *Tableau* and *Section*; other languages use English. A cross-reference to a missing ID keeps its label, is reported by `check` (`missing-target`) and is underlined in the editor.
- **Footnotes** are numbered 1, 2, 3… in document order, wherever they are (headings, captions, lists and table cells included). The editor shows each as its number, with the note's text on hover, and lists the notes at the end of the content, before the comments; the same numbers print as endnotes. The number and the list are drawn, never saved: without the editor, the layout theme shows each note in brackets where it is written.
- **Contents** list the headings up to `data-depth`, each nested under the closest preceding heading of a higher level; a numbered heading's entry starts with its number and a space (`2.1 Regions`).
- The editor rewrites labels and contents **on open** (outside the undo history: the document then shows *Unsaved changes*) and after every edit that changes them, so saving always writes them current. `check` reports a label or contents list that differs as `stale-label` or `stale-contents`, with its line, so a label an LLM wrote wrong is corrected on the next save, and the diff shows only labels and contents.

## Comments

```html
<section class="comments">
<aside class="comment-thread" id="c1" data-status="open" data-quote="Revenue grew 18% in 2026" data-section="sec-summary" data-suffix=", ahead of plan.">
<p class="comment" data-author="Alex" data-date="2026-10-15T14:02Z">Check against the audited figure.</p>
<p class="comment" data-author="Sam" data-date="2026-10-15T15:10Z">Checked.</p>
</aside>
</section>
```

- `section.comments` is the last block and holds one or more threads (omit it when there are none).
- A thread has `id`, `data-status` (`open` or `resolved`) and `data-quote` (the quoted text when it was attached). Optional: `data-section` (the ID of its section's heading), `data-prefix` and `data-suffix` (a few characters of context before and after). These serve anchor recovery (T13).
- Each `p.comment` is one comment, the first opening the thread and the others replies: `data-author` (free-text name, not verified), `data-date` (a real UTC date and time, `YYYY-MM-DDTHH:MMZ` with optional seconds) and plain text.
- Every `mark.comment[data-ref]` refers to an existing thread, also inside a protected block. A thread no mark refers to is **orphaned**: kept, reported, never reattached automatically.
- Threads are excluded from print, and so is the anchors' underline.
- **Editor (T13)**: threads are read and written in the Comments panel, not in the page. A new thread takes the selected text's quotation exactly (spaces kept, a cross-reference as its label, a line break or a new block as a line feed, a footnote's text where it is written), the ID of its section's heading (protected headings count), and up to 32 characters of context on each side, never half a character; its ID is `c1`, `c2`… Marks follow every edit, and each comment action is its own undo step. A thread a protected block refers to stays attached and cannot be deleted from the panel. An orphaned thread can be recovered: the editor proposes every place that holds its exact quotation, in its original section first, then elsewhere, each with context; looking, cancelling or saving changes nothing, and a proposal is applied only when the person confirms it, on the document it was found in (after any edit, search again). The new anchor's section and context replace the old ones; the quotation stays. Display names are free text, asked once and kept by the browser, never verified. Comment text is shown as text: no markup, no links followed.

## Paste and Markdown import

Pasted and imported content enters the document only as the constructs above (T07): the editor maps it, it never inserts it as written. Clipboard HTML is parsed in a detached `<template>` ([ADR-013](../../docs/decisions/013-cross-product-clipboard.md) §1), so nothing in it runs or loads, and only `https:`, `http:` and `mailto:` links survive.

- **Order of reading**: an html-office envelope (`application/x-html-office+json`, or the `data-html-office` attribute in the HTML), then the HTML, then plain text. ⌘⇧V / Ctrl+Shift+V and Edit › Paste as plain text read plain text only.
- **Blocks**: `h1`–`h6` become headings 1–4 (5 and 6 become Heading 4); Word's Title becomes Heading 1 and its Subtitle a lead paragraph; paragraphs, lists (also Word's `mso-list` paragraphs and Docs' nested lists), quotes, code (`pre`) and tables map to their own kinds. A list item keeps its text, with its paragraphs joined by line breaks, and one nested list; a quote holds paragraphs, so other blocks inside it become paragraphs. Horizontal rules, images, charts (T11), embedded objects, navigation, forms, Word comments and footnotes are left out.
- **Inline**: bold, italic, underline, highlight (`mark`), superscript, subscript, code and links, from tags or from the styles Word and Docs write (`font-weight`, `font-style`, `text-decoration`, `vertical-align`). Colours, fonts, sizes, spacing and alignment are dropped: pasted text takes the document's styles. Text's own markup (`lead`, `ta-*`, callouts, page breaks, footnotes, cross-references, unnumbered and new-page headings, table widths and total rows) reads back as itself.
- **Undo**: each paste, drop or import is one undo step of its own.
- **IDs**: a pasted heading keeps its `id` when it is valid and free, and otherwise gets a new one from its text; a pasted table always gets a new `tab-N` ID. Comment anchors and threads are not pasted.
- **Notes, references, figures and comments** (T08–T13): a pasted `span.footnote` stays a footnote. A cross-reference stays one only when its target is a heading or figure of this document; otherwise its label is text. Images (`data-asset` belongs to the other file's asset store) and chart figures are left out and reported; images enter only through Insert › Image… (T12), charts through a chart envelope (T11). Comment anchors and threads are never pasted, and a generated contents list is not read.
- **Inside the document**: a copy pasted back into the same document is reinserted whole by the internal clipboard (T09: footnotes and cross-references kept), except that a comment anchor is pasted only when it moves (cut whole, then pasted) and threads never are; a chart envelope goes to the chart paste (T11). Both come before the mapping; a plain-text paste skips them.
- **Tables**: the shared reader ([`packages/shared/clipboard/`](../shared/clipboard/README.md)) gives the grid (merged cells, header rows, alignment); `thead` rows become the header, `tfoot` rows and `tr.total` total rows, and each cell's text keeps its marks as one paragraph. A span stops at the end of its row group, as in HTML; spans that overlap (malformed HTML) are dropped and their cells kept. A table over 1,000 rows or 30 columns refuses the whole paste, a Markdown one before it is rendered.
- **Where it lands**: in a table cell, caption, cover line or footnote, the pasted blocks become lines of that one paragraph; in code, plain text. Elsewhere a pasted paragraph joins the paragraph at the caret, while a heading, list, quote or table stays itself next to it; a table is never opened into text. Text copied inside one table cell pastes as text.
- **Markdown** (Insert › Markdown…): CommonMark through [commonmark.js](https://github.com/commonmark/commonmark.js) 0.31.2, the specification's reference implementation, plus tables as GitHub writes them (a header row, a delimiter row such as `| :--- | ---: |`, then rows; at the top level only). The result goes through the same mapping; raw HTML in the Markdown is read like pasted HTML.
- **Report**: the status line names what was left out or adapted, for example "Left out: 1 image, 1 horizontal rule. Adapted to the document's styles: 1 heading of level 5 or 6."

Copying writes the subset's own markup for a selection of text and blocks, without comment anchors, threads or images, and plain text with line breaks. A selected table (the whole table or its figure) is copied as the html-office envelope (`source.product` `text`), a semantic table with the theme's colours resolved for Word and Excel, and TSV; its caption, ID, emphasis column and density stay with the original.

## Canonical form

A canonical document is byte for byte what the editor writes. Opening and saving it without edits changes nothing. `check.mjs` reports the first place where a valid document differs from this form (`not-canonical` warning); `node tools/pack.mjs <file> [<output>]` rewrites it into the form and lists every changed line. That is the only normalisation step: the editor never normalises silently. Before writing, `check`, `pack` and the editor read the result back: content the HTML parser repaired on the way in (typically inside a protected block) that would not reopen as the same document is an `unstable` error, and nothing is written.

- **File layout**: `<!doctype html>`, then `html`, `head` and `body` each on their own line, one zone per line, ending with `</body>`, `</html>` and a newline, as in Slides.
- **Lines**: each block of `article#doc` starts on its own line. So do the children of the cover, quotes, callouts, lists, the contents list, figures, `table`, `thead`, `tbody`, `section.comments` and threads. A table row, with its cells, is one line; so is a `colgroup`. A nested list starts directly after its item's text: `<li>Text<ul>`, and ends `</ul></li>`. Inline content and `pre` keep their text exactly; inline text contains no line breaks or tabs.
- **Tags**: HTML tags lowercase, every end tag written (`</p>`, `</li>`), void elements without a slash (`<br>`, `<col data-width="40">`). SVG elements and attributes keep their SVG spelling (`clipPath`, `linearGradient`, `viewBox`), as browsers write them, with end tags (`<rect …></rect>`).
- **Attributes**: double-quoted, in this order. Default values are omitted (`colspan="1"`).

  | Element | Order |
  | --- | --- |
  | `article` | as in its table: `id`, `data-format`, `lang`, `data-heading-numbers`, `data-heading-format`, `data-theme`, `data-font`, `data-page`, `data-margins` |
  | Headings | `class`, `id` |
  | `nav.toc` | `class`, `data-depth` |
  | `figure.chart` | `class`, `id`, `data-type`, `data-width` |
  | `figure.image` | `class`, `id`, `data-width`, `data-wrap` |
  | `img` | `data-asset`, `alt` |
  | `col` | `class`, `data-width` |
  | `th`, `td` | `class`, `colspan`, `rowspan` |
  | `a.xref`, `mark.comment` | `class`, `href` / `data-ref` |
  | `aside.comment-thread` | `class`, `id`, `data-status`, `data-quote`, `data-section`, `data-prefix`, `data-suffix` |
  | `p.comment` | `class`, `data-author`, `data-date` |

  Class tokens follow the order of this reference: `lead ta-c`, `unnumbered new-page ta-r`, `callout warning`.
- **Marks** nest in a fixed order, outermost first: comment anchor, link, `strong`, `em`, `u`, `mark`, `sub`/`sup`, `code`. A footnote or cross-reference sits inside the marks that cover it.
- **Text**: line breaks and tabs in inline text read as spaces (rendered the same); write them as spaces.
- **Escaping**: `&amp;`, `&lt;`, `&gt;` and `&nbsp;` (U+00A0) in text, plus `&quot;` in attribute values. A carriage return is written `&#13;`, since a literal one would read back as a line feed. Every other character, including non-ASCII, is written as itself in UTF-8. No other entity or numeric reference.

## Limits of the runtime check

The checker runs on the source. The editor runs the same rules on the browser's parsed document before it allows editing, but a file is HTML: whatever a tampered file contains has already been parsed, and possibly run, by the time any editor code starts. Check files from unknown sources with `node tools/check.mjs` before opening them.

The editor saves only a file it can tell is canonical. Save binds only an empty file or the file's exact bytes as opened, so any difference stops it. Save a copy has no file to compare: it checks what the parsed page still shows (zones, whitespace, the article) and refuses when that differs from the canonical form. Spellings the parser does not keep, such as `&#38;` for `&amp;`, single quotes or uppercase tags, are invisible to it, so a copy of such a file is written in canonical form. `check.mjs` reports these, and `pack.mjs` rewrites them explicitly.
